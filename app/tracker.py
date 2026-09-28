"""Escaneo de precios, detección de ofertas y motor de búsqueda.

Tipos de alerta (de más a menos importante):
  watch_down -> un vuelo que vigilas ha bajado (o bajó de tu objetivo)
  record     -> precio más bajo visto nunca para esa ruta
  deal       -> chollo: X % por debajo del precio habitual (mediana del año) de la ruta
  target     -> por debajo del precio máximo que fijaste para ese destino
  drop       -> ha bajado X % desde la última vez que se miró ese mismo día
  watch_up   -> un vuelo que vigilas ha subido
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
    "watch_down": "Vuelo vigilado: ha bajado",
    "watch_up": "Vuelo vigilado: ha subido",
}
KIND_PRIORITY = {"watch_down": 5, "record": 4, "deal": 3, "target": 2, "drop": 1, "watch_up": 0}
TRIP_LABELS = {"ow": "solo ida", "rt": "ida y vuelta"}

_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

scan_lock = threading.Lock()
progress = {"running": False, "done": 0, "total": 0, "current": ""}
search_jobs = {}
_cache = {}
_cache_lock = threading.Lock()


# ---------------------------------------------------------------------------
# utilidades
def fmt_date(iso: str, year: bool = True) -> str:
    d = date.fromisoformat(iso)
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}" + (f" {d.year}" if year else "")


def fmt_price(p, currency="eur") -> str:
    sym = {"eur": "€", "usd": "$", "gbp": "£"}.get(currency.lower(), currency.upper())
    return f"{round(p):,}".replace(",", ".") + f" {sym}"


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
            "direct_only": bool(settings.get("direct_only", False)),
            "min_nights": min_n if min_n is not None else lo, "max_nights": max_n if max_n is not None else hi}


def cached_fetch(provider, origin, dest, month, ttl_hours, **kw):
    """Descarga (o reutiliza de la caché en memoria) los precios de un mes, o de 'any' fecha."""
    key = (provider.name, origin, dest, month, tuple(sorted(kw.items())))
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl_hours * 3600:
            return hit[1], True
    if month == "any":
        data = provider.fetch_any(origin, dest, **kw)
    else:
        data = provider.fetch_month(origin, dest, month, **kw)
    with _cache_lock:
        if len(_cache) > 5000:
            _cache.clear()
        _cache[key] = (now, data)
    return data, False


# ---------------------------------------------------------------------------
# enriquecer un resultado con equipaje, total, enlaces...
def enrich(r: dict, pax: int = 1, bag: str = "personal", currency: str = "eur") -> dict:
    trip = r.get("trip") or ("rt" if r.get("return_date") else "ow")
    long_haul = catalog.is_long_haul(r["origin"], r["destination"])
    b = airlines.baggage(r.get("airline"), long_haul, bag, legs=2 if trip == "rt" else 1, pax=pax)
    r["trip"] = trip
    r["airline_name"] = airlines.name(r.get("airline"))
    r["baggage"] = b
    r["pax"] = pax
    r["price_total"] = round(r["price"] * pax + b["fee_est"])
    r["price_pp_bags"] = round(r["price"] + b["fee_est"] / max(1, pax))
    r["date_label"] = fmt_date(r["depart_date"])
    if r.get("return_date"):
        r["return_label"] = fmt_date(r["return_date"])
        r["nights"] = (date.fromisoformat(r["return_date"]) - date.fromisoformat(r["depart_date"])).days
    info = catalog.info(r["destination"])
    r["dest_name"], r["dest_country"], r["dest_cc"] = info["name"], info["country"], info.get("country_code", "")
    r["origin_name"] = catalog.info(r["origin"])["name"]
    r["links"] = booking_links(r["origin"], r["destination"], r["depart_date"], r.get("return_date"), pax)
    r["long_haul"] = long_haul
    return r


def _q2d(q) -> dict:
    return {"origin": q.origin, "destination": q.destination, "trip": q.trip, "depart_date": q.depart_date,
            "return_date": q.return_date, "price": q.price, "airline": q.airline, "transfers": q.transfers,
            "return_transfers": q.return_transfers, "link": q.link, "provider": q.provider}


# ---------------------------------------------------------------------------
# detección de ofertas (lógica pura, testeable)
def detect_deals(new_quotes: dict, existing: dict, *, today: date, settings: dict,
                 max_price=None, history_min=None, last_alerts=None):
    last_alerts = last_alerts or {}
    prices = [q.price for d, q in new_quotes.items() if (date.fromisoformat(d) - today).days >= 1]
    median = statistics.median(prices) if len(prices) >= 5 else None
    min_lead = int(settings.get("min_days_ahead", 14))
    max_lead = int(settings.get("max_days_ahead", 365))
    drop_pct = float(settings.get("drop_pct", 15)) / 100
    deal_pct = float(settings.get("deal_pct", 30)) / 100
    realert = float(settings.get("realert_pct", 5)) / 100
    cheapest_now = min(prices) if prices else None

    found = []
    for d, q in new_quotes.items():
        lead = (date.fromisoformat(d) - today).days
        if lead < min_lead or lead > max_lead:
            continue
        kinds, ref = [], None
        prev = (existing.get(d) or {}).get("price")
        if history_min is not None and q.price < history_min and q.price == cheapest_now:
            kinds.append("record")
            ref = history_min
        if median and len(prices) >= 10 and q.price <= median * (1 - deal_pct):
            kinds.append("deal")
            ref = ref or median
        if max_price and q.price <= float(max_price):
            kinds.append("target")
            ref = ref or float(max_price)
        if prev and q.price <= prev * (1 - drop_pct):
            kinds.append("drop")
            ref = ref or prev
        if not kinds:
            continue
        last = last_alerts.get(d)
        if last is not None and q.price > last * (1 - realert):
            continue
        kind = max(kinds, key=KIND_PRIORITY.get)
        savings = (1 - q.price / median) if median else 0
        found.append({"quote": q, "kind": kind, "kinds": kinds, "ref_price": ref, "median": median,
                      "prev_price": prev, "savings": savings, "lead": lead})
    found.sort(key=lambda a: (-KIND_PRIORITY[a["kind"]], a["quote"].price))
    return found


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
    now = now or db.now_iso()
    existing = {r["depart_date"]: r for r in db.rows(
        "SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=?", (origin, destination, trip))}
    hist = db.one("SELECT MIN(min_price) AS m, COUNT(*) AS n FROM route_stats WHERE origin=? AND destination=? "
                  "AND trip=?", (origin, destination, trip))
    history_min = hist["m"] if hist and hist["n"] >= 2 else None
    last_alerts = {r["depart_date"]: r["p"] for r in db.rows(
        "SELECT depart_date, MIN(price) AS p FROM alerts WHERE origin=? AND destination=? AND trip=? "
        "AND depart_date>=? GROUP BY depart_date", (origin, destination, trip, today.isoformat()))}

    found = []
    if alerts:
        found = detect_deals(best, existing, today=today, settings=settings, max_price=max_price,
                             history_min=history_min, last_alerts=last_alerts)
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).replace(microsecond=0).isoformat()
        recent = db.one("SELECT MIN(price) AS p FROM alerts WHERE origin=? AND destination=? AND trip=? "
                        "AND created_at>=? AND depart_date>=? AND kind NOT LIKE 'watch%'",
                        (origin, destination, trip, week_ago, today.isoformat()))
        if recent and recent["p"] is not None:
            limit_price = recent["p"] * (1 - float(settings.get("realert_pct", 5)) / 100)
            found = [a for a in found if a["quote"].price <= limit_price]
        found = found[: int(settings.get("max_alerts_per_route", 3))]

    new_alerts = []
    with db.connect() as c:
        for d, q in best.items():
            old = existing.get(d)
            if not old or old["price"] != q.price:
                c.execute("INSERT INTO quote_history(origin, destination, trip, depart_date, price, prev_price, seen_at)"
                          " VALUES (?,?,?,?,?,?,?)",
                          (origin, destination, trip, d, q.price, old["price"] if old else None, now))
            if old:
                prev = old["price"] if old["price"] != q.price else old["prev_price"]
                lowest = min(old["lowest_price"] or q.price, q.price)
                c.execute("UPDATE quotes SET price=?, prev_price=?, lowest_price=?, return_date=?, nights=?, airline=?,"
                          " transfers=?, return_transfers=?, link=?, provider=?, updated_at=? "
                          "WHERE origin=? AND destination=? AND trip=? AND depart_date=?",
                          (q.price, prev, lowest, q.return_date, q.nights, q.airline, q.transfers, q.return_transfers,
                           q.link, q.provider, now, origin, destination, trip, d))
            else:
                c.execute("INSERT INTO quotes(origin, destination, trip, depart_date, return_date, nights, price, "
                          "prev_price, lowest_price, airline, transfers, return_transfers, link, provider, first_seen, "
                          "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (origin, destination, trip, d, q.return_date, q.nights, q.price, None, q.price, q.airline,
                           q.transfers, q.return_transfers, q.link, q.provider, now, now))
        prices = [q.price for q in best.values()]
        if prices:
            c.execute("INSERT INTO route_stats(origin, destination, trip, scanned_at, min_price, median_price, count) "
                      "VALUES (?,?,?,?,?,?,?)",
                      (origin, destination, trip, now, min(prices), statistics.median(prices), len(prices)))
        currency = settings.get("currency", "eur")
        pax, bag = int(settings.get("passengers", 1)), settings.get("baggage", "personal")
        for a in found:
            q = a["quote"]
            msg = build_message(a, currency, pax, bag)
            cur = c.execute(
                "INSERT INTO alerts(created_at, kind, origin, destination, trip, depart_date, return_date, price, "
                "ref_price, message, link, airline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (now, a["kind"], origin, destination, trip, q.depart_date, q.return_date, q.price, a["ref_price"],
                 msg, q.link, q.airline))
            new_alerts.append({"id": cur.lastrowid, "kind": a["kind"], "message": msg, "link": q.link,
                               "price": q.price, "savings": a["savings"], "origin": origin, "trip": trip,
                               "destination": destination, "depart_date": q.depart_date,
                               "return_date": q.return_date})
    return new_alerts


def cleanup(today: date):
    stale = (datetime.now(timezone.utc) - timedelta(days=10)).replace(microsecond=0).isoformat()
    with db.connect() as c:
        c.execute("DELETE FROM quotes WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quotes WHERE updated_at < ?", (stale,))
        c.execute("DELETE FROM watches WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quote_history WHERE depart_date < ?", ((today - timedelta(days=30)).isoformat(),))


def _fetch_route(provider, origin, dest, months, settings, errors, delay=0.0, trip="ow", use_cache=False):
    quotes = []
    kw = _fetch_kwargs(settings, trip)
    for month in months:
        try:
            if use_cache:
                data, hit = cached_fetch(provider, origin, dest, month, float(settings.get("search_cache_hours", 3)), **kw)
            else:
                data, hit = provider.fetch_month(origin, dest, month, **kw), False
            quotes += data
        except Exception as e:  # noqa: BLE001 - seguimos con el resto
            hit = True
            log.warning("Error %s→%s %s %s: %s", origin, dest, trip, month, e)
            errors.append(f"{origin}→{dest} {TRIP_LABELS[trip]} {month}: {e}")
            if "401" in str(e) or "no válido" in str(e):
                raise
        if delay and not hit:
            time.sleep(delay)
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
# vuelos vigilados
def watch_price(provider, w: dict, settings: dict):
    """Precio actual de un vuelo vigilado (misma ida y, si aplica, misma vuelta)."""
    if w["trip"] == "ow" or not w.get("return_date"):
        q = db.one("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip='ow' AND depart_date=?",
                   (w["origin"], w["destination"], w["depart_date"]))
        if q and q["updated_at"] >= (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat():
            return q["price"], q.get("link"), q.get("airline")
    n = None
    if w.get("return_date"):
        n = (date.fromisoformat(w["return_date"]) - date.fromisoformat(w["depart_date"])).days
    kw = _fetch_kwargs(settings, w["trip"], n, n)
    data, _ = cached_fetch(provider, w["origin"], w["destination"], w["depart_date"][:7],
                           float(settings.get("search_cache_hours", 3)), **kw)
    match = [q for q in data if q.depart_date == w["depart_date"]
             and (w["trip"] == "ow" or q.return_date == w["return_date"])]
    if not match:
        return None, None, None
    best = min(match, key=lambda q: q.price)
    return best.price, best.link, best.airline


def check_watches(provider, today: date, settings: dict):
    pct = float(settings.get("watch_change_pct", 3)) / 100
    currency = settings.get("currency", "eur")
    out = []
    for w in db.rows("SELECT * FROM watches WHERE depart_date >= ?", (today.isoformat(),)):
        try:
            price, link, airline = watch_price(provider, w, settings)
        except Exception as e:  # noqa: BLE001
            log.warning("Vigilado %s: %s", w["id"], e)
            continue
        if price is None:
            continue
        last = w["last_price"]
        kind = None
        if last and price <= last * (1 - pct):
            kind = "watch_down"
        elif last and price >= last * (1 + pct):
            kind = "watch_up"
        if w["target_price"] and price <= w["target_price"] and (not last or last > w["target_price"]):
            kind = "watch_down"
        if kind:
            name = catalog.info(w["destination"])["name"]
            diff = price - (last or price)
            when = fmt_date(w["depart_date"]) + (f" → {fmt_date(w['return_date'])}" if w.get("return_date") else "")
            msg = (f"{KIND_LABELS[kind]}: {w['origin']} → {name} ({w['destination']}) · {TRIP_LABELS[w['trip']]} · "
                   f"{when} · {fmt_price(price, currency)} ({'+' if diff > 0 else '−'}{fmt_price(abs(diff), currency)} "
                   f"desde {fmt_price(last or price, currency)})")
            link = link or booking_links(w["origin"], w["destination"], w["depart_date"], w.get("return_date") or None)["aviasales"]
            aid = db.execute(
                "INSERT INTO alerts(created_at, kind, origin, destination, trip, depart_date, return_date, price, "
                "ref_price, message, link, airline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (db.now_iso(), kind, w["origin"], w["destination"], w["trip"], w["depart_date"],
                 w.get("return_date") or None, price, last, msg, link, airline))
            out.append({"id": aid, "kind": kind, "message": msg, "link": link, "price": price,
                        "savings": (1 - price / last) if last else 0, "origin": w["origin"], "trip": w["trip"],
                        "destination": w["destination"], "depart_date": w["depart_date"],
                        "return_date": w.get("return_date") or None})
        if price != last:
            db.execute("UPDATE watches SET last_price=? WHERE id=?", (price, w["id"]))
    return out


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
        all_alerts, n_quotes, errors = [], 0, []
        for origin, dest, trip, max_price in routes:
            progress["current"] = f"{origin} → {dest} ({TRIP_LABELS[trip]})"
            if provider.name == "demo":
                backfill_demo(origin, dest, settings, trip)
            best = _fetch_route(provider, origin, dest, months, settings, errors, delay, trip)
            n_quotes += len(best)
            if best:
                all_alerts += _save_route(origin, dest, trip, best, today, settings, max_price)
            progress["done"] += 1
        progress["current"] = "vuelos vigilados"
        all_alerts += check_watches(provider, today, settings)
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
                    "median": median, "savings": (1 - best["price"] / median) if median else 0,
                    "spark": [spark[k] for k in sorted(spark)]})
    out.sort(key=lambda x: -x["savings"])
    return out[:limit]


def recent_changes(limit: int = 50, min_pct: float = 5.0, favorites_only: bool = True):
    sql = ("SELECT h.* FROM quote_history h "
           + ("JOIN destinations d ON d.code = h.destination " if favorites_only else "")
           + "WHERE h.prev_price IS NOT NULL AND h.depart_date >= ? "
           "AND ABS(h.price - h.prev_price) * 100.0 / h.prev_price >= ? ORDER BY h.seen_at DESC, "
           "ABS(h.price - h.prev_price) * 1.0 / h.prev_price DESC LIMIT ?")
    rows = db.rows(sql, (date.today().isoformat(), min_pct, limit))
    for r in rows:
        r["pct"] = (r["price"] - r["prev_price"]) / r["prev_price"] * 100
        r["name"] = catalog.info(r["destination"])["name"]
        r["date_label"] = fmt_date(r["depart_date"])
    return rows


# ---------------------------------------------------------------------------
# consejo "¿compro ya o espero?"
def advice(price: float, depart_date: str, origin: str, dest: str, route_prices, today: date = None,
           history=None, google=None) -> dict:
    today = today or date.today()
    lead = (date.fromisoformat(depart_date) - today).days
    long_haul = catalog.is_long_haul(origin, dest)
    lo, hi = (60, 170) if long_haul else (21, 90)
    route_prices = sorted(route_prices or [])
    pct_rank = (sum(1 for p in route_prices if p < price) / len(route_prices)) if route_prices else None
    reasons, score = [], 0
    if pct_rank is not None:
        if pct_rank <= 0.05:
            score += 3
            reasons.append("Está entre el 5 % de opciones más baratas del periodo.")
        elif pct_rank <= 0.2:
            score += 2
            reasons.append("Está entre el 20 % de opciones más baratas del periodo.")
        elif pct_rank <= 0.5:
            score += 1
            reasons.append("Precio por debajo de la mitad de las opciones del periodo.")
        else:
            score -= 1
            reasons.append("Hay bastantes fechas más baratas: mira el calendario.")
    if history:
        if price <= min(h["price"] for h in history):
            score += 2
            reasons.append("Es el precio más bajo que hemos registrado para esta fecha.")
        if len(history) >= 2:
            reasons.append("Ojo: el último cambio para esta fecha fue una subida." if history[-1]["price"] > history[-2]["price"]
                           else "La última variación para esta fecha fue una bajada.")
    if google and google.get("price_level"):
        lvl = google["price_level"]
        rng = google.get("typical_range")
        txt = {"low": "bajo", "typical": "normal", "high": "alto"}.get(lvl, lvl)
        reasons.append(f"Google Flights considera el precio actual {txt}"
                       + (f" (rango habitual {rng[0]}–{rng[1]})." if rng else "."))
        score += {"low": 2, "typical": 0, "high": -2}.get(lvl, 0)
    if lead < 21:
        score += 1
        reasons.append("Quedan menos de 3 semanas: los precios suelen subir a partir de ahora.")
    elif lead < lo:
        reasons.append("Ya estás en la recta final: esperar suele salir más caro.")
    elif lead <= hi:
        reasons.append(f"Estás en la ventana en la que suele haber buenos precios ({lo}–{hi} días antes).")
    else:
        score -= 1
        reasons.append(f"Aún falta mucho ({lead} días): suele haber precios parecidos o mejores entre {lo} y {hi} "
                       "días antes. Vigílalo y te avisamos.")
    if score >= 3:
        verdict, level = "¡Compra ya! Precio excelente", "buy"
    elif score >= 1:
        verdict, level = "Buen precio: buena opción para reservar", "good"
    elif score >= 0:
        verdict, level = "Precio normal: puedes vigilarlo", "watch"
    else:
        verdict, level = "Caro: espera o cambia de fecha", "wait"
    return {"verdict": verdict, "level": level, "reasons": reasons, "lead_days": lead,
            "percentile": round(pct_rank * 100) if pct_rank is not None else None,
            "window": [lo, hi], "long_haul": long_haul}


# ---------------------------------------------------------------------------
# MOTOR DE BÚSQUEDA: «Mejor día», «Explorar» y «Festivos» usan esta función
def _norm_params(p: dict, settings: dict, today: date) -> dict:
    lo, hi = nights_range(settings)
    trip = p.get("trip") or ("rt" if settings.get("trip_type") in ("rt", "both") else "ow")
    q = {
        "origins": [o.upper() for o in p.get("origins") or settings.get("origins") or []],
        "destinations": [d.upper() for d in p.get("destinations") or []],
        "trip": "rt" if trip == "rt" else "ow",
        "date_from": p.get("date_from") or (today + timedelta(days=1)).isoformat(),
        "date_to": p.get("date_to") or (today + timedelta(days=int(settings.get("max_days_ahead", 365)))).isoformat(),
        "min_nights": int(p.get("min_nights") or lo),
        "max_nights": int(p.get("max_nights") or hi),
        "return_from": p.get("return_from") or None,
        "return_to": p.get("return_to") or None,
        "weekdays": [int(x) for x in (p.get("weekdays") or [])],
        "return_weekdays": [int(x) for x in (p.get("return_weekdays") or [])],
        "direct_only": bool(p.get("direct_only", settings.get("direct_only", False))),
        "max_price": float(p["max_price"]) if p.get("max_price") not in (None, "") else None,
        "pax": max(1, int(p.get("pax") or settings.get("passengers", 1))),
        "baggage": p.get("baggage") or settings.get("baggage", "personal"),
        "mode": p.get("mode") or "days",
        "currency": settings.get("currency", "eur"),
    }
    if q["max_nights"] < q["min_nights"]:
        q["max_nights"] = q["min_nights"]
    if q["date_from"] < (today + timedelta(days=1)).isoformat():
        q["date_from"] = (today + timedelta(days=1)).isoformat()
    return q


MAX_REQUESTS = 400


def search(params: dict, job: dict = None, provider=None, today: date = None) -> dict:
    settings = db.get_settings()
    today = today or date.today()
    provider = provider or get_provider(settings)
    p = _norm_params(params, settings, today)
    d0, d1 = date.fromisoformat(p["date_from"]), date.fromisoformat(p["date_to"])
    routes = [(o, d) for o in p["origins"] for d in p["destinations"] if o != d]
    if not routes:
        return {"found": False, "error": "Indica al menos un origen y un destino distintos", "params": p}
    span_days = (d1 - d0).days
    # Explorar muchas rutas en un periodo largo: 1 petición por ruta ("any") si el proveedor lo soporta
    use_any = p["mode"] == "explore" and span_days > 62 and provider.name != "demo"
    months = ["any"] if use_any else months_between(d0, d1)
    est_requests = len(routes) * len(months)
    if provider.name != "demo" and est_requests > MAX_REQUESTS:
        return {"found": False, "params": p,
                "error": f"Búsqueda demasiado grande ({est_requests} peticiones). Reduce orígenes, destinos o fechas."}
    kw = {"currency": p["currency"], "trip": p["trip"], "direct_only": p["direct_only"],
          "min_nights": p["min_nights"], "max_nights": p["max_nights"]}
    ttl = float(settings.get("search_cache_hours", 3))
    delay = float(settings.get("request_delay_s", 0.5)) if provider.name != "demo" else 0
    errors, options = [], []
    if job is not None:
        job.update(total=len(routes), done=0)
    for o, d in routes:
        if job is not None:
            job["current"] = f"{o} → {d}"
        if provider.name == "demo" and p["mode"] == "days" and len(routes) <= 30:
            backfill_demo(o, d, settings, p["trip"])
        for m in months:
            try:
                data, hit = cached_fetch(provider, o, d, m, ttl, **kw)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{o}→{d} {m}: {e}")
                if "401" in str(e) or "no válido" in str(e):
                    return {"found": False, "error": str(e), "params": p}
                continue
            options += data
            if delay and not hit:
                time.sleep(delay)
        if job is not None:
            job["done"] += 1

    # --- filtros ---
    def ok(q):
        if not (p["date_from"] <= q.depart_date <= p["date_to"]):
            return False
        wd = date.fromisoformat(q.depart_date).weekday()
        if p["weekdays"] and wd not in p["weekdays"]:
            return False
        if p["trip"] == "rt":
            if not q.return_date or not (p["min_nights"] <= (q.nights or 0) <= p["max_nights"]):
                return False
            if p["return_from"] and q.return_date < p["return_from"]:
                return False
            if p["return_to"] and q.return_date > p["return_to"]:
                return False
            if p["return_weekdays"] and date.fromisoformat(q.return_date).weekday() not in p["return_weekdays"]:
                return False
        return True

    raw = [q for q in options if ok(q)]
    # Matriz flexible (ida y vuelta): mejor precio por día de salida x noches (antes de reducir)
    matrix = None
    if p["trip"] == "rt" and p["mode"] == "days":
        cells = {}
        for q in raw:
            k = (q.depart_date, q.nights)
            if k not in cells or q.price < cells[k]:
                cells[k] = q.price
        matrix = [{"date": k[0], "nights": k[1], "price": v} for k, v in cells.items()]
    # Reducir: la opción más barata por ruta y día (y en Explorar, las 15 mejores por destino)
    reduced = {}
    for q in raw:
        k = (q.origin, q.destination, q.depart_date)
        if k not in reduced or q.price < reduced[k].price:
            reduced[k] = q
    cand = list(reduced.values())
    if p["mode"] == "explore":
        per_dest = {}
        for q in sorted(cand, key=lambda q: q.price):
            lst = per_dest.setdefault(q.destination, [])
            if len(lst) < 15:
                lst.append(q)
        cand = [q for lst in per_dest.values() for q in lst]
    opts = [enrich(_q2d(q), p["pax"], p["baggage"], p["currency"]) for q in cand]
    if p["max_price"]:
        opts = [o for o in opts if o["price_pp_bags"] <= p["max_price"]]
    if not opts:
        return {"found": False, "errors": errors[:10], "routes": len(routes), "params": p, "provider": provider.name}
    key = "price_total"
    opts.sort(key=lambda r: (r[key], r["depart_date"]))
    all_prices = [o["price"] for o in opts]
    for o in opts:
        o["level"] = price_level(o["price"], all_prices)

    # Guardar en la BD (histórico) si coincide con lo que vigilan los escaneos
    s_lo, s_hi = nights_range(settings)
    if p["mode"] == "days" and not p["weekdays"] and not p["return_weekdays"] and not p["return_from"] \
            and (p["trip"] == "ow" or (p["min_nights"], p["max_nights"]) == (s_lo, s_hi)) \
            and p["direct_only"] == bool(settings.get("direct_only")):
        by_route = {}
        for q in raw:
            by_route.setdefault((q.origin, q.destination), []).append(q)
        for (o, d), qs in by_route.items():
            _save_route(o, d, p["trip"], cheapest_per_day(qs), today, settings, None, alerts=False)

    by_day = {}
    for o in opts:
        by_day.setdefault(o["depart_date"], o)
    days = sorted(by_day.values(), key=lambda r: r["depart_date"])
    median = statistics.median([r["price"] for r in days])
    by_month = {}
    for r in days:
        m = r["depart_date"][:7]
        if m not in by_month or r[key] < by_month[m][key]:
            by_month[m] = r
    by_dest = {}
    for o in opts:
        cur = by_dest.get(o["destination"])
        if cur is None:
            by_dest[o["destination"]] = dict(o, options=1)
        else:
            cur["options"] += 1
    dest_list = sorted(by_dest.values(), key=lambda r: r[key])
    for r in dest_list:
        c = catalog.COORDS.get(r["destination"])
        r["lat"], r["lon"] = (c if c else (None, None))
    seen, top = set(), []
    for o in opts:
        k = (o["depart_date"], o.get("return_date"), o["destination"])
        if k in seen:
            continue
        seen.add(k)
        top.append(o)
        if len(top) >= 20:
            break
    best = opts[0]
    for r in top + list(by_month.values()) + [best]:
        r["savings"] = 1 - r["price"] / median if median else 0
    hist = db.rows("SELECT price, seen_at FROM quote_history WHERE origin=? AND destination=? AND trip=? AND "
                   "depart_date=? ORDER BY seen_at", (best["origin"], best["destination"], p["trip"], best["depart_date"]))
    route_prices = [o["price"] for o in opts if o["origin"] == best["origin"] and o["destination"] == best["destination"]]
    return {
        "found": True,
        "params": p,
        "best": best,
        "top": top,
        "by_month": [by_month[k] for k in sorted(by_month)],
        "by_destination": dest_list[:150],
        "days": [{"date": r["depart_date"], "price": r["price"], "total": r[key], "origin": r["origin"],
                  "destination": r["destination"], "return_date": r.get("return_date"), "nights": r.get("nights")}
                 for r in days],
        "matrix": matrix,
        "median": median,
        "advice": advice(best["price"], best["depart_date"], best["origin"], best["destination"], route_prices,
                         today, hist),
        "history": hist,
        "routes": len(routes),
        "options": len(opts),
        "errors": errors[:10],
        "provider": provider.name,
    }


def grid(origin: str, dest: str, depart: str, ret: str = None, span: int = 3, provider=None) -> dict:
    """Matriz ida x vuelta alrededor de unas fechas (como la «cuadrícula de fechas» de Google)."""
    settings = db.get_settings()
    provider = provider or get_provider(settings)
    d = date.fromisoformat(depart)
    r = date.fromisoformat(ret) if ret else d + timedelta(days=nights_range(settings)[0])
    dep_days = [d + timedelta(days=i) for i in range(-span, span + 1) if d + timedelta(days=i) > date.today()]
    ret_days = [r + timedelta(days=i) for i in range(-span, span + 1)]
    n_min = max(1, (min(ret_days) - max(dep_days)).days)
    n_max = max(n_min, (max(ret_days) - min(dep_days)).days)
    kw = {"currency": settings.get("currency", "eur"), "trip": "rt", "direct_only": bool(settings.get("direct_only")),
          "min_nights": n_min, "max_nights": n_max}
    data = []
    for m in sorted({x.strftime("%Y-%m") for x in dep_days}):
        got, _ = cached_fetch(provider, origin.upper(), dest.upper(), m, float(settings.get("search_cache_hours", 3)), **kw)
        data += got
    cells = {}
    dep_set, ret_set = {x.isoformat() for x in dep_days}, {x.isoformat() for x in ret_days}
    for q in data:
        if q.depart_date in dep_set and q.return_date in ret_set:
            k = (q.depart_date, q.return_date)
            if k not in cells or q.price < cells[k]["price"]:
                cells[k] = {"depart": q.depart_date, "return": q.return_date, "price": q.price, "airline": q.airline}
    return {"departs": sorted(dep_set), "returns": sorted(ret_set), "cells": list(cells.values()),
            "selected": [depart, r.isoformat()]}
