"""Tus ajustes viven en `config.json`, en tu repositorio.

La web no tiene usuarios ni claves: cuando pulsas «Guardar», abre GitHub con tus cambios
ya escritos en una *issue*; al crearla (ya tienes la sesión de GitHub iniciada), el workflow
«Guardar ajustes» los valida, los escribe en `config.json` y lanza un escaneo.
"""
import json
import os
import re

from . import catalog, db

CONFIG_FILE = os.environ.get("CONFIG_FILE", "config.json")
ISSUE_PREFIX = "⚙️"

# clave en config.json -> ajuste interno
FIELDS = {
    "origins": "origins", "trip_type": "trip_type", "min_nights": "min_nights", "max_nights": "max_nights",
    "passengers": "passengers", "baggage": "baggage", "resident_discount": "resident_discount",
    "months_ahead": "months_ahead", "alert_level": "alert_level", "alert_drops": "alert_drops",
    "min_days_ahead": "min_days_ahead", "max_stops": "max_stops", "max_duration_h": "max_duration_h",
    "dep_windows": "dep_windows", "exclude_airlines": "exclude_airlines", "holiday_region": "holiday_region",
    "trip_lengths": "trip_lengths", "dest_stops": "dest_stops",
}
_IATA = re.compile(r"^[A-Z]{3}$")


def _codes(v):
    if isinstance(v, str):
        v = v.split(",")
    out = []
    for c in v or []:
        c = str(c).strip().upper()
        if _IATA.match(c) and c not in out:
            out.append(c)
    return out


def clean(cfg: dict) -> dict:
    """Valida lo que llega de la web (o de una issue): solo claves conocidas y valores razonables."""
    if not isinstance(cfg, dict):
        raise ValueError("Formato no válido")
    out = {}
    if "destinations" in cfg:
        out["destinations"] = _codes(cfg["destinations"])[:150]
    if "origins" in cfg:
        out["origins"] = _codes(cfg["origins"])[:30]
    for k in FIELDS:
        if k in cfg and k != "origins":
            v = cfg[k]
            if k == "exclude_airlines":
                v = [str(x).strip().upper()[:3] for x in (v.split(",") if isinstance(v, str) else v or []) if str(x).strip()]
            elif k == "trip_lengths":
                # "weekend" | "a-b" (rango de noches) | nº entero (días, formato antiguo)
                tl = {}
                for kk, vv in (v or {}).items() if isinstance(v, dict) else []:
                    kk = str(kk).strip().upper()
                    if not re.match(r"^[A-Z]{2,3}$", kk):
                        continue
                    if vv == "weekend":
                        tl[kk] = "weekend"
                        continue
                    m = re.match(r"^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*$", str(vv)) if isinstance(vv, str) else None
                    if m:
                        lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
                        lo, hi = min(lo, hi), max(lo, hi)
                        if 1 <= lo and hi <= 60:
                            tl[kk] = f"{lo}-{hi}"
                        continue
                    try:
                        n = int(vv)
                    except (TypeError, ValueError):
                        continue
                    if 2 <= n <= 60:
                        tl[kk] = f"{n - 1}-{n - 1}"
                v = tl
            elif k == "dest_stops":
                ds = {}
                for kk, vv in (v or {}).items() if isinstance(v, dict) else []:
                    kk = str(kk).strip().upper()
                    try:
                        n = int(vv)
                    except (TypeError, ValueError):
                        continue
                    if re.match(r"^[A-Z]{2,3}$", kk) and n in (-1, 0, 1, 2):
                        ds[kk] = n
                v = ds
            elif k == "dep_windows":
                v = ",".join(w for w in (v.split(",") if isinstance(v, str) else v or [])
                             if w in ("night", "morning", "afternoon", "evening"))
            out[k] = v
    return out


def load(path: str = None) -> dict:
    path = path or CONFIG_FILE
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return clean(json.load(f))


def save(cfg: dict, path: str = None):
    path = path or CONFIG_FILE
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(cfg), f, ensure_ascii=False, indent=2)
        f.write("\n")


def apply(cfg: dict):
    """Aplica config.json a la base de datos (ajustes + destinos vigilados)."""
    if not cfg:
        return
    db.update_settings({FIELDS[k]: v for k, v in cfg.items() if k in FIELDS})
    codes = cfg.get("destinations")
    if codes is None:
        return
    with db.connect() as c:
        for code in codes:
            info = catalog.info(code)
            c.execute("INSERT OR IGNORE INTO destinations(code, name, country, enabled, created_at) VALUES (?,?,?,1,?)",
                      (code, info["name"], info["country"], db.now_iso()))
        if codes:
            c.execute(f"UPDATE destinations SET enabled = CASE WHEN code IN ({','.join('?' * len(codes))}) THEN 1 ELSE 0 END",
                      codes)
        else:
            c.execute("UPDATE destinations SET enabled = 0")


def from_issue(event: dict) -> dict:
    """Extrae los ajustes del bloque ```json de una issue «⚙️ …» creada desde la web."""
    body = ((event.get("issue") or {}).get("body") or "")
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", body, re.S)
    if not m:
        raise ValueError("La issue no contiene ajustes (bloque ```json```)")
    return clean(json.loads(m.group(1)))
