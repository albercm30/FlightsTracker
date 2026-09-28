"""Tests (unittest estándar; también funcionan con `pytest`)."""
import os
import statistics
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone

from app import catalog, create_app, db, tracker
from app.providers import booking_links
from app.providers.base import Quote
from app.providers.demo import DemoProvider, easter
from app.providers.serpapi import parse as serp_parse
from app.providers.travelpayouts import TravelpayoutsProvider

TODAY = date(2026, 10, 1)


def q(day, price, o="MAD", d="BKK"):
    return Quote(origin=o, destination=d, depart_date=day, price=price)


class DetectDealsTest(unittest.TestCase):
    settings = {"min_days_ahead": 14, "max_days_ahead": 365, "drop_pct": 15, "deal_pct": 30, "realert_pct": 5}

    def _year(self, base=500):
        return {(TODAY + timedelta(days=i)).isoformat(): q((TODAY + timedelta(days=i)).isoformat(), base)
                for i in range(1, 60)}

    def test_deal_below_median(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=30)).isoformat()
        quotes[day] = q(day, 300)
        res = tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["kind"], "deal")
        self.assertAlmostEqual(res[0]["savings"], 0.4)

    def test_respects_min_days_ahead(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=5)).isoformat()
        quotes[day] = q(day, 100)
        self.assertEqual(tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings), [])

    def test_drop_and_realert(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=40)).isoformat()
        quotes[day] = q(day, 420)
        existing = {day: {"price": 520}}
        res = tracker.detect_deals(quotes, existing, today=TODAY, settings=self.settings)
        self.assertEqual([a["kind"] for a in res], ["drop"])
        # ya avisado a 425 -> no repetir
        res = tracker.detect_deals(quotes, existing, today=TODAY, settings=self.settings, last_alerts={day: 425})
        self.assertEqual(res, [])

    def test_target_and_record(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=50)).isoformat()
        quotes[day] = q(day, 450)
        res = tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings, max_price=460, history_min=480)
        self.assertEqual(res[0]["kind"], "record")
        self.assertIn("target", res[0]["kinds"])


class DemoRealismTest(unittest.TestCase):
    def setUp(self):
        self.p = DemoProvider(now=datetime(2026, 10, 1, 12, tzinfo=timezone.utc))

    def _prices(self, o, d, months):
        return [x.price for m in months for x in self.p.fetch_month(o, d, m)]

    def test_long_haul_more_expensive(self):
        short = statistics.median(self._prices("MAD", "LON", ["2027-02", "2027-03"]))
        long_ = statistics.median(self._prices("MAD", "BKK", ["2027-02", "2027-03"]))
        self.assertGreater(long_, short * 3)
        self.assertTrue(30 <= short <= 150, short)
        self.assertTrue(300 <= long_ <= 900, long_)

    def test_summer_peak_for_beach(self):
        winter = statistics.median(self._prices("MAD", "PMI", ["2027-02"]))
        summer = statistics.median(self._prices("MAD", "PMI", ["2027-08"]))
        self.assertGreater(summer, winter * 1.6)

    def test_last_minute_more_expensive(self):
        quotes = self.p.fetch_month("MAD", "ROM", "2026-10")
        late = [x.price for x in quotes if x.depart_date <= "2026-10-06"]
        mid = [x.price for x in quotes if "2026-10-20" <= x.depart_date]
        self.assertGreater(statistics.mean(late), statistics.mean(mid))

    def test_prices_are_sticky_between_scans(self):
        later = DemoProvider(now=self.p.now + timedelta(hours=4))
        a = {x.depart_date: x.price for x in self.p.fetch_month("MAD", "NYC", "2027-03")}
        b = {x.depart_date: x.price for x in later.fetch_month("MAD", "NYC", "2027-03")}
        changed = sum(1 for k in a if b.get(k) != a[k])
        self.assertLess(changed, len(a) * 0.5)

    def test_easter(self):
        self.assertEqual(easter(2027), date(2027, 3, 28))
        self.assertEqual(easter(2026), date(2026, 4, 5))


