"""Catálogo de ciudades/aeropuertos (códigos IATA de ciudad) para origen y destinos.

Los códigos son de CIUDAD (p. ej. LON agrupa Heathrow, Gatwick, Stansted...), que es
lo que usa la API de Aviasales/Travelpayouts. Puedes añadir cualquier código IATA
manualmente desde la interfaz aunque no esté en esta lista.
"""

# Región -> se usa para estimar precios en el modo demo
REGIONS = {
    "EU": "Europa",
    "AF": "África",
    "ME": "Oriente Medio",
    "NA": "Norteamérica",
    "LA": "Latinoamérica y Caribe",
    "AS": "Asia",
    "OC": "Oceanía",
}

# code, ciudad, país, código país, región
_CITIES = [
    # --- España (origen / destinos nacionales) ---
    ("MAD", "Madrid", "España", "ES", "EU"),
    ("BCN", "Barcelona", "España", "ES", "EU"),
    ("AGP", "Málaga", "España", "ES", "EU"),
    ("PMI", "Palma de Mallorca", "España", "ES", "EU"),
    ("ALC", "Alicante", "España", "ES", "EU"),
    ("VLC", "Valencia", "España", "ES", "EU"),
    ("SVQ", "Sevilla", "España", "ES", "EU"),
    ("BIO", "Bilbao", "España", "ES", "EU"),
    ("LPA", "Gran Canaria", "España", "ES", "EU"),
    ("TCI", "Tenerife", "España", "ES", "EU"),
    ("ACE", "Lanzarote", "España", "ES", "EU"),
    ("FUE", "Fuerteventura", "España", "ES", "EU"),
    ("IBZ", "Ibiza", "España", "ES", "EU"),
    ("SCQ", "Santiago de Compostela", "España", "ES", "EU"),
    ("OVD", "Asturias", "España", "ES", "EU"),
    ("GRX", "Granada", "España", "ES", "EU"),
    ("ZAZ", "Zaragoza", "España", "ES", "EU"),
    ("MAH", "Menorca", "España", "ES", "EU"),
    # --- Europa ---
    ("LON", "Londres", "Reino Unido", "GB", "EU"),
    ("MAN", "Mánchester", "Reino Unido", "GB", "EU"),
    ("EDI", "Edimburgo", "Reino Unido", "GB", "EU"),
    ("DUB", "Dublín", "Irlanda", "IE", "EU"),
    ("PAR", "París", "Francia", "FR", "EU"),
    ("NCE", "Niza", "Francia", "FR", "EU"),
    ("LYS", "Lyon", "Francia", "FR", "EU"),
    ("ROM", "Roma", "Italia", "IT", "EU"),
    ("MIL", "Milán", "Italia", "IT", "EU"),
    ("VCE", "Venecia", "Italia", "IT", "EU"),
    ("NAP", "Nápoles", "Italia", "IT", "EU"),
    ("FLR", "Florencia", "Italia", "IT", "EU"),
    ("PMO", "Palermo", "Italia", "IT", "EU"),
    ("LIS", "Lisboa", "Portugal", "PT", "EU"),
    ("OPO", "Oporto", "Portugal", "PT", "EU"),
    ("FAO", "Faro", "Portugal", "PT", "EU"),
    ("FNC", "Madeira", "Portugal", "PT", "EU"),
    ("PDL", "Azores (Ponta Delgada)", "Portugal", "PT", "EU"),
    ("BER", "Berlín", "Alemania", "DE", "EU"),
    ("MUC", "Múnich", "Alemania", "DE", "EU"),
    ("FRA", "Fráncfort", "Alemania", "DE", "EU"),
    ("HAM", "Hamburgo", "Alemania", "DE", "EU"),
    ("AMS", "Ámsterdam", "Países Bajos", "NL", "EU"),
    ("BRU", "Bruselas", "Bélgica", "BE", "EU"),
    ("ZRH", "Zúrich", "Suiza", "CH", "EU"),
    ("GVA", "Ginebra", "Suiza", "CH", "EU"),
    ("VIE", "Viena", "Austria", "AT", "EU"),
    ("PRG", "Praga", "Chequia", "CZ", "EU"),
    ("BUD", "Budapest", "Hungría", "HU", "EU"),
    ("WAW", "Varsovia", "Polonia", "PL", "EU"),
    ("KRK", "Cracovia", "Polonia", "PL", "EU"),
    ("CPH", "Copenhague", "Dinamarca", "DK", "EU"),
    ("STO", "Estocolmo", "Suecia", "SE", "EU"),
    ("OSL", "Oslo", "Noruega", "NO", "EU"),
    ("TOS", "Tromsø", "Noruega", "NO", "EU"),
    ("HEL", "Helsinki", "Finlandia", "FI", "EU"),
    ("RVN", "Rovaniemi (Laponia)", "Finlandia", "FI", "EU"),
    ("REK", "Reikiavik", "Islandia", "IS", "EU"),
    ("ATH", "Atenas", "Grecia", "GR", "EU"),
    ("JTR", "Santorini", "Grecia", "GR", "EU"),
    ("JMK", "Mykonos", "Grecia", "GR", "EU"),
    ("HER", "Creta (Heraklion)", "Grecia", "GR", "EU"),
    ("IST", "Estambul", "Turquía", "TR", "EU"),
    ("AYT", "Antalya", "Turquía", "TR", "EU"),
    ("DBV", "Dubrovnik", "Croacia", "HR", "EU"),
    ("SPU", "Split", "Croacia", "HR", "EU"),
    ("MLA", "Malta", "Malta", "MT", "EU"),
    ("TIA", "Tirana", "Albania", "AL", "EU"),
    ("BUH", "Bucarest", "Rumanía", "RO", "EU"),
    ("SOF", "Sofía", "Bulgaria", "BG", "EU"),
    ("LCA", "Lárnaca", "Chipre", "CY", "EU"),
    ("RIX", "Riga", "Letonia", "LV", "EU"),
    ("TLL", "Tallin", "Estonia", "EE", "EU"),
    ("VNO", "Vilna", "Lituania", "LT", "EU"),
    # --- África ---
    ("RAK", "Marrakech", "Marruecos", "MA", "AF"),
    ("CAS", "Casablanca", "Marruecos", "MA", "AF"),
    ("TNG", "Tánger", "Marruecos", "MA", "AF"),
    ("CAI", "El Cairo", "Egipto", "EG", "AF"),
    ("HRG", "Hurghada", "Egipto", "EG", "AF"),
    ("TUN", "Túnez", "Túnez", "TN", "AF"),
    ("DKR", "Dakar", "Senegal", "SN", "AF"),
    ("SID", "Isla de Sal", "Cabo Verde", "CV", "AF"),
    ("NBO", "Nairobi", "Kenia", "KE", "AF"),
    ("ZNZ", "Zanzíbar", "Tanzania", "TZ", "AF"),
    ("CPT", "Ciudad del Cabo", "Sudáfrica", "ZA", "AF"),
    ("JNB", "Johannesburgo", "Sudáfrica", "ZA", "AF"),
    ("MRU", "Mauricio", "Mauricio", "MU", "AF"),
    # --- Oriente Medio ---
    ("DXB", "Dubái", "Emiratos Árabes", "AE", "ME"),
    ("AUH", "Abu Dabi", "Emiratos Árabes", "AE", "ME"),
    ("DOH", "Doha", "Catar", "QA", "ME"),
    ("AMM", "Amán", "Jordania", "JO", "ME"),
    ("TLV", "Tel Aviv", "Israel", "IL", "ME"),
    ("MCT", "Mascate", "Omán", "OM", "ME"),
    # --- Norteamérica ---
    ("NYC", "Nueva York", "Estados Unidos", "US", "NA"),
    ("MIA", "Miami", "Estados Unidos", "US", "NA"),
    ("LAX", "Los Ángeles", "Estados Unidos", "US", "NA"),
    ("SFO", "San Francisco", "Estados Unidos", "US", "NA"),
    ("LAS", "Las Vegas", "Estados Unidos", "US", "NA"),
    ("ORL", "Orlando", "Estados Unidos", "US", "NA"),
    ("CHI", "Chicago", "Estados Unidos", "US", "NA"),
    ("BOS", "Boston", "Estados Unidos", "US", "NA"),
    ("WAS", "Washington", "Estados Unidos", "US", "NA"),
    ("HNL", "Honolulu", "Estados Unidos", "US", "NA"),
    ("YTO", "Toronto", "Canadá", "CA", "NA"),
    ("YMQ", "Montreal", "Canadá", "CA", "NA"),
    ("YVR", "Vancouver", "Canadá", "CA", "NA"),
    # --- Latinoamérica y Caribe ---
    ("MEX", "Ciudad de México", "México", "MX", "LA"),
    ("CUN", "Cancún", "México", "MX", "LA"),
    ("HAV", "La Habana", "Cuba", "CU", "LA"),
    ("PUJ", "Punta Cana", "Rep. Dominicana", "DO", "LA"),
    ("SDQ", "Santo Domingo", "Rep. Dominicana", "DO", "LA"),
    ("SJU", "San Juan", "Puerto Rico", "PR", "LA"),
    ("SJO", "San José", "Costa Rica", "CR", "LA"),
    ("PTY", "Ciudad de Panamá", "Panamá", "PA", "LA"),
    ("BOG", "Bogotá", "Colombia", "CO", "LA"),
    ("MDE", "Medellín", "Colombia", "CO", "LA"),
    ("CTG", "Cartagena de Indias", "Colombia", "CO", "LA"),
    ("LIM", "Lima", "Perú", "PE", "LA"),
    ("CUZ", "Cusco", "Perú", "PE", "LA"),
    ("UIO", "Quito", "Ecuador", "EC", "LA"),
    ("CCS", "Caracas", "Venezuela", "VE", "LA"),
    ("BUE", "Buenos Aires", "Argentina", "AR", "LA"),
    ("SCL", "Santiago de Chile", "Chile", "CL", "LA"),
    ("MVD", "Montevideo", "Uruguay", "UY", "LA"),
    ("RIO", "Río de Janeiro", "Brasil", "BR", "LA"),
    ("SAO", "São Paulo", "Brasil", "BR", "LA"),
    # --- Asia ---
    ("BKK", "Bangkok", "Tailandia", "TH", "AS"),
    ("HKT", "Phuket", "Tailandia", "TH", "AS"),
    ("TYO", "Tokio", "Japón", "JP", "AS"),
    ("OSA", "Osaka", "Japón", "JP", "AS"),
    ("SEL", "Seúl", "Corea del Sur", "KR", "AS"),
    ("BJS", "Pekín", "China", "CN", "AS"),
    ("SHA", "Shanghái", "China", "CN", "AS"),
    ("HKG", "Hong Kong", "China", "HK", "AS"),
    ("TPE", "Taipéi", "Taiwán", "TW", "AS"),
    ("SIN", "Singapur", "Singapur", "SG", "AS"),
    ("KUL", "Kuala Lumpur", "Malasia", "MY", "AS"),
    ("DPS", "Bali", "Indonesia", "ID", "AS"),
    ("JKT", "Yakarta", "Indonesia", "ID", "AS"),
    ("MNL", "Manila", "Filipinas", "PH", "AS"),
    ("SGN", "Ho Chi Minh", "Vietnam", "VN", "AS"),
    ("HAN", "Hanói", "Vietnam", "VN", "AS"),
    ("DEL", "Nueva Delhi", "India", "IN", "AS"),
    ("BOM", "Bombay", "India", "IN", "AS"),
    ("MLE", "Maldivas", "Maldivas", "MV", "AS"),
    ("CMB", "Colombo", "Sri Lanka", "LK", "AS"),
    ("KTM", "Katmandú", "Nepal", "NP", "AS"),
    # --- Oceanía ---
    ("SYD", "Sídney", "Australia", "AU", "OC"),
    ("MEL", "Melbourne", "Australia", "AU", "OC"),
    ("AKL", "Auckland", "Nueva Zelanda", "NZ", "OC"),
    ("PPT", "Tahití", "Polinesia Francesa", "PF", "OC"),
]

