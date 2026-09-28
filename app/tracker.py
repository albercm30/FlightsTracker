"""Escaneo de precios, detección de ofertas y motor de búsqueda.

Tipos de alerta (de más a menos importante):
  record     -> precio más bajo visto nunca para esa ruta
  deal       -> chollo: X % por debajo del precio habitual (mediana del año) de la ruta
  target     -> por debajo del precio máximo que fijaste para ese destino
  drop       -> ha bajado X % desde la última vez que se miró ese mismo día
Todo se calcula por separado para solo ida ("ow") e ida y vuelta ("rt").
"""
import logging
import statistics
import threading
import time
from datetime import date, datetime, timedelta, timezone

from . import airlines, catalog, db
from .providers import booking_links, get_provider

log = logging.getLogger(__name__)

KIND_LABELS = {
    "record": "Mínimo histórico",
    "deal": "Chollo",
    "target": "Bajo tu precio objetivo",
    "drop": "Bajada de precio",
}
KIND_PRIORITY = {"record": 4, "deal": 3, "target": 2, "drop": 1}
TRIP_LABELS = {"ow": "solo ida", "rt": "ida y vuelta", "we": "fin de semana"}

_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

scan_lock = threading.Lock()
progress = {"running": False, "done": 0, "total": 0, "current": ""}


# ---------------------------------------------------------------------------
# utilidades
def fmt_date(iso: str, year: bool = True) -> str:
    d = date.fromisoformat(iso)
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}" + (f" {d.year}" if year else "")


def fmt_price(p, currency="eur") -> str:
    sym = {"eur": "€", "usd": "$", "gbp": "£"}.get(currency.lower(), currency.upper())
    return f"{round(p):,}".replace(",", ".") + f" {sym}"


def fmt_dur(minutes) -> str:
    if not minutes:
        return ""
    h, m = divmod(int(minutes), 60)
    return f"{h} h {m:02d} min" if h and m else (f"{h} h" if h else f"{m} min")


# franjas horarias de salida (como en Skyscanner)
WINDOWS = {"night": (0, 6), "morning": (6, 12), "afternoon": (12, 18), "evening": (18, 24)}
WINDOW_LABELS = {"night": "Madrugada", "morning": "Mañana", "afternoon": "Tarde", "evening": "Noche"}


def in_windows(hhmm, windows) -> bool:
    if not windows or not hhmm:
        return True
    try:
        h = int(hhmm[:2])
    except ValueError:
        return True
    return any(WINDOWS[w][0] <= h < WINDOWS[w][1] for w in windows if w in WINDOWS)


def _windows(v):
    if isinstance(v, str):
        v = [x.strip() for x in v.split(",")]
    return [x for x in (v or []) if x in WINDOWS]


def quote_filter(f: dict):
    """Filtro de escalas, duración, horarios y aerolíneas. f: max_stops (-1 = cualquiera),
    max_duration_h (0 = sin límite), dep_windows, ret_windows, airlines, exclude_airlines."""
    max_stops = int(f.get("max_stops", -1) if f.get("max_stops") not in (None, "") else -1)
    max_min = float(f.get("max_duration_h") or 0) * 60
    dep_w, ret_w = _windows(f.get("dep_windows")), _windows(f.get("ret_windows"))
    inc = {a.upper() for a in (f.get("airlines") or [])}
    exc = {a.upper() for a in (f.get("exclude_airlines") or [])}

    def ok(q) -> bool:
        if max_stops >= 0:
            if (q.transfers or 0) > max_stops or (q.return_date and (q.return_transfers or 0) > max_stops):
                return False
        if max_min:
            if (q.duration and q.duration > max_min) or (q.return_duration and q.return_duration > max_min):
                return False
        if dep_w and not in_windows(q.dep_time, dep_w):
            return False
        if ret_w and q.return_date and not in_windows(q.ret_time, ret_w):
            return False
        al = (q.airline or "").upper()
        if inc and al not in inc:
            return False
        if exc and al in exc:
            return False
        return True
    return ok


