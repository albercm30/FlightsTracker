# ✈️ Flight Tracker

Mi vigilante personal de vuelos. Funciona **entero en GitHub, gratis y sin ordenador encendido**:

- 🔎 **Busca precios** de mis destinos cada 6 horas, para cada día de los próximos 12 meses (ida y vuelta, o solo ida).
- 📧 **Me manda un email** solo cuando hay una oferta que de verdad merece la pena, y como mucho **un aviso por destino**.
- 🌐 **Publica mi web** en GitHub Pages, donde puedo:
  - ver los precios, el mejor día, el mapa para explorar destinos y los puentes;
  - usar filtros tipo Skyscanner: escalas, duración, hora de salida, aerolíneas;
  - cambiarlo todo desde **Ajustes**: destinos, filtros, avisos y email.

| Inicio | Mejor día |
|---|---|
| ![Inicio](docs/inicio.jpg) | ![Mejor día](docs/mejor-dia.jpg) |

## Puesta en marcha (una vez)

1. **Sube este código** a tu repositorio de GitHub.
2. En GitHub → **Settings → Pages → Source: «GitHub Actions»**.
3. En GitHub → **Actions → «Escaneo programado» → Run workflow**. En unos minutos tendrás la web en `https://<usuario>.github.io/<repositorio>/`.
4. Abre tu web → **Ajustes** y conecta tu GitHub pegando una clave (*fine-grained token*):
   - de solo tu repositorio;
   - con permisos **Actions**, **Secrets** y **Variables** en «Read and write».

   La web te explica cómo crearla. Se guarda en ese dispositivo y no hay que volver a ponerla.
5. Desde **Ajustes** y **Mis destinos**:
   - elige desde dónde sales y a dónde quieres ir;
   - pon tu **email** con una [contraseña de aplicación de Gmail](https://myaccount.google.com/apppasswords) y pulsa «Enviarme un email de prueba»;
   - para **precios reales**, pega tu clave gratuita de [Travelpayouts](https://www.travelpayouts.com). Sin ella, los precios son simulados.

A partir de ahí no hay que tocar nada: cada vez que guardas algo en la web, GitHub lo aplica y actualiza la web en unos minutos.

## Qué merece un email

En **Ajustes → Qué merece un email** eliges el nivel:

| Nivel | La oferta tiene que estar… |
|---|---|
| Solo excepcionales | ≥ 40 % por debajo del precio habitual de la ruta, entre el 5 % de fechas más baratas y ≥ 25 % por debajo de las fechas de alrededor |
| **Muy buenas** (por defecto) | ≥ 30 % por debajo de lo habitual, top 10 % y ≥ 18 % por debajo de las fechas cercanas |
| Buenas | ≥ 20 % por debajo de lo habitual, top 20 % y ≥ 10 % por debajo de las fechas cercanas |

- Comparar con las fechas cercanas evita avisarte de algo que solo es temporada baja.
- También avisa de mínimos históricos con un ahorro claro.
- Las bajadas simples están desactivadas por defecto.
- **Anti-spam:**
  - un solo email por escaneo;
  - como mucho una oferta por destino;
  - un destino no vuelve a avisar en 14 días salvo que salga algo un 10 % más barato.
- Horas de silencio opcionales (por ejemplo, `23-8`).

## Filtros

Cada vuelo muestra la **duración**, las **escalas** y la **hora de salida**.

- **En Ajustes → Filtros:** los que elijas se aplican a lo que se vigila y avisa, y son los filtros por defecto de tus búsquedas:
  - escalas;
  - duración máxima por trayecto;
  - franja horaria de salida;
  - aerolíneas que no quieres.
- **En las búsquedas:** además, puedes ordenar por **Más barato / Mejor / Más rápido** y afinar con los filtros rápidos.

## Equipaje y residente

- **Equipaje:** las APIs de precios no dicen qué equipaje incluye cada billete. La web lo **estima** según la aerolínea y calcula el total con tu opción de equipaje y viajeros.
- **Residentes de Canarias o Baleares:** el precio con descuento (75 % en vuelos nacionales) es una estimación.

## Estructura

```
.github/workflows/scan.yml   escaneo cada 6 h + email + publicar la web (todo en GitHub)
app/tracker.py               escaneo, detección de ofertas y anti-spam
app/notifier.py              email
app/site.py                  genera la web (datos en JSON)
app/providers/               travelpayouts.py (precios reales) · demo.py (simulados)
app/catalog*.py              195 países y sus aeropuertos
app/static/                  la web (HTML/CSS/JS sin dependencias)
  js/admin.js                Ajustes y Mis destinos (guarda en GitHub)
  js/sealbox.js              cifra tus claves antes de guardarlas en GitHub (como GitHub CLI)
tests/                       python -m pytest
```

Tus claves (Travelpayouts y contraseña del email) se guardan como *secrets* cifrados de GitHub y **nunca** se publican en la web.
