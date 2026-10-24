/* Flight Tracker — la web */
'use strict';
const S = { site: null, ap: {}, countries: {}, airlines: {}, routes: {} };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const D1 = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/* ---------- formato ---------- */
const sym = () => ({ eur: '€', usd: '$', gbp: '£' }[S.site?.currency] || '€');
const money = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString('es-ES')} ${sym()}`);
const d8 = (iso) => new Date(iso + 'T00:00:00');
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = d8(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const fdate = (iso) => { const d = d8(iso); return `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${Charts.MON[d.getMonth()]}`; };
const fdur = (m) => (m ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : '');
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
};
const city = (c) => S.ap[c]?.city || c;
const cc = (c) => S.ap[c]?.cc || '';
const flag = (code, big) => { const k = (code || '').toLowerCase(); return k.length === 2 ? `<img class="flag ${big ? 'big' : ''}" src="https://flagcdn.com/w40/${k}.png" alt="" loading="lazy" onerror="this.remove()">` : ''; };
const airline = (c) => S.airlines[c] || c || '';
const stopsTxt = (n) => (n === 0 ? '✈ Directo' : `${n} escala${n > 1 ? 's' : ''}`);
const stayTxt = (st) => (st.type === 'weekend' ? 'Fin de semana (vie→dom)' : st.type === 'long_weekend' ? 'Puente (jue/vie→dom/lun)' : st.min === st.max ? `${st.min} noches` : `${st.min}–${st.max} noches`);
const stopsPref = { any: 'Con o sin escalas', max1: 'Máx. 1 escala', direct: 'Solo directos' };
const datesTxt = (d) => (d.months ? `Próximos ${d.months} meses` : `${d.from ? fdate(d.from) : 'hoy'} → ${d.to ? fdate(d.to) : '12 meses'}`);
function toast(msg, ms = 3500) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------- datos ---------- */
async function getJSON(path, fallback) {
  try { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
async function loadRoute(o, d, trip) {
  const key = `${o}-${d}-${trip}`;
  if (S.routes[key]) return S.routes[key];
  const r = await getJSON(`data/routes/${key}.json`, null);
  const out = !r ? [] : r.rows.map(([off, n, p, st, al, dur, t]) => {
    const dep = addDays(r.base, off);
    return { origin: o, destination: d, dep, ret: n >= 0 ? addDays(dep, n) : null, nights: n >= 0 ? n : null, price: p, stops: st,
      airline: r.airlines[al], duration: dur || null, dep_time: t >= 0 ? `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : null };
  });
  S.routes[key] = out;
  return out;
}
const hasRoute = (o, d, trip) => S.site.routes.some((r) => r.o === o && r.d === d && r.trip === trip);

/* filtros (los mismos que usa GitHub para tus seguimientos) */
function matches(o, f) {
  if (f.from && o.dep < f.from) return false;
  if (f.to && o.dep > f.to) return false;
  const wd = (d8(o.dep).getDay() + 6) % 7;
  if (f.weekdays?.length && !f.weekdays.includes(wd)) return false;
  if (f.stops === 'direct' && o.stops !== 0) return false;
  if (f.stops === 'max1' && o.stops > 1) return false;
  if (f.maxPrice && o.price > f.maxPrice) return false;
  if (o.ret && f.stay) {
    const rw = (d8(o.ret).getDay() + 6) % 7, n = o.nights;
    if (f.stay.type === 'weekend') return wd === 4 && rw === 6 && n === 2;
    if (f.stay.type === 'long_weekend') return [3, 4].includes(wd) && [6, 0].includes(rw) && n >= 2 && n <= 4;
    return n >= f.stay.min && n <= f.stay.max;
  }
  return true;
}
function watchFilter(w) {
  const t = S.site.today, end = addDays(t, 365);
  let from = addDays(t, 1), to = end;
  if (w.dates.months) to = addDays(t, Math.round(w.dates.months * 30.5));
  else { if (w.dates.from && w.dates.from > from) from = w.dates.from; if (w.dates.to) to = w.dates.to; }
  return { from, to, weekdays: w.weekdays, stops: w.stops, stay: w.stay };
}
async function watchOffers(w, f = watchFilter(w)) {
  const all = [];
  for (const o of w.origins) for (const d of w.destinations) if (o !== d) all.push(...(await loadRoute(o, d, w.trip)).filter((x) => matches(x, f)));
  return all;
}
/* puntuación 0-100 de una oferta frente a un conjunto (igual que en GitHub) */
function scoreAll(list, baseline) {
  const ps = list.map((o) => o.price).sort((a, b) => a - b), n = ps.length;
  const med = baseline || ps[Math.floor(n / 2)];
  list.forEach((o) => {
    let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (ps[m] < o.price) lo = m + 1; else hi = m; }
    const disc = 1 - o.price / med;
    o.discount = disc;
    o.score = Math.max(0, Math.min(100, Math.round(100 * (0.55 * Math.max(0, Math.min(1, disc / 0.5)) + 0.45 * (1 - lo / n)))));
  });
  return list;
}
function bookLinks(o) {
  const dd = d8(o.dep), p2 = (n) => String(n).padStart(2, '0');
  const rr = o.ret ? d8(o.ret) : null;
  const q = encodeURIComponent(`Flights from ${o.origin} to ${o.destination} on ${o.dep}` + (o.ret ? ` returning ${o.ret}` : ' one way'));
  return {
    'Google Flights': `https://www.google.com/travel/flights?hl=es&curr=EUR&q=${q}`,
    Skyscanner: `https://www.skyscanner.es/transporte/vuelos/${o.origin.toLowerCase()}/${o.destination.toLowerCase()}/${String(dd.getFullYear()).slice(2)}${p2(dd.getMonth() + 1)}${p2(dd.getDate())}/` + (rr ? `${String(rr.getFullYear()).slice(2)}${p2(rr.getMonth() + 1)}${p2(rr.getDate())}/` : ''),
    Aviasales: `https://www.aviasales.com/search/${o.origin}${p2(dd.getDate())}${p2(dd.getMonth() + 1)}${o.destination}${rr ? p2(rr.getDate()) + p2(rr.getMonth() + 1) : ''}1`,
  };
}