def scan_filter(settings: dict):
    return quote_filter({"max_stops": settings.get("max_stops", -1), "max_duration_h": settings.get("max_duration_h", 0),
                         "dep_windows": settings.get("dep_windows", ""),
                         "exclude_airlines": settings.get("exclude_airlines") or []})


def month_list(today: date, months_ahead: int):
    y, m = today.year, today.month
    out = []
    for _ in range(max(1, months_ahead)):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def months_between(d0: date, d1: date):
    out, y, m = [], d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def cheapest_per_day(quotes):
    best = {}
    for q in quotes:
        cur = best.get(q.depart_date)
        if cur is None or q.price < cur.price:
            best[q.depart_date] = q
    return best


def nights_range(settings):
    lo = max(1, int(settings.get("min_nights", 3)))
    return lo, max(lo, int(settings.get("max_nights", 10)))


def _fetch_kwargs(settings, trip, min_n=None, max_n=None):
    lo, hi = nights_range(settings)
    return {"currency": settings.get("currency", "eur"), "trip": trip,
            "direct_only": bool(settings.get("direct_only", False)) or int(settings.get("max_stops", -1)) == 0,
            "min_nights": min_n if min_n is not None else lo, "max_nights": max_n if max_n is not None else hi}


# ---------------------------------------------------------------------------
# enriquecer un resultado con equipaje, total, enlaces...
RESIDENT_AIRPORTS = {"canarias": {"LPA", "TCI", "ACE", "FUE", "SPC", "VDE", "GMZ"}, "baleares": {"PMI", "IBZ", "MAH"}}
TAX_PER_LEG = 12  # tasas aproximadas por trayecto nacional (no bonificables)


def resident_price(price: float, origin: str, dest: str, legs: int, region: str):
    """Descuento de residente (75 % sobre la tarifa, no sobre tasas) en vuelos nacionales
    con origen o destino en tu comunidad. Estimación: el precio real lo da la aerolínea."""
    airports = RESIDENT_AIRPORTS.get(region or "")
    if not airports:
        return None
    oi, di = catalog.info(origin), catalog.info(dest)
    if oi.get("country_code") != "ES" or di.get("country_code") != "ES":
        return None
    if origin.upper() not in airports and dest.upper() not in airports:
        return None
    taxes = min(price * 0.5, TAX_PER_LEG * legs)
    return round((price - taxes) * 0.25 + taxes)


_resident_region = {"v": None, "t": 0}


def _resident_setting():
    now = time.time()
    if now - _resident_region["t"] > 30:
        _resident_region.update(v=db.get_settings().get("resident_discount", ""), t=now)
    return _resident_region["v"]


def enrich(r: dict, pax: int = 1, bag: str = "personal", currency: str = "eur") -> dict:
    trip = r.get("trip") or ("rt" if r.get("return_date") else "ow")
    long_haul = catalog.is_long_haul(r["origin"], r["destination"])
    b = airlines.baggage(r.get("airline"), long_haul, bag, legs=2 if trip == "rt" else 1, pax=pax)
    r["trip"] = trip
    r["airline_name"] = airlines.name(r.get("airline"))
    r["baggage"] = b
    r["pax"] = pax
    res = resident_price(r["price"], r["origin"], r["destination"], 2 if trip == "rt" else 1, _resident_setting())
    r["resident_price"] = res
    base = res if res is not None else r["price"]
    r["price_total"] = round(base * pax + b["fee_est"])
    r["price_pp_bags"] = round(base + b["fee_est"] / max(1, pax))
    r["date_label"] = fmt_date(r["depart_date"])
    if r.get("return_date"):
        r["return_label"] = fmt_date(r["return_date"])
        r["nights"] = (date.fromisoformat(r["return_date"]) - date.fromisoformat(r["depart_date"])).days
    info = catalog.info(r["destination"])
    r["dest_name"], r["dest_country"], r["dest_cc"] = info["name"], info["country"], info.get("country_code", "")
    r["dest_region"] = info.get("region", "EU")
    r["origin_name"] = catalog.info(r["origin"])["name"]
    r["links"] = booking_links(r["origin"], r["destination"], r["depart_date"], r.get("return_date"), pax)
    r["long_haul"] = long_haul
    r["stops"] = max(r.get("transfers") or 0, r.get("return_transfers") or 0) if trip == "rt" else (r.get("transfers") or 0)
    r["dur_label"] = fmt_dur(r.get("duration"))
    r["ret_dur_label"] = fmt_dur(r.get("return_duration"))
    r["dur_total"] = (r.get("duration") or 0) + (r.get("return_duration") or 0) or None
    return r


