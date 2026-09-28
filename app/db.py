"""Base de datos SQLite (sin dependencias externas), migraciones y ajustes."""
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

_lock = threading.RLock()
_db_path = None

# trip: "ow" = solo ida, "rt" = ida y vuelta
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
-- Precio actual (más barato) por ruta, tipo de viaje y día de salida
CREATE TABLE IF NOT EXISTS quotes (
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    trip         TEXT NOT NULL DEFAULT 'ow',
    depart_date  TEXT NOT NULL,
    return_date  TEXT,
    nights       INTEGER,
    price        REAL NOT NULL,
    prev_price   REAL,
    lowest_price REAL,
    airline      TEXT,
    transfers    INTEGER,
    return_transfers INTEGER,
    duration     INTEGER,
    return_duration INTEGER,
    dep_time     TEXT,
    ret_time     TEXT,
    link         TEXT,
    provider     TEXT,
    first_seen   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (origin, destination, trip, depart_date)
);
CREATE INDEX IF NOT EXISTS idx_quotes_dest ON quotes(destination, trip, price);
CREATE TABLE IF NOT EXISTS route_stats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    trip         TEXT NOT NULL DEFAULT 'ow',
    scanned_at   TEXT NOT NULL,
    min_price    REAL,
    median_price REAL,
    count        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stats_route ON route_stats(origin, destination, trip, scanned_at);
CREATE TABLE IF NOT EXISTS quote_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    trip         TEXT NOT NULL DEFAULT 'ow',
    depart_date  TEXT NOT NULL,
    price        REAL NOT NULL,
    prev_price   REAL,
    seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qh_route ON quote_history(origin, destination, trip, depart_date, seen_at);
CREATE INDEX IF NOT EXISTS idx_qh_seen ON quote_history(seen_at);
CREATE TABLE IF NOT EXISTS watches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    trip         TEXT NOT NULL DEFAULT 'ow',
    depart_date  TEXT NOT NULL,
    return_date  TEXT NOT NULL DEFAULT '',
    target_price REAL,
    last_price   REAL,
    note         TEXT,
    created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_unique ON watches(origin, destination, trip, depart_date, return_date);
CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    origin       TEXT NOT NULL,
    destination  TEXT NOT NULL,
    trip         TEXT NOT NULL DEFAULT 'ow',
    depart_date  TEXT NOT NULL,
    return_date  TEXT,
    price        REAL NOT NULL,
    ref_price    REAL,
    message      TEXT,
    link         TEXT,
    airline      TEXT,
    notified     INTEGER NOT NULL DEFAULT 0,
    read         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_route ON alerts(origin, destination, trip, depart_date);
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

# Ajustes por defecto. Los que tienen variable de entorno se precargan desde ella la primera vez.
DEFAULT_SETTINGS = {
    "origins": ["MAD", "BCN"],
    "currency": "eur",
    "provider": "auto",            # auto | travelpayouts | demo
    "travelpayouts_token": "",
    "trip_type": "both",           # ow | rt | both  (qué vigilan los escaneos automáticos)
    "min_nights": 3,               # ida y vuelta: estancia mínima
    "max_nights": 10,              # ida y vuelta: estancia máxima
    "passengers": 1,
    "baggage": "personal",         # personal | cabin | checked | cabin_checked
    "direct_only": False,
    "months_ahead": 12,
    "scan_interval_hours": 6,
    "request_delay_s": 0.5,
    "min_days_ahead": 14,          # solo avisar de vuelos que salen dentro de >= N días
    "max_days_ahead": 365,
    "alert_level": "muy_buena",    # excepcional | muy_buena | buena: qué merece un aviso
    "alert_drops": False,          # avisar también de simples bajadas de precio (normalmente no)
    "drop_pct": 15,
    "deal_pct": 30,                # (heredado; ahora manda alert_level)
    "realert_pct": 10,             # repetir aviso de un destino solo si baja otro X %
    "realert_days": 14,            # ... dentro de estos días
    "max_alerts_per_route": 1,     # (heredado) máx. 1 aviso por destino y escaneo
    # filtros por defecto de los escaneos (como en Skyscanner)
    "max_stops": -1,               # -1 cualquiera | 0 directo | 1 | 2
    "max_duration_h": 0,           # 0 = sin límite (duración de cada trayecto)
    "dep_windows": "",             # franjas de salida: "night,morning,afternoon,evening" ("" = todas)
    "exclude_airlines": [],
    "notify_max_items": 10,
    "watch_change_pct": 3,
    "search_cache_hours": 3,
    "holiday_region": "",
    "resident_discount": "",       # "" | canarias | baleares  (75 % en vuelos nacionales)
    "quiet_hours": "",             # p. ej. "23-8": sin avisos por la noche (se envían después)
    "timezone": "Europe/Madrid",
    "site_url": "",                # dirección de tu web (enlace en los emails)
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_user": "",
    "smtp_password": "",
    "smtp_from": "",
    "email_to": "",
}

