# ✈️ Flight Tracker

Mi vigilante personal de vuelos. Funciona **entero en GitHub, gratis y sin ordenador encendido**:

- 🔎 **Busca precios** de mis destinos cada día, para cada fecha de los próximos meses, con la duración que elijo para cada país.
- 📧 **Me manda un email cada mañana a las 8:00** con las mejores ofertas y los chollos destacados.
- 🌐 **Publica mi web** en GitHub Pages, donde puedo:
  - ver los precios, el mejor día, el mapa para explorar destinos y los puentes;
  - usar filtros tipo Skyscanner: escalas, duración, hora de salida, aerolíneas;
  - cambiar desde la web mis destinos, la duración de cada país y los filtros.

| Inicio | Mejor día |
|---|---|
| ![Inicio](docs/inicio.jpg) | ![Mejor día](docs/mejor-dia.jpg) |

## Cómo funciona (sin usuarios ni contraseñas)

- **Cada día, a las 8:00 (hora de Madrid):**
  - GitHub busca los precios de tus destinos;
  - publica en el repositorio una *issue* con el resumen de ofertas que te menciona;
  - GitHub te la manda por email a **albertocm30.2001@gmail.com**, el email de tu cuenta de GitHub.
- **Tus destinos, filtros y la duración de cada viaje** están en `config.json`. Desde la web:
  1. cambias lo que quieras en **Mis destinos** o **Ajustes**;
  2. pulsas **Guardar**: se abre GitHub con tus cambios ya escritos;
  3. pulsas **Create**: el workflow «Guardar ajustes» los aplica y vuelve a buscar precios.
- **Duración por país:**
  - en **Mis destinos**, cada país tiene su duración: fin de semana (viernes → domingo), un número de noches o un rango (p. ej. Argentina entre 10 y 15 noches), o la general; y sus escalas (solo directos, máx. 1 o cualquiera);
  - se usa al buscar precios, en el email y en las búsquedas de la web.
- **Buscar en la web:** «Cuándo → Fin de semana (vie → dom)».

### Puesta en marcha (una vez)
1. Sube este código a tu repositorio de GitHub.
2. En GitHub → **Settings → Pages → Source: «GitHub Actions»**.
3. **Actions → «Escaneo programado» → Run workflow** (marca «Enviarme ahora el resumen» para probar el email).
4. **Precios reales:** crea el secret `TRAVELPAYOUTS_TOKEN` (clave gratis de [Travelpayouts](https://www.travelpayouts.com)) en **Settings → Secrets and variables → Actions**. Sin él, los precios son simulados.
5. **Si el email no llega:**
   - en [github.com/settings/notifications](https://github.com/settings/notifications), comprueba que el email por defecto es el tuyo y que «Email» está marcado;
   - mira en Spam la primera vez.

## Qué es un chollo (destacado en el email)

En **Ajustes → Qué es un chollo** eliges el nivel:

| Nivel | La oferta tiene que estar… |
|---|---|
| Solo excepcionales | ≥ 40 % por debajo del precio habitual de la ruta, entre el 5 % de fechas más baratas y ≥ 25 % por debajo de las fechas de alrededor |
| **Muy buenas** (por defecto) | ≥ 30 % por debajo de lo habitual, top 10 % y ≥ 18 % por debajo de las fechas cercanas |
| Buenas | ≥ 20 % por debajo de lo habitual, top 20 % y ≥ 10 % por debajo de las fechas cercanas |

- Comparar con las fechas cercanas evita avisarte de algo que solo es temporada baja.
- También avisa de mínimos históricos con un ahorro claro.
- Las bajadas simples están desactivadas por defecto.
- **Sin spam:**
  - un solo email al día, con como mucho un chollo por destino;
  - un destino no vuelve a destacarse en 14 días salvo que salga algo un 10 % más barato.

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
.github/workflows/scan.yml   escaneo diario + resumen a las 8:00 + publicar la web
app/tracker.py               escaneo, detección de ofertas y anti-spam
app/site.py                  genera la web (datos en JSON)
app/providers/               travelpayouts.py (precios reales) · demo.py (simulados)
app/catalog*.py              195 países y sus aeropuertos
app/static/                  la web (HTML/CSS/JS sin dependencias)
  js/admin.js                Ajustes y Mis destinos («Guardar» → issue en GitHub)
app/config.py                config.json (tus ajustes)
app/daily.py                 el resumen diario
.github/workflows/config.yml aplica los ajustes guardados desde la web
tests/                       python -m pytest
```

La clave de Travelpayouts es un *secret* de GitHub y **nunca** se publica en la web.