class ParsersTest(unittest.TestCase):
    def test_travelpayouts_parse(self):
        prov = TravelpayoutsProvider("x", marker="123")
        payload = {"success": True, "data": [
            {"origin": "MAD", "destination": "BKK", "price": 412, "airline": "QR", "transfers": 1,
             "departure_at": "2026-11-03T07:00:00+01:00", "link": "/search/MAD0311BKK1?t=abc"}]}
        out = prov.parse(payload, "MAD", "BKK")
        self.assertEqual(out[0].depart_date, "2026-11-03")
        self.assertEqual(out[0].price, 412.0)
        self.assertTrue(out[0].link.endswith("marker=123"))

    def test_serpapi_parse(self):
        data = {"best_flights": [{"price": 380, "total_duration": 800, "flights": [
            {"airline": "Qatar", "departure_airport": {"id": "MAD", "time": "2026-11-03 08:00"},
             "arrival_airport": {"id": "DOH"}},
            {"airline": "Qatar", "departure_airport": {"id": "DOH"}, "arrival_airport": {"id": "BKK"}}]}],
            "price_insights": {"lowest_price": 380, "price_level": "low", "typical_price_range": [420, 600],
                               "price_history": [[1759000000, 450], [1759600000, 400]]}}
        r = serp_parse(data)
        self.assertEqual(r["lowest_price"], 380)
        self.assertEqual(r["flights"][0]["stops"], 1)
        self.assertEqual(len(r["history"]), 2)

    def test_booking_links(self):
        l = booking_links("MAD", "BKK", "2026-11-03")
        self.assertEqual(l["aviasales"], "https://www.aviasales.com/search/MAD0311BKK1")
        self.assertIn("/mad/bkk/261103/", l["skyscanner"])

    def test_catalog(self):
        self.assertTrue(all(c["code"] in catalog.COORDS for c in catalog.CITIES))
        self.assertGreater(catalog.distance_km("MAD", "SYD"), 17000)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ.pop("APP_PASSWORD", None)
        cls.app = create_app(os.path.join(cls.tmp.name, "t.db"), start_scheduler=False)
        cls.c = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_full_flow(self):
        c = self.c
        self.assertEqual(c.post("/api/destinations", json={"code": "LIS"}).status_code, 201)
        self.assertEqual(c.post("/api/destinations", json={"code": "xx"}).status_code, 400)
        c.post("/api/destinations/country", json={"country_code": "JP"})
        codes = {d["code"] for d in c.get("/api/destinations").json}
        self.assertTrue({"LIS", "TYO", "OSA"} <= codes)
        c.put("/api/settings", json={"origins": "MAD, BCN", "months_ahead": 3, "telegram_bot_token": "secret123"})
        s = c.get("/api/settings").json
        self.assertEqual(s["origins"], ["MAD", "BCN"])
        self.assertTrue(s["telegram_bot_token"].startswith("••••"))
        # guardar con el valor enmascarado no pisa el secreto
        c.put("/api/settings", json=s)
        self.assertEqual(db.get_settings()["telegram_bot_token"], "secret123")
        c.put("/api/settings", json={"telegram_bot_token": ""})

        res = tracker.run_scan(notify=False)
        self.assertEqual(res["status"], "ok", res)
        self.assertGreater(res["quotes"], 100)
        self.assertTrue(c.get("/api/deals").json)
        cal = c.get("/api/calendar?origin=MAD&destination=LIS").json
        self.assertTrue(cal["quotes"])
        self.assertTrue(c.get("/api/history?origin=MAD&destination=LIS").json)  # incluye histórico demo

        day = cal["quotes"][10]["depart_date"]
        self.assertEqual(c.post("/api/watches", json={"origin": "MAD", "destination": "LIS", "date": day}).status_code, 201)
        self.assertEqual(len(c.get("/api/watches").json), 1)

        r = tracker.best_day_search(["MAD"], ["TYO", "OSA"])
        self.assertTrue(r["found"])
        self.assertEqual(r["best"]["price"], min(d["price"] for d in r["days"]))
        self.assertIn(r["advice"]["level"], ("buy", "good", "watch", "wait"))

        second = tracker.run_scan(notify=False)
        self.assertEqual(second["status"], "ok")
        self.assertEqual(c.get("/healthz").status_code, 200)



class NotifierTest(unittest.TestCase):
    def test_digest_telegram_and_ntfy(self):
        from unittest import mock
        from app import notifier
        s = {"telegram_bot_token": "t", "telegram_chat_id": "1", "ntfy_topic": "x", "ntfy_server": "https://ntfy.sh",
             "notify_max_items": 1}
        alerts = [{"kind": "deal", "message": "Chollo: MAD → Tokio", "link": "", "origin": "MAD",
                   "destination": "TYO", "depart_date": "2027-01-10", "savings": 0.4},
                  {"kind": "drop", "message": "Bajada", "link": "", "origin": "MAD",
                   "destination": "LON", "depart_date": "2027-01-11", "savings": 0.1}]
        with mock.patch("app.notifier.requests.post") as post:
            post.return_value.raise_for_status = lambda: None
            res = notifier.send_digest(alerts, s)
        self.assertEqual(res, {"telegram": "ok", "ntfy": "ok"})
        tg = post.call_args_list[0].kwargs["json"]["text"]
        self.assertIn("Tokio", tg)
        self.assertIn("1 más", tg)
        self.assertEqual(post.call_args_list[1].kwargs["json"]["priority"], 4)


if __name__ == "__main__":
    unittest.main()
