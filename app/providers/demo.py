"""Proveedor de demostración con un modelo de precios realista.

No es "azar": reproduce los patrones conocidos de las tarifas aéreas para que la
app se comporte como con datos reales mientras no tengas una API configurada.

Factores que modela:
  * Distancia real entre ciudades (fórmula por tramo: low-cost corto, medio, largo radio).
  * Competencia de la ruta (rutas low-cost muy disputadas son más baratas) y si hay
    vuelo directo desde el hub (MAD/BCN) o hace falta escala desde otro aeropuerto.
  * Temporada por región del destino + destinos de playa (verano), de sol en invierno
    (Canarias, Madeira, Egipto...) y rutas estacionales (islas griegas, Laponia).
  * Festivos españoles: Semana Santa (calculada cada año), Navidad/Reyes, puentes
    (12-oct, 1-nov, 6/8-dic), 15-ago e inicio de julio/agosto.
  * Día de la semana (martes/miércoles más baratos; viernes y domingo más caros).
  * Curva de antelación: caro con mucha antelación, "zona buena" a 1–3 meses (corto)
    o 2–6 meses (largo), y subida fuerte en las últimas 3 semanas.
  * Evolución en el tiempo: los precios derivan suavemente cada pocos días, con
    rebajas de aerolínea que duran una semana y alguna tarifa flash/error rara.
  * Escalones de tarifa (29, 34, 39… / 189, 199…), como en las webs reales.
Todo es determinista para un instante dado: dos escaneos seguidos dan el mismo
precio salvo que "haya pasado algo", igual que en la realidad.
"""
import hashlib
import math
import random
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import List

from .. import catalog
from .base import PriceProvider, Quote, booking_links

# Temporada por región (multiplicador por mes 1..12) vista desde España
SEASON = {
    "EU": [0.80, 0.78, 0.90, 1.02, 1.00, 1.12, 1.30, 1.36, 1.05, 0.93, 0.80, 1.00],
    "AF": [0.85, 0.85, 0.95, 1.05, 0.95, 1.05, 1.25, 1.30, 1.00, 0.95, 0.85, 1.05],
    "ME": [1.00, 0.95, 1.00, 1.05, 0.90, 0.85, 0.95, 0.95, 0.90, 1.00, 1.05, 1.20],
    "NA": [0.82, 0.80, 0.90, 1.00, 1.05, 1.20, 1.30, 1.25, 0.95, 0.90, 0.85, 1.08],
    "LA": [1.05, 0.85, 0.90, 0.95, 0.88, 1.10, 1.35, 1.30, 0.88, 0.90, 0.95, 1.35],
    "AS": [0.95, 0.90, 0.95, 1.00, 0.90, 0.95, 1.20, 1.25, 0.90, 0.95, 0.92, 1.15],
    "OC": [1.00, 0.90, 0.90, 0.90, 0.90, 1.00, 1.10, 1.05, 0.95, 1.00, 1.05, 1.30],
}
BEACH = [0.60, 0.60, 0.72, 0.90, 1.00, 1.30, 1.60, 1.70, 1.15, 0.85, 0.62, 0.70]
WINTER_SUN = [1.15, 1.10, 1.05, 1.00, 0.85, 0.88, 1.10, 1.20, 0.90, 1.00, 1.10, 1.28]
DOW = [1.00, 0.90, 0.90, 1.02, 1.15, 0.97, 1.10]  # lun..dom
AIRLINES_SHORT = ["VY", "FR", "IB", "UX", "U2", "V7", "I2", "W6", "FR", "VY"]
CANARY_AIRLINES = ["NT", "VY", "FR", "UX", "IB", "I2"]
AIRLINES_LONG = {"NA": ["IB", "UX", "DL", "AA", "UA"], "LA": ["IB", "UX", "AV", "LA", "AM", "CM"],
                 "AS": ["QR", "EK", "TK", "LH", "AF", "SQ"], "ME": ["EK", "QR", "TK", "EY"],
                 "OC": ["QR", "EK", "SQ"], "AF": ["ET", "TK", "AF", "KL", "QR"], "EU": ["IB", "UX"]}
CUR = {"eur": 1.0, "usd": 1.08, "gbp": 0.85}


def _h(*parts) -> int:
    return int(hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).hexdigest(), 16)


def _u(*parts) -> float:
    """Uniforme [0,1) determinista."""
    return (_h(*parts) % 10_000_000) / 10_000_000


def easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = ((h + l_ - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def holiday_factor(d: date) -> float:
    f = 1.0
    e = easter(d.year)
    delta = (e - d).days
    if 3 <= delta <= 7:          # salida de Semana Santa (sáb-miér antes)
        f += 0.35
    elif 0 <= delta <= 2 or -1 <= delta < 0:
        f += 0.15
    if (d.month == 12 and 18 <= d.day <= 24) or (d.month == 12 and d.day >= 30):
        f += 0.38
    if d.month == 1 and 2 <= d.day <= 7:
        f += 0.20                # vuelta de Reyes
    for (m, dd) in [(10, 11), (10, 12), (10, 31), (11, 1), (12, 5), (12, 6), (12, 7), (8, 14), (8, 15)]:
        if d.month == m and d.day == dd:
            f += 0.15
    if (d.month in (7, 8) and d.day <= 3) or (d.month == 6 and d.day >= 26):
        f += 0.10                # arranque de vacaciones
    return f


def lead_factor(lead: int, long_haul: bool) -> float:
    opt, width, far = (110, 60, 290) if long_haul else (55, 35, 210)
    f = 1.0
    f += 0.45 * math.exp(-lead / 9)                        # últimos días: se dispara
    f += 0.18 * math.exp(-lead / 30)                       # últimas semanas: sube
    f -= 0.07 * math.exp(-((lead - opt) / width) ** 2)     # ventana buena
    f += 0.10 / (1 + math.exp(-(lead - far) / 25))         # demasiada antelación
    return f


def fare_ladder(p: float) -> float:
    if p < 150:
        step = 5
    elif p < 600:
        step = 10
    else:
        step = 20
    return max(12, step * math.ceil(p / step) - 1)


# Horas de salida típicas (las primeras y últimas suelen ser las más baratas)
_SLOTS = ["00:55", "02:10", "06:05", "06:40", "07:15", "08:30", "09:45", "11:10", "12:35", "14:20", "15:50", "17:25",
          "18:40", "20:15", "21:30", "22:50"]


def leg_details(origin: str, dest: str, d: date, transfers: int):
    """Duración (min) y hora de salida simuladas de un trayecto."""
    km = catalog.distance_km(origin, dest)
    air = km / 780 * 60 + 35                       # tiempo en el aire + rodaje/despegue
    detour = 1.0 + 0.12 * (transfers or 0)          # la escala no está en línea recta
    lay = sum(70 + 170 * _u("lay", origin, dest, d, i) for i in range(transfers or 0))
    minutes = int(round((air * detour + lay) / 5) * 5)
    slot = _SLOTS[_h("slot", origin, dest, d) % len(_SLOTS)]
    return max(40, minutes), slot


class DemoProvider(PriceProvider):
    name = "demo"

    def __init__(self, now: datetime = None):
        self.now = now or datetime.now(timezone.utc)
        self.today = self.now.date()
        self.hours = self.now.timestamp() / 3600

    # --- precio "habitual" de una ruta (sin fecha) ---
    def route_base(self, origin: str, dest: str) -> float:
        km = catalog.distance_km(origin, dest)
        if km < 800:
            base = 22 + 0.060 * km
        elif km < 3800:
            base = 30 + 0.042 * km
        else:
            base = 100 + 0.042 * km
        o, d = origin.upper(), dest.upper()
        if km < 3800 and (d in catalog.LOWCOST_HOT and o in catalog.LOWCOST_HOT):
            base *= 0.80                                       # ruta low-cost muy disputada
        if km >= 3800 and d not in catalog.LONGHAUL_DIRECT.get(o, set()) and o not in ("MAD", "BCN"):
            base *= 1.10                                       # conexión extra desde aeropuerto regional
        base *= 0.85 + 0.30 * _u("route", o, d)                # competencia/particularidades de la ruta
        return base

    def _operates(self, dest: str, d: date, origin: str, gaps: bool = True) -> bool:
        if dest in catalog.SUMMER_ONLY and d.month in (11, 12, 1, 2, 3):
            return _u("off", origin, dest, d) < 0.05
        if dest in catalog.WINTER_ONLY and d.month in (5, 6, 7, 8, 9):
            return _u("off", origin, dest, d) < 0.10
        return not gaps or _u("gap", origin, dest, d) > 0.04     # huecos puntuales sin datos

    def price_for(self, origin: str, dest: str, d: date, *, direct_only=False, gaps=True):
        """Precio de un trayecto de ida (origin -> dest) el día d, o None si no hay."""
        lead = (d - self.today).days
        if lead < 1 or not self._operates(dest, d, origin, gaps):
            return None
        info = catalog.info(dest)
        region = info.get("region", "EU")
        long_haul = catalog.is_long_haul(origin, dest)
        month = d.month - 1
        if dest in catalog.SUMMER_BEACH:
            season = BEACH[month]
        elif dest in catalog.WINTER_SUN:
            season = WINTER_SUN[month]
        elif dest in catalog.WINTER_ONLY:
            season = 1.25 if d.month == 12 else 1.0
        else:
            season = SEASON.get(region, SEASON["EU"])[month]
        dow = DOW[d.weekday()]
        if long_haul:
            dow = 1 + (dow - 1) * 0.5
        demand = 0.88 + 0.26 * _u("demand", origin, dest, d)      # ocupación de ese vuelo
        # Deriva temporal suave: nudos cada 72 h interpolados
        k = self.hours / 72
        i, frac = int(k), k - int(k)
        drift = 0.92 + 0.16 * (_u("drift", origin, dest, d, i) * (1 - frac) + _u("drift", origin, dest, d, i + 1) * frac)
        p = self.route_base(origin, dest) * season * holiday_factor(d) * dow * demand * drift * lead_factor(lead, long_haul)
        # Rebaja de aerolínea: 1 semana, afecta a un tramo de meses de la ruta
        week = int(self.hours // 168)
        if _u("sale", origin, dest, week) < 0.07:
            start = int(_u("salestart", origin, dest, week) * 8)
            if start * 30 + 20 <= lead <= start * 30 + 110:
                p *= 0.72
        # Tarifa flash / error (muy rara, dura unas horas)
        if _u("flash", origin, dest, d, int(self.hours // 8)) < 0.0012:
            p *= 0.52
        transfers = 0
        if long_haul:
            direct_ok = dest in catalog.LONGHAUL_DIRECT.get(origin, set())
            if direct_only:
                if not direct_ok:
                    return None
                p *= 1.12
            elif direct_ok and _u("direct-cheapest", origin, dest, d) < 0.55:
                transfers = 0
            else:
                transfers = 1 if _u("stops", origin, dest, d) < 0.8 else 2
                p *= 0.93 if transfers == 1 else 0.88
        elif catalog.distance_km(origin, dest) > 2600 and _u("stops", origin, dest) < 0.4:
            if direct_only:
                p *= 1.08          # el directo existe pero suele ser algo más caro
            else:
                transfers = 1
        airline = (_h("al", origin, dest, d) % 997)
        canary = {"LPA", "TCI", "ACE", "FUE"}
        oi = catalog.info(origin)
        if not long_haul and (origin in canary or dest in canary) and oi.get("country_code") == info.get("country_code") == "ES":
            pool = CANARY_AIRLINES
        elif long_haul:
            pool = AIRLINES_LONG.get(region if region != "EU" else oi.get("region", "EU"), ["IB", "UX"])
        else:
            pool = AIRLINES_SHORT
        return fare_ladder(p), pool[airline % len(pool)], transfers

    def fetch_month(self, origin, destination, month, *, currency="eur", trip="ow", direct_only=False,
                    min_nights=1, max_nights=30) -> List[Quote]:
        o, t = origin.upper(), destination.upper()
        y, m = map(int, month.split("-"))
        fx = CUR.get(currency.lower(), 1.0)
        days = [date(y, m, dd) for dd in range(1, monthrange(y, m)[1] + 1)]
        out_legs = {d: self.price_for(o, t, d, direct_only=direct_only) for d in days}
        if trip != "rt":
            res = []
            for d, leg in out_legs.items():
                if not leg:
                    continue
                price, airline, transfers = leg
                dur, dep = leg_details(o, t, d, transfers)
                res.append(Quote(origin=o, destination=t, depart_date=d.isoformat(), price=round(price * fx),
                                 airline=airline, transfers=transfers, duration=dur, dep_time=dep,
                                 link=booking_links(o, t, d.isoformat())["aviasales"], provider=self.name))
            return res
        # Ida y vuelta: combina la ida con cada vuelta posible dentro del rango de noches
        long_haul = catalog.is_long_haul(o, t)
        rt_factor = 0.90 if long_haul else 0.98
        back_cache = {}
        out_details = {}
        res = []
        for d, leg in out_legs.items():
            if not leg:
                continue
            for n in range(max(1, min_nights), max(min_nights, max_nights) + 1):
                r = d + timedelta(days=n)
                if r not in back_cache:
                    back_cache[r] = self.price_for(t, o, r, direct_only=direct_only, gaps=False)
                back = back_cache[r]
                if not back:
                    continue
                price = fare_ladder((leg[0] + back[0]) * rt_factor)
                dur, dep = out_details.setdefault(d, leg_details(o, t, d, leg[2]))
                rdur, rdep = leg_details(t, o, r, back[2])
                res.append(Quote(origin=o, destination=t, depart_date=d.isoformat(), return_date=r.isoformat(),
                                 price=round(price * fx), airline=leg[1], transfers=leg[2],
                                 return_transfers=back[2], duration=dur, return_duration=rdur,
                                 dep_time=dep, ret_time=rdep,
                                 link=booking_links(o, t, d.isoformat(), r.isoformat())["aviasales"],
                                 provider=self.name))
        return res