ENV_MAP = {
    "travelpayouts_token": "TRAVELPAYOUTS_TOKEN",
    "smtp_host": "SMTP_HOST",
    "smtp_port": "SMTP_PORT",
    "smtp_user": "SMTP_USER",
    "smtp_password": "SMTP_PASSWORD",
    "smtp_from": "SMTP_FROM",
    "email_to": "EMAIL_TO",
    "provider": "PRICE_PROVIDER",
    "holiday_region": "HOLIDAY_REGION",
    "timezone": "TZ",
    "resident_discount": "RESIDENT_DISCOUNT",
    "trip_type": "TRIP_TYPE",
    "min_nights": "MIN_NIGHTS",
    "max_nights": "MAX_NIGHTS",
    "passengers": "PASSENGERS",
    "baggage": "BAGGAGE",
    "quiet_hours": "QUIET_HOURS",
    "months_ahead": "MONTHS_AHEAD",
    "site_url": "SITE_URL",
    "direct_only": "DIRECT_ONLY",
    "deal_pct": "DEAL_PCT",
    "min_days_ahead": "MIN_DAYS_AHEAD",
    "max_days_ahead": "MAX_DAYS_AHEAD",
    "alert_level": "ALERT_LEVEL",
    "alert_drops": "ALERT_DROPS",
    "max_stops": "MAX_STOPS",
    "max_duration_h": "MAX_DURATION_H",
    "dep_windows": "DEP_WINDOWS",
    "exclude_airlines": "EXCLUDE_AIRLINES",
}

SECRET_KEYS = {"travelpayouts_token", "smtp_password"}
CHOICES = {
    "trip_type": {"ow", "rt", "both"},
    "baggage": {"personal", "cabin", "checked", "cabin_checked"},
    "provider": {"auto", "travelpayouts", "demo"},
    "currency": {"eur", "usd", "gbp"},
    "resident_discount": {"", "canarias", "baleares"},
    "alert_level": {"excepcional", "muy_buena", "buena"},
    "max_stops": {-1, 0, 1, 2},
}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _columns(c, table):
    return {r[1] for r in c.execute(f"PRAGMA table_info({table})")}


def _migrate(c):
    """Actualiza bases de datos de versiones anteriores sin perder lo importante."""
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # v1 -> v2: quotes sin columna trip (es caché: se recrea y se vuelve a llenar en el próximo escaneo)
    if "quotes" in tables and "trip" not in _columns(c, "quotes"):
        c.execute("DROP TABLE quotes")
    if "watches" in tables and "trip" not in _columns(c, "watches"):
        c.execute("ALTER TABLE watches RENAME TO watches_v1")
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table, cols in {
        "route_stats": {"trip": "TEXT NOT NULL DEFAULT 'ow'"},
        "quote_history": {"trip": "TEXT NOT NULL DEFAULT 'ow'"},
        "alerts": {"trip": "TEXT NOT NULL DEFAULT 'ow'", "airline": "TEXT"},
        "quotes": {"duration": "INTEGER", "return_duration": "INTEGER", "dep_time": "TEXT", "ret_time": "TEXT"},
    }.items():
        if table in tables:
            have = _columns(c, table)
            for col, ddl in cols.items():
                if col not in have:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    # índices antiguos sin trip
    c.execute("DROP INDEX IF EXISTS idx_stats_route")
    c.execute("DROP INDEX IF EXISTS idx_qh_route")
    c.execute("DROP INDEX IF EXISTS idx_alerts_route")


