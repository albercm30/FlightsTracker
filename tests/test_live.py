"""Tests de los precios en directo (Google Flights) con un buscador falso: no se conecta a Google."""
import json
import os
import tempfile
import unittest
from datetime import date, timedelta
from types import SimpleNamespace as NS
from unittest import mock

from tracker import alerts, config, live
from tracker.store import Store

TODAY = date(2026, 11, 25)
VERANO = {"id": "verano", "name": "Verano", "origins": ["MAD", "BCN"], "destinations": ["SCL", "LIM"], "trip": "rt",
          "stay": {"type": "nights", "min": 12, "max": 14}, "dates": {"from": "2027-07-09", "to": "2027-07-11"},
          "stops": "max1", "weekdays": [4, 5, 6], "max_price": 730}


class FakeGoogle:
    """Precio fijo por destino; registra lo que se le pide."""
    name = "google"

    def __init__(self, prices=None, fail=False):
        self.prices, self.fail, self.calls = prices or {"SCL": 715, "LIM": 640}, fail, []

    def search(self, o, d, dep, ret=None, max_stops=None):
        self.calls.append((o, d, dep, ret, max_stops))
        if self.fail:
            raise live.LiveError("bloqueado")
        p = self.prices.get(d)
        if p is None:
            return None
        return {"origin": o, "destination": d, "dep": dep, "ret": ret, "price": float(p), "stops": 1,
                "airline": "Iberia", "duration": 900, "dep_time": "23:55"}


def cached(dep, ret, price, stops=1, o="MAD", d="SCL"):
    return {"origin": o, "destination": d, "dep": dep, "ret": ret, "price": price, "stops": stops, "airline": "LA",
            "duration": 800, "dep_time": "10:00"}


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "f.db"))
        self.cfg = config.clean({"watches": [VERANO]})

    def tearDown(self):
        self.tmp.cleanup()

    def test_narrow_watch_searches_every_combination(self):
        jobs = live.plan(self.cfg, self.store, {}, TODAY, 1000)
        # 2 orígenes × 2 destinos × 3 días de salida (vie, sáb, dom) × 3 estancias (12, 13, 14)
        self.assertEqual(len(jobs), 36)
        self.assertIn(("MAD", "SCL", "2027-07-09", "2027-07-21", 1), jobs)
        self.assertTrue(all(j[4] == 1 for j in jobs))

    def test_budget_rotation_and_verify_first(self):
        c = {"verano": [cached("2027-07-10", "2027-07-24", 900)]}
        jobs = live.plan(self.cfg, self.store, c, TODAY, 10)
        self.assertEqual(len(jobs), 10)
        self.assertEqual(jobs[0], ("MAD", "SCL", "2027-07-10", "2027-07-24", 1))   # verificar primero
        stats = live.run(FakeGoogle(), self.store, jobs, workers=2, pause=0)
        self.assertEqual((stats["ok"], stats["found"]), (10, 10))
        # al día siguiente no repite lo ya comprobado (sigue con lo pendiente)
        nxt = live.plan(self.cfg, self.store, {}, TODAY + timedelta(days=1), 1000)
        self.assertEqual(len(nxt), 36 - 10)   # la verificada también era una de las 36
        self.assertFalse(set(jobs) & set(nxt))

    def test_every_night_in_range_and_progress(self):
        w = dict(VERANO, origins=["MAD"], destinations=["SCL"], stay={"type": "nights", "min": 12, "max": 16})
        cfg = config.clean({"watches": [w]})
        combos = live.narrow_combos(cfg["watches"][0], TODAY)
        self.assertEqual(len(combos), 3 * 5)                       # 3 días × 12..16 noches
        self.assertIn(("MAD", "SCL", "2027-07-09", "2027-07-24", 1), combos)   # 15 noches
        live.run(FakeGoogle(), self.store, combos[:6], workers=1, pause=0)
        self.assertEqual(live.progress(cfg["watches"][0], self.store, TODAY), {"done": 6, "total": 15})

    def test_stops_after_repeated_failures(self):
        jobs = live.plan(self.cfg, self.store, {}, TODAY, 1000)
        g = FakeGoogle(fail=True)
        stats = live.run(g, self.store, jobs, workers=1, pause=0)
        self.assertTrue(stats["stopped"])
        self.assertEqual(stats["failed"], live.MAX_FAILS)
        self.assertEqual(stats["ok"], 0)


