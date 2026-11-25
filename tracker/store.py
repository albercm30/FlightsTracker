"""Base de datos SQLite: ofertas actuales, histórico diario y avisos enviados.
En GitHub Actions se conserva entre ejecuciones con la caché (ver .github/workflows/update.yml)."""
import os
import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS offers (
    origin TEXT, destination TEXT, trip TEXT, dep TEXT, ret TEXT, price REAL, stops INTEGER,
    airline TEXT, duration INTEGER, dep_time TEXT, seen TEXT
);
CREATE INDEX IF NOT EXISTS idx_offers_route ON offers(origin, destination, trip);
CREATE TABLE IF NOT EXISTS watch_days (
    watch TEXT, day TEXT, min REAL, p10 REAL, median REAL, n INTEGER, PRIMARY KEY (watch, day)
);
CREATE TABLE IF NOT EXISTS alerts (watch TEXT, sig TEXT, price REAL, sent_at TEXT);
CREATE TABLE IF NOT EXISTS live (
    origin TEXT, destination TEXT, dep TEXT, ret TEXT, max_stops INTEGER, price REAL, stops INTEGER,
    airline TEXT, duration INTEGER, dep_time TEXT, checked TEXT,
    PRIMARY KEY (origin, destination, dep, ret, max_stops)
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


class Store:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.path = path
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    def rows(self, sql, params=()):
        with self.conn() as c:
            return [dict(r) for r in c.execute(sql, params)]

    def get(self, k, default=None):
        r = self.rows("SELECT v FROM meta WHERE k=?", (k,))
        return r[0]["v"] if r else default

    def set(self, k, v):
        with self.conn() as c:
            c.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", (k, str(v)))

    def reset_all(self):
        with self.conn() as c:
            for t in ("offers", "watch_days", "alerts", "live"):
                c.execute(f"DELETE FROM {t}")

    def replace_route(self, origin, destination, trip, offers, seen):
        with self.conn() as c:
            c.execute("DELETE FROM offers WHERE origin=? AND destination=? AND trip=?", (origin, destination, trip))
            c.executemany("INSERT INTO offers VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          [(origin, destination, trip, o["dep"], o["ret"], o["price"], o["stops"], o["airline"],
                            o["duration"], o["dep_time"], seen) for o in offers])

    def cached_offers(self, origin, destination, trip):
        """Solo la caché de Travelpayouts."""
        return self.rows("SELECT * FROM offers WHERE origin=? AND destination=? AND trip=? ORDER BY dep, price",
                         (origin, destination, trip))

    def offers(self, origin, destination, trip, fresh_since=None):
        """Caché + precios en directo (Google Flights). Lo comprobado en directo manda:
        quita de la caché las mismas fechas que Google ha confirmado (o que ya no tienen vuelos)."""
        cached = self.cached_offers(origin, destination, trip)
        sql = ("SELECT * FROM live WHERE origin=? AND destination=? AND " + ("ret IS NOT NULL" if trip == "rt" else "ret IS NULL")
               + (" AND checked >= ?" if fresh_since else ""))
        live = self.rows(sql, (origin, destination) + ((fresh_since,) if fresh_since else ()))
        if not live:
            return cached
        cover = {}
        for r in live:
            cover.setdefault((r["dep"], r["ret"]), []).append(r["max_stops"])
        out = [o for o in cached
               if not any(ms is None or o["stops"] <= ms for ms in cover.get((o["dep"], o["ret"]), []))]
        best = {}
        for r in live:
            if r["price"] is None:
                continue
            k = (r["dep"], r["ret"], r["stops"])
            if k not in best or r["price"] < best[k]["price"]:
                best[k] = {"origin": origin, "destination": destination, "trip": trip, "dep": r["dep"], "ret": r["ret"],
                           "price": r["price"], "stops": r["stops"], "airline": r["airline"] or "",
                           "duration": r["duration"], "dep_time": r["dep_time"], "seen": r["checked"],
                           "live": r["checked"]}
        return sorted(out + list(best.values()), key=lambda o: (o["dep"], o["price"]))

    def save_live(self, job, offer, checked):
        o, d, dep, ret, ms = job
        with self.conn() as c:
            c.execute("DELETE FROM live WHERE origin=? AND destination=? AND dep=? AND ret IS ? AND max_stops IS ?",
                      (o, d, dep, ret, ms))
            c.execute("INSERT INTO live VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                      (o, d, dep, ret, ms, offer["price"] if offer else None, offer["stops"] if offer else None,
                       offer["airline"] if offer else None, offer["duration"] if offer else None,
                       offer["dep_time"] if offer else None, checked))

    def _live_keys(self, where="", params=()):
        return {(r["origin"], r["destination"], r["dep"], r["ret"], r["max_stops"]): r["checked"]
                for r in self.rows("SELECT origin, destination, dep, ret, max_stops, checked FROM live " + where, params)}

    def live_checked_since(self, day):
        return set(self._live_keys("WHERE checked >= ?", (day,)))

    def live_last_checked(self):
        return self._live_keys()

    def live_stats(self, fresh_since):
        r = self.rows("SELECT COUNT(*) n, SUM(price IS NOT NULL) found FROM live WHERE checked >= ?", (fresh_since,))[0]
        return {"checked": r["n"] or 0, "found": r["found"] or 0}

    def prune(self, today: str, keep_routes):
        """Quita fechas pasadas y rutas que ya no sigues."""
        keep = set(keep_routes)
        with self.conn() as c:
            c.execute("DELETE FROM offers WHERE dep < ?", (today,))
            c.execute("DELETE FROM live WHERE dep < ? OR checked < date(?, '-10 day')", (today, today))
            for r in c.execute("SELECT DISTINCT origin, destination, trip FROM offers").fetchall():
                if tuple(r) not in keep:
                    c.execute("DELETE FROM offers WHERE origin=? AND destination=? AND trip=?", tuple(r))

    def save_day(self, watch, day, mn, p10, median, n):
        with self.conn() as c:
            c.execute("INSERT OR REPLACE INTO watch_days VALUES (?,?,?,?,?,?)", (watch, day, mn, p10, median, n))

    def history(self, watch):
        return self.rows("SELECT day, min, p10, median, n FROM watch_days WHERE watch=? ORDER BY day", (watch,))

    def last_alert(self, watch):
        r = self.rows("SELECT * FROM alerts WHERE watch=? ORDER BY sent_at DESC LIMIT 1", (watch,))
        return r[0] if r else None

    def add_alert(self, watch, sig, price, sent_at):
        with self.conn() as c:
            c.execute("INSERT INTO alerts VALUES (?,?,?,?)", (watch, sig, price, sent_at))
