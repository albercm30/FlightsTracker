"""Tests (unittest estándar; también funcionan con `pytest`)."""
import json
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


class AntiSpamTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.init(os.path.join(self.tmp.name, "a.db"))

    def tearDown(self):
        self.tmp.cleanup()

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
        prov = TravelpayoutsProvider("x", marker="123")
        payload = {"success": True, "data": [
            {"origin": "MAD", "destination": "BKK", "price": 412, "airline": "QR", "transfers": 1,
             "departure_at": "2026-11-03T07:00:00+01:00", "link": "/search/MAD0311BKK1?t=abc"}]}
        out = prov.parse(payload, "MAD", "BKK")
        self.assertEqual(out[0].depart_date, "2026-11-03")
        self.assertEqual(out[0].price, 412.0)
        self.assertTrue(out[0].link.endswith("marker=123"))
        self.assertEqual(out[0].dep_time, "07:00")
        rt = prov.parse({"data": [{"price": 500, "departure_at": "2026-11-03T22:10:00+01:00",
                                   "return_at": "2026-11-13T09:05:00+07:00", "duration_to": 900,
                                   "duration_back": 960, "transfers": 1, "return_transfers": 1}]}, "MAD", "BKK")[0]
        self.assertEqual((rt.duration, rt.return_duration, rt.dep_time, rt.ret_time), (900, 960, "22:10", "09:05"))

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

    def test_rt_demo(self):
        p = DemoProvider(now=datetime(2026, 10, 1, 12, tzinfo=timezone.utc))
        ow = p.fetch_month("MAD", "NYC", "2027-02")
        rt = p.fetch_month("MAD", "NYC", "2027-02", trip="rt", min_nights=5, max_nights=9)
        self.assertTrue(all(q.trip == "rt" and 5 <= q.nights <= 9 for q in rt))
        self.assertGreater(min(x.price for x in rt), min(x.price for x in ow))
        self.assertLess(min(x.price for x in rt), min(x.price for x in ow) * 2.2)

    def test_baggage(self):
        from app import airlines
        fr = airlines.baggage("FR", False, "cabin_checked", legs=2, pax=2)
        self.assertEqual(fr["cabin"], "fee")
        self.assertGreater(fr["fee_min"], 0)
        self.assertEqual(airlines.baggage("QR", True, "checked")["fee_max"], 0)
        self.assertEqual(airlines.baggage("IB", False, "cabin")["fee_max"], 0)
        self.assertEqual(airlines.baggage("XX", False, "personal")["fee_est"], 0)

    def test_holidays(self):
        from app import holidays
        items = holidays.upcoming("", today=date(2026, 11, 20))
        dec = next(i for i in items if "Inmaculada" in i["title"])
        self.assertEqual((dec["start"], dec["end"], dec["days_off"]), ("2026-12-05", "2026-12-08", 1))
        ss = next(i for i in items if i["title"] == "Semana Santa")
        self.assertEqual(ss["start"], "2027-03-25")

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

        self.assertTrue(all(q["return_date"] for q in cal["quotes"]))  # por defecto: ida y vuelta
        ow = c.get("/api/calendar?origin=MAD&destination=LIS&trip=ow").json
        self.assertTrue(ow["quotes"] and not ow["quotes"][0]["return_date"])
        day = cal["quotes"][10]["depart_date"]
        self.assertEqual(c.post("/api/watches", json={"origin": "MAD", "destination": "LIS", "date": day}).status_code, 201)
        self.assertEqual(len(c.get("/api/watches").json), 1)

        r = tracker.search({"origins": ["MAD"], "destinations": ["TYO", "OSA"], "trip": "ow"})
        self.assertTrue(r["found"])
        self.assertEqual(r["best"]["price"], min(d["price"] for d in r["days"]))
        rt = tracker.search({"origins": ["MAD"], "destinations": ["LIS"], "trip": "rt", "min_nights": 3,
                             "max_nights": 5, "pax": 2, "baggage": "checked"})
        self.assertTrue(rt["found"])
        self.assertTrue(all(3 <= o["nights"] <= 5 for o in rt["top"]))
        self.assertGreaterEqual(rt["best"]["price_total"], rt["best"]["price"] * 2)
        self.assertTrue(rt["matrix"])
        ex = tracker.search({"origins": ["MAD"], "destinations": catalog.explore_codes("EU", "playa"),
                             "mode": "explore", "trip": "rt", "weekdays": [4], "return_weekdays": [6, 0]})
        self.assertTrue(ex["found"])
        self.assertTrue(all(d8.weekday() == 4 for d8 in (date.fromisoformat(o["depart_date"]) for o in ex["top"])))
        g = c.get(f"/api/grid?origin=MAD&destination=LIS&depart={rt['best']['depart_date']}&return={rt['best']['return_date']}").json
        self.assertTrue(g["cells"])
        self.assertTrue(c.get("/api/holidays?region=canarias").json["items"])
        self.assertIn(r["advice"]["level"], ("buy", "good", "watch", "wait"))

        second = tracker.run_scan(notify=False)
        self.assertEqual(second["status"], "ok")
        self.assertEqual(c.get("/healthz").status_code, 200)



