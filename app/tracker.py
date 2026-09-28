"""Escaneo de precios y detección de ofertas.

Tipos de alerta (de más a menos importante):
  record  -> precio más bajo visto nunca para esa ruta
  deal    -> chollo: X % por debajo del precio habitual (mediana del año) de la ruta
  target  -> por debajo del precio máximo que fijaste para ese destino
  drop    -> ha bajado X % desde la última vez que se miró ese mismo día
"""
import logging
import statistics
import threading
import time
from datetime import date, datetime, timedelta, timezone

from . import catalog, db
from .providers import get_provider

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

_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

scan_lock = threading.Lock()
progress = {"running": False, "done": 0, "total": 0, "current": ""}


def fmt_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]} {d.year}"


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


def cheapest_per_day(quotes):
    best = {}
    for q in quotes:
        cur = best.get(q.depart_date)
        if cur is None or q.price < cur.price:
            best[q.depart_date] = q
    return best


def detect_deals(new_quotes: dict, existing: dict, *, today: date, settings: dict,
                 max_price=None, history_min=None, last_alerts=None):
    """Lógica pura (sin BD) que decide qué días merecen una alerta.

    new_quotes: {fecha: Quote}; existing: {fecha: {"price":..}} precios anteriores
    history_min: mínimo de escaneos anteriores de la ruta (None si no hay histórico)
    last_alerts: {fecha: precio del último aviso} para no repetir avisos
    Devuelve una lista de dicts ordenada de mejor a peor.
    """
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
        kinds = []
        ref = None
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
            continue  # ya avisamos de este día a un precio parecido
        kind = max(kinds, key=KIND_PRIORITY.get)
        savings = (1 - q.price / median) if median else 0
        found.append({"quote": q, "kind": kind, "kinds": kinds, "ref_price": ref, "median": median,
                      "prev_price": prev, "savings": savings, "lead": lead})
    found.sort(key=lambda a: (-KIND_PRIORITY[a["kind"]], a["quote"].price))
    return found


def build_message(alert, currency="eur") -> str:
    q = alert["quote"]
    dest = catalog.info(q.destination)
    parts = [f"{q.origin} → {dest['name']} ({q.destination})", fmt_date(q.depart_date)]
    if q.return_date:
        parts[-1] += f" – vuelta {fmt_date(q.return_date)}"
    price = fmt_price(q.price, currency)
    extra = []
    if alert.get("median"):
        pct = round(alert["savings"] * 100)
        if pct > 0:
            extra.append(f"−{pct}% vs. habitual {fmt_price(alert['median'], currency)}")
    if alert.get("prev_price") and "drop" in alert["kinds"]:
        extra.append(f"antes {fmt_price(alert['prev_price'], currency)}")
    msg = f"{KIND_LABELS[alert['kind']]}: " + " · ".join(parts) + f" · {price}"
    if extra:
        msg += " (" + ", ".join(extra) + ")"
    if q.transfers is not None:
        msg += " · directo" if q.transfers == 0 else f" · {q.transfers} escala(s)"
    return msg


