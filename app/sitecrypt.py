"""Web privada con contraseña (cifrado en el navegador).

GitHub Pages gratis solo sirve webs públicas. Para que la tuya sea privada, todos los datos
publicados (precios, destinos, alertas...) se cifran con AES-256-GCM usando una clave derivada
de tu contraseña (PBKDF2-SHA256). La web pide la contraseña una vez por dispositivo, la recuerda
y descifra los datos en tu navegador. Sin la contraseña, los ficheros son ilegibles.

El mismo cifrado sirve para:
  * el token de GitHub del modo administrador (así no hay que configurarlo en cada móvil)
  * tu configuración de email hecha desde la web (variable EMAIL_CONFIG_ENC), que el escaneo
    de GitHub Actions descifra con el secret SITE_PASSWORD.
El navegador usa exactamente los mismos parámetros (ver static-mode.js).
"""
import base64
import hashlib
import json
import os

ITERATIONS = 250_000


def salt_for(repo: str) -> bytes:
    return hashlib.sha256(("flight-tracker:" + (repo or "").lower()).encode()).digest()[:16]


def derive_key(password: str, repo: str) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_for(repo), ITERATIONS, 32)


def encrypt(key: bytes, data: bytes) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    return base64.b64encode(iv + AESGCM(key).encrypt(iv, data, None)).decode()


def decrypt(key: bytes, blob: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = base64.b64decode(blob)
    return AESGCM(key).decrypt(raw[:12], raw[12:], None)


def encrypt_json(key: bytes, obj) -> str:
    return encrypt(key, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def decrypt_json(key: bytes, blob: str):
    return json.loads(decrypt(key, blob).decode("utf-8"))


def lock_site(data_dir: str, password: str, repo: str, admin: dict = None) -> int:
    """Cifra en su sitio todos los .json de data/ y escribe lock.json (y admin.json)."""
    key = derive_key(password, repo)
    n = 0
    for root, _dirs, files in os.walk(data_dir):
        for f in files:
            if not f.endswith(".json"):
                continue
            p = os.path.join(root, f)
            with open(p, "rb") as fh:
                raw = fh.read()
            with open(p, "w", encoding="utf-8") as fh:
                json.dump({"enc": encrypt(key, raw)}, fh)
            n += 1
    if admin and admin.get("token"):
        with open(os.path.join(data_dir, "admin.json"), "w", encoding="utf-8") as fh:
            json.dump({"enc": encrypt_json(key, admin)}, fh)
    with open(os.path.join(data_dir, "lock.json"), "w", encoding="utf-8") as fh:
        json.dump({"v": 1, "iter": ITERATIONS, "salt": base64.b64encode(salt_for(repo)).decode(),
                   "repo": repo, "check": encrypt(key, b"flight-tracker-ok")}, fh)
    return n


def email_from_env():
    """Lee la configuración de email guardada desde la web (EMAIL_CONFIG_ENC)."""
    blob, pw = os.environ.get("EMAIL_CONFIG_ENC"), os.environ.get("SITE_PASSWORD")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not blob or not pw:
        return None
    try:
        return decrypt_json(derive_key(pw, repo), blob)
    except Exception:  # noqa: BLE001 - contraseña cambiada o dato corrupto
        return None