class AuthAndMigrationTest(unittest.TestCase):
    def test_login_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["APP_PASSWORD"] = "secreta"
            try:
                app = create_app(os.path.join(tmp, "a.db"), start_scheduler=False)
                c = app.test_client()
                self.assertEqual(c.get("/api/status").status_code, 401)
                self.assertEqual(c.get("/").status_code, 302)
                self.assertEqual(c.get("/healthz").status_code, 200)
                self.assertEqual(c.post("/api/login", json={"password": "mal"}).status_code, 401)
                self.assertEqual(c.post("/api/login", json={"password": "secreta"}).status_code, 200)
                self.assertEqual(c.get("/api/status").status_code, 200)
            finally:
                os.environ.pop("APP_PASSWORD", None)

    def test_migration_from_v1(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "old.db")
            con = sqlite3.connect(path)
            con.executescript("""
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
                INSERT INTO settings VALUES ('one_way', 'false');
                CREATE TABLE quotes (origin TEXT, destination TEXT, depart_date TEXT, price REAL, first_seen TEXT,
                                     updated_at TEXT, PRIMARY KEY (origin, destination, depart_date));
                CREATE TABLE watches (id INTEGER PRIMARY KEY, origin TEXT, destination TEXT, depart_date TEXT,
                                      target_price REAL, last_price REAL, created_at TEXT);
                INSERT INTO watches VALUES (1, 'MAD', 'LON', '2030-01-01', NULL, 50, 'x');
                CREATE TABLE alerts (id INTEGER PRIMARY KEY, created_at TEXT, kind TEXT, origin TEXT, destination TEXT,
                                     depart_date TEXT, return_date TEXT, price REAL, ref_price REAL, message TEXT,
                                     link TEXT, notified INTEGER DEFAULT 0, read INTEGER DEFAULT 0);
            """)
            con.commit()
            con.close()
            db.init(path)
            self.assertEqual(db.get_settings()["trip_type"], "rt")
            self.assertEqual(db.rows("SELECT trip FROM watches")[0]["trip"], "ow")
            self.assertIn("trip", {r["name"] for r in db.rows("PRAGMA table_info(quotes)")})


