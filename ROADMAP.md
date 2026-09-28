# 🗺️ Hoja de ruta: de herramienta personal a app monetizable

Hoy Flight Tracker está pensado para **una persona**: tú configuras en tu app local, GitHub escanea y publica una web de solo lectura, y los avisos te llegan solo a ti. El código ya está preparado para crecer por fases, sin reescribirlo.

## Fase 0 — Personal (actual, 0 €)
- App local = panel de control. GitHub Actions = escaneos y avisos 24/7. GitHub Pages = web pública de solo lectura.
- Avisos solo para el dueño: notificaciones de la app (Web Push) y email.
- Ya monetizable de forma pasiva: pon tu **marker de afiliado** de Travelpayouts en Ajustes. Así, cualquier reserva hecha desde tus enlaces te da alrededor del 1,1–1,3 % del billete.

## Fase 1 — Audiencia (0 €)
**Objetivo:** tener gente que use la web, antes de invertir.
- **Suscripciones públicas a avisos** con un Cloudflare Worker gratuito que guarda las suscripciones Web Push:
  - el visitante pulsa «Recibir avisos» y elige destinos y precio máximo;
  - el escaneo envía a cada suscriptor lo suyo;
  - encaja con `notifier.send_push` y `webpush.parse_subscriptions`.
- **Privacidad (RGPD):**
  - texto de privacidad;
  - baja con un toque;
  - no guardar más datos de los necesarios (una suscripción push no incluye nombre ni email).
- **Contenido que atrae visitas:**
  - páginas por destino («Vuelos baratos de Tenerife a Londres»);
  - chollos de residentes canarios;
  - puentes.
- **Métrica a vigilar:** visitas diarias, suscriptores y clics en «Reservar».

## Fase 2 — Ingresos (costes pequeños)
- **Afiliación** (Aviasales/Travelpayouts, y otras de hoteles o seguros): crece con el tráfico.
- **Plan premium** (modelo Going / Jack's Flight Club):
  - más destinos y avisos instantáneos;
  - precio en vivo con Google Flights;
  - filtros de equipaje y residente;
  - sin anuncios.
  
  Cobro con Stripe o Lemon Squeezy.
- **Qué hace falta:**
  - cuentas de usuario (Supabase o Cloudflare D1 tienen plan gratuito);
  - un backend pequeño que sustituya a GitHub Actions cuando haya muchos usuarios: un VPS de ~5 €/mes o Workers de pago.
- **Costes que aparecen:**
  - APIs de precio en vivo (SerpApi de pago);
  - dominio propio (~10 €/año);
  - posiblemente un proveedor de datos de vuelos con licencia comercial. Revisa las condiciones de Travelpayouts para uso comercial a escala.

## Fase 3 — App en tiendas (~99 $/año Apple + 25 $ una vez Google)
- Envolver la web actual con **Capacitor**: el mismo HTML/JS sirve para la app de iOS y Android, con notificaciones nativas.
- La compilación para iOS puede hacerse en los runners macOS de GitHub Actions.
- Publicarla exige las cuentas de desarrollador (Apple 99 $/año, Google Play 25 $ una vez).

## Decisiones ya tomadas pensando en escalar
- La web pública ya es una app (PWA) y funciona sin servidor. Su mismo código servirá dentro de Capacitor.
- Los proveedores de precios son intercambiables (`app/providers/`), así que se puede añadir uno de pago sin tocar el resto.
- Las notificaciones son propias (Web Push estándar), sin depender de ntfy ni Telegram.
- Separación clara entre el panel privado (app local) y la vista pública (exportación estática).
