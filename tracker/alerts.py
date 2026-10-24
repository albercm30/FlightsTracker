"""Avisos de chollos por email.

Sin configurar nada: se publica una *issue* en tu repositorio que te menciona y GitHub te la
manda al email de tu cuenta de GitHub. Si prefieres que llegue directamente desde tu Gmail,
crea los secrets GMAIL_ADDRESS y GMAIL_APP_PASSWORD (contraseña de aplicación de Google).
"""
import html
import logging
import os
import smtplib
import ssl
from datetime import date
from email.message import EmailMessage

import requests

from . import airports
from .providers import booking_links

log = logging.getLogger(__name__)
DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def fdate(iso):
    d = date.fromisoformat(iso)
    return f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}"


def money(p, cur="eur"):
    return f"{round(p):,}".replace(",", ".") + {"eur": " €", "usd": " $", "gbp": " £"}.get(cur, "")


def describe(o):
    when = fdate(o["dep"]) + (f" → {fdate(o['ret'])} ({o['nights']} noches)" if o.get("ret") else " · solo ida")
    stops = "directo" if o["stops"] == 0 else f"{o['stops']} escala{'s' if o['stops'] > 1 else ''}"
    dur = f" · {o['duration'] // 60} h {o['duration'] % 60:02d}" if o.get("duration") else ""
    return when, f"{stops}{dur} · {airports.airline(o['airline'])}"


def build(deals, site_url, cur="eur"):
    """deals: [(watch, oferta)]. Devuelve (asunto, markdown, html)."""
    w0, o0 = deals[0]
    subject = (f"🔥 {airports.city(o0['origin'])} → {airports.city(o0['destination'])} por {money(o0['price'], cur)}"
               f" (−{round(o0['discount'] * 100)} %)" + (f" y {len(deals) - 1} chollo(s) más" if len(deals) > 1 else ""))
    md, cards = [], []
    for w, o in deals:
        when, facts = describe(o)
        links = booking_links(o["origin"], o["destination"], o["dep"], o.get("ret"))
        lk = " · ".join(f"[{k}]({v})" for k, v in links.items())
        why = {"chollo": f"−{round(o['discount'] * 100)} % vs. lo habitual",
               "precio objetivo": "por debajo de tu precio máximo",
               "mínimo histórico": "el más barato visto nunca"}.get(o["top"], "")
        md += [f"### {airports.city(o['origin'])} → {airports.city(o['destination'])} · **{money(o['price'], cur)}**",
               f"{when} · {facts}  ", f"🏷️ {why} · puntuación **{o['score']}/100** · seguimiento «{w['name']}»  ", lk, ""]
        cards.append(
            "<tr><td style='padding:16px;border-bottom:1px solid #e5e7eb'>"
            f"<div style='font-size:12px;color:#6b7280'>{html.escape(w['name'])} · puntuación {o['score']}/100</div>"
            f"<div style='font-size:20px;font-weight:800;margin:4px 0'>{html.escape(airports.city(o['origin']))} → "
            f"{html.escape(airports.city(o['destination']))} <span style='color:#7c3aed'>{money(o['price'], cur)}</span>"
            f" <span style='background:#dcfce7;color:#15803d;border-radius:99px;padding:2px 8px;font-size:13px'>{html.escape(why)}</span></div>"
            f"<div style='font-size:14px;color:#374151'>{html.escape(when)}<br>{html.escape(facts)}</div>"
            "<div style='margin-top:8px;font-size:14px'>" + " · ".join(f"<a href='{html.escape(v)}'>{k}</a>" for k, v in links.items())
            + "</div></td></tr>")
    if site_url:
        md.append(f"[Ver todo en tu web]({site_url})")
    body_html = ("<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto'>"
                 f"<h2>{html.escape(subject)}</h2><table style='width:100%;border-collapse:collapse'>" + "".join(cards)
                 + "</table>" + (f"<p><a href='{html.escape(site_url)}'>Ver todo en tu web →</a></p>" if site_url else "") + "</div>")
    return subject, "\n".join(md), body_html


def send(deals, site_url="", cur="eur", test=False):
    if not deals:
        return {"sent": False, "why": "sin chollos top"}
    subject, md, body_html = build(deals, site_url, cur)
    if test:
        subject = "[PRUEBA] " + subject
    addr, pw = os.environ.get("GMAIL_ADDRESS"), os.environ.get("GMAIL_APP_PASSWORD")
    if addr and pw:
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, f"Flight Tracker <{addr}>", addr
        msg.set_content(md)
        msg.add_alternative(body_html, subtype="html")
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(addr, pw.replace(" ", ""))
            s.send_message(msg)
        return {"sent": True, "via": "gmail"}
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not (repo and token):
        return {"sent": False, "why": "sin GITHUB_TOKEN (fuera de GitHub Actions)", "subject": subject, "body": md}
    owner = os.environ.get("GITHUB_REPOSITORY_OWNER") or repo.split("/")[0]
    r = requests.post(f"https://api.github.com/repos/{repo}/issues", timeout=30,
                      headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                      json={"title": subject, "body": f"@{owner}\n\n" + md})
    r.raise_for_status()
    return {"sent": True, "via": "github", "url": r.json().get("html_url")}
