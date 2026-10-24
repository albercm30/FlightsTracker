"""Tests: python -m unittest discover -s tests -v"""
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock

from tracker import alerts, analysis, build, config, scan
from tracker.providers import Demo, parse
from tracker.store import Store

TODAY = date(2026, 10, 24)


def offer(dep, price, ret=None, stops=0, o="MAD", d="LON"):
    return {"origin": o, "destination": d, "dep": dep, "ret": ret, "price": price, "stops": stops,
            "airline": "IB", "duration": 140, "dep_time": "08:30"}


class ConfigTest(unittest.TestCase):
    def test_clean_and_issue(self):
        cfg = config.clean({"watches": [
            {"name": "Argentina", "origins": "tci, mad, xx", "destinations": ["BUE"], "trip": "rt",
             "stay": {"type": "nights", "min": 15, "max": 10}, "dates": {"months": 40}, "stops": "raro"},
            {"name": "Argentina", "origins": ["MAD"], "destinations": ["LON"], "stay": {"type": "weekend"},
             "dates": {"from": "2026-12-01", "to": "2027-01-31"}, "weekdays": [4, 9], "max_price": "120"}]})
        a, b = cfg["watches"]
        self.assertEqual((a["id"], b["id"]), ("argentina", "argentina-2"))
        self.assertEqual(a["origins"], ["TCI", "MAD"])
        self.assertEqual(a["stay"], {"type": "nights", "min": 15, "max": 15})
        self.assertEqual((a["dates"], a["stops"]), ({"months": 12}, "any"))
        self.assertEqual((b["stay"], b["weekdays"], b["max_price"]), ({"type": "weekend"}, [4], 120.0))
        body = "Pulsa Create\n\n```json\n" + json.dumps(cfg) + "\n```"
        self.assertEqual(config.from_issue(body), cfg)
        with self.assertRaises(ValueError):
            config.from_issue("hola")

    def test_window(self):
        w = config.clean_watch({"dates": {"from": "2026-01-01", "to": "2027-02-01"}})
        self.assertEqual(config.window(w, TODAY), (TODAY + timedelta(days=1), date(2027, 2, 1)))


class FiltersTest(unittest.TestCase):
    def test_stay_and_stops(self):
        fri, sun, mon = "2026-11-06", "2026-11-08", "2026-11-09"
        self.assertTrue(analysis.stay_ok(offer(fri, 1, sun), {"type": "weekend"}))
        self.assertFalse(analysis.stay_ok(offer(fri, 1, mon), {"type": "weekend"}))
        self.assertTrue(analysis.stay_ok(offer(fri, 1, mon), {"type": "long_weekend"}))
        self.assertTrue(analysis.stay_ok(offer(fri, 1, "2026-11-18"), {"type": "nights", "min": 10, "max": 15}))
        self.assertFalse(analysis.stay_ok(offer(fri, 1, "2026-11-14"), {"type": "nights", "min": 10, "max": 15}))
        self.assertTrue(analysis.stops_ok(offer(fri, 1, stops=1), "max1"))
        self.assertFalse(analysis.stops_ok(offer(fri, 1, stops=1), "direct"))


class AnalysisTest(unittest.TestCase):
    def setUp(self):
        self.w = config.clean_watch({"name": "Londres", "origins": ["MAD"], "destinations": ["LON"], "trip": "ow",
                                     "dates": {"months": 3}})
        self.a = config.DEFAULTS["alerts"]
        base = [offer((TODAY + timedelta(days=i)).isoformat(), 100 + (i % 7) * 3) for i in range(5, 80)]
        self.offers = base

    def test_no_deal_when_prices_are_normal(self):
        res = analysis.analyze(self.w, [dict(o) for o in self.offers], [], self.a, TODAY)
        self.assertEqual(res["count"], 75)
        self.assertFalse(any(o.get("top") for o in res["top"]))
        self.assertIn("2026-11-01", res["calendar"])

    def test_top_deal_and_antispam(self):
        offers = [dict(o) for o in self.offers]
        offers[30]["price"] = 55        # −50 %
        res = analysis.analyze(self.w, offers, [], self.a, TODAY)
        tops = [o for o in res["top"] if o.get("top")]
        self.assertEqual(len(tops), 1)
        self.assertEqual(tops[0]["price"], 55)
        self.assertGreaterEqual(tops[0]["score"], 80)
        with tempfile.TemporaryDirectory() as tmp:
            st = Store(os.path.join(tmp, "x.db"))
            self.assertIsNotNone(analysis.alert_candidate(res, st, self.w, self.a, TODAY))
            st.add_alert(self.w["id"], "x", 55, TODAY.isoformat())
            self.assertIsNone(analysis.alert_candidate(res, st, self.w, self.a, TODAY + timedelta(days=2)))
            offers[30]["price"] = 45     # otro 18 % más barato -> sí repite
            res2 = analysis.analyze(self.w, offers, [], self.a, TODAY)
            self.assertIsNotNone(analysis.alert_candidate(res2, st, self.w, self.a, TODAY + timedelta(days=2)))

    def test_target_price(self):
        w = dict(self.w, max_price=101)
        res = analysis.analyze(w, [dict(o) for o in self.offers], [], self.a, TODAY)
        self.assertTrue(any(o.get("top") == "precio objetivo" for o in res["top"]))


