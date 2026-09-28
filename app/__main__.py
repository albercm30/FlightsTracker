"""Arranque:
    python -m app          -> interfaz web
    python -m app scan     -> un escaneo único + avisos (cron, GitHub Actions)
"""
import json
import os
import sys

from . import create_app


def _summary_markdown(res: dict) -> str:
    """Resumen visual para la página de la ejecución en GitHub Actions."""
    from . import db, tracker

    s = db.get_settings()
    icon = {"ok": "✅", "partial": "⚠️", "error": "❌"}.get(res.get("status"), "ℹ️")
    lines = [f"## {icon} Escaneo de vuelos", "",
             f"**Proveedor:** {s.get('provider')} · **Orígenes:** {', '.join(s.get('origins') or [])} · "
             f"**Rutas:** {res.get('routes', 0)} · **Días con precio:** {res.get('quotes', 0)} · "
             f"**Alertas nuevas:** {res.get('alerts', 0)}", ""]
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
    alerts = db.rows("SELECT message FROM alerts ORDER BY id DESC LIMIT ?", (min(int(res.get("alerts", 0)), 15),)) \
        if res.get("alerts") else []
    if alerts:
        lines += ["### 🔔 Alertas de este escaneo", ""] + [f"- {a['message']}" for a in alerts] + [""]
    if res.get("errors"):
        lines += ["<details><summary>Errores</summary>", ""] + [f"- {e}" for e in res["errors"]] + ["", "</details>"]
    return "\n".join(lines)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "scan":
        from . import db, tracker
        create_app(start_scheduler=False)
        db.apply_env_config()
        res = tracker.run_scan()
        print(json.dumps(res, ensure_ascii=False, indent=2))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(_summary_markdown(res) + "\n")
        sys.exit(1 if res.get("status") == "error" else 0)
    app = create_app()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    try:
        from waitress import serve
        print(f"Flight Tracker en http://localhost:{port}")
        serve(app, host=host, port=port, threads=8)
    except ImportError:
        app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    main()