def _q2d(q) -> dict:
    return {"origin": q.origin, "destination": q.destination, "trip": q.trip, "depart_date": q.depart_date,
            "return_date": q.return_date, "price": q.price, "airline": q.airline, "transfers": q.transfers,
            "return_transfers": q.return_transfers, "link": q.link, "provider": q.provider,
            "duration": q.duration, "return_duration": q.return_duration, "dep_time": q.dep_time,
            "ret_time": q.ret_time}


# ---------------------------------------------------------------------------
# detección de ofertas (lógica pura, testeable)
# Qué merece un aviso según el nivel elegido:
#   ahorro mínimo frente al precio habitual, percentil máximo entre las fechas de la ruta,
#   y ahorro mínimo para avisar de un mínimo histórico.
ALERT_LEVELS = {
    "excepcional": {"savings": 0.40, "pct": 0.05, "record": 0.30, "local": 0.25},
    "muy_buena": {"savings": 0.30, "pct": 0.10, "record": 0.20, "local": 0.18},
    "buena": {"savings": 0.20, "pct": 0.20, "record": 0.10, "local": 0.10},
}
ALERT_LEVEL_LABELS = {"excepcional": "Solo excepcionales", "muy_buena": "Muy buenas", "buena": "Buenas"}


def detect_deals(new_quotes: dict, existing: dict, *, today: date, settings: dict,
                 max_price=None, history_min=None, last_alerts=None, usual=None):
    """Candidatos a aviso de una ruta. Solo ofertas que de verdad merecen la pena:
    - deal: X % por debajo del precio habitual Y entre las fechas más baratas de la ruta
    - record: mínimo histórico de la ruta con un ahorro claro
    - target: por debajo del precio máximo que pusiste para ese destino
    - drop: bajada puntual (solo si activas «avisar de bajadas»)
    `usual` = precio habitual de la ruta según el histórico (si no, la mediana actual)."""
    last_alerts = last_alerts or {}
    lvl = ALERT_LEVELS.get(settings.get("alert_level") or "muy_buena", ALERT_LEVELS["muy_buena"])
    prices = sorted(q.price for d, q in new_quotes.items() if (date.fromisoformat(d) - today).days >= 1)
    median = statistics.median(prices) if len(prices) >= 5 else None
    ref_usual = usual or median
    min_lead = int(settings.get("min_days_ahead", 14))
    max_lead = int(settings.get("max_days_ahead", 365))
    drop_pct = float(settings.get("drop_pct", 15)) / 100
    drops_on = str(settings.get("alert_drops", False)).lower() in ("1", "true", "yes", "on")
    realert = float(settings.get("realert_pct", 10)) / 100
    cheapest_now = prices[0] if prices else None

    def pct_rank(price):
        return sum(1 for p in prices if p < price) / len(prices) if prices else 1

    # precio típico de las fechas cercanas (±3 semanas): que sea barato para ESA época,
    # no solo por ser temporada baja
    dated = sorted((date.fromisoformat(d), q.price) for d, q in new_quotes.items())

    def local_saving(d, price):
        dd = date.fromisoformat(d)
        near = [p for x, p in dated if abs((x - dd).days) <= 21 and x != dd]
        return 1 - price / statistics.median(near) if len(near) >= 6 else 0.0

    found = []
    for d, q in new_quotes.items():
        lead = (date.fromisoformat(d) - today).days
        if lead < min_lead or lead > max_lead:
            continue
        kinds, ref = [], None
        prev = (existing.get(d) or {}).get("price")
        savings = (1 - q.price / ref_usual) if ref_usual else 0
        rank = pct_rank(q.price)
        if history_min is not None and q.price < history_min and q.price == cheapest_now \
                and savings >= lvl["record"]:
            kinds.append("record")
            ref = history_min
        if ref_usual and len(prices) >= 10 and savings >= lvl["savings"] and rank <= lvl["pct"] \
                and local_saving(d, q.price) >= lvl["local"]:
            kinds.append("deal")
            ref = ref or ref_usual
        if max_price and q.price <= float(max_price):
            kinds.append("target")
            ref = ref or float(max_price)
        if drops_on and prev and q.price <= prev * (1 - drop_pct):
            kinds.append("drop")
            ref = ref or prev
        if not kinds:
            continue
        last = last_alerts.get(d)
        if last is not None and q.price > last * (1 - realert):
            continue
        kind = max(kinds, key=KIND_PRIORITY.get)
        found.append({"quote": q, "kind": kind, "kinds": kinds, "ref_price": ref, "median": ref_usual,
                      "prev_price": prev, "savings": savings, "lead": lead, "rank": rank})
    found.sort(key=lambda a: (-KIND_PRIORITY[a["kind"]], -a["savings"], a["quote"].price))
    return found


