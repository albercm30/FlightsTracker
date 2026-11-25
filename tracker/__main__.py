"""Comandos (los ejecuta GitHub Actions; no hace falta usarlos a mano):

    python -m tracker update [carpeta]   -> busca precios, analiza, avisa de chollos y genera la web
    python -m tracker test-alert         -> te envía un aviso de prueba con el mejor chollo actual
    python -m tracker apply-config       -> guarda en config.json los cambios enviados desde la web
    python -m tracker demo [carpeta]     -> genera la web con precios simulados (para probar)
"""
import json
import logging
import os
import sys
from datetime import date, datetime, timezone

from . import alerts, analysis, build, config, live, scan
from .providers import Demo, get_provider
from .store import Store

log = logging.getLogger("tracker")


def site_url():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return ""
    owner, name = repo.split("/", 1)
    return f"https://{owner}.github.io/{name}/"


def summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)


def update(out_dir="site", demo=False, send=True, test_alert=False, today=None):
    today = today or date.today()
    cfg = config.load()
    store = Store(os.environ.get("DB_PATH", "data/flights.db"))
    provider = Demo() if demo else get_provider(os.environ.get("TRAVELPAYOUTS_TOKEN", ""))
    prev = store.get("provider")
    if prev and prev != provider.name:
        store.reset_all()      # no mezclar precios simulados con reales
    store.set("provider", provider.name)
    info = scan.run(provider, store, cfg, today)
    # precios en directo de Google Flights: verifica los mejores y rellena lo que la caché no tiene
    searcher, why = (None, "modo demo") if demo else live.get_searcher(cfg["currency"])
    info["live"] = None
    info["live_off"] = why
    if searcher:
        jobs = live.plan(cfg, store, live.cached_matches(cfg, store, today), today,
                         int(os.environ.get("LIVE_BUDGET", "800")))
        info["live"] = live.run(searcher, store, jobs)
    fresh = live.fresh_since(today)
    live_ok = bool(info["live"] and info["live"]["ok"])
    if info["live"] is not None:
        info["live"].update(store.live_stats(fresh))
    results = {}
    for w in cfg["watches"]:
        if not w["enabled"]:
            continue
        offers = []
        for o in w["origins"]:
            for d in w["destinations"]:
                offers += store.offers(o, d, w["trip"], fresh_since=fresh)
        res = analysis.analyze(w, offers, store.history(w["id"]), cfg["alerts"], today)
        if res["count"]:
            store.save_day(w["id"], today.isoformat(), res["min"], res["p10"], res["median"], res["count"])
        res["history"] = store.history(w["id"])[-120:]
        res["live_progress"] = live.progress(w, store, today) if info["live"] is not None else None
        results[w["id"]] = res
    sent = {"sent": False}
    if send or test_alert:
        deals = []
        for w in cfg["watches"]:
            res = results.get(w["id"])
            if not res:
                continue
            o = analysis.alert_candidate(res, store, w, cfg["alerts"], today, require_live=live_ok) if not test_alert else (res.get("top") or [None])[0]
            if o:
                if test_alert and not o.get("top"):
                    o["top"] = "chollo"
                deals.append((w, o))
        deals.sort(key=lambda x: -x[1]["score"])
        if test_alert:
            deals = deals[:1]
        try:
            sent = alerts.send(deals[:6], site_url(), cfg["currency"], test=test_alert)
            if sent.get("sent") and not test_alert:
                now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                for w, o in deals[:6]:
                    store.add_alert(w["id"], f"{o['origin']}-{o['destination']}-{o['dep']}-{o.get('ret')}", o["price"], now)
        except Exception as e:  # noqa: BLE001
            sent = {"sent": False, "error": str(e)}
    info["alerts"] = sent
    b = build.build(out_dir, cfg, store, results, info, provider.name, today)
    lines = [f"## ✈️ Flight Tracker · {today.isoformat()}", "",
             f"**Precios:** {'reales (Travelpayouts)' if provider.name == 'travelpayouts' else 'SIMULADOS (falta TRAVELPAYOUTS_TOKEN)'}",
             f"**Rutas:** {info['routes']} · **peticiones:** {info['requests']} · **ofertas:** {info['offers']} · "
             f"**tiempo:** {info['seconds']} s · **chollos top:** {b['top_deals']} · **aviso:** {sent}", ""]
    lv = info["live"]
    if lv is None:
        lines += [f"**Google Flights (en directo):** ⚠️ no funciona: {info.get('live_off')}", ""]
    else:
        lines += [f"**Google Flights (en directo):** {lv['ok']}/{lv['planned']} búsquedas OK · {lv['found']} con vuelos · "
                  f"{lv['none']} sin vuelos · {lv['failed']} fallos · {lv['seconds']} s"
                  + (" · ⚠️ parado por demasiados fallos" if lv["stopped"] else ""), ""]
        if lv["errors"]:
            lines += ["<details><summary>Fallos de Google Flights</summary>", ""] + [f"- {e}" for e in lv["errors"]] + ["</details>", ""]
    for w in cfg["watches"]:
        r = results.get(w["id"])
        if r and r.get("best"):
            o = r["best"]
            lines.append(f"- **{w['name']}**: desde {round(o['price'])} € ({o['origin']}→{o['destination']} {o['dep']})")
    if info["errors"]:
        lines += ["", "<details><summary>Errores</summary>", ""] + [f"- {e}" for e in info["errors"]] + ["</details>"]
    summary("\n".join(lines))
    if info["errors"] and not info["offers"]:
        sys.exit(1)


def apply_config():
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
        event = json.load(f)
    body = (event.get("issue") or {}).get("body") or ""
    cfg = config.from_issue(body)
    config.save(cfg)
    print(json.dumps(cfg, ensure_ascii=False, indent=1))


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(message)s")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    out = sys.argv[2] if len(sys.argv) > 2 else "site"
    if cmd == "update":
        update(out, send=os.environ.get("SEND_ALERTS", "1") == "1")
    elif cmd == "test-alert":
        update(out, test_alert=True)
    elif cmd == "demo":
        update(out, demo=True, send=False)
    elif cmd == "apply-config":
        apply_config()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
