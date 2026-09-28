from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional
from urllib.parse import quote


@dataclass
class Quote:
    origin: str
    destination: str
    depart_date: str            # YYYY-MM-DD
    price: float                # precio por persona (ida, o ida y vuelta si return_date)
    return_date: Optional[str] = None
    airline: str = ""
    transfers: Optional[int] = None
    return_transfers: Optional[int] = None
    link: str = ""
    provider: str = ""
    duration: Optional[int] = None         # minutos de la ida (puerta a puerta, con escalas)
    return_duration: Optional[int] = None  # minutos de la vuelta
    dep_time: Optional[str] = None         # "HH:MM" hora local de salida
    ret_time: Optional[str] = None         # "HH:MM" hora de salida de la vuelta
    extra: dict = field(default_factory=dict)

    @property
    def trip(self) -> str:
        return "rt" if self.return_date else "ow"

    @property
    def nights(self) -> Optional[int]:
        if not self.return_date:
            return None
        return (date.fromisoformat(self.return_date) - date.fromisoformat(self.depart_date)).days


class PriceProvider:
    """Interfaz común para cualquier fuente de precios.

    Para añadir otra fuente (Duffel, Kiwi...) crea una clase con `name`,
    `fetch_month()` y opcionalmente `fetch_any()`, y regístrala en providers/__init__.py.

    trip: "ow" (solo ida) | "rt" (ida y vuelta). En "rt" cada Quote lleva return_date.
    """

    name = "base"

    def fetch_month(self, origin: str, destination: str, month: str, *, currency: str = "eur",
                    trip: str = "ow", direct_only: bool = False, min_nights: int = 1,
                    max_nights: int = 30) -> List[Quote]:
        raise NotImplementedError

    def fetch_any(self, origin: str, destination: str, *, months: int = 12, today: date = None,
                  **kw) -> List[Quote]:
        """Lo más barato en cualquier fecha (lo usa «Explorar»). Por defecto recorre los meses."""
        today = today or date.today()
        out = []
        y, m = today.year, today.month
        for _ in range(months):
            out += self.fetch_month(origin, destination, f"{y:04d}-{m:02d}", **kw)
            m += 1
            if m > 12:
                y, m = y + 1, 1
        return out


def booking_links(origin: str, destination: str, depart_date: str, return_date: Optional[str] = None,
                  pax: int = 1) -> dict:
    """Enlaces de búsqueda en buscadores públicos para reservar/comparar."""
    d = date.fromisoformat(depart_date)
    r = date.fromisoformat(return_date) if return_date else None
    o, t = origin.upper(), destination.upper()
    pax = max(1, int(pax or 1))
    # Aviasales: /search/MAD0311BKK[1511]1
    avia = f"https://www.aviasales.com/search/{o}{d:%d%m}{t}{(r.strftime('%d%m') if r else '')}{pax}"
    # Skyscanner: /transporte/vuelos/mad/bkk/261103/[261115/]
    sky = f"https://www.skyscanner.es/transporte/vuelos/{o.lower()}/{t.lower()}/{d:%y%m%d}/"
    if r:
        sky += f"{r:%y%m%d}/"
    sky += f"?adultsv2={pax}"
    q = f"Flights from {o} to {t} on {d.isoformat()}" + (f" returning {r.isoformat()}" if r else " one way")
    if pax > 1:
        q += f" for {pax} adults"
    google = "https://www.google.com/travel/flights?hl=es&curr=EUR&q=" + quote(q)
    kayak = f"https://www.kayak.es/flights/{o}-{t}/{d.isoformat()}" + (f"/{r.isoformat()}" if r else "") \
            + (f"/{pax}adults" if pax > 1 else "") + "?sort=price_a"
    return {"aviasales": avia, "skyscanner": sky, "google": google, "kayak": kayak}
