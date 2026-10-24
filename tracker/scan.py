"""Descarga los precios de todas las rutas de tus seguimientos (en paralelo)."""
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone

from . import config as cfgmod
from .providers import ProviderError

log = logging.getLogger(__name__)
MAX_PER_ROUTE = 6000


def months_between(d0: date, d1: date):
    out, y, m = [], d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def plan(cfg: dict, today: date = None) -> dict:
    """{(origen, destino, viaje): {"months": set, "direct": bool}} a partir de los seguimientos."""
    today = today or date.today()
    routes = {}
    for w in cfg["watches"]:
        if not w["enabled"]:
            continue
        start, end = cfgmod.window(w, today)
        if start > end:
            continue
        ms = months_between(start, end)
        for o in w["origins"]:
            for d in w["destinations"]:
                if o == d:
                    continue
                r = routes.setdefault((o, d, w["trip"]), {"months": set(), "direct": False})
                r["months"].update(ms)
                r["direct"] |= w["stops"] == "direct"
    return routes


def _dedupe(offers):
    best = {}
    for o in offers:
        k = (o["dep"], o["ret"], o["stops"])
        if k not in best or o["price"] < best[k]["price"]:
            best[k] = o
    out = sorted(best.values(), key=lambda o: o["price"])[:MAX_PER_ROUTE]
    return sorted(out, key=lambda o: (o["dep"], o["price"]))


def run(provider, store, cfg: dict, today: date = None, workers: int = 4, pause: float = 0.25):
    """Escanea y guarda. Devuelve un resumen con rutas, ofertas y errores."""
    today = today or date.today()
    routes = plan(cfg, today)
    jobs = []
    for (o, d, trip), r in routes.items():
        for m in sorted(r["months"]):
            jobs.append((o, d, trip, m, False))
            if r["direct"]:
                jobs.append((o, d, trip, m, True))
    results, errors = {}, []
    t0 = time.time()

    def fetch(job):
        o, d, trip, m, direct = job
        if provider.name != "demo":
            time.sleep(pause)
        return job, provider.month(o, d, m, trip=trip, direct=direct, currency=cfg["currency"])

    with ThreadPoolExecutor(max_workers=workers if provider.name != "demo" else 1) as ex:
        futs = [ex.submit(fetch, j) for j in jobs]
        for f in as_completed(futs):
            try:
                (o, d, trip, m, direct), offers = f.result()
                results.setdefault((o, d, trip), []).extend(offers)
            except ProviderError as e:
                errors.append(str(e))
                if "401" in str(e):
                    for x in futs:
                        x.cancel()
                    break
            except Exception as e:  # noqa: BLE001 - una ruta que falla no para el resto
                errors.append(f"{e}")
    seen = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    n = 0
    for (o, d, trip) in routes:
        offers = [x for x in _dedupe(results.get((o, d, trip), [])) if x["dep"] > today.isoformat()]
        if offers or (o, d, trip) in results:
            store.replace_route(o, d, trip, offers, seen)
        n += len(offers)
    store.prune(today.isoformat(), routes.keys())
    return {"routes": len(routes), "requests": len(jobs), "offers": n, "errors": sorted(set(errors))[:20],
            "seconds": round(time.time() - t0, 1)}
