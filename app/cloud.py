"""Configurar los escaneos gratis de GitHub Actions desde la propia interfaz.

La app usa la API de GitHub con un token personal del usuario para:
  * comprobar el repositorio y el workflow «Escaneo programado» (scan.yml)
  * copiar tus ajustes y destinos como *variables* de Actions
  * guardar tus claves (Travelpayouts, ntfy, Telegram, email) como *secrets* cifrados
  * activar/desactivar el horario y lanzar escaneos a mano
Los secrets se cifran en tu equipo con la clave pública del repositorio (sealed box de
libsodium, vía PyNaCl), igual que hace GitHub CLI: nadie más puede leerlos.
"""
import base64
import os
import re
from datetime import datetime

import requests

from . import db

API = "https://api.github.com"
WORKFLOW = "scan.yml"


class CloudError(RuntimeError):
    pass


def detect_repo(start: str = None) -> str:
    """owner/repo a partir del remoto 'origin' de .git/config (si la app está en un clon)."""
    d = os.path.abspath(start or os.getcwd())
    for _ in range(5):
        cfg = os.path.join(d, ".git", "config")
        if os.path.exists(cfg):
            txt = open(cfg, encoding="utf-8", errors="ignore").read()
            m = re.search(r'\[remote "origin"\][^\[]*?url\s*=\s*(\S+)', txt)
            if m:
                g = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", m.group(1))
                if g:
                    return f"{g.group(1)}/{g.group(2)}"
            return ""
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return ""


class GitHub:
    def __init__(self, token: str, repo: str, session=None):
        if not token:
            raise CloudError("Falta el token de GitHub")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo or ""):
            raise CloudError("Repositorio no válido: usa el formato usuario/repositorio")
        self.repo = repo
        self.http = session or requests.Session()
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "flight-tracker"}

    def _req(self, method, path, ok=(200, 201, 204), **kw):
        r = self.http.request(method, f"{API}/repos/{self.repo}{path}", headers=self.headers, timeout=30, **kw)
        if r.status_code in ok:
            return r
        msg = ""
        try:
            msg = r.json().get("message", "")
        except ValueError:
            pass
        if r.status_code == 401:
            raise CloudError("Token de GitHub no válido o caducado")
        if r.status_code in (403, 404) and path == "":
            raise CloudError("No encuentro el repositorio o el token no tiene acceso a él")
        if r.status_code == 403:
            raise CloudError(f"El token no tiene permiso para esto ({msg}). Revisa los permisos: Actions, "
                             "Secrets y Variables en «Read and write».")
        raise CloudError(f"GitHub respondió {r.status_code}: {msg}")

    # ---- lectura ----
    def info(self):
        return self._req("GET", "").json()

    def workflow(self):
        r = self._req("GET", f"/actions/workflows/{WORKFLOW}", ok=(200, 404))
        return r.json() if r.status_code == 200 else None

    def runs(self, n=6):
        r = self._req("GET", f"/actions/workflows/{WORKFLOW}/runs", ok=(200, 404), params={"per_page": n})
        return (r.json().get("workflow_runs") or []) if r.status_code == 200 else []

    def variables(self):
        r = self._req("GET", "/actions/variables", params={"per_page": 50})
        return {v["name"]: v["value"] for v in r.json().get("variables", [])}

    def variables_full(self):
        r = self._req("GET", "/actions/variables", params={"per_page": 50})
        return {v["name"]: v for v in r.json().get("variables", [])}

    def secret_names(self):
        r = self._req("GET", "/actions/secrets", params={"per_page": 50})
        return {s["name"] for s in r.json().get("secrets", [])}

    # ---- escritura ----
    def set_variable(self, name, value):
        value = "" if value is None else str(value)
        if not value:
            self._req("DELETE", f"/actions/variables/{name}", ok=(204, 404))
            return
        r = self._req("PATCH", f"/actions/variables/{name}", ok=(204, 404), json={"name": name, "value": value})
        if r.status_code == 404:
            self._req("POST", "/actions/variables", json={"name": name, "value": value})

    def set_secret(self, name, value):
        if not value:
            return False
        key = self._req("GET", "/actions/secrets/public-key").json()
        self._req("PUT", f"/actions/secrets/{name}",
                  json={"encrypted_value": encrypt(key["key"], value), "key_id": key["key_id"]})
        return True

    def delete_secret(self, name):
        self._req("DELETE", f"/actions/secrets/{name}", ok=(204, 404))

    def pages(self):
        r = self._req("GET", "/pages", ok=(200, 404))
        return r.json() if r.status_code == 200 else None

    def enable_pages(self):
        """Activa GitHub Pages con origen «GitHub Actions» (necesita permisos Pages + Administration)."""
        r = self._req("POST", "/pages", ok=(201, 409, 422), json={"build_type": "workflow"})
        if r.status_code in (409, 422):
            self._req("PUT", "/pages", ok=(204, 200), json={"build_type": "workflow"})
        return self.pages()

    def make_public(self):
        self._req("PATCH", "", ok=(200,), json={"private": False})

    def dispatch(self, demo=False, ref=None):
        ref = ref or self.info().get("default_branch", "main")
        self._req("POST", f"/actions/workflows/{WORKFLOW}/dispatches",
                  json={"ref": ref, "inputs": {"demo": "true" if demo else "false"}})


