"""Tests (unittest estándar; también funcionan con `pytest`)."""
import json
import os
import shutil
import statistics
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock

from app import db, notifier, tracker
from app.providers.base import Quote
from app.providers.demo import DemoProvider, easter
from app.providers.travelpayouts import TravelpayoutsProvider

TODAY = date(2026, 10, 1)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def q(day, price, o="MAD", d="BKK"):
    return Quote(origin=o, destination=d, depart_date=day, price=price)


class TmpDB(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.init(os.path.join(self.tmp.name, "t.db"))

    def tearDown(self):
        self.tmp.cleanup()


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
        # por defecto las simples bajadas NO avisan (anti-spam)
        self.assertEqual(tracker.detect_deals(quotes, existing, today=TODAY, settings=self.settings), [])
        st = dict(self.settings, alert_drops=True)
        res = tracker.detect_deals(quotes, existing, today=TODAY, settings=st)
        self.assertEqual([a["kind"] for a in res], ["drop"])
        # ya avisado a 425 -> no repetir
        res = tracker.detect_deals(quotes, existing, today=TODAY, settings=st, last_alerts={day: 425})
        self.assertEqual(res, [])

    def test_target_and_record(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=50)).isoformat()
        quotes[day] = q(day, 380)
        res = tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings, max_price=400, history_min=480)
        self.assertEqual(res[0]["kind"], "record")
        self.assertIn("target", res[0]["kinds"])
        # un mínimo histórico con poco ahorro (−10 %) no merece aviso
        quotes[day] = q(day, 450)
        self.assertEqual(tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings, history_min=480), [])

    def test_alert_levels(self):
        quotes = self._year()
        day = (TODAY + timedelta(days=30)).isoformat()
        quotes[day] = q(day, 370)   # −26 %
        self.assertEqual(tracker.detect_deals(quotes, {}, today=TODAY, settings=self.settings), [])
        res = tracker.detect_deals(quotes, {}, today=TODAY, settings=dict(self.settings, alert_level="buena"))
        self.assertEqual(len(res), 1)
        quotes[day] = q(day, 320)   # −36 %: muy buena pero no excepcional
        self.assertEqual(tracker.detect_deals(quotes, {}, today=TODAY,
                                              settings=dict(self.settings, alert_level="excepcional")), [])

    def test_quote_filter(self):
        a = Quote("MAD", "BKK", "2027-01-10", 500, transfers=2, duration=1300, dep_time="07:10", airline="EK")
        b = Quote("MAD", "BKK", "2027-01-10", 600, transfers=1, duration=900, dep_time="22:10", airline="QR")
        self.assertEqual([x.airline for x in (a, b) if tracker.quote_filter({"max_stops": 1})(x)], ["QR"])
        self.assertEqual([x.airline for x in (a, b) if tracker.quote_filter({"max_duration_h": 16})(x)], ["QR"])
        self.assertEqual([x.airline for x in (a, b) if tracker.quote_filter({"dep_windows": "morning"})(x)], ["EK"])
        self.assertEqual([x.airline for x in (a, b) if tracker.quote_filter({"exclude_airlines": ["ek"]})(x)], ["QR"])
        self.assertEqual([x.airline for x in (a, b) if tracker.quote_filter({"airlines": ["EK"]})(x)], ["EK"])


class AntiSpamTest(TmpDB):
    def _cand(self, dest, day, price, sav, trip="ow", o="MAD"):
        return {"quote": Quote(o, dest, day, price), "kind": "deal", "kinds": ["deal"], "ref_price": price / (1 - sav),
                "median": price / (1 - sav), "prev_price": None, "savings": sav, "lead": 30,
                "origin": o, "destination": dest, "trip": trip}

    def test_one_alert_per_destination_and_no_repeats(self):
        st = db.get_settings()
        today = date.today()
        days = [(today + timedelta(days=30 + i)).isoformat() for i in range(30)]
        cands = [self._cand("LON", d, 40 + i, 0.4) for i, d in enumerate(days)] + [self._cand("BKK", days[0], 400, 0.35)]
        chosen = tracker.select_alerts(cands, st, today)
        self.assertEqual(sorted(a["destination"] for a in chosen), ["BKK", "LON"])
        self.assertEqual(chosen[[a["destination"] for a in chosen].index("LON")]["quote"].price, 40)
        tracker.record_alerts(chosen, st)
        # siguiente escaneo: lo mismo o apenas más barato -> nada
        self.assertEqual(tracker.select_alerts([self._cand("LON", days[3], 38, 0.42)], st, today), [])
        # claramente mejor (−10 % o más) -> sí
        self.assertEqual(len(tracker.select_alerts([self._cand("LON", days[3], 34, 0.5)], st, today)), 1)
        # otro tipo de viaje del mismo destino sin mejorar mucho el ahorro -> no
        self.assertEqual(tracker.select_alerts([self._cand("LON", days[5], 90, 0.45, trip="rt")], st, today), [])


