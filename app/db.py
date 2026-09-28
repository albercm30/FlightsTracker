"""Base de datos SQLite (sin dependencias externas) y gestión de ajustes."""
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

_lock = threading.RLock()
_db_path = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS destinations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    country     TEXT DEFAULT '',
    max_price   REAL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);
-- Precio actual (más barato) por ruta y día de salida
CREATE TABLE IF NOT EXISTS quotes (
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    depart_date  TEXT NOT NULL,
    return_date  TEXT,
    price        REAL NOT NULL,
    prev_price   REAL,
    lowest_price REAL,
    airline      TEXT,
    transfers    INTEGER,
    link         TEXT,
    provider     TEXT,
    first_seen   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (origin, destination, depart_date)
);
CREATE INDEX IF NOT EXISTS idx_quotes_dest ON quotes(destination, price);
-- Resumen por ruta en cada escaneo (para el histórico)
CREATE TABLE IF NOT EXISTS route_stats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    scanned_at   TEXT NOT NULL,
    min_price    REAL,
    median_price REAL,
    count        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stats_route ON route_stats(origin, destination, scanned_at);
CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    depart_date  TEXT NOT NULL,
    return_date  TEXT,
    price        REAL NOT NULL,
    ref_price    REAL,
    message      TEXT,
    link         TEXT,
    notified     INTEGER NOT NULL DEFAULT 0,
    read         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_route ON alerts(origin, destination, depart_date);
-- Cada cambio de precio observado (histórico propio, crece desde el primer escaneo)
CREATE TABLE IF NOT EXISTS quote_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    depart_date  TEXT NOT NULL,
    price        REAL NOT NULL,
    prev_price   REAL,
    seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qh_route ON quote_history(origin, destination, depart_date, seen_at);
CREATE INDEX IF NOT EXISTS idx_qh_seen ON quote_history(seen_at);
-- Vuelos concretos vigilados ("avísame si este día sube o baja")
CREATE TABLE IF NOT EXISTS watches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    depart_date  TEXT NOT NULL,
    target_price REAL,
    last_price   REAL,
    created_at   TEXT NOT NULL,
    UNIQUE(origin, destination, depart_date)
);
CREATE TABLE IF NOT EXISTS scans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL,
    provider     TEXT,
    routes       INTEGER DEFAULT 0,
    quotes       INTEGER DEFAULT 0,
    alerts       INTEGER DEFAULT 0,
    error        TEXT
);
"""

# Ajustes por defecto. Los que tienen variable de entorno se precargan desde ella
# la primera vez (útil para no escribir secretos en la interfaz).
DEFAULT_SETTINGS = {
    "origins": ["MAD", "BCN"],
    "currency": "eur",
    "provider": "auto",            # auto | travelpayouts | demo
    "travelpayouts_token": "",
    "travelpayouts_marker": "",
    "serpapi_key": "",              # opcional: precio en vivo + histórico de Google Flights
    "one_way": True,
    "direct_only": False,
    "months_ahead": 12,
    "scan_interval_hours": 6,
    "request_delay_s": 0.5,
    "min_days_ahead": 14,           # solo avisar de vuelos que salen dentro de >= N días
    "max_days_ahead": 365,
    "drop_pct": 15,                 # bajada mínima respecto al precio anterior
    "deal_pct": 30,                 # % por debajo de la mediana de la ruta = chollo
    "realert_pct": 5,               # volver a avisar solo si baja otro X %
    "max_alerts_per_route": 3,
    "notify_max_items": 10,
    "watch_change_pct": 3,          # avisar si un vuelo vigilado cambia >= X %
    "search_cache_hours": 3,        # el buscador reutiliza precios más recientes que esto
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "ntfy_server": "https://ntfy.sh",
    "ntfy_topic": "",
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_user": "",
    "smtp_password": "",
    "smtp_from": "",
    "email_to": "",
}

ENV_MAP = {
    "travelpayouts_token": "TRAVELPAYOUTS_TOKEN",
    "travelpayouts_marker": "TRAVELPAYOUTS_MARKER",
    "serpapi_key": "SERPAPI_KEY",
    "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
    "telegram_chat_id": "TELEGRAM_CHAT_ID",
    "ntfy_topic": "NTFY_TOPIC",
    "ntfy_server": "NTFY_SERVER",
    "smtp_host": "SMTP_HOST",
    "smtp_port": "SMTP_PORT",
    "smtp_user": "SMTP_USER",
    "smtp_password": "SMTP_PASSWORD",
    "smtp_from": "SMTP_FROM",
    "email_to": "EMAIL_TO",
    "provider": "PRICE_PROVIDER",
}

SECRET_KEYS = {"travelpayouts_token", "serpapi_key", "telegram_bot_token", "smtp_password"}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init(path: str):
    global _db_path
    _db_path = path
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with connect() as c:
        c.executescript(SCHEMA)
        existing = {r["key"] for r in c.execute("SELECT key FROM settings")}
        for k, v in DEFAULT_SETTINGS.items():
            if k in existing:
                continue
            env = os.environ.get(ENV_MAP.get(k, ""), "") if k in ENV_MAP else ""
            if env:
                v = type(v)(env) if isinstance(v, int) and not isinstance(v, bool) else env
            c.execute("INSERT INTO settings(key, value) VALUES (?, ?)", (k, json.dumps(v)))
        # Si ORIGINS viene por entorno la primera vez
        if "origins" not in existing and os.environ.get("ORIGINS"):
            origins = [o.strip().upper() for o in os.environ["ORIGINS"].split(",") if o.strip()]
            c.execute("UPDATE settings SET value=? WHERE key='origins'", (json.dumps(origins),))


@contextmanager
def connect():
    with _lock:
        conn = sqlite3.connect(_db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def rows(sql, params=()):
    with connect() as c:
        return [dict(r) for r in c.execute(sql, params)]


def one(sql, params=()):
    with connect() as c:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None


def execute(sql, params=()):
    with connect() as c:
        cur = c.execute(sql, params)
        return cur.lastrowid


# ---------------- Ajustes ----------------
def get_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    for r in rows("SELECT key, value FROM settings"):
        try:
            s[r["key"]] = json.loads(r["value"])
        except (TypeError, ValueError):
            s[r["key"]] = r["value"]
    return s


def update_settings(values: dict) -> dict:
    current = get_settings()
    with connect() as c:
        for k, v in values.items():
            if k not in DEFAULT_SETTINGS:
                continue
            # Si el cliente devuelve el secreto enmascarado, no lo sobrescribimos
            if k in SECRET_KEYS and isinstance(v, str) and v.startswith("••••"):
                continue
            default = DEFAULT_SETTINGS[k]
            try:
                if isinstance(default, bool):
                    v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes", "on", "si", "sí")
                elif isinstance(default, int):
                    v = int(v)
                elif isinstance(default, float):
                    v = float(v)
                elif isinstance(default, list):
                    if isinstance(v, str):
                        v = [x.strip().upper() for x in v.split(",") if x.strip()]
                    v = [str(x).strip().upper() for x in v if str(x).strip()]
                else:
                    v = "" if v is None else str(v).strip()
            except (TypeError, ValueError):
                v = current[k]
            c.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )
    return get_settings()


def public_settings() -> dict:
    """Ajustes para la interfaz, con los secretos enmascarados."""
    s = get_settings()
    for k in SECRET_KEYS:
        v = s.get(k) or ""
        s[k] = ("••••" + v[-4:]) if v else ""
    return s