CITIES = [
    {"code": c, "name": n, "country": p, "country_code": cc, "region": r}
    for c, n, p, cc, r in _CITIES
]
BY_CODE = {c["code"]: c for c in CITIES}

# Orígenes principales de España (preset "Toda España")
SPAIN_ORIGINS = ["MAD", "BCN", "AGP", "PMI", "ALC", "VLC", "SVQ", "BIO", "LPA", "TCI", "IBZ", "SCQ"]


def search(q: str = "", limit: int = 30):
    q = (q or "").strip().lower()
    if not q:
        return CITIES[:limit]
    out = [
        c for c in CITIES
        if q in c["code"].lower() or q in c["name"].lower() or q in c["country"].lower()
    ]
    return out[:limit]


def countries():
    seen = {}
    for c in CITIES:
        seen.setdefault(c["country_code"], {"country_code": c["country_code"], "country": c["country"], "count": 0})
        seen[c["country_code"]]["count"] += 1
    return sorted(seen.values(), key=lambda x: x["country"])


def cities_in_country(country_code: str):
    return [c for c in CITIES if c["country_code"] == country_code.upper()]


def info(code: str):
    code = (code or "").upper()
    return BY_CODE.get(code, {"code": code, "name": code, "country": "", "country_code": "", "region": "EU"})


