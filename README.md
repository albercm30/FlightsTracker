# ✈️ Flight Tracker

Tu buscador y vigilante de vuelos **personal**. Le dices desde dónde sales (un aeropuerto, varios o toda España) y a dónde te gustaría ir. La app:

- 🗓️ vigila el **precio más barato de cada día de los próximos 12 meses**, **solo ida y también ida y vuelta**;
- 🔎 te dice **qué día puedes volar más barato** a una ciudad o a un país entero, con matriz de flexibilidad por noches (**Mejor día**);
- 🧭 compara decenas de destinos a la vez en un **mapa**, por zona, temática o presupuesto (**Explorar**);
- 🏖️ calcula tus **puentes y festivos** (nacionales y de tu comunidad) y busca la escapada más barata para cada uno;
- 🧳 estima el **equipaje incluido** (mochila, cabina, facturada) y el **precio total real** por aerolínea y viajeros;
- 🏝️ calcula el precio con **descuento de residente** (Canarias y Baleares: 75 % en vuelos nacionales);
- 🔥 detecta **chollos de verdad** (no simples bajadas) y te **avisa con antelación** con notificaciones de la app o email: **como mucho un aviso por destino**;
- ⏱️ muestra la **duración, las escalas y la hora de salida**, con **filtros tipo Skyscanner** (escalas, duración máxima, franja horaria, aerolíneas, días, precio) y orden **Más barato / Mejor / Más rápido**;
- 🌍 incluye los **195 países** con sus aeropuertos principales (~400 ciudades);
- 🔑 **modo administrador** en la web pública: desde tu móvil añades o quitas destinos y cambias los avisos;
- 👀 te deja **vigilar vuelos concretos** (ida o ida y vuelta) y te avisa si suben o bajan;
- ⚡ comprueba el **precio real en Google Flights** con su rango habitual y su historial (opcional, con SerpApi);
- 📱 funciona en el **móvil como una app** (PWA) y se puede **publicar online** con contraseña.

| Inicio | Mejor día |
|---|---|
| ![Inicio](docs/inicio.jpg) | ![Mejor día](docs/mejor-dia.jpg) |
| **Detalle, equipaje y cuadrícula de fechas** | **Explorar destinos** |
| ![Detalle](docs/detalle.jpg) | ![Explorar](docs/explorar.jpg) |
| **Puentes y festivos** | **Descuento de residente** |
| ![Festivos](docs/festivos.jpg) | ![Residente](docs/residente.jpg) |

---

## 🚀 Arranque rápido

