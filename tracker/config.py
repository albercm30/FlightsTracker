"""Tu configuración: `config.json` en la raíz del repositorio.

Un *seguimiento* (watch) es una búsqueda que se vigila cada día:
    {
      "id": "argentina",
      "name": "Argentina en invierno",
      "origins": ["TCI", "MAD"],          # aeropuertos (o ciudades) de salida
      "destinations": ["BUE"],            # aeropuertos (o ciudades) de destino
      "trip": "rt",                       # "rt" ida y vuelta | "ow" solo ida
      "stay": {"type": "nights", "min": 10, "max": 15},   # o {"type": "weekend"} / {"type": "long_weekend"}
      "dates": {"from": "2026-12-01", "to": "2027-03-31"},  # o {"months": 6} (próximos N meses)
      "stops": "any",                     # "any" | "max1" | "direct"
      "weekdays": [],                     # días de salida permitidos (0=lunes … 6=domingo); vacío = todos
      "max_price": 700,                   # opcional: avisar siempre que baje de aquí
      "enabled": true
    }
"""
import json
import os
import re
from datetime import date

CONFIG_FILE = os.environ.get("CONFIG_FILE", "config.json")
_CODE = re.compile(r"^[A-Z]{3}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DEFAULTS = {
    "currency": "eur",
    "alerts": {
        "min_discount": 25,     # % por debajo del precio habitual para ser «chollo top»
        "min_score": 80,        # puntuación mínima (0-100)
        "cooldown_days": 14,    # no repetir aviso del mismo seguimiento salvo que baje otro 10 %
    },
    "watches": [],
}

EXAMPLE_WATCHES = [
    {"id": "europa-findes", "name": "Escapadas de fin de semana", "origins": ["MAD"],
     "destinations": ["LON", "PAR", "ROM", "LIS", "AMS"], "trip": "rt", "stay": {"type": "weekend"},
     "dates": {"months": 6}, "stops": "direct", "weekdays": [], "max_price": None, "enabled": True},
    {"id": "argentina", "name": "Argentina", "origins": ["MAD"], "destinations": ["BUE"], "trip": "rt",
     "stay": {"type": "nights", "min": 10, "max": 15}, "dates": {"months": 12}, "stops": "max1",
     "weekdays": [], "max_price": None, "enabled": True},
]


def _codes(v, limit=40):
    if isinstance(v, str):
        v = v.split(",")
    out = []
    for c in v or []:
        c = str(c).strip().upper()
        if _CODE.match(c) and c not in out:
            out.append(c)
    return out[:limit]


def _slug(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or "seguimiento"


def _int(v, lo, hi, default):
    try:
        v = int(float(v))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def clean_watch(w: dict, used_ids=None) -> dict:
    used_ids = used_ids if used_ids is not None else set()
    name = str(w.get("name") or "Seguimiento").strip()[:60]
    wid = _slug(w.get("id") or name)
    base, n = wid, 2
    while wid in used_ids:
        wid, n = f"{base}-{n}", n + 1
    used_ids.add(wid)
    trip = "ow" if w.get("trip") == "ow" else "rt"
    st = w.get("stay") or {}
    if st.get("type") in ("weekend", "long_weekend"):
        stay = {"type": st["type"]}
    else:
        lo = _int(st.get("min"), 1, 60, 3)
        hi = _int(st.get("max"), lo, 60, max(lo, 7))
        stay = {"type": "nights", "min": lo, "max": max(lo, hi)}
    d = w.get("dates") or {}
    if _DATE.match(str(d.get("from") or "")) or _DATE.match(str(d.get("to") or "")):
        dates = {"from": d.get("from") if _DATE.match(str(d.get("from") or "")) else None,
                 "to": d.get("to") if _DATE.match(str(d.get("to") or "")) else None}
    else:
        dates = {"months": _int(d.get("months"), 1, 12, 6)}
    stops = w.get("stops") if w.get("stops") in ("any", "max1", "direct") else "any"
    weekdays = sorted({int(x) for x in (w.get("weekdays") or []) if str(x).isdigit() and 0 <= int(x) <= 6})
    mp = w.get("max_price")
    try:
        mp = float(mp) if mp not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        mp = None
    return {"id": wid, "name": name, "origins": _codes(w.get("origins")), "destinations": _codes(w.get("destinations"), 80),
            "trip": trip, "stay": stay, "dates": dates, "stops": stops, "weekdays": weekdays,
            "max_price": mp, "enabled": w.get("enabled", True) is not False}


def clean(cfg: dict) -> dict:
    if not isinstance(cfg, dict):
        raise ValueError("Formato no válido")
    out = json.loads(json.dumps(DEFAULTS))
    if cfg.get("currency") in ("eur", "usd", "gbp"):
        out["currency"] = cfg["currency"]
    a = cfg.get("alerts") or {}
    out["alerts"] = {"min_discount": _int(a.get("min_discount"), 5, 80, 25),
                     "min_score": _int(a.get("min_score"), 50, 99, 80),
                     "cooldown_days": _int(a.get("cooldown_days"), 1, 60, 14)}
    used = set()
    out["watches"] = [clean_watch(w, used) for w in (cfg.get("watches") or [])[:30] if isinstance(w, dict)]
    return out


def load(path: str = None) -> dict:
    path = path or CONFIG_FILE
    if not os.path.exists(path):
        return clean({"watches": EXAMPLE_WATCHES})
    with open(path, encoding="utf-8") as f:
        return clean(json.load(f))


def save(cfg: dict, path: str = None):
    with open(path or CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(clean(cfg), f, ensure_ascii=False, indent=2)
        f.write("\n")


def from_issue(body: str) -> dict:
    """Extrae la configuración del bloque ```json de una issue «⚙️ …» creada desde la web."""
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", body or "", re.S)
    if not m:
        raise ValueError("La issue no contiene la configuración (bloque ```json```)")
    return clean(json.loads(m.group(1)))


def window(watch: dict, today: date = None):
    """(fecha mínima, fecha máxima) de salida para un seguimiento."""
    from datetime import timedelta
    today = today or date.today()
    d = watch["dates"]
    start = today + timedelta(days=1)
    if "months" in d:
        end = today + timedelta(days=int(d["months"] * 30.5))
    else:
        if d.get("from"):
            start = max(start, date.fromisoformat(d["from"]))
        end = date.fromisoformat(d["to"]) if d.get("to") else today + timedelta(days=365)
    end = min(end, today + timedelta(days=365))
    return start, end
