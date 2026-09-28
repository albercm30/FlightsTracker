"""Proveedor real: Aviasales Data API (Travelpayouts).

- Registro gratuito en https://www.travelpayouts.com  -> Herramientas -> API -> token.
- Devuelve precios encontrados por usuarios de Aviasales en las últimas horas/días
  (datos en caché), ideal para vigilar el precio mínimo por día sin coste.
- Endpoint usado: GET /aviasales/v3/prices_for_dates
"""
import logging
from typing import List

import requests

from .base import PriceProvider, Quote

log = logging.getLogger(__name__)

API_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"


class TravelpayoutsError(RuntimeError):
    pass


class TravelpayoutsProvider(PriceProvider):
    name = "travelpayouts"

    def __init__(self, token: str, marker: str = "", timeout: int = 30, session=None, market: str = "es"):
        if not token:
            raise TravelpayoutsError("Falta el token de Travelpayouts")
        self.token = token
        self.marker = marker
        self.market = market
        self.timeout = timeout
        self.http = session or requests.Session()

    def fetch_month(self, origin, destination, month, *, currency="eur", one_way=True, direct_only=False) -> List[Quote]:
        params = {
            "origin": origin,
            "destination": destination,
            "departure_at": month,           # YYYY-MM -> todos los días del mes
            "one_way": "true" if one_way else "false",
            "direct": "true" if direct_only else "false",
            "currency": currency.lower(),
            "market": self.market,           # por defecto la API usa "ru": pedimos datos del mercado español
            "sorting": "price",
            "unique": "false",
            "limit": 1000,
            "page": 1,
        }
        # Con one_way=false y sin return_at, la API devuelve ida y vuelta con cualquier fecha de regreso
        resp = self.http.get(API_URL, params=params, headers={"X-Access-Token": self.token},
                             timeout=self.timeout)
        if resp.status_code == 401:
            raise TravelpayoutsError("Token de Travelpayouts no válido (401)")
        if resp.status_code == 429:
            raise TravelpayoutsError("Límite de peticiones alcanzado (429). Sube 'request_delay_s'.")
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("success", True):
            raise TravelpayoutsError(str(payload.get("error") or payload))
        return self.parse(payload, origin, destination)

    def parse(self, payload, origin, destination) -> List[Quote]:
        out = []
        for item in payload.get("data") or []:
            dep = (item.get("departure_at") or "")[:10]
            if not dep or item.get("price") is None:
                continue
            ret = (item.get("return_at") or "")[:10] or None
            link = item.get("link") or ""
            if link:
                link = "https://www.aviasales.com" + link
                if self.marker:
                    link += ("&" if "?" in link else "?") + f"marker={self.marker}"
            out.append(Quote(
                origin=origin,
                destination=destination,
                depart_date=dep,
                return_date=ret,
                price=float(item["price"]),
                airline=item.get("airline") or "",
                transfers=item.get("transfers"),
                link=link,
                provider=self.name,
            ))
        return out