def _save_route(origin, destination, best: dict, today: date, settings: dict, max_price,
                alerts: bool = True, now: str = None):
    """Guarda precios (y su histórico de cambios), calcula alertas y devuelve las nuevas."""
    now = now or db.now_iso()
    existing = {r["depart_date"]: r for r in db.rows(
        "SELECT * FROM quotes WHERE origin=? AND destination=?", (origin, destination))}
    hist = db.one("SELECT MIN(min_price) AS m, COUNT(*) AS n FROM route_stats WHERE origin=? AND destination=?",
                  (origin, destination))
    history_min = hist["m"] if hist and hist["n"] >= 2 else None
    last_alerts = {}
    for r in db.rows("SELECT depart_date, MIN(price) AS p FROM alerts WHERE origin=? AND destination=? "
                     "AND depart_date>=? GROUP BY depart_date", (origin, destination, today.isoformat())):
        last_alerts[r["depart_date"]] = r["p"]

    found = []
    if alerts:
        found = detect_deals(best, existing, today=today, settings=settings, max_price=max_price,
                             history_min=history_min, last_alerts=last_alerts)
        # Anti-spam: tras avisar de una ruta, solo volvemos a avisar si aparece algo
        # claramente MEJOR que lo ya avisado en los últimos 7 días.
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).replace(microsecond=0).isoformat()
        recent = db.one("SELECT MIN(price) AS p FROM alerts WHERE origin=? AND destination=? AND created_at>=? "
                        "AND depart_date>=? AND kind NOT LIKE 'watch%'",
                        (origin, destination, week_ago, today.isoformat()))
        if recent and recent["p"] is not None:
            limit_price = recent["p"] * (1 - float(settings.get("realert_pct", 5)) / 100)
            found = [a for a in found if a["quote"].price <= limit_price]
        found = found[: int(settings.get("max_alerts_per_route", 3))]

    with db.connect() as c:
        for d, q in best.items():
            old = existing.get(d)
            if not old or old["price"] != q.price:
                c.execute("INSERT INTO quote_history(origin, destination, depart_date, price, prev_price, seen_at) "
                          "VALUES (?,?,?,?,?,?)", (origin, destination, d, q.price, old["price"] if old else None, now))
            if old:
                prev = old["price"] if old["price"] != q.price else old["prev_price"]
                lowest = min(old["lowest_price"] or q.price, q.price)
                c.execute(
                    "UPDATE quotes SET price=?, prev_price=?, lowest_price=?, return_date=?, airline=?, "
                    "transfers=?, link=?, provider=?, updated_at=? WHERE origin=? AND destination=? AND depart_date=?",
                    (q.price, prev, lowest, q.return_date, q.airline, q.transfers, q.link, q.provider, now,
                     origin, destination, d))
            else:
                c.execute(
                    "INSERT INTO quotes(origin, destination, depart_date, return_date, price, prev_price, lowest_price,"
                    " airline, transfers, link, provider, first_seen, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (origin, destination, d, q.return_date, q.price, None, q.price, q.airline, q.transfers, q.link,
                     q.provider, now, now))
        prices = [q.price for q in best.values()]
        if prices:
            c.execute("INSERT INTO route_stats(origin, destination, scanned_at, min_price, median_price, count) "
                      "VALUES (?,?,?,?,?,?)",
                      (origin, destination, now, min(prices), statistics.median(prices), len(prices)))
        new_alerts = []
        currency = settings.get("currency", "eur")
        for a in found:
            q = a["quote"]
            msg = build_message(a, currency)
            cur = c.execute(
                "INSERT INTO alerts(created_at, kind, origin, destination, depart_date, return_date, price, ref_price,"
                " message, link) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (now, a["kind"], origin, destination, q.depart_date, q.return_date, q.price, a["ref_price"], msg,
                 q.link))
            new_alerts.append({"id": cur.lastrowid, "kind": a["kind"], "message": msg, "link": q.link,
                               "price": q.price, "savings": a["savings"], "origin": origin,
                               "destination": destination, "depart_date": q.depart_date,
                               "return_date": q.return_date})
    return new_alerts




def cleanup(today: date):
    stale = (datetime.now(timezone.utc) - timedelta(days=10)).replace(microsecond=0).isoformat()
    with db.connect() as c:
        c.execute("DELETE FROM quotes WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quotes WHERE updated_at < ?", (stale,))
        c.execute("DELETE FROM watches WHERE depart_date < ?", (today.isoformat(),))
        c.execute("DELETE FROM quote_history WHERE depart_date < ?",
                  ((today - timedelta(days=30)).isoformat(),))


def _fetch_route(provider, origin, dest, months, settings, errors, delay=0.0):
    quotes = []
    for month in months:
        try:
            quotes += provider.fetch_month(origin, dest, month,
                                           currency=settings.get("currency", "eur"),
                                           one_way=bool(settings.get("one_way", True)),
                                           direct_only=bool(settings.get("direct_only", False)))
        except Exception as e:  # noqa: BLE001 - seguimos con el resto de meses/rutas
            log.warning("Error %s→%s %s: %s", origin, dest, month, e)
            errors.append(f"{origin}→{dest} {month}: {e}")
            if "401" in str(e) or "no válido" in str(e):
                raise
        if delay:
            time.sleep(delay)
    return cheapest_per_day(quotes)


