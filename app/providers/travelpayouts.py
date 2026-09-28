"""Proveedor real: Aviasales Data API (Travelpayouts).

- Registro gratuito en https://www.travelpayouts.com -> token de API.
- Devuelve precios encontrados por usuarios de Aviasales en los últimos días
  (datos en caché): ideal para vigilar el mínimo por día sin coste.
- Endpoint: GET /aviasales/v3/prices_for_dates
    departure_at = YYYY-MM (todo el mes) o YYYY-MM-DD; omitido = cualquier fecha
    one_way = true -> solo ida; false -> ida y vuelta (return_at en la respuesta)
"""
import logging
from datetime import date
from typing import List

import requests

from .base import PriceProvider, Quote

log = logging.getLogger(__name__)

API_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"


def _int(v):
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _hhmm(v):
    v = v or ""
    return v[11:16] if len(v) >= 16 and v[13] == ":" else None


class TravelpayoutsError(RuntimeError):
    pass


class TravelpayoutsProvider(PriceProvider):
    name = "travelpayouts"

    def __init__(self, token: str, timeout: int = 30, session=None, market: str = "es"):
        if not token:
            raise TravelpayoutsError("Falta el token de Travelpayouts")
        self.token = token
        self.market = market
        self.timeout = timeout
        self.http = session or requests.Session()

    def _get(self, params: dict):
        resp = self.http.get(API_URL, params=params, headers={"X-Access-Token": self.token}, timeout=self.timeout)
        if resp.status_code == 401:
            raise TravelpayoutsError("Token de Travelpayouts no válido (401)")
        if resp.status_code == 429:
            raise TravelpayoutsError("Límite de peticiones alcanzado (429). Sube la pausa entre peticiones.")
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("success", True):
            raise TravelpayoutsError(str(payload.get("error") or payload))
        return payload

    def _params(self, origin, destination, currency, trip, direct_only):
        return {
            "origin": origin,
            "destination": destination,
            "one_way": "false" if trip == "rt" else "true",
            "direct": "true" if direct_only else "false",
            "currency": currency.lower(),
            "market": self.market,   # por defecto la API usa "ru": pedimos el mercado español
            "sorting": "price",
            "unique": "false",
            "limit": 1000,
            "page": 1,
        }

    def fetch_month(self, origin, destination, month, *, currency="eur", trip="ow", direct_only=False,
                    min_nights=1, max_nights=30) -> List[Quote]:
        params = self._params(origin, destination, currency, trip, direct_only)
        params["departure_at"] = month
        return self._filter(self.parse(self._get(params), origin, destination), trip, min_nights, max_nights)

    def fetch_any(self, origin, destination, *, months=12, today: date = None, currency="eur", trip="ow",
                  direct_only=False, min_nights=1, max_nights=30) -> List[Quote]:
        # Una sola petición: lo más barato para cualquier fecha futura
        params = self._params(origin, destination, currency, trip, direct_only)
        return self._filter(self.parse(self._get(params), origin, destination), trip, min_nights, max_nights)

    @staticmethod
    def _filter(quotes, trip, min_nights, max_nights):
        if trip != "rt":
            return [q for q in quotes if not q.return_date]
        return [q for q in quotes if q.return_date and min_nights <= (q.nights or 0) <= max_nights]

    def parse(self, payload, origin, destination) -> List[Quote]:
        out = []
        for item in payload.get("data") or []:
            dep = (item.get("departure_at") or "")[:10]
            if not dep or item.get("price") is None:
                continue
            ret = (item.get("return_at") or "")[:10] or None
            dur_to = item.get("duration_to")
            dur_back = item.get("duration_back")
            if dur_to is None and item.get("duration") is not None and not ret:
                dur_to = item.get("duration")
            link = item.get("link") or ""
            if link:
                link = "https://www.aviasales.com" + link
            out.append(Quote(
                origin=origin,
                destination=destination,
                depart_date=dep,
                return_date=ret,
                price=float(item["price"]),
                airline=item.get("airline") or "",
                transfers=item.get("transfers"),
                return_transfers=item.get("return_transfers"),
                link=link,
                provider=self.name,
                duration=_int(dur_to),
                return_duration=_int(dur_back) if ret else None,
                dep_time=_hhmm(item.get("departure_at")),
                ret_time=_hhmm(item.get("return_at")) if ret else None,
                extra={"duration": item.get("duration"), "flight_number": item.get("flight_number")},
            ))
        return out