def best_alert(cands):
    """De varios candidatos (de un mismo destino) se queda con el que más merece la pena."""
    if not cands:
        return None
    return max(cands, key=lambda a: (a["savings"] + 0.05 * KIND_PRIORITY[a["kind"]], -a["quote"].price))


def build_message(alert, currency="eur", pax=1, bag="personal") -> str:
    q = alert["quote"]
    dest = catalog.info(q.destination)
    when = fmt_date(q.depart_date)
    if q.return_date:
        when += f" → {fmt_date(q.return_date)} ({q.nights} noches)"
    parts = [f"{q.origin} → {dest['name']} ({q.destination})", TRIP_LABELS[q.trip], when]
    msg = f"{KIND_LABELS[alert['kind']]}: " + " · ".join(parts) + f" · {fmt_price(q.price, currency)}/pers."
    extra = []
    if alert.get("median"):
        pct = round(alert["savings"] * 100)
        if pct > 0:
            extra.append(f"−{pct}% vs. habitual {fmt_price(alert['median'], currency)}")
    if alert.get("prev_price") and "drop" in alert["kinds"]:
        extra.append(f"antes {fmt_price(alert['prev_price'], currency)}")
    if extra:
        msg += " (" + ", ".join(extra) + ")"
    if q.transfers is not None:
        msg += " · directo" if q.transfers == 0 else f" · {q.transfers} escala(s)"
    if q.duration:
        msg += f" · {fmt_dur(q.duration)}"
    if q.airline:
        msg += f" · {airlines.name(q.airline)}"
    if bag != "personal" or pax > 1:
        e = enrich(_q2d(q), pax, bag, currency)
        msg += f" · total con equipaje ≈ {fmt_price(e['price_total'], currency)}" + (f" ({pax} pers.)" if pax > 1 else "")
    return msg


