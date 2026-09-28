"""Aerolíneas: nombres y políticas de equipaje ESTIMADAS.

Las APIs de precios (Aviasales/Travelpayouts) no dicen qué equipaje incluye cada
billete, así que estimamos con la política habitual de la tarifa más barata de cada
aerolínea. Los importes son rangos orientativos POR TRAYECTO y POR PERSONA,
reservando online con antelación (en el aeropuerto suele costar bastante más).

Revisado: septiembre 2026. En junio de 2026 la UE alcanzó un acuerdo para que el
precio mostrado incluya por defecto una maleta de cabina de 7 kg, pero aún no se
aplica: hoy mandan las políticas de cada aerolínea. Verifica siempre al reservar.

Campos:
  personal  -> artículo personal bajo el asiento (casi siempre incluido)
  cabin     -> "included" | "fee"      maleta de cabina ~10 kg
  checked   -> "included" | "fee" | "depends"   maleta facturada 20–23 kg
  cabin_fee / checked_fee / checked_fee_long -> (mín, máx) € por trayecto
"""

LOWCOST = "lowcost"
LEGACY = "legacy"

AIRLINES = {
    # --- Low cost europeas ---
    "FR": {"name": "Ryanair", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (6, 36), "checked_fee": (20, 60), "personal_size": "40×30×20 cm"},
    "VY": {"name": "Vueling", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 35), "checked_fee": (20, 50), "personal_size": "40×20×30 cm"},
    "U2": {"name": "easyJet", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 45), "checked_fee": (25, 55), "personal_size": "45×36×20 cm"},
    "W6": {"name": "Wizz Air", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (10, 45), "checked_fee": (25, 65), "personal_size": "40×30×20 cm"},
    "V7": {"name": "Volotea", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 30), "checked_fee": (18, 45), "personal_size": "40×30×20 cm"},
    "HV": {"name": "Transavia", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 35), "checked_fee": (20, 50), "personal_size": "40×30×20 cm"},
    "TO": {"name": "Transavia France", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 35), "checked_fee": (20, 50), "personal_size": "40×30×20 cm"},
    "EW": {"name": "Eurowings", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (8, 30), "checked_fee": (20, 45), "personal_size": "40×30×25 cm"},
    "PC": {"name": "Pegasus", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (10, 35), "checked_fee": (20, 50), "personal_size": "40×30×15 cm"},
    "DY": {"name": "Norwegian", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (10, 35), "checked_fee": (20, 55), "personal_size": "30×20×38 cm"},
    # --- Españolas tradicionales / regionales ---
    "IB": {"name": "Iberia", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (25, 45), "long_checked": "depends", "checked_fee_long": (60, 100)},
    "I2": {"name": "Iberia Express", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (20, 40)},
    "UX": {"name": "Air Europa", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (25, 45), "long_checked": "depends", "checked_fee_long": (60, 100)},
    "NT": {"name": "Binter", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (15, 35)},
    "YW": {"name": "Air Nostrum", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (25, 45)},
    # --- Europeas tradicionales ---
    "LH": {"name": "Lufthansa", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "AF": {"name": "Air France", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "KL": {"name": "KLM", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "BA": {"name": "British Airways", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 60), "long_checked": "depends", "checked_fee_long": (70, 110)},
    "AZ": {"name": "ITA Airways", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "TP": {"name": "TAP Air Portugal", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (25, 50), "long_checked": "depends", "checked_fee_long": (60, 100)},
    "LX": {"name": "SWISS", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "OS": {"name": "Austrian", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "SK": {"name": "SAS", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "AY": {"name": "Finnair", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (30, 50), "long_checked": "included"},
    "TK": {"name": "Turkish Airlines", "type": LEGACY, "cabin": "included", "checked": "included"},
    "AT": {"name": "Royal Air Maroc", "type": LEGACY, "cabin": "included", "checked": "depends",
           "checked_fee": (25, 50)},
    # --- Oriente Medio / Asia ---
    "EK": {"name": "Emirates", "type": LEGACY, "cabin": "included", "checked": "included"},
    "QR": {"name": "Qatar Airways", "type": LEGACY, "cabin": "included", "checked": "included"},
    "EY": {"name": "Etihad", "type": LEGACY, "cabin": "included", "checked": "included"},
    "SQ": {"name": "Singapore Airlines", "type": LEGACY, "cabin": "included", "checked": "included"},
    "ET": {"name": "Ethiopian", "type": LEGACY, "cabin": "included", "checked": "included"},
    "MS": {"name": "EgyptAir", "type": LEGACY, "cabin": "included", "checked": "included"},
    "JL": {"name": "Japan Airlines", "type": LEGACY, "cabin": "included", "checked": "included"},
    "NH": {"name": "ANA", "type": LEGACY, "cabin": "included", "checked": "included"},
    "CX": {"name": "Cathay Pacific", "type": LEGACY, "cabin": "included", "checked": "included"},
    # --- América ---
    "DL": {"name": "Delta", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (35, 45), "long_checked": "depends", "checked_fee_long": (75, 100)},
    "AA": {"name": "American Airlines", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (35, 45), "long_checked": "depends", "checked_fee_long": (75, 100)},
    "UA": {"name": "United", "type": LEGACY, "cabin": "included", "checked": "fee",
           "checked_fee": (35, 45), "long_checked": "depends", "checked_fee_long": (75, 100)},
    "AV": {"name": "Avianca", "type": LEGACY, "cabin": "included", "checked": "depends",
           "checked_fee": (30, 60), "checked_fee_long": (60, 100)},
    "LA": {"name": "LATAM", "type": LEGACY, "cabin": "included", "checked": "depends",
           "checked_fee": (30, 60), "checked_fee_long": (60, 100)},
    "AM": {"name": "Aeroméxico", "type": LEGACY, "cabin": "included", "checked": "depends",
           "checked_fee": (30, 60), "checked_fee_long": (60, 100)},
    "CM": {"name": "Copa Airlines", "type": LEGACY, "cabin": "included", "checked": "included"},
    "AR": {"name": "Aerolíneas Argentinas", "type": LEGACY, "cabin": "included", "checked": "included"},
    "PLUS": {"name": "Plus Ultra", "type": LEGACY, "cabin": "included", "checked": "included"},
    # --- Low cost largo radio ---
    "DI": {"name": "Norse Atlantic", "type": LOWCOST, "cabin": "fee", "checked": "fee",
           "cabin_fee": (25, 50), "checked_fee": (50, 90)},
    "LL": {"name": "LEVEL", "type": LOWCOST, "cabin": "included", "checked": "fee",
           "checked_fee": (50, 90)},
}

BAG_OPTIONS = {
    "personal": "Solo mochila (bajo el asiento)",
    "cabin": "Maleta de cabina (~10 kg)",
    "checked": "Maleta facturada (20–23 kg)",
    "cabin_checked": "Cabina + facturada",
}

LABELS = {"included": "incluida", "fee": "de pago", "depends": "según tarifa"}


def name(code: str) -> str:
    code = (code or "").upper()
    return AIRLINES.get(code, {}).get("name", code or "—")


def _policy(code: str, long_haul: bool) -> dict:
    a = AIRLINES.get((code or "").upper())
    if not a:
        # Aerolínea desconocida: suposición por tipo de vuelo
        if long_haul:
            return {"name": code or "—", "known": False, "cabin": "included", "checked": "depends",
                    "cabin_fee": (0, 0), "checked_fee": (60, 100)}
        return {"name": code or "—", "known": False, "cabin": "fee", "checked": "fee",
                "cabin_fee": (10, 35), "checked_fee": (20, 50)}
    p = {"name": a["name"], "known": True, "cabin": a["cabin"], "checked": a["checked"],
         "cabin_fee": a.get("cabin_fee", (0, 0)), "checked_fee": a.get("checked_fee", (0, 0)),
         "personal_size": a.get("personal_size")}
    if long_haul:
        if "long_checked" in a:
            p["checked"] = a["long_checked"]
        if "checked_fee_long" in a:
            p["checked_fee"] = a["checked_fee_long"]
        elif p["checked"] != "included":
            p["checked_fee"] = (max(p["checked_fee"][0], 50), max(p["checked_fee"][1], 90))
    return p


def baggage(code: str, long_haul: bool, option: str = "personal", legs: int = 1, pax: int = 1) -> dict:
    """Estimación de lo que incluye la tarifa y lo que costaría añadir equipaje.

    Devuelve incluidos, coste estimado (mín/medio/máx) para TODOS los trayectos y pasajeros.
    """
    p = _policy(code, long_haul)
    need_cabin = option in ("cabin", "cabin_checked")
    need_checked = option in ("checked", "cabin_checked")
    lo = hi = 0.0
    if need_cabin and p["cabin"] == "fee":
        lo += p["cabin_fee"][0]
        hi += p["cabin_fee"][1]
    if need_checked and p["checked"] in ("fee", "depends"):
        # "depends": a veces incluido -> el mínimo es 0
        lo += 0 if p["checked"] == "depends" else p["checked_fee"][0]
        hi += p["checked_fee"][1]
    mult = max(1, legs) * max(1, pax)
    lo, hi = lo * mult, hi * mult
    est = round(lo + (hi - lo) * 0.4) if hi else 0  # suele pagarse la parte baja reservando pronto
    return {
        "airline": p["name"],
        "known": p["known"],
        "personal": "included",
        "cabin": p["cabin"],
        "checked": p["checked"],
        "personal_size": p.get("personal_size"),
        "fee_min": round(lo),
        "fee_max": round(hi),
        "fee_est": est,
        "option": option,
        "summary": f"Mochila ✓ · Cabina {'✓' if p['cabin'] == 'included' else '€'} · "
                   f"Facturada {'✓' if p['checked'] == 'included' else ('¿?' if p['checked'] == 'depends' else '€')}",
    }
