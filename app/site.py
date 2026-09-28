"""Genera tu web (GitHub Pages): la interfaz + los datos en JSON.

    python -m app export site/

La web no tiene servidor: lee estos ficheros y hace las búsquedas en el navegador.
Nunca se publican claves ni contraseñas (esas viven como *secrets* de GitHub).
"""
import json
import os
import re
import shutil
import statistics
from datetime import date

from . import __version__, airlines, catalog, db, holidays, tracker
from .providers import booking_links, get_provider

SETTINGS_KEYS = ["origins", "currency", "trip_type", "min_nights", "max_nights", "passengers", "baggage",
                 "direct_only", "months_ahead", "holiday_region", "min_days_ahead", "max_days_ahead",
                 "resident_discount", "alert_level", "alert_drops", "max_stops", "max_duration_h", "dep_windows",
                 "exclude_airlines", "quiet_hours", "timezone"]
QUOTE_KEYS = ("depart_date", "return_date", "nights", "price", "prev_price", "lowest_price", "airline", "transfers",
              "return_transfers", "duration", "return_duration", "dep_time", "ret_time", "link", "updated_at", "level")


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# datos (las mismas estructuras que usa la interfaz)
def status(s):
    last = db.one("SELECT started_at, finished_at, status FROM scans ORDER BY id DESC LIMIT 1")
    return {"version": __version__, "provider": get_provider(s).name, "origins": s["origins"], "trips": db.trips(s),
            "last_scan": last, "today": date.today().isoformat(),
            "quotes": db.one("SELECT COUNT(*) AS n FROM quotes")["n"],
            "destinations": db.one("SELECT COUNT(*) AS n FROM destinations WHERE enabled=1")["n"]}


def meta(s):
    return {
        "baggage_options": airlines.BAG_OPTIONS,
        "holiday_regions": holidays.REGIONS,
        "regions": catalog.REGIONS,
        "themes": {k: {"label": v["label"], "icon": v["icon"], "count": len(v["codes"])} for k, v in catalog.THEMES.items()},
        "theme_codes": {k: v["codes"] for k, v in catalog.THEMES.items()},
        "spain_origins": [catalog.info(c) for c in catalog.SPAIN_ORIGINS],
        "airlines": {k: v["name"] for k, v in airlines.AIRLINES.items()},
        "airline_policies": airlines.AIRLINES,
        "alert_levels": tracker.ALERT_LEVEL_LABELS,
        "windows": tracker.WINDOW_LABELS,
        "resident_airports": {k: sorted(v) for k, v in tracker.RESIDENT_AIRPORTS.items()},
        "tax_per_leg": tracker.TAX_PER_LEG,
        # tu repositorio: la web lo usa para guardar tus cambios (con tu clave de GitHub, que no se publica)
        "repo": os.environ.get("GITHUB_REPOSITORY") or os.environ.get("REPO", ""),
    }


def destinations():
    out = []
    for d in db.rows("SELECT code, name, country, max_price FROM destinations WHERE enabled=1 ORDER BY name"):
        info = catalog.info(d["code"])
        out.append({**d, "country_code": info.get("country_code", ""), "region": info.get("region", "")})
    return out


def calendar(origin, dest, trip, s):
    qs = db.rows("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=? ORDER BY depart_date",
                 (origin, dest, trip))
    prices = [q["price"] for q in qs]
    for q in qs:
        q["level"] = tracker.price_level(q["price"], prices)
    return {"origin": catalog.info(origin), "destination": catalog.info(dest), "trip": trip,
            "range": [min(prices), statistics.median(prices), max(prices)] if prices else None,
            "median": statistics.median(prices) if prices else None,
            "quotes": [{k: q[k] for k in QUOTE_KEYS if q.get(k) is not None} for q in qs]}


def history(origin, dest, trip):
    return db.rows("SELECT scanned_at, min_price, median_price, count FROM route_stats WHERE origin=? AND "
                   "destination=? AND trip=? ORDER BY scanned_at", (origin, dest, trip))