class ExtrasTest(unittest.TestCase):
    def test_resident_price(self):
        self.assertIsNone(tracker.resident_price(100, "TCI", "LON", 1, "canarias"))
        self.assertIsNone(tracker.resident_price(100, "TCI", "MAD", 1, ""))
        self.assertEqual(tracker.resident_price(100, "TCI", "MAD", 1, "canarias"), 34)   # (100-12)*0.25+12
        self.assertEqual(tracker.resident_price(200, "MAD", "PMI", 2, "baleares"), 68)   # (200-24)*0.25+24

    def test_env_config_and_scan_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"ORIGINS": "TCI", "DESTINATIONS": "MAD,LIS", "TRIP_TYPE": "ow", "PRICE_PROVIDER": "demo",
                   "MIN_NIGHTS": "2"}
            old = {k: os.environ.get(k) for k in env}
            os.environ.update(env)
            try:
                db.init(os.path.join(tmp, "e.db"))
                db.execute("INSERT INTO destinations(code, name, enabled, created_at) VALUES ('ROM','Roma',1,'x')")
                db.apply_env_config()
                s = db.get_settings()
                self.assertEqual((s["origins"], s["trip_type"], s["min_nights"]), (["TCI"], "ow", 2))
                enabled = {r["code"] for r in db.rows("SELECT code FROM destinations WHERE enabled=1")}
                self.assertEqual(enabled, {"MAD", "LIS"})
            finally:
                for k, v in old.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

    def test_advice_short(self):
        a = tracker.advice(50, (date.today() + timedelta(days=40)).isoformat(), "MAD", "LON", [50, 60, 70, 80, 90])
        self.assertIn(a["level"], ("buy", "good"))
        self.assertTrue(1 <= a["score"] <= 99)
        self.assertTrue(all(len(p["t"]) < 60 for p in a["points"]))