def encrypt(public_key_b64: str, value: str) -> str:
    try:
        from nacl import encoding, public
    except ImportError as e:  # pragma: no cover - depende del equipo
        raise CloudError("Falta la librería PyNaCl. Ejecuta: pip install -r requirements.txt") from e
    pk = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    return base64.b64encode(public.SealedBox(pk).encrypt(value.encode("utf-8"))).decode("utf-8")


# ---------------------------------------------------------------------------
def _client(session=None):
    s = db.get_settings()
    repo = (s.get("github_repo") or "").strip() or detect_repo()
    return GitHub(s.get("github_token") or "", repo, session=session), s


def desired_variables(s: dict) -> dict:
    dests = [d["code"] for d in db.rows("SELECT code FROM destinations WHERE enabled=1 ORDER BY code")]
    return {
        "ORIGINS": ",".join(s.get("origins") or []),
        "DESTINATIONS": ",".join(dests),
        "TRIP_TYPE": s.get("trip_type"),
        "MIN_NIGHTS": s.get("min_nights"),
        "MAX_NIGHTS": s.get("max_nights"),
        "PASSENGERS": s.get("passengers"),
        "BAGGAGE": s.get("baggage"),
        "RESIDENT_DISCOUNT": s.get("resident_discount"),
        "QUIET_HOURS": s.get("quiet_hours"),
        "TZ": s.get("timezone"),
        "MONTHS_AHEAD": s.get("months_ahead"),
        "DIRECT_ONLY": "true" if s.get("direct_only") else "",
        "DEAL_PCT": s.get("deal_pct"),
        "ALERT_LEVEL": s.get("alert_level"),
        "ALERT_DROPS": "true" if s.get("alert_drops") else "false",
        "MAX_STOPS": s.get("max_stops"),
        "MAX_DURATION_H": s.get("max_duration_h") or "",
        "DEP_WINDOWS": s.get("dep_windows"),
        "EXCLUDE_AIRLINES": ",".join(s.get("exclude_airlines") or []),
        "MIN_DAYS_AHEAD": s.get("min_days_ahead"),
        "PUBLISH_SITE": "true" if s.get("publish_site") else "false",
        "VAPID_PUBLIC_KEY": s.get("vapid_public"),
        "SITE_URL": s.get("site_url"),
        "SITE_TITLE": s.get("site_title"),
    }


SECRET_MAP = {
    "TRAVELPAYOUTS_TOKEN": "travelpayouts_token",
    "TRAVELPAYOUTS_MARKER": "travelpayouts_marker",
    "NTFY_TOPIC": "ntfy_topic",
    "TELEGRAM_BOT_TOKEN": "telegram_bot_token",
    "TELEGRAM_CHAT_ID": "telegram_chat_id",
    "SMTP_HOST": "smtp_host",
    "SMTP_USER": "smtp_user",
    "SMTP_PASSWORD": "smtp_password",
    "EMAIL_TO": "email_to",
    "SMTP_FROM": "smtp_from",
    "VAPID_PRIVATE_KEY": "vapid_private",
    "PUSH_SUBSCRIPTIONS": "push_subscriptions",
    "SITE_PASSWORD": "site_password",
}


