/* Flight Tracker — vistas y navegación */
'use strict';

/* =================== navegación =================== */
const VIEWS = {};
function route(force = false) {
  const v = (location.hash.slice(1) || 'home').split('?')[0];
  const name = VIEWS[v] ? v : 'home';
  if (name === 'more') { openMore(); return; }
  if (!force && S.view === name && $(`#view-${name}`).dataset.ready) return;
  S.view = name;
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${name}`));
  $$('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  const el = $(`#view-${name}`); el.dataset.ready = 1;
  VIEWS[name](el);
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => route(true));
function go(view, pending) { if (pending) S.pending = { view, ...pending }; if (location.hash === `#${view}`) route(true); else location.hash = view; }
function openMore() {
  openSheet(`<div class="sh-head"><h2>Más</h2><button class="btn icon ghost close" data-close>${ic('x')}</button></div>
  <div class="sh-body"><div class="list">
  ${[['holidays', 'sun', 'Puentes y festivos'], ['calendar', 'calendar', 'Calendario de precios'], ['watches', 'eye', 'Vuelos vigilados'], ['destinations', 'star', 'Mis destinos'], ['settings', 'settings', 'Ajustes']]
    .map(([v, i, t]) => `<a class="card item" href="#${v}" data-close>${ic(i)}<span class="title">${t}</span></a>`).join('')}
  <button class="card item btn" id="moreTheme" style="justify-content:flex-start;border-radius:var(--r)">${ic('moon')} Cambiar tema</button>
  </div></div>`);
  $('#moreTheme').onclick = cycleTheme;
  history.replaceState(null, '', `#${S.view || 'home'}`);
}

/* =================== estado / escaneo =================== */
async function refreshStatus() {
  const s = await api('/api/status'); S.status = s;
  const last = s.last_scan;
  $('#sideStatus').innerHTML = `<div><b>${s.provider === 'demo' ? '🎲 Modo demo' : '✅ Precios reales'}</b></div>
    <div>Último escaneo: ${last ? ago(last.finished_at || last.started_at) : 'nunca'}</div><div>Próximo: ${until(s.next_run)}</div>`;
  $$('[data-count="alerts"]').forEach((c) => { c.textContent = s.unread_alerts; c.classList.toggle('hidden', !s.unread_alerts); });
  $$('[data-count="watches"]').forEach((c) => { c.textContent = s.watches; c.classList.toggle('hidden', !s.watches); });
  const p = s.progress, bar = $('#scanbar');
  bar.classList.toggle('hidden', !p.running);
  $('#scanBtn').disabled = p.running;
  if (p.running) { $('#scanText').textContent = `Escaneando ${p.current}… ${p.done}/${p.total}`; $('div > div', bar).style.width = `${p.total ? (p.done / p.total) * 100 : 5}%`; }
  $('#logoutBtn').classList.toggle('hidden', !s.auth);
  const ban = [];
  if (s.insecure) ban.push(`<div class="banner warn">${ic('zap')}<div><b>Tu app está accesible desde internet sin contraseña.</b> Define <code>APP_PASSWORD</code> en el servidor para protegerla.</div></div>`);
  $('#banners').innerHTML = ban.join('');
  return s;
}
let wasRunning = false;
setInterval(async () => {
  try {
    const s = await refreshStatus();
    if (wasRunning && !s.progress.running) { toast('✅ Escaneo terminado'); if (['home', 'calendar', 'watches', 'alerts'].includes(S.view)) route(true); }
    wasRunning = s.progress.running;
  } catch (e) { /* sin conexión */ }
}, 5000);
async function startScan() {
  try { await api('/api/scan', { method: 'POST' }); wasRunning = true; toast('Escaneo iniciado'); refreshStatus(); } catch (e) { toast(e.message); }
}
$('#scanBtn').onclick = startScan; $('#scanBtnM').onclick = startScan;
$('#themeBtn').onclick = cycleTheme; $('#themeBtnM').onclick = cycleTheme;
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/login'; };