def alerts(limit=80):
    rows = db.rows("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,))
    for a in rows:
        a.pop("notified", None)
        a["links"] = booking_links(a["origin"], a["destination"], a["depart_date"], a.get("return_date"))
        a["kind_label"] = tracker.KIND_LABELS.get(a["kind"], a["kind"])
        info = catalog.info(a["destination"])
        a["dest_name"], a["dest_cc"], a["dest_region"] = info["name"], info.get("country_code", ""), info.get("region")
        a["airline_name"] = airlines.name(a.get("airline")) if a.get("airline") else ""
        a["savings"] = (1 - a["price"] / a["ref_price"]) if a.get("ref_price") else 0
        if a.get("return_date"):
            a["nights"] = (date.fromisoformat(a["return_date"]) - date.fromisoformat(a["depart_date"])).days
    return rows


# ---------------------------------------------------------------------------
def export_site(out_dir: str, site_title: str = None) -> dict:
    s = db.get_settings()
    # Los precios se publican sin descuento de residente: la web lo aplica según tus ajustes
    res = s.get("resident_discount", "")
    tracker._resident_region.update(v="", t=9e18)
    try:
        return _export(out_dir, s, site_title)
    finally:
        tracker._resident_region.update(v=res, t=0)


def _export(out_dir, s, site_title):
    static_src = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(static_src, os.path.join(out_dir, "static"), ignore=shutil.ignore_patterns("index.html",
                                                                                              "manifest.webmanifest"))
    d = lambda *p: os.path.join(out_dir, "data", *p)  # noqa: E731

    _write(d("status.json"), status(s))
    _write(d("settings.json"), {k: s.get(k) for k in SETTINGS_KEYS})
    _write(d("meta.json"), meta(s))
    cat = catalog.search("", 2000)
    for city in cat:
        city["lat"], city["lon"] = catalog.COORDS.get(city["code"], (None, None))
    _write(d("catalog.json"), cat)
    _write(d("countries.json"), catalog.countries())
    dests = destinations()
    _write(d("destinations.json"), dests)
    trips = db.trips(s)
    for t in trips:
        _write(d(f"deals-{t}.json"), tracker.current_deals(60, trip=t))
    _write(d("changes.json"), tracker.recent_changes(30))
    _write(d("alerts.json"), alerts())
    for region in holidays.REGIONS:
        _write(d(f"holidays-{region or 'es'}.json"), {"region": region, "items": holidays.upcoming(region)})

    routes = []
    for o in s.get("origins") or []:
        for dest in dests:
            if o == dest["code"]:
                continue
            for t in trips:
                cal = calendar(o, dest["code"], t, s)
                if not cal["quotes"]:
                    continue
                key = f"{o}-{dest['code']}-{t}"
                _write(d("cal", key + ".json"), cal)
                _write(d("hist", key + ".json"), history(o, dest["code"], t))
                routes.append(key)
    _write(d("routes.json"), {"routes": routes})

    # index.html con rutas relativas (funciona en usuario.github.io/Repositorio/)
    with open(os.path.join(static_src, "index.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace('href="/static/', 'href="static/').replace('src="/static/', 'src="static/')
    html = html.replace('href="/manifest.webmanifest"', 'href="manifest.webmanifest"')
    if site_title:
        html = re.sub(r"<title>.*?</title>", f"<title>{site_title}</title>", html)
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    with open(os.path.join(static_src, "manifest.webmanifest"), encoding="utf-8") as f:
        manifest = json.load(f)
    manifest.update(start_url="./", scope="./", name=site_title or manifest["name"])
    manifest["icons"] = [dict(i, src=i["src"].lstrip("/")) for i in manifest["icons"]]
    manifest.pop("shortcuts", None)
    _write(os.path.join(out_dir, "manifest.webmanifest"), manifest)
    open(os.path.join(out_dir, ".nojekyll"), "w").close()
    return {"routes": len(routes), "destinations": len(dests), "out": out_dir}