# ---------------------------------------------------------------------------
# guardado por ruta
def _save_route(origin, destination, trip, best: dict, today: date, settings: dict, max_price,
                alerts: bool = True, now: str = None):
    """Guarda los precios de una ruta y devuelve los CANDIDATOS a aviso (sin guardarlos:
    run_scan elige el mejor por destino y aplica el anti-spam)."""
    now = now or db.now_iso()
    existing = {r["depart_date"]: r for r in db.rows(
        "SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=?", (origin, destination, trip))}
    found = []
    if alerts:
        hist = db.one("SELECT MIN(min_price) AS m, COUNT(*) AS n FROM route_stats WHERE origin=? AND destination=? "
                      "AND trip=?", (origin, destination, trip))
        history_min = hist["m"] if hist and hist["n"] >= 2 else None
        since = (datetime.now(timezone.utc) - timedelta(days=60)).replace(microsecond=0).isoformat()
        meds = [r["median_price"] for r in db.rows(
            "SELECT median_price FROM route_stats WHERE origin=? AND destination=? AND trip=? AND scanned_at>=? "
            "AND median_price IS NOT NULL", (origin, destination, trip, since))]
        usual = statistics.median(meds) if len(meds) >= 3 else None
        last_alerts = {r["depart_date"]: r["p"] for r in db.rows(
            "SELECT depart_date, MIN(price) AS p FROM alerts WHERE origin=? AND destination=? AND trip=? "
            "AND depart_date>=? GROUP BY depart_date", (origin, destination, trip, today.isoformat()))}
        found = detect_deals(best, existing, today=today, settings=settings, max_price=max_price,
                             history_min=history_min, last_alerts=last_alerts, usual=usual)
        for a in found:
            a.update(origin=origin, destination=destination, trip=trip)

    with db.connect() as c:
        for d, q in best.items():
            old = existing.get(d)
            if not old or old["price"] != q.price:
                c.execute("INSERT INTO quote_history(origin, destination, trip, depart_date, price, prev_price, seen_at)"
                          " VALUES (?,?,?,?,?,?,?)",
                          (origin, destination, trip, d, q.price, old["price"] if old else None, now))
            vals = (q.return_date, q.nights, q.airline, q.transfers, q.return_transfers, q.duration,
                    q.return_duration, q.dep_time, q.ret_time, q.link, q.provider)
            if old:
                prev = old["price"] if old["price"] != q.price else old["prev_price"]
                lowest = min(old["lowest_price"] or q.price, q.price)
                c.execute("UPDATE quotes SET price=?, prev_price=?, lowest_price=?, return_date=?, nights=?, airline=?,"
                          " transfers=?, return_transfers=?, duration=?, return_duration=?, dep_time=?, ret_time=?,"
                          " link=?, provider=?, updated_at=? WHERE origin=? AND destination=? AND trip=? AND depart_date=?",
                          (q.price, prev, lowest, *vals, now, origin, destination, trip, d))
            else:
                c.execute("INSERT INTO quotes(origin, destination, trip, depart_date, price, prev_price, lowest_price, "
                          "return_date, nights, airline, transfers, return_transfers, duration, return_duration, "
                          "dep_time, ret_time, link, provider, first_seen, updated_at) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (origin, destination, trip, d, q.price, None, q.price, *vals, now, now))
        prices = [q.price for q in best.values()]
        if prices:
            c.execute("INSERT INTO route_stats(origin, destination, trip, scanned_at, min_price, median_price, count) "
                      "VALUES (?,?,?,?,?,?,?)",
                      (origin, destination, trip, now, min(prices), statistics.median(prices), len(prices)))
    return found


def select_alerts(cands, settings: dict, today: date):
    """Anti-spam: como mucho UN aviso por destino y escaneo (el mejor de todos sus orígenes,
    fechas y tipos de viaje). Si ese destino ya se avisó hace poco (realert_days), solo se repite
    si la nueva oferta es claramente mejor: un X % más barata (mismo tipo de viaje) y con al menos
    el mismo ahorro, o 10 puntos más de ahorro si es otro tipo de viaje."""
    realert = float(settings.get("realert_pct", 10)) / 100
    days = int(settings.get("realert_days", 14))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat()
    by_dest = {}
    for a in cands:
        by_dest.setdefault(a["destination"], []).append(a)
    chosen = []
    for dest, lst in by_dest.items():
        prev = db.rows("SELECT trip, price, ref_price, kind FROM alerts WHERE destination=? AND created_at>=? "
                       "AND depart_date>=? AND kind NOT LIKE 'watch%'", (dest, since, today.isoformat()))
        prev_price = {}
        for r in prev:
            prev_price[r["trip"]] = min(prev_price.get(r["trip"], r["price"]), r["price"])
        prev_sav = max([1 - r["price"] / r["ref_price"] for r in prev if r["ref_price"] and r["kind"] == "deal"]
                       or [0])

        def worth(a):
            if not prev:
                return True
            if a["trip"] in prev_price:
                return a["quote"].price <= prev_price[a["trip"]] * (1 - realert) and a["savings"] >= prev_sav - 0.02
            return a["savings"] >= prev_sav + 0.10
        pick = best_alert([a for a in lst if worth(a)])
        if pick:
            pick["others"] = len(lst) - 1
            chosen.append(pick)
    chosen.sort(key=lambda a: (-KIND_PRIORITY[a["kind"]], -a["savings"]))
    return chosen


def record_alerts(chosen, settings: dict, now: str = None):
    now = now or db.now_iso()
    currency = settings.get("currency", "eur")
    pax, bag = int(settings.get("passengers", 1)), settings.get("baggage", "personal")
    out = []
    with db.connect() as c:
        for a in chosen:
            q = a["quote"]
            msg = build_message(a, currency, pax, bag)
            cur = c.execute(
                "INSERT INTO alerts(created_at, kind, origin, destination, trip, depart_date, return_date, price, "
                "ref_price, message, link, airline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (now, a["kind"], a["origin"], a["destination"], a["trip"], q.depart_date, q.return_date, q.price,
                 a["ref_price"], msg, q.link, q.airline))
            out.append({"id": cur.lastrowid, "kind": a["kind"], "message": msg, "link": q.link,
                        "price": q.price, "savings": a["savings"], "origin": a["origin"], "trip": a["trip"],
                        "destination": a["destination"], "depart_date": q.depart_date,
                        "return_date": q.return_date})
    return out


