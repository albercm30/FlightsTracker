# 🌍 Usar Flight Tracker desde cualquier sitio (online)

La app tiene que estar **encendida las 24 horas** para escanear precios y enviarte avisos. Tienes tres opciones.

| Opción | Coste | Web online 24/7 | Avisos 24/7 | Dificultad |
|---|---|---|---|---|
| **0. GitHub** (avisos + web pública de solo lectura) | **Gratis** | ✅ web pública (sin ajustes) | ✅ | ⭐ Muy fácil, desde la interfaz |
| **1. Oracle Cloud Always Free** + Tailscale | **Gratis** | ✅ | ✅ | ⭐⭐ Media |
| **2. Tu PC + túnel** (Tailscale o Cloudflare) | **Gratis** | Solo con el PC encendido | Solo con el PC encendido | ⭐ Fácil |
| **3. Railway** | ~5 $/mes | ✅ | ✅ | ⭐ Muy fácil |
| 4. VPS propio con Docker | 4–6 €/mes | ✅ | ✅ | ⭐⭐ Media |

**Qué te recomiendo:**
- **Gratis y sin complicarte:** la opción 0 (avisos siempre, aunque apagues el PC) junto con la opción 2 para ver la web cuando quieras.
- **Gratis y todo online:** la opción 1.
- **Pagando 5 $ y olvidarte:** la opción 3.

> ❌ **Render (plan gratis) no sirve.** Duerme la app tras 15 minutos sin visitas, así que no hay escaneos, y no permite disco persistente, así que perderías tus datos.

> 🔒 **Antes de publicarla, pon siempre una contraseña** con la variable `APP_PASSWORD`. Sin ella, cualquiera con el enlace vería tus ajustes y tus claves. Con contraseña, la app muestra una pantalla de acceso y recuerda la sesión 60 días.

---

## 0. GitHub: avisos 24/7 + web pública gratis (recomendado)

GitHub revisa los precios cada 6 horas con tu PC apagado, te avisa al móvil y publica una **web de solo lectura** en `https://TU_USUARIO.github.io/TU_REPOSITORIO/`, que cualquiera puede abrir en el móvil. La web incluye:

- mejores ofertas, calendario y «Mejor día»;
- explorar y puentes;
- equipaje y descuento de residente (lo elige cada visitante);
- enlaces para reservar.

Es gratis en repositorios **públicos**. Tus tokens se guardan como *secrets* cifrados y **nunca** se publican.

**Todo desde la interfaz:** abre tu app local (`iniciar.bat`), ve a **Ajustes → ☁️ Avisos 24/7 y web pública** y sigue los pasos. Solo tendrás que:

1. Crear un token de GitHub (el panel explica cómo, en 2 minutos) y pegarlo.
2. Pulsar **Hacer público** si tu repositorio es privado.
3. Pulsar **Sincronizar con GitHub**. La app sube tus orígenes, destinos, preferencias y claves, activa el horario y crea la web pública.
4. Pulsar **Probar aviso (demo)** para comprobar que te llega la notificación, y **Escanear ahora en la nube** para el primer escaneo real.

Cada vez que guardes ajustes, la app vuelve a sincronizar sola. Si cambias destinos, pulsa **Sincronizar**.

<details><summary>Alternativa por terminal o manual</summary>

- Script: `powershell -ExecutionPolicy Bypass -File scripts\configurar-github-actions.ps1`
- Manual: en **Settings → Secrets and variables → Actions** crea:
  - los secrets `TRAVELPAYOUTS_TOKEN` y `NTFY_TOPIC`;
  - las variables `ORIGINS`, `DESTINATIONS`, `ENABLE_SCHEDULED_SCAN=true` y `PUBLISH_SITE=true`.
- Después, en **Settings → Pages**, elige *Source: GitHub Actions*.
</details>

## 1. Oracle Cloud Always Free: todo online y gratis

Oracle regala una máquina virtual ARM para siempre. Desde junio de 2026 es de **2 núcleos y 12 GB**, de sobra para esta app. Pide tarjeta para verificar tu identidad (no cobra si te quedas en el plan gratis) y a veces no hay capacidad en la región: si falla, prueba otra región o más tarde.

1. Crea la cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) y lanza una instancia **Ubuntu** de tipo **VM.Standard.A1.Flex**.
2. Entra por SSH e instala Docker y la app:
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/albercm30/FlightsTracker.git && cd FlightsTracker
   cp .env.example .env && nano .env      # APP_PASSWORD, TRAVELPAYOUTS_TOKEN, NTFY_TOPIC...
   sudo docker compose up -d --build
   ```
3. Publica la app con HTTPS y una dirección fija sin comprar dominio, usando **Tailscale Funnel**:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   sudo tailscale funnel --bg 8000
   ```
   Quedará en `https://tu-vm.tu-red.ts.net`.

## 2. Gratis: tu PC encendido + un túnel

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

> ⚠️ Si el PC se apaga o se suspende, no hay escaneos ni avisos. Desactiva la suspensión, o usa la opción 0 para los avisos, o la 1 o la 3 para tenerlo todo online.

## 3. Railway (5 $/mes, lo más cómodo)

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

## 4. Servidor propio, VPS o Raspberry Pi (Docker)

Sirve cualquier Linux con Docker: un VPS barato, una Raspberry Pi o una máquina gratuita como Oracle Cloud Free Tier.

```bash
git clone https://github.com/albercm30/FlightsTracker.git && cd FlightsTracker
cp .env.example .env        # pon APP_PASSWORD, TRUST_PROXY=1, COOKIE_SECURE=1 y tus tokens
# Con tu dominio apuntando a la IP del servidor, HTTPS automático con Caddy:
DOMAIN=vuelos.midominio.com docker compose --profile https up -d --build
```

Sin dominio, `docker compose up -d --build` la deja en `http://IP:8000`. En ese caso, mejor ponle delante un túnel (opción 2).

**Actualizar:** `git pull && docker compose up -d --build`. Tus datos están en `./data/flights.db`: cópialo de vez en cuando como copia de seguridad.

## Fly.io

Incluye un `fly.toml` listo, con volumen y la máquina siempre encendida. Fly cobra por uso: revisa sus precios actuales. Los comandos están comentados al principio del archivo.

---

### Preguntas frecuentes

- **¿Se pierden mis datos al actualizar?** No, si usas un volumen (`/data`). Sin volumen, cada despliegue empieza de cero.
- **¿Puedo usarla desde el móvil como una app?** Sí. Es una PWA: ábrela en el navegador y elige «Añadir a pantalla de inicio».
- **¿Y las notificaciones en el móvil?** Usa ntfy o Telegram (ver README). Funcionan aunque la app no esté abierta.