class ProvidersTest(unittest.TestCase):
    def test_travelpayouts_parse(self):
        payload = {"data": [
            {"price": 480, "departure_at": "2027-02-09T12:30:00+00:00", "return_at": "2027-02-23T09:00:00-03:00",
             "transfers": 1, "return_transfers": 2, "airline": "UX", "duration_to": 850},
            {"price": 90, "departure_at": "2027-02-09T07:00:00+01:00", "transfers": 0, "airline": "FR"}]}
        rt = parse(payload, "MAD", "BUE", "rt")
        self.assertEqual(len(rt), 1)
        self.assertEqual((rt[0]["stops"], rt[0]["duration"], rt[0]["dep_time"]), (2, 850, "12:30"))
        self.assertEqual(len(parse(payload, "MAD", "LON", "ow")), 1)

    def test_demo_is_realistic(self):
        p = Demo(now=datetime(2026, 10, 24, tzinfo=timezone.utc))
        short = [o["price"] for o in p.month("MAD", "LON", "2027-02", trip="ow")]
        long_ = [o["price"] for o in p.month("MAD", "BKK", "2027-02", trip="ow")]
        self.assertGreater(sorted(long_)[len(long_) // 2], sorted(short)[len(short) // 2] * 3)
        direct = p.month("MAD", "LON", "2027-02", trip="rt", direct=True)
        self.assertTrue(direct and all(o["stops"] == 0 for o in direct))


class EndToEndTest(unittest.TestCase):
    def test_update_builds_site_and_alerts(self):
        from tracker import __main__ as cli
        with tempfile.TemporaryDirectory() as tmp:
            cfgp = os.path.join(tmp, "config.json")
            config.save({"watches": [
                {"name": "Findes", "origins": ["MAD"], "destinations": ["LON", "ROM"], "trip": "rt",
                 "stay": {"type": "weekend"}, "dates": {"months": 3}, "stops": "direct"},
                {"name": "Argentina", "origins": ["TCI"], "destinations": ["BUE"], "trip": "rt",
                 "stay": {"type": "nights", "min": 10, "max": 15}, "dates": {"months": 4}, "max_price": 99999}]}, cfgp)
            sent = []
            env = {"DB_PATH": os.path.join(tmp, "f.db"), "TRAVELPAYOUTS_TOKEN": "", "GITHUB_TOKEN": "",
                   "GMAIL_ADDRESS": "", "GMAIL_APP_PASSWORD": ""}
            with mock.patch.dict(os.environ, env), mock.patch.object(config, "CONFIG_FILE", cfgp), \
                    mock.patch.object(alerts, "send", lambda deals, *a, **k: sent.append(deals) or {"sent": True}):
                out = os.path.join(tmp, "site")
                cli.update(out, today=TODAY)
                with open(os.path.join(out, "data", "site.json"), encoding="utf-8") as f:
                    site = json.load(f)
                self.assertEqual(site["provider"], "demo")
                self.assertEqual(len(site["watches"]), 2)
                fin = site["watches"][0]["summary"]
                self.assertTrue(fin["count"] > 0)
                for o in fin["top"]:   # findes: viernes→domingo y directos
                    self.assertEqual((date.fromisoformat(o["dep"]).weekday(), o["nights"], o["stops"]), (4, 2, 0))
                self.assertTrue(os.path.exists(os.path.join(out, "data", "routes", "TCI-BUE-rt.json")))
                with open(os.path.join(out, "index.html"), encoding="utf-8") as f:
                    self.assertRegex(f.read(), r'src="js/app\.js\?v=[\d.]+-\d+"')
                self.assertTrue(sent and sent[0][0][0]["name"] == "Argentina")   # precio objetivo -> aviso
                # segundo día: no repite el aviso
                sent.clear()
                cli.update(out, today=TODAY)
                self.assertFalse(sent and any(w["name"] == "Argentina" for w, o in sent[0]))

    def test_alert_message(self):
        w = config.clean_watch({"name": "Argentina"})
        o = dict(offer("2027-02-09", 431, "2027-02-23", 1, "TCI", "BUE"), score=96, discount=0.48, nights=14, top="chollo")
        subject, md, html = alerts.build([(w, o)], "https://a.github.io/b/")
        self.assertIn("Tenerife → Buenos Aires por 431 €", subject)
        self.assertIn("−48 %", subject)
        self.assertIn("Google Flights", html)


if __name__ == "__main__":
    unittest.main()
