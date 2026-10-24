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
            for t in ("offers", "watch_days", "alerts"):
                c.execute(f"DELETE FROM {t}")

    def replace_route(self, origin, destination, trip, offers, seen):
        with self.conn() as c:
            c.execute("DELETE FROM offers WHERE origin=? AND destination=? AND trip=?", (origin, destination, trip))
            c.executemany("INSERT INTO offers VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          [(origin, destination, trip, o["dep"], o["ret"], o["price"], o["stops"], o["airline"],
                            o["duration"], o["dep_time"], seen) for o in offers])

    def offers(self, origin, destination, trip):
        return self.rows("SELECT * FROM offers WHERE origin=? AND destination=? AND trip=? ORDER BY dep, price",
                         (origin, destination, trip))

    def prune(self, today: str, keep_routes):
        """Quita fechas pasadas y rutas que ya no sigues."""
        keep = set(keep_routes)
        with self.conn() as c:
            c.execute("DELETE FROM offers WHERE dep < ?", (today,))
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
