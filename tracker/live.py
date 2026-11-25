"""Precios en directo de Google Flights (verificados el mismo día).

Travelpayouts solo da precios que otros han buscado hace poco en Aviasales (caché): para fechas lejanas o
rangos cortos suele no tener nada. Por eso, cada mañana se consulta Google Flights en directo para:

  1. **Verificar** los más baratos de cada seguimiento (el precio de la web pasa a ser el real de hoy).
  2. **Rellenar** los seguimientos de fechas concretas (p. ej. «salir del 9 al 11 de julio»), fecha a fecha.
  3. **Sondear** las rutas sin ningún precio en caché.

Se usa la librería «fast-flights» (lee la misma página que ves en google.com/travel/flights). No necesita
clave. Hay un tope diario de búsquedas (LIVE_BUDGET, 800 por defecto); lo que no cabe hoy se busca mañana
(se busca primero lo que lleva más días sin comprobar). Un precio en directo vale 5 días.
"""
import logging
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import fields
from datetime import date, datetime, timedelta, timezone

from . import analysis, config as cfgmod

log = logging.getLogger(__name__)

FRESH_DAYS = 5          # un precio en directo se da por bueno 5 días (luego se vuelve a comprobar)
VERIFY_PER_WATCH = 5    # los N más baratos de cada seguimiento se verifican cada día
NARROW_DAYS = 45        # seguimientos con un rango de salida de hasta 45 días: se buscan fecha a fecha
MAX_FAILS = 8           # si Google falla 8 veces seguidas, se para (y se sigue con Travelpayouts)

# Google Flights busca por aeropuerto: códigos de ciudad (varios aeropuertos) -> aeropuerto principal
AIRPORT = {
    "TCI": "TFN", "LON": "LHR", "PAR": "CDG", "ROM": "FCO", "MIL": "MXP", "STO": "ARN", "REK": "KEF",
    "BUH": "OTP", "MOW": "SVO", "IEV": "KBP", "NYC": "JFK", "CHI": "ORD", "WAS": "IAD", "ORL": "MCO",
    "HOU": "IAH", "YTO": "YYZ", "YMQ": "YUL", "BUE": "EZE", "RIO": "GIG", "SAO": "GRU", "TYO": "HND",
    "OSA": "KIX", "SEL": "ICN", "BJS": "PEK", "SHA": "PVG", "JKT": "CGK",
}
MAX_STOPS = {"direct": 0, "max1": 1, "any": None}


def airport(code):
    return AIRPORT.get(code, code)


class LiveError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Búsqueda en Google Flights
class GoogleFlights:
    name = "google"

    def __init__(self, currency="eur"):
        try:
            import fast_flights  # noqa: F401
        except ImportError as e:  # pragma: no cover - en GitHub se instala con requirements.txt
            raise LiveError(f"No se pudo cargar fast-flights: {e}") from e
        self.currency = currency.upper()

    def search(self, origin, destination, dep, ret=None, max_stops=None):
        """Vuelo más barato de Google Flights. Devuelve una oferta, None si no hay vuelos, o lanza LiveError."""
        from fast_flights import FlightQuery, FlightsNotFound, Passengers, Query, create_query, get_flights

        class SpainQuery(Query):  # precios como los ve alguien desde España
            def params(self):
                return {**super().params(), "gl": "ES"}

        legs = [FlightQuery(date=dep, from_airport=airport(origin), to_airport=airport(destination))]
        if ret:
            legs.append(FlightQuery(date=ret, from_airport=airport(destination), to_airport=airport(origin)))
        q = create_query(flights=legs, trip="round-trip" if ret else "one-way", seat="economy",
                         passengers=Passengers(adults=1), language="es", currency=self.currency,
                         max_stops=max_stops)
        q = SpainQuery(**{f.name: getattr(q, f.name) for f in fields(q)})
        try:
            res = get_flights(q)
        except FlightsNotFound:
            return None
        except Exception as e:  # noqa: BLE001 - página de bloqueo, consentimiento, cambios de Google…
            raise LiveError(f"{type(e).__name__}: {e}"[:200]) from e
        return best_offer(res, origin, destination, dep, ret)