# ---------------------------------------------------------------------------
# Coordenadas aproximadas (lat, lon) para calcular distancias (modo demo y consejos)
COORDS = {
    "MAD": (40.47, -3.56), "BCN": (41.30, 2.08), "AGP": (36.67, -4.49), "PMI": (39.55, 2.74),
    "ALC": (38.28, -0.56), "VLC": (39.49, -0.48), "SVQ": (37.42, -5.90), "BIO": (43.30, -2.91),
    "LPA": (27.93, -15.39), "TCI": (28.20, -16.30), "ACE": (28.95, -13.60), "FUE": (28.45, -13.86),
    "IBZ": (38.87, 1.37), "SCQ": (42.90, -8.42), "OVD": (43.56, -6.03), "GRX": (37.19, -3.78),
    "ZAZ": (41.67, -1.04), "MAH": (39.86, 4.22),
    "LON": (51.47, -0.45), "MAN": (53.35, -2.27), "EDI": (55.95, -3.36), "DUB": (53.42, -6.27),
    "PAR": (49.00, 2.55), "NCE": (43.66, 7.21), "LYS": (45.72, 5.08), "ROM": (41.80, 12.25),
    "MIL": (45.63, 8.72), "VCE": (45.50, 12.35), "NAP": (40.88, 14.29), "FLR": (43.81, 11.20),
    "PMO": (38.18, 13.10), "LIS": (38.77, -9.13), "OPO": (41.24, -8.68), "FAO": (37.01, -7.97),
    "FNC": (32.69, -16.77), "PDL": (37.74, -25.70), "BER": (52.36, 13.50), "MUC": (48.35, 11.79),
    "FRA": (50.03, 8.57), "HAM": (53.63, 9.99), "AMS": (52.31, 4.76), "BRU": (50.90, 4.48),
    "ZRH": (47.46, 8.55), "GVA": (46.24, 6.11), "VIE": (48.11, 16.57), "PRG": (50.10, 14.26),
    "BUD": (47.44, 19.26), "WAW": (52.17, 20.97), "KRK": (50.08, 19.78), "CPH": (55.62, 12.65),
    "STO": (59.65, 17.93), "OSL": (60.19, 11.10), "TOS": (69.68, 18.92), "HEL": (60.32, 24.96),
    "RVN": (66.56, 25.83), "REK": (63.99, -22.60), "ATH": (37.94, 23.94), "JTR": (36.40, 25.48),
    "JMK": (37.44, 25.35), "HER": (35.34, 25.18), "IST": (41.26, 28.74), "AYT": (36.90, 30.80),
    "DBV": (42.56, 18.27), "SPU": (43.54, 16.30), "MLA": (35.86, 14.48), "TIA": (41.41, 19.72),
    "BUH": (44.57, 26.08), "SOF": (42.70, 23.41), "LCA": (34.88, 33.62), "RIX": (56.92, 23.97),
    "TLL": (59.41, 24.83), "VNO": (54.64, 25.28),
    "RAK": (31.61, -8.04), "CAS": (33.37, -7.59), "TNG": (35.73, -5.92), "CAI": (30.12, 31.41),
    "HRG": (27.18, 33.80), "TUN": (36.85, 10.23), "DKR": (14.74, -17.49), "SID": (16.74, -22.95),
    "NBO": (-1.32, 36.93), "ZNZ": (-6.22, 39.22), "CPT": (-33.97, 18.60), "JNB": (-26.14, 28.25),
    "MRU": (-20.43, 57.68),
    "DXB": (25.25, 55.36), "AUH": (24.43, 54.65), "DOH": (25.27, 51.61), "AMM": (31.72, 35.99),
    "TLV": (32.01, 34.89), "MCT": (23.59, 58.28),
    "NYC": (40.64, -73.78), "MIA": (25.80, -80.29), "LAX": (33.94, -118.41), "SFO": (37.62, -122.38),
    "LAS": (36.08, -115.15), "ORL": (28.43, -81.31), "CHI": (41.98, -87.90), "BOS": (42.36, -71.01),
    "WAS": (38.95, -77.46), "HNL": (21.32, -157.92), "YTO": (43.68, -79.63), "YMQ": (45.47, -73.74),
    "YVR": (49.19, -123.18),
    "MEX": (19.44, -99.07), "CUN": (21.04, -86.87), "HAV": (22.99, -82.41), "PUJ": (18.57, -68.36),
    "SDQ": (18.43, -69.67), "SJU": (18.44, -66.00), "SJO": (9.99, -84.20), "PTY": (9.07, -79.38),
    "BOG": (4.70, -74.15), "MDE": (6.16, -75.42), "CTG": (10.44, -75.51), "LIM": (-12.02, -77.11),
    "CUZ": (-13.54, -71.94), "UIO": (-0.13, -78.36), "CCS": (10.60, -66.99), "BUE": (-34.82, -58.54),
    "SCL": (-33.39, -70.79), "MVD": (-34.84, -56.03), "RIO": (-22.81, -43.25), "SAO": (-23.43, -46.47),
    "BKK": (13.69, 100.75), "HKT": (8.11, 98.32), "TYO": (35.55, 139.78), "OSA": (34.43, 135.23),
    "SEL": (37.46, 126.44), "BJS": (40.08, 116.58), "SHA": (31.14, 121.80), "HKG": (22.31, 113.91),
    "TPE": (25.08, 121.23), "SIN": (1.36, 103.99), "KUL": (2.75, 101.71), "DPS": (-8.75, 115.17),
    "JKT": (-6.13, 106.66), "MNL": (14.51, 121.02), "SGN": (10.82, 106.66), "HAN": (21.22, 105.81),
    "DEL": (28.56, 77.10), "BOM": (19.09, 72.87), "MLE": (4.19, 73.53), "CMB": (7.18, 79.88),
    "KTM": (27.70, 85.36),
    "SYD": (-33.95, 151.18), "MEL": (-37.67, 144.84), "AKL": (-37.01, 174.79), "PPT": (-17.55, -149.61),
}

