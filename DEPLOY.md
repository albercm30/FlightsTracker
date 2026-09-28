# 🌍 Usar Flight Tracker desde cualquier sitio (online)

La app tiene que estar **encendida las 24 horas** para escanear precios y enviarte avisos. Tienes tres opciones.

| Opción | Coste | Dificultad | ¿Hace falta tu PC encendido? |
|---|---|---|---|
| **A. Railway** (recomendada) | ~5 $/mes (plan Hobby) | ⭐ Fácil, desde GitHub | No |
| **B. Tu PC + túnel** (Cloudflare o Tailscale) | Gratis | ⭐ Fácil | Sí |
| **C. Servidor propio / VPS / Raspberry Pi** con Docker | 0–5 €/mes | ⭐⭐ Media | No |

> 🔒 **Antes de publicarla, pon siempre una contraseña** con la variable `APP_PASSWORD`. Sin ella, cualquiera con el enlace vería tus ajustes y tus claves. Con contraseña, la app muestra una pantalla de acceso y recuerda la sesión 60 días.

---

## A. Railway (recomendada)

Railway construye la imagen de Docker del repositorio y la deja encendida. Según su documentación, el plan Hobby cuesta 5 $/mes, incluye 5 $ de uso y permite volúmenes persistentes. Esta app consume muy poco.

1. Sube el proyecto a tu repositorio de GitHub (ya lo tienes).
2. Entra en [railway.com](https://railway.com) con tu cuenta de GitHub.
3. **New Project → Deploy from GitHub repo →** elige `FlightsTracker`.
4. En el servicio, abre **Variables** y añade:
   - `APP_PASSWORD` = una contraseña larga
   - `TRUST_PROXY` = `1`
   - `COOKIE_SECURE` = `1`
   - `TZ` = `Atlantic/Canary` (o `Europe/Madrid`)
   - opcionales: `TRAVELPAYOUTS_TOKEN`, `SERPAPI_KEY`, `NTFY_TOPIC`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HOLIDAY_REGION` (`canarias`, `madrid`…)
5. Añade un volumen para que tus datos sobrevivan a cada actualización: **clic derecho en el servicio → Attach Volume → Mount path: `/data`**.
6. **Settings → Networking → Generate Domain**. Te dará una dirección tipo `https://flightstracker-production.up.railway.app`.
7. Ábrela en el móvil, entra con tu contraseña y pulsa **«Añadir a pantalla de inicio»**: se instala como una app.

Cada vez que hagas `git push`, Railway vuelve a desplegar solo.

## B. Gratis: tu PC encendido + un túnel

La app sigue funcionando en tu ordenador y el túnel le da una dirección pública con HTTPS.

**Paso previo:** crea un archivo `.env` (copia `.env.example`) con `APP_PASSWORD=una-contraseña` y arranca la app con `iniciar.bat` o `python -m app`.

### B1. Cloudflare Tunnel (sin cuenta, la dirección cambia en cada arranque)

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8000
```

Aparecerá una dirección `https://algo-aleatorio.trycloudflare.com`. Para tener una dirección fija necesitas un dominio propio en Cloudflare y un *named tunnel* (lo explica su documentación).

### B2. Tailscale Funnel (dirección fija y gratis)

1. Instala [Tailscale](https://tailscale.com/download) e inicia sesión.
2. Activa Funnel en tu cuenta (el propio comando te da el enlace para hacerlo la primera vez).
3. Ejecuta:
   ```powershell
   tailscale funnel --bg 8000
   ```
4. Tu app quedará en `https://tu-pc.tu-red.ts.net`.

Si solo quieres usarla desde **tus** dispositivos, no hace falta Funnel: instala Tailscale en el móvil y entra a `http://nombre-del-pc:8000`.

> ⚠️ Si el PC se apaga o se suspende, no hay escaneos ni avisos. Desactiva la suspensión, o usa la opción A o C.

## C. Servidor propio, VPS o Raspberry Pi (Docker)

Sirve cualquier Linux con Docker: un VPS barato, una Raspberry Pi o una máquina gratuita como Oracle Cloud Free Tier.

```bash
git clone https://github.com/albercm30/FlightsTracker.git && cd FlightsTracker
cp .env.example .env        # pon APP_PASSWORD, TRUST_PROXY=1, COOKIE_SECURE=1 y tus tokens
# Con tu dominio apuntando a la IP del servidor, HTTPS automático con Caddy:
DOMAIN=vuelos.midominio.com docker compose --profile https up -d --build
```

Sin dominio, `docker compose up -d --build` la deja en `http://IP:8000`. En ese caso, mejor ponle delante un túnel (opción B).

**Actualizar:** `git pull && docker compose up -d --build`. Tus datos están en `./data/flights.db`: cópialo de vez en cuando como copia de seguridad.

## Fly.io

Incluye un `fly.toml` listo, con volumen y la máquina siempre encendida. Fly cobra por uso: revisa sus precios actuales. Los comandos están comentados al principio del archivo.

---

### Preguntas frecuentes

- **¿Se pierden mis datos al actualizar?** No, si usas un volumen (`/data`). Sin volumen, cada despliegue empieza de cero.
- **¿Puedo usarla desde el móvil como una app?** Sí. Es una PWA: ábrela en el navegador y elige «Añadir a pantalla de inicio».
- **¿Y las notificaciones en el móvil?** Usa ntfy o Telegram (ver README). Funcionan aunque la app no esté abierta.
