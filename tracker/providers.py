"""Fuentes de precios.

* Travelpayouts / Aviasales Data API (real, gratis): precios encontrados en búsquedas recientes.
  Necesita el secret TRAVELPAYOUTS_TOKEN en GitHub.
* Demo: precios simulados realistas (temporadas, día de la semana, antelación, ofertas…)
  para ver la web funcionando sin clave.

Cada oferta es un dict:
  origin, destination, dep (AAAA-MM-DD), ret (AAAA-MM-DD o None), price, stops (máx. de ida/vuelta),
  airline (código IATA), duration (min de la ida), dep_time ("HH:MM")
"""
import hashlib
import logging
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

import requests

from . import airports

log = logging.getLogger(__name__)
API_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"


class ProviderError(RuntimeError):
    pass


class Travelpayouts:
    name = "travelpayouts"

    def __init__(self, token: str, session=None, timeout: int = 30):
        if not token:
            raise ProviderError("Falta el token de Travelpayouts")
        self.token, self.timeout = token, timeout
        self.http = session or requests.Session()

    def month(self, origin, destination, month, *, trip="rt", direct=False, currency="eur"):
        params = {"origin": origin, "destination": destination, "departure_at": month,
                  "one_way": "false" if trip == "rt" else "true", "direct": "true" if direct else "false",
                  "currency": currency, "market": "es", "sorting": "price", "unique": "false",
                  "limit": 1000, "page": 1}
        r = self.http.get(API_URL, params=params, headers={"X-Access-Token": self.token}, timeout=self.timeout)
        if r.status_code == 401:
            raise ProviderError("Token de Travelpayouts no válido (401)")
        if r.status_code == 429:
            raise ProviderError("Límite de peticiones de Travelpayouts (429)")
        r.raise_for_status()
        payload = r.json()
        if not payload.get("success", True):
            raise ProviderError(str(payload.get("error") or payload))
        return parse(payload, origin, destination, trip)


def _int(v):
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def parse(payload, origin, destination, trip):
    out = []
    for it in payload.get("data") or []:
        dep = (it.get("departure_at") or "")[:10]
        if not dep or it.get("price") is None:
            continue
        ret = (it.get("return_at") or "")[:10] or None
        if (trip == "rt") != bool(ret):
            continue
        stops = max(_int(it.get("transfers")) or 0, _int(it.get("return_transfers")) or 0)
        dur = _int(it.get("duration_to"))
        if dur is None and not ret:
            dur = _int(it.get("duration"))
        t = it.get("departure_at") or ""
        out.append({"origin": origin, "destination": destination, "dep": dep, "ret": ret,
                    "price": float(it["price"]), "stops": stops, "airline": it.get("airline") or "",
                    "duration": dur, "dep_time": t[11:16] if len(t) >= 16 else None})
    return out


# ---------------------------------------------------------------------------
# Precios simulados (modo demo)
def _u(*parts) -> float:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


SEASON = {  # factor por mes (ene..dic) según región de destino
    "EU": [0.78, 0.74, 0.86, 1.0, 1.02, 1.18, 1.38, 1.42, 1.06, 0.92, 0.80, 1.12],
    "AF": [0.95, 0.9, 0.95, 1.0, 0.95, 1.05, 1.2, 1.25, 1.0, 0.95, 0.95, 1.15],
    "ME": [1.0, 0.95, 1.0, 1.05, 0.9, 0.85, 1.0, 1.05, 0.9, 1.0, 1.05, 1.2],
    "NA": [0.85, 0.82, 0.95, 1.0, 1.05, 1.25, 1.35, 1.3, 1.0, 0.95, 0.95, 1.2],
    "LA": [1.2, 1.05, 0.95, 1.0, 0.85, 0.9, 1.15, 1.2, 0.85, 0.85, 0.95, 1.3],
    "AS": [1.0, 1.05, 0.95, 1.0, 0.9, 0.95, 1.15, 1.2, 0.9, 0.95, 1.0, 1.15],
    "OC": [1.2, 1.1, 1.0, 0.95, 0.9, 0.95, 1.05, 1.0, 0.95, 1.0, 1.05, 1.3],
}
DOW = [0.92, 0.88, 0.9, 1.0, 1.15, 1.08, 1.06]
SHORT = ["FR", "VY", "U2", "IB", "UX", "W6", "TP", "AF", "LH", "KL"]
LONG = ["IB", "UX", "AF", "KL", "LH", "TK", "EK", "QR", "AA", "DL", "LA", "AR"]
SLOTS = ["06:10", "07:25", "08:40", "10:15", "12:30", "14:05", "15:50", "17:35", "19:20", "21:10", "23:40"]


