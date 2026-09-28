"""El correo diario: las mejores ofertas de tus destinos.

Sin contraseñas: el resumen se publica cada mañana como una *issue* de tu repositorio que te
menciona, y GitHub te la envía a tu email (el de tu cuenta de GitHub). Si algún día
configuras un SMTP (secret SMTP_PASSWORD), se envía directamente por email.
"""
import html
import logging
import os
from datetime import date, datetime, timedelta, timezone

import requests

from . import airlines, catalog, db, notifier, tracker

log = logging.getLogger(__name__)
OWNER_EMAIL = "albertocm30.2001@gmail.com"
TITLE_PREFIX = "✈️ Ofertas del"
_DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
           "noviembre", "diciembre"]


def _dur(m):
    if not m:
        return ""
    h, mm = divmod(int(m), 60)
    return f"{h} h {mm:02d}" if mm else f"{h} h"


def _when(d):
    s = tracker.fmt_date(d["depart_date"], False)
    if d.get("return_date"):
        s += f" → {tracker.fmt_date(d['return_date'], False)}"
    return s


def _facts(d):
    out = []
    t = d.get("transfers")
    if t is not None:
        out.append("directo" if t == 0 else f"{t} escala{'s' if t > 1 else ''}")
    if d.get("duration"):
        out.append(_dur(d["duration"]))
    if d.get("airline"):
        out.append(airlines.name(d["airline"]))
    return " · ".join(out)


def collect(today: date = None) -> dict:
    """Los datos del resumen: chollos nuevos (24 h) + lo más barato ahora en cada destino."""
    s = db.get_settings()
    today = today or date.today()
    trips = db.trips(s)
    best = {}
    for t in trips:
        for d in tracker.current_deals(100, today=today, trip=t):
            cur = best.get(d["destination"])
            if cur is None or (t == "rt" and cur["trip"] == "ow") or (t == cur["trip"] and d["savings"] > cur["savings"]):
                best[d["destination"]] = d
    rows = sorted(best.values(), key=lambda d: -(d.get("savings") or 0))
    since = (datetime.now(timezone.utc) - timedelta(hours=26)).replace(microsecond=0).isoformat()
    new = db.rows("SELECT * FROM alerts WHERE created_at>=? AND depart_date>=? AND kind NOT LIKE 'watch%' "
                  "ORDER BY id DESC", (since, today.isoformat()))
    seen, deals = set(), []
    for a in new:
        if a["destination"] in seen:
            continue
        seen.add(a["destination"])
        q = db.one("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=? AND depart_date=?",
                   (a["origin"], a["destination"], a["trip"], a["depart_date"])) or {}
        deals.append({**q, **a, "savings": (1 - a["price"] / a["ref_price"]) if a.get("ref_price") else 0,
                      "name": catalog.info(a["destination"])["name"]})
    return {"settings": s, "today": today, "deals": deals, "rows": rows,
            "demo": tracker.get_provider(s).name == "demo"}


def markdown(data: dict, mention: str = "") -> str:
    s, today = data["settings"], data["today"]
    site = (s.get("site_url") or "").rstrip("/")
    lines = []
    if mention:
        lines += [f"@{mention}", ""]
    if data["demo"]:
        lines += ["> 🎲 **Precios simulados**: añade tu clave de Travelpayouts para ver precios reales.", ""]
    if data["deals"]:
        lines += ["### 🔥 Chollos nuevos", ""]
        for d in data["deals"]:
            if d.get("kind") == "record":
                pct = " · 🏆 **el más barato visto nunca** en esta ruta"
            elif d.get("kind") == "target":
                pct = " · 🎯 por debajo de tu precio máximo"
            else:
                pct = f" · **−{round(d['savings'] * 100)} %** vs. lo habitual" if d.get("savings", 0) >= 0.05 else ""
            lines.append(f"- **{d['name']}** desde {d['origin']} · **{round(d['price'])} €** "
                         f"{'i/v' if d.get('return_date') else 'ida'} · {_when(d)} · {_facts(d)}{pct} · "
                         f"[Reservar]({d.get('link') or tracker.booking_links(d['origin'], d['destination'], d['depart_date'], d.get('return_date'))['aviasales']})")
        lines.append("")
    else:
        lines += ["Hoy no hay chollos nuevos que merezcan la pena. Estos son los mejores precios ahora:", ""]
    if data["rows"]:
        lines += ["### ✈️ Lo más barato en tus destinos", "",
                  "| Destino | Desde | Fechas | Precio | Vuelo | vs. habitual |", "|---|---|---|---:|---|---:|"]
        for d in data["rows"][:25]:
            pct = f"−{round(d['savings'] * 100)} %" if d.get("savings", 0) >= 0.03 else "—"
            name = d["name"] + (f" <sub>({d['length']})</sub>" if d.get("length") else "")
            lines.append(f"| {name} | {d['origin']} | {_when(d)} | [{round(d['price'])} €]({d['links']['aviasales']}) "
                         f"{'i/v' if d['trip'] == 'rt' else 'ida'} | {_facts(d)} | {pct} |")
        lines.append("")
    else:
        lines += ["Aún no hay precios: añade destinos en tu web → Mis destinos.", ""]
    if site:
        lines += [f"[Abrir mi web]({site}/) · [Buscar el mejor día]({site}/#search) · [Explorar]({site}/#explore)"]
    return "\n".join(lines)


def html_body(data: dict) -> str:
    """Versión HTML (solo si envías por SMTP)."""
    md = markdown(data)
    esc = html.escape(md).replace("\n", "<br>")
    return f"<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px'>{esc}</div>"


def title(data: dict) -> str:
    t = data["today"]
    base = f"{TITLE_PREFIX} {_DAYS[t.weekday()]} {t.day} de {_MONTHS[t.month - 1]}"
    if data["deals"]:
        d = data["deals"][0]
        base += f" · {d['name']} {round(d['price'])} €" + (f" y {len(data['deals']) - 1} más" if len(data["deals"]) > 1 else "")
    elif data["rows"]:
        d = data["rows"][0]
        base += f" · {d['name']} desde {round(d['price'])} €"
    return base


# ---------------------------------------------------------------------------
def _gh(method, path, **kw):
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    r = requests.request(method, f"https://api.github.com/repos/{repo}{path}", timeout=30,
                         headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def send(today: date = None) -> dict:
    data = collect(today)
    s = data["settings"]
    if s.get("smtp_password"):
        to = s.get("email_to") or OWNER_EMAIL
        notifier.send_email({**s, "email_to": to}, title(data), markdown(data), html_body(data))
        return {"via": "email", "to": to}
    if not (os.environ.get("GITHUB_TOKEN") and os.environ.get("GITHUB_REPOSITORY")):
        return {"via": "none", "text": markdown(data)}
    owner = os.environ.get("GITHUB_REPOSITORY_OWNER") or os.environ["GITHUB_REPOSITORY"].split("/")[0]
    issue = _gh("POST", "/issues", json={"title": title(data), "body": markdown(data, mention=owner)})
    return {"via": "github", "issue": issue.get("html_url")}