/* ---------- navegación ---------- */
const VIEWS = {};
function route() {
  const [v, arg] = (location.hash.slice(1) || 'home').split('/');
  const name = VIEWS[v] ? v : 'home';
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name || (name === 'watch' && a.dataset.nav === 'watches')));
  closeModal(); Charts.hideTip();
  const app = $('#app'); app.innerHTML = '';
  VIEWS[name](app, arg ? decodeURIComponent(arg) : null);
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

/* ---------- piezas ---------- */
function dealCard(o) {
  return `<article class="card deal ${o.top ? 'is-top' : ''}" data-offer='${esc(JSON.stringify(o))}'>
    <div class="ring">${Charts.ring(o.score ?? 0, 50)}</div>
    <div class="row" style="gap:8px">${flag(cc(o.destination), true)}<div><div class="city">${esc(city(o.destination))}</div>
      <div class="route">desde ${esc(city(o.origin))} (${o.origin})${o.watch_name ? ` · ${esc(o.watch_name)}` : ''}</div></div></div>
    <div class="row" style="margin-top:12px;align-items:baseline"><span class="price p">${money(o.price)}</span>
      ${o.discount > 0.04 ? `<span class="chip good">−${Math.round(o.discount * 100)} %</span>` : ''}${o.top ? `<span class="chip hot">🔥 ${esc(o.top)}</span>` : ''}</div>
    <div class="meta"><span class="chip">📅 ${fdate(o.dep)}${o.ret ? ` → ${fdate(o.ret)}` : ''}</span>${o.nights != null ? `<span class="chip">🌙 ${o.nights} n</span>` : ''}
      <span class="chip">${stopsTxt(o.stops)}</span>${o.duration ? `<span class="chip">⏱ ${fdur(o.duration)}</span>` : ''}</div>
  </article>`;
}
function offerRow(o) {
  return `<div class="card offer" data-offer='${esc(JSON.stringify(o))}'>${flag(cc(o.destination), true)}
    <div style="min-width:0"><div class="when">${fdate(o.dep)}${o.ret ? ` → ${fdate(o.ret)} <span class="muted small">(${o.nights} noches)</span>` : ' <span class="muted small">solo ida</span>'}</div>
      <div class="small muted">${esc(city(o.origin))} → <b style="color:var(--ink2)">${esc(city(o.destination))}</b> · ${stopsTxt(o.stops)}${o.duration ? ` · ⏱ ${fdur(o.duration)}` : ''}${o.dep_time ? ` · sale ${o.dep_time}` : ''} · ${esc(airline(o.airline))}</div></div>
    <div><div class="price p">${money(o.price)}</div>${o.score != null ? `<div class="tiny muted" style="text-align:right">${o.discount > 0.04 ? `<span style="color:var(--good);font-weight:700">−${Math.round(o.discount * 100)}%</span> · ` : ''}${o.score}/100</div>` : ''}</div></div>`;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-offer]');
  if (c && !e.target.closest('a')) openOffer(JSON.parse(c.dataset.offer));
});

