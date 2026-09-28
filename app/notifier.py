"""Avisos por email (Gmail u otro SMTP): un único resumen por escaneo con las mejores ofertas."""
import html
import logging
import smtplib
import ssl
from datetime import date
from email.message import EmailMessage

from . import airlines, catalog, db
from .providers import booking_links

log = logging.getLogger(__name__)

EMOJI = {"record": "🏆", "deal": "🔥", "target": "🎯", "drop": "📉"}
KIND = {"record": "Mínimo histórico", "deal": "Chollo", "target": "Bajo tu precio", "drop": "Bajada"}
_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def email_ready(s: dict) -> bool:
    return bool(s.get("email_to") and s.get("smtp_password"))


def in_quiet_hours(s: dict, now=None) -> bool:
    """quiet_hours = "23-8" -> no se envían avisos entre las 23:00 y las 8:00 (hora local)."""
    spec = (s.get("quiet_hours") or "").strip()
    if not spec or "-" not in spec:
        return False
    try:
        a, b = (int(x) for x in spec.split("-", 1))
        from datetime import datetime
        from zoneinfo import ZoneInfo
        h = (now or datetime.now(ZoneInfo(s.get("timezone") or "Europe/Madrid"))).hour
    except Exception:  # noqa: BLE001 - zona horaria o formato inválidos: no silenciar
        return False
    return (a <= h < b) if a < b else (h >= a or h < b)


def send_email(s, subject: str, text: str, html_body: str):
    to = s["email_to"].strip()
    user = s.get("smtp_user") or to
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"Flight Tracker <{s.get('smtp_from') or user}>"
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    host, port = s.get("smtp_host") or "smtp.gmail.com", int(s.get("smtp_port") or 587)
    ctx = ssl.create_default_context()
    pw = (s.get("smtp_password") or "").replace(" ", "")
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as srv:
            srv.login(user, pw)
            srv.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as srv:
            srv.starttls(context=ctx)
            srv.login(user, pw)
            srv.send_message(msg)


def _d(iso):
    d = date.fromisoformat(iso)
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}"


def _dur(m):
    if not m:
        return ""
    h, mm = divmod(int(m), 60)
    return f"{h} h {mm:02d}" if mm else f"{h} h"


def _card(a, site_url):
    q = db.one("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=? AND depart_date=?",
               (a["origin"], a["destination"], a["trip"], a["depart_date"])) or {}
    info = catalog.info(a["destination"])
    links = booking_links(a["origin"], a["destination"], a["depart_date"], a.get("return_date"))
    main = a.get("link") or links["aviasales"]
    when = _d(a["depart_date"]) + (f" → {_d(a['return_date'])}" if a.get("return_date") else " · solo ida")
    stops = q.get("transfers")
    facts = [when]
    if stops is not None:
        facts.append("directo" if stops == 0 else f"{stops} escala{'s' if stops > 1 else ''}")
    if q.get("duration"):
        facts.append(f"⏱ {_dur(q['duration'])}")
    if q.get("dep_time"):
        facts.append(f"sale {q['dep_time']}")
    if q.get("airline"):
        facts.append(airlines.name(q["airline"]))
    pct = round((a.get("savings") or 0) * 100)
    badge = (f"<span style='background:#e1f5ec;color:#0b7f55;border-radius:99px;padding:2px 8px;font-weight:700'>"
             f"−{pct}%</span>") if pct >= 5 else ""
    web = f" · <a href='{html.escape(site_url)}#alerts'>Ver en tu web</a>" if site_url else ""
    return (f"<tr><td style='padding:14px 16px;border-bottom:1px solid #e2e7f0'>"
            f"<div style='font-size:13px;color:#5d677c'>{EMOJI.get(a['kind'], '✈️')} {KIND.get(a['kind'], '')} · "
            f"desde {html.escape(a['origin'])}</div>"
            f"<div style='font-size:18px;font-weight:800;margin:2px 0'>{html.escape(info['name'])} "
            f"<span style='color:#3656f5'>{round(a['price'])} €</span> {badge}</div>"
            f"<div style='font-size:13px;color:#3d4659'>{html.escape(' · '.join(facts))}</div>"
            f"<div style='font-size:13px;margin-top:6px'><a href='{html.escape(main)}'><b>Reservar</b></a> · "
            f"<a href='{html.escape(links['google'])}'>Google Flights</a> · "
            f"<a href='{html.escape(links['skyscanner'])}'>Skyscanner</a>{web}</div></td></tr>")


def send_digest(alerts, settings=None) -> dict:
    """Un único email por escaneo con las mejores ofertas (ya filtradas por el anti-spam)."""
    s = settings or db.get_settings()
    if not alerts or not email_ready(s):
        return {}
    if in_quiet_hours(s):
        return {"skipped": "horas de silencio"}
    prio = {"record": 4, "deal": 3, "target": 2, "drop": 1}
    top = sorted(alerts, key=lambda a: (-prio.get(a["kind"], 0), -(a.get("savings") or 0)))[: int(s.get("notify_max_items", 10))]
    best = top[0]
    name = catalog.info(best["destination"])["name"]
    title = (f"✈️ {name} por {round(best['price'])} €" + (f" y {len(alerts) - 1} oferta(s) más" if len(alerts) > 1 else ""))
    if s.get("provider") == "demo":
        title = "[DEMO · precios simulados] " + title
    site = (s.get("site_url") or "").rstrip("/") + "/" if s.get("site_url") else ""
    html_body = ("<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto'>"
                 f"<h2 style='margin:0 0 12px'>{html.escape(title)}</h2>"
                 "<table style='width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e7f0;"
                 "border-radius:12px'>" + "".join(_card(a, site) for a in top) + "</table>"
                 "<p style='font-size:12px;color:#5d677c'>Precios de búsquedas recientes: confírmalos al reservar.</p></div>")
    text = "\n\n".join(f"{EMOJI.get(a['kind'], '✈️')} {a['message']}\n{a.get('link') or ''}" for a in top)
    try:
        send_email(s, title, text, html_body)
        res = {"email": "ok"}
        ids = [a["id"] for a in alerts if a.get("id")]
        if ids:
            db.execute(f"UPDATE alerts SET notified=1 WHERE id IN ({','.join('?' * len(ids))})", ids)
    except Exception as e:  # noqa: BLE001
        log.warning("Fallo enviando email: %s", e)
        res = {"email": f"error: {e}"}
    return res


def send_test(settings=None) -> dict:
    s = settings or db.get_settings()
    if not email_ready(s):
        return {"error": "Falta tu email o la contraseña de aplicación (Ajustes → Email en tu web)"}
    msg = "✅ Aviso de prueba de Flight Tracker. Si lees esto, los avisos por email funcionan."
    try:
        send_email(s, "Flight Tracker – prueba", msg, f"<p style='font-family:sans-serif'>{html.escape(msg)}</p>")
        return {"email": "ok"}
    except Exception as e:  # noqa: BLE001
        return {"email": f"error: {e}"}