def backfill_demo(origin: str, dest: str, settings: dict, days: int = 45, step: int = 3):
    """Solo modo demo: genera unas semanas de histórico simulado para que los
    gráficos y la detección de mínimos funcionen desde el principio."""
    from .providers.demo import DemoProvider

    if db.one("SELECT 1 AS x FROM route_stats WHERE origin=? AND destination=? LIMIT 1", (origin, dest)):
        return
    now = datetime.now(timezone.utc)
    for k in range(days, 0, -step):
        t = now - timedelta(days=k)
        prov = DemoProvider(now=t)
        months = month_list(t.date(), int(settings.get("months_ahead", 12)))
        best = _fetch_route(prov, origin, dest, months, settings, [])
        _save_route(origin, dest, best, t.date(), settings, None, alerts=False,
                    now=t.replace(microsecond=0).isoformat())


def check_watches(today: date, settings: dict):
    """Compara los vuelos vigilados con el último precio y crea alertas si cambian."""
    pct = float(settings.get("watch_change_pct", 3)) / 100
    currency = settings.get("currency", "eur")
    out = []
    for w in db.rows("SELECT * FROM watches WHERE depart_date >= ?", (today.isoformat(),)):
        q = db.one("SELECT * FROM quotes WHERE origin=? AND destination=? AND depart_date=?",
                   (w["origin"], w["destination"], w["depart_date"]))
        if not q:
            continue
        last = w["last_price"]
        kind = None
        if last and q["price"] <= last * (1 - pct):
            kind = "watch_down"
        elif last and q["price"] >= last * (1 + pct):
            kind = "watch_up"
        if w["target_price"] and q["price"] <= w["target_price"] and (not last or last > w["target_price"]):
            kind = "watch_down"
        if kind:
            name = catalog.info(w["destination"])["name"]
            diff = q["price"] - (last or q["price"])
            msg = (f"{KIND_LABELS[kind]}: {w['origin']} → {name} ({w['destination']}) · {fmt_date(w['depart_date'])}"
                   f" · {fmt_price(q['price'], currency)} ({'+' if diff > 0 else '−'}{fmt_price(abs(diff), currency)}"
                   f" desde {fmt_price(last, currency)})")
            aid = db.execute(
                "INSERT INTO alerts(created_at, kind, origin, destination, depart_date, return_date, price, ref_price,"
                " message, link) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (db.now_iso(), kind, w["origin"], w["destination"], w["depart_date"], q.get("return_date"),
                 q["price"], last, msg, q["link"]))
            out.append({"id": aid, "kind": kind, "message": msg, "link": q["link"], "price": q["price"],
                        "savings": (1 - q["price"] / last) if last else 0, "origin": w["origin"],
                        "destination": w["destination"], "depart_date": w["depart_date"],
                        "return_date": q.get("return_date")})
        if q["price"] != last:
            db.execute("UPDATE watches SET last_price=? WHERE id=?", (q["price"], w["id"]))
    return out


def run_scan(provider=None, today: date = None, notify: bool = True) -> dict:
    """Escanea todas las rutas (orígenes x destinos favoritos + vuelos vigilados) y genera alertas."""
    if not scan_lock.acquire(blocking=False):
        return {"status": "busy"}
    scan_id = None
    try:
        from . import notifier  # import tardío para evitar ciclos

        settings = db.get_settings()
        today = today or date.today()
        provider = provider or get_provider(settings)
        origins = [o.upper() for o in settings.get("origins") or []]
        dests = db.rows("SELECT * FROM destinations WHERE enabled=1 ORDER BY name")
        months = month_list(today, int(settings.get("months_ahead", 12)))
        delay = float(settings.get("request_delay_s", 0.5)) if provider.name != "demo" else 0
        scan_id = db.execute("INSERT INTO scans(started_at, status, provider) VALUES (?, 'running', ?)",
                             (db.now_iso(), provider.name))
        routes = [(o, d["code"], months, d.get("max_price")) for o in origins for d in dests if o != d["code"]]
        covered = {(o, d) for o, d, _, _ in routes}
        # Vuelos vigilados de rutas que no están en favoritos: solo su mes
        extra = {}
        for w in db.rows("SELECT * FROM watches WHERE depart_date >= ?", (today.isoformat(),)):
            if (w["origin"], w["destination"]) not in covered:
                extra.setdefault((w["origin"], w["destination"]), set()).add(w["depart_date"][:7])
        routes += [(o, d, sorted(ms), None) for (o, d), ms in extra.items()]

        progress.update(running=True, done=0, total=len(routes), current="")
        all_alerts, n_quotes, errors = [], 0, []
        for origin, dest, route_months, max_price in routes:
            progress["current"] = f"{origin} → {dest}"
            if provider.name == "demo":
                backfill_demo(origin, dest, settings)
            best = _fetch_route(provider, origin, dest, route_months, settings, errors, delay)
            n_quotes += len(best)
            if best:
                all_alerts += _save_route(origin, dest, best, today, settings, max_price,
                                          alerts=(origin, dest) in covered)
            progress["done"] += 1
        all_alerts += check_watches(today, settings)
        cleanup(today)
        sent = {}
        if notify and all_alerts:
            sent = notifier.send_digest(all_alerts, settings)
        status = "ok" if not errors else ("partial" if n_quotes else "error")
        db.execute("UPDATE scans SET finished_at=?, status=?, routes=?, quotes=?, alerts=?, error=? WHERE id=?",
                   (db.now_iso(), status, len(routes), n_quotes, len(all_alerts),
                    "\n".join(errors[:20]) or None, scan_id))
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
# Panel: mejor precio actual por destino
def _window(settings, today):
    start = (today + timedelta(days=int(settings.get("min_days_ahead", 14)))).isoformat()
    end = (today + timedelta(days=int(settings.get("max_days_ahead", 365)))).isoformat()
    return start, end