Necesitas **Python 3.10 o superior** ([descargar](https://www.python.org/downloads/); en Windows marca *Add python.exe to PATH*).

- **Windows:** doble clic en **`iniciar.bat`**.
- **macOS / Linux:** `./iniciar.sh`.

Se instala todo solo y se abre **http://localhost:8000**. Un asistente te pregunta:

1. desde dónde vuelas;
2. a dónde quieres ir;
3. cómo viajas (ida y vuelta, noches, viajeros, equipaje);
4. cómo quieres recibir los avisos.

<details><summary>Manualmente</summary>

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python -m app
```
</details>

Sin configurar nada funciona en **modo demo**, con un simulador de precios realista. Para usar **precios reales** solo necesitas un token gratuito de Travelpayouts (ver abajo).

## 🌍 Usarla online y gratis

Mira **[DEPLOY.md](DEPLOY.md)**. Estas son las opciones gratuitas:

- **GitHub** (incluido, se configura desde Ajustes): escaneos y avisos cada 6 horas aunque apagues el PC, y una **web pública** en GitHub Pages para verla en el móvil o compartirla.
- **Oracle Cloud Always Free + Tailscale Funnel**: la web entera online 24/7, gratis.
- **Tu PC + túnel** (Tailscale o Cloudflare).

Si prefieres no complicarte, **Railway** cuesta unos 5 $/mes. Pon siempre `APP_PASSWORD`: la web pedirá contraseña.

---

## 🔑 Fuentes de precios

| Fuente | Para qué | Coste |
|---|---|---|
| **Travelpayouts / Aviasales Data API** | Escaneos automáticos, calendario, Mejor día, Explorar | Gratis (token) |
| **SerpApi – Google Flights** (opcional) | «Comprobar precio real»: precio en vivo, nivel bajo/normal/alto, rango habitual, historial, filtro de maletas y clase | 250 búsquedas/mes gratis |
| **Demo** | Probar todo sin claves | Gratis |

1. **Travelpayouts:** regístrate en [travelpayouts.com](https://www.travelpayouts.com), copia tu *API token* y pégalo en **Ajustes → Fuente de precios**.
2. **SerpApi:** crea una cuenta en [serpapi.com](https://serpapi.com) y pega la clave en Ajustes.

> La API *self-service* de Amadeus cerró su portal el 17 de julio de 2026, por eso no se usa.

## 🧳 Equipaje

Las APIs de precios **no dicen qué equipaje incluye cada billete**. Flight Tracker lo **estima** con una tabla de políticas por aerolínea (Ryanair, Vueling, easyJet, Iberia, Air Europa, Binter, Emirates, Qatar…). Así:

- muestra qué va incluido en cada vuelo (🎒 mochila · 🧳 cabina · 🛄 facturada);
- calcula el **precio total estimado** según tu opción de equipaje, ida o ida y vuelta, y número de viajeros, y ordena los resultados por ese total.

Son rangos orientativos de reservar online con antelación. En junio de 2026 la UE acordó que el precio mostrado incluya por defecto una maleta de cabina de 7 kg, pero **aún no se aplica**. Con SerpApi, «Comprobar precio real» pide a Google Flights precios que ya incluyen tu maleta de cabina.

## 🔔 Avisos (solo lo que merece la pena)

Tú eliges el nivel en **Ajustes → Qué merece un aviso**:

| Nivel | Qué tiene que cumplir la oferta |
|---|---|
| Solo excepcionales | ≥ 40 % bajo el precio habitual de la ruta, top 5 % de fechas y ≥ 25 % más barata que las fechas de alrededor |
| **Muy buenas** (por defecto) | ≥ 30 % bajo lo habitual, top 10 % y ≥ 18 % bajo las fechas cercanas |
| Buenas | ≥ 20 % bajo lo habitual, top 20 % y ≥ 10 % bajo las fechas cercanas |

- «Lo habitual» sale del histórico de la ruta (60 días), no solo de hoy. Comparar con las fechas cercanas evita avisar de algo que solo es «temporada baja».
- También avisa si un destino baja de **tu precio máximo**, de un **mínimo histórico** con ahorro claro y de los **vuelos que vigilas**.
- Las **bajadas simples** están desactivadas por defecto.
- **Anti-spam:**
  - como mucho **un aviso por destino** en cada escaneo (el mejor de todas sus fechas y orígenes);
  - ese destino no vuelve a avisar en 14 días salvo que aparezca algo **un 10 % más barato**.
- En Alertas se agrupan por destino.
- Solo avisa de vuelos con **al menos N días de antelación** (por defecto, 14).
- Tiene **horas de silencio** (por ejemplo, `23-8`): lo que se detecte de noche se envía por la mañana.
- Envía **un único resumen** por escaneo.

**Canales (sin instalar ninguna app):**

- **Notificaciones de la propia app (Web Push):** en Ajustes → Avisos pulsa «Activar en este ordenador». Para el móvil: abre la web pública → Preferencias → «Activar avisos en este móvil» y pega el código en tu app del ordenador. En iPhone, primero «Añadir a pantalla de inicio» (iOS 16.4 o superior).
- **Email:** tu Gmail y una [contraseña de aplicación](https://myaccount.google.com/apppasswords).
- Opcionales: Telegram y ntfy.

## ⏱️ Duración, escalas y filtros

Cada vuelo muestra la **duración** de la ida y de la vuelta, las **escalas** y la **hora de salida**. Al abrirlo verás un itinerario visual.

- **En las búsquedas (Filtros):**
  - escalas (directo, máx. 1, máx. 2);
  - duración máxima por trayecto;
  - hora de salida de la ida y de la vuelta (madrugada, mañana, tarde, noche);
  - días de la semana y precio máximo.
- **En los resultados:**
  - el orden **Más barato / Mejor / Más rápido**. «Mejor» combina precio, horas de viaje y escalas, como Skyscanner;
  - filtros rápidos con el precio «desde» de cada opción: escalas, franja y aerolíneas.
- **En Ajustes → Filtros de los escaneos:** lo que se vigila y avisa automáticamente. Por ejemplo, «nunca más de 1 escala ni más de 16 h» o «sin Ryanair».

## 🔒 Tu web privada, siempre online (recomendado)

En la app del ordenador ve a **Ajustes → ☁️ → paso 9** y pon una contraseña. Solo se hace una vez. A partir de ahí:

- Tu web de GitHub Pages está **online 24/7, gratis y sin tu PC encendido**.
- Te pide la contraseña **una sola vez por dispositivo** (móvil, portátil…) y la recuerda.
- Todos los datos se publican **cifrados** (AES-256, clave derivada de tu contraseña). Sin ella nadie ve tus destinos ni tus precios.
- Desde la web gestionas:
  - tus **destinos**;
  - el **nivel de avisos y los filtros**;
  - tu **email** para recibir los chollos, con un botón para enviar un email de prueba.

  Tu cuenta de GitHub viaja cifrada con tu contraseña, así que no tienes que configurar nada en cada móvil.

Usa una contraseña larga (10+ caracteres): protege también el acceso a tu repositorio.

## 🔑 Gestionar la web pública desde el móvil

1. Abre la web pública con `#avisos` al final una vez (así sabe que ese móvil es tuyo).
2. Ve a **Destinos** y conecta tu GitHub con un *fine-grained token* de tu repositorio (permisos **Actions** y **Variables**: Read and write). El token se guarda solo en ese navegador; nunca se publica.
3. Desde ahí puedes:
   - añadir o quitar destinos (ciudades, países enteros o temáticas), pulsar **Guardar y actualizar la web**, y en unos minutos tendrás los precios nuevos;
   - en **Preferencias → Mis avisos**, cambiar el nivel de avisos y los filtros.

Cuando vuelvas a sincronizar desde la app del ordenador, esta recoge los cambios que hiciste en el móvil.

## 📱 En el iPhone como app

Abre la web pública en Safari → **Compartir → Añadir a pantalla de inicio**. Tendrás icono, pantalla completa y notificaciones, gratis y sin App Store. Una app nativa en la App Store exige la cuenta de desarrollador de Apple (99 $/año).

## 🧠 ¿Compro ya o espero?

Cada resultado incluye un consejo orientativo basado en:

- en qué percentil está el precio frente al resto de fechas;
- el histórico registrado para esa fecha;
- la opinión de Google Flights, si usas SerpApi;
- la antelación: suele haber buena ventana a 21–90 días en vuelos cortos y a 60–170 días en largo radio.

Nadie puede garantizar el precio futuro de un vuelo.

## 🎲 Modo demo realista

El simulador tiene en cuenta:

- la distancia real y la competencia low-cost;
- los hubs con vuelo directo (MAD y BCN);
- las temporadas por región, los destinos de playa y los de sol en invierno (Canarias, Madeira…);
- Semana Santa, Navidad y los puentes;
- el día de la semana y la curva de antelación;
- rebajas de aerolíneas, tarifas flash y escalones de tarifa;
- las combinaciones de ida y vuelta.

También genera unas semanas de histórico. Úsalo para probar la app: **no son precios reales**.

---

## 🗂️ Estructura

```
app/
  __init__.py        API web (Flask), login, PWA
  tracker.py         escaneos, alertas, motor de búsqueda (Mejor día / Explorar / Festivos), consejos
  airlines.py        aerolíneas y políticas de equipaje (estimadas)
  holidays.py        festivos de España y cálculo de puentes
  catalog.py         ciudades con coordenadas, temáticas, orígenes de España
  catalog_world.py   resto del mundo: 195 países y sus aeropuertos principales
  notifier.py        Telegram, ntfy, email (+ horas de silencio)
  scheduler.py       escaneo automático
  db.py              SQLite, ajustes y migraciones automáticas
  providers/         travelpayouts.py (real) · serpapi.py (Google Flights) · demo.py (simulación)
  static/            interfaz (HTML/CSS/JS sin dependencias), service worker, iconos
tests/               python -m pytest   (o python -m unittest)
DEPLOY.md            cómo publicarla online
```

**Comandos útiles:**

- `python -m app` arranca la web.
- `python -m app scan` hace un escaneo único y envía los avisos (útil con cron).
- `python -m pytest` pasa los tests.

**Actualizar desde una versión anterior:** tus destinos, alertas y ajustes se conservan. La base de datos se migra sola.

## Licencia

MIT.