class CatalogTest(unittest.TestCase):
    def test_all_195_countries(self):
        from app import catalog
        from app.catalog_world import COUNTRY_NAMES
        ccs = {c["country_code"] for c in catalog.countries()}
        self.assertEqual(len(COUNTRY_NAMES), 195)
        self.assertTrue(set(COUNTRY_NAMES) <= ccs)
        self.assertEqual(catalog.cities_in_country("AD")[0]["code"], "BCN")
        self.assertTrue(all(c["code"] in catalog.COORDS for c in catalog.CITIES))


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
        prov = TravelpayoutsProvider("x")
        payload = {"success": True, "data": [
            {"origin": "MAD", "destination": "BKK", "price": 412, "airline": "QR", "transfers": 1,
             "departure_at": "2026-11-03T07:00:00+01:00", "link": "/search/MAD0311BKK1?t=abc"}]}
        out = prov.parse(payload, "MAD", "BKK")
        self.assertEqual(out[0].depart_date, "2026-11-03")
        self.assertEqual(out[0].price, 412.0)
        self.assertTrue(out[0].link.startswith("https://www.aviasales.com/search/MAD0311BKK1"))
        self.assertEqual(out[0].dep_time, "07:00")
        rt = prov.parse({"data": [{"price": 500, "departure_at": "2026-11-03T22:10:00+01:00",
                                   "return_at": "2026-11-13T09:05:00+07:00", "duration_to": 900,
                                   "duration_back": 960, "transfers": 1, "return_transfers": 1}]}, "MAD", "BKK")[0]
        self.assertEqual((rt.duration, rt.return_duration, rt.dep_time, rt.ret_time), (900, 960, "22:10", "09:05"))



