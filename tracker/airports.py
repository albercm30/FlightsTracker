"""Catálogo de aeropuertos/ciudades (195 países) y aerolíneas."""
import json
import math
import os

_DIR = os.path.join(os.path.dirname(__file__), "data")
with open(os.path.join(_DIR, "airports.json"), encoding="utf-8") as f:
    DATA = json.load(f)
with open(os.path.join(_DIR, "airlines.json"), encoding="utf-8") as f:
    AIRLINES = json.load(f)

BY_CODE = {a["code"]: a for a in DATA["airports"]}
COUNTRIES = DATA["countries"]


def info(code: str) -> dict:
    a = BY_CODE.get((code or "").upper())
    if a:
        return {**a, "country": COUNTRIES.get(a["cc"], a["cc"])}
    return {"code": code, "city": code, "cc": "", "country": "", "region": "", "lat": None, "lon": None}


def city(code: str) -> str:
    return info(code)["city"]


def airline(code: str) -> str:
    return AIRLINES.get((code or "").upper(), code or "")


def distance_km(a: str, b: str) -> float:
    A, B = BY_CODE.get(a), BY_CODE.get(b)
    if not A or not B or A["lat"] is None or B["lat"] is None:
        return 2500.0
    r = math.pi / 180
    h = (math.sin((B["lat"] - A["lat"]) * r / 2) ** 2
         + math.cos(A["lat"] * r) * math.cos(B["lat"] * r) * math.sin((B["lon"] - A["lon"]) * r / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(h))
