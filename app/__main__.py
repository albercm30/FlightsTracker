"""Arranque: `python -m app` (o `python -m app scan` para un escaneo único, útil con cron)."""
import json
import os
import sys

from . import create_app


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "scan":
        from . import tracker
        create_app(start_scheduler=False)
        print(json.dumps(tracker.run_scan(), ensure_ascii=False, indent=2))
        return
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