def best_offer(results, origin, destination, dep, ret):
    """De la lista de fast-flights, el itinerario más barato como oferta del tracker."""
    best = None
    for f in results or []:
        if getattr(f, "price", None) in (None, 0) or not getattr(f, "flights", None):
            continue
        if best is None or f.price < best.price:
            best = f
    if best is None:
        return None
    segs = best.flights
    dur = sum(s.duration or 0 for s in segs)
    for a, b in zip(segs, segs[1:]):     # escalas: llegada y salida son en el mismo aeropuerto (misma hora local)
        try:
            t1 = datetime(*a.arrival.date, *a.arrival.time)
            t2 = datetime(*b.departure.date, *b.departure.time)
            dur += max(0, int((t2 - t1).total_seconds() // 60))
        except (TypeError, ValueError):
            pass
    h, m = segs[0].departure.time
    airlines = best.airlines or []
    return {"origin": origin, "destination": destination, "dep": dep, "ret": ret, "price": float(best.price),
            "stops": len(segs) - 1, "airline": airlines[0] if len(airlines) == 1 else " + ".join(airlines[:2]),
            "duration": dur or None, "dep_time": f"{h:02d}:{m:02d}"}


# ---------------------------------------------------------------------------
# Qué buscar hoy
def _nights_options(stay):
    t = stay["type"]
    if t == "weekend":
        return [2]
    if t == "long_weekend":
        return [3]
    lo, hi = stay["min"], stay["max"]
    return sorted({lo, (lo + hi) // 2, hi})


def _dep_days(w, start, end, step=1):
    d, out = start, []
    while d <= end:
        if w["stay"]["type"] == "weekend" and d.weekday() != 4:
            pass
        elif w["stay"]["type"] == "long_weekend" and d.weekday() not in (3, 4):
            pass
        elif w["weekdays"] and d.weekday() not in w["weekdays"]:
            pass
        else:
            out.append(d)
        d += timedelta(days=step)
    return out


def narrow_combos(w, today):
    """Todas las búsquedas de un seguimiento de fechas concretas: cada día de salida × cada nº de noches ×
    cada origen × cada destino. Vacío si el rango de salida es largo (> NARROW_DAYS)."""
    start, end = cfgmod.window(w, today)
    if start > end or (end - start).days > NARROW_DAYS:
        return []
    ms = MAX_STOPS[w["stops"]]
    st = w["stay"]
    if w["trip"] != "rt":
        nights = [None]
    elif st["type"] == "nights":
        nights = list(range(st["min"], st["max"] + 1))     # todas: 12, 13, 14, 15, 16…
    else:
        nights = _nights_options(st)
    out = []
    # orden: primero todos los destinos de la primera fecha, luego la siguiente… (así cada día se ve algo de todo)
    for o in w["origins"]:
        for d in _dep_days(w, start, end):
            for n in nights:
                ret = (d + timedelta(days=n)).isoformat() if n is not None else None
                for dst in w["destinations"]:
                    if o != dst:
                        out.append((o, dst, d.isoformat(), ret, ms))
    return out


def progress(w, store, today):
    """(comprobadas en los últimos días, total) de un seguimiento de fechas concretas."""
    combos = narrow_combos(w, today)
    if not combos:
        return None
    fresh = store.live_checked_since(fresh_since(today))
    return {"done": sum(1 for k in combos if k in fresh), "total": len(combos)}


def plan(cfg, store, cached, today, budget):
    """Lista de búsquedas para hoy, por prioridad: verificar > fechas concretas > rutas sin datos.

    cached: {watch_id: [ofertas de la caché que cumplen el seguimiento]}.
    Devuelve [(origen, destino, ida, vuelta|None, max_escalas)] sin repetidos.
    """
    fresh = store.live_checked_since((today - timedelta(days=FRESH_DAYS - 1)).isoformat())
    checked_today = store.live_checked_since(today.isoformat())
    verify, narrow, probe = [], [], []
    for w in cfg["watches"]:
        if not w["enabled"]:
            continue
        ms = MAX_STOPS[w["stops"]]
        start, end = cfgmod.window(w, today)
        if start > end:
            continue
        rt = w["trip"] == "rt"
        # 1) verificar los más baratos de la caché (siempre, aunque se comprobaran ayer)
        seen = set()
        for o in sorted(cached.get(w["id"], []), key=lambda o: o["price"]):
            k = (o["origin"], o["destination"], o["dep"], o["ret"], ms)
            if k in seen or k in checked_today:
                continue
            seen.add(k)
            verify.append(k)
            if len(seen) >= VERIFY_PER_WATCH:
                break
        # 2) seguimientos de fechas concretas: todas las combinaciones (rotando lo menos reciente)
        if (end - start).days <= NARROW_DAYS:
            narrow += narrow_combos(w, today)
        # 3) rutas sin ningún precio: una fecha de prueba (cambia cada día)
        else:
            days = _dep_days(w, start, end) or [start]
            have = {(o["origin"], o["destination"]) for o in cached.get(w["id"], [])}
            nights = _nights_options(w["stay"])
            for o in w["origins"]:
                for dst in w["destinations"]:
                    if o == dst or (o, dst) in have:
                        continue
                    r = random.Random(f"{today}{o}{dst}")
                    d = r.choice(days)
                    n = r.choice(nights) if rt else None
                    probe.append((o, dst, d.isoformat(), (d + timedelta(days=n)).isoformat() if rt else None, ms))
    last = store.live_last_checked()
    out, seen = [], set()
    for group, skip_fresh in ((verify, False), (sorted(narrow, key=lambda k: last.get(k, "")), True),
                              (sorted(probe, key=lambda k: last.get(k, "")), True)):
        for k in group:
            if k in seen or k in checked_today or (skip_fresh and k in fresh):
                continue
            seen.add(k)
            out.append(k)
            if len(out) >= budget:
                return out
    return out


def run(searcher, store, jobs, workers=4, pause=1.5):
    """Lanza las búsquedas. Guarda cada resultado (también «sin vuelos») con la fecha de comprobación."""
    stats = {"planned": len(jobs), "ok": 0, "found": 0, "none": 0, "failed": 0, "stopped": False, "errors": []}
    lock = threading.Lock()
    fails = [0]
    stop = threading.Event()
    t0 = time.time()

    def one(job):
        if stop.is_set():
            return
        o, d, dep, ret, ms = job
        time.sleep(pause * (0.6 + random.random() * 0.8))
        try:
            offer = searcher.search(o, d, dep, ret, ms)
        except LiveError as e:
            with lock:
                stats["failed"] += 1
                fails[0] += 1
                if len(stats["errors"]) < 5:
                    stats["errors"].append(f"{o}→{d} {dep}: {e}")
                if fails[0] >= MAX_FAILS:
                    stop.set()
                    stats["stopped"] = True
            return
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        store.save_live(job, offer, now)
        with lock:
            fails[0] = 0
            stats["ok"] += 1
            stats["found" if offer else "none"] += 1

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, jobs))
    stats["seconds"] = round(time.time() - t0, 1)
    return stats


def cached_matches(cfg, store, today):
    """{watch: ofertas de la caché que cumplen el seguimiento} (para elegir qué verificar)."""
    out = {}
    for w in cfg["watches"]:
        if not w["enabled"]:
            continue
        start, end = cfgmod.window(w, today)
        offs = []
        for o in w["origins"]:
            for d in w["destinations"]:
                offs += [x for x in store.cached_offers(o, d, w["trip"]) if analysis.matches(x, w, start, end)]
        out[w["id"]] = offs
    return out


def fresh_since(today):
    return (today - timedelta(days=FRESH_DAYS - 1)).isoformat()


def get_searcher(currency="eur"):
    """(buscador, motivo si no hay buscador)."""
    if os.environ.get("LIVE_PRICES", "1") != "1":
        return None, "desactivado (LIVE_PRICES=0)"
    try:
        return GoogleFlights(currency), None
    except LiveError as e:
        log.warning("Sin precios en directo: %s", e)
        return None, str(e)
