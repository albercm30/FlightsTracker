"""Envío de avisos: Telegram, ntfy (push al móvil) y email."""
import html
import json
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

import requests

from . import db
from .providers import booking_links

log = logging.getLogger(__name__)

EMOJI = {"record": "🏆", "deal": "🔥", "target": "🎯", "drop": "📉", "watch_down": "👀📉", "watch_up": "👀📈"}


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


def push_subs(s: dict):
    from .webpush import parse_subscriptions
    return parse_subscriptions(s.get("push_subscriptions")) if s.get("vapid_private") and s.get("vapid_public") else []


def send_push(s: dict, title: str, body: str, url: str = "", urgency: str = "normal") -> str:
    from . import db
    from .webpush import send
    subs = push_subs(s)
    ok, gone = 0, []
    subject = f"mailto:{s.get('email_to') or s.get('smtp_from') or 'flight-tracker@example.com'}"
    for sub in subs:
        try:
            code = send(sub, {"title": title, "body": body, "url": url or s.get("site_url") or "./", "tag": "flight-deals"},
                        s["vapid_private"], s["vapid_public"], subject=subject, urgency=urgency)
        except Exception as e:  # noqa: BLE001
            log.warning("Push fallido: %s", e)
            continue
        if code in (200, 201, 202):
            ok += 1
        elif code in (404, 410):
            gone.append(sub["endpoint"])
    if gone and not os.environ.get("GITHUB_ACTIONS"):
        keep = [x for x in subs if x["endpoint"] not in gone]
        db.update_settings({"push_subscriptions": json.dumps(keep)})
    if not ok:
        raise RuntimeError(f"ningún dispositivo aceptó el aviso ({len(subs)} suscritos, {len(gone)} caducados)")
    return f"ok ({ok} dispositivo{'s' if ok > 1 else ''})"


def enabled_channels(s: dict):
    ch = []
    if push_subs(s):
        ch.append("push")
    if s.get("telegram_bot_token") and s.get("telegram_chat_id"):
        ch.append("telegram")
    if s.get("ntfy_topic"):
        ch.append("ntfy")
    if s.get("smtp_host") and s.get("email_to"):
        ch.append("email")
    return ch


def _sorted(alerts):
    prio = {"watch_down": 5, "record": 4, "deal": 3, "target": 2, "drop": 1, "watch_up": 0}
    return sorted(alerts, key=lambda a: (-prio.get(a["kind"], 0), -(a.get("savings") or 0)))


def send_telegram(s, text_html: str):
    url = f"https://api.telegram.org/bot{s['telegram_bot_token']}/sendMessage"
    r = requests.post(url, json={"chat_id": s["telegram_chat_id"], "text": text_html, "parse_mode": "HTML",
                                 "disable_web_page_preview": True}, timeout=20)
    r.raise_for_status()


def send_ntfy(s, title: str, body: str, click: str = "", priority: str = "default"):
    server = (s.get("ntfy_server") or "https://ntfy.sh").rstrip("/")
    payload = {"topic": s["ntfy_topic"], "title": title, "message": body, "tags": ["airplane"],
               "priority": {"high": 4, "default": 3}.get(priority, 3)}
    if click:
        payload["click"] = click
    r = requests.post(server, json=payload, timeout=20)  # publicación JSON (admite UTF-8)
    r.raise_for_status()


def send_email(s, subject: str, text: str, html_body: str):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.get("smtp_from") or s.get("smtp_user")
    msg["To"] = s["email_to"]
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    port = int(s.get("smtp_port") or 587)
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(s["smtp_host"], port, context=ctx, timeout=30) as srv:
            if s.get("smtp_user"):
                srv.login(s["smtp_user"], s.get("smtp_password", ""))
            srv.send_message(msg)
    else:
        with smtplib.SMTP(s["smtp_host"], port, timeout=30) as srv:
            srv.starttls(context=ctx)
            if s.get("smtp_user"):
                srv.login(s["smtp_user"], s.get("smtp_password", ""))
            srv.send_message(msg)


def _links(a):
    links = booking_links(a["origin"], a["destination"], a["depart_date"], a.get("return_date"))
    return a.get("link") or links["aviasales"], links


