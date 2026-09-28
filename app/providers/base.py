from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional
from urllib.parse import quote


@dataclass
class Quote:
    origin: str
    destination: str
    depart_date: str            # YYYY-MM-DD
    price: float
    return_date: Optional[str] = None
    airline: str = ""
    transfers: Optional[int] = None
    link: str = ""
    provider: str = ""
    extra: dict = field(default_factory=dict)


class PriceProvider:
    """Interfaz común para cualquier fuente de precios.

    Para añadir otra fuente (SerpApi, Duffel, Kiwi...) crea una clase con
    `name` y `fetch_month()` y regístrala en providers/__init__.py.
    """

    name = "base"

    def fetch_month(self, origin: str, destination: str, month: str, *, currency: str = "eur",
                    one_way: bool = True, direct_only: bool = False) -> List[Quote]:
        raise NotImplementedError


def booking_links(origin: str, destination: str, depart_date: str, return_date: Optional[str] = None) -> dict:
    """Enlaces de búsqueda en buscadores públicos para reservar/comparar."""
    d = date.fromisoformat(depart_date)
    r = date.fromisoformat(return_date) if return_date else None
    o, t = origin.upper(), destination.upper()
    # Aviasales: /search/MAD0311BKK[1511]1
    avia = f"https://www.aviasales.com/search/{o}{d:%d%m}{t}{(r.strftime('%d%m') if r else '')}1"
    # Skyscanner: /transporte/vuelos/mad/bkk/261103/[261115/]
    sky = f"https://www.skyscanner.es/transporte/vuelos/{o.lower()}/{t.lower()}/{d:%y%m%d}/"
    if r:
        sky += f"{r:%y%m%d}/"
    q = f"Flights from {o} to {t} on {d.isoformat()}" + (f" returning {r.isoformat()}" if r else " one way")
    google = "https://www.google.com/travel/flights?hl=es&curr=EUR&q=" + quote(q)
    return {"aviasales": avia, "skyscanner": sky, "google": google}
