"""Comprobación en vivo con Google Flights a través de SerpApi (opcional).

- Cuenta gratuita en https://serpapi.com (250 búsquedas/mes en el plan gratis).
- Se usa bajo demanda (botón "Comprobar precio real ahora"), no en los escaneos
  masivos, para no gastar el cupo.
- Devuelve el precio real de hoy para una fecha concreta y, cuando Google lo
  ofrece, sus "price insights": nivel de precio (bajo/normal/alto), rango típico
  y el HISTÓRICO de precios de las últimas semanas para ese vuelo.
"""
import requests

from .. import catalog

API_URL = "https://serpapi.com/search"


class SerpApiError(RuntimeError):
    pass


def live_check(api_key: str, origin: str, destination: str, depart_date: str, return_date: str = None,
               currency: str = "EUR", session=None, timeout: int = 60) -> dict:
    if not api_key:
        raise SerpApiError("Falta la clave de SerpApi (Ajustes)")
    params = {
        "engine": "google_flights",
        "departure_id": catalog.google_airports(origin),
        "arrival_id": catalog.google_airports(destination),
        "outbound_date": depart_date,
        "currency": currency.upper(),
        "hl": "es",
        "gl": "es",
        "api_key": api_key,
        "type": "1" if return_date else "2",   # 1 = ida y vuelta, 2 = solo ida
    }
    if return_date:
        params["return_date"] = return_date
    http = session or requests
    r = http.get(API_URL, params=params, timeout=timeout)
    if r.status_code == 401:
        raise SerpApiError("Clave de SerpApi no válida")
    data = r.json()
    if data.get("error"):
        raise SerpApiError(data["error"])
    return parse(data)


def parse(data: dict) -> dict:
    flights = []
    for group in ("best_flights", "other_flights"):
        for f in data.get(group) or []:
            legs = f.get("flights") or []
            if not legs or f.get("price") is None:
                continue
            flights.append({
                "price": f["price"],
                "airlines": sorted({leg.get("airline", "") for leg in legs}),
                "stops": max(0, len(legs) - 1),
                "duration_min": f.get("total_duration"),
                "departure": (legs[0].get("departure_airport") or {}).get("time"),
                "arrival": (legs[-1].get("arrival_airport") or {}).get("time"),
                "from": (legs[0].get("departure_airport") or {}).get("id"),
                "to": (legs[-1].get("arrival_airport") or {}).get("id"),
                "best": group == "best_flights",
            })
    flights.sort(key=lambda x: x["price"])
    pi = data.get("price_insights") or {}
    history = [{"t": int(t), "price": p} for t, p in (pi.get("price_history") or []) if p is not None]
    return {
        "lowest_price": pi.get("lowest_price") or (flights[0]["price"] if flights else None),
        "price_level": pi.get("price_level"),                 # "low" | "typical" | "high"
        "typical_range": pi.get("typical_price_range"),       # [min, max]
        "history": history,                                   # [{t: unix, price}]
        "flights": flights[:8],
        "google_url": (data.get("search_metadata") or {}).get("google_flights_url"),
    }