def cleanup(today: date):
    stale = (datetime.now(timezone.utc) - timedelta(days=10)).replace(microsecond=0).isoformat()
    with db.connect() as c:
        c.execute("DELETE FROM quotes WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quotes WHERE updated_at < ?", (stale,))
        c.execute("DELETE FROM watches WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quote_history WHERE depart_date < ?", ((today - timedelta(days=30)).isoformat(),))


def trip_length(dest: str, settings: dict):
    """Duración elegida para ese destino (o su país): "weekend", un nº de días, o None (la general)."""
    tl = settings.get("trip_lengths") or {}
    if not isinstance(tl, dict):
        return None
    v = tl.get(dest.upper())
    if v in (None, "", 0):
        v = tl.get(catalog.info(dest).get("country_code", ""))
    if v == "weekend":
        return "weekend"
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    return v if 2 <= v <= 60 else None


def length_label(spec) -> str:
    if spec == "weekend":
        return "fin de semana (vie–dom)"
    return f"{spec} días" if spec else ""


def length_nights(spec):
    """(noches mín., noches máx., filtro extra) para esa duración. N días = N-1 noches."""
    if spec == "weekend":
        return 2, 2, lambda q: _is_weekend(q)
    if spec:
        return spec - 1, spec - 1, None
    return None, None, None


def _is_weekend(q) -> bool:
    return (bool(q.return_date) and q.nights == 2 and date.fromisoformat(q.depart_date).weekday() == 4)


def _fetch_route(provider, origin, dest, months, settings, errors, delay=0.0, trip="ow", weekends=None):
    """Lo más barato por día de salida. En ida y vuelta, si se pasa `weekends` (dict), guarda ahí
    además lo más barato de cada fin de semana viernes→domingo, sacado de la misma respuesta."""
    quotes, wk = [], []
    base_keep = scan_filter(settings)
    spec = trip_length(dest, settings) if trip == "rt" else None
    lo, hi, extra = length_nights(spec)
    keep = (lambda q: base_keep(q) and extra(q)) if extra else base_keep
    kw = _fetch_kwargs(settings, trip, lo, hi)
    want_lo, want_hi = kw["min_nights"], kw["max_nights"]
    if trip == "rt" and weekends is not None:
        kw["min_nights"] = min(2, want_lo)
        kw["max_nights"] = max(2, want_hi)
    for month in months:
        try:
            data, hit = provider.fetch_month(origin, dest, month, **kw), False
            for q in data:
                if not base_keep(q):
                    continue
                if trip == "rt" and weekends is not None and _is_weekend(q):
                    wk.append(q)
                if trip != "rt" or want_lo <= (q.nights or 0) <= want_hi:
                    if keep(q):
                        quotes.append(q)
        except Exception as e:  # noqa: BLE001 - seguimos con el resto
            hit = True
            log.warning("Error %s→%s %s %s: %s", origin, dest, trip, month, e)
            errors.append(f"{origin}→{dest} {TRIP_LABELS[trip]} {month}: {e}")
            if "401" in str(e) or "no válido" in str(e):
                raise
        if delay and not hit:
            time.sleep(delay)
    if weekends is not None:
        weekends.update(cheapest_per_day(wk))
    return cheapest_per_day(quotes)