/* ---------- modal ---------- */
function openModal(html) {
  closeModal();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(m); document.body.style.overflow = 'hidden';
  return m;
}
function closeModal() { $('#modal')?.remove(); document.body.style.overflow = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

async function openOffer(o) {
  const L = bookLinks(o);
  const m = openModal(`<div class="hd"><button class="iconbtn close" data-close>✕</button>
      <div class="row">${flag(cc(o.destination), true)}<div><div style="opacity:.85;font-size:.9rem">${esc(city(o.origin))} (${o.origin}) → ${o.destination}</div><h2 style="font-size:1.6rem">${esc(city(o.destination))}</h2></div></div>
      <div class="row" style="margin-top:14px;align-items:baseline"><span class="price" style="font-size:2.4rem">${money(o.price)}</span><span style="opacity:.9">por persona · ${o.ret ? 'ida y vuelta' : 'solo ida'}</span></div></div>
    <div class="bd">
      ${o.score != null ? `<div class="row">${Charts.ring(o.score, 58)}<div><b>Puntuación ${o.score}/100</b><div class="small muted">${o.discount > 0 ? `${Math.round(o.discount * 100)} % por debajo de lo habitual` : 'Precio normal'}${o.top ? ` · 🔥 ${esc(o.top)}` : ''}</div></div></div>` : ''}
      <div class="facts">
        <div class="fact"><span>Ida</span><b>${fdate(o.dep)}</b>${o.dep_time ? `<div class="tiny muted">sale ${o.dep_time}</div>` : ''}</div>
        <div class="fact"><span>Vuelta</span><b>${o.ret ? fdate(o.ret) : '—'}</b></div>
        <div class="fact"><span>Estancia</span><b>${o.nights != null ? `${o.nights} noches` : '—'}</b></div>
        <div class="fact"><span>Escalas</span><b>${stopsTxt(o.stops)}</b></div>
        <div class="fact"><span>Duración ida</span><b>${fdur(o.duration) || '—'}</b></div>
        <div class="fact"><span>Aerolínea</span><b>${esc(airline(o.airline)) || '—'}</b></div>
      </div>
      <div><div class="chart-title"><h3>Esta ruta en otras fechas</h3><span class="tiny muted">${o.ret ? `misma estancia (${o.nights} n)` : 'solo ida'} · pulsa una barra</span></div><div id="near" class="chart"></div></div>
      <div class="row">${Object.entries(L).map(([k, u], i) => `<a class="btn ${i ? '' : 'primary'}" href="${esc(u)}" target="_blank" rel="noopener">${k} ↗</a>`).join('')}</div>
      <p class="tiny muted" style="margin:0">Precio visto en búsquedas recientes: compruébalo al reservar. ${S.site.provider === 'demo' ? '<b>Ahora mismo son precios simulados.</b>' : ''}</p>
    </div>`);
  const all = (await loadRoute(o.origin, o.destination, o.ret ? 'rt' : 'ow')).filter((x) => (o.ret ? x.nights === o.nights : true) && Math.abs(d8(x.dep) - d8(o.dep)) <= 21 * 864e5);
  const best = {}; all.forEach((x) => { if (!best[x.dep] || x.price < best[x.dep].price) best[x.dep] = x; });
  const days = Object.keys(best).sort();
  if (!$('#near', m)) return;
  if (!days.length) { $('#near', m).innerHTML = '<p class="small muted">Sin más fechas con esta estancia.</p>'; return; }
  Charts.columns($('#near', m), days.map((d) => ({ label: d === o.dep ? '●' : String(d8(d).getDate()), title: fdate(d), value: best[d].price,
    color: d === o.dep ? 'var(--brand)' : undefined, onClick: () => openOffer({ ...best[d] }) })), { height: 170, fmt: money });
}
async function openDay(list, iso, title) {
  const day = list.filter((o) => o.dep === iso).sort((a, b) => a.price - b.price).slice(0, 30);
  openModal(`<div class="hd"><button class="iconbtn close" data-close>✕</button><div style="opacity:.85">${esc(title || '')}</div><h2>Salidas el ${fdate(iso)}</h2><div style="opacity:.85">${day.length} opciones · desde ${money(day[0]?.price)}</div></div>
    <div class="bd"><div class="list">${day.map(offerRow).join('') || '<div class="empty">Sin opciones</div>'}</div></div>`);
}

/* ---------- HOY ---------- */
VIEWS.home = (app) => {
  const s = S.site, ws = s.watches.filter((w) => w.enabled);
  const offers = s.routes.reduce((a, r) => a + r.n, 0);
  const tops = s.top_deals.length ? s.top_deals : ws.flatMap((w) => (w.summary.top || []).slice(0, 2).map((o) => ({ ...o, watch_name: w.name }))).sort((a, b) => b.score - a.score).slice(0, 6);
  const dests = {}; ws.forEach((w) => (w.summary.destinations || []).forEach((d) => { if (!dests[d.code] || d.price < dests[d.code].price) dests[d.code] = d; }));
  const hour = new Date().getHours(), hi = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  app.innerHTML = `
    ${s.provider === 'demo' ? `<div class="banner warn">🎲 <b>Precios simulados.</b> Para precios reales añade el secret <code>TRAVELPAYOUTS_TOKEN</code> en tu repositorio (ver README).</div>` : ''}
    <section class="hero"><h1>${hi} ✈️ <span class="grad-text">${s.top_deals.length ? `${s.top_deals.length} chollo${s.top_deals.length > 1 ? 's' : ''} top hoy` : 'tus vuelos de hoy'}</span></h1>
      <p>Actualizado ${ago(s.generated)} · ${ws.length} seguimientos · ${s.provider === 'demo' ? 'precios simulados' : 'precios reales'}</p></section>
    <div class="kpis">
      <div class="card kpi"><div class="l">Seguimientos</div><div class="v">${ws.length}</div><div class="d muted">${s.routes.length} rutas vigiladas</div></div>
      <div class="card kpi"><div class="l">Ofertas analizadas</div><div class="v">${offers.toLocaleString('es-ES')}</div><div class="d muted">cada mañana</div></div>
      <div class="card kpi"><div class="l">Chollos top</div><div class="v" style="color:var(--good)">${s.top_deals.length}</div><div class="d muted">te avisamos por email</div></div>
      <div class="card kpi"><div class="l">Vuelo más barato</div><div class="v">${money(Math.min(...ws.map((w) => w.summary.min ?? Infinity).filter(isFinite)) || null)}</div><div class="d muted">entre todos</div></div>
    </div>
    <section class="sec"><div class="sec-h"><div><h2>${s.top_deals.length ? '🔥 Chollos top' : '⭐ Las mejores ofertas'}</h2><p class="small muted">Puntuación: cuánto más barato que lo habitual y frente al resto de fechas.</p></div></div>
      ${tops.length ? `<div class="deals">${tops.map(dealCard).join('')}</div>` : '<div class="card empty"><div class="big">🛫</div>Aún no hay ofertas. Crea un seguimiento en <a href="#config">Configurar</a>.</div>'}</section>
    <section class="sec"><div class="sec-h"><div><h2>📈 Tus seguimientos</h2><p class="small muted">Barra: los próximos 4 meses, verde = barato · rojo = caro.</p></div><a class="btn sm" href="#config">＋ Nuevo</a></div>
      <div class="watches">${ws.map(watchCard).join('')}</div></section>
    ${Object.keys(dests).length > 1 ? `<section class="sec"><div class="sec-h"><h2>🌍 Más barato por destino</h2></div><div class="card pad" id="destBars"></div></section>` : ''}`;
  if ($('#destBars')) Charts.hbars($('#destBars'), Object.values(dests).sort((a, b) => a.price - b.price).slice(0, 15).map((d) => ({
    label: `${flag(cc(d.code))} ${esc(city(d.code))}`, value: d.price, onClick: () => openOffer(d.offer) })), { fmt: money });
  $$('.watch[data-w]').forEach((n) => n.addEventListener('click', () => { location.hash = `watch/${n.dataset.w}`; }));
};
function watchCard(w) {
  const s = w.summary || {}, hist = (s.history || []).map((h) => h.min);
  const tr = s.trend;
  return `<article class="card watch" data-w="${esc(w.id)}">
    <div class="row between"><h3>${esc(w.name)}</h3>${(s.top || []).some((o) => o.top) ? '<span class="chip hot">🔥 chollo</span>' : ''}</div>
    <div class="small muted" style="margin-top:2px">${w.origins.map(esc).join(', ')} → ${w.destinations.slice(0, 5).map((d) => esc(city(d))).join(', ')}${w.destinations.length > 5 ? ` +${w.destinations.length - 5}` : ''}</div>
    <div class="row" style="margin-top:6px;gap:6px"><span class="chip">${w.trip === 'rt' ? stayTxt(w.stay) : 'Solo ida'}</span><span class="chip">${stopsPref[w.stops]}</span></div>
    <div class="row between" style="margin-top:14px;align-items:end"><div><div class="tiny muted">desde</div><div class="price best">${money(s.min)}</div>
      ${tr != null && Math.abs(tr) >= 1 ? `<div class="tiny" style="color:${tr < 0 ? 'var(--good)' : 'var(--bad)'}">${tr < 0 ? '▼' : '▲'} ${money(Math.abs(tr))} vs. ayer</div>` : '<div class="tiny muted">&nbsp;</div>'}</div>
      ${Charts.spark(hist.length > 1 ? hist : [], 130, 40)}</div>
    ${s.calendar ? Charts.strip(s.calendar, addDays(S.site.today, 1), 120) : ''}
  </article>`;
}
VIEWS.watches = (app) => {
  const ws = S.site.watches;
  app.innerHTML = `<div class="sec-h"><div><h1>Seguimientos</h1><p class="muted">Lo que vigilamos cada mañana para ti.</p></div><a class="btn primary" href="#config">＋ Nuevo seguimiento</a></div>
    <div class="watches">${ws.map(watchCard).join('') || '<div class="card empty">Aún no tienes seguimientos.</div>'}</div>`;
  $$('.watch[data-w]').forEach((n) => n.addEventListener('click', () => { location.hash = `watch/${n.dataset.w}`; }));
};

/* ---------- DETALLE DE UN SEGUIMIENTO ---------- */
VIEWS.watch = (app, id) => {
  const w = S.site.watches.find((x) => x.id === id);
  if (!w) { app.innerHTML = '<div class="card empty">Seguimiento no encontrado. <a href="#watches">Volver</a></div>'; return; }
  const s = w.summary || {};
  const hist = s.history || [];
  app.innerHTML = `
    <div class="whead"><div><a class="small" href="#watches">← Seguimientos</a><h1 style="margin-top:6px">${esc(w.name)}</h1>
      <div class="chips"><span class="chip brand">${w.origins.map((o) => `${flag(cc(o))} ${esc(o)}`).join(' ')} → ${w.destinations.map((d) => esc(d)).join(', ')}</span>
        <span class="chip">${w.trip === 'rt' ? 'Ida y vuelta' : 'Solo ida'}</span>${w.trip === 'rt' ? `<span class="chip">🌙 ${stayTxt(w.stay)}</span>` : ''}
        <span class="chip">📅 ${datesTxt(w.dates)}</span><span class="chip">${stopsPref[w.stops]}</span>
        ${w.weekdays.length ? `<span class="chip">Salida: ${w.weekdays.map((d) => DAYS[d]).join(', ')}</span>` : ''}${w.max_price ? `<span class="chip">🎯 ≤ ${money(w.max_price)}</span>` : ''}</div></div>
      <a class="btn" href="#config/${esc(w.id)}">✎ Editar</a></div>
    ${!s.count ? '<div class="card empty sec"><div class="big">🔎</div>Aún no hay precios para este seguimiento. Se buscarán en la próxima actualización.</div>' : `
    <div class="kpis">
      <div class="card kpi"><div class="l">Mejor precio</div><div class="v" style="color:var(--good)">${money(s.min)}</div><div class="d muted">${s.best ? `${fdate(s.best.dep)} · ${esc(city(s.best.destination))}` : ''}</div></div>
      <div class="card kpi"><div class="l">Precio habitual</div><div class="v">${money(s.baseline)}</div><div class="d muted">mediana${hist.length >= 3 ? ' de los últimos días' : ''}</div></div>
      <div class="card kpi"><div class="l">Opciones</div><div class="v">${s.count.toLocaleString('es-ES')}</div><div class="d muted">fechas y combinaciones</div></div>
      <div class="card kpi"><div class="l">Desde ayer</div><div class="v" style="color:${s.trend == null || Math.abs(s.trend) < 1 ? 'var(--ink)' : s.trend < 0 ? 'var(--good)' : 'var(--bad)'}">${s.trend == null ? '—' : Math.abs(s.trend) < 1 ? '= igual' : `${s.trend < 0 ? '▼' : '▲'} ${money(Math.abs(s.trend))}`}</div><div class="d muted">precio mínimo</div></div>
    </div>
    <section class="sec card pad"><div class="chart-title"><h2>📅 Precio por día de salida</h2><div class="legend">barato <span class="scale"></span> caro · ● chollo</div></div><div id="cal"></div></section>
    <div class="grid g2 sec">
      <div class="card pad"><div class="chart-title"><h3>📉 Evolución del precio</h3><span class="tiny muted">mínimo, banda p10–mediana</span></div><div id="hist" class="chart"></div></div>
      <div class="card pad"><div class="chart-title"><h3>🗓️ Más barato por mes</h3></div><div id="months" class="chart"></div></div>
      ${(s.destinations || []).length > 1 ? '<div class="card pad"><div class="chart-title"><h3>🌍 Por destino</h3></div><div id="dests"></div></div>' : ''}
      ${Object.keys(s.nights || {}).length > 1 ? '<div class="card pad"><div class="chart-title"><h3>🌙 Por número de noches</h3></div><div id="nights" class="chart"></div></div>' : ''}
      <div class="card pad"><div class="chart-title"><h3>📆 Por día de salida</h3><span class="tiny muted">mediana</span></div><div id="wdays" class="chart"></div></div>
      <div class="card pad"><div class="chart-title"><h3>📊 Distribución de precios</h3></div><div id="histo" class="chart"></div></div>
      ${Object.keys(s.origins || {}).length > 1 ? '<div class="card pad"><div class="chart-title"><h3>🛫 Por aeropuerto de salida</h3></div><div id="origs"></div></div>' : ''}
    </div>
    <section class="sec"><div class="sec-h"><h2>⭐ Mejores opciones</h2></div><div class="list">${(s.top || []).map(offerRow).join('')}</div></section>`}`;
  if (!s.count) return;
  const cal = {}; Object.entries(s.calendar).forEach(([k, v]) => { cal[k] = { p: v.p, top: (s.top || []).some((o) => o.top && o.dep === k) }; });
  Charts.calendar($('#cal'), cal, { fmt: money, onClick: async (iso) => openDay(await watchOffers(w), iso, w.name) });
  Charts.line($('#hist'), { series: [{ name: 'Mínimo', color: '#22d3ee', area: true, points: hist.map((h) => [h.day, h.min]) }, { name: 'Mediana', color: '#a78bfa', dash: '5 4', width: 2, points: hist.map((h) => [h.day, h.median]) }],
    band: hist.map((h) => [h.day, h.p10, h.median]), yFmt: money });
  Charts.columns($('#months'), Object.entries(s.months).map(([m, v]) => ({ label: Charts.MON[+m.slice(5) - 1], title: `${Charts.MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`, value: v })), { fmt: money });
  if ($('#dests')) Charts.hbars($('#dests'), s.destinations.map((d) => ({ label: `${flag(cc(d.code))} ${esc(city(d.code))}`, value: d.price, onClick: () => openOffer(d.offer) })), { fmt: money });
  if ($('#nights')) Charts.columns($('#nights'), Object.entries(s.nights).map(([n, v]) => ({ label: n, title: `${n} noches`, value: v })), { fmt: money });
  Charts.columns($('#wdays'), (s.weekdays || []).map((x, i) => ({ label: DAYS[i], value: x ? x.median : null, sub: x ? `mínimo ${money(x.min)}` : '' })), { fmt: money });
  if (s.histogram?.counts) Charts.histogram($('#histo'), s.histogram, { fmt: money, markers: [{ value: s.min, label: 'mejor', color: '#34d399' }, { value: s.median, label: 'mediana', color: '#a78bfa' }] });
  if ($('#origs')) Charts.hbars($('#origs'), Object.entries(s.origins).map(([o, v]) => ({ label: `${flag(cc(o))} ${esc(city(o))}`, value: v })), { fmt: money });
};

/* ---------- selector de aeropuertos ---------- */
const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function airportPicker(box, codes, onChange, { only = null, placeholder = 'Ciudad, aeropuerto o país…' } = {}) {
  const pool = only ? only.map((c) => S.ap[c] || { code: c, city: c, cc: '' }) : Object.values(S.ap);
  const draw = () => {
    box.innerHTML = `<div class="chips" style="margin-bottom:8px">${codes.map((c) => `<span class="chip">${flag(cc(c))} ${esc(city(c))} <span class="tiny muted">${c}</span><button class="x" data-rm="${c}" type="button">×</button></span>`).join('') || '<span class="tiny muted">Ninguno</span>'}</div>
      <div class="ac"><input type="text" placeholder="${placeholder}"></div>`;
    const input = $('input', box), wrap = $('.ac', box);
    let items = [], idx = -1, list = null;
    const close = () => { list?.remove(); list = null; };
    const render = () => {
      const q = norm(input.value.trim());
      items = [];
      if (q) {
        const countries = only ? [] : Object.entries(S.countries).filter(([k, n]) => norm(n).startsWith(q) || norm(n).includes(` ${q}`)).slice(0, 3);
        countries.forEach(([k, n]) => { const cs = Object.values(S.ap).filter((a) => a.cc === k).map((a) => a.code); if (cs.length) items.push({ codes: cs, html: `${flag(k)} <b>${esc(n)}</b> <span class="muted small">todo el país (${cs.length})</span>` }); });
        pool.filter((a) => norm(a.code) === q || norm(a.city).includes(q) || norm(S.countries[a.cc]).startsWith(q)).sort((a, b) => (norm(a.code) === q ? -1 : 0) - (norm(b.code) === q ? -1 : 0) || norm(a.city).indexOf(q) - norm(b.city).indexOf(q))
          .slice(0, 8).forEach((a) => items.push({ codes: [a.code], html: `${flag(a.cc)} ${esc(a.city)} <span class="muted small">${esc(S.countries[a.cc] || '')}</span><span class="code">${a.code}</span>` }));
        if (!only && /^[a-z]{3}$/.test(q) && !items.some((i) => i.codes.length === 1 && norm(i.codes[0]) === q)) items.push({ codes: [q.toUpperCase()], html: `Usar el código <b>${q.toUpperCase()}</b>` });
      } else if (only) pool.slice(0, 12).forEach((a) => items.push({ codes: [a.code], html: `${flag(a.cc)} ${esc(a.city)}<span class="code">${a.code}</span>` }));
      if (!items.length) { close(); return; }
      if (!list) { list = document.createElement('div'); list.className = 'ac-list'; wrap.appendChild(list); list.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(+d.dataset.i); } }); }
      list.innerHTML = items.map((it, i) => `<div data-i="${i}" class="${i === idx ? 'on' : ''}">${it.html}</div>`).join('');
    };
    const pick = (i) => { const it = items[i]; if (!it) return; it.codes.forEach((c) => { if (!codes.includes(c)) codes.push(c); }); onChange(codes); draw(); $('input', box).focus(); };
    input.addEventListener('input', () => { idx = -1; render(); });
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { pick(Math.max(0, idx)); e.preventDefault(); }
    });
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { codes.splice(codes.indexOf(b.dataset.rm), 1); onChange(codes); draw(); }));
  };
  draw();
}
function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([k, l]) => `<button type="button" data-v="${k}" class="${String(value) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, name, onChange) {
  const s = $(`[data-seg="${name}"]`, root);
  s?.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; $$('button', s).forEach((x) => x.classList.toggle('on', x === b)); onChange(b.dataset.v); });
}
function daysPicker(root, sel, onChange) {
  root.innerHTML = `<div class="days">${D1.map((d, i) => `<button type="button" data-d="${i}" class="${sel.includes(i) ? 'on' : ''}" title="${DAYS[i]}">${d}</button>`).join('')}</div>`;
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const i = +b.dataset.d; const k = sel.indexOf(i); if (k >= 0) sel.splice(k, 1); else sel.push(i); b.classList.toggle('on'); onChange(sel); });
}

/* ---------- BUSCAR ---------- */
VIEWS.search = (app) => {
  const routes = S.site.routes;
  const allO = [...new Set(routes.map((r) => r.o))], allD = [...new Set(routes.map((r) => r.d))];
  const f = S.searchF || (S.searchF = { origins: [...allO], destinations: [], trip: routes.some((r) => r.trip === 'rt') ? 'rt' : 'ow', from: addDays(S.site.today, 1), to: addDays(S.site.today, 182),
    stay: { type: 'nights', min: 3, max: 10 }, stops: 'any', weekdays: [], maxPrice: '', sort: 'price' });
  app.innerHTML = `<div class="sec-h"><div><h1>Buscar</h1><p class="muted">Explora todas las fechas de las rutas que vigilas, con tus filtros.</p></div></div>
    <div class="search-layout">
      <aside class="card filters" id="flt">
        <div class="f"><label>Desde</label><div id="fO"></div></div>
        <div class="f"><label>A dónde <span class="muted" style="text-transform:none;letter-spacing:0">(vacío = todos)</span></label><div id="fD"></div></div>
        <div class="f"><label>Viaje</label>${seg('trip', [['rt', 'Ida y vuelta'], ['ow', 'Solo ida']], f.trip)}</div>
        <div class="f" id="stayBox"><label>Estancia</label>${seg('stay', [['nights', 'Noches'], ['weekend', 'Finde'], ['long_weekend', 'Puente']], f.stay.type)}
          <div class="pair" id="nightsBox" style="margin-top:8px"><input type="number" min="1" max="60" id="nMin" value="${f.stay.min}"><span class="muted">a</span><input type="number" min="1" max="60" id="nMax" value="${f.stay.max}"></div></div>
        <div class="f"><label>Salida entre</label><div class="pair dates"><input type="date" id="dFrom" value="${f.from}"><span class="muted">y</span><input type="date" id="dTo" value="${f.to}"></div>
          <div class="row" style="margin-top:8px;gap:6px">${[['30 días', 30], ['3 meses', 91], ['6 meses', 182], ['1 año', 365]].map(([l, n]) => `<button class="btn sm ghost" data-q="${n}" type="button">${l}</button>`).join('')}</div></div>
        <div class="f"><label>Días de salida</label><div id="fW"></div></div>
        <div class="f"><label>Escalas</label>${seg('stops', [['any', 'Cualquiera'], ['max1', 'Máx. 1'], ['direct', 'Directo']], f.stops)}</div>
        <div class="f"><label>Precio máximo</label><input type="number" min="0" id="fMax" placeholder="${sym()}" value="${f.maxPrice}"></div>
        <button class="btn primary" id="go" type="button">🔎 Buscar</button>
      </aside>
      <section id="res"></section>
    </div>`;
  airportPicker($('#fO'), f.origins, () => {}, { only: allO, placeholder: 'Aeropuerto de salida…' });
  airportPicker($('#fD'), f.destinations, () => {}, { only: allD, placeholder: 'Todos los destinos…' });
  daysPicker($('#fW'), f.weekdays, () => {});
  const syncStay = () => { $('#stayBox').style.display = f.trip === 'rt' ? '' : 'none'; $('#nightsBox').style.display = f.stay.type === 'nights' ? '' : 'none'; };
  bindSeg(app, 'trip', (v) => { f.trip = v; syncStay(); });
  bindSeg(app, 'stay', (v) => { f.stay.type = v; syncStay(); });
  bindSeg(app, 'stops', (v) => { f.stops = v; });
  syncStay();
  $$('[data-q]', app).forEach((b) => b.addEventListener('click', () => { $('#dFrom').value = addDays(S.site.today, 1); $('#dTo').value = addDays(S.site.today, +b.dataset.q); }));
  const run = async () => {
    f.stay.min = Math.max(1, +$('#nMin').value || 1); f.stay.max = Math.max(f.stay.min, +$('#nMax').value || f.stay.min);
    f.from = $('#dFrom').value; f.to = $('#dTo').value; f.maxPrice = +$('#fMax').value || '';
    const dests = f.destinations.length ? f.destinations : allD;
    const res = $('#res'); res.innerHTML = '<div class="card empty">Buscando…</div>';
    let list = [];
    for (const o of f.origins) for (const d of dests) if (o !== d && hasRoute(o, d, f.trip)) list.push(...(await loadRoute(o, d, f.trip)));
    list = list.filter((x) => matches(x, f));
    if (!list.length) {
      res.innerHTML = `<div class="card empty"><div class="big">🔎</div>No hay vuelos con esos filtros.<div class="small" style="margin-top:6px">${routes.some((r) => r.trip === f.trip) ? 'Prueba con más fechas, otra estancia o sin límite de escalas.' : `No vigilas rutas ${f.trip === 'rt' ? 'de ida y vuelta' : 'de solo ida'}: crea un seguimiento en <a href="#config">Configurar</a>.`}</div></div>`;
      return;
    }
    scoreAll(list);
    const cal = {}, byD = {}, byM = {};
    list.forEach((x) => {
      if (!cal[x.dep] || x.price < cal[x.dep].p) cal[x.dep] = { p: x.price, n: 0 };
      cal[x.dep].n++;
      if (!byD[x.destination] || x.price < byD[x.destination].price) byD[x.destination] = x;
      const m = x.dep.slice(0, 7); byM[m] = Math.min(byM[m] ?? Infinity, x.price);
    });
    const sorted = list.slice().sort((a, b) => a.price - b.price);
    const best = sorted[0];
    res.innerHTML = `
      <div class="kpis" style="margin-top:0">
        <div class="card kpi"><div class="l">Desde</div><div class="v" style="color:var(--good)">${money(best.price)}</div><div class="d muted">${esc(city(best.destination))} · ${fdate(best.dep)}</div></div>
        <div class="card kpi"><div class="l">Opciones</div><div class="v">${list.length.toLocaleString('es-ES')}</div><div class="d muted">${Object.keys(cal).length} días de salida</div></div>
        <div class="card kpi"><div class="l">Mediana</div><div class="v">${money(sorted[Math.floor(sorted.length / 2)].price)}</div><div class="d muted">precio típico</div></div>
        <div class="card kpi"><div class="l">Destinos</div><div class="v">${Object.keys(byD).length}</div><div class="d muted">con precio</div></div>
      </div>
      <div class="card pad sec"><div class="chart-title"><h3>📅 Precio por día de salida</h3><div class="legend">barato <span class="scale"></span> caro</div></div><div id="sCal"></div></div>
      <div class="grid g2 sec">
        <div class="card pad"><div class="chart-title"><h3>🌍 Por destino</h3></div><div id="sD"></div></div>
        <div class="card pad"><div class="chart-title"><h3>🗓️ Por mes</h3></div><div id="sM" class="chart"></div></div>
      </div>
      <section class="sec"><div class="sec-h"><h2>Mejores opciones</h2>${seg('sort', [['price', 'Más baratas'], ['score', 'Mejor puntuación'], ['date', 'Por fecha']], f.sort)}</div><div class="list" id="sL"></div></section>`;
    Charts.calendar($('#sCal'), cal, { fmt: money, onClick: (iso) => openDay(list, iso, 'Tu búsqueda') });
    Charts.hbars($('#sD'), Object.values(byD).sort((a, b) => a.price - b.price).slice(0, 15).map((x) => ({ label: `${flag(cc(x.destination))} ${esc(city(x.destination))}`, value: x.price, onClick: () => openOffer(x) })), { fmt: money });
    Charts.columns($('#sM'), Object.keys(byM).sort().map((m) => ({ label: Charts.MON[+m.slice(5) - 1], title: `${Charts.MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`, value: byM[m] })), { fmt: money });
    const drawList = () => {
      const key = { price: (a, b) => a.price - b.price, score: (a, b) => b.score - a.score || a.price - b.price, date: (a, b) => a.dep.localeCompare(b.dep) || a.price - b.price }[f.sort];
      // variedad: como mucho 1 opción por destino y día de salida, y 6 por destino
      const seen = new Set(), per = {}, out = [];
      for (const x of list.slice().sort(key)) {
        const k = `${x.destination}|${x.dep}`; if (seen.has(k) || (per[x.destination] || 0) >= 6) continue;
        seen.add(k); per[x.destination] = (per[x.destination] || 0) + 1; out.push(x); if (out.length >= 40) break;
      }
      $('#sL').innerHTML = out.map(offerRow).join('');
    };
    bindSeg(res, 'sort', (v) => { f.sort = v; drawList(); });
    drawList();
  };
  $('#go').addEventListener('click', run);
  run();
};

/* ---------- CONFIGURAR (sin usuarios: «Guardar» abre GitHub con los cambios escritos) ---------- */
const DRAFT = 'ft-draft-v7';
const clone = (x) => JSON.parse(JSON.stringify(x));
function draft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && JSON.stringify(d.cfg) !== JSON.stringify(S.site.config) && Date.now() - d.at < 3 * 864e5) return d; } catch (e) { /* */ }
  return null;
}
function saveDraft(cfg, sent = false) { try { localStorage.setItem(DRAFT, JSON.stringify({ cfg, at: Date.now(), sent })); } catch (e) { /* */ } }
function newWatch() {
  return { id: '', name: 'Nuevo seguimiento', origins: [...(S.site.config.watches[0]?.origins || ['MAD'])], destinations: [], trip: 'rt',
    stay: { type: 'nights', min: 3, max: 7 }, dates: { months: 6 }, stops: 'any', weekdays: [], max_price: null, enabled: true };
}
VIEWS.config = (app, focusId) => {
  const d = draft();
  const cfg = d ? clone(d.cfg) : clone(S.site.config);
  const repo = S.site.repo || (() => { const m = location.hostname.match(/^([\w-]+)\.github\.io$/); const p = location.pathname.split('/').filter(Boolean)[0]; return m && p ? `${m[1]}/${p}` : ''; })();
  const dirty = () => saveDraft(cfg);
  const draw = () => {
    app.innerHTML = `<div class="sec-h"><div><h1>Configurar</h1><p class="muted">Qué vuelos vigilamos cada mañana y cuándo te avisamos.</p></div><button class="btn primary" id="add" type="button">＋ Nuevo seguimiento</button></div>
      ${d?.sent ? '<div class="banner">⏳ <b>Cambios enviados.</b> Si ya pulsaste «Create» en GitHub, se aplicarán y la web se actualizará en unos minutos. <a href="#" id="discard">Descartar borrador</a></div>' : d ? '<div class="banner warn">✏️ Tienes cambios sin guardar.</div>' : ''}
      <div class="grid" id="wl">${cfg.watches.map((w, i) => watchForm(w, i)).join('')}</div>
      <section class="sec card pad"><h2>🔔 Avisos por email</h2>
        <p class="small muted" style="margin:6px 0 14px">Te escribimos solo cuando hay un <b>chollo top</b>: un precio bastante por debajo de lo habitual, por debajo de tu precio máximo o el más barato visto nunca. Como mucho un aviso por seguimiento cada ${cfg.alerts.cooldown_days} días, salvo que baje otro 10 %.</p>
        <div class="grid g3">
          <div class="f"><label>Exigencia</label>${seg('lvl', [['35', 'Solo excepcionales'], ['25', 'Muy buenos'], ['15', 'Buenos']], String(cfg.alerts.min_discount >= 35 ? 35 : cfg.alerts.min_discount >= 25 ? 25 : 15))}</div>
          <div class="f"><label>Repetir aviso como pronto a los (días)</label><input type="number" min="1" max="60" id="cool" value="${cfg.alerts.cooldown_days}"></div>
        </div></section>
      <div class="card savebar"><button class="btn primary" id="save" type="button">💾 Guardar en GitHub</button>
        <span class="small muted">Se abre GitHub con tus cambios ya escritos: pulsa <b>Create</b> y listo. En unos minutos se buscan precios y se actualiza la web.</span></div>`;
    cfg.watches.forEach((w, i) => bindWatch($(`[data-wi="${i}"]`), w, i));
    $('#add').onclick = () => { cfg.watches.push(newWatch()); dirty(); draw(); $(`[data-wi="${cfg.watches.length - 1}"]`).scrollIntoView({ behavior: 'smooth' }); };
    $('#discard')?.addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem(DRAFT); route(); });
    bindSeg(app, 'lvl', (v) => { cfg.alerts.min_discount = +v; cfg.alerts.min_score = { 35: 85, 25: 80, 15: 70 }[v]; dirty(); });
    $('#cool').onchange = (e) => { cfg.alerts.cooldown_days = Math.max(1, +e.target.value || 14); dirty(); };
    $('#save').onclick = () => {
      if (!repo) { toast('No sé cuál es tu repositorio'); return; }
      const bad = cfg.watches.find((w) => !w.origins.length || !w.destinations.length);
      if (bad) { toast(`«${bad.name}»: añade al menos un origen y un destino`); return; }
      const body = 'Pulsa **Create** para guardar estos ajustes. Se aplicarán en unos minutos.\n\n```json\n' + JSON.stringify(cfg) + '\n```';
      saveDraft(cfg, true);
      window.open(`https://github.com/${repo}/issues/new?title=${encodeURIComponent('⚙️ Configuración de Flight Tracker')}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
      toast('Pulsa «Create» en GitHub para guardar', 6000);
      setTimeout(route, 300);
    };
    if (focusId) $(`[data-wid="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth' });
  };
  const watchForm = (w, i) => `<div class="card wform" data-wi="${i}" data-wid="${esc(w.id)}">
      <div class="row between"><div class="row"><label class="switch" title="Activo"><input type="checkbox" data-k="enabled" ${w.enabled ? 'checked' : ''}><span></span></label>
        <input type="text" data-k="name" value="${esc(w.name)}" style="font-weight:750;font-size:1.05rem;max-width:340px"></div>
        <button class="btn sm danger ghost" data-del type="button">Eliminar</button></div>
      <div class="fields">
        <div class="f"><label>Desde</label><div data-pick="origins"></div></div>
        <div class="f"><label>A dónde</label><div data-pick="destinations"></div></div>
        <div class="f"><label>Viaje</label>${seg(`trip${i}`, [['rt', 'Ida y vuelta'], ['ow', 'Solo ida']], w.trip)}</div>
        <div class="f" data-stay><label>Estancia</label>${seg(`stay${i}`, [['nights', 'Noches'], ['weekend', 'Finde (vie→dom)'], ['long_weekend', 'Puente']], w.stay.type)}
          <div class="pair" data-nights style="margin-top:8px"><input type="number" min="1" max="60" data-k="nmin" value="${w.stay.min ?? 3}"><span class="muted">a</span><input type="number" min="1" max="60" data-k="nmax" value="${w.stay.max ?? 7}"></div></div>
        <div class="f"><label>Fechas de salida</label>${seg(`dates${i}`, [['months', 'Próximos meses'], ['range', 'Entre fechas']], w.dates.months ? 'months' : 'range')}
          <div style="margin-top:8px" data-months><select data-k="months">${[1, 2, 3, 4, 6, 9, 12].map((n) => `<option value="${n}" ${w.dates.months === n ? 'selected' : ''}>Próximos ${n} meses</option>`).join('')}</select></div>
          <div class="pair" style="margin-top:8px" data-range><input type="date" data-k="from" value="${w.dates.from || ''}"><span class="muted">a</span><input type="date" data-k="to" value="${w.dates.to || ''}"></div></div>
        <div class="f"><label>Escalas</label>${seg(`stops${i}`, [['any', 'Cualquiera'], ['max1', 'Máx. 1'], ['direct', 'Solo directos']], w.stops)}</div>
        <div class="f"><label>Días de salida <span class="muted" style="text-transform:none;letter-spacing:0">(ninguno = todos)</span></label><div data-days></div></div>
        <div class="f"><label>Avisarme siempre por debajo de</label><input type="number" min="0" data-k="max_price" placeholder="${sym()} (opcional)" value="${w.max_price ?? ''}"></div>
      </div></div>`;
  const bindWatch = (card, w, i) => {
    const sync = () => {
      $('[data-stay]', card).style.display = w.trip === 'rt' ? '' : 'none';
      $('[data-nights]', card).style.display = w.stay.type === 'nights' ? '' : 'none';
      $('[data-months]', card).style.display = w.dates.months ? '' : 'none';
      $('[data-range]', card).style.display = w.dates.months ? 'none' : '';
    };
    airportPicker($('[data-pick=origins]', card), w.origins, dirty, { placeholder: 'Aeropuerto de salida…' });
    airportPicker($('[data-pick=destinations]', card), w.destinations, dirty, { placeholder: 'Ciudad, aeropuerto o país…' });
    daysPicker($('[data-days]', card), w.weekdays, dirty);
    bindSeg(card, `trip${i}`, (v) => { w.trip = v; sync(); dirty(); });
    bindSeg(card, `stay${i}`, (v) => { w.stay = v === 'nights' ? { type: 'nights', min: w.stay.min || 3, max: w.stay.max || 7 } : { type: v }; sync(); dirty(); });
    bindSeg(card, `dates${i}`, (v) => { w.dates = v === 'months' ? { months: 6 } : { from: S.site.today, to: addDays(S.site.today, 90) }; $('[data-k=from]', card).value = w.dates.from || ''; $('[data-k=to]', card).value = w.dates.to || ''; sync(); dirty(); });
    bindSeg(card, `stops${i}`, (v) => { w.stops = v; dirty(); });
    card.addEventListener('change', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      const v = e.target.value;
      if (k === 'enabled') w.enabled = e.target.checked;
      else if (k === 'name') w.name = v.trim() || 'Seguimiento';
      else if (k === 'nmin' || k === 'nmax') { const a = Math.max(1, +$('[data-k=nmin]', card).value || 1), b = Math.max(1, +$('[data-k=nmax]', card).value || a); w.stay = { type: 'nights', min: Math.min(a, b), max: Math.max(a, b) }; }
      else if (k === 'months') w.dates = { months: +v };
      else if (k === 'from' || k === 'to') w.dates = { from: $('[data-k=from]', card).value || null, to: $('[data-k=to]', card).value || null };
      else if (k === 'max_price') w.max_price = +v || null;
      dirty();
    });
    $('[data-del]', card).onclick = () => { if (confirm(`¿Eliminar «${w.name}»?`)) { cfg.watches.splice(i, 1); dirty(); draw(); } };
    sync();
  };
  draw();
};

/* ---------- arranque ---------- */
$('#theme').onclick = () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t; try { localStorage.setItem('ft-theme', t); } catch (e) { /* */ }
};
(async function init() {
  try {
    const [site, ap, airlines] = await Promise.all([getJSON('data/site.json'), getJSON('data/airports.json'), getJSON('data/airlines.json', {})]);
    S.site = site; S.airlines = airlines; S.countries = ap.countries;
    ap.airports.forEach((a) => { S.ap[a.code] = a; });
    $('#status').innerHTML = `<b>${site.provider === 'demo' ? '🎲 Simulado' : '✅ Precios reales'}</b><br>actualizado ${ago(site.generated)}`;
    route();
  } catch (e) {
    $('#app').innerHTML = `<div class="card empty"><div class="big">🛠️</div><h2>Todavía no hay datos</h2><p>Ejecuta la primera actualización en GitHub → Actions → «Actualizar vuelos» → Run workflow.</p><p class="tiny muted">${esc(e.message)}</p></div>`;
  }
})();