# Códigos de ciudad -> aeropuertos, para Google Flights (SerpApi)
GOOGLE_AIRPORTS = {
    "TCI": "TFN,TFS", "LON": "LHR,LGW,STN,LTN", "PAR": "CDG,ORY", "ROM": "FCO,CIA", "MIL": "MXP,LIN,BGY",
    "NYC": "JFK,EWR,LGA", "STO": "ARN", "BUE": "EZE,AEP", "RIO": "GIG", "SAO": "GRU", "TYO": "HND,NRT",
    "OSA": "KIX", "SEL": "ICN", "BJS": "PEK,PKX", "SHA": "PVG", "JKT": "CGK", "YTO": "YYZ", "YMQ": "YUL",
    "WAS": "IAD,DCA", "CHI": "ORD", "ORL": "MCO", "BUH": "OTP", "REK": "KEF", "CAS": "CMN", "BER": "BER",
}

# Destinos de playa/estacionales (verano muy caro, algunos sin vuelos en invierno)
SUMMER_BEACH = {"PMI", "IBZ", "MAH", "JTR", "JMK", "HER", "DBV", "SPU", "AYT", "FAO", "MLA", "TIA", "LCA", "PMO"}
SUMMER_ONLY = {"JTR", "JMK", "MAH"}             # casi sin vuelos nov–mar
WINTER_SUN = {"LPA", "TCI", "ACE", "FUE", "FNC", "HRG", "RAK", "SID"}
WINTER_ONLY = {"RVN"}                            # Laponia: temporada dic–mar
LOWCOST_HOT = {"LON", "PAR", "ROM", "MIL", "AMS", "BER", "LIS", "OPO", "DUB", "BRU", "BUD", "PRG",
               "MAN", "NAP", "VCE", "PMI", "BCN", "MAD", "AGP", "TCI", "LPA", "IBZ", "PMO", "KRK", "WAW"}
# Vuelos directos de largo radio desde los hubs españoles (aprox.)
LONGHAUL_DIRECT = {
    "MAD": {"NYC", "MIA", "BOS", "CHI", "WAS", "LAX", "SFO", "MEX", "CUN", "HAV", "PUJ", "SDQ", "SJU",
            "SJO", "PTY", "BOG", "MDE", "LIM", "UIO", "CCS", "BUE", "SCL", "MVD", "RIO", "SAO", "TYO",
            "DOH", "DXB", "TLV", "JNB"},
    "BCN": {"NYC", "MIA", "DOH", "DXB", "BOG", "SCL", "LIM", "SIN", "SEL", "TLV", "SAO"},
}


def distance_km(a: str, b: str) -> float:
    import math
    ca, cb = COORDS.get(a.upper()), COORDS.get(b.upper())
    if not ca or not cb:
        return 2500.0
    lat1, lon1, lat2, lon2 = map(math.radians, (*ca, *cb))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def is_long_haul(a: str, b: str) -> bool:
    return distance_km(a, b) > 3800


def google_airports(code: str) -> str:
    return GOOGLE_AIRPORTS.get(code.upper(), code.upper())