def send_digest(alerts, settings=None) -> dict:
    """Envía un único resumen con las mejores alertas del escaneo."""
    s = settings or db.get_settings()
    channels = enabled_channels(s)
    if not alerts or not channels:
        return {}
    if in_quiet_hours(s):
        return {"skipped": "horas de silencio"}
    top = _sorted(alerts)[: int(s.get("notify_max_items", 10))]
    rest = len(alerts) - len(top)
    title = f"✈️ {len(alerts)} oferta(s) de vuelos"
    if s.get("provider") == "demo":
        title = "[DEMO · precios simulados] " + title

    tg_lines = [f"<b>{html.escape(title)}</b>", ""]
    txt_lines = []
    html_items = []
    for a in top:
        main, links = _links(a)
        e = EMOJI.get(a["kind"], "✈️")
        tg_lines.append(f"{e} {html.escape(a['message'])}\n"
                        f"<a href=\"{html.escape(main)}\">Ver</a> · <a href=\"{html.escape(links['google'])}\">Google Flights</a>"
                        f" · <a href=\"{html.escape(links['skyscanner'])}\">Skyscanner</a>")
        txt_lines.append(f"{e} {a['message']}\n   {main}")
        html_items.append(f"<li style='margin-bottom:10px'>{e} {html.escape(a['message'])}<br>"
                          f"<a href='{html.escape(main)}'>Ver oferta</a> · "
                          f"<a href='{html.escape(links['google'])}'>Google Flights</a> · "
                          f"<a href='{html.escape(links['skyscanner'])}'>Skyscanner</a></li>")
    if rest > 0:
        tg_lines.append(f"\n…y {rest} más en la app.")
        txt_lines.append(f"…y {rest} más en la app.")
    result = {}
    for ch in channels:
        try:
            if ch == "push":
                first_link, _ = _links(top[0])
                short = [f"{EMOJI.get(a['kind'], '✈️')} {a['origin']}→{a['destination']} {round(a['price'])} €"
                         + (f" (−{round(a['savings'] * 100)}%)" if a.get("savings", 0) > 0.05 else "") for a in top[:4]]
                url = (s.get("site_url") or "").rstrip("/") + "/#alerts" if s.get("site_url") else first_link
                result[ch] = send_push(s, title, "\n".join(short) + (f"\n…y {len(alerts) - 4} más" if len(alerts) > 4 else ""),
                                       url, "high" if any(a["kind"] in ("record", "deal") for a in top) else "normal")
                continue
            if ch == "telegram":
                send_telegram(s, "\n\n".join(tg_lines))
            elif ch == "ntfy":
                first_link, _ = _links(top[0])
                prio = "high" if any(a["kind"] in ("record", "deal") for a in top) else "default"
                send_ntfy(s, title, "\n\n".join(txt_lines), click=first_link, priority=prio)
            elif ch == "email":
                html_body = (f"<h2>{html.escape(title)}</h2><ul style='font-family:sans-serif'>"
                             + "".join(html_items) + "</ul>"
                             + (f"<p>…y {rest} más en la app.</p>" if rest > 0 else ""))
                send_email(s, title, "\n\n".join(txt_lines), html_body)
            result[ch] = "ok"
        except Exception as e:  # noqa: BLE001
            log.warning("Fallo enviando por %s: %s", ch, e)
            result[ch] = f"error: {e}"
    if any(str(v).startswith("ok") for v in result.values()):
        ids = [a["id"] for a in alerts if a.get("id")]
        if ids:
            db.execute(f"UPDATE alerts SET notified=1 WHERE id IN ({','.join('?' * len(ids))})", ids)
    return result


def send_test(settings=None) -> dict:
    s = settings or db.get_settings()
    channels = enabled_channels(s)
    if not channels:
        return {"error": "No hay ningún canal configurado"}
    out = {}
    msg = "✅ Aviso de prueba de Flight Tracker. Si lees esto, las notificaciones funcionan."
    for ch in channels:
        try:
            if ch == "push":
                out[ch] = send_push(s, "Flight Tracker", "✅ Aviso de prueba: las notificaciones funcionan.")
                continue
            if ch == "telegram":
                send_telegram(s, html.escape(msg))
            elif ch == "ntfy":
                send_ntfy(s, "Flight Tracker", msg)
            elif ch == "email":
                send_email(s, "Flight Tracker – prueba", msg, f"<p>{html.escape(msg)}</p>")
            out[ch] = "ok"
        except Exception as e:  # noqa: BLE001
            out[ch] = f"error: {e}"
    return out