/* =================== formulario de búsqueda reutilizable =================== */
function monthOptions() {
  const d = new Date(); const out = [];
  for (let i = 0; i < 12; i++) { const x = new Date(d.getFullYear(), d.getMonth() + i, 1); out.push([`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, `${MONTHS[x.getMonth()]} ${x.getFullYear()}`]); }
  return out;
}
function originOptions(sel = 'mine') {
  const own = S.settings.origins || [];
  const sp = (S.meta.spain_origins || []).map((c) => c.code);
  return `<option value="mine" ${sel === 'mine' ? 'selected' : ''}>Mis aeropuertos (${esc(own.join(', ') || '—')})</option>
    <option value="ES" ${sel === 'ES' ? 'selected' : ''}>Toda España (${sp.length} aeropuertos)</option>
    ${[...new Set([...own, ...sp])].map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${esc(cityName(c))} (${c})</option>`).join('')}`;
}
function searchForm(root, { mode = 'days', compact = false, values = {} } = {}) {
  const v = { trip: S.settings.trip_type === 'ow' ? 'ow' : 'rt', origins: 'mine', when: 'any', min_nights: S.settings.min_nights, max_nights: S.settings.max_nights, ...values };
  const regions = Object.entries(S.meta.regions);
  const themes = Object.entries(S.meta.themes);
  root.innerHTML = `
  <form class="searchbox" autocomplete="off">
    <div class="top">
      <div class="seg" data-trip><button type="button" data-t="rt" class="${v.trip === 'rt' ? 'on' : ''}">Ida y vuelta</button><button type="button" data-t="ow" class="${v.trip === 'ow' ? 'on' : ''}">Solo ida</button></div>
      <span class="spacer"></span>${paxBagControl('pb', v.pax || pax(), v.baggage || S.settings.baggage)}
    </div>
    <div class="fields">
      <label class="f">Desde<select name="origins">${originOptions(v.origins)}</select></label>
      ${mode === 'days' ? `<label class="f">A dónde<div><input name="dest" placeholder="Ciudad, código o país… o «Cualquier destino»" value="${esc(v.destText || '')}" required></div></label>`
    : `<label class="f">Zona<select name="region"><option value="">Todo el mundo</option>${regions.map(([k, l]) => `<option value="${k}" ${v.region === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
      <label class="f">Cuándo<select name="when">
        <option value="any">Cualquier fecha (12 meses)</option>
        <option value="weekend" ${v.when === 'weekend' ? 'selected' : ''}>Fines de semana</option>
        ${monthOptions().map(([k, l]) => `<option value="m:${k}" ${v.when === 'm:' + k ? 'selected' : ''}>${l}</option>`).join('')}
        <option value="range" ${v.when === 'range' ? 'selected' : ''}>Fechas concretas…</option></select></label>
      <label class="f" data-nights>Noches<div class="row" style="flex-wrap:nowrap"><input name="min_nights" type="number" min="1" max="60" value="${v.min_nights}" style="width:70px"><span class="muted">–</span><input name="max_nights" type="number" min="1" max="60" value="${v.max_nights}" style="width:70px"></div></label>
      <button class="btn primary go" type="submit">${ic('search')} ${mode === 'days' ? 'Buscar' : 'Explorar'}</button>
    </div>
    <div class="grid-form" data-range style="margin-top:12px" hidden>
      <label class="f">Salida desde<input type="date" name="date_from" value="${esc(v.date_from || '')}"></label>
      <label class="f">Salida hasta<input type="date" name="date_to" value="${esc(v.date_to || '')}"></label>
      <label class="f" data-rt>Vuelta desde<input type="date" name="return_from" value="${esc(v.return_from || '')}"></label>
      <label class="f" data-rt>Vuelta hasta<input type="date" name="return_to" value="${esc(v.return_to || '')}"></label>
    </div>
    ${mode === 'explore' ? `<div style="margin-top:12px" class="chips" data-themes>
      <button type="button" class="chip ${!v.theme && !v.favorites ? 'on' : ''}" data-theme="">✨ Todo</button>
      <button type="button" class="chip ${v.favorites ? 'on' : ''}" data-theme="__fav">⭐ Mis destinos</button>
      ${themes.map(([k, t]) => `<button type="button" class="chip ${v.theme === k ? 'on' : ''}" data-theme="${k}">${t.icon} ${esc(t.label)}</button>`).join('')}</div>` : ''}
    ${compact ? '' : `<details class="more-filters" ${v.weekdays?.length || v.direct_only || v.max_price ? 'open' : ''}><summary class="small muted" style="cursor:pointer">${ic('filter')} Más filtros</summary>
      <div class="row" style="margin-top:10px;gap:18px">
        <div><div class="tiny muted" style="font-weight:700;margin-bottom:4px">SALIR SOLO EN</div><div class="weekdays" data-wd>${DOW1.map((d, i) => `<button type="button" data-d="${i}" class="${(v.weekdays || []).includes(i) ? 'on' : ''}">${d}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" name="direct_only" ${v.direct_only ? 'checked' : ''}> Solo vuelos directos</label>
        <label class="f" style="width:190px">Precio máx. / persona<input type="number" name="max_price" min="0" placeholder="${sym()}" value="${esc(v.max_price || '')}"></label>
      </div></details>`}
  </form>`;
  const form = $('form', root);
  const dest = $('[name=dest]', form);
  if (dest) attachAC(dest, { anywhere: true });
  const sync = () => {
    const trip = $('[data-trip] .on', form).dataset.t, when = form.when.value;
    $('[data-nights]', form).style.display = trip === 'rt' && when !== 'weekend' ? '' : 'none';
    $('[data-range]', form).hidden = when !== 'range';
    $$('[data-rt]', form).forEach((x) => (x.style.display = trip === 'rt' ? '' : 'none'));
  };
  $('[data-trip]', form).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; $$('[data-t]', form).forEach((x) => x.classList.toggle('on', x === b)); sync(); };
  form.when.onchange = sync;
  $('[data-wd]', form)?.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) b.classList.toggle('on'); });
  $('[data-themes]', form)?.addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (!b) return; $$('[data-theme]', form).forEach((x) => x.classList.toggle('on', x === b)); });
  sync();
  form.getParams = () => {
    const trip = $('[data-trip] .on', form).dataset.t, when = form.when.value;
    const pb = readPaxBag($('#pb', form));
    const p = { trip, origins: form.origins.value, pax: pb.pax, baggage: pb.baggage, mode };
    if (trip === 'rt') { p.min_nights = +form.min_nights.value || 1; p.max_nights = Math.max(p.min_nights, +form.max_nights.value || p.min_nights); }
    if (when.startsWith('m:')) {
      const [y, m] = when.slice(2).split('-').map(Number);
      p.date_from = `${when.slice(2)}-01`;
      p.date_to = `${when.slice(2)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    } else if (when === 'weekend') {
      p.trip = 'rt'; p.weekdays = [3, 4]; p.return_weekdays = [6, 0]; p.min_nights = 2; p.max_nights = 4;
    } else if (when === 'range') {
      ['date_from', 'date_to', 'return_from', 'return_to'].forEach((k) => { if (form[k].value) p[k] = form[k].value; });
    }
    if (!compact) {
      const wd = $$('[data-wd] .on', form).map((b) => +b.dataset.d);
      if (wd.length && when !== 'weekend') p.weekdays = wd;
      p.direct_only = form.direct_only.checked;
      if (form.max_price.value) p.max_price = +form.max_price.value;
    }
    if (mode === 'days') {
      const r = resolvePlace(dest.value);
      if (r.any) { p.mode = 'explore'; } else Object.assign(p, r);
      p.destText = dest.value;
    } else {
      p.region = form.region.value;
      const th = $('[data-themes] .on', form)?.dataset.theme || '';
      if (th === '__fav') p.favorites = true; else p.theme = th;
    }
    p.when = when;
    return p;
  };
  return form;
}
async function runSearch(params, box) {
  box.innerHTML = `<div class="card pad"><div class="row small muted" style="margin-bottom:8px"><span id="jobText">Buscando…</span></div><div class="progress"><div id="jobBar"></div></div></div><div class="loading"><div class="skel"></div><div class="skel"></div></div>`;
  let job = await api('/api/search', { method: 'POST', body: params });
  while (job.status === 'running') {
    const bar = $('#jobBar', box), txt = $('#jobText', box);
    if (bar) bar.style.width = `${job.total ? Math.max(5, (job.done / job.total) * 100) : 5}%`;
    if (txt) txt.textContent = `Buscando ${job.current || ''}… (${job.done}/${job.total} rutas)`;
    await new Promise((r) => setTimeout(r, 600));
    job = await api(`/api/search/${job.id}`);
  }
  if (job.status === 'error') throw new Error(job.error);
  return job.result;
}

/* =================== tarjetas =================== */
function dealCard(d, { showSpark = true } = {}) {
  const lvl = d.savings >= 0.3 ? 'hot' : d.savings >= 0.12 ? 'good' : 'neutral';
  const key = encodeURIComponent(JSON.stringify({ origin: d.origin, destination: d.destination, depart_date: d.depart_date, return_date: d.return_date, trip: d.trip }));
  return `<article class="card deal" data-open="${key}">
    <div class="band"></div>
    <div class="body">
      <div class="head">${flag(d.dest_cc || d.country_code || cityInfo(d.destination).country_code)}<div style="min-width:0"><div class="city">${esc(d.dest_name || d.name || cityName(d.destination))}</div>
        <div class="ctry">${esc(d.dest_country || d.country || '')} · desde ${esc(d.origin)}</div></div><span class="spacer"></span>
        ${d.savings > 0.05 ? `<span class="pill ${lvl}">${pct(d.savings)}</span>` : ''}</div>
      <div class="price">${money(d.price)} <small>/pers. ${d.trip === 'rt' ? 'i/v' : 'ida'}</small></div>
      <div class="meta"><span>${ic('calendar')} ${esc(dshort(d.depart_date))}${d.return_date ? ` → ${esc(dshort(d.return_date))} · ${d.nights} n.` : ''}</span><span>${esc(stops(d.transfers))}</span><span>${esc(d.airline_name || '')}</span></div>
      ${d.baggage && (d.baggage.option !== 'personal' || (d.pax || 1) > 1) ? `<div class="small"><b>${money(d.price_total)}</b> <span class="muted">total${(d.pax || 1) > 1 ? ` · ${d.pax} pers.` : ''}${d.baggage.option !== 'personal' ? ' · con equipaje' : ''}</span></div>` : ''}
      ${bagLine(d.baggage)}
      ${showSpark && d.spark && d.spark.length > 2 ? `<div title="Mínimo de cada mes">${sparkline(d.spark)}</div>` : ''}
    </div>
    <div class="foot">${d.median ? `Habitual ${money(d.median)}` : ''}<span class="spacer"></span>Ver detalle →</div>
  </article>`;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-open]');
  if (c && !e.target.closest('a,button:not([data-open])')) {
    const base = JSON.parse(decodeURIComponent(c.dataset.open));
    const full = (S.last.options || []).find((o) => o.origin === base.origin && o.destination === base.destination && o.depart_date === base.depart_date && (o.return_date || null) === (base.return_date || null));
    openDetail(full || base);
  }
});
function remember(list) { S.last.options = [...(S.last.options || []).slice(-300), ...list]; }

/* =================== INICIO =================== */
VIEWS.home = async (el) => {
  const s = S.status || await refreshStatus();
  const trips = s.trips; S.homeTrip = S.homeTrip && trips.includes(S.homeTrip) ? S.homeTrip : trips[trips.length - 1];
  el.innerHTML = `
    ${s.provider === 'demo' ? `<div class="banner info">${ic('zap')}<div><b>Modo demo:</b> precios simulados con un modelo realista. Añade tu token gratuito de Travelpayouts en <a href="#settings">Ajustes</a> para usar precios reales.</div></div>` : ''}
    <div class="hero"><h1>¿A dónde quieres volar?</h1><p class="sub">Encuentra el día más barato, explora destinos y recibe avisos antes que nadie.</p><div id="homeSearch"></div></div>
    <div class="kpis">
      <div class="card kpi"><div class="v">${s.destinations}</div><div class="l">destinos vigilados</div></div>
      <div class="card kpi"><div class="v">${s.origins.length}</div><div class="l">aeropuertos de salida</div></div>
      <div class="card kpi"><div class="v">${s.watches}</div><div class="l">vuelos concretos vigilados</div></div>
      <div class="card kpi"><div class="v">${s.unread_alerts}</div><div class="l">alertas sin leer</div></div>
    </div>
    <div class="section"><div class="section-head"><div><h2>🔥 Chollos en tus destinos</h2><p class="muted small">El precio más barato de cada destino favorito, comparado con su precio habitual del año.</p></div>
      ${trips.length > 1 ? `<div class="seg" id="homeTrip">${trips.map((t) => `<button data-t="${t}" class="${t === S.homeTrip ? 'on' : ''}">${tripLabel(t)}</button>`).join('')}</div>` : ''}</div>
      <div class="deals" id="homeDeals"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
    <div class="section"><div class="section-head"><div><h2>🗓️ Próximos puentes</h2><p class="muted small">Aprovecha los festivos: te buscamos la escapada más barata.</p></div><a href="#holidays" class="btn sm">Ver todos</a></div>
      <div class="holidays" id="homeHol"></div></div>
    <div class="section two">
      <div><div class="section-head"><h2>Cambios de precio</h2></div><div class="list" id="homeChanges"></div></div>
      <div><div class="section-head"><h2>Últimas alertas</h2><a href="#alerts" class="small">Ver todas</a></div><div class="list" id="homeAlerts"></div></div>
    </div>`;
  const f = searchForm($('#homeSearch'), { compact: true });
  f.onsubmit = (e) => { e.preventDefault(); const p = f.getParams(); if (p.mode === 'explore') go('explore', { params: p }); else go('search', { params: p }); };
  $('#homeTrip')?.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { S.homeTrip = b.dataset.t; route(true); } });
  const [deals, changes, alerts, hol] = await Promise.all([api(`/api/deals?trip=${S.homeTrip}`), api('/api/changes?limit=8'), api('/api/alerts?limit=6'), api('/api/holidays')]);
  remember(deals);
  $('#homeDeals').innerHTML = deals.length ? deals.map((d) => dealCard(d)).join('')
    : `<div class="card empty" style="grid-column:1/-1"><div class="big">✈️</div><h3>${s.destinations ? 'Aún no hay precios' : 'Añade tus destinos favoritos'}</h3>
      <p>${s.destinations ? 'Pulsa «Escanear ahora» para buscar precios de tus destinos.' : 'Elige ciudades o países y vigilaremos cada día del año.'}</p>
      ${s.destinations ? '<button class="btn primary" onclick="startScan()">Escanear ahora</button>' : '<a class="btn primary" href="#destinations">Añadir destinos</a>'}</div>`;
  $('#homeHol').innerHTML = hol.items.slice(0, 3).map(holCard).join('') || '<p class="muted small">No hay festivos próximos.</p>';
  $('#homeChanges').innerHTML = changes.length ? changes.map((c) => `
    <div class="card item" data-open="${encodeURIComponent(JSON.stringify({ origin: c.origin, destination: c.destination, depart_date: c.depart_date, trip: c.trip }))}" style="cursor:pointer">
      ${flag(cityInfo(c.destination).country_code)}<div class="grow"><div class="title">${esc(c.origin)} → ${esc(c.name)} <span class="muted small">· ${tripLabel(c.trip)}</span></div>
      <div class="small muted">${esc(c.date_label)} · ${money(c.prev_price)} → <b style="color:var(--ink)">${money(c.price)}</b> · ${ago(c.seen_at)}</div></div>
      <span class="delta ${c.pct < 0 ? 'down' : 'up'}">${c.pct < 0 ? '▼' : '▲'} ${Math.abs(c.pct).toFixed(0)}%</span></div>`).join('')
    : '<div class="card empty small">Los cambios aparecen a partir del segundo escaneo.</div>';
  $('#homeAlerts').innerHTML = alerts.length ? alerts.map(alertItem).join('') : '<div class="card empty small">Sin alertas todavía.</div>';
  if (!s.onboarded) onboarding();
};

/* =================== MEJOR DÍA =================== */
VIEWS.search = (el) => {
  const pend = S.pending?.view === 'search' ? S.pending.params : null; S.pending = null;
  el.innerHTML = `<div class="page-head"><div><h1>¿Qué día sale más barato?</h1><p>Elige origen y destino (ciudad o país entero). Miramos todos los días del periodo y te decimos cuándo volar.</p></div></div>
    <div id="sForm"></div><div id="sRes" class="section"></div>`;
  const f = searchForm($('#sForm'), { values: pend || S.lastSearch || {} });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const p = f.getParams(); S.lastSearch = p;
    if (p.mode === 'explore') { go('explore', { params: p }); return; }
    if (!p.destinations && !p.country) { toast('Elige un destino de la lista (o escribe un código de 3 letras).'); return; }
    try { renderDays($('#sRes'), await runSearch(p, $('#sRes'))); } catch (err) { $('#sRes').innerHTML = `<div class="card empty"><h3>No se pudo buscar</h3><p>${esc(err.message)}</p></div>`; }
  };
  if (pend) f.requestSubmit();
};
function renderDays(box, r) {
  if (!r.found) { box.innerHTML = `<div class="card empty"><div class="big">🔎</div><h3>Sin resultados</h3><p>${esc(r.error || 'No hay precios para esa combinación. Prueba con más noches, otras fechas o sin filtros.')}</p>${(r.errors || []).length ? `<p class="small">${esc(r.errors[0])}</p>` : ''}</div>`; return; }
  const b = r.best, a = r.advice, P = r.params;
  remember([b, ...r.top, ...r.by_month]);
  const key = encodeURIComponent(JSON.stringify({ origin: b.origin, destination: b.destination, depart_date: b.depart_date, return_date: b.return_date, trip: b.trip }));
  box.innerHTML = `
  <div class="card result-hero">
    <div class="l">
      <div class="row">${flag(b.dest_cc)}<span class="muted small">Opción más barata · ${tripLabel(b.trip)}${P.pax > 1 ? ` · ${P.pax} personas` : ''}</span></div>
      <div class="bigprice" style="margin-top:8px">${money(b.price)} <span class="small muted" style="font-size:1rem;font-weight:600">/pers.</span></div>
      <p style="margin:8px 0 4px;font-size:1.05rem"><b>${esc(dlong(b.depart_date))}</b>${b.return_date ? `<br>vuelta <b>${esc(dlong(b.return_date))}</b> · ${b.nights} noches` : ''}</p>
      <p class="muted" style="margin:0 0 10px">${esc(b.origin_name)} (${esc(b.origin)}) → ${esc(b.dest_name)} (${esc(b.destination)}) · ${esc(stops(b.transfers))} · ${esc(b.airline_name)}</p>
      ${bagLine(b.baggage)}
      <p style="margin:10px 0"><b>Total estimado: ${money(b.price_total)}</b> <span class="muted small">${P.pax > 1 ? `(${P.pax} personas)` : ''}${P.baggage !== 'personal' ? ' con equipaje' : ''} · mediana del periodo ${money(r.median)}${b.savings > 0 ? ` · <span style="color:var(--good);font-weight:700">${pct(b.savings)}</span>` : ''}</span></p>
      <div class="row"><button class="btn primary" data-open="${key}">Ver detalle y reservar</button><button class="btn" id="exportRes">${ic('download')} CSV</button></div>
    </div>
    <div class="r"><div class="verdict ${a.level}">${a.level === 'buy' || a.level === 'good' ? '✅' : a.level === 'watch' ? '👀' : '⏳'} ${esc(a.verdict)}</div>
      <ul class="reasons">${a.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="tiny muted" style="margin-top:12px">Consejo orientativo: se basa en los precios del periodo, el histórico registrado y patrones típicos de antelación.${r.provider === 'demo' ? ' <b>Datos simulados (modo demo).</b>' : ''}</p></div>
  </div>
  <div class="tabs" id="resTabs"><button data-t="cal" class="on">Precio por día</button>${r.matrix ? '<button data-t="flex">Flexibilidad (noches)</button>' : ''}<button data-t="top">Mejores opciones</button><button data-t="month">Por meses</button>${r.by_destination.length > 1 ? '<button data-t="dest">Por destino</button>' : ''}</div>
  <div id="resPane"></div>`;
  const panes = {
    cal: (p) => {
      const prices = r.days.map((d) => d.price).sort((x, y) => x - y), lo = prices[0], hi = prices[prices.length - 1], med = prices[Math.floor(prices.length / 2)];
      p.innerHTML = `<div class="card pad"><div class="row"><div class="legend"><span>barato</span><span class="scale"></span><span>caro</span></div><span class="spacer"></span><span class="small muted">Pulsa una barra para ver el detalle</span></div><div id="yc" style="margin-top:8px"></div></div>`;
      chart($('#yc'), [{ name: '', color: 'var(--series-1)', data: r.days.map((d) => ({ x: d.date, y: d.price, d, color: priceColor(d.price, med, lo, hi).bg })) }],
        { bars: true, height: 260, xFmt: (x, full) => (full ? dlong(x) : MON3[+x.slice(5, 7) - 1]), tipFmt: (pt) => `<b>${money(pt.y)}</b> · ${esc(pt.d.origin)}→${esc(pt.d.destination)}${pt.d.return_date ? `<br>vuelta ${esc(dshort(pt.d.return_date))} (${pt.d.nights} n.)` : ''}`,
          onClick: (x) => { const d = r.days.find((q) => q.date === x); if (d) openDetail({ origin: d.origin, destination: d.destination, depart_date: d.date, return_date: d.return_date, trip: P.trip, price: d.price, pax: P.pax, baggage: { option: P.baggage } }); } });
    },
    flex: (p) => {
      const nights = [...new Set(r.matrix.map((c) => c.nights))].sort((x, y) => x - y);
      const weeks = {}; r.matrix.forEach((c) => { const d = d8(c.date); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = mon.toISOString().slice(0, 10); const kk = `${k}|${c.nights}`; if (!weeks[kk] || c.price < weeks[kk].price) weeks[kk] = c; });
      const wk = [...new Set(Object.keys(weeks).map((k) => k.split('|')[0]))].sort();
      const all = Object.values(weeks).map((c) => c.price).sort((x, y) => x - y), lo = all[0], hi = all[all.length - 1], med = all[Math.floor(all.length / 2)];
      let h = `<div class="card pad"><p class="small muted" style="margin-top:0">Mejor precio por semana de salida (filas) y número de noches (columnas). Pulsa una celda para ver el vuelo.</p><div style="overflow-x:auto"><div class="matrix" style="grid-template-columns:110px repeat(${nights.length},minmax(44px,1fr));min-width:${110 + nights.length * 46}px"><div class="h">Semana del</div>${nights.map((n) => `<div class="h">${n} n.</div>`).join('')}`;
      wk.forEach((w) => { h += `<div class="h" style="text-align:left">${esc(dshort(w))}</div>`; nights.forEach((n) => { const c = weeks[`${w}|${n}`]; if (!c) { h += '<div class="c none">·</div>'; return; } const col = priceColor(c.price, med, lo, hi); h += `<div class="c" style="background:${col.bg};color:${col.fg}" title="${esc(dlong(c.date))}" data-mx="${c.date}|${n}|${c.price}">${Math.round(c.price)}</div>`; }); });
      p.innerHTML = h + '</div></div></div>';
      p.onclick = (e) => { const c = e.target.closest('[data-mx]'); if (!c) return; const [d, n, pr] = c.dataset.mx.split('|'); openDetail({ origin: b.origin, destination: b.destination, depart_date: d, return_date: addDays(d, +n), trip: 'rt', price: +pr, pax: P.pax, baggage: { option: P.baggage }, long_haul: b.long_haul }); };
    },
    top: (p) => {
      p.innerHTML = `<div class="list">${r.top.map((o, i) => optRow(o, i)).join('')}</div>`;
    },
    month: (p) => {
      p.innerHTML = `<div class="card pad"><div id="mc"></div></div><div class="list" style="margin-top:12px">${r.by_month.map((o) => optRow(o)).join('')}</div>`;
      const pr = r.by_month.map((m) => m.price).sort((x, y) => x - y), med = pr[Math.floor(pr.length / 2)];
      chart($('#mc'), [{ name: '', color: 'var(--series-1)', data: r.by_month.map((m) => ({ x: m.depart_date.slice(0, 7), y: m.price, color: priceColor(m.price, med, pr[0], pr[pr.length - 1]).bg, m })) }],
        { bars: true, height: 220, xFmt: (x, full) => (full ? `${MONTHS[+x.slice(5, 7) - 1]} ${x.slice(0, 4)}` : MON3[+x.slice(5, 7) - 1]), tipFmt: (pt) => `<b>${money(pt.y)}</b> · ${esc(dshort(pt.m.depart_date))}` });
    },
    dest: (p) => { p.innerHTML = `<div class="deals">${r.by_destination.map((d) => dealCard(d, { showSpark: false })).join('')}</div>`; remember(r.by_destination); },
  };
  const show = (t) => { $$('#resTabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); panes[t]($('#resPane')); };
  $('#resTabs').onclick = (e) => { const t = e.target.closest('[data-t]'); if (t) show(t.dataset.t); };
  show('cal');
  $('#exportRes').onclick = () => download('mejores_fechas.csv', toCSV(r.top, [['salida', (o) => o.depart_date], ['vuelta', (o) => o.return_date || ''], ['origen', (o) => o.origin], ['destino', (o) => o.destination], ['precio_persona', (o) => o.price], ['total_estimado', (o) => o.price_total], ['aerolinea', (o) => o.airline_name], ['escalas', (o) => o.transfers], ['enlace', (o) => o.links.aviasales]]), 'text/csv');
}
function optRow(o, i) {
  const key = encodeURIComponent(JSON.stringify({ origin: o.origin, destination: o.destination, depart_date: o.depart_date, return_date: o.return_date, trip: o.trip }));
  return `<div class="card opt" data-open="${key}">${flag(o.dest_cc)}
    <div><div class="when">${i === 0 ? '🥇 ' : ''}${esc(dshort(o.depart_date))}${o.return_date ? ` → ${esc(dshort(o.return_date))} <span class="muted small">(${o.nights} noches)</span>` : ''}</div>
    <div class="small muted">${esc(o.origin)} → ${esc(o.dest_name)} · ${esc(stops(o.transfers))} · ${esc(o.airline_name)} · 🧳 ${BAG_ICON[o.baggage.cabin]} 🛄 ${BAG_ICON[o.baggage.checked]}</div></div>
    <div class="p"><b>${money(o.price)}</b><div class="tiny muted">total ${money(o.price_total)}</div>${o.level ? `<span class="pill ${LEVEL[o.level][1]}">${LEVEL[o.level][0]}</span>` : ''}</div></div>`;
}

/* =================== EXPLORAR =================== */
VIEWS.explore = (el) => {
  const pend = S.pending?.view === 'explore' ? S.pending.params : null; S.pending = null;
  el.innerHTML = `<div class="page-head"><div><h1>Explorar: ¿a dónde puedo ir barato?</h1><p>Busca en decenas de destinos a la vez y compáralos en un mapa. Ideal si solo sabes cuándo y cuánto quieres gastar.</p></div></div>
    <div id="eForm"></div><div id="eRes" class="section"></div>`;
  const vals = pend ? { ...pend, theme: pend.theme || '' } : (S.lastExplore || {});
  const f = searchForm($('#eForm'), { mode: 'explore', values: vals });
  f.onsubmit = async (e) => {
    e.preventDefault(); const p = f.getParams(); p.mode = 'explore'; S.lastExplore = p;
    try { renderExplore($('#eRes'), await runSearch(p, $('#eRes'))); } catch (err) { $('#eRes').innerHTML = `<div class="card empty"><h3>No se pudo explorar</h3><p>${esc(err.message)}</p></div>`; }
  };
  if (pend) f.requestSubmit();
};
function renderExplore(box, r) {
  if (!r.found) { box.innerHTML = `<div class="card empty"><div class="big">🧭</div><h3>Sin resultados</h3><p>${esc(r.error || 'Prueba con otra zona, más noches o sin presupuesto máximo.')}</p></div>`; return; }
  const list = r.by_destination; remember(list);
  box.innerHTML = `<div class="section-head"><div><h2>${list.length} destinos encontrados</h2><p class="muted small">Ordenados por precio total estimado${r.params.pax > 1 ? ` para ${r.params.pax} personas` : ''}${r.params.baggage !== 'personal' ? ' con equipaje' : ''}.</p></div>
    <div class="row"><button class="btn sm" id="exFav">${ic('star')} Añadir los 5 primeros a mis destinos</button><button class="btn sm" id="exCsv">${ic('download')} CSV</button></div></div>
    <div id="map" class="card"></div>
    <div class="deals section">${list.map((d) => dealCard(d, { showSpark: false })).join('')}</div>`;
  loadMap(list);
  $('#exFav').onclick = async () => { await api('/api/destinations', { method: 'POST', body: { codes: list.slice(0, 5).map((d) => d.destination) } }); toast('⭐ Añadidos a tus destinos'); };
  $('#exCsv').onclick = () => download('explorar.csv', toCSV(list, [['destino', (o) => o.dest_name], ['pais', (o) => o.dest_country], ['origen', (o) => o.origin], ['salida', (o) => o.depart_date], ['vuelta', (o) => o.return_date || ''], ['precio_persona', (o) => o.price], ['total_estimado', (o) => o.price_total], ['aerolinea', (o) => o.airline_name]]), 'text/csv');
}
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, ko) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'; js.onload = ok; js.onerror = ko; document.head.appendChild(js);
  });
}
async function loadMap(list) {
  try { await loadLeaflet(); } catch (e) { $('#map').innerHTML = '<p class="muted pad">No se pudo cargar el mapa (sin conexión).</p>'; return; }
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const map = L.map('map', { worldCopyJump: true, scrollWheelZoom: false });
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`, { attribution: '© OpenStreetMap · © CARTO', maxZoom: 10 }).addTo(map);
  const pts = [];
  list.filter((d) => d.lat != null).forEach((d, i) => {
    const icon = L.divIcon({ className: '', html: `<span class="price-marker ${i < 3 ? 'top' : ''}">${Math.round(d.price)}${sym()}</span>`, iconSize: null });
    L.marker([d.lat, d.lon], { icon, zIndexOffset: 1000 - i }).addTo(map).on('click', () => openDetail(d))
      .bindTooltip(`${d.dest_name}: ${money(d.price)} · ${dshort(d.depart_date)}`);
    pts.push([d.lat, d.lon]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 5 }); else map.setView([40, 0], 3);
}

/* =================== FESTIVOS =================== */
function holCard(h) {
  return `<div class="card hol"><div class="row"><span class="pill ${h.days_off === 0 ? 'good' : h.days_off === 1 ? 'brand' : 'neutral'}">${h.days_off === 0 ? 'Sin pedir días' : `Pide ${h.days_off} día${h.days_off > 1 ? 's' : ''}`}</span><span class="pill neutral">${h.days} días libres</span></div>
    <h3>${esc(h.title)}</h3><div class="dates">${esc(dshort(h.start))} → ${esc(dshort(h.end))} <span class="muted small">${d8(h.start).getFullYear()}</span></div>
    <div class="row"><button class="btn sm primary" data-hol='${esc(JSON.stringify(h))}'>${ic('search')} Buscar escapadas</button></div><div class="res"></div></div>`;
}
async function searchHoliday(btn) {
  const h = JSON.parse(btn.dataset.hol), card = btn.closest('.hol'), res = $('.res', card);
  const target = $('#holTarget')?.value || 'fav';
  const params = { mode: 'explore', trip: 'rt', origins: $('#holOrigin')?.value || 'mine', date_from: addDays(h.start, -1), date_to: h.start, return_from: h.end, return_to: addDays(h.end, 1), min_nights: Math.max(1, h.days - 2), max_nights: h.days + 1, pax: pax(), baggage: S.settings.baggage };
  if (target === 'fav') params.favorites = true; else params.theme = target === 'all' ? '' : target;
  btn.disabled = true; res.innerHTML = '<div class="progress"><div style="width:40%"></div></div>';
  try {
    const r = await runSearch(params, res);
    if (!r.found) { res.innerHTML = `<p class="small muted">${esc(r.error || 'Sin vuelos para esas fechas.')}</p>`; return; }
    remember(r.by_destination);
    res.innerHTML = r.by_destination.slice(0, 6).map((d) => `<div class="r" data-open="${encodeURIComponent(JSON.stringify({ origin: d.origin, destination: d.destination, depart_date: d.depart_date, return_date: d.return_date, trip: 'rt' }))}">${flag(d.dest_cc)}<b>${esc(d.dest_name)}</b><span class="muted small">${esc(dshort(d.depart_date))}→${esc(dshort(d.return_date))}</span><span class="spacer"></span><b>${money(d.price)}</b></div>`).join('');
  } catch (e) { res.innerHTML = `<p class="small" style="color:var(--bad)">${esc(e.message)}</p>`; }
  btn.disabled = false;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-hol]'); if (b) { e.preventDefault(); if (S.view !== 'holidays') { S.holAuto = b.dataset.hol; go('holidays'); } else searchHoliday(b); } });
VIEWS.holidays = async (el) => {
  const regions = S.meta.holiday_regions;
  el.innerHTML = `<div class="page-head"><div><h1>Puentes y festivos</h1><p>Tus próximos días libres y cuántos días de vacaciones necesitas pedir. Pulsa «Buscar escapadas» y te decimos el destino más barato para esas fechas (ida y vuelta).</p></div></div>
    <div class="card pad grid-form">
      <label class="f">Comunidad<select id="holRegion">${Object.entries(regions).map(([k, v]) => `<option value="${k}" ${S.settings.holiday_region === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="f">Salgo desde<select id="holOrigin">${originOptions('mine')}</select></label>
      <label class="f">Buscar en<select id="holTarget"><option value="fav">Mis destinos favoritos</option><option value="barato">Low cost cerca</option><option value="playa">Playa</option><option value="ciudad">Escapadas urbanas</option><option value="naturaleza">Naturaleza</option><option value="all">Todo el catálogo</option></select></label>
    </div>
    <p class="tiny muted">Festivos nacionales y autonómicos habituales. Los locales y algunos autonómicos cambian cada año: revisa el calendario oficial.</p>
    <div class="holidays section" id="holList"></div>`;
  const load = async () => {
    const r = await api(`/api/holidays?region=${$('#holRegion').value}`);
    $('#holList').innerHTML = r.items.map(holCard).join('') || '<div class="card empty">No hay festivos próximos.</div>';
    paintIcons($('#holList'));
    if (S.holAuto) { const h = JSON.parse(S.holAuto); S.holAuto = null; const b = $$('#holList [data-hol]').find((x) => JSON.parse(x.dataset.hol).start === h.start); if (b) { b.scrollIntoView({ block: 'center' }); searchHoliday(b); } }
  };
  $('#holRegion').onchange = async () => { await api('/api/settings', { method: 'PUT', body: { holiday_region: $('#holRegion').value } }); S.settings.holiday_region = $('#holRegion').value; load(); };
  load();
};

/* =================== CALENDARIO =================== */
VIEWS.calendar = async (el) => {
  const dests = await api('/api/destinations'); S.destinations = dests;
  const trips = S.status.trips;
  const c = S.calSel || { o: S.settings.origins[0], d: dests[0]?.code, t: trips[trips.length - 1] };
  el.innerHTML = `<div class="page-head"><div><h1>Calendario de precios</h1><p>El precio más barato de cada día de los próximos 12 meses para una ruta. Pulsa un día para ver detalle, equipaje y reservar.</p></div></div>
    <div class="card pad row">
      <label class="f" style="min-width:180px">Origen<select id="cO">${S.settings.origins.map((o) => `<option value="${o}" ${o === c.o ? 'selected' : ''}>${esc(cityName(o))} (${o})</option>`).join('')}</select></label>
      <label class="f" style="min-width:200px">Destino<select id="cD">${dests.map((d) => `<option value="${d.code}" ${d.code === c.d ? 'selected' : ''}>${esc(d.name)} (${d.code})</option>`).join('')}</select></label>
      <div class="seg" id="cT">${['rt', 'ow'].map((t) => `<button data-t="${t}" class="${t === c.t ? 'on' : ''}">${tripLabel(t)}</button>`).join('')}</div>
      <span class="spacer"></span><div class="legend"><span>barato</span><span class="scale"></span><span>caro</span></div>
      <a class="btn sm" id="cCsv">${ic('download')} CSV</a>
    </div>
    <div id="cSum" class="section"></div><div class="months section" id="cGrid"></div>
    <div class="section card pad"><div class="section-head"><h2>Evolución del precio de la ruta</h2><div class="chart-legend"><span><i style="background:var(--series-1)"></i>Mínimo del año</span><span><i style="background:var(--series-muted)"></i>Precio mediano</span></div></div><div id="cHist"></div></div>`;
  if (!dests.length) { $('#cGrid').innerHTML = '<div class="card empty">Añade destinos primero.</div>'; return; }
  const draw = async () => {
    const o = $('#cO').value, d = $('#cD').value, t = $('#cT .on').dataset.t; S.calSel = { o, d, t };
    $('#cCsv').href = `/api/export/calendar.csv?origin=${o}&destination=${d}&trip=${t}`;
    const [cal, hist] = await Promise.all([api(`/api/calendar?origin=${o}&destination=${d}&trip=${t}`), api(`/api/history?origin=${o}&destination=${d}&trip=${t}`)]);
    remember(cal.quotes.map((q) => ({ ...q, median: cal.median })));
    const by = new Map(cal.quotes.map((q) => [q.depart_date, q]));
    const pr = cal.quotes.map((q) => q.price).sort((a, b) => a - b);
    const lo = pr[Math.floor(pr.length * 0.03)] ?? 0, hi = pr[Math.floor(pr.length * 0.97)] ?? 1, med = cal.median;
    const best = cal.quotes.reduce((m, q) => (!m || q.price < m.price ? q : m), null);
    $('#cSum').innerHTML = best ? `<div class="card pad row">${flag(cal.destination.country_code)}<div class="grow"><b>${esc(o)} → ${esc(cal.destination.name)}</b> · ${tripLabel(t)}<br>
      <span class="muted small">Día más barato: <a href="#" data-open="${encodeURIComponent(JSON.stringify({ origin: o, destination: d, depart_date: best.depart_date, return_date: best.return_date, trip: t }))}"><b>${esc(dlong(best.depart_date))}</b></a> por <b>${money(best.price)}</b> · habitual ${money(med)} · rango ${money(cal.min)}–${money(cal.max)} · ${cal.quotes.length} días con precio</span></div>
      <button class="btn sm" id="cBest">${ic('search')} Mejor día con filtros</button></div>`
      : `<div class="card empty"><h3>Sin precios de ${tripLabel(t).toLowerCase()} para esta ruta</h3><p>${S.status.trips.includes(t) ? 'Pulsa «Escanear ahora».' : `Los escaneos automáticos no vigilan «${tripLabel(t)}». Cámbialo en Ajustes o usa «Mejor día».`}</p></div>`;
    $('#cBest')?.addEventListener('click', () => go('search', { params: { trip: t, origins: o, destText: `${cityName(d)} (${d})` } }));
    const now = new Date(); let h = '';
    for (let k = 0; k < 13; k++) {
      const f = new Date(now.getFullYear(), now.getMonth() + k, 1), y = f.getFullYear(), m = f.getMonth(), n = new Date(y, m + 1, 0).getDate();
      let cells = DOW1.map((x) => `<div class="dow">${x}</div>`).join('') + '<div></div>'.repeat((f.getDay() + 6) % 7); const mp = [];
      for (let dd = 1; dd <= n; dd++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, q = by.get(iso);
        if (!q) { cells += `<div class="day none"><span class="n">${dd}</span></div>`; continue; }
        mp.push(q.price); const col = priceColor(Math.min(Math.max(q.price, lo), hi), med, lo, hi);
        const ch = q.prev_price && Math.abs(q.price / q.prev_price - 1) >= 0.05 ? (q.price < q.prev_price ? '▼' : '▲') : '';
        cells += `<div class="day ${best.depart_date === iso ? 'best' : ''}" style="background:${col.bg};color:${col.fg}" title="${esc(dlong(iso))}: ${money(q.price)}${q.return_date ? ` · vuelta ${dshort(q.return_date)} (${q.nights} n.)` : ''}${ch ? ` · ${ch} antes ${money(q.prev_price)}` : ''}" data-open="${encodeURIComponent(JSON.stringify({ origin: o, destination: d, depart_date: iso, return_date: q.return_date, trip: t }))}"><span class="n">${dd}</span><span class="p">${Math.round(q.price)}</span>${ch ? `<span class="dot">${ch}</span>` : ''}</div>`;
      }
      if (k === 12 && !mp.length) break;
      h += `<div class="card month"><h4><span>${MONTHS[m]} ${y}</span><span class="muted small">${mp.length ? 'desde ' + money(Math.min(...mp)) : ''}</span></h4><div class="grid">${cells}</div></div>`;
    }
    $('#cGrid').innerHTML = cal.quotes.length ? h : '';
    chart($('#cHist'), [
      { name: 'Mínimo', color: 'var(--series-1)', data: hist.map((x) => ({ x: x.scanned_at.slice(0, 16), y: x.min_price })) },
      { name: 'Mediana', color: 'var(--series-muted)', dash: true, data: hist.map((x) => ({ x: x.scanned_at.slice(0, 16), y: x.median_price })) },
    ], { xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
  };
  $('#cO').onchange = draw; $('#cD').onchange = draw;
  $('#cT').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { $$('#cT button').forEach((x) => x.classList.toggle('on', x === b)); draw(); } };
  draw();
};

/* =================== VIGILADOS =================== */
VIEWS.watches = async (el) => {
  const ws = await api('/api/watches');
  el.innerHTML = `<div class="page-head"><div><h1>Vuelos vigilados</h1><p>Fechas concretas que sigues de cerca. Te avisamos si el precio sube o baja (umbral en Ajustes) o si baja de tu precio objetivo.</p></div></div>
  ${ws.length ? `<div class="list">${ws.map((w) => {
    const diff = w.current_price != null && w.last_price != null ? w.current_price - w.last_price : 0;
    const key = encodeURIComponent(JSON.stringify({ origin: w.origin, destination: w.destination, depart_date: w.depart_date, return_date: w.return_date || null, trip: w.trip }));
    return `<div class="card item" style="flex-wrap:wrap">${flag(cityInfo(w.destination).country_code)}
      <div class="grow" style="min-width:220px"><div class="title">${esc(w.origin)} → ${esc(w.name)} <span class="pill neutral">${tripLabel(w.trip)}</span></div>
        <div class="small muted">${esc(w.date_label)}${w.return_label ? ` → ${esc(w.return_label)}` : ''} · añadido ${ago(w.created_at)}</div></div>
      <div style="width:140px">${sparkline(w.history, 140, 28)}</div>
      <div style="text-align:right;min-width:110px"><div style="font-size:1.2rem;font-weight:800">${money(w.current_price)}</div>${diff ? `<span class="delta ${diff < 0 ? 'down' : 'up'}">${diff < 0 ? '▼' : '▲'} ${money(Math.abs(diff))}</span>` : '<span class="tiny muted">sin cambios</span>'}</div>
      <label class="f" style="width:130px">Objetivo<input type="number" min="0" value="${w.target_price ?? ''}" data-wt="${w.id}" placeholder="${sym()}"></label>
      <div class="row"><button class="btn sm" data-open="${key}">Detalle</button><a class="btn sm" href="${esc(w.links.aviasales)}" target="_blank" rel="noopener">Reservar</a><button class="btn sm ghost danger" data-unwatch="${w.id}" title="Dejar de vigilar">${ic('trash')}</button></div></div>`;
  }).join('')}</div>` : `<div class="card empty"><div class="big">👀</div><h3>No vigilas ningún vuelo concreto</h3><p>Abre cualquier vuelo (calendario, Mejor día, Explorar…) y pulsa «Vigilar este vuelo».</p></div>`}`;
  el.onchange = async (e) => { const t = e.target.closest('[data-wt]'); if (t) { await api(`/api/watches/${t.dataset.wt}`, { method: 'PATCH', body: { target_price: t.value } }); toast('Precio objetivo guardado'); } };
  el.onclick = async (e) => { const u = e.target.closest('[data-unwatch]'); if (u) { await api(`/api/watches/${u.dataset.unwatch}`, { method: 'DELETE' }); refreshStatus(); route(true); } };
};

/* =================== DESTINOS =================== */
VIEWS.destinations = async (el) => {
  const dests = await api('/api/destinations'); S.destinations = dests;
  const themes = Object.entries(S.meta.themes);
  el.innerHTML = `<div class="page-head"><div><h1>Mis destinos</h1><p>Los destinos que vigilamos cada día (desde todos tus aeropuertos). Pon un precio máximo y te avisamos en cuanto baje de ahí.</p></div></div>
    <div class="card pad"><div class="row">
      <div style="flex:1;min-width:240px"><input id="dIn" placeholder="Añade una ciudad o un país entero…"></div>
      <input id="dMax" type="number" min="0" placeholder="Precio máx. ${sym()} (opcional)" style="width:200px">
      <button class="btn primary" id="dAdd">${ic('plus')} Añadir</button></div>
      <div class="chips" style="margin-top:12px"><span class="small muted" style="align-self:center">Añadir de golpe:</span>${themes.map(([k, t]) => `<button class="chip" data-addtheme="${k}">${t.icon} ${esc(t.label)} (${t.count})</button>`).join('')}</div></div>
    <div class="section">${dests.length ? `<div class="table-wrap"><table><tr><th>Vigilar</th><th>Destino</th><th>Precio máx.</th><th>Mejor ida</th><th>Mejor i/v</th><th>Días</th><th></th></tr>
      ${dests.map((d) => `<tr><td><input type="checkbox" data-tg="${d.id}" ${d.enabled ? 'checked' : ''}></td>
        <td><div class="row" style="flex-wrap:nowrap">${flag(d.country_code)}<div><b>${esc(d.name)}</b> <span class="muted small">${esc(d.code)}</span><div class="tiny muted">${esc(d.country)}</div></div></div></td>
        <td><input type="number" min="0" value="${d.max_price ?? ''}" data-mx="${d.id}" placeholder="—"></td>
        <td>${money(d.best_ow)}</td><td>${money(d.best_rt)}</td><td>${d.days}</td>
        <td class="nowrap"><a href="#" data-cal="${d.code}">calendario</a> · <a href="#" data-bd="${d.code}">mejor día</a> · <a href="#" data-del="${d.id}" style="color:var(--bad)">quitar</a></td></tr>`).join('')}</table></div>`
    : '<div class="card empty"><div class="big">⭐</div><h3>Aún no tienes destinos</h3><p>Añade ciudades o países arriba, o pulsa una de las temáticas.</p></div>'}</div>`;
  attachAC($('#dIn'));
  $('#dAdd').onclick = async () => {
    const r = resolvePlace($('#dIn').value);
    try {
      if (r.country) await api('/api/destinations/country', { method: 'POST', body: { country_code: r.country } });
      else if (r.destinations) await api('/api/destinations', { method: 'POST', body: { code: r.destinations[0], max_price: $('#dMax').value } });
      else throw new Error('Elige un destino de la lista');
      toast('⭐ Añadido. Entrará en el próximo escaneo.'); route(true);
    } catch (e) { toast(e.message); }
  };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-addtheme]'); if (t) { await addTheme(t.dataset.addtheme); return; }
    if (t) { const codes = (await api('/api/catalog?limit=500')).length && null; const th = t.dataset.addtheme; await api('/api/search', { method: 'POST', body: {} }).catch(() => {}); await addTheme(th); return codes; }
    const del = e.target.closest('[data-del]'); if (del) { e.preventDefault(); await api(`/api/destinations/${del.dataset.del}`, { method: 'DELETE' }); route(true); }
    const cal = e.target.closest('[data-cal]'); if (cal) { e.preventDefault(); S.calSel = { o: S.settings.origins[0], d: cal.dataset.cal, t: S.status.trips[S.status.trips.length - 1] }; go('calendar'); }
    const bd = e.target.closest('[data-bd]'); if (bd) { e.preventDefault(); go('search', { params: { destText: `${cityName(bd.dataset.bd)} (${bd.dataset.bd})` } }); }
  };
  el.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.tg) await api(`/api/destinations/${t.dataset.tg}`, { method: 'PATCH', body: { enabled: t.checked } });
    if (t.dataset.mx) { await api(`/api/destinations/${t.dataset.mx}`, { method: 'PATCH', body: { max_price: t.value } }); toast('Precio máximo guardado'); }
  };
};
async function addTheme(th) {
  const t = S.meta.themes[th];
  if (!confirm(`¿Añadir los ${t.count} destinos de «${t.label}»? Más destinos = escaneos más largos.`)) return;
  const r = await api(`/api/themes/${th}`);
  await api('/api/destinations', { method: 'POST', body: { codes: r.codes } });
  toast('⭐ Destinos añadidos'); route(true);
}