class CloudTest(unittest.TestCase):
    class FakeGH:
        """Imita la API de GitHub lo justo para probar cloud.py."""
        def __init__(self, private=False, workflow=True):
            self.vars, self.secrets, self.calls, self.updated = {}, {}, [], {}
            self.private, self.workflow, self.pages = private, workflow, None

        def request(self, method, url, headers=None, timeout=None, json=None, params=None):
            from unittest import mock
            path = url.split("/repos/alber/Flights", 1)[1]
            self.calls.append((method, path))
            r = mock.Mock()
            r.status_code, body = 200, {}
            if method == "GET" and path == "":
                body = {"private": self.private, "default_branch": "main", "html_url": "https://github.com/alber/Flights"}
            elif path == "/actions/workflows/scan.yml":
                r.status_code, body = (200, {"state": "active"}) if self.workflow else (404, {})
            elif path.endswith("/runs"):
                body = {"workflow_runs": []}
            elif method == "GET" and path == "/actions/variables":
                body = {"variables": [{"name": k, "value": v, "updated_at": self.updated.get(k, "2000-01-01T00:00:00Z")}
                                      for k, v in self.vars.items()]}
            elif method == "GET" and path == "/actions/secrets":
                body = {"secrets": [{"name": k} for k in self.secrets]}
            elif path == "/actions/secrets/public-key":
                body = {"key": "x", "key_id": "1"}
            elif method == "PUT" and path.startswith("/actions/secrets/"):
                self.secrets[path.rsplit("/", 1)[1]] = json["encrypted_value"]; r.status_code = 201
            elif method == "PATCH" and path.startswith("/actions/variables/"):
                name = path.rsplit("/", 1)[1]
                if name in self.vars:
                    self.vars[name] = json["value"]; r.status_code = 204
                else:
                    r.status_code = 404
            elif method == "POST" and path == "/actions/variables":
                self.vars[json["name"]] = json["value"]; r.status_code = 201
            elif method == "DELETE" and path.startswith("/actions/variables/"):
                self.vars.pop(path.rsplit("/", 1)[1], None); r.status_code = 204
            elif path == "/pages":
                if method == "GET":
                    r.status_code, body = (200, self.pages) if self.pages else (404, {})
                else:
                    self.pages = {"html_url": "https://alber.github.io/Flights/", "build_type": "workflow"}
                    r.status_code = 201
            elif path.endswith("/dispatches"):
                r.status_code = 204
            r.json = lambda: body
            return r

    def setUp(self):
        from unittest import mock
        from app import cloud
        self.tmp = tempfile.TemporaryDirectory()
        db.init(os.path.join(self.tmp.name, "c.db"))
        db.update_settings({"github_token": "t", "github_repo": "alber/Flights", "origins": ["TCI"],
                            "travelpayouts_token": "tp", "ntfy_topic": "vuelos-x"})
        db.execute("INSERT INTO destinations(code, name, enabled, created_at) VALUES ('ROM','Roma',1,'x')")
        self.p = mock.patch.object(cloud, "encrypt", lambda k, v: "enc:" + v)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_sync_and_status(self):
        from app import cloud
        gh = self.FakeGH()
        res = cloud.sync(session=gh)
        self.assertEqual(gh.vars["ORIGINS"], "TCI")
        self.assertEqual(gh.vars["DESTINATIONS"], "ROM")
        self.assertEqual(gh.vars["ENABLE_SCHEDULED_SCAN"], "true")
        self.assertEqual(gh.vars["PUBLISH_SITE"], "true")
        self.assertEqual(gh.secrets["TRAVELPAYOUTS_TOKEN"], "enc:tp")
        self.assertIn("NTFY_TOPIC", res["secrets"])
        self.assertIsNone(res["pages_warning"])
        st = cloud.status(session=gh)
        self.assertTrue(st["in_sync"] and st["has_price_token"] and st["pages_enabled"])
        self.assertEqual(st["pages_url"], "https://alber.github.io/Flights/")
        cloud.run_now(demo=True, session=gh)
        self.assertIn(("POST", "/actions/workflows/scan.yml/dispatches"), gh.calls)

    def test_pull_changes_made_from_phone(self):
        from app import cloud
        gh = self.FakeGH()
        cloud.sync(session=gh)
        # desde el móvil (modo administrador) se añade Nueva York y se cambia el nivel de avisos
        gh.vars.update(DESTINATIONS="ROM,NYC", ALERT_LEVEL="excepcional")
        gh.updated.update(DESTINATIONS="2999-01-01T00:00:00Z", ALERT_LEVEL="2999-01-01T00:00:00Z")
        res = cloud.sync(session=gh)
        self.assertIn("DESTINATIONS", res["pulled"])
        enabled = {r["code"] for r in db.rows("SELECT code FROM destinations WHERE enabled=1")}
        self.assertEqual(enabled, {"ROM", "NYC"})
        self.assertEqual(db.get_settings()["alert_level"], "excepcional")
        self.assertEqual(gh.vars["DESTINATIONS"], "NYC,ROM")

    def test_private_repo_and_missing_workflow(self):
        from app import cloud
        self.assertIn("privado", cloud.sync(session=self.FakeGH(private=True))["pages_warning"])
        with self.assertRaises(cloud.CloudError):
            cloud.sync(session=self.FakeGH(workflow=False))

    def test_detect_repo(self):
        from app import cloud
        d = os.path.join(self.tmp.name, "r", ".git")
        os.makedirs(d)
        open(os.path.join(d, "config"), "w").write('[remote "origin"]\n\turl = https://github.com/albercm30/FlightsTracker.git\n')
        self.assertEqual(cloud.detect_repo(os.path.join(self.tmp.name, "r")), "albercm30/FlightsTracker")


