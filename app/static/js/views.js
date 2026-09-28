/* Flight Tracker — vistas y navegación */
'use strict';

/* =================== navegación =================== */
const VIEWS = {};
function route(force = false) {
  let v = (location.hash.slice(1) || 'home').split('?')[0];
  if (v === 'avisos') v = 'settings';
  const name = VIEWS[v] ? v : 'home';
  if (name === 'more') { openMore(); return; }
  if (!$('#modal').classList.contains('hidden')) closeSheet();
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
  ${(S.static ? [['holidays', 'sun', 'Puentes y festivos'], ['calendar', 'calendar', 'Calendario de precios'], ['destinations', 'star', 'Destinos'], ['settings', 'settings', 'Preferencias']]
    : [['holidays', 'sun', 'Puentes y festivos'], ['calendar', 'calendar', 'Calendario de precios'], ['watches', 'eye', 'Vuelos vigilados'], ['destinations', 'star', 'Mis destinos'], ['settings', 'settings', 'Ajustes']])
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
  $('#sideStatus').innerHTML = S.static
    ? `<div><b>${s.provider === 'demo' ? '🎲 Precios simulados' : '✅ Precios reales'}</b></div><div>Actualizado ${last ? ago(last.finished_at || last.started_at) : '—'}</div><div class="tiny">Se actualiza cada 6 horas</div>`
    : `<div><b>${s.provider === 'demo' ? '🎲 Modo demo' : '✅ Precios reales'}</b></div>
    <div>Último escaneo: ${last ? ago(last.finished_at || last.started_at) : 'nunca'}</div><div>Próximo: ${until(s.next_run)}</div>`;
  $$('[data-count="alerts"]').forEach((c) => { c.textContent = s.unread_alerts; c.classList.toggle('hidden', !s.unread_alerts); });
  $$('[data-count="watches"]').forEach((c) => { c.textContent = s.watches; c.classList.toggle('hidden', !s.watches); });
  const p = s.progress, bar = $('#scanbar');
  bar.classList.toggle('hidden', !p.running);
  $('#scanBtn').disabled = p.running;
  if (p.running) { $('#scanText').textContent = `Escaneando ${p.current}… ${p.done}/${p.total}`; $('div > div', bar).style.width = `${p.total ? (p.done / p.total) * 100 : 5}%`; }
  $('#logoutBtn').classList.toggle('hidden', !s.auth);
  const ban = [];
  if (isIOS() && !isStandalone() && !S.iosHintClosed) ban.push(`<div class="banner info" id="iosHint">📲 <div><b>Úsala como app en tu iPhone:</b> pulsa <b>Compartir</b> (el cuadrado con la flecha ↑) → <b>Añadir a pantalla de inicio</b>. Tendrás su icono, pantalla completa y notificaciones.</div><button class="btn icon ghost" onclick="S.iosHintClosed=1;this.parentElement.remove()">✕</button></div>`);
  if (s.insecure) ban.push(`<div class="banner warn">${ic('zap')}<div><b>Tu app está accesible desde internet sin contraseña.</b> Define <code>APP_PASSWORD</code> en el servidor para protegerla.</div></div>`);
  $('#banners').innerHTML = ban.join('');
  return s;
}
let wasRunning = false;
setInterval(async () => {
  if (window.STATIC) return;
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
  const sp = S.static ? [] : (S.meta.spain_origins || []).map((c) => c.code);
  return `<option value="mine" ${sel === 'mine' ? 'selected' : ''}>Mis aeropuertos (${esc(own.join(', ') || '—')})</option>
    ${S.static ? '' : `<option value="ES" ${sel === 'ES' ? 'selected' : ''}>Toda España (${sp.length} aeropuertos)</option>`}
    ${[...new Set([...own, ...sp])].map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${esc(cityName(c))} (${c})</option>`).join('')}`;
}
function filterDefaults() {
  const st = S.settings || {};
  return { max_stops: st.max_stops ?? -1, max_duration_h: st.max_duration_h || 0,
    dep_windows: (st.dep_windows || '').split(',').filter(Boolean), exclude_airlines: st.exclude_airlines || [] };
}
function activeFilters(v) {
  return (v.max_stops >= 0 ? 1 : 0) + (+v.max_duration_h ? 1 : 0) + (v.dep_windows?.length ? 1 : 0) + (v.ret_windows?.length ? 1 : 0)
    + (v.weekdays?.length ? 1 : 0) + (v.max_price ? 1 : 0) + (v.airlines?.length ? 1 : 0) + (v.exclude_airlines?.length ? 1 : 0);
}
function filtersHtml(v) {
  const n = activeFilters(v);
  const wins = (name, sel) => Object.entries(S.meta.windows || {}).map(([k, l]) => `<button type="button" class="chip ${(sel || []).includes(k) ? 'on' : ''}" data-win="${name}" data-w="${k}">${WIN_ICON[k]} ${esc(l)} <span class="tiny muted">${WIN_RANGE[k]}</span></button>`).join('');
  const dur = +v.max_duration_h || 0;
  return `<details class="more-filters" ${n ? 'open' : ''}><summary>${ic('filter')} Filtros${n ? ` <span class="count">${n}</span>` : ''}</summary>
    <div class="filters">
      <div class="fg"><div class="fl">Escalas</div><div class="seg" data-stops>${[[-1, 'Cualquiera'], [0, 'Directo'], [1, 'Máx. 1'], [2, 'Máx. 2']].map(([k, l]) => `<button type="button" data-s="${k}" class="${+v.max_stops === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="fg"><div class="fl">Duración máx. por trayecto <b data-durl>${dur ? `${dur} h` : 'sin límite'}</b></div><input type="range" name="max_duration_h" min="2" max="40" step="1" value="${dur || 40}"></div>
      <div class="fg"><div class="fl">Hora de salida (ida)</div><div class="chips">${wins('dep', v.dep_windows)}</div></div>
      <div class="fg" data-rt><div class="fl">Hora de salida (vuelta)</div><div class="chips">${wins('ret', v.ret_windows)}</div></div>
      <div class="fg"><div class="fl">Salir solo en</div><div class="weekdays" data-wd>${DOW1.map((d, i) => `<button type="button" data-d="${i}" class="${(v.weekdays || []).includes(i) ? 'on' : ''}">${d}</button>`).join('')}</div></div>
      <div class="fg"><div class="fl">Precio máx. / persona</div><input type="number" name="max_price" min="0" placeholder="${sym()}" value="${esc(v.max_price || '')}" style="max-width:160px"></div>
      <div class="fg" data-airl ${(v.airlines || []).length || (v.exclude_airlines || []).length ? '' : 'hidden'}><div class="fl">Aerolíneas</div><div class="chips" data-alchips></div></div>
      <div class="fg"><button type="button" class="btn ghost sm" data-reset>${ic('x')} Quitar filtros</button></div>
    </div></details>`;
}
function searchForm(root, { mode = 'days', compact = false, values = {} } = {}) {
  const v = { trip: S.settings.trip_type === 'ow' ? 'ow' : 'rt', origins: 'mine', when: 'any', min_nights: S.settings.min_nights, max_nights: S.settings.max_nights, ...filterDefaults(), ...values };
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
    ${compact ? '' : filtersHtml(v)}
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
  form._airlines = new Set(v.airlines || []); form._exclude = new Set(v.exclude_airlines || []); form._sort = v.sort || 'price';
  const drawAl = () => {
    const box = $('[data-alchips]', form); if (!box) return;
    const names = S.meta.airlines || {};
    const items = [...[...form._airlines].map((c) => [c, 'inc']), ...[...form._exclude].map((c) => [c, 'exc'])];
    box.innerHTML = items.map(([c, t]) => `<span class="chip ${t === 'inc' ? 'on' : 'off'}">${t === 'inc' ? 'Solo' : 'Sin'} ${esc(names[c] || c)}<button type="button" class="x" data-rmal="${c}">×</button></span>`).join('');
    $('[data-airl]', form).hidden = !items.length;
  };
  drawAl();
  form.addEventListener('click', (e) => {
    const st = e.target.closest('[data-stops] [data-s]'); if (st) { $$('[data-stops] [data-s]', form).forEach((x) => x.classList.toggle('on', x === st)); }
    const w = e.target.closest('[data-win]'); if (w) w.classList.toggle('on');
    const rm = e.target.closest('[data-rmal]'); if (rm) { form._airlines.delete(rm.dataset.rmal); form._exclude.delete(rm.dataset.rmal); drawAl(); }
    if (e.target.closest('[data-reset]')) {
      $$('[data-stops] [data-s]', form).forEach((x) => x.classList.toggle('on', x.dataset.s === '-1'));
      $$('[data-win].on, [data-wd] .on', form).forEach((x) => x.classList.remove('on'));
      form.max_duration_h.value = 40; form.max_duration_h.dispatchEvent(new Event('input'));
      form.max_price.value = ''; form._airlines.clear(); form._exclude.clear(); drawAl();
    }
  });
  if (form.max_duration_h) form.max_duration_h.oninput = () => { const x = +form.max_duration_h.value; $('[data-durl]', form).textContent = x >= 40 ? 'sin límite' : `${x} h`; };
  /* Ajuste rápido desde los resultados (escalas, aerolínea, franja, orden) */
  form.refine = (k, val) => {
    if (k === 'sort') form._sort = val;
    if (k === 'stops') $$('[data-stops] [data-s]', form).forEach((x) => x.classList.toggle('on', x.dataset.s === String(val)));
    if (k === 'only') { form._exclude.delete(val); if (form._airlines.has(val)) form._airlines.delete(val); else form._airlines.add(val); }
    if (k === 'exclude') { form._airlines.delete(val); form._exclude.add(val); }
    if (k === 'win') { const b = $(`[data-win="dep"][data-w="${val}"]`, form); if (b) b.classList.toggle('on'); }
    drawAl();
    const det = $('.more-filters', form); if (det && k !== 'sort') det.open = true;
    form.requestSubmit();
  };
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
      if (form.max_price.value) p.max_price = +form.max_price.value;
      p.max_stops = +($('[data-stops] .on', form)?.dataset.s ?? -1);
      p.direct_only = p.max_stops === 0;
      const dh = +form.max_duration_h.value; p.max_duration_h = dh >= 40 ? 0 : dh;
      p.dep_windows = $$('[data-win="dep"].on', form).map((b) => b.dataset.w);
      p.ret_windows = trip === 'rt' ? $$('[data-win="ret"].on', form).map((b) => b.dataset.w) : [];
      p.airlines = [...form._airlines]; p.exclude_airlines = [...form._exclude];
    }
    p.sort = form._sort || 'price';
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
function openKey(d) { return encodeURIComponent(JSON.stringify({ origin: d.origin, destination: d.destination, depart_date: d.depart_date, return_date: d.return_date || null, trip: d.trip })); }
function stopsHtml(n) { return n == null ? '' : `<span class="stops ${n === 0 ? 'direct' : ''}">${n === 0 ? '✈ Directo' : `${n} escala${n > 1 ? 's' : ''}`}</span>`; }
function dealCard(d, { showSpark = true, rank = null } = {}) {
  const region = d.dest_region || cityInfo(d.destination).region;
  const p = d.resident_price != null ? d.resident_price : d.price;
  return `<article class="card deal ${rg(region)}" data-open="${openKey(d)}">
    <div class="cover">${flag(d.dest_cc || cityInfo(d.destination).country_code)}<div class="t"><div class="city">${rank ? `${rank}. ` : ''}${esc(d.dest_name || d.name || cityName(d.destination))}</div>
      <div class="sub">${esc(d.dest_country || d.country || '')} · desde ${esc(d.origin)}</div></div>${saveBadge(d.savings)}</div>
    <div class="body">
      <div class="pricerow"><span class="price">${money(p)}</span><span class="per">/pers. ${d.trip === 'rt' ? 'i/v' : 'ida'}${d.resident_price != null ? ' · 🏝️ residente' : ''}</span></div>
      ${d.price_total && Math.round(d.price_total) !== Math.round(p) ? `<div class="totline">Total${(d.pax || 1) > 1 ? ` ${d.pax} pers.` : ''}${d.baggage?.fee_est ? ' con equipaje' : ''}: <b>${money(d.price_total)}</b></div>` : ''}
      <div class="line">${dateChip(d.depart_date, d.return_date, d.nights)}</div>
      <div class="line">${stopsHtml(d.transfers)}${durChip(d)}</div>
      <div class="line"><span>${esc(d.airline_name || '')}</span><span class="spacer"></span>${bagChips(d.baggage)}</div>
      ${meter(d.price, d.range, { labels: false })}
    </div>
  </article>`;
}
function spotlight(d) {
  const region = d.dest_region || cityInfo(d.destination).region;
  const p = d.resident_price != null ? d.resident_price : d.price;
  return `<article class="card spot ${rg(region)}" data-open="${openKey(d)}">
    <div class="cover"><span class="kicker">🔥 Mejor chollo ahora</span><div class="row">${flag(d.dest_cc)}<span class="city">${esc(d.dest_name || d.name)}</span></div>
      <div class="bigp">${money(p)}</div><div class="sub">${d.trip === 'rt' ? 'ida y vuelta' : 'solo ida'} · desde ${esc(d.origin_name || d.origin)}</div>${saveBadge(d.savings)}</div>
    <div class="info">
      <div class="row">${dateChip(d.depart_date, d.return_date, d.nights)}${stopsHtml(d.transfers)}${durChip(d)}<span class="muted small">${esc(d.airline_name || '')}</span></div>
      ${meter(d.price, d.range)}
      <div class="row">${bagChips(d.baggage)}<span class="spacer"></span><button class="btn primary sm">Ver vuelo →</button></div>
    </div></article>`;
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
    ${s.provider === 'demo' ? (S.static ? '<div class="banner info">🎲 <div><b>Precios simulados</b> · esta web está en modo demostración.</div></div>'
      : `<div class="banner info">🎲 <div><b>Modo demo</b> · precios simulados. <a href="#settings">Añade tu token gratis</a> para ver precios reales.</div></div>`) : ''}
    <div class="hero"><h1>¿A dónde quieres volar?</h1><p class="sub">El día más barato, en segundos.</p><div id="homeSearch"></div></div>
    <div class="kpis">
      <a class="card kpi" href="#destinations"><span class="ic a">⭐</span><div><div class="v">${s.destinations}</div><div class="l">destinos</div></div></a>
      <a class="card kpi" href="#settings"><span class="ic b">🛫</span><div><div class="v">${s.origins.length}</div><div class="l">aeropuertos</div></div></a>
      ${S.static ? `<a class="card kpi" href="#calendar"><span class="ic c">🕒</span><div><div class="v" style="font-size:1.05rem">${ago(s.last_scan?.finished_at)}</div><div class="l">actualizado</div></div></a>
      <a class="card kpi" href="#alerts"><span class="ic d">🔥</span><div><div class="v">${s.quotes.toLocaleString('es-ES')}</div><div class="l">días con precio</div></div></a>`
      : `<a class="card kpi" href="#watches"><span class="ic c">👀</span><div><div class="v">${s.watches}</div><div class="l">vigilados</div></div></a>
      <a class="card kpi" href="#alerts"><span class="ic d">🔔</span><div><div class="v">${s.unread_alerts}</div><div class="l">alertas nuevas</div></div></a>`}
    </div>
    <div class="section"><div class="section-head"><h2>🔥 Chollos en tus destinos</h2>
      ${trips.length > 1 ? `<div class="seg" id="homeTrip">${trips.map((t) => `<button data-t="${t}" class="${t === S.homeTrip ? 'on' : ''}">${tripLabel(t)}</button>`).join('')}</div>` : ''}</div>
      <div id="homeSpot"></div><div class="deals" id="homeDeals"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
    <div class="section"><div class="section-head"><h2>🗓️ Próximos puentes</h2><a href="#holidays" class="btn sm">Ver todos</a></div>
      <div class="holidays" id="homeHol"></div></div>
    <div class="section two">
      <div><div class="section-head"><h2>📉 Cambios de precio</h2></div><div class="list" id="homeChanges"></div></div>
      <div><div class="section-head"><h2>🔔 ${S.static ? "Últimos chollos" : "Últimas alertas"}</h2><a href="#alerts" class="small">Ver todas</a></div><div class="list" id="homeAlerts"></div></div>
    </div>`;
  paintIcons(el);
  const f = searchForm($('#homeSearch'), { compact: true });
  f.onsubmit = (e) => { e.preventDefault(); const p = f.getParams(); if (p.mode === 'explore') go('explore', { params: p }); else go('search', { params: p }); };
  $('#homeTrip')?.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { S.homeTrip = b.dataset.t; route(true); } });
  const [deals, changes, alerts, hol] = await Promise.all([api(`/api/deals?trip=${S.homeTrip}`), api('/api/changes?limit=8'), api('/api/alerts?limit=6'), api('/api/holidays')]);
  remember(deals);
  if (deals.length) {
    $('#homeSpot').innerHTML = spotlight(deals[0]);
    $('#homeDeals').innerHTML = deals.slice(1).map((d) => dealCard(d)).join('');
  } else {
    $('#homeDeals').innerHTML = `<div class="card empty" style="grid-column:1/-1"><div class="big">✈️</div><h3>${s.destinations ? 'Aún no hay precios' : 'Añade tus destinos favoritos'}</h3>
      ${S.static ? '' : s.destinations ? '<button class="btn primary" onclick="startScan()">Escanear ahora</button>' : '<a class="btn primary" href="#destinations">Añadir destinos</a>'}</div>`;
  }
  $('#homeHol').innerHTML = hol.items.slice(0, 3).map(holCard).join('') || '<p class="muted small">No hay festivos próximos.</p>';
  paintIcons($('#homeHol'));
  $('#homeChanges').innerHTML = changes.length ? changes.map((c) => `
    <div class="card item" data-open="${openKey({ ...c, return_date: null })}" style="cursor:pointer">
      ${flag(cityInfo(c.destination).country_code)}<div class="grow"><div class="title">${esc(c.origin)} → ${esc(c.name)}</div>
      <div class="small muted">${esc(dshort(c.depart_date))} · ${tripLabel(c.trip).toLowerCase()} · ${ago(c.seen_at)}</div></div>
      <div style="text-align:right"><div style="font-weight:900">${money(c.price)}</div><span class="delta ${c.pct < 0 ? 'down' : 'up'}">${c.pct < 0 ? '▼' : '▲'} ${Math.abs(c.pct).toFixed(0)}%</span></div></div>`).join('')
    : '<div class="card empty small">Aparecen a partir del segundo escaneo.</div>';
  $('#homeAlerts').innerHTML = alerts.length ? alerts.map(alertItem).join('') : '<div class="card empty small">Sin alertas todavía.</div>';
  if (!s.onboarded) onboarding();
};

/* =================== MEJOR DÍA =================== */
VIEWS.search = (el) => {
  const pend = S.pending?.view === 'search' ? S.pending.params : null; S.pending = null;
  el.innerHTML = `<div class="page-head"><div><h1>¿Qué día sale más barato?</h1><p>Ciudad o país entero: te decimos el día más barato.</p></div></div>
    <div id="sForm"></div><div id="sRes" class="section"></div>`;
  const f = searchForm($('#sForm'), { values: pend || S.lastSearch || {} });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const p = f.getParams(); S.lastSearch = p;
    if (p.mode === 'explore') { go('explore', { params: p }); return; }
    if (!p.destinations && !p.country) { toast('Elige un destino de la lista (o escribe un código de 3 letras).'); return; }
    try { renderDays($('#sRes'), await runSearch(p, $('#sRes')), f); } catch (err) { $('#sRes').innerHTML = `<div class="card empty"><h3>No se pudo buscar</h3><p>${esc(err.message)}</p></div>`; }
  };
  if (pend) f.requestSubmit();
};
/* Barra de resultados tipo Skyscanner: orden (barato / rápido / mejor) + filtros rápidos con precio «desde» */
function refineBar(r, form, { sort = true } = {}) {
  const P = r.params || {}, F = r.facets || {};
  const sm = r.summary || {};
  const sortCard = (k, label, icon) => { const x = sm[k]; if (!x) return ''; return `<button type="button" class="sortcard ${P.sort === k ? 'on' : ''}" data-rf="sort" data-v="${k}"><span class="sl">${icon} ${label}</span><b>${money(x.price / Math.max(1, x.pax || 1))}</b><span class="tiny muted">${x.dur ? durShort(x.dur) + (P.trip === 'rt' ? ' i/v' : '') : '&nbsp;'}</span></button>`; };
  const stopsL = { 0: 'Directo', 1: '1 escala', 2: '2+ escalas' };
  const stops = Object.entries(F.stops || {}).sort((a, b) => a[0] - b[0]).map(([k, v]) => `<button type="button" class="chip ${+P.max_stops === +k ? 'on' : ''}" data-rf="stops" data-v="${+P.max_stops === +k ? -1 : k}">${k === '0' ? '✈ ' : ''}${stopsL[k]} <b>${money(v)}</b></button>`).join('');
  const wins = Object.entries(F.windows || {}).map(([k, v]) => `<button type="button" class="chip ${(P.dep_windows || []).includes(k) ? 'on' : ''}" data-rf="win" data-v="${k}">${WIN_ICON[k]} ${esc((S.meta.windows || {})[k] || k)} <b>${money(v)}</b></button>`).join('');
  const als = (F.airlines || []).slice(0, 12).map((a) => `<button type="button" class="chip ${(P.airlines || []).includes(a.code) ? 'on' : ''}" data-rf="only" data-v="${a.code}" title="Pulsa para ver solo esta aerolínea">${esc(a.name)} <b>${money(a.min)}</b></button>`).join('');
  const html = `<div class="card pad refine">
    ${sort && Object.values(sm).some(Boolean) ? `<div class="sortcards">${sortCard('price', 'Más barato', '💸')}${sortCard('best', 'Mejor', '⭐')}${sortCard('duration', 'Más rápido', '⚡')}</div>` : ''}
    ${stops ? `<div class="rf"><span class="fl">Escalas</span><div class="chips">${stops}</div></div>` : ''}
    ${wins ? `<div class="rf"><span class="fl">Salida</span><div class="chips">${wins}</div></div>` : ''}
    ${als ? `<div class="rf"><span class="fl">Aerolíneas</span><div class="chips">${als}</div></div>` : ''}
    ${F.duration ? `<div class="tiny muted">Duración por trayecto: de ${durShort(F.duration[0])} a ${durShort(F.duration[1])}. Ajústala en «Filtros».</div>` : ''}
  </div>`;
  return { html, bind: (root) => { root.querySelector('.refine')?.addEventListener('click', (e) => { const b = e.target.closest('[data-rf]'); if (b && form?.refine) form.refine(b.dataset.rf, b.dataset.rf === 'stops' ? +b.dataset.v : b.dataset.v); }); } };
}
function renderDays(box, r, form) {
  if (!r.found) {
    const rb = r.facets && r.filtered_out ? refineBar(r, form, { sort: false }) : null;
    box.innerHTML = `<div class="card empty"><div class="big">🔎</div><h3>Sin resultados</h3><p>${esc(r.error || (r.filtered_out ? `Hay ${r.filtered_out} opciones, pero ninguna cumple tus filtros. Prueba a quitar alguno.` : 'No hay precios para esa combinación. Prueba con más noches, otras fechas o sin filtros.'))}</p>${(r.errors || []).length ? `<p class="small">${esc(r.errors[0])}</p>` : ''}</div>${rb ? rb.html : ''}`;
    if (rb) rb.bind(box);
    return;
  }
  const rb = refineBar(r, form);
  optBadge = { price: 'Más barato', best: 'Mejor', duration: 'Más rápido' }[r.params.sort] || 'Mejor';
  const b = r.best, a = r.advice, P = r.params;
  remember([b, ...r.top, ...r.by_month]);
  const key = encodeURIComponent(JSON.stringify({ origin: b.origin, destination: b.destination, depart_date: b.depart_date, return_date: b.return_date, trip: b.trip }));
  const pp = b.resident_price != null ? b.resident_price : b.price;
  box.innerHTML = `
  <div class="card result-hero ${rg(b.dest_region)}">
    <div class="l" style="padding:0">
      <div class="cover" style="border-radius:0">${flag(b.dest_cc)}<div class="t"><div class="city">${esc(b.dest_name)}</div><div class="sub">${esc(b.origin_name)} (${esc(b.origin)}) → ${esc(b.destination)} · ${tripLabel(b.trip).toLowerCase()}</div></div>${saveBadge(b.savings)}</div>
      <div style="padding:18px 20px;display:grid;gap:12px">
        <div class="row" style="align-items:baseline"><span class="bigprice">${money(pp)}</span><span class="muted">/persona${b.resident_price != null ? ' (residente)' : ''}</span>
          ${P.pax > 1 || P.baggage !== 'personal' ? `<span class="spacer"></span><span class="fact"><span>Total ${P.pax > 1 ? P.pax + ' pers.' : ''}${P.baggage !== 'personal' ? ' + equipaje' : ''}</span><b>${money(b.price_total)}</b></span>` : ''}</div>
        <div class="row">${dateChip(b.depart_date, b.return_date, b.nights)}${stopsHtml(b.transfers)}${durChip(b)}<span class="muted small">${esc(b.airline_name)}</span><span class="spacer"></span>${bagChips(b.baggage)}</div>
        ${meter(b.price, b.range)}
        <div class="row"><button class="btn primary" data-open="${key}">Ver vuelo y reservar →</button><button class="btn ghost sm" id="exportRes">${ic('download')} CSV</button></div>
      </div>
    </div>
    <div class="r">${verdictBox(a)}<p class="tiny muted" style="margin:12px 0 0">Orientativo${r.provider === 'demo' ? ' · datos simulados' : ''}.</p></div>
  </div>
  ${rb.html}
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
  rb.bind(box);
  show(r.params.sort && r.params.sort !== 'price' ? 'top' : 'cal');
  $('#exportRes').onclick = () => download('mejores_fechas.csv', toCSV(r.top, [['salida', (o) => o.depart_date], ['vuelta', (o) => o.return_date || ''], ['origen', (o) => o.origin], ['destino', (o) => o.destination], ['precio_persona', (o) => o.price], ['total_estimado', (o) => o.price_total], ['aerolinea', (o) => o.airline_name], ['escalas', (o) => o.transfers], ['duracion_min', (o) => o.duration ?? ''], ['hora_salida', (o) => o.dep_time || ''], ['enlace', (o) => o.links.aviasales]]), 'text/csv');
}
let optBadge = '';
function optRow(o, i) {
  const pp = o.resident_price != null ? o.resident_price : o.price;
  return `<div class="card opt" data-open="${openKey(o)}">${flag(o.dest_cc)}
    <div style="min-width:0"><div class="row" style="gap:8px">${i === 0 ? `<span class="pill hot">🥇 ${esc(optBadge || 'Mejor')}</span>` : ''}${dateChip(o.depart_date, o.return_date, o.nights)}${stopsHtml(o.transfers)}${durChip(o)}</div>
    <div class="small muted" style="margin-top:4px">${esc(o.origin)} → ${esc(o.dest_name)} · ${esc(o.airline_name)} ${bagChips(o.baggage)}</div></div>
    <div class="p"><b>${money(pp)}</b>${o.level ? `<div><span class="pill ${LEVEL[o.level][1]}">${LEVEL[o.level][0]}</span></div>` : ''}</div></div>`;
}

/* =================== EXPLORAR =================== */
VIEWS.explore = (el) => {
  const pend = S.pending?.view === 'explore' ? S.pending.params : null; S.pending = null;
  el.innerHTML = `<div class="page-head"><div><h1>Explorar: ¿a dónde puedo ir barato?</h1><p>Decenas de destinos a la vez, en un mapa.</p></div></div>
    <div id="eForm"></div><div id="eRes" class="section"></div>`;
  const vals = pend ? { ...pend, theme: pend.theme || '' } : (S.lastExplore || {});
  const f = searchForm($('#eForm'), { mode: 'explore', values: vals });
  f.onsubmit = async (e) => {
    e.preventDefault(); const p = f.getParams(); p.mode = 'explore'; S.lastExplore = p;
    try { renderExplore($('#eRes'), await runSearch(p, $('#eRes')), f); } catch (err) { $('#eRes').innerHTML = `<div class="card empty"><h3>No se pudo explorar</h3><p>${esc(err.message)}</p></div>`; }
  };
  if (pend) f.requestSubmit();
};
function renderExplore(box, r, form) {
  if (!r.found) { const rb0 = r.facets && r.filtered_out ? refineBar(r, form, { sort: false }) : null; box.innerHTML = `<div class="card empty"><div class="big">🧭</div><h3>Sin resultados</h3><p>${esc(r.error || (r.filtered_out ? 'Ninguna opción cumple tus filtros. Prueba a quitar alguno.' : 'Prueba otra zona, más noches o sin presupuesto máximo.'))}</p></div>${rb0 ? rb0.html : ''}`; if (rb0) rb0.bind(box); return; }
  const list = r.by_destination; remember(list);
  const rb = refineBar(r, form, { sort: false });
  const top = list.slice(0, 10), maxP = Math.max(...top.map((d) => d.price_total));
  const pr = list.map((d) => d.price).sort((a, b) => a - b), med = pr[Math.floor(pr.length / 2)];
  box.innerHTML = `<div class="section-head"><h2>${list.length} destinos · del más barato al más caro</h2>
    <div class="row"><button class="btn sm" id="exFav">${ic('star')} Guardar top 5</button><button class="btn sm ghost" id="exCsv">${ic('download')} CSV</button></div></div>
    ${rb.html}
    <div class="explore-top"><div id="map" class="card"></div>
    <div class="card pad"><h3 style="margin-bottom:10px">🏆 Top 10</h3><div class="rank">${top.map((d, i) => {
      const col = priceColor(d.price, med, pr[0], pr[pr.length - 1]);
      return `<div class="r" data-open="${openKey(d)}"><span class="n">${i + 1}</span><span class="nm">${flag(d.dest_cc)}${esc(d.dest_name)}</span>
        <span class="bar"><i style="width:${Math.max(8, (d.price_total / maxP) * 100)}%;background:${col.bg}"></i></span><span class="p">${money(d.resident_price ?? d.price)}</span></div>`;
    }).join('')}</div></div></div>
    <div class="deals section">${list.map((d, i) => dealCard(d, { showSpark: false, rank: i + 1 })).join('')}</div>`;
  paintIcons(box);
  rb.bind(box);
  loadMap(list);
  if (S.static && !isAdmin()) $('#exFav').remove();
  else $('#exFav').onclick = async () => {
    const codes = list.slice(0, 5).map((d) => d.destination);
    try {
      if (S.static) { const cur = ((await ghGetVar('DESTINATIONS')) || '').split(',').filter(Boolean); await ghSetVar('DESTINATIONS', [...new Set([...cur, ...codes])].join(',')); toast('⭐ Añadidos. Aparecerán tras el próximo escaneo (o pulsa «Guardar» en Destinos).', 6000); }
      else { await api('/api/destinations', { method: 'POST', body: { codes } }); toast('⭐ Añadidos a tus destinos'); }
    } catch (e) { toast(e.message, 6000); }
  };
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
  return `<div class="card hol"><div class="row"><h3 style="flex:1">${esc(h.title)}</h3><span class="pill ${h.days_off === 0 ? 'good' : h.days_off === 1 ? 'brand' : 'warn'}">${h.days_off === 0 ? '0 días de vacaciones' : `pide ${h.days_off} día${h.days_off > 1 ? 's' : ''}`}</span></div>
    ${weekStrip(h.start, h.end, h.holidays)}
    <div class="row"><b>${h.days} días libres</b><span class="muted small">${esc(dshort(h.start))} → ${esc(dshort(h.end))} ${d8(h.start).getFullYear()}</span></div>
    <button class="btn sm primary" data-hol='${esc(JSON.stringify(h))}'>${ic('search')} Buscar escapadas</button><div class="res"></div></div>`;
}
async function searchHoliday(btn) {
  const h = JSON.parse(btn.dataset.hol), card = btn.closest('.hol'), res = $('.res', card);
  const target = $('#holTarget')?.value || 'fav';
  const params = { mode: 'explore', trip: 'rt', origins: $('#holOrigin')?.value || 'mine', date_from: addDays(h.start, -1), date_to: h.start, return_from: h.end, return_to: addDays(h.end, 1), min_nights: Math.max(1, h.days - 2), max_nights: h.days + 1, pax: pax(), baggage: S.settings.baggage };
  if (target === 'fav' || S.static) params.favorites = true; else params.theme = target === 'all' ? '' : target;
  btn.disabled = true; res.innerHTML = '<div class="progress"><div style="width:40%"></div></div>';
  try {
    const r = await runSearch(params, res);
    if (!r.found) { res.innerHTML = `<p class="small muted">${esc(r.error || 'Sin vuelos para esas fechas.')}</p>`; return; }
    remember(r.by_destination);
    res.innerHTML = r.by_destination.slice(0, 6).map((d, i) => `<div class="r" data-open="${openKey(d)}"><span class="muted" style="font-weight:900;width:14px">${i + 1}</span>${flag(d.dest_cc)}<b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.dest_name)}</b>${stopsHtml(d.transfers)}<b>${money(d.resident_price ?? d.price)}</b></div>`).join('');
  } catch (e) { res.innerHTML = `<p class="small" style="color:var(--bad)">${esc(e.message)}</p>`; }
  btn.disabled = false;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-hol]'); if (b) { e.preventDefault(); if (S.view !== 'holidays') { S.holAuto = b.dataset.hol; go('holidays'); } else searchHoliday(b); } });
VIEWS.holidays = async (el) => {
  const regions = S.meta.holiday_regions;
  el.innerHTML = `<div class="page-head"><div><h1>Puentes y festivos</h1><div class="wk-legend" style="margin-top:8px"><span><i style="background:var(--hot)"></i>festivo</span><span><i style="background:var(--brand-soft)"></i>fin de semana</span><span><i style="background:var(--warn-soft);outline:2px dashed var(--warn)"></i>día de vacaciones a pedir</span></div></div></div>
    <div class="card pad grid-form">
      <label class="f">Comunidad<select id="holRegion">${Object.entries(regions).map(([k, v]) => `<option value="${k}" ${S.settings.holiday_region === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="f">Salgo desde<select id="holOrigin">${originOptions('mine')}</select></label>
      <label class="f ${S.static ? 'hidden' : ''}">Buscar en<select id="holTarget"><option value="fav">Mis destinos favoritos</option><option value="barato">Low cost cerca</option><option value="playa">Playa</option><option value="ciudad">Escapadas urbanas</option><option value="naturaleza">Naturaleza</option><option value="all">Todo el catálogo</option></select></label>
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
  el.innerHTML = `<div class="page-head"><div><h1>Calendario de precios</h1><p>Pulsa cualquier día para ver el vuelo.</p></div></div>
    <div class="card pad row">
      <label class="f" style="min-width:180px">Origen<select id="cO">${S.settings.origins.map((o) => `<option value="${o}" ${o === c.o ? 'selected' : ''}>${esc(cityName(o))} (${o})</option>`).join('')}</select></label>
      <label class="f" style="min-width:200px">Destino<select id="cD">${dests.map((d) => `<option value="${d.code}" ${d.code === c.d ? 'selected' : ''}>${esc(d.name)} (${d.code})</option>`).join('')}</select></label>
      <div class="seg" id="cT">${['rt', 'ow'].map((t) => `<button data-t="${t}" class="${t === c.t ? 'on' : ''}">${tripLabel(t)}</button>`).join('')}</div>
      <span class="spacer"></span><div class="legend"><span>barato</span><span class="scale"></span><span>caro</span></div>
      <a class="btn sm ${S.static ? 'hidden' : ''}" id="cCsv">${ic('download')} CSV</a>
    </div>
    <div id="cSum" class="section"></div><div class="months section" id="cGrid"></div>
    <div class="section card pad"><div class="section-head"><h2>Evolución del precio de la ruta</h2><div class="chart-legend"><span><i style="background:var(--series-1)"></i>Mínimo del año</span><span><i style="background:var(--series-muted)"></i>Precio mediano</span></div></div><div id="cHist"></div></div>`;
  if (!dests.length) { $('#cGrid').innerHTML = '<div class="card empty">Añade destinos primero.</div>'; return; }
  const draw = async () => {
    const o = $('#cO').value, d = $('#cD').value, t = $('#cT .on').dataset.t; S.calSel = { o, d, t };
    $('#cCsv').href = `/api/export/calendar.csv?origin=${o}&destination=${d}&trip=${t}`;
    const [cal, hist] = await Promise.all([api(`/api/calendar?origin=${o}&destination=${d}&trip=${t}`), api(`/api/history?origin=${o}&destination=${d}&trip=${t}`)]);
    remember(cal.quotes.map((q) => ({ ...q, median: cal.median, range: cal.range })));
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
  el.innerHTML = `<div class="page-head"><div><h1>Vuelos vigilados</h1><p>Te avisamos si suben, bajan o llegan a tu precio objetivo.</p></div></div>
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
  if (S.static) return staticDestView(el);
  const dests = await api('/api/destinations'); S.destinations = dests;
  const themes = Object.entries(S.meta.themes);
  el.innerHTML = `<div class="page-head"><div><h1>Mis destinos</h1><p>Los vigilamos cada día. Pon un precio máximo y te avisamos al bajar.</p></div></div>
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
  return `<div class="card alert ${a.read ? '' : 'unread'}" data-open="${openKey(a)}" title="${esc(a.message)}">${flag(a.dest_cc)}
    <div style="min-width:0"><div class="row" style="gap:6px"><span class="pill ${cls}">${esc(label)}</span><span class="route">${esc(a.origin)} → ${esc(a.dest_name)}</span></div>
      <div class="meta">${dateChip(a.depart_date, a.return_date, a.nights)}${a.airline_name ? `<span class="small muted">${esc(a.airline_name)}</span>` : ''}<span class="tiny muted">${ago(a.created_at)}</span></div></div>
    <div class="price">${money(a.price)}${a.savings > 0.02 ? `<small style="color:var(--good);font-weight:800">−${Math.round(a.savings * 100)}%</small>` : `<small>${a.trip === 'rt' ? 'i/v' : 'ida'}</small>`}</div></div>`;
}
VIEWS.alerts = async (el) => {
  const alerts = await api('/api/alerts?limit=300');
  const kinds = [...new Set(alerts.map((a) => a.kind))];
  el.innerHTML = `<div class="page-head"><div><h1>${S.static ? 'Últimos chollos' : 'Alertas'}</h1><p>${S.static ? 'Ofertas detectadas en los últimos escaneos.' : 'Solo ofertas que merecen la pena · como mucho una por destino.'}</p></div>
    <div class="row ${S.static ? 'hidden' : ''}"><button class="btn sm" id="aRead">${ic('check')} Marcar leídas</button><button class="btn sm" id="aCsv">${ic('download')} CSV</button><button class="btn sm danger" id="aClear">${ic('trash')} Borrar</button></div></div>
    <div class="chips" id="aF"><button class="chip on" data-k="">Todas (${alerts.length})</button>${kinds.map((k) => `<button class="chip" data-k="${k}">${esc((KIND[k] || [k])[0])} (${alerts.filter((a) => a.kind === k).length})</button>`).join('')}</div>
    <div class="list section" id="aList"></div>`;
  // Agrupadas por destino: se ve el aviso más reciente y el resto queda plegado
  const draw = (k) => {
    const l = alerts.filter((a) => !k || a.kind === k);
    const groups = []; const idx = {};
    l.forEach((a) => { if (!(a.destination in idx)) { idx[a.destination] = groups.length; groups.push([]); } groups[idx[a.destination]].push(a); });
    $('#aList').innerHTML = groups.length ? groups.map((g) => `<div class="agroup">${alertItem(g[0])}${g.length > 1 ? `<button class="agroup-more" data-more>+${g.length - 1} aviso${g.length > 2 ? 's' : ''} anterior${g.length > 2 ? 'es' : ''} de ${esc(g[0].dest_name)}</button><div class="older" hidden>${g.slice(1).map(alertItem).join('')}</div>` : ''}</div>`).join('')
      : `<div class="card empty"><div class="big">🔔</div><h3>Sin alertas</h3><p>${S.static ? 'Aquí aparecerán solo las ofertas que de verdad merecen la pena.' : `Solo avisamos de ofertas ${esc(((S.meta.alert_levels || {})[S.settings.alert_level] || 'muy buenas').toLowerCase())}: como mucho una por destino. Cámbialo en Ajustes → Avisos.`}</p></div>`;
  };
  $('#aList').addEventListener('click', (e) => { const m = e.target.closest('[data-more]'); if (m) { e.stopPropagation(); const o = m.nextElementSibling; if (!m.dataset.t) m.dataset.t = m.textContent; o.hidden = !o.hidden; m.textContent = o.hidden ? m.dataset.t : 'Ocultar anteriores'; } }, true);
  $('#aF').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { $$('#aF .chip').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.k); } };
  draw('');
  $('#aRead').onclick = async () => { await api('/api/alerts/read', { method: 'POST' }); refreshStatus(); route(true); };
  $('#aClear').onclick = async () => { if (confirm('¿Borrar todas las alertas?')) { await api('/api/alerts', { method: 'DELETE' }); refreshStatus(); route(true); } };
  $('#aCsv').onclick = () => download('alertas.csv', toCSV(alerts, [['fecha', (a) => a.created_at], ['tipo', (a) => a.kind_label], ['mensaje', (a) => a.message], ['enlace', (a) => a.link]]), 'text/csv');
};

/* =================== AJUSTES =================== */
function isOwnerDevice() {
  let f = false;
  try { if (location.hash.includes('avisos')) localStorage.setItem('ft-owner', '1'); f = localStorage.getItem('ft-owner') === '1'; } catch (e) { f = location.hash.includes('avisos'); }
  return f;
}
async function renderPrefs(el) {
  const s = await api('/api/settings');
  el.innerHTML = `<div class="page-head"><div><h1>Preferencias</h1><p>Se guardan solo en este navegador.</p></div></div>
  <div class="card pad grid-form">
    <label class="f">Viajeros<input id="pPax" type="number" min="1" max="9" value="${s.passengers || 1}"></label>
    <label class="f">Equipaje<select id="pBag">${Object.entries(S.meta.baggage_options).map(([k, v]) => `<option value="${k}" ${s.baggage === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label class="f">Descuento de residente<select id="pRes"><option value="">No soy residente</option><option value="canarias" ${s.resident_discount === 'canarias' ? 'selected' : ''}>Residente en Canarias (75 %)</option><option value="baleares" ${s.resident_discount === 'baleares' ? 'selected' : ''}>Residente en Baleares (75 %)</option></select></label>
    <button class="btn primary" id="pSave">${ic('check')} Guardar</button>
  </div>
  <div class="section" id="adminAlerts"></div>
  <div class="card pad section ${S.meta.vapid_public && isOwnerDevice() ? '' : 'hidden'}" id="pubPush"><h2>🔔 Avisos en este móvil</h2>
    <p class="small muted" style="margin:6px 0 12px">Recibe los chollos como notificaciones, sin instalar ninguna app.</p>
    <div id="pubPushBody"></div></div>
  <div class="card pad section"><h2>📱 Instálala en tu móvil</h2><p class="small muted" style="margin:6px 0 0">En el navegador del móvil pulsa «Compartir → Añadir a pantalla de inicio» (iPhone) o «⋮ → Instalar app» (Android).</p></div>
  <div class="card pad section"><h2>ℹ️ Sobre los precios</h2><p class="small muted" style="margin:6px 0 0">Precios de búsquedas recientes en Aviasales, actualizados cada 6 horas. Pueden cambiar: confírmalos siempre al reservar. El equipaje y el descuento de residente son estimaciones.</p></div>`;
  paintIcons(el);
  if (isOwnerDevice() || isAdmin()) adminAlertsCard($('#adminAlerts'));
  const pp = $('#pubPushBody');
  if (pp) {
    const sup = pushSupport();
    pp.innerHTML = sup.ok ? '<button class="btn primary" id="pubPushBtn">🔔 Activar avisos en este móvil</button>' : `<p class="small" style="margin:0">${esc(sup.reason)}</p>`;
    $('#pubPushBtn')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const code = encodeDevice(await subscribePush('push-sw.js', S.meta.vapid_public));
        pp.innerHTML = `<p class="small" style="margin:0 0 8px">✅ Listo. Último paso: envía este código a tu Flight Tracker del ordenador (<b>Ajustes → Avisos → Añadir tu móvil</b>).</p>
          <textarea readonly rows="3" style="font-size:.75rem" id="pubCode">${esc(code)}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn primary" id="pubShare">${ic('share')} Compartir código</button><button class="btn" id="pubCopy">Copiar</button></div>`;
        paintIcons(pp);
        $('#pubCopy').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Copiado'); } catch (err) { $('#pubCode').select(); } };
        $('#pubShare').onclick = () => shareText('Código de avisos Flight Tracker', code, '');
      } catch (err) { toast(err.message, 7000); e.currentTarget.disabled = false; }
    });
  }
  $('#pSave').onclick = async () => { S.settings = await api('/api/settings', { method: 'PUT', body: { passengers: +$('#pPax').value, baggage: $('#pBag').value, resident_discount: $('#pRes').value } }); SD.cache = {}; toast('✅ Guardado'); };
}
VIEWS.settings = async (el) => {
  if (S.static) return renderPrefs(el);
  const s = await api('/api/settings'); S.settings = s; let origins = [...s.origins];
  const sel = (name, opts) => `<select name="${name}">${opts.map(([k, v]) => `<option value="${k}" ${String(s[name]) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const inp = (name, type = 'text', extra = '') => `<input name="${name}" type="${type}" value="${esc(s[name] ?? '')}" ${extra}>`;
  el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Todo se guarda en tu servidor. Los secretos se muestran enmascarados.</p></div></div>
  <div id="cloudBox" class="card pad" style="margin-bottom:16px"><div class="skel" style="height:120px"></div></div>
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

    <div class="card pad section"><h2>🔔 Qué merece un aviso</h2>
      <p class="small muted" style="margin:4px 0 12px">Como mucho <b>un aviso por destino</b> en cada escaneo (el mejor), y no se repite salvo que aparezca algo claramente mejor.</p>
      <div class="seg" id="lvlSeg">${Object.entries(S.meta.alert_levels).map(([k, l]) => `<button type="button" data-l="${k}" class="${s.alert_level === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <input type="hidden" name="alert_level" value="${esc(s.alert_level)}">
      <p class="tiny muted" id="lvlHelp" style="margin:8px 0 0"></p>
      <div class="grid-form" style="margin-top:12px">
        <label class="f">Avisar también de bajadas simples${sel('alert_drops', [['false', 'No (recomendado)'], ['true', 'Sí']])}</label>
        <label class="f">Antelación mínima (días)${inp('min_days_ahead', 'number', 'min="0"')}</label>
        <label class="f">Antelación máxima (días)${inp('max_days_ahead', 'number', 'min="1"')}</label>
        <label class="f">Repetir aviso de un destino si baja otro (%)${inp('realert_pct', 'number', 'min="0" max="90"')}</label>
        <label class="f">… en los próximos (días)${inp('realert_days', 'number', 'min="1" max="60"')}</label>
        <label class="f">Vigilados: avisar si cambia (%)${inp('watch_change_pct', 'number', 'min="1" max="90"')}</label>
        <label class="f">Ofertas por mensaje${inp('notify_max_items', 'number', 'min="1" max="50"')}</label>
      </div></div>

    <div class="card pad section"><h2>🧭 Filtros de los escaneos</h2>
      <p class="small muted" style="margin:4px 0 12px">Solo se vigilan (y se avisan) vuelos que cumplan esto. También son los filtros por defecto de las búsquedas.</p>
      <div class="grid-form">
        <label class="f">Escalas${sel('max_stops', [[-1, 'Cualquiera'], [0, 'Solo directos'], [1, 'Máx. 1 escala'], [2, 'Máx. 2 escalas']])}</label>
        <label class="f">Duración máx. por trayecto (h, 0 = sin límite)${inp('max_duration_h', 'number', 'min="0" max="60"')}</label>
      </div>
      <div class="fl" style="margin-top:12px">Hora de salida</div>
      <div class="chips" id="sWin" style="margin-top:6px">${Object.entries(S.meta.windows).map(([k, l]) => `<button type="button" class="chip ${(s.dep_windows || '').split(',').includes(k) ? 'on' : ''}" data-w="${k}">${WIN_ICON[k]} ${esc(l)} <span class="tiny muted">${WIN_RANGE[k]}</span></button>`).join('')}</div>
      <input type="hidden" name="dep_windows" value="${esc(s.dep_windows || '')}">
      <div class="fl" style="margin-top:12px">Aerolíneas que NO quiero</div>
      <div class="chips" id="sAl" style="margin-top:6px">${Object.entries(S.meta.airlines).sort((x, y) => x[1].localeCompare(y[1])).map(([k, l]) => `<button type="button" class="chip ${(s.exclude_airlines || []).includes(k) ? 'off' : ''}" data-a="${k}">${esc(l)}</button>`).join('')}</div>
      <input type="hidden" name="exclude_airlines" value="${esc((s.exclude_airlines || []).join(','))}">
    </div>

    <div class="card pad section"><h2>📲 Avisos</h2>
      <h3 style="margin-top:14px">🔔 Notificaciones de la app <span class="pill good">sin instalar nada</span></h3>
      <p class="small muted" style="margin:4px 0 10px">Llegan como las de cualquier app, en este ordenador y en tu móvil.</p>
      <div id="pushBox"><div class="skel" style="height:60px"></div></div>

      <h3 style="margin-top:18px">✉️ Email</h3>
      <div class="grid-form" style="margin-top:8px">
        <label class="f">Tu email${inp('email_to', 'email', 'placeholder="tu@gmail.com"')}</label>
        <label class="f">Contraseña de aplicación de Google${inp('smtp_password', 'password', 'autocomplete="new-password" placeholder="16 letras"')}</label>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">Con Gmail: crea una <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">contraseña de aplicación</a> (necesita la verificación en 2 pasos) y pégala aquí. No es tu contraseña normal.</p>

      <details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Otros canales y opciones (opcional)</summary>
      <div class="grid-form" style="margin-top:12px">
        <label class="f">Servidor SMTP (si no es Gmail)${inp('smtp_host', 'text', 'placeholder="smtp.gmail.com"')}</label>
        <label class="f">Puerto${inp('smtp_port', 'number')}</label>
        <label class="f">Usuario SMTP${inp('smtp_user')}</label>
        <label class="f">Remitente${inp('smtp_from')}</label>
        <label class="f">Telegram: token del bot${inp('telegram_bot_token')}</label>
        <label class="f">Telegram: chat id${inp('telegram_chat_id')}</label>
        <label class="f">ntfy: tema${inp('ntfy_topic')}</label>
        <label class="f">ntfy: servidor${inp('ntfy_server')}</label>
      </div></details>
      <div class="grid-form" style="margin-top:14px">
        <label class="f">Horas de silencio${inp('quiet_hours', 'text', 'placeholder="23-8"')}</label>
        <label class="f">Zona horaria${sel('timezone', [['Europe/Madrid', 'Península y Baleares'], ['Atlantic/Canary', 'Canarias'], ['Europe/London', 'Reino Unido'], ['UTC', 'UTC']])}</label>
      </div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn" id="tNotif">${ic('bell')} Probar todos los avisos</button><span id="tRes" class="small muted"></span></div></div>

    <div class="card pad section"><h2>⏱️ Escaneo automático</h2><div class="grid-form" style="margin-top:12px">
      <label class="f">Cada (horas)${inp('scan_interval_hours', 'number', 'min="1" max="168"')}</label>
      <label class="f">Pausa entre peticiones (s)${inp('request_delay_s', 'number', 'step="0.1" min="0"')}</label>
      <label class="f">Caché de búsquedas (h)${inp('search_cache_hours', 'number', 'step="0.5" min="0"')}</label>
      <label class="f">Festivos de${sel('holiday_region', Object.entries(S.meta.holiday_regions))}</label>
      <label class="f">Descuento de residente${sel('resident_discount', [['', 'No soy residente'], ['canarias', 'Residente en Canarias (75 %)'], ['baleares', 'Residente en Baleares (75 %)']])}</label>
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
  const lvlHelp = { excepcional: 'Solo errores de tarifa y ofertas de ≥40 % bajo lo habitual (muy pocas al mes).', muy_buena: 'Ofertas de ≥30 % bajo lo habitual y entre las fechas más baratas del año.', buena: 'Ofertas de ≥20 % bajo lo habitual. Más avisos.' };
  const setLvl = (k) => { $$('#lvlSeg [data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === k)); $('[name=alert_level]').value = k; $('#lvlHelp').textContent = lvlHelp[k] || ''; };
  setLvl(s.alert_level); $('#lvlSeg').onclick = (e) => { const b = e.target.closest('[data-l]'); if (b) setLvl(b.dataset.l); };
  $('#sWin').onclick = (e) => { const b = e.target.closest('[data-w]'); if (!b) return; b.classList.toggle('on'); $('[name=dep_windows]').value = $$('#sWin .on').map((x) => x.dataset.w).join(','); };
  $('#sAl').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; b.classList.toggle('off'); $('[name=exclude_airlines]').value = $$('#sAl .off').map((x) => x.dataset.a).join(','); };
  $('#sf').onsubmit = async (e) => {
    e.preventDefault(); const body = { origins };
    for (const x of e.target.elements) if (x.name) body[x.name] = x.value;
    const em = (body.email_to || '').trim().toLowerCase();
    if (em && !body.smtp_host && /@(gmail|googlemail)\.com$/.test(em)) Object.assign(body, { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_user: em, smtp_from: em });
    if (em && body.smtp_host && !body.smtp_user) body.smtp_user = em;
    if (body.smtp_password) body.smtp_password = body.smtp_password.replace(/\s+/g, '');
    try {
      S.settings = await api('/api/settings', { method: 'PUT', body }); $('#sMsg').textContent = '✅ Guardado'; setTimeout(() => ($('#sMsg').textContent = ''), 2500); refreshStatus();
      if (S.cloud?.configured && S.cloud?.workflow) { toast('☁️ Sincronizando con GitHub…'); api('/api/cloud/sync', { method: 'POST', body: { schedule: S.cloud.schedule_enabled !== false } }).then(() => { toast('☁️ GitHub actualizado'); renderCloud(); }).catch((e) => toast(e.message)); }
    } catch (err) { toast(err.message); }
  };
  $('#tNotif').onclick = async () => { $('#tRes').textContent = 'Enviando…'; const r = await api('/api/settings/test-notification', { method: 'POST' }); $('#tRes').textContent = r.error || Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '); };
  $('#reOnb').onclick = onboarding;
  renderPush();
  renderCloud();
  if (S.installPrompt) { $('#installBtn').hidden = false; $('#installBtn').onclick = () => S.installPrompt.prompt(); }
};
VIEWS.more = () => {};

/* =================== NOTIFICACIONES PROPIAS (Web Push) =================== */
async function renderPush() {
  const box = $('#pushBox'); if (!box) return;
  const [devs, key] = await Promise.all([api('/api/push/devices'), api('/api/push/key')]);
  const sup = pushSupport();
  box.innerHTML = `
    ${devs.length ? `<div class="list">${devs.map((d) => `<div class="card item" style="padding:8px 12px">📱<div class="grow"><b>${esc(d.name)}</b><div class="tiny muted">desde ${esc(d.added || '—')}</div></div><button type="button" class="btn sm ghost danger" data-rmdev="${d.id}">${ic('trash')}</button></div>`).join('')}</div>`
    : '<p class="small muted" style="margin:0">Aún no hay dispositivos.</p>'}
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn primary" id="pushHere" ${sup.ok ? '' : 'disabled'}>🔔 Activar en este ordenador</button>
      ${devs.length ? '<button type="button" class="btn" id="pushTest">Enviar prueba</button>' : ''}
      ${sup.ok ? '' : `<span class="small muted">${esc(sup.reason)}</span>`}
    </div>
    <details style="margin-top:12px" ${devs.length ? '' : 'open'}><summary style="cursor:pointer;font-weight:700">📱 Añadir tu móvil</summary>
      <ol class="small" style="margin:8px 0;padding-left:18px">
        <li>Abre en tu móvil tu enlace privado de avisos: ${S.settings.site_url ? `<b>${esc(S.settings.site_url.replace(/\/$/, ''))}/#avisos</b> <button type="button" class="btn sm ghost" id="ownLink">Copiar</button>` : 'aparecerá aquí cuando actives la web pública en «☁️ Avisos 24/7».'}</li>
        <li>En iPhone: «Compartir → Añadir a pantalla de inicio» y ábrela desde el icono.</li>
        <li>Pulsa <b>Activar avisos en este móvil</b> y luego <b>Compartir código</b>.</li>
        <li>Pega aquí el código:</li></ol>
      <p class="tiny muted" style="margin:0 0 8px">Los visitantes de la web pública no ven esta opción: los avisos son solo para ti.</p>
      <div class="row"><input id="devCode" placeholder="Código del dispositivo" style="flex:1;min-width:220px"><input id="devName" placeholder="Nombre (p. ej. Mi móvil)" style="width:180px"><button type="button" class="btn" id="devAdd">${ic('plus')} Añadir</button></div>
    </details>`;
  paintIcons(box);
  box.onclick = async (e) => { const b = e.target.closest('[data-rmdev]'); if (b) { await api(`/api/push/devices/${b.dataset.rmdev}`, { method: 'DELETE' }); renderPush(); } };
  $('#pushHere')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { const sub = await subscribePush('/sw.js', key.public_key); await api('/api/push/devices', { method: 'POST', body: { subscription: sub, name: deviceName() } }); toast('🔔 Notificaciones activadas en este ordenador'); }
    catch (err) { toast(err.message, 6000); }
    renderPush();
  });
  $('#pushTest')?.addEventListener('click', async () => { try { const r = await api('/api/push/test', { method: 'POST' }); toast(`🔔 Prueba enviada: ${r.push}`); } catch (err) { toast(err.message, 6000); } });
  $('#ownLink')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(S.settings.site_url.replace(/\/$/, '') + '/#avisos'); toast('Enlace copiado'); } catch (e) { /* */ } });
  $('#devAdd').onclick = async () => {
    try { await api('/api/push/devices', { method: 'POST', body: { code: $('#devCode').value, name: $('#devName').value } }); toast('📱 Dispositivo añadido. Si usas GitHub, se sincroniza solo.'); renderPush(); }
    catch (err) { toast(err.message, 6000); }
  };
}

/* =================== NUBE: avisos 24/7 + web pública (GitHub) =================== */
async function renderCloud() {
  const box = $('#cloudBox'); if (!box) return;
  let c;
  try { c = await api('/api/cloud/status'); } catch (e) { c = { error: e.message }; }
  S.cloud = c;
  const s = S.settings;
  const step = (ok, title, body = '', warn = false) => `<div class="cstep ${ok ? 'ok' : warn ? 'warn' : ''}"><i>${ok ? '✓' : warn ? '!' : '·'}</i><div><b>${title}</b>${body ? `<div class="small muted">${body}</div>` : ''}</div></div>`;
  const ready = c.configured && !c.error;
  box.innerHTML = `<div class="row"><h2 style="flex:1">☁️ Avisos 24/7 y web pública <span class="pill good">gratis</span></h2>
      ${ready && c.pages_url ? `<a class="btn sm primary" href="${esc(c.pages_url)}" target="_blank" rel="noopener">${ic('ext')} Abrir web pública</a>` : ''}</div>
    <p class="small muted" style="margin:6px 0 14px">GitHub revisa los precios cada 6 h aunque apagues el PC, te avisa al móvil y publica una web de solo lectura que cualquiera puede abrir. Tus claves nunca se publican.</p>
    <div class="csteps">
      ${step(c.has_token && !c.error, '1. Conecta tu cuenta de GitHub', c.error ? `<span style="color:var(--bad)">${esc(c.error)}</span>` : c.has_token ? `Repositorio: <b>${esc(c.repo || '—')}</b>` :
        `<details><summary>Cómo crear el token (2 min)</summary><ol class="small" style="margin:6px 0;padding-left:18px">
          <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>.</li>
          <li>Nombre: «Flight Tracker». Caducidad: 1 año.</li>
          <li><b>Repository access</b> → Only select repositories → tu repositorio.</li>
          <li><b>Permissions → Repository</b>: Actions, Administration, Pages, Secrets y Variables en «Read and write».</li>
          <li>Pulsa <b>Generate token</b>, cópialo y pégalo aquí.</li></ol></details>`)}
      <div class="row" style="margin:-4px 0 10px 34px"><input id="ghTok" type="password" placeholder="${c.has_token ? 'Token guardado ••••' : 'Pega tu token de GitHub'}" style="flex:1;min-width:200px">
        <input id="ghRepo" placeholder="usuario/repositorio" value="${esc(s.github_repo || c.detected_repo || '')}" style="width:220px">
        <button class="btn sm" id="ghSave">Guardar y comprobar</button></div>
      ${ready ? step(c.workflow, '2. Código subido a GitHub', c.workflow ? 'Workflow «Escaneo programado» encontrado.' : 'Sube el código una vez: <code>git add -A; git commit -m "v3"; git push</code>') : ''}
      ${ready ? step(!c.private, '3. Repositorio público', c.private ? 'GitHub Pages gratis y los minutos ilimitados de Actions requieren un repositorio público. Tus secrets siguen ocultos. <button class="btn sm" id="ghPublic">Hacer público</button>' : 'Público: minutos de Actions ilimitados y web gratis.', c.private) : ''}
      ${ready ? step(c.has_price_token, '4. Token de precios (Travelpayouts)', c.has_price_token ? 'Guardado en GitHub como secret.' : s.travelpayouts_token ? 'Pulsa «Sincronizar» para subirlo.' : 'Ponlo abajo en «Fuente de precios» y sincroniza.') : ''}
      ${ready ? step(c.has_notifications, '5. Avisos al móvil', c.has_notifications ? 'Canal configurado.' : 'Pon un tema de ntfy o Telegram abajo en «Notificaciones» y sincroniza.', !c.has_notifications) : ''}
      ${ready ? step(c.in_sync, '6. Ajustes y destinos sincronizados', c.in_sync ? 'GitHub usa tus orígenes, destinos y preferencias actuales.' : 'Hay cambios sin subir.') : ''}
      ${ready ? step(c.schedule_enabled, '7. Escaneo automático cada 6 h', `<label class="check"><input type="checkbox" id="ghSched" ${c.schedule_enabled ? 'checked' : ''}> Activado</label>`) : ''}
      ${ready ? step(c.pages_enabled && c.pages_is_actions, '8. Web pública', c.pages_url ? `<a href="${esc(c.pages_url)}" target="_blank" rel="noopener"><b>${esc(c.pages_url)}</b></a> <button class="btn sm ghost" id="ghShare">${ic('share')} Compartir</button><div class="tiny">Se actualiza tras cada escaneo real (el primero tarda ~5 min).</div>` : 'Se activa al sincronizar (repositorio público).') : ''}
    </div>
    ${ready ? `<div class="row" style="margin-top:14px">
      <button class="btn primary" id="ghSync">${ic('refresh')} Sincronizar con GitHub</button>
      <button class="btn" id="ghDemo">🔔 Probar aviso (demo)</button>
      <button class="btn" id="ghRun">${ic('zap')} Escanear ahora en la nube</button>
      <label class="check"><input type="checkbox" id="ghPublish" ${s.publish_site ? 'checked' : ''}> Publicar web pública</label>
      <input id="ghTitle" value="${esc(s.site_title || '')}" placeholder="Título de la web" style="width:200px"></div>
    ${c.runs && c.runs.length ? `<h3 style="margin-top:16px">Últimas ejecuciones</h3><div class="list" style="margin-top:8px">${c.runs.map((r) => {
      const st = r.status !== 'completed' ? ['⏳ En curso', 'warn'] : r.conclusion === 'success' ? ['✓ Correcto', 'good'] : r.conclusion === 'skipped' ? ['Omitido', 'neutral'] : ['✗ Error', 'bad'];
      return `<a class="card item" href="${esc(r.url)}" target="_blank" rel="noopener" style="padding:8px 12px"><span class="pill ${st[1]}">${st[0]}</span><span class="grow small">${r.event === 'schedule' ? 'Automático' : 'Manual'} · ${ago(r.created_at)}</span>${ic('ext')}</a>`;
    }).join('')}</div>` : ''}` : ''}`;
  paintIcons(box);
  const act = async (btn, fn, ok) => { btn.disabled = true; try { const r = await fn(); toast(ok(r)); } catch (e) { toast(e.message, 6000); } btn.disabled = false; renderCloud(); };
  $('#ghSave').onclick = (e) => act(e.currentTarget, async () => {
    const body = { github_repo: $('#ghRepo').value.trim() }; if ($('#ghTok').value.trim()) body.github_token = $('#ghTok').value.trim();
    S.settings = await api('/api/settings', { method: 'PUT', body }); return true;
  }, () => 'Guardado. Comprobando GitHub…');
  $('#ghPublic')?.addEventListener('click', (e) => { if (confirm('¿Hacer público el repositorio? El código será visible; tus tokens (secrets) seguirán ocultos.')) act(e.currentTarget, () => api('/api/cloud/make-public', { method: 'POST' }), () => '✅ Repositorio público'); });
  $('#ghSync')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    S.settings = await api('/api/settings', { method: 'PUT', body: { publish_site: $('#ghPublish').checked, site_title: $('#ghTitle').value } });
    return api('/api/cloud/sync', { method: 'POST', body: { schedule: $('#ghSched')?.checked !== false } });
  }, (r) => r.pages_warning ? `⚠️ ${r.pages_warning}` : `✅ Subidos ${r.variables.length} ajustes y ${r.secrets.length} claves`));
  $('#ghSched')?.addEventListener('change', (e) => act(e.target, () => api('/api/cloud/schedule', { method: 'POST', body: { enabled: e.target.checked } }), (r) => r.schedule ? '✅ Escaneo automático activado' : 'Escaneo automático pausado'));
  $('#ghDemo')?.addEventListener('click', (e) => act(e.currentTarget, () => api('/api/cloud/run', { method: 'POST', body: { demo: true } }), () => '🔔 Prueba lanzada: el aviso llegará en 1–2 minutos'));
  $('#ghRun')?.addEventListener('click', (e) => act(e.currentTarget, () => api('/api/cloud/run', { method: 'POST', body: { demo: false } }), () => '✈️ Escaneo lanzado en GitHub (unos minutos)'));
  $('#ghShare')?.addEventListener('click', () => shareText('Chollos de vuelos', '✈️ Mira estos chollos de vuelos', c.pages_url));
}

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
    () => `<h2>¿Cómo quieres recibir los avisos?</h2><p class="muted">Sin instalar ninguna app: notificaciones en este ordenador y, si quieres, email.</p>
      <button class="btn primary" id="obPush" ${pushSupport().ok ? '' : 'disabled'}>🔔 Activar notificaciones aquí</button> <span class="small muted" id="obPushRes">${pushSupport().ok ? '' : esc(pushSupport().reason)}</span>
      <div class="grid-form" style="margin-top:14px"><label class="f">Tu email (opcional)<input id="obEmail" type="email" placeholder="tu@gmail.com" value="${esc(st.email || '')}"></label>
      <label class="f">Contraseña de aplicación de Google<input id="obPass" type="password" placeholder="16 letras"></label></div>
      <p class="tiny muted">La contraseña de aplicación se crea en <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>. Para el móvil: Ajustes → Avisos → «Añadir tu móvil».</p>`,
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
    $('#obPush')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { const key = await api('/api/push/key'); const sub = await subscribePush('/sw.js', key.public_key); await api('/api/push/devices', { method: 'POST', body: { subscription: sub, name: deviceName() } }); $('#obPushRes').textContent = '✅ Activadas'; }
      catch (err) { $('#obPushRes').textContent = err.message; e.currentTarget.disabled = false; }
    });
    $('#obNext').onclick = async () => {
      if (st.step === 0 && !st.origins.length) return toast('Elige al menos un aeropuerto');
      if (st.step === 1 && !st.dests.length) return toast('Elige al menos un destino');
      if (st.step === 2) { st.trip = $('#obTrip').value; st.min = +$('#obMin').value; st.max = +$('#obMax').value; const pb = readPaxBag($('#obPB')); st.pax = pb.pax; st.bag = pb.baggage; }
      if (st.step === 3) {
        const em = $('#obEmail').value.trim(), pw = $('#obPass').value.replace(/\s+/g, '');
        const mail = em && pw ? { email_to: em, smtp_password: pw, smtp_user: em, smtp_from: em, smtp_host: /@(gmail|googlemail)\.com$/i.test(em) ? 'smtp.gmail.com' : '', smtp_port: 587 } : {};
        await api('/api/settings', { method: 'PUT', body: { origins: st.origins, trip_type: st.trip, min_nights: st.min, max_nights: st.max, passengers: st.pax, baggage: st.bag, onboarded: true, ...mail } });
        await api('/api/destinations', { method: 'POST', body: { codes: [...new Set(st.dests)] } });
        S.settings = await api('/api/settings'); closeSheet(); await startScan(); route(true); return;
      }
      st.step++; draw();
    };
  };
  draw();
}

/* =================== web pública (modo estático) =================== */
function setupStaticUI() {
  document.body.classList.add('is-static');
  $$('[data-view="watches"]').forEach((a) => a.remove());
  $$('[data-view="destinations"]').forEach((a) => { a.lastChild.textContent = 'Destinos'; });
  $$('[data-view="settings"]').forEach((a) => { a.lastChild.textContent = 'Preferencias'; });
  ['#scanBtn', '#scanBtnM', '#logoutBtn'].forEach((id) => $(id)?.classList.add('hidden'));
}
VIEWS.prefs = null;

/* =================== arranque =================== */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; });
if (!window.STATIC && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async function init() {
  paintIcons();
  try {
    const [cat, countries, settings, meta] = await Promise.all([api('/api/catalog?limit=500'), api('/api/catalog/countries'), api('/api/settings'), api('/api/meta')]);
    Object.assign(S, { catalog: cat, countries, settings, meta });
    if (S.static) setupStaticUI();
    await refreshStatus();
    route(true);
  } catch (e) { $('.content').innerHTML = `<div class="card empty"><h3>No se pudo conectar con el servidor</h3><p>${esc(e.message)}</p></div>`; }
})();