/* =================== ALERTAS =================== */
function alertItem(a) {
  const [label, cls] = KIND[a.kind] || [a.kind, 'neutral'];
  const key = encodeURIComponent(JSON.stringify({ origin: a.origin, destination: a.destination, depart_date: a.depart_date, return_date: a.return_date, trip: a.trip }));
  return `<div class="card item ${a.read ? '' : 'unread'}">${flag(a.dest_cc)}<div class="grow"><div class="row" style="gap:6px"><span class="pill ${cls}">${esc(label)}</span><span class="tiny muted">${ago(a.created_at)}</span></div>
    <div class="small" style="margin-top:4px">${esc(a.message)}</div><div class="links"><a href="#" data-open="${key}">Ver detalle</a><a href="${esc(a.link || a.links.aviasales)}" target="_blank" rel="noopener">Reservar</a><a href="${esc(a.links.google)}" target="_blank" rel="noopener">Google Flights</a></div></div></div>`;
}
VIEWS.alerts = async (el) => {
  const alerts = await api('/api/alerts?limit=300');
  const kinds = [...new Set(alerts.map((a) => a.kind))];
  el.innerHTML = `<div class="page-head"><div><h1>Alertas</h1><p>Todo lo que hemos detectado para ti. Configura dónde recibirlas en Ajustes → Notificaciones.</p></div>
    <div class="row"><button class="btn sm" id="aRead">${ic('check')} Marcar leídas</button><button class="btn sm" id="aCsv">${ic('download')} CSV</button><button class="btn sm danger" id="aClear">${ic('trash')} Borrar</button></div></div>
    <div class="chips" id="aF"><button class="chip on" data-k="">Todas (${alerts.length})</button>${kinds.map((k) => `<button class="chip" data-k="${k}">${esc((KIND[k] || [k])[0])} (${alerts.filter((a) => a.kind === k).length})</button>`).join('')}</div>
    <div class="list section" id="aList"></div>`;
  const draw = (k) => { const l = alerts.filter((a) => !k || a.kind === k); $('#aList').innerHTML = l.length ? l.map(alertItem).join('') : '<div class="card empty"><div class="big">🔔</div><h3>Sin alertas</h3><p>Cuando detectemos chollos o bajadas aparecerán aquí.</p></div>'; };
  $('#aF').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { $$('#aF .chip').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.k); } };
  draw('');
  $('#aRead').onclick = async () => { await api('/api/alerts/read', { method: 'POST' }); refreshStatus(); route(true); };
  $('#aClear').onclick = async () => { if (confirm('¿Borrar todas las alertas?')) { await api('/api/alerts', { method: 'DELETE' }); refreshStatus(); route(true); } };
  $('#aCsv').onclick = () => download('alertas.csv', toCSV(alerts, [['fecha', (a) => a.created_at], ['tipo', (a) => a.kind_label], ['mensaje', (a) => a.message], ['enlace', (a) => a.link]]), 'text/csv');
};