class Demo:
    name = "demo"

    def __init__(self, now: datetime = None):
        self.now = now or datetime.now(timezone.utc)
        self.today = self.now.date()
        self.week = self.now.isocalendar()[1]

    def leg(self, o, d, day: date, direct=False):
        lead = (day - self.today).days
        if lead < 1:
            return None
        km = airports.distance_km(o, d)
        long_haul = km > 3800
        base = (25 + 0.055 * km) if km < 800 else (35 + 0.045 * km) if km < 3800 else (120 + 0.042 * km)
        base *= 0.8 + 0.4 * _u("route", o, d)
        region = airports.info(d).get("region") or "EU"
        p = base * SEASON.get(region, SEASON["EU"])[day.month - 1] * DOW[day.weekday()]
        p *= 1.35 if lead < 14 else 1.12 if lead < 30 else 1.0 if lead < 120 else 1.06
        p *= 0.85 + 0.3 * _u("demand", o, d, day, self.week)
        if _u("sale", o, d, day.month, self.week) < 0.08:
            p *= 0.68                       # rebaja temporal
        if _u("flash", o, d, day, self.today) < 0.004:
            p *= 0.5                        # error de tarifa (rarísimo)
        stops = 0
        if long_haul:
            if direct:
                if _u("direct", o, d) > 0.55:
                    return None
                p *= 1.15
            else:
                stops = 0 if _u("d", o, d, day) < 0.3 else (1 if _u("s", o, d, day) < 0.8 else 2)
                p *= (1.0, 0.88, 0.8)[stops]
        elif km > 2200 and not direct and _u("s", o, d, day) < 0.35:
            stops, p = 1, p * 0.9
        pool = LONG if long_haul else SHORT
        airline = pool[int(_u("al", o, d, day) * len(pool))]
        dur = int(round((km / 780 * 60 + 35) * (1 + 0.12 * stops) + sum(70 + 160 * _u("lay", o, d, day, i) for i in range(stops))))
        return {"price": round(p), "stops": stops, "airline": airline, "duration": dur,
                "dep_time": SLOTS[int(_u("slot", o, d, day) * len(SLOTS))]}

    def month(self, origin, destination, month, *, trip="rt", direct=False, currency="eur"):
        y, m = map(int, month.split("-"))
        out = []
        for dd in range(1, monthrange(y, m)[1] + 1):
            day = date(y, m, dd)
            a = self.leg(origin, destination, day, direct)
            if not a:
                continue
            if trip == "ow":
                out.append({"origin": origin, "destination": destination, "dep": day.isoformat(), "ret": None,
                            "price": a["price"], "stops": a["stops"], "airline": a["airline"],
                            "duration": a["duration"], "dep_time": a["dep_time"]})
                continue
            for n in range(1, 22):
                if _u("combo", origin, destination, day, n) > 0.55 and n not in (2, 3):
                    continue               # la API no devuelve todas las combinaciones
                r = day + timedelta(days=n)
                b = self.leg(destination, origin, r, direct)
                if not b:
                    continue
                out.append({"origin": origin, "destination": destination, "dep": day.isoformat(), "ret": r.isoformat(),
                            "price": round((a["price"] + b["price"]) * 0.95), "stops": max(a["stops"], b["stops"]),
                            "airline": a["airline"], "duration": a["duration"], "dep_time": a["dep_time"]})
        return out


def get_provider(token: str = ""):
    return Travelpayouts(token) if token else Demo()


def booking_links(o, d, dep, ret=None):
    """Enlaces para comprobar y reservar en buscadores."""
    dd = date.fromisoformat(dep)
    rr = date.fromisoformat(ret) if ret else None
    avia = f"https://www.aviasales.com/search/{o}{dd:%d%m}{d}{rr.strftime('%d%m') if rr else ''}1"
    sky = f"https://www.skyscanner.es/transporte/vuelos/{o.lower()}/{d.lower()}/{dd:%y%m%d}/" + (f"{rr:%y%m%d}/" if rr else "")
    q = f"Flights from {o} to {d} on {dep}" + (f" returning {ret}" if ret else " one way")
    google = "https://www.google.com/travel/flights?hl=es&curr=EUR&q=" + requests.utils.quote(q)
    return {"Google Flights": google, "Skyscanner": sky, "Aviasales": avia}