class ExportTest(unittest.TestCase):
    def test_export_static_site(self):
        from app.export import export_site
        with tempfile.TemporaryDirectory() as tmp:
            os.environ.pop("APP_PASSWORD", None)
            db.init(os.path.join(tmp, "x.db"))
            db.update_settings({"origins": ["MAD"], "months_ahead": 2, "trip_type": "rt", "travelpayouts_token": "SECRETO",
                                "telegram_bot_token": "TG-SECRET"})
            db.execute("INSERT INTO destinations(code, name, enabled, created_at) VALUES ('LIS','Lisboa',1,'x')")
            from app.providers.demo import DemoProvider
            tracker.run_scan(provider=DemoProvider(), notify=False)
            os.environ["DB_PATH"] = os.path.join(tmp, "x.db")
            try:
                res = export_site(os.path.join(tmp, "site"))
            finally:
                os.environ.pop("DB_PATH", None)
            self.assertEqual(res["routes"], 1)
            site = os.path.join(tmp, "site")
            html = open(os.path.join(site, "index.html"), encoding="utf-8").read()
            self.assertIn("window.STATIC = true", html)
            self.assertNotIn('src="/static', html)
            self.assertTrue(os.path.exists(os.path.join(site, "data", "cal", "MAD-LIS-rt.json")))
            blob = "".join(open(os.path.join(r, f), encoding="utf-8", errors="ignore").read()
                           for r, _, fs in os.walk(os.path.join(site, "data")) for f in fs)
            self.assertNotIn("SECRETO", blob)
            self.assertNotIn("TG-SECRET", blob)


class WebPushTest(unittest.TestCase):
    def test_rfc8291_vector(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from app import webpush as w
        as_priv = ec.derive_private_key(int.from_bytes(w.ub64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"),
                                        ec.SECP256R1())
        out = w.encrypt(b"When I grow up, I want to be a watermelon",
                        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                        "BTBZMqHH6r4Tts7J_aSIgg", _as_private=as_priv, _salt=w.ub64("DGv6ra1nlYgDCS1FRnbzlw"))
        self.assertEqual(w.b64u(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLo"
                         "cInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgS"
                         "xsj_Qulcy4a-fN")

    def test_vapid_signature_verifies(self):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        from app import webpush as w
        priv, pub = w.generate_vapid()
        header = w.vapid_auth("https://fcm.googleapis.com/fcm/send/abc", priv, pub, "mailto:a@b.c")
        token = header.split("t=")[1].split(",")[0]
        h, c, sig = token.split(".")
        raw = w.ub64(sig)
        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), w.ub64(pub))
        key.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                   f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))
        self.assertIn('"aud":"https://fcm.googleapis.com"', w.ub64(c).decode())

    def test_devices_and_send(self):
        from unittest import mock
        from cryptography.hazmat.primitives.asymmetric import ec
        from app import notifier, webpush as w
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(os.path.join(tmp, "p.db"), start_scheduler=False)
            c = app.test_client()
            self.assertTrue(c.get("/api/push/key").json["public_key"])
            ua = ec.generate_private_key(ec.SECP256R1())
            sub = {"endpoint": "https://push.example.com/abc",
                   "keys": {"p256dh": w.b64u(w._pub_raw(ua)), "auth": w.b64u(os.urandom(16))}}
            code = w.b64u(json.dumps({**sub, "name": "Mi móvil"}).encode())
            self.assertEqual(c.post("/api/push/devices", json={"code": code}).status_code, 201)
            self.assertEqual(c.post("/api/push/devices", json={"code": "basura"}).status_code, 400)
            self.assertEqual(c.get("/api/push/devices").json[0]["name"], "Mi móvil")
            self.assertEqual(notifier.enabled_channels(db.get_settings())[0], "push")
            with mock.patch("app.webpush.requests.post") as post:
                post.return_value.status_code = 201
                self.assertTrue(notifier.send_push(db.get_settings(), "t", "b").startswith("ok"))
                hdr = post.call_args.kwargs["headers"]
                self.assertEqual(hdr["Content-Encoding"], "aes128gcm")
                self.assertTrue(hdr["Authorization"].startswith("vapid t="))
            with mock.patch("app.webpush.requests.post") as post:   # suscripción caducada -> se borra
                post.return_value.status_code = 410
                with self.assertRaises(RuntimeError):
                    notifier.send_push(db.get_settings(), "t", "b")
            self.assertEqual(c.get("/api/push/devices").json, [])


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
