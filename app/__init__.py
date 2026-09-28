"""Flight Tracker: vigila precios de vuelos y avisa de ofertas."""
import logging
import os
import secrets
import statistics
import threading
from datetime import date

from flask import Flask, Response, jsonify, request, send_from_directory

from . import catalog, db, notifier, scheduler, tracker
from .providers import booking_links, get_provider, serpapi

__version__ = "1.0.0"


def load_dotenv(path: str = ".env"):
    """Carga un archivo .env sencillo (CLAVE=valor) sin dependencias externas."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def create_app(db_path: str = None, start_scheduler: bool = None) -> Flask:
    load_dotenv()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db_path = db_path or os.environ.get("DB_PATH", "data/flights.db")
    db.init(db_path)
    static = os.path.join(os.path.dirname(__file__), "static")
    app = Flask(__name__, static_folder=static, static_url_path="/static")
    app.json.ensure_ascii = False

    password = os.environ.get("APP_PASSWORD", "")

    @app.before_request
    def _auth():
        if not password or request.path == "/healthz":
            return None
        auth = request.authorization
        if auth and secrets.compare_digest(auth.password or "", password):
            return None
        return Response("Acceso restringido", 401, {"WWW-Authenticate": 'Basic realm="Flight Tracker"'})

    # ---------------- páginas ----------------
    @app.get("/")
    def index():
        return send_from_directory(static, "index.html")

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "version": __version__}

    # ---------------- estado / escaneo ----------------
    @app.get("/api/status")
    def status():
        s = db.get_settings()
        last = db.one("SELECT * FROM scans ORDER BY id DESC LIMIT 1")
        unread = db.one("SELECT COUNT(*) AS n FROM alerts WHERE read=0")["n"]
        n_quotes = db.one("SELECT COUNT(*) AS n FROM quotes")["n"]
        n_dest = db.one("SELECT COUNT(*) AS n FROM destinations WHERE enabled=1")["n"]
        return jsonify({
            "version": __version__,
            "provider": get_provider(s).name,
            "origins": s["origins"],
            "channels": notifier.enabled_channels(s),
            "live_check": bool(s.get("serpapi_key")),
            "last_scan": last,
            "next_run": scheduler.state.get("next_run"),
            "progress": dict(tracker.progress),
            "unread_alerts": unread,
            "quotes": n_quotes,
            "destinations": n_dest,
            "today": date.today().isoformat(),
        })

    @app.post("/api/scan")
    def scan():
        if tracker.progress["running"]:
            return jsonify({"status": "busy"}), 409
        scheduler.run_now_async()
        return jsonify({"status": "started"}), 202

    # ---------------- ajustes ----------------
    @app.get("/api/settings")
    def get_settings():
        return jsonify(db.public_settings())

    @app.put("/api/settings")
    def put_settings():
        db.update_settings(request.get_json(force=True) or {})
        scheduler.poke()
        return jsonify(db.public_settings())

    @app.post("/api/settings/test-notification")
    def test_notification():
        return jsonify(notifier.send_test())

    # ---------------- catálogo ----------------
    @app.get("/api/catalog")
    def cat():
        return jsonify(catalog.search(request.args.get("q", ""), int(request.args.get("limit", 30))))

    @app.get("/api/catalog/countries")
    def cat_countries():
        return jsonify(catalog.countries())

    @app.get("/api/catalog/spain-origins")
    def spain_origins():
        return jsonify([catalog.info(c) for c in catalog.SPAIN_ORIGINS])

    # ---------------- destinos ----------------
    @app.get("/api/destinations")
    def list_destinations():
        dests = db.rows("SELECT * FROM destinations ORDER BY country, name")
        best = {r["destination"]: r for r in db.rows(
            "SELECT destination, MIN(price) AS price, COUNT(*) AS days FROM quotes GROUP BY destination")}
        for d in dests:
            b = best.get(d["code"]) or {}
            d["best_price"] = b.get("price")
            d["days"] = b.get("days", 0)
        return jsonify(dests)

    def _add_destination(code, name=None, country=None, max_price=None):
        code = (code or "").strip().upper()
        if len(code) != 3 or not code.isalpha():
            return None, "Código IATA no válido (3 letras)"
        info = catalog.info(code)
        with db.connect() as c:
            c.execute("INSERT OR IGNORE INTO destinations(code, name, country, max_price, enabled, created_at) "
                      "VALUES (?,?,?,?,1,?)",
                      (code, name or info["name"], country or info["country"], max_price, db.now_iso()))
        return db.one("SELECT * FROM destinations WHERE code=?", (code,)), None

    @app.post("/api/destinations")
    def add_destination():
        data = request.get_json(force=True) or {}
        mp = data.get("max_price")
        d, err = _add_destination(data.get("code"), data.get("name"), data.get("country"),
                                  float(mp) if mp not in (None, "") else None)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(d), 201

    @app.post("/api/destinations/country")
    def add_country():
        cc = ((request.get_json(force=True) or {}).get("country_code") or "").upper()
        added = [_add_destination(c["code"])[0] for c in catalog.cities_in_country(cc)]
        return jsonify(added), 201

    @app.patch("/api/destinations/<int:did>")
    def patch_destination(did):
        data = request.get_json(force=True) or {}
        fields, vals = [], []
        if "max_price" in data:
            fields.append("max_price=?")
            vals.append(float(data["max_price"]) if data["max_price"] not in (None, "") else None)
        if "enabled" in data:
            fields.append("enabled=?")
            vals.append(1 if data["enabled"] else 0)
        if "name" in data and data["name"]:
            fields.append("name=?")
            vals.append(str(data["name"]))
        if fields:
            db.execute(f"UPDATE destinations SET {', '.join(fields)} WHERE id=?", (*vals, did))
        return jsonify(db.one("SELECT * FROM destinations WHERE id=?", (did,)))

    @app.delete("/api/destinations/<int:did>")
    def delete_destination(did):
        d = db.one("SELECT * FROM destinations WHERE id=?", (did,))
        if d:
            with db.connect() as c:
                c.execute("DELETE FROM destinations WHERE id=?", (did,))
                c.execute("DELETE FROM quotes WHERE destination=?", (d["code"],))
        return "", 204

    # ---------------- precios ----------------
    @app.get("/api/deals")
    def deals():
        return jsonify(tracker.current_deals(int(request.args.get("limit", 30))))

    @app.get("/api/calendar")
    def calendar():
        origin = request.args.get("origin", "").upper()
        dest = request.args.get("destination", "").upper()
        qs = db.rows("SELECT * FROM quotes WHERE origin=? AND destination=? ORDER BY depart_date", (origin, dest))
        prices = [q["price"] for q in qs]
        for q in qs:
            q["links"] = booking_links(origin, dest, q["depart_date"], q.get("return_date"))
        return jsonify({
            "origin": catalog.info(origin), "destination": catalog.info(dest), "quotes": qs,
            "median": statistics.median(prices) if prices else None,
            "min": min(prices) if prices else None, "max": max(prices) if prices else None,
        })

    @app.get("/api/history")
    def history():
        origin = request.args.get("origin", "").upper()
        dest = request.args.get("destination", "").upper()
        return jsonify(db.rows("SELECT scanned_at, min_price, median_price, count FROM route_stats "
                               "WHERE origin=? AND destination=? ORDER BY scanned_at", (origin, dest)))

    @app.get("/api/quote-history")
    def quote_history():
        o = request.args.get("origin", "").upper()
        d = request.args.get("destination", "").upper()
        day = request.args.get("date", "")
        return jsonify(db.rows("SELECT price, prev_price, seen_at FROM quote_history WHERE origin=? AND destination=? "
                               "AND depart_date=? ORDER BY seen_at", (o, d, day)))

    @app.get("/api/changes")
    def changes():
        return jsonify(tracker.recent_changes(int(request.args.get("limit", 50)),
                                              float(request.args.get("min_pct", 5)),
                                              request.args.get("all", "") not in ("1", "true")))

    # ---------------- buscador "Mejor día" ----------------
    def _resolve_origins(spec):
        s = db.get_settings()
        if spec in (None, "", "mine"):
            return s["origins"]
        if spec == "ES":
            return catalog.SPAIN_ORIGINS
        return [spec] if isinstance(spec, str) else list(spec)

    @app.post("/api/search")
    def search_start():
        data = request.get_json(force=True) or {}
        origins = _resolve_origins(data.get("origins"))
        dests = data.get("destinations") or []
        if isinstance(dests, str):
            dests = [dests]
        if data.get("country"):
            dests += [c["code"] for c in catalog.cities_in_country(data["country"])]
        dests = list(dict.fromkeys(d.upper() for d in dests if d))
        if not origins or not dests:
            return jsonify({"error": "Indica al menos un origen y un destino"}), 400
        job_id = secrets.token_hex(6)
        job = {"id": job_id, "status": "running", "done": 0, "total": len(origins) * len(dests), "current": "",
               "result": None, "origins": origins, "destinations": dests}
        tracker.search_jobs[job_id] = job

        def _run():
            try:
                job["result"] = tracker.best_day_search(origins, dests, data.get("date_from") or None,
                                                        data.get("date_to") or None, job=job)
                job["status"] = "done"
            except Exception as e:  # noqa: BLE001
                logging.getLogger(__name__).exception("Búsqueda fallida")
                job.update(status="error", error=str(e))

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({k: v for k, v in job.items() if k != "result"}), 202

    @app.get("/api/search/<job_id>")
    def search_status(job_id):
        job = tracker.search_jobs.get(job_id)
        if not job:
            return jsonify({"error": "No encontrado"}), 404
        return jsonify(job)

    # ---------------- comprobación en vivo (Google Flights vía SerpApi) ----------------
    @app.post("/api/live-check")
    def live_check():
        data = request.get_json(force=True) or {}
        s = db.get_settings()
        o, d, day = data.get("origin", "").upper(), data.get("destination", "").upper(), data.get("date", "")
        try:
            res = serpapi.live_check(s.get("serpapi_key"), o, d, day, data.get("return_date") or None,
                                     s.get("currency", "eur"))
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400
        prices = [q["price"] for q in db.rows("SELECT price FROM quotes WHERE origin=? AND destination=?", (o, d))]
        hist = db.rows("SELECT price, seen_at FROM quote_history WHERE origin=? AND destination=? AND depart_date=? "
                       "ORDER BY seen_at", (o, d, day))
        if res.get("lowest_price"):
            res["advice"] = tracker.advice(res["lowest_price"], day, o, d, prices, history=hist, google=res)
        return jsonify(res)

    # ---------------- vuelos vigilados ----------------
    @app.get("/api/watches")
    def list_watches():
        ws = db.rows("SELECT w.*, q.price AS current_price, q.updated_at FROM watches w LEFT JOIN quotes q "
                     "ON q.origin=w.origin AND q.destination=w.destination AND q.depart_date=w.depart_date "
                     "ORDER BY w.depart_date")
        for w in ws:
            w["name"] = catalog.info(w["destination"])["name"]
            w["date_label"] = tracker.fmt_date(w["depart_date"])
            w["links"] = booking_links(w["origin"], w["destination"], w["depart_date"])
        return jsonify(ws)

    @app.post("/api/watches")
    def add_watch():
        data = request.get_json(force=True) or {}
        o, d, day = data.get("origin", "").upper(), data.get("destination", "").upper(), data.get("date", "")
        if not (o and d and day):
            return jsonify({"error": "Faltan datos"}), 400
        q = db.one("SELECT price FROM quotes WHERE origin=? AND destination=? AND depart_date=?", (o, d, day))
        tp = data.get("target_price")
        with db.connect() as c:
            c.execute("INSERT OR IGNORE INTO watches(origin, destination, depart_date, target_price, last_price, "
                      "created_at) VALUES (?,?,?,?,?,?)",
                      (o, d, day, float(tp) if tp not in (None, "") else None, q["price"] if q else None,
                       db.now_iso()))
        return jsonify(db.one("SELECT * FROM watches WHERE origin=? AND destination=? AND depart_date=?",
                              (o, d, day))), 201

    @app.delete("/api/watches/<int:wid>")
    def delete_watch(wid):
        db.execute("DELETE FROM watches WHERE id=?", (wid,))
        return "", 204

    # ---------------- alertas ----------------
    @app.get("/api/alerts")
    def alerts():
        limit = int(request.args.get("limit", 100))
        rows = db.rows("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,))
        for a in rows:
            a["links"] = booking_links(a["origin"], a["destination"], a["depart_date"], a.get("return_date"))
            a["kind_label"] = tracker.KIND_LABELS.get(a["kind"], a["kind"])
        return jsonify(rows)

    @app.post("/api/alerts/read")
    def alerts_read():
        db.execute("UPDATE alerts SET read=1 WHERE read=0")
        return jsonify({"ok": True})

    @app.delete("/api/alerts")
    def alerts_clear():
        db.execute("DELETE FROM alerts")
        return "", 204

    if start_scheduler is None:
        start_scheduler = os.environ.get("DISABLE_SCHEDULER", "") not in ("1", "true")
    if start_scheduler:
        scheduler.start()
    return app
