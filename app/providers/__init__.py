from .base import PriceProvider, Quote, booking_links  # noqa: F401
from .demo import DemoProvider
from .travelpayouts import TravelpayoutsProvider


def get_provider(settings: dict) -> PriceProvider:
    choice = (settings.get("provider") or "auto").lower()
    token = settings.get("travelpayouts_token") or ""
    if choice == "demo" or (choice == "auto" and not token):
        return DemoProvider()
    return TravelpayoutsProvider(token)