def backfill_demo(origin: str, dest: str, settings: dict, trip: str = "ow", days: int = 45):
    """Solo modo demo: unas semanas de histórico simulado para que gráficos y mínimos funcionen ya."""
    from .providers.demo import DemoProvider

    if db.one("SELECT 1 AS x FROM route_stats WHERE origin=? AND destination=? AND trip=? LIMIT 1",
              (origin, dest, trip)):
        return
    step = 3 if trip == "ow" else 5
    now = datetime.now(timezone.utc)
    for k in range(days, 0, -step):
        t = now - timedelta(days=k)
        best = _fetch_route(DemoProvider(now=t), origin, dest, month_list(t.date(), int(settings.get("months_ahead", 12))),
                            settings, [], trip=trip)
        _save_route(origin, dest, trip, best, t.date(), settings, None, alerts=False,
                    now=t.replace(microsecond=0).isoformat())


# ---------------------------------------------------------------------------
# escaneo completo
def run_scan(provider=None, today: date = None, notify: bool = True) -> dict:
    if not scan_lock.acquire(blocking=False):
        return {"status": "busy"}
    scan_id = None
    try:
        from . import notifier

        settings = db.get_settings()
        today = today or date.today()
        provider = provider or get_provider(settings)
        origins = [o.upper() for o in settings.get("origins") or []]
        dests = db.rows("SELECT * FROM destinations WHERE enabled=1 ORDER BY name")
        months = month_list(today, int(settings.get("months_ahead", 12)))
        delay = float(settings.get("request_delay_s", 0.5)) if provider.name != "demo" else 0
        scan_id = db.execute("INSERT INTO scans(started_at, status, provider) VALUES (?, 'running', ?)",
                             (db.now_iso(), provider.name))
        routes = [(o, d["code"], t, d.get("max_price")) for t in db.trips(settings)
                  for o in origins for d in dests if o != d["code"]]
        progress.update(running=True, done=0, total=len(routes), current="")
        cands, n_quotes, errors = [], 0, []
        for origin, dest, trip, max_price in routes:
            progress["current"] = f"{origin} → {dest} ({TRIP_LABELS[trip]})"
            if provider.name == "demo":
                backfill_demo(origin, dest, settings, trip)
            wk = {} if trip == "rt" else None
            best = _fetch_route(provider, origin, dest, months, settings, errors, delay, trip, weekends=wk)
            n_quotes += len(best)
            if best:
                cands += _save_route(origin, dest, trip, best, today, settings, max_price)
            if wk:  # fines de semana vie→dom (para buscar «Fin de semana» en la web)
                _save_route(origin, dest, "we", wk, today, settings, None, alerts=False)
            progress["done"] += 1
        all_alerts = record_alerts(select_alerts(cands, settings, today), settings)
        cleanup(today)
        sent = {}
        if notify:
            # incluye avisos que quedaron pendientes (p. ej. por horas de silencio)
            ids = {a["id"] for a in all_alerts}
            day_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).replace(microsecond=0).isoformat()
            pending = [dict(r, savings=0) for r in db.rows(
                "SELECT * FROM alerts WHERE notified=0 AND created_at>=? AND depart_date>=?",
                (day_ago, today.isoformat())) if r["id"] not in ids]
            if all_alerts or pending:
                sent = notifier.send_digest(all_alerts + pending, settings)
        status = "ok" if not errors else ("partial" if n_quotes else "error")
        db.execute("UPDATE scans SET finished_at=?, status=?, routes=?, quotes=?, alerts=?, error=? WHERE id=?",
                   (db.now_iso(), status, len(routes), n_quotes, len(all_alerts), "\n".join(errors[:20]) or None,
                    scan_id))
        return {"status": status, "routes": len(routes), "quotes": n_quotes, "alerts": len(all_alerts),
                "errors": errors[:20], "notified": sent}
    except Exception as e:  # noqa: BLE001
        log.exception("Escaneo fallido")
        if scan_id:
            db.execute("UPDATE scans SET finished_at=?, status='error', error=? WHERE id=?",
                       (db.now_iso(), str(e), scan_id))
        return {"status": "error", "error": str(e)}
    finally:
        progress.update(running=False, current="")
        scan_lock.release()


