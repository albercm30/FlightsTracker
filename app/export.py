"""Genera la web pública de solo lectura (para GitHub Pages u otro hosting estático).

    python -m app export site/

Usa la propia API de la app para producir ficheros JSON con exactamente el mismo
formato, y copia la interfaz en «modo estático» (sin ajustes, claves ni acciones).
Nunca publica tokens, contraseñas ni datos de notificaciones.
"""
import json
import os
import re
import shutil

from . import airlines, catalog, db, holidays
from . import create_app

PUBLIC_SETTINGS = ["origins", "currency", "trip_type", "min_nights", "max_nights", "passengers", "baggage",
                   "direct_only", "months_ahead", "holiday_region", "timezone", "min_days_ahead", "max_days_ahead"]


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def export_site(out_dir: str, site_title: str = None) -> dict:
    app = create_app(start_scheduler=False)
    c = app.test_client()
    with c.session_transaction() as sess:  # por si hay APP_PASSWORD
        sess["auth"] = True

    def get(url):
        r = c.get(url)
        if r.status_code != 200:
            raise RuntimeError(f"{url} -> {r.status_code}")
        return r.get_json()

    s = db.get_settings()
    # Los precios públicos se exportan sin descuento de residente: cada visitante lo activa si le corresponde
    saved_res = s.get("resident_discount", "")
    if saved_res:
        db.update_settings({"resident_discount": ""})
    from . import tracker
    tracker._resident_region.update(v="", t=0)
    try:
        return _export(out_dir, get, s, site_title)
    finally:
        if saved_res:
            db.update_settings({"resident_discount": saved_res})
        tracker._resident_region.update(t=0)


def _export(out_dir, get, s, site_title):
    static_src = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    shutil.copytree(static_src, os.path.join(out_dir, "static"),
                    ignore=shutil.ignore_patterns("index.html", "login.html", "sw.js", "push-sw.js", "manifest.webmanifest"))
    shutil.copy(os.path.join(static_src, "push-sw.js"), os.path.join(out_dir, "push-sw.js"))
    d = lambda *p: os.path.join(out_dir, "data", *p)  # noqa: E731

    status = get("/api/status")
    status.update(static=True, channels=[], live_check=False, next_run=None, unread_alerts=0, watches=0,
                  onboarded=True, auth=False, insecure=False,
                  progress={"running": False, "done": 0, "total": 0, "current": ""})
    last = status.get("last_scan") or {}
    status["last_scan"] = {k: last.get(k) for k in ("started_at", "finished_at", "status")}
    _write(d("status.json"), status)
    _write(d("settings.json"), {k: s.get(k) for k in PUBLIC_SETTINGS} | {"resident_discount": "", "onboarded": True})

    meta = get("/api/meta")
    meta["airline_policies"] = {k: {kk: vv for kk, vv in v.items()} for k, v in airlines.AIRLINES.items()}
    meta["theme_codes"] = {k: v["codes"] for k, v in catalog.THEMES.items()}
    from .tracker import RESIDENT_AIRPORTS, TAX_PER_LEG
    meta["resident_airports"] = {k: sorted(v) for k, v in RESIDENT_AIRPORTS.items()}
    meta["tax_per_leg"] = TAX_PER_LEG
    meta["vapid_public"] = s.get("vapid_public") or ""
    _write(d("meta.json"), meta)

    cat = get("/api/catalog?limit=1000")
    for city in cat:
        city["lat"], city["lon"] = catalog.COORDS.get(city["code"], (None, None))
    _write(d("catalog.json"), cat)
    _write(d("countries.json"), get("/api/catalog/countries"))

    dests = [x for x in get("/api/destinations") if x["enabled"]]
    _write(d("destinations.json"), dests)
    trips = db.trips(s)
    for t in trips:
        _write(d(f"deals-{t}.json"), get(f"/api/deals?trip={t}&limit=60"))
    _write(d("changes.json"), get("/api/changes?limit=30"))
    alerts = get("/api/alerts?limit=60")
    for a in alerts:
        a.pop("notified", None)
        a["read"] = 1
    _write(d("alerts.json"), alerts)
    for region in holidays.REGIONS:
        _write(d(f"holidays-{region or 'es'}.json"), get(f"/api/holidays?region={region}"))

    routes = 0
    for o in s.get("origins") or []:
        for dest in dests:
            if o == dest["code"]:
                continue
            for t in trips:
                cal = get(f"/api/calendar?origin={o}&destination={dest['code']}&trip={t}")
                if not cal["quotes"]:
                    continue
                keep = ("depart_date", "return_date", "nights", "price", "prev_price", "lowest_price", "airline",
                        "transfers", "return_transfers", "link", "updated_at", "level")
                cal["quotes"] = [{k: q.get(k) for k in keep if q.get(k) is not None} for q in cal["quotes"]]
                cal["slim"] = True
                _write(d("cal", f"{o}-{dest['code']}-{t}.json"), cal)
                _write(d("hist", f"{o}-{dest['code']}-{t}.json"),
                       get(f"/api/history?origin={o}&destination={dest['code']}&trip={t}"))
                routes += 1
    _write(d("routes.json"), {"routes": [f.rsplit(".", 1)[0] for f in sorted(os.listdir(d("cal")))]
                              if os.path.isdir(d("cal")) else []})

    # index.html en modo estático con rutas relativas (funciona en usuario.github.io/Repositorio/)
    html = open(os.path.join(static_src, "index.html"), encoding="utf-8").read()
    html = html.replace('href="/static/', 'href="static/').replace('src="/static/', 'src="static/')
    html = html.replace('href="/manifest.webmanifest"', 'href="manifest.webmanifest"')
    html = html.replace('<script src="static/js/core.js"></script>',
                        '<script>window.STATIC = true;</script>\n<script src="static/js/core.js"></script>')
    if site_title:
        html = re.sub(r"<title>.*?</title>", f"<title>{site_title}</title>", html)
    open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write(html)
    manifest = json.load(open(os.path.join(static_src, "manifest.webmanifest"), encoding="utf-8"))
    manifest.update(start_url="./", scope="./", name=site_title or manifest["name"])
    manifest["icons"] = [dict(i, src=i["src"].lstrip("/")) for i in manifest["icons"]]
    manifest["shortcuts"] = [dict(x, url="./" + x["url"].lstrip("/")) for x in manifest.get("shortcuts", [])]
    _write(os.path.join(out_dir, "manifest.webmanifest"), manifest)
    open(os.path.join(out_dir, ".nojekyll"), "w").close()
    return {"routes": routes, "destinations": len(dests), "out": out_dir}