def current_deals(limit: int = 30, today: date = None):
    """Mejor precio actual por destino (entre todos los orígenes) con su ahorro."""
    settings = db.get_settings()
    today = today or date.today()
    start, end = _window(settings, today)
    origins = [o.upper() for o in settings.get("origins") or []]
    if not origins:
        return []
    out = []
    for dest in db.rows("SELECT * FROM destinations WHERE enabled=1"):
        qs = db.rows("SELECT * FROM quotes WHERE destination=? AND depart_date BETWEEN ? AND ? "
                     f"AND origin IN ({','.join('?' * len(origins))}) ORDER BY price",
                     (dest["code"], start, end, *origins))
        if not qs:
            continue
        best = qs[0]
        route_prices = [q["price"] for q in qs if q["origin"] == best["origin"]]
        median = statistics.median(route_prices) if route_prices else None
        out.append({**best, "name": dest["name"], "country": dest["country"], "max_price": dest["max_price"],
                    "median": median, "savings": (1 - best["price"] / median) if median else 0,
                    "date_label": fmt_date(best["depart_date"])})
    out.sort(key=lambda x: -x["savings"])
    return out[:limit]


def recent_changes(limit: int = 50, min_pct: float = 5.0, favorites_only: bool = True):
    """Últimos cambios de precio (subidas y bajadas) detectados."""
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
# Consejo "¿compro ya o espero?" (heurístico, basado en datos y patrones típicos)
def advice(price: float, depart_date: str, origin: str, dest: str, route_prices, today: date = None,
           history=None, google=None) -> dict:
    today = today or date.today()
    lead = (date.fromisoformat(depart_date) - today).days
    long_haul = catalog.is_long_haul(origin, dest)
    lo, hi = (60, 170) if long_haul else (21, 90)
    route_prices = sorted(route_prices or [])
    pct_rank = (sum(1 for p in route_prices if p < price) / len(route_prices)) if route_prices else None
    reasons = []
    score = 0
    if pct_rank is not None:
        if pct_rank <= 0.05:
            score += 3
            reasons.append("Está entre el 5 % de días más baratos del año para esta ruta.")
        elif pct_rank <= 0.2:
            score += 2
            reasons.append("Está entre el 20 % de días más baratos del año.")
        elif pct_rank <= 0.5:
            score += 1
            reasons.append("Precio por debajo de la mitad de los días del año.")
        else:
            score -= 1
            reasons.append("Hay bastantes días más baratos para esta ruta: mira el calendario.")
    if history:
        hist_min = min(h["price"] for h in history)
        if price <= hist_min:
            score += 2
            reasons.append("Es el precio más bajo que hemos registrado para esta fecha.")
        last = history[-1]["price"] if history else None
        if len(history) >= 2 and history[-1]["price"] > history[-2]["price"]:
            reasons.append("Ojo: el último cambio para esta fecha fue una subida.")
        elif last is not None and len(history) >= 2:
            reasons.append("La última variación para esta fecha fue una bajada.")
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
        reasons.append(f"Estás en la ventana en la que suele haber buenos precios para este tipo de vuelo "
                       f"({lo}–{hi} días antes).")
    else:
        score -= 1
        reasons.append(f"Aún falta mucho ({lead} días): normalmente hay precios parecidos o mejores entre "
                       f"{lo} y {hi} días antes. Vigílalo y te avisamos.")
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
# Buscador "Mejor día": ¿qué día puedo ir más barato de A a B?
search_jobs = {}