def _post_migrate(c):
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "watches_v1" in tables:
        c.execute("INSERT OR IGNORE INTO watches(origin, destination, trip, depart_date, return_date, target_price, "
                  "last_price, created_at) SELECT origin, destination, 'ow', depart_date, '', target_price, "
                  "last_price, created_at FROM watches_v1")
        c.execute("DROP TABLE watches_v1")
    # ajuste antiguo one_way -> trip_type
    r = c.execute("SELECT value FROM settings WHERE key='one_way'").fetchone()
    if r is not None:
        try:
            one_way = json.loads(r[0])
        except ValueError:
            one_way = True
        c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('trip_type', ?)",
                  (json.dumps("ow" if one_way else "rt"),))
        c.execute("DELETE FROM settings WHERE key='one_way'")
        c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('onboarded', 'true')")
    # v4: avisos menos insistentes (solo si el usuario no los había cambiado)
    if not c.execute("SELECT 1 FROM settings WHERE key='_v4'").fetchone():
        c.execute("UPDATE settings SET value='10' WHERE key='realert_pct' AND value='5'")
        c.execute("UPDATE settings SET value='1' WHERE key='max_alerts_per_route' AND value='3'")
        c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('_v4', 'true')")


def init(path: str):
    global _db_path
    _db_path = path
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with connect() as c:
        _migrate(c)
        c.executescript(SCHEMA)
        _post_migrate(c)
        existing = {r["key"] for r in c.execute("SELECT key FROM settings")}
        for k, v in DEFAULT_SETTINGS.items():
            if k in existing:
                continue
            env = os.environ.get(ENV_MAP.get(k, ""), "") if k in ENV_MAP else ""
            if env:
                if isinstance(v, bool):
                    v = env.strip().lower() in ("1", "true", "yes", "on", "si", "sí")
                elif isinstance(v, int):
                    v = int(float(env))
                elif isinstance(v, list):
                    v = [x.strip().upper() for x in env.split(",") if x.strip()]
                else:
                    v = env
            c.execute("INSERT INTO settings(key, value) VALUES (?, ?)", (k, json.dumps(v)))
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


def apply_env_config():
    """Modo «configuración por variables de entorno» (p. ej. GitHub Actions): aplica en cada
    arranque los ajustes definidos en el entorno y sincroniza DESTINATIONS con la lista."""
    if os.environ.get("GITHUB_ACTIONS"):
        # En GitHub la configuración ES la de las variables/secrets: lo que no esté, vuelve al valor por defecto
        # (así, si quitas un filtro desde la web, deja de aplicarse aunque la base de datos venga de la caché)
        vals = {k: os.environ.get(e) or DEFAULT_SETTINGS[k] for k, e in ENV_MAP.items()}
    else:
        vals = {k: os.environ[e] for k, e in ENV_MAP.items() if os.environ.get(e)}
    if os.environ.get("ORIGINS"):
        vals["origins"] = os.environ["ORIGINS"]
    if vals:
        update_settings(vals)
    codes = [c.strip().upper() for c in os.environ.get("DESTINATIONS", "").split(",") if c.strip()]
    if codes:
        from . import catalog
        with connect() as c:
            for code in codes:
                info = catalog.info(code)
                c.execute("INSERT OR IGNORE INTO destinations(code, name, country, enabled, created_at) "
                          "VALUES (?,?,?,1,?)", (code, info["name"], info["country"], now_iso()))
            c.execute(f"UPDATE destinations SET enabled = CASE WHEN code IN ({','.join('?' * len(codes))}) "
                      "THEN 1 ELSE 0 END", codes)


# ---------------- Ajustes ----------------
def get_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    for r in rows("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'"):
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
            if k in SECRET_KEYS and isinstance(v, str) and v.startswith("••••"):
                continue  # el cliente devuelve el secreto enmascarado: no lo pisamos
            default = DEFAULT_SETTINGS[k]
            try:
                if isinstance(default, bool):
                    v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes", "on", "si", "sí")
                elif isinstance(default, int):
                    v = int(float(v))
                elif isinstance(default, float):
                    v = float(v)
                elif isinstance(default, list):
                    if isinstance(v, str):
                        v = [x.strip().upper() for x in v.split(",") if x.strip()]
                    v = list(dict.fromkeys(str(x).strip().upper() for x in v if str(x).strip()))
                else:
                    v = "" if v is None else str(v).strip()
            except (TypeError, ValueError):
                v = current[k]
            if k in CHOICES and v not in CHOICES[k]:
                v = current[k]
            c.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, json.dumps(v)))
    s = get_settings()
    if s["min_nights"] > s["max_nights"]:
        update_settings({"max_nights": s["min_nights"]})
        s = get_settings()
    return s


def public_settings() -> dict:
    s = get_settings()
    for k in SECRET_KEYS:
        v = s.get(k) or ""
        s[k] = ("••••" + v[-4:]) if v else ""
    return s


def trips(settings: dict):
    t = settings.get("trip_type", "both")
    return ["ow", "rt"] if t == "both" else [t]
