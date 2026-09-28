"""Notificaciones Web Push propias (sin ntfy, Telegram ni ninguna app extra).

El navegador del móvil/PC se suscribe (Push API) y nosotros le enviamos mensajes
cifrados según los estándares:
  * RFC 8291 — cifrado del mensaje (aes128gcm)
  * RFC 8292 — VAPID (identifica a quien envía; clave pública en la web)
Solo usa la librería `cryptography`.
"""
import base64
import json
import os
import struct
import time
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def ub64(s: str) -> bytes:
    s = s.strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _pub_raw(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def generate_vapid():
    """Devuelve (privada, pública) en base64url: 32 bytes y 65 bytes (punto sin comprimir)."""
    k = ec.generate_private_key(ec.SECP256R1())
    return b64u(k.private_numbers().private_value.to_bytes(32, "big")), b64u(_pub_raw(k))


def _priv_from(b64: str):
    return ec.derive_private_key(int.from_bytes(ub64(b64), "big"), ec.SECP256R1())


def _hkdf(salt, ikm, info, length):
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(payload: bytes, p256dh: str, auth: str, *, _as_private=None, _salt=None) -> bytes:
    """RFC 8291 aes128gcm. `_as_private` y `_salt` solo para tests con vectores conocidos."""
    ua_pub = ub64(p256dh)
    auth_secret = ub64(auth)
    as_key = _as_private or ec.generate_private_key(ec.SECP256R1())
    as_pub = _pub_raw(as_key)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    ecdh = as_key.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, ecdh, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    salt = _salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!I", 4096) + bytes([len(as_pub)]) + as_pub + body


def vapid_auth(endpoint: str, private_b64: str, public_b64: str, subject: str) -> str:
    u = urlparse(endpoint)
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600,
                              "sub": subject}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    der = _priv_from(private_b64).sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"vapid t={header}.{claims}.{b64u(sig)}, k={public_b64}"


def send(subscription: dict, message: dict, private_b64: str, public_b64: str,
         subject: str = "mailto:flight-tracker@example.com", ttl: int = 86400, urgency: str = "normal",
         session=None) -> int:
    """Envía un mensaje a una suscripción. Devuelve el código HTTP (201 = entregado;
    404/410 = la suscripción ya no existe y conviene borrarla)."""
    keys = subscription.get("keys") or {}
    body = encrypt(json.dumps(message, ensure_ascii=False).encode("utf-8"), keys["p256dh"], keys["auth"])
    headers = {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": urgency,
        "Authorization": vapid_auth(subscription["endpoint"], private_b64, public_b64, subject),
    }
    r = (session or requests).post(subscription["endpoint"], data=body, headers=headers, timeout=20)
    return r.status_code


# ---------------------------------------------------------------------------
def parse_subscriptions(raw) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return []
    return [s for s in data if isinstance(s, dict) and s.get("endpoint") and (s.get("keys") or {}).get("p256dh")]


def decode_device_code(code: str) -> dict:
    """El código que muestra el móvil es la suscripción en JSON codificada en base64url."""
    code = (code or "").strip()
    try:
        data = json.loads(code) if code.startswith("{") else json.loads(ub64(code).decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise ValueError("Código de dispositivo no válido") from e
    if not data.get("endpoint") or not (data.get("keys") or {}).get("auth"):
        raise ValueError("Código de dispositivo incompleto")
    return {"endpoint": data["endpoint"], "keys": {"p256dh": data["keys"]["p256dh"], "auth": data["keys"]["auth"]},
            "name": (data.get("name") or "Dispositivo")[:60], "added": data.get("added") or time.strftime("%Y-%m-%d")}