def best_day_search(origins, destinations, date_from: str = None, date_to: str = None, job: dict = None,
                    provider=None, today: date = None) -> dict:
    settings = db.get_settings()
    today = today or date.today()
    provider = provider or get_provider(settings)
    date_from = date_from or (today + timedelta(days=1)).isoformat()
    date_to = date_to or (today + timedelta(days=int(settings.get("max_days_ahead", 365)))).isoformat()
    d0, d1 = date.fromisoformat(date_from), date.fromisoformat(date_to)
    months = [m for m in month_list(today, int(settings.get("months_ahead", 12)) + 1)
              if f"{m}-31" >= date_from and f"{m}-01" <= date_to]
    origins = [o.upper() for o in origins if o]
    destinations = [d.upper() for d in destinations if d]
    routes = [(o, d) for o in origins for d in destinations if o != d]
    cache_h = float(settings.get("search_cache_hours", 3))
    fresh_since = (datetime.now(timezone.utc) - timedelta(hours=cache_h)).replace(microsecond=0).isoformat()
    delay = float(settings.get("request_delay_s", 0.5)) if provider.name != "demo" else 0
    errors = []
    if job is not None:
        job.update(total=len(routes), done=0)
    for o, d in routes:
        if job is not None:
            job["current"] = f"{o} → {d}"
        recent = db.one("SELECT COUNT(*) AS n FROM quotes WHERE origin=? AND destination=? AND updated_at>=?",
                        (o, d, fresh_since))["n"]
        if not recent:
            if provider.name == "demo":
                backfill_demo(o, d, settings)
            best = _fetch_route(provider, o, d, months, settings, errors, delay)
            if best:
                _save_route(o, d, best, today, settings, None, alerts=False)
        if job is not None:
            job["done"] += 1

    ph_o, ph_d = ",".join("?" * len(origins)), ",".join("?" * len(destinations))
    rows = db.rows(f"SELECT * FROM quotes WHERE origin IN ({ph_o}) AND destination IN ({ph_d}) "
                   "AND depart_date BETWEEN ? AND ? ORDER BY price, depart_date",
                   (*origins, *destinations, d0.isoformat(), d1.isoformat())) if routes else []
    if not rows:
        return {"found": False, "errors": errors[:10], "routes": len(routes)}
    # Mejor precio por día (entre todos los orígenes/destinos)
    by_day = {}
    for r in rows:
        if r["depart_date"] not in by_day:
            by_day[r["depart_date"]] = r
    days = sorted(by_day.values(), key=lambda r: r["depart_date"])
    prices = [r["price"] for r in days]
    median = statistics.median(prices)
    top = sorted(by_day.values(), key=lambda r: (r["price"], r["depart_date"]))[:15]
    by_month = {}
    for r in days:
        m = r["depart_date"][:7]
        if m not in by_month or r["price"] < by_month[m]["price"]:
            by_month[m] = r
    best = top[0]
    hist = db.rows("SELECT price, seen_at FROM quote_history WHERE origin=? AND destination=? AND depart_date=? "
                   "ORDER BY seen_at", (best["origin"], best["destination"], best["depart_date"]))
    route_prices = [r["price"] for r in rows if r["origin"] == best["origin"] and r["destination"] == best["destination"]]
    from .providers import booking_links
    for r in top + list(by_month.values()):
        r["date_label"] = fmt_date(r["depart_date"])
        r["dest_name"] = catalog.info(r["destination"])["name"]
        r["savings"] = 1 - r["price"] / median if median else 0
        r["links"] = booking_links(r["origin"], r["destination"], r["depart_date"], r.get("return_date"))
    return {
        "found": True,
        "best": best,
        "top": top,
        "by_month": [by_month[k] for k in sorted(by_month)],
        "days": [{"date": r["depart_date"], "price": r["price"], "origin": r["origin"],
                  "destination": r["destination"]} for r in days],
        "median": median,
        "advice": advice(best["price"], best["depart_date"], best["origin"], best["destination"],
                         route_prices, today, hist),
        "history": hist,
        "routes": len(routes),
        "errors": errors[:10],
        "provider": provider.name,
    }