def status(session=None) -> dict:
    s = db.get_settings()
    repo = (s.get("github_repo") or "").strip() or detect_repo()
    out = {"configured": bool(s.get("github_token") and repo), "repo": repo, "detected_repo": detect_repo(),
           "has_token": bool(s.get("github_token"))}
    if not out["configured"]:
        return out
    try:
        gh, _ = _client(session)
        info = gh.info()
        wf = gh.workflow()
        vars_ = gh.variables()
        secrets = gh.secret_names()
        runs = gh.runs()
        pages = gh.pages()
    except CloudError as e:
        return {**out, "error": str(e)}
    return {
        **out,
        "private": info.get("private"),
        "html_url": info.get("html_url"),
        "workflow": bool(wf),
        "workflow_state": (wf or {}).get("state"),
        "schedule_enabled": vars_.get("ENABLE_SCHEDULED_SCAN") == "true",
        "variables": vars_,
        "secrets": sorted(secrets),
        "has_price_token": "TRAVELPAYOUTS_TOKEN" in secrets,
        "has_notifications": bool({"NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "EMAIL_TO", "PUSH_SUBSCRIPTIONS"} & secrets),
        "in_sync": all(str(vars_.get(k, "")) == str(v or "") for k, v in desired_variables(s).items()),
        "runs": [{"id": r["id"], "status": r["status"], "conclusion": r.get("conclusion"), "event": r["event"],
                  "created_at": r["created_at"], "url": r["html_url"],
                  "demo": "demo" in (r.get("display_title") or "").lower()} for r in runs],
        "actions_url": f"{info.get('html_url')}/actions/workflows/{WORKFLOW}",
        "settings_url": f"{info.get('html_url')}/settings",
        "pages_enabled": bool(pages),
        "pages_url": (pages or {}).get("html_url"),
        "pages_is_actions": (pages or {}).get("build_type") == "workflow",
        "publish_site": s.get("publish_site"),
    }


# Variables que también se pueden cambiar desde la web pública (modo administrador del móvil)
REMOTE_EDITABLE = {
    "ALERT_LEVEL": "alert_level", "ALERT_DROPS": "alert_drops", "MAX_STOPS": "max_stops",
    "MAX_DURATION_H": "max_duration_h", "DEP_WINDOWS": "dep_windows", "EXCLUDE_AIRLINES": "exclude_airlines",
}


def _ts(v):
    try:
        return datetime.fromisoformat((v or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def pull_remote(gh, s) -> list:
    """Trae a la app local lo que cambiaste desde el móvil (destinos y ajustes de avisos) si es
    más reciente que la última sincronización. Devuelve la lista de variables aplicadas."""
    since = _ts(s.get("cloud_synced_at"))
    if not since:
        return []
    try:
        remote = gh.variables_full()
    except CloudError:
        return []
    applied, vals = [], {}
    for name, v in remote.items():
        t = _ts(v.get("updated_at"))
        if not t or t <= since:
            continue
        if name == "DESTINATIONS":
            codes = [c.strip().upper() for c in (v.get("value") or "").split(",") if c.strip()]
            if codes:
                from . import catalog
                with db.connect() as c:
                    for code in codes:
                        info = catalog.info(code)
                        c.execute("INSERT OR IGNORE INTO destinations(code, name, country, enabled, created_at) "
                                  "VALUES (?,?,?,1,?)", (code, info["name"], info["country"], db.now_iso()))
                    c.execute(f"UPDATE destinations SET enabled = CASE WHEN code IN ({','.join('?' * len(codes))}) "
                              "THEN 1 ELSE 0 END", codes)
                applied.append(name)
        elif name in REMOTE_EDITABLE:
            vals[REMOTE_EDITABLE[name]] = v.get("value")
            applied.append(name)
    if vals:
        db.update_settings(vals)
    return applied


def sync(enable_schedule: bool = True, session=None) -> dict:
    gh, s = _client(session)
    pulled = pull_remote(gh, s)
    if pulled:
        s = db.get_settings()
    try:  # recordar la dirección de la web pública para que los avisos la abran al tocarlos
        pages = gh.pages()
        if pages and pages.get("html_url") and pages["html_url"] != s.get("site_url"):
            db.update_settings({"site_url": pages["html_url"]})
            s = db.get_settings()
    except CloudError:
        pass
    if not gh.workflow():
        raise CloudError("El repositorio aún no tiene el workflow «Escaneo programado». Sube el código "
                         "(git push) y vuelve a intentarlo.")
    done_vars = []
    for k, v in desired_variables(s).items():
        gh.set_variable(k, v)
        done_vars.append(k)
    gh.set_variable("ENABLE_SCHEDULED_SCAN", "true" if enable_schedule else "false")
    done_secrets = [name for name, key in SECRET_MAP.items()
                    if s.get(key) not in (None, "", "[]") and gh.set_secret(name, s.get(key))]
    # Web privada: el token para gestionar la web desde el móvil viaja cifrado con tu contraseña
    if s.get("site_password") and s.get("github_token") and gh.set_secret("SITE_ADMIN_TOKEN", s["github_token"]):
        done_secrets.append("SITE_ADMIN_TOKEN")
    elif not s.get("site_password"):
        for name in ("SITE_PASSWORD", "SITE_ADMIN_TOKEN"):
            gh.delete_secret(name)
    pages_msg = None
    if s.get("publish_site"):
        try:
            if gh.info().get("private"):
                pages_msg = "El repositorio es privado: GitHub Pages gratis solo funciona en repositorios públicos."
            else:
                gh.enable_pages()
        except CloudError as e:
            pages_msg = (f"No he podido activar GitHub Pages automáticamente ({e}). Actívalo en Settings → Pages → "
                         "Source: «GitHub Actions».")
    db.update_settings({"cloud_synced_at": db.now_iso()})
    return {"ok": True, "variables": done_vars, "secrets": done_secrets, "schedule": enable_schedule,
            "pages_warning": pages_msg, "pulled": pulled}


def make_public(session=None):
    gh, _ = _client(session)
    gh.make_public()
    try:
        gh.enable_pages()
    except CloudError:
        pass
    return {"ok": True}


def set_schedule(enabled: bool, session=None):
    gh, _ = _client(session)
    gh.set_variable("ENABLE_SCHEDULED_SCAN", "true" if enabled else "false")
    return {"ok": True, "schedule": enabled}


def run_now(demo: bool = False, session=None):
    gh, s = _client(session)
    if not demo and not s.get("travelpayouts_token"):
        raise CloudError("Añade tu token de Travelpayouts en Ajustes y sincroniza antes de un escaneo real.")
    gh.dispatch(demo=demo)
    return {"ok": True, "demo": demo}
