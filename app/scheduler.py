"""Programador sencillo en segundo plano (sin dependencias)."""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from . import db, tracker

log = logging.getLogger(__name__)

state = {"next_run": None, "thread": None}
_wake = threading.Event()


def _last_finished():
    r = db.one("SELECT finished_at FROM scans WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    return datetime.fromisoformat(r["finished_at"]) if r else None


def compute_next_run():
    hours = max(1, int(db.get_settings().get("scan_interval_hours", 6)))
    last = _last_finished()
    now = datetime.now(timezone.utc)
    nxt = (last + timedelta(hours=hours)) if last else now + timedelta(seconds=20)
    return max(nxt, now + timedelta(seconds=5))


def _loop():
    while True:
        nxt = compute_next_run()
        state["next_run"] = nxt.replace(microsecond=0).isoformat()
        wait = (nxt - datetime.now(timezone.utc)).total_seconds()
        if _wake.wait(timeout=max(1, min(wait, 300))):
            _wake.clear()  # se cambió el intervalo o se lanzó un escaneo manual: recalcular
            continue
        if datetime.now(timezone.utc) >= nxt:
            log.info("Escaneo programado")
            try:
                res = tracker.run_scan()
                log.info("Escaneo terminado: %s", res)
            except Exception:  # noqa: BLE001
                log.exception("Error en escaneo programado")


def start():
    if state["thread"] and state["thread"].is_alive():
        return
    t = threading.Thread(target=_loop, name="scheduler", daemon=True)
    t.start()
    state["thread"] = t


def poke():
    _wake.set()


def run_now_async():
    def _run():
        tracker.run_scan()
        poke()
    threading.Thread(target=_run, name="manual-scan", daemon=True).start()