/* =================== AJUSTES =================== */
VIEWS.settings = async (el) => {
  const s = await api('/api/settings'); S.settings = s; let origins = [...s.origins];
  const sel = (name, opts) => `<select name="${name}">${opts.map(([k, v]) => `<option value="${k}" ${String(s[name]) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const inp = (name, type = 'text', extra = '') => `<input name="${name}" type="${type}" value="${esc(s[name] ?? '')}" ${extra}>`;
  el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Todo se guarda en tu servidor. Los secretos se muestran enmascarados.</p></div></div>
  <form id="sf" autocomplete="off">
    <div class="card pad"><h2>✈️ Desde dónde sales</h2><p class="muted small">Aeropuertos de salida para los escaneos y búsquedas. Códigos IATA de ciudad (TCI = Tenerife, LON = todos los de Londres…).</p>
      <div class="chips" id="oChips"></div>
      <div class="row" style="margin-top:10px"><div style="flex:1;min-width:220px"><input id="oIn" placeholder="Añadir aeropuerto…"></div><button type="button" class="btn" id="oAdd">${ic('plus')} Añadir</button><button type="button" class="btn" id="oEs">🇪🇸 Toda España</button></div></div>

    <div class="card pad section"><h2>🧳 Tu viaje por defecto</h2><div class="grid-form" style="margin-top:12px">
      <label class="f">Vigilar automáticamente${sel('trip_type', [['both', 'Ida y vuelta + solo ida'], ['rt', 'Solo ida y vuelta'], ['ow', 'Solo ida']])}</label>
      <label class="f">Noches mínimas${inp('min_nights', 'number', 'min="1" max="60"')}</label>
      <label class="f">Noches máximas${inp('max_nights', 'number', 'min="1" max="60"')}</label>
      <label class="f">Viajeros${inp('passengers', 'number', 'min="1" max="9"')}</label>
      <label class="f">Equipaje${sel('baggage', Object.entries(S.meta.baggage_options))}</label>
      <label class="f">Solo directos${sel('direct_only', [['false', 'No'], ['true', 'Sí']])}</label>
      <label class="f">Moneda${sel('currency', [['eur', 'EUR €'], ['usd', 'USD $'], ['gbp', 'GBP £']])}</label>
      <label class="f">Meses a vigilar${inp('months_ahead', 'number', 'min="1" max="13"')}</label>
    </div><p class="tiny muted">«Ida y vuelta + solo ida» duplica las peticiones de cada escaneo. El equipaje y los viajeros se usan para calcular el precio total estimado.</p></div>

    <div class="card pad section"><h2>🔌 Fuente de precios</h2><div class="grid-form" style="margin-top:12px">
      <label class="f">Proveedor${sel('provider', [['auto', 'Automático'], ['travelpayouts', 'Travelpayouts (real)'], ['demo', 'Demo (simulado)']])}</label>
      <label class="f">Token Travelpayouts${inp('travelpayouts_token')}</label>
      <label class="f">Marker afiliado (opcional)${inp('travelpayouts_marker')}</label>
      <label class="f">Clave SerpApi (Google Flights)${inp('serpapi_key')}</label>
    </div><p class="tiny muted">Token gratis en travelpayouts.com. SerpApi (250 búsquedas/mes gratis) activa «Comprobar precio real», con historial de Google y equipaje real.</p></div>

    <div class="card pad section"><h2>🔔 Cuándo avisarme</h2><div class="grid-form" style="margin-top:12px">
      <label class="f">Antelación mínima (días)${inp('min_days_ahead', 'number', 'min="0"')}</label>
      <label class="f">Antelación máxima (días)${inp('max_days_ahead', 'number', 'min="1"')}</label>
      <label class="f">Chollo si baja (%) de lo habitual${inp('deal_pct', 'number', 'min="1" max="90"')}</label>
      <label class="f">Bajada mínima (%)${inp('drop_pct', 'number', 'min="1" max="90"')}</label>
      <label class="f">Repetir aviso si baja otro (%)${inp('realert_pct', 'number', 'min="0" max="90"')}</label>
      <label class="f">Máx. alertas por ruta${inp('max_alerts_per_route', 'number', 'min="1" max="20"')}</label>
      <label class="f">Vigilados: avisar si cambia (%)${inp('watch_change_pct', 'number', 'min="1" max="90"')}</label>
      <label class="f">Ofertas por mensaje${inp('notify_max_items', 'number', 'min="1" max="50"')}</label>
    </div></div>

    <div class="card pad section"><h2>📲 Notificaciones</h2><p class="muted small">Telegram (recomendado), ntfy (push al móvil sin registro) o email. Guarda antes de probar.</p><div class="grid-form" style="margin-top:12px">
      <label class="f">Telegram: token del bot${inp('telegram_bot_token')}</label>
      <label class="f">Telegram: chat id${inp('telegram_chat_id')}</label>
      <label class="f">ntfy: tema${inp('ntfy_topic', 'text', 'placeholder="vuelos-tu-nombre-8k2x"')}</label>
      <label class="f">ntfy: servidor${inp('ntfy_server')}</label>
      <label class="f">Email: servidor SMTP${inp('smtp_host', 'text', 'placeholder="smtp.gmail.com"')}</label>
      <label class="f">Email: puerto${inp('smtp_port', 'number')}</label>
      <label class="f">Email: usuario${inp('smtp_user')}</label>
      <label class="f">Email: contraseña${inp('smtp_password', 'password', 'autocomplete="new-password"')}</label>
      <label class="f">Email: remitente${inp('smtp_from')}</label>
      <label class="f">Email: enviar a${inp('email_to')}</label>
      <label class="f">Horas de silencio${inp('quiet_hours', 'text', 'placeholder="23-8"')}</label>
      <label class="f">Zona horaria${sel('timezone', [['Europe/Madrid', 'Península y Baleares'], ['Atlantic/Canary', 'Canarias'], ['Europe/London', 'Reino Unido'], ['UTC', 'UTC']])}</label>
    </div><div class="row" style="margin-top:12px"><button type="button" class="btn" id="tNotif">${ic('bell')} Enviar aviso de prueba</button><span id="tRes" class="small muted"></span></div></div>

    <div class="card pad section"><h2>⏱️ Escaneo automático</h2><div class="grid-form" style="margin-top:12px">
      <label class="f">Cada (horas)${inp('scan_interval_hours', 'number', 'min="1" max="168"')}</label>
      <label class="f">Pausa entre peticiones (s)${inp('request_delay_s', 'number', 'step="0.1" min="0"')}</label>
      <label class="f">Caché de búsquedas (h)${inp('search_cache_hours', 'number', 'step="0.5" min="0"')}</label>
      <label class="f">Festivos de${sel('holiday_region', Object.entries(S.meta.holiday_regions))}</label>
    </div></div>

    <div class="card pad section"><h2>📱 App en el móvil</h2><p class="small muted">Abre esta web en el móvil y usa «Añadir a pantalla de inicio» (Safari/Chrome): se instala como una app. Para abrirla fuera de casa, publícala online (mira DEPLOY.md).</p>
      <div class="row"><button type="button" class="btn" id="installBtn" hidden>${ic('download')} Instalar app</button><button type="button" class="btn" id="reOnb">✨ Repetir asistente inicial</button></div></div>

    <div class="row" style="position:sticky;bottom:0;background:var(--bg);padding:14px 0;margin-top:16px;border-top:1px solid var(--border);z-index:5">
      <button class="btn primary" type="submit">${ic('check')} Guardar ajustes</button><span id="sMsg" class="small muted"></span></div>
  </form>`;
  const drawO = () => { $('#oChips').innerHTML = origins.map((o) => `<span class="chip">${flag(cityInfo(o).country_code)} ${esc(cityName(o))} (${o})<button type="button" class="x" data-rm="${o}">×</button></span>`).join('') || '<span class="muted small">Sin orígenes</span>'; };
  drawO(); attachAC($('#oIn'), { countries: false });
  $('#oChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { origins = origins.filter((x) => x !== b.dataset.rm); drawO(); } };
  $('#oAdd').onclick = () => { const r = resolvePlace($('#oIn').value); if (!r.destinations) return toast('Elige un aeropuerto de la lista'); origins = [...new Set([...origins, ...r.destinations])]; $('#oIn').value = ''; drawO(); };
  $('#oEs').onclick = () => { origins = [...new Set([...origins, ...S.meta.spain_origins.map((c) => c.code)])]; drawO(); toast('Más orígenes = escaneos más largos'); };
  $('#sf').onsubmit = async (e) => {
    e.preventDefault(); const body = { origins };
    for (const x of e.target.elements) if (x.name) body[x.name] = x.value;
    try { S.settings = await api('/api/settings', { method: 'PUT', body }); $('#sMsg').textContent = '✅ Guardado'; setTimeout(() => ($('#sMsg').textContent = ''), 2500); refreshStatus(); } catch (err) { toast(err.message); }
  };
  $('#tNotif').onclick = async () => { $('#tRes').textContent = 'Enviando…'; const r = await api('/api/settings/test-notification', { method: 'POST' }); $('#tRes').textContent = r.error || Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '); };
  $('#reOnb').onclick = onboarding;
  if (S.installPrompt) { $('#installBtn').hidden = false; $('#installBtn').onclick = () => S.installPrompt.prompt(); }
};
VIEWS.more = () => {};

/* =================== ASISTENTE INICIAL =================== */
function onboarding() {
  const st = { step: 0, origins: [...(S.settings.origins || [])], dests: [], trip: S.settings.trip_type || 'both', min: S.settings.min_nights, max: S.settings.max_nights, bag: S.settings.baggage, pax: pax(), ntfy: '' };
  const popular = ['LON', 'PAR', 'ROM', 'LIS', 'AMS', 'BER', 'NYC', 'CUN', 'BKK', 'TYO', 'REK', 'MLE', 'DPS', 'MEX', 'BUE', 'DXB', 'IST', 'ATH', 'PRG', 'MRU'];
  const steps = [
    () => `<h2>¡Bienvenido! ¿Desde dónde sueles volar?</h2><p class="muted">Elige uno o varios aeropuertos. Luego puedes cambiarlo.</p>
      <div class="chips">${S.meta.spain_origins.map((c) => `<button class="chip ${st.origins.includes(c.code) ? 'on' : ''}" data-o="${c.code}">${esc(c.name)}</button>`).join('')}</div>`,
    () => `<h2>¿A dónde te gustaría ir?</h2><p class="muted">Pulsa los que te interesen o busca cualquier ciudad o país. Vigilaremos cada día del año.</p>
      <div class="chips">${popular.map((c) => `<button class="chip ${st.dests.includes(c) ? 'on' : ''}" data-d="${c}">${flag(cityInfo(c).country_code)} ${esc(cityName(c))}</button>`).join('')}</div>
      <div class="row" style="margin-top:12px"><div style="flex:1"><input id="obIn" placeholder="Otra ciudad o país…"></div><button class="btn" id="obAdd">${ic('plus')}</button></div><div class="small muted" id="obExtra">${st.dests.filter((d) => !popular.includes(d)).map(cityName).join(', ')}</div>`,
    () => `<h2>¿Cómo viajas normalmente?</h2>
      <div class="grid-form" style="margin-top:10px">
        <label class="f">Vigilar<select id="obTrip"><option value="both" ${st.trip === 'both' ? 'selected' : ''}>Ida y vuelta + solo ida</option><option value="rt" ${st.trip === 'rt' ? 'selected' : ''}>Ida y vuelta</option><option value="ow" ${st.trip === 'ow' ? 'selected' : ''}>Solo ida</option></select></label>
        <label class="f">Noches (mín.)<input id="obMin" type="number" min="1" value="${st.min}"></label><label class="f">Noches (máx.)<input id="obMax" type="number" min="1" value="${st.max}"></label>
      </div><div style="margin-top:14px">${paxBagControl('obPB', st.pax, st.bag)}</div>`,
    () => `<h2>¿Cómo quieres recibir los avisos?</h2><p class="muted">La forma más rápida: instala la app gratuita <b>ntfy</b> en tu móvil y suscríbete a este tema privado.</p>
      <label class="f">Tema de ntfy<input id="obNtfy" value="${esc(st.ntfy || 'vuelos-' + Math.random().toString(36).slice(2, 8))}"></label>
      <p class="small muted">También puedes usar Telegram o email desde Ajustes. Si prefieres configurarlo luego, deja el campo vacío.</p>`,
  ];
  const draw = () => {
    openSheet(`<div class="sh-head"><h2>✨ Configura tu buscador</h2><button class="btn icon ghost close" data-close>${ic('x')}</button></div>
    <div class="sh-body wizard"><div class="steps">${steps.map((_, i) => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('')}</div>${steps[st.step]()}
    <div class="row end" style="margin-top:8px">${st.step ? '<button class="btn ghost" id="obBack">Atrás</button>' : ''}<button class="btn primary" id="obNext">${st.step === steps.length - 1 ? 'Empezar a vigilar 🚀' : 'Siguiente'}</button></div></div>`);
    const sh = $('#sheet');
    sh.onclick = (e) => {
      const o = e.target.closest('[data-o]'); if (o) { const c = o.dataset.o; st.origins = st.origins.includes(c) ? st.origins.filter((x) => x !== c) : [...st.origins, c]; o.classList.toggle('on'); }
      const d = e.target.closest('[data-d]'); if (d) { const c = d.dataset.d; st.dests = st.dests.includes(c) ? st.dests.filter((x) => x !== c) : [...st.dests, c]; d.classList.toggle('on'); }
    };
    if ($('#obIn')) { attachAC($('#obIn')); $('#obAdd').onclick = () => { const r = resolvePlace($('#obIn').value); if (r.destinations) st.dests.push(...r.destinations); else if (r.country) st.dests.push(...S.catalog.filter((c) => c.country_code === r.country).map((c) => c.code)); else return toast('Elige de la lista'); $('#obIn').value = ''; $('#obExtra').textContent = st.dests.filter((x) => !popular.includes(x)).map(cityName).join(', '); }; }
    $('#obBack')?.addEventListener('click', () => { st.step--; draw(); });
    $('#obNext').onclick = async () => {
      if (st.step === 0 && !st.origins.length) return toast('Elige al menos un aeropuerto');
      if (st.step === 1 && !st.dests.length) return toast('Elige al menos un destino');
      if (st.step === 2) { st.trip = $('#obTrip').value; st.min = +$('#obMin').value; st.max = +$('#obMax').value; const pb = readPaxBag($('#obPB')); st.pax = pb.pax; st.bag = pb.baggage; }
      if (st.step === 3) {
        st.ntfy = $('#obNtfy').value.trim();
        await api('/api/settings', { method: 'PUT', body: { origins: st.origins, trip_type: st.trip, min_nights: st.min, max_nights: st.max, passengers: st.pax, baggage: st.bag, ntfy_topic: st.ntfy, onboarded: true } });
        await api('/api/destinations', { method: 'POST', body: { codes: [...new Set(st.dests)] } });
        S.settings = await api('/api/settings'); closeSheet(); await startScan(); route(true); return;
      }
      st.step++; draw();
    };
  };
  draw();
}

/* =================== arranque =================== */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async function init() {
  paintIcons();
  try {
    const [cat, countries, settings, meta] = await Promise.all([api('/api/catalog?limit=500'), api('/api/catalog/countries'), api('/api/settings'), api('/api/meta')]);
    Object.assign(S, { catalog: cat, countries, settings, meta });
    await refreshStatus();
    route(true);
  } catch (e) { $('.content').innerHTML = `<div class="card empty"><h3>No se pudo conectar con el servidor</h3><p>${esc(e.message)}</p></div>`; }
})();