# ---------------------------------------------------------------------------
# panel
def _window(settings, today):
    start = (today + timedelta(days=int(settings.get("min_days_ahead", 14)))).isoformat()
    end = (today + timedelta(days=int(settings.get("max_days_ahead", 365)))).isoformat()
    return start, end


def price_level(price, prices):
    if not prices:
        return None
    s = sorted(prices)
    rank = sum(1 for p in s if p < price) / len(s)
    return "low" if rank <= 0.25 else ("high" if rank >= 0.75 else "typical")


def current_deals(limit: int = 30, today: date = None, trip: str = None):
    """Mejor precio actual por destino favorito (entre tus orígenes), con ahorro y equipaje."""
    settings = db.get_settings()
    today = today or date.today()
    trip = trip or db.trips(settings)[-1]
    start, end = _window(settings, today)
    origins = [o.upper() for o in settings.get("origins") or []]
    if not origins:
        return []
    pax, bag, cur = int(settings.get("passengers", 1)), settings.get("baggage", "personal"), settings.get("currency", "eur")
    out = []
    for dest in db.rows("SELECT * FROM destinations WHERE enabled=1"):
        qs = db.rows("SELECT * FROM quotes WHERE destination=? AND trip=? AND depart_date BETWEEN ? AND ? "
                     f"AND origin IN ({','.join('?' * len(origins))}) ORDER BY price",
                     (dest["code"], trip, start, end, *origins))
        if not qs:
            continue
        best = enrich(dict(qs[0]), pax, bag, cur)
        route_prices = [q["price"] for q in qs if q["origin"] == best["origin"]]
        median = statistics.median(route_prices) if route_prices else None
        spark = {}
        for q in qs:
            if q["origin"] == best["origin"]:
                m = q["depart_date"][:7]
                spark[m] = min(spark.get(m, q["price"]), q["price"])
        out.append({**best, "name": dest["name"], "country": dest["country"], "max_price": dest["max_price"],
                    "length": length_label(trip_length(dest["code"], settings)) if trip == "rt" else "",
                    "median": median, "savings": (1 - best["price"] / median) if median else 0,
                    "range": [min(route_prices), median, max(route_prices)] if route_prices else None,
                    "spark": [spark[k] for k in sorted(spark)]})
    out.sort(key=lambda x: -x["savings"])
    return out[:limit]


def recent_changes(limit: int = 50, min_pct: float = 5.0, favorites_only: bool = True):
    sql = ("SELECT h.* FROM quote_history h "
           + ("JOIN destinations d ON d.code = h.destination " if favorites_only else "")
           + "WHERE h.prev_price IS NOT NULL AND h.depart_date >= ? AND h.trip != 'we' "
           "AND ABS(h.price - h.prev_price) * 100.0 / h.prev_price >= ? ORDER BY h.seen_at DESC, "
           "ABS(h.price - h.prev_price) * 1.0 / h.prev_price DESC LIMIT ?")
    rows = db.rows(sql, (date.today().isoformat(), min_pct, limit))
    for r in rows:
        r["pct"] = (r["price"] - r["prev_price"]) / r["prev_price"] * 100
        r["name"] = catalog.info(r["destination"])["name"]
        r["date_label"] = fmt_date(r["depart_date"])
    return rows