class MergeTest(unittest.TestCase):
    def test_live_price_replaces_cached_and_removes_sold_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Store(os.path.join(tmp, "f.db"))
            s.replace_route("MAD", "SCL", "rt", [cached("2027-07-09", "2027-07-21", 520),
                                                 cached("2027-07-10", "2027-07-22", 480),
                                                 cached("2027-08-01", "2027-08-15", 610)], "x")
            s.save_live(("MAD", "SCL", "2027-07-09", "2027-07-21", 1), FakeGoogle().search(
                "MAD", "SCL", "2027-07-09", "2027-07-21"), "2026-11-25T06:00:00+00:00")
            s.save_live(("MAD", "SCL", "2027-07-10", "2027-07-22", 1), None, "2026-11-25T06:00:00+00:00")
            got = s.offers("MAD", "SCL", "rt", fresh_since="2026-11-21")
            self.assertEqual([(o["dep"], o["price"], bool(o.get("live"))) for o in got],
                             [("2027-07-09", 715.0, True), ("2027-08-01", 610, False)])
            # un precio en directo viejo ya no cuenta
            self.assertEqual(len(s.offers("MAD", "SCL", "rt", fresh_since="2026-11-26")), 3)


class BestOfferTest(unittest.TestCase):
    def test_picks_cheapest_and_counts_layover(self):
        seg = lambda d1, t1, d2, t2, dur: NS(departure=NS(date=d1, time=t1), arrival=NS(date=d2, time=t2), duration=dur)  # noqa: E731
        res = [NS(price=None, airlines=["X"], flights=[seg((2027, 7, 9), (8, 0), (2027, 7, 9), (20, 0), 600)]),
               NS(price=812, airlines=["Iberia"], flights=[seg((2027, 7, 9), (23, 55), (2027, 7, 10), (8, 40), 825)]),
               NS(price=705, airlines=["LATAM", "Iberia"],
                  flights=[seg((2027, 7, 9), (12, 5), (2027, 7, 9), (14, 0), 115),
                           seg((2027, 7, 9), (16, 0), (2027, 7, 10), (2, 0), 780)])]
        o = live.best_offer(res, "MAD", "SCL", "2027-07-09", "2027-07-21")
        self.assertEqual((o["price"], o["stops"], o["dep_time"], o["airline"]), (705.0, 1, "12:05", "LATAM + Iberia"))
        self.assertEqual(o["duration"], 115 + 120 + 780)
        self.assertIsNone(live.best_offer([], "MAD", "SCL", "2027-07-09", None))

    def test_city_codes_become_airports(self):
        self.assertEqual((live.airport("TCI"), live.airport("BUE"), live.airport("SCL")), ("TFN", "EZE", "SCL"))


class EndToEndLiveTest(unittest.TestCase):
    def test_empty_watch_gets_verified_prices_and_alert(self):
        from tracker import __main__ as cli
        with tempfile.TemporaryDirectory() as tmp:
            cfgp = os.path.join(tmp, "config.json")
            config.save({"watches": [VERANO]}, cfgp)
            sent = []
            fake = FakeGoogle()
            env = {"DB_PATH": os.path.join(tmp, "f.db"), "TRAVELPAYOUTS_TOKEN": "", "GITHUB_TOKEN": "",
                   "GMAIL_ADDRESS": "", "GMAIL_APP_PASSWORD": "", "LIVE_BUDGET": "1000"}
            # la «caché» no tiene nada para esas fechas (como pasa de verdad con julio de 2027)
            empty = type("Empty", (), {"name": "travelpayouts", "month": lambda self, *a, **k: []})()
            with mock.patch.dict(os.environ, env), mock.patch.object(config, "CONFIG_FILE", cfgp), \
                    mock.patch.object(cli, "get_provider", lambda token: empty), \
                    mock.patch.object(live, "get_searcher", lambda cur: (fake, None)), \
                    mock.patch.object(live, "run", lambda s, st, jobs: _run_fast(s, st, jobs)), \
                    mock.patch.object(alerts, "send", lambda deals, *a, **k: sent.append(deals) or {"sent": True}):
                out = os.path.join(tmp, "site")
                cli.update(out, today=TODAY)
                with open(os.path.join(out, "data", "site.json"), encoding="utf-8") as f:
                    site = json.load(f)
            s = site["watches"][0]["summary"]
            self.assertEqual(s["count"], 36)
            self.assertEqual(s["min"], 640)
            self.assertTrue(s["best"]["live"])
            self.assertEqual(site["scan"]["live"]["found"], 36)
            self.assertTrue(os.path.exists(os.path.join(out, "data", "routes", "MAD-SCL-rt.json")))
            # precio objetivo (≤ 730 €) y verificado -> aviso
            self.assertTrue(sent and sent[0][0][1]["live"])


_real_run = live.run


def _run_fast(searcher, store, jobs):
    return _real_run(searcher, store, jobs, workers=2, pause=0)


if __name__ == "__main__":
    unittest.main()
