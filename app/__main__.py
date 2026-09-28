"""Comandos (los usa GitHub Actions; no necesitas ejecutarlos tú):
    python -m app scan           -> escanea precios y detecta chollos
    python -m app daily          -> envía el resumen diario de ofertas
    python -m app export site/   -> genera tu web (GitHub Pages)
    python -m app apply-config   -> guarda en config.json los ajustes enviados desde la web
"""
import json
import os
import sys

from . import init


def _summary(res: dict) -> str:
    from . import db, tracker
    from .providers import get_provider
    s = db.get_settings()
    icon = {"ok": "✅", "partial": "⚠️", "error": "❌"}.get(res.get("status"), "ℹ️")
    lines = [f"## {icon} Escaneo de vuelos", "",
             f"**Precios:** {'reales (Travelpayouts)' if get_provider(s).name == 'travelpayouts' else 'simulados'} · **Orígenes:** {', '.join(s.get('origins') or [])} · "
             f"**Rutas:** {res.get('routes', 0)} · **Días con precio:** {res.get('quotes', 0)} · "
             f"**Avisos nuevos:** {res.get('alerts', 0)}", ""]
    if res.get("error"):
        lines += [f"> ❌ {res['error']}", ""]
    for trip in db.trips(s):
        deals = tracker.current_deals(10, trip=trip)
        if not deals:
            continue
        lines += [f"### 🔥 Mejores precios · {tracker.TRIP_LABELS[trip]}", "",
                  "| Destino | Desde | Fechas | Precio | vs. habitual |", "|---|---|---|---:|---:|"]
        for d in deals:
            when = tracker.fmt_date(d["depart_date"], False) + (
                f" → {tracker.fmt_date(d['return_date'], False)}" if d.get("return_date") else "")
            pct = f"−{round(d['savings'] * 100)}%" if d.get("savings", 0) > 0.02 else "—"
            lines.append(f"| {d['name']} | {d['origin']} | {when} | [{round(d['price'])} €]({d['links']['aviasales']}) | {pct} |")
        lines.append("")
    if res.get("errors"):
        lines += ["<details><summary>Errores</summary>", ""] + [f"- {e}" for e in res["errors"]] + ["", "</details>"]
    return "\n".join(lines)


def _step_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "apply-config":
        # llamado por el workflow «Guardar ajustes» con la issue creada desde la web
        from . import config
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
            event = json.load(f)
        new = config.from_issue(event)
        cfg = config.load()
        cfg.update(new)
        config.save(cfg)
        print(json.dumps(cfg, ensure_ascii=False))
        out = os.environ.get("GITHUB_OUTPUT")
        if out:  # «Enviarme el resumen ahora» desde la web
            with open(out, "a", encoding="utf-8") as f:
                wants = '"_resumen": true' in (event["issue"].get("body") or "")
                f.write("resumen=" + ("true" if wants else "false") + "\n")
        return
    init()
    from . import config, db
    db.apply_env_config()
    config.apply(config.load())   # config.json (lo que guardas desde la web) manda
    if cmd == "scan":
        from . import tracker
        res = tracker.run_scan(notify=False)   # los avisos van en el resumen diario
        print(json.dumps(res, ensure_ascii=False, indent=2))
        _step_summary(_summary(res))
        sys.exit(1 if res.get("status") == "error" else 0)
    elif cmd == "daily":
        from . import daily
        res = daily.send()
        print(json.dumps(res, ensure_ascii=False))
        _step_summary(f"## 📧 Resumen diario\n\n{res}")
    elif cmd == "export":
        from .site import export_site
        out = sys.argv[2] if len(sys.argv) > 2 else "site"
        print(json.dumps(export_site(out, os.environ.get("SITE_TITLE") or None), ensure_ascii=False))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