class ScanAndSiteTest(TmpDB):
    def test_scan_demo_and_export_site(self):
        from app.site import export_site
        db.update_settings({"origins": ["TCI"], "provider": "demo", "months_ahead": 3, "trip_type": "both",
                            "travelpayouts_token": "SECRETO-TP", "smtp_password": "SECRETO-MAIL",
                            "resident_discount": "canarias", "max_stops": 1})
        for code, name in (("MAD", "Madrid"), ("LON", "Londres"), ("BKK", "Bangkok")):
            db.execute("INSERT INTO destinations(code, name, enabled, created_at) VALUES (?,?,1,'x')", (code, name))
        with mock.patch("app.providers.get_provider", lambda s: DemoProvider()), \
                mock.patch("app.tracker.get_provider", lambda s: DemoProvider()):
            res = tracker.run_scan(notify=False)
        self.assertEqual(res["status"], "ok")
        self.assertGreater(res["quotes"], 100)
        # el filtro por defecto (máx. 1 escala) se aplica a lo que se guarda
        self.assertEqual(db.one("SELECT COUNT(*) AS n FROM quotes WHERE transfers > 1")["n"], 0)
        out = os.path.join(self.tmp.name, "site")
        info = export_site(out, "Mis vuelos")
        self.assertEqual(info["destinations"], 3)
        blob = ""
        for r, _d, fs in os.walk(out):
            for f in fs:
                if f.endswith((".json", ".html")):
                    with open(os.path.join(r, f), encoding="utf-8") as fh:
                        blob += fh.read()
        self.assertNotIn("SECRETO", blob)                       # nunca se publican claves
        with open(os.path.join(out, "data", "settings.json"), encoding="utf-8") as fh:
            st = json.load(fh)
        self.assertEqual(st["resident_discount"], "canarias")   # tus ajustes, para la web
        with open(os.path.join(out, "data", "cal", "TCI-MAD-rt.json"), encoding="utf-8") as fh:
            cal = json.load(fh)
        qq = cal["quotes"][0]
        self.assertIn("duration", qq)
        self.assertIn("dep_time", qq)
        # precio publicado SIN descuento de residente (lo aplica la web)
        self.assertEqual(qq["price"], db.one("SELECT price FROM quotes WHERE origin='TCI' AND destination='MAD' "
                                             "AND trip='rt' AND depart_date=?", (qq["depart_date"],))["price"])
        with open(os.path.join(out, "index.html"), encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn("<title>Mis vuelos</title>", html)
        self.assertIn('src="static/js/admin.js"', html)
        self.assertTrue(os.path.exists(os.path.join(out, "static", "js", "sealbox.js")))


class EnvConfigTest(TmpDB):
    def test_github_variables_are_the_config(self):
        db.execute("INSERT INTO destinations(code, name, enabled, created_at) VALUES ('ROM','Roma',1,'x')")
        db.update_settings({"dep_windows": "morning", "max_stops": 0})
        env = {"GITHUB_ACTIONS": "true", "ORIGINS": "TCI", "DESTINATIONS": "MAD,LIS", "TRIP_TYPE": "ow",
               "MIN_NIGHTS": "2", "ALERT_LEVEL": "excepcional", "EXCLUDE_AIRLINES": "fr,W6",
               "EMAIL_TO": "yo@gmail.com", "SMTP_PASSWORD": "abcd efgh"}
        with mock.patch.dict(os.environ, env):
            db.apply_env_config()
        s = db.get_settings()
        self.assertEqual((s["origins"], s["trip_type"], s["min_nights"], s["alert_level"]), (["TCI"], "ow", 2, "excepcional"))
        self.assertEqual(s["exclude_airlines"], ["FR", "W6"])
        # quitar un filtro en la web lo desactiva aunque la base de datos venga de la caché
        self.assertEqual((s["dep_windows"], s["max_stops"]), ("", -1))
        self.assertEqual({r["code"] for r in db.rows("SELECT code FROM destinations WHERE enabled=1")}, {"MAD", "LIS"})
        self.assertTrue(notifier.email_ready(s))

    def test_resident_price(self):
        self.assertIsNone(tracker.resident_price(100, "TCI", "LON", 1, "canarias"))
        self.assertIsNone(tracker.resident_price(100, "TCI", "MAD", 1, ""))
        self.assertEqual(tracker.resident_price(100, "TCI", "MAD", 1, "canarias"), 34)   # (100-12)*0.25+12
        self.assertEqual(tracker.resident_price(200, "MAD", "PMI", 2, "baleares"), 68)   # (200-24)*0.25+24


class EmailTest(TmpDB):
    def test_digest_email(self):
        s = {"email_to": "yo@gmail.com", "smtp_password": "x", "notify_max_items": 5, "provider": "travelpayouts",
             "site_url": "https://alber.github.io/Flights/"}
        alerts = [{"id": None, "kind": "deal", "message": "Chollo: MAD → Tokio", "link": "", "origin": "MAD",
                   "destination": "TYO", "trip": "rt", "depart_date": "2027-01-10", "return_date": "2027-01-20",
                   "price": 480, "savings": 0.4}]
        sent = {}
        with mock.patch("app.notifier.send_email", lambda s_, subj, txt, html: sent.update(subj=subj, html=html)):
            self.assertEqual(notifier.send_digest(alerts, s), {"email": "ok"})
        self.assertIn("Tokio", sent["subj"])
        self.assertIn("480 €", sent["html"])
        self.assertIn("−40%", sent["html"])
        self.assertIn("alber.github.io/Flights/#alerts", sent["html"])
        self.assertEqual(notifier.send_digest(alerts, {"email_to": ""}), {})
        self.assertIn("error", notifier.send_test({"email_to": ""}))


@unittest.skipUnless(shutil.which("node"), "hace falta Node.js")
class SealBoxTest(unittest.TestCase):
    """La web cifra tus claves antes de guardarlas en GitHub (crypto_box_seal de libsodium)."""
    def test_against_libsodium(self):
        import ctypes
        import ctypes.util
        lib = ctypes.util.find_library("sodium")
        if not lib:
            self.skipTest("libsodium no disponible")
        so = ctypes.CDLL(lib)
        self.assertGreaterEqual(so.sodium_init(), 0)
        pk, sk = ctypes.create_string_buffer(32), ctypes.create_string_buffer(32)
        so.crypto_box_keypair(pk, sk)
        js = ("const S=require(process.argv[1]);globalThis.crypto=require('crypto').webcrypto;"
              "const pk=Buffer.from(process.argv[2],'hex');"
              "console.log(JSON.stringify(process.argv.slice(3).map(m=>Buffer.from(S.seal(Buffer.from(m,'utf8'),pk)).toString('hex'))))")
        msgs = ["", "abcd efgh ijkl mnop", "x" * 200, "ñ✈️"]
        out = json.loads(subprocess.check_output(["node", "-e", js, os.path.join(ROOT, "app/static/js/sealbox.js"),
                                                  pk.raw.hex(), *msgs]))
        for m, h in zip(msgs, out):
            c = bytes.fromhex(h)
            buf = ctypes.create_string_buffer(max(1, len(c) - 48))
            self.assertEqual(so.crypto_box_seal_open(buf, c, ctypes.c_ulonglong(len(c)), pk, sk), 0)
            self.assertEqual(buf.raw[:len(c) - 48], m.encode())


if __name__ == "__main__":
    unittest.main()
