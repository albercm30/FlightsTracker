"""Festivos de España y cálculo de "puentes" para planificar escapadas.

Incluye los festivos nacionales y algunos autonómicos habituales. Los calendarios
autonómicos y locales cambian cada año: tómalo como guía y revisa el oficial.
"""
from datetime import date, timedelta

from .providers.demo import easter

REGIONS = {
    "": "Solo nacionales",
    "canarias": "Canarias",
    "madrid": "Comunidad de Madrid",
    "cataluna": "Cataluña",
    "andalucia": "Andalucía",
    "valencia": "Comunidad Valenciana",
    "pais_vasco": "País Vasco",
    "galicia": "Galicia",
    "baleares": "Baleares",
}


def _fixed(y):
    e = easter(y)
    return {
        "national": [
            (date(y, 1, 1), "Año Nuevo"),
            (date(y, 1, 6), "Reyes"),
            (e - timedelta(days=2), "Viernes Santo"),
            (date(y, 5, 1), "Día del Trabajo"),
            (date(y, 8, 15), "Asunción"),
            (date(y, 10, 12), "Fiesta Nacional"),
            (date(y, 11, 1), "Todos los Santos"),
            (date(y, 12, 6), "Constitución"),
            (date(y, 12, 8), "Inmaculada"),
            (date(y, 12, 25), "Navidad"),
        ],
        "holy_thursday": [(e - timedelta(days=3), "Jueves Santo")],
        "easter_monday": [(e + timedelta(days=1), "Lunes de Pascua")],
        "canarias": [(date(y, 5, 30), "Día de Canarias")],
        "madrid": [(date(y, 5, 2), "Día de la Comunidad de Madrid")],
        "cataluna": [(date(y, 6, 24), "Sant Joan"), (date(y, 9, 11), "Diada"), (date(y, 12, 26), "Sant Esteve")],
        "andalucia": [(date(y, 2, 28), "Día de Andalucía")],
        "valencia": [(date(y, 3, 19), "San José"), (date(y, 10, 9), "Día de la Comunitat")],
        "pais_vasco": [(date(y, 7, 25), "Santiago Apóstol")],
        "galicia": [(date(y, 5, 17), "Letras Gallegas"), (date(y, 7, 25), "Día de Galicia")],
        "baleares": [(date(y, 3, 1), "Día de les Illes Balears"), (date(y, 12, 26), "Segunda fiesta de Navidad")],
    }


def holidays_for(year: int, region: str = ""):
    f = _fixed(year)
    out = list(f["national"])
    # Jueves Santo en casi todas; Lunes de Pascua en Cataluña, Valencia, País Vasco, Baleares
    if region in ("cataluna", "valencia", "baleares"):
        out += f["easter_monday"]
    elif region == "pais_vasco":
        out += f["holy_thursday"] + f["easter_monday"]
    else:
        out += f["holy_thursday"]
    out += f.get(region, [])
    return sorted(set(out))


def _window(h: date):
    """Días libres alrededor de un festivo: (inicio, fin, días de vacaciones necesarios)."""
    wd = h.weekday()  # 0 lunes
    if wd == 0:
        return h - timedelta(days=2), h, 0
    if wd == 1:
        return h - timedelta(days=3), h, 1       # puente del lunes
    if wd == 2:
        return h, h + timedelta(days=4), 2       # mié + jue/vie libres
    if wd == 3:
        return h, h + timedelta(days=3), 1       # puente del viernes
    if wd == 4:
        return h, h + timedelta(days=2), 0
    if wd == 5:
        return h, h + timedelta(days=1), 0
    return h - timedelta(days=1), h, 0


def upcoming(region: str = "", today: date = None, months: int = 12):
    today = today or date.today()
    end = today + timedelta(days=int(months * 30.5))
    hs = [(d, n) for y in (today.year, today.year + 1) for d, n in holidays_for(y, region) if today <= d <= end]
    windows = []
    for d, n in sorted(hs):
        s, e, off = _window(d)
        windows.append({"start": s, "end": e, "days_off": off, "names": [n], "dates": [d]})
    # Fusionar ventanas que se solapan o se tocan (p. ej. Constitución + Inmaculada, Semana Santa)
    merged = []
    for w in windows:
        if merged and w["start"] <= merged[-1]["end"] + timedelta(days=1):
            m = merged[-1]
            m["end"] = max(m["end"], w["end"])
            m["names"] += w["names"]
            m["dates"] += w["dates"]
        else:
            merged.append(dict(w))
    out = []
    for m in merged:
        s, e = m["start"], m["end"]
        # días laborables dentro de la ventana que no son festivo = vacaciones a pedir
        off = sum(1 for i in range((e - s).days + 1)
                  if (s + timedelta(days=i)).weekday() < 5 and (s + timedelta(days=i)) not in m["dates"])
        total = (e - s).days + 1
        title = " + ".join(dict.fromkeys(m["names"]))
        if "Jueves Santo" in m["names"] or "Viernes Santo" in m["names"]:
            title = "Semana Santa"
        kind = "puente" if off <= 1 and total >= 3 else ("largo" if total >= 5 else "festivo")
        out.append({
            "title": title, "holidays": sorted(set(d.isoformat() for d in m["dates"])),
            "start": s.isoformat(), "end": e.isoformat(), "days": total, "days_off": off,
            "kind": kind, "weekend_only": total <= 2,
        })
    return [o for o in out if not o["weekend_only"] and date.fromisoformat(o["start"]) >= today]
