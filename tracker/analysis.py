"""Análisis de ofertas: filtros de cada seguimiento, puntuación de chollos y datos para los gráficos."""
import statistics
from datetime import date, timedelta

from . import config as cfgmod

WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def nights(o):
    if not o.get("ret"):
        return None
    return (date.fromisoformat(o["ret"]) - date.fromisoformat(o["dep"])).days


def stay_ok(o, stay):
    n = nights(o)
    if n is None:
        return True
    dw, rw = date.fromisoformat(o["dep"]).weekday(), date.fromisoformat(o["ret"]).weekday()
    t = stay["type"]
    if t == "weekend":
        return dw == 4 and rw == 6 and n == 2
    if t == "long_weekend":
        return dw in (3, 4) and rw in (6, 0) and 2 <= n <= 4
    return stay["min"] <= n <= stay["max"]


def stops_ok(o, stops):
    return stops == "any" or (stops == "direct" and o["stops"] == 0) or (stops == "max1" and o["stops"] <= 1)


def matches(o, w, start: date, end: date):
    d = date.fromisoformat(o["dep"])
    if not (start <= d <= end):
        return False
    if w["weekdays"] and d.weekday() not in w["weekdays"]:
        return False
    return stay_ok(o, w["stay"]) and stops_ok(o, w["stops"])


def percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, max(0, int(round(q * (len(sorted_vals) - 1)))))
    return sorted_vals[i]


def score(price, baseline, rank):
    """0-100: cuánto más barato que lo habitual (55 %) y lo bien posicionado entre todas las fechas (45 %)."""
    disc = 1 - price / baseline if baseline else 0
    return max(0, min(100, round(100 * (0.55 * max(0.0, min(1.0, disc / 0.5)) + 0.45 * (1 - rank))))), disc


def analyze(w: dict, offers: list, history: list, alerts_cfg: dict, today: date = None) -> dict:
    today = today or date.today()
    start, end = cfgmod.window(w, today)
    cand = [o for o in offers if matches(o, w, start, end)]
    prices = sorted(o["price"] for o in cand)
    past = [h for h in history if h["day"] < today.isoformat()]
    hist_meds = [h["median"] for h in past[-30:] if h["median"]]
    cur_med = statistics.median(prices) if prices else None
    baseline = statistics.median(hist_meds) if len(hist_meds) >= 3 else cur_med
    prev_low = min((h["min"] for h in past if h["min"]), default=None)
    res = {"id": w["id"], "window": [start.isoformat(), end.isoformat()], "count": len(cand),
           "min": prices[0] if prices else None, "p10": percentile(prices, 0.1), "median": cur_med,
           "baseline": baseline, "history": history[-120:], "prev_low": prev_low}
    if not cand:
        res.update(top=[], calendar={}, months={}, destinations=[], origins={}, nights={}, weekdays=[], histogram=[],
                   best=None, trend=None)
        return res
    n = len(prices)
    import bisect
    # precio típico de las fechas cercanas (±3 semanas): un chollo tiene que serlo también para ESA época
    daily = {}
    for o in cand:
        daily.setdefault(o["dep"], []).append(o["price"])
    dmed = {k: statistics.median(v) for k, v in daily.items()}
    dkeys = sorted(dmed)
    local = {}
    for k in dkeys:
        d0 = date.fromisoformat(k)
        near = [dmed[x] for x in dkeys if abs((date.fromisoformat(x) - d0).days) <= 21]
        local[k] = statistics.median(near)
    for o in cand:
        lo = bisect.bisect_left(prices, o["price"])
        o["score"], o["discount"] = score(o["price"], baseline, lo / n)
        o["local_discount"] = 1 - o["price"] / local[o["dep"]] if local.get(o["dep"]) else 0
        o["nights"] = nights(o)
        o["top"] = None
    # «chollo top»: como mucho 3 por seguimiento, los mejores que cumplan las condiciones
    flagged = 0
    for o in sorted(cand, key=lambda o: (-o["score"], o["price"])):
        if flagged >= 3:
            break
        why = is_top(o, w, alerts_cfg, prev_low)
        if why and not any(x.get("top") and x["destination"] == o["destination"] for x in cand if x is not o):
            o["top"] = why
            flagged += 1
    by_score = sorted(cand, key=lambda o: (-o["score"], o["price"]))
    top, seen = [], set()
    for o in by_score:
        k = (o["destination"], o["dep"][:8] + str(int(o["dep"][8:]) // 7))   # variedad: 1 por destino y semana
        if k in seen:
            continue
        seen.add(k)
        top.append(o)
        if len(top) >= 12:
            break
    top += [o for o in cand if o.get("top") and o not in top]
    top.sort(key=lambda o: (not o.get("top"), -o["score"], o["price"]))
    cal, months, dests, origins, nmap, wd = {}, {}, {}, {}, {}, {}
    for o in cand:
        if o["dep"] not in cal or o["price"] < cal[o["dep"]]["price"]:
            cal[o["dep"]] = o
        m = o["dep"][:7]
        months[m] = min(months.get(m, o["price"]), o["price"])
        if o["destination"] not in dests or o["price"] < dests[o["destination"]]["price"]:
            dests[o["destination"]] = o
        origins[o["origin"]] = min(origins.get(o["origin"], o["price"]), o["price"])
        if o["nights"] is not None:
            nmap[o["nights"]] = min(nmap.get(o["nights"], o["price"]), o["price"])
        wd.setdefault(date.fromisoformat(o["dep"]).weekday(), []).append(o["price"])
    lo_p, hi_p = prices[0], prices[-1]
    bins = 14
    step = max(1.0, (hi_p - lo_p) / bins)
    hist = [0] * bins
    for p in prices:
        hist[min(bins - 1, int((p - lo_p) / step))] += 1
    yday = next((h for h in reversed(past) if h["min"]), None)
    res.update(
        best=min(cand, key=lambda o: o["price"]),
        top=top,
        calendar={k: {"p": v["price"], "s": v["score"]} for k, v in cal.items()},
        months=dict(sorted(months.items())),
        destinations=sorted(({"code": k, "price": v["price"], "offer": v} for k, v in dests.items()), key=lambda x: x["price"]),
        origins=dict(sorted(origins.items(), key=lambda x: x[1])),
        nights=dict(sorted(nmap.items())),
        weekdays=[{"d": WEEKDAYS[i], "median": statistics.median(wd[i]), "min": min(wd[i])} if i in wd else None for i in range(7)],
        histogram={"from": lo_p, "step": step, "counts": hist},
        trend=(prices[0] - yday["min"]) if yday else None,
    )
    return res


def is_top(o, w, a, prev_low):
    if w.get("max_price") and o["price"] <= w["max_price"]:
        return "precio objetivo"
    if (o["score"] >= a["min_score"] and o["discount"] * 100 >= a["min_discount"]
            and o.get("local_discount", 0) * 100 >= a["min_discount"] * 0.6):
        return "chollo"
    if prev_low and o["price"] < prev_low * 0.97 and o["discount"] >= 0.15:
        return "mínimo histórico"
    return None


def alert_candidate(res: dict, store, w: dict, a: dict, today: date):
    """La mejor oferta «top» del seguimiento si merece aviso (anti-spam: 1 aviso y luego solo si baja otro 10 %)."""
    tops = [o for o in res.get("top", []) if o.get("top")]
    if not tops:
        return None
    best = min(tops, key=lambda o: o["price"])
    last = store.last_alert(w["id"])
    if last:
        days = (today - date.fromisoformat(last["sent_at"][:10])).days
        if days < a["cooldown_days"] and best["price"] > last["price"] * 0.9:
            return None
    return best
