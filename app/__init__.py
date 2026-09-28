"""Flight Tracker: vigila precios de vuelos y avisa de ofertas."""
import csv
import io
import logging
import os
import secrets
import statistics
import threading
import time
from datetime import date, timedelta

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session

from . import airlines, catalog, db, holidays, notifier, scheduler, tracker
from .providers import booking_links, get_provider, serpapi

__version__ = "2.0.0"


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


PUBLIC_PATHS = {"/login", "/api/login", "/healthz", "/manifest.webmanifest", "/sw.js"}
_login_attempts = {}


def create_app(db_path: str = None, start_scheduler: bool = None) -> Flask:
    load_dotenv()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db.init(db_path or os.environ.get("DB_PATH", "data/flights.db"))
    static = os.path.join(os.path.dirname(__file__), "static")
    app = Flask(__name__, static_folder=static, static_url_path="/static")
    app.json.ensure_ascii = False
    app.secret_key = os.environ.get("SECRET_KEY") or db.secret_key()
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      PERMANENT_SESSION_LIFETIME=timedelta(days=60),
                      SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "") in ("1", "true"))
    if os.environ.get("TRUST_PROXY", "") in ("1", "true"):
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    password = os.environ.get("APP_PASSWORD", "")

    def _local(req) -> bool:
        return (req.remote_addr or "") in ("127.0.0.1", "::1", "localhost")

    # ---------------- acceso ----------------
    @app.before_request
    def _auth():
        if not password or request.path in PUBLIC_PATHS or request.path.startswith("/static/"):
            return None
        if session.get("auth"):
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "No has iniciado sesión"}), 401
        return redirect("/login")

    @app.get("/login")
    def login_page():
        if not password or session.get("auth"):
            return redirect("/")
        return send_from_directory(static, "login.html")

    @app.post("/api/login")
    def login():
        ip = request.remote_addr or "?"
        now = time.time()
        tries = [t for t in _login_attempts.get(ip, []) if now - t < 600]
        if len(tries) >= 10:
            return jsonify({"error": "Demasiados intentos. Espera unos minutos."}), 429
        pw = (request.get_json(force=True, silent=True) or {}).get("password", "")
        if password and secrets.compare_digest(pw, password):
            session.permanent = True
            session["auth"] = True
            _login_attempts.pop(ip, None)
            return jsonify({"ok": True})
        _login_attempts[ip] = tries + [now]
        time.sleep(0.5)
        return jsonify({"error": "Contraseña incorrecta"}), 401

    @app.post("/api/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    # ---------------- páginas / PWA ----------------
    @app.get("/")
    def index():
        return send_from_directory(static, "index.html")

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(static, "manifest.webmanifest", mimetype="application/manifest+json")

    @app.get("/sw.js")
    def sw():
        resp = send_from_directory(static, "sw.js", mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "version": __version__}

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------- estado / escaneo ----------------
    @app.get("/api/status")
    def status():
        s = db.get_settings()
        last = db.one("SELECT * FROM scans ORDER BY id DESC LIMIT 1")
        return jsonify({
            "version": __version__,
            "provider": get_provider(s).name,
            "origins": s["origins"],
            "trips": db.trips(s),
            "channels": notifier.enabled_channels(s),
            "live_check": bool(s.get("serpapi_key")),
            "last_scan": last,
            "next_run": scheduler.state.get("next_run"),
            "progress": dict(tracker.progress),
            "unread_alerts": db.one("SELECT COUNT(*) AS n FROM alerts WHERE read=0")["n"],
            "quotes": db.one("SELECT COUNT(*) AS n FROM quotes")["n"],
            "destinations": db.one("SELECT COUNT(*) AS n FROM destinations WHERE enabled=1")["n"],
            "watches": db.one("SELECT COUNT(*) AS n FROM watches")["n"],
            "onboarded": bool(s.get("onboarded")),
            "auth": bool(password),
            "insecure": not password and not _local(request),
            "today": date.today().isoformat(),
        })

    @app.post("/api/scan")
    def scan():
        if tracker.progress["running"]:
            return jsonify({"status": "busy"}), 409
        scheduler.run_now_async()
        return jsonify({"status": "started"}), 202

    # ---------------- ajustes y metadatos ----------------
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

    @app.get("/api/meta")
    def meta():
        return jsonify({
            "baggage_options": airlines.BAG_OPTIONS,
            "holiday_regions": holidays.REGIONS,
            "regions": catalog.REGIONS,
            "themes": {k: {"label": v["label"], "icon": v["icon"], "count": len(v["codes"])}
                       for k, v in catalog.THEMES.items()},
            "spain_origins": [catalog.info(c) for c in catalog.SPAIN_ORIGINS],
            "airlines": {k: v["name"] for k, v in airlines.AIRLINES.items()},
        })

    # ---------------- catálogo ----------------
    @app.get("/api/catalog")
    def cat():
        return jsonify(catalog.search(request.args.get("q", ""), int(request.args.get("limit", 30))))

    @app.get("/api/themes/<key>")
    def theme_codes(key):
        return jsonify({"key": key, "codes": catalog.explore_codes(theme=key)})

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
        best = {}
        for r in db.rows("SELECT destination, trip, MIN(price) AS price, COUNT(*) AS days FROM quotes "
                         "GROUP BY destination, trip"):
            best.setdefault(r["destination"], {})[r["trip"]] = r
        for d in dests:
            b = best.get(d["code"], {})
            d["best_ow"] = (b.get("ow") or {}).get("price")
            d["best_rt"] = (b.get("rt") or {}).get("price")
            d["days"] = sum(x["days"] for x in b.values())
            info = catalog.info(d["code"])
            d["country_code"] = info.get("country_code", "")
            d["region"] = info.get("region", "")
        return jsonify(dests)

    def _add_destination(code, name=None, country=None, max_price=None):
        code = (code or "").strip().upper()
        if len(code) != 3 or not code.isalpha():
            return None, "Código IATA no válido (3 letras)"
        info = catalog.info(code)
        with db.connect() as c:
            c.execute("INSERT OR IGNORE INTO destinations(code, name, country, max_price, enabled, created_at) "
                      "VALUES (?,?,?,?,1,?)", (code, name or info["name"], country or info["country"], max_price,
                                               db.now_iso()))
        return db.one("SELECT * FROM destinations WHERE code=?", (code,)), None

    @app.post("/api/destinations")
    def add_destination():
        data = request.get_json(force=True) or {}
        codes = data.get("codes")
        if codes:
            added = [_add_destination(c)[0] for c in codes]
            return jsonify([a for a in added if a]), 201
        mp = data.get("max_price")
        d, err = _add_destination(data.get("code"), data.get("name"), data.get("country"),
                                  float(mp) if mp not in (None, "") else None)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(d), 201

    @app.post("/api/destinations/country")
    def add_country():
        cc = ((request.get_json(force=True) or {}).get("country_code") or "").upper()
        return jsonify([_add_destination(c["code"])[0] for c in catalog.cities_in_country(cc)]), 201

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
        if data.get("name"):
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
    def _trip():
        t = request.args.get("trip", "")
        return t if t in ("ow", "rt") else db.trips(db.get_settings())[-1]

    @app.get("/api/deals")
    def deals():
        return jsonify(tracker.current_deals(int(request.args.get("limit", 30)), trip=_trip()))

    @app.get("/api/calendar")
    def calendar():
        s = db.get_settings()
        origin = request.args.get("origin", "").upper()
        dest = request.args.get("destination", "").upper()
        trip = _trip()
        qs = db.rows("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=? ORDER BY depart_date",
                     (origin, dest, trip))
        prices = [q["price"] for q in qs]
        pax, bag, cur = int(s.get("passengers", 1)), s.get("baggage", "personal"), s.get("currency", "eur")
        for q in qs:
            tracker.enrich(q, pax, bag, cur)
            q["level"] = tracker.price_level(q["price"], prices)
        return jsonify({"origin": catalog.info(origin), "destination": catalog.info(dest), "trip": trip,
                        "range": [min(prices), statistics.median(prices), max(prices)] if prices else None,
                        "quotes": qs, "median": statistics.median(prices) if prices else None,
                        "min": min(prices) if prices else None, "max": max(prices) if prices else None})

    @app.get("/api/history")
    def history():
        return jsonify(db.rows("SELECT scanned_at, min_price, median_price, count FROM route_stats "
                               "WHERE origin=? AND destination=? AND trip=? ORDER BY scanned_at",
                               (request.args.get("origin", "").upper(), request.args.get("destination", "").upper(),
                                _trip())))

    @app.get("/api/quote-history")
    def quote_history():
        return jsonify(db.rows("SELECT price, prev_price, seen_at FROM quote_history WHERE origin=? AND "
                               "destination=? AND trip=? AND depart_date=? ORDER BY seen_at",
                               (request.args.get("origin", "").upper(), request.args.get("destination", "").upper(),
                                _trip(), request.args.get("date", ""))))

    @app.get("/api/changes")
    def changes():
        return jsonify(tracker.recent_changes(int(request.args.get("limit", 50)), float(request.args.get("min_pct", 5)),
                                              request.args.get("all", "") not in ("1", "true")))

    @app.get("/api/grid")
    def grid():
        try:
            return jsonify(tracker.grid(request.args.get("origin", ""), request.args.get("destination", ""),
                                        request.args.get("depart", ""), request.args.get("return") or None,
                                        int(request.args.get("span", 3))))
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400

    @app.get("/api/baggage")
    def baggage():
        a = request.args
        return jsonify(airlines.baggage(a.get("airline", ""), a.get("long_haul") in ("1", "true"),
                                        a.get("option", "personal"), int(a.get("legs", 1)), int(a.get("pax", 1))))

    @app.get("/api/export/calendar.csv")
    def export_calendar():
        o, d, trip = request.args.get("origin", "").upper(), request.args.get("destination", "").upper(), _trip()
        qs = db.rows("SELECT * FROM quotes WHERE origin=? AND destination=? AND trip=? ORDER BY depart_date", (o, d, trip))
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["salida", "vuelta", "noches", "precio", "precio_anterior", "minimo_visto", "aerolinea", "escalas",
                    "actualizado", "enlace"])
        for q in qs:
            w.writerow([q["depart_date"], q["return_date"] or "", q["nights"] or "", q["price"], q["prev_price"] or "",
                        q["lowest_price"] or "", airlines.name(q["airline"]), q["transfers"], q["updated_at"], q["link"]])
        return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=precios_{o}_{d}_{trip}.csv"})

    # ---------------- búsqueda: Mejor día / Explorar / Festivos ----------------
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
        origins = [o.upper() for o in _resolve_origins(data.get("origins"))]
        dests = data.get("destinations") or []
        if isinstance(dests, str):
            dests = [dests]
        if data.get("country"):
            dests += [c["code"] for c in catalog.cities_in_country(data["country"])]
        if data.get("mode") == "explore" and not dests:
            if data.get("favorites"):
                dests = [d["code"] for d in db.rows("SELECT code FROM destinations WHERE enabled=1")]
            else:
                dests = catalog.explore_codes(data.get("region", ""), data.get("theme", ""), exclude=origins)
        dests = list(dict.fromkeys(d.upper() for d in dests if d))
        if not origins or not dests:
            return jsonify({"error": "Indica al menos un origen y un destino"}), 400
        params = {**data, "origins": origins, "destinations": dests}
        job_id = secrets.token_hex(6)
        job = {"id": job_id, "status": "running", "done": 0, "total": len(origins) * len(dests), "current": "",
               "result": None, "created": time.time()}
        tracker.search_jobs[job_id] = job
        for k in [k for k, v in list(tracker.search_jobs.items()) if time.time() - v.get("created", 0) > 3600]:
            tracker.search_jobs.pop(k, None)

        def _run():
            try:
                job["result"] = tracker.search(params, job=job)
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

    @app.get("/api/holidays")
    def holidays_list():
        s = db.get_settings()
        region = request.args.get("region", s.get("holiday_region", ""))
        return jsonify({"region": region, "items": holidays.upcoming(region)})

    # ---------------- comprobación en vivo (Google Flights vía SerpApi) ----------------
    @app.post("/api/live-check")
    def live_check():
        data = request.get_json(force=True) or {}
        s = db.get_settings()
        o, d, day = data.get("origin", "").upper(), data.get("destination", "").upper(), data.get("date", "")
        ret = data.get("return_date") or None
        bag = data.get("baggage") or s.get("baggage", "personal")
        try:
            res = serpapi.live_check(s.get("serpapi_key"), o, d, day, ret, s.get("currency", "eur"),
                                     adults=int(data.get("pax") or s.get("passengers", 1)),
                                     travel_class=int(data.get("travel_class") or 1),
                                     cabin_bags=1 if bag in ("cabin", "cabin_checked") else 0,
                                     nonstop=bool(data.get("direct_only")))
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400
        trip = "rt" if ret else "ow"
        prices = [q["price"] for q in db.rows("SELECT price FROM quotes WHERE origin=? AND destination=? AND trip=?",
                                              (o, d, trip))]
        hist = db.rows("SELECT price, seen_at FROM quote_history WHERE origin=? AND destination=? AND trip=? AND "
                       "depart_date=? ORDER BY seen_at", (o, d, trip, day))
        if res.get("lowest_price"):
            res["advice"] = tracker.advice(res["lowest_price"], day, o, d, prices, history=hist, google=res)
        return jsonify(res)

    # ---------------- vuelos vigilados ----------------
    @app.get("/api/watches")
    def list_watches():
        ws = db.rows("SELECT * FROM watches ORDER BY depart_date")
        s = db.get_settings()
        for w in ws:
            q = db.one("SELECT price, updated_at, airline FROM quotes WHERE origin=? AND destination=? AND trip=? "
                       "AND depart_date=? AND (? = '' OR return_date = ?)",
                       (w["origin"], w["destination"], w["trip"], w["depart_date"], w["return_date"], w["return_date"]))
            w["current_price"] = q["price"] if q else w["last_price"]
            w["updated_at"] = q["updated_at"] if q else None
            w["name"] = catalog.info(w["destination"])["name"]
            w["date_label"] = tracker.fmt_date(w["depart_date"])
            w["return_label"] = tracker.fmt_date(w["return_date"]) if w["return_date"] else None
            w["links"] = booking_links(w["origin"], w["destination"], w["depart_date"], w["return_date"] or None,
                                       int(s.get("passengers", 1)))
            w["history"] = [h["price"] for h in db.rows(
                "SELECT price FROM quote_history WHERE origin=? AND destination=? AND trip=? AND depart_date=? "
                "ORDER BY seen_at", (w["origin"], w["destination"], w["trip"], w["depart_date"]))][-20:]
        return jsonify(ws)

    @app.post("/api/watches")
    def add_watch():
        data = request.get_json(force=True) or {}
        o, d, day = data.get("origin", "").upper(), data.get("destination", "").upper(), data.get("date", "")
        ret = data.get("return_date") or ""
        trip = "rt" if ret else "ow"
        if not (o and d and day):
            return jsonify({"error": "Faltan datos"}), 400
        price = data.get("price")
        tp = data.get("target_price")
        with db.connect() as c:
            c.execute("INSERT OR IGNORE INTO watches(origin, destination, trip, depart_date, return_date, target_price,"
                      " last_price, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                      (o, d, trip, day, ret, float(tp) if tp not in (None, "") else None,
                       float(price) if price not in (None, "") else None, data.get("note"), db.now_iso()))
            if tp not in (None, ""):
                c.execute("UPDATE watches SET target_price=? WHERE origin=? AND destination=? AND trip=? AND "
                          "depart_date=? AND return_date=?", (float(tp), o, d, trip, day, ret))
        return jsonify(db.one("SELECT * FROM watches WHERE origin=? AND destination=? AND trip=? AND depart_date=? "
                              "AND return_date=?", (o, d, trip, day, ret))), 201

    @app.patch("/api/watches/<int:wid>")
    def patch_watch(wid):
        data = request.get_json(force=True) or {}
        if "target_price" in data:
            tp = data["target_price"]
            db.execute("UPDATE watches SET target_price=? WHERE id=?", (float(tp) if tp not in (None, "") else None, wid))
        return jsonify(db.one("SELECT * FROM watches WHERE id=?", (wid,)))

    @app.delete("/api/watches/<int:wid>")
    def delete_watch(wid):
        db.execute("DELETE FROM watches WHERE id=?", (wid,))
        return "", 204

    # ---------------- alertas ----------------
    @app.get("/api/alerts")
    def alerts():
        rows = db.rows("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (int(request.args.get("limit", 100)),))
        for a in rows:
            a["links"] = booking_links(a["origin"], a["destination"], a["depart_date"], a.get("return_date"))
            a["kind_label"] = tracker.KIND_LABELS.get(a["kind"], a["kind"])
            info = catalog.info(a["destination"])
            a["dest_name"], a["dest_cc"], a["dest_region"] = info["name"], info.get("country_code", ""), info.get("region")
            a["airline_name"] = airlines.name(a.get("airline")) if a.get("airline") else ""
            a["savings"] = (1 - a["price"] / a["ref_price"]) if a.get("ref_price") else 0
            if a.get("return_date"):
                a["nights"] = (date.fromisoformat(a["return_date"]) - date.fromisoformat(a["depart_date"])).days
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
