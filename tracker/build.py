"""Genera la web (GitHub Pages): la interfaz de /web + los datos en JSON."""
import json
import os
import re
import shutil
import time
from datetime import date, datetime, timezone

from . import __version__, airports

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(os.path.dirname(__file__), "data")


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def _slim(o):
    keys = ("origin", "destination", "dep", "ret", "price", "stops", "airline", "duration", "dep_time", "nights",
            "score", "discount", "top")
    return {k: (round(o[k], 3) if k == "discount" else o[k]) for k in keys if o.get(k) is not None}


def route_file(origin, destination, trip, offers):
    """Formato compacto: [días desde base, noches (-1 = solo ida), precio, escalas, aerolínea, duración, hora salida]."""
    base = min((o["dep"] for o in offers), default=date.today().isoformat())
    b = date.fromisoformat(base)
    als = sorted({o["airline"] or "" for o in offers})
    idx = {a: i for i, a in enumerate(als)}
    rows = []
    for o in offers:
        d = date.fromisoformat(o["dep"])
        n = (date.fromisoformat(o["ret"]) - d).days if o.get("ret") else -1
        t = o.get("dep_time") or ""
        rows.append([(d - b).days, n, round(o["price"]), o["stops"], idx[o["airline"] or ""], o.get("duration") or 0,
                     int(t[:2]) * 60 + int(t[3:5]) if len(t) >= 5 else -1])
    return {"o": origin, "d": destination, "trip": trip, "base": base, "airlines": als, "rows": rows}


def build(out_dir, cfg, store, results, scan_info, provider_name, today=None):
    today = today or date.today()
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(WEB, out_dir)
    d = lambda *p: os.path.join(out_dir, "data", *p)  # noqa: E731
    os.makedirs(d("routes"), exist_ok=True)
    shutil.copy(os.path.join(DATA, "airports.json"), d("airports.json"))
    _write(d("airlines.json"), airports.AIRLINES)
    route_index = []
    for r in store.rows("SELECT DISTINCT origin, destination, trip FROM offers ORDER BY origin, destination, trip"):
        offers = store.offers(r["origin"], r["destination"], r["trip"])
        key = f"{r['origin']}-{r['destination']}-{r['trip']}"
        _write(d("routes", key + ".json"), route_file(r["origin"], r["destination"], r["trip"], offers))
        route_index.append({"o": r["origin"], "d": r["destination"], "trip": r["trip"], "n": len(offers),
                            "min": min((o["price"] for o in offers), default=None)})
    watches = []
    for w in cfg["watches"]:
        res = results.get(w["id"]) or {}
        watches.append({**w, "summary": {
            k: (_slim(v) if k == "best" and v else [_slim(x) for x in v] if k == "top" else
                [{**x, "offer": _slim(x["offer"])} for x in v] if k == "destinations" else v)
            for k, v in res.items()}})
    tops = sorted((o | {"watch": w["id"], "watch_name": w["name"]} for w in watches
                   for o in (w["summary"].get("top") or []) if o.get("top")), key=lambda o: -o["score"])
    site = {
        "version": __version__,
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "today": today.isoformat(),
        "provider": provider_name,
        "currency": cfg["currency"],
        "repo": os.environ.get("GITHUB_REPOSITORY", ""),
        "config": cfg,
        "scan": scan_info,
        "routes": route_index,
        "watches": watches,
        "top_deals": tops[:12],
    }
    _write(d("site.json"), site)
    # versión en los ficheros: el navegador nunca mezcla ficheros viejos con nuevos
    idx = os.path.join(out_dir, "index.html")
    with open(idx, encoding="utf-8") as f:
        html = f.read()
    ver = f"{__version__}-{int(time.time())}"
    html = re.sub(r'((?:src|href)="(?:css|js)/[^"?]+)"', rf'\1?v={ver}"', html)
    with open(idx, "w", encoding="utf-8") as f:
        f.write(html)
    open(os.path.join(out_dir, ".nojekyll"), "w").close()
    return {"routes": len(route_index), "watches": len(watches), "top_deals": len(tops)}
