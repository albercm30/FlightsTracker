/* Flight Tracker – interfaz (JavaScript sin dependencias) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const state = { settings: null, status: null, destinations: [], catalog: [], countries: [] };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const KIND = {
  record: ['Mínimo histórico', 'good'], deal: ['Chollo', 'good'], target: ['Bajo tu precio', 'good'],
  drop: ['Bajada', 'warn'], watch_down: ['Vigilado ↓', 'good'], watch_up: ['Vigilado ↑', 'bad'],
};

async function api(path, opts = {}) {
  const o = { headers: { 'Content-Type': 'application/json' }, ...opts };
  if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
  const r = await fetch(path, o);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cur = () => ({ eur: '€', usd: '$', gbp: '£' }[state.settings?.currency || 'eur'] || '€');
const money = (v) => v == null ? '—' : `${Math.round(v).toLocaleString('es-ES')} ${cur()}`;
const dlabel = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const ago = (iso) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
};
const until = (iso) => {
  if (!iso) return '—';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s < 60) return 'en breve';
  if (s < 3600) return `en ${Math.round(s / 60)} min`;
  return `en ${Math.round(s / 3600)} h`;
};
const cityName = (code) => (state.catalog.find((c) => c.code === code) || {}).name || code;
function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
const linksHtml = (l, main) => `
  <a href="${esc(main || l.aviasales)}" target="_blank" rel="noopener">Aviasales</a>
  <a href="${esc(l.google)}" target="_blank" rel="noopener">Google Flights</a>
  <a href="${esc(l.skyscanner)}" target="_blank" rel="noopener">Skyscanner</a>`;
function bookingLinks(o, d, day, ret) {
  const dt = new Date(day + 'T12:00:00');
  const dd = String(dt.getDate()).padStart(2, '0'), mm = String(dt.getMonth() + 1).padStart(2, '0'), yy = String(dt.getFullYear()).slice(2);
  const q = encodeURIComponent(`Flights from ${o} to ${d} on ${day}` + (ret ? ` returning ${ret}` : ' one way'));
  return {
    aviasales: `https://www.aviasales.com/search/${o}${dd}${mm}${d}1`,
    skyscanner: `https://www.skyscanner.es/transporte/vuelos/${o.toLowerCase()}/${d.toLowerCase()}/${yy}${mm}${dd}/`,
    google: `https://www.google.com/travel/flights?hl=es&curr=EUR&q=${q}`,
  };
}

/* ---------------- Gráficos SVG ---------------- */
function lineChart(el, series, { height = 220, yFmt = money, xFmt = (x) => x, bars = false, onClick = null } = {}) {
  el.innerHTML = '';
  const pts = series.flatMap((s) => s.data);
  if (!pts.length) { el.innerHTML = '<p class="muted">Aún no hay datos suficientes.</p>'; return; }
  const W = Math.max(320, Math.round(el.clientWidth - 20) || 900), H = height, L = 56, R = 12, T = 12, B = 28;
  const xs = [...new Set(pts.map((p) => p.x))].sort();
  const xi = new Map(xs.map((x, i) => [x, i]));
  let ymin = Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y));
  if (ymin === ymax) { ymin *= 0.9; ymax *= 1.1; }
  const pad = (ymax - ymin) * 0.08; ymin = Math.max(0, ymin - pad); ymax += pad;
  const inset = bars ? (W - L - R) / xs.length / 2 : 0;
  const X = (x) => L + inset + (xs.length === 1 ? (W - L - R) / 2 - inset : (xi.get(x) / (xs.length - 1)) * (W - L - R - 2 * inset));
  const Y = (y) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const v = ymin + ((ymax - ymin) * i) / 4, y = Y(v);
    svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 6}" y="${y + 4}" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  const step = Math.max(1, Math.ceil(xs.length / 8));
  xs.forEach((x, i) => { if (i % step === 0) svg += `<text class="axis" x="${X(x)}" y="${H - 8}" text-anchor="middle">${esc(xFmt(x))}</text>`; });
  series.forEach((s) => {
    if (bars) {
      const bw = Math.max(2, ((W - L - R) / xs.length) * 0.7);
      s.data.forEach((p) => { svg += `<rect x="${X(p.x) - bw / 2}" y="${Y(p.y)}" width="${bw}" height="${H - B - Y(p.y)}" rx="2" style="fill:${p.color || s.color}" opacity=".9"/>`; });
    } else {
      const d = s.data.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      svg += `<path d="${d}" style="fill:none;stroke:${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
      if (s.data.length < 60) s.data.forEach((p) => { svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" style="fill:${s.color}"/>`; });
    }
  });
  svg += `<rect class="hover" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = svg + '<div class="tip" hidden></div>';
  const tip = $('.tip', el), svgEl = $('svg', el);
  const nearest = (ev) => {
    const r = svgEl.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - L - inset) / (W - L - R - 2 * inset)) * (xs.length - 1));
    return xs[Math.max(0, Math.min(xs.length - 1, i))];
  };
  svgEl.addEventListener('mousemove', (ev) => {
    const x = nearest(ev);
    const lines = series.map((s) => { const p = s.data.find((q) => q.x === x); return p ? `${s.name ? s.name + ': ' : ''}${yFmt(p.y)}${p.label ? ' · ' + p.label : ''}` : null; }).filter(Boolean);
    const r = svgEl.getBoundingClientRect();
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(xFmt(x, true))}</b><br>${lines.map(esc).join('<br>')}`;
    tip.style.left = `${(X(x) / W) * r.width + 10}px`;
    const firstY = series[0].data.find((q) => q.x === x);
    tip.style.top = `${((firstY ? Y(firstY.y) : T) / H) * r.height + 10}px`;
  });
  svgEl.addEventListener('mouseleave', () => (tip.hidden = true));
  if (onClick) { svgEl.style.cursor = 'pointer'; svgEl.addEventListener('click', (ev) => onClick(nearest(ev))); }
}
const colorFor = (price, min, max) => {
  const t = max > min ? (price - min) / (max - min) : 0.5;
  // verde → amarillo → rojo
  const stops = [[47, 176, 122], [241, 196, 77], [229, 96, 77]];
  const a = t < 0.5 ? stops[0] : stops[1], b = t < 0.5 ? stops[1] : stops[2], u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(',')})`;
};

/* ---------------- Navegación ---------------- */
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  location.hash = name;
  ({ dashboard: loadDashboard, calendar: loadCalendar, watches: loadWatches, destinations: loadDestinations, alerts: loadAlerts, settings: loadSettings, search: prepSearch }[name] || (() => {}))();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
document.addEventListener('click', (e) => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); showTab(a.dataset.goto); } });

/* ---------------- Estado / escaneo ---------------- */
async function refreshStatus() {
  const s = await api('/api/status');
  state.status = s;
  const last = s.last_scan;
  const prov = s.provider === 'demo' ? 'Demo (simulado)' : 'Travelpayouts (real)';
  const ch = s.channels.length ? s.channels.join(', ') : 'sin avisos configurados';
  $('#status').textContent = `${prov} · Orígenes: ${s.origins.join(', ') || '—'} · Último escaneo: ${last ? ago(last.finished_at || last.started_at) : 'nunca'} · Próximo: ${until(s.next_run)} · Avisos: ${ch}`;
  const b = $('#alertBadge'); b.hidden = !s.unread_alerts; b.textContent = s.unread_alerts;
  const p = s.progress, box = $('#scanProgress');
  box.hidden = !p.running;
  $('#scanBtn').disabled = p.running;
  if (p.running) {
    $('.bar', box).style.width = `${p.total ? (p.done / p.total) * 100 : 5}%`;
    $('span', box).textContent = `Escaneando ${p.current}… (${p.done}/${p.total} rutas)`;
  }
  return s;
}
let wasRunning = false;
setInterval(async () => {
  try {
    const s = await refreshStatus();
    if (wasRunning && !s.progress.running) { toast('Escaneo terminado'); if ($('#tab-dashboard').classList.contains('active')) loadDashboard(); }
    wasRunning = s.progress.running;
  } catch (e) { /* sin conexión */ }
}, 4000);
$('#scanBtn').addEventListener('click', async () => {
  try { await api('/api/scan', { method: 'POST' }); wasRunning = true; toast('Escaneo iniciado'); refreshStatus(); } catch (e) { toast(e.message); }
});

/* ---------------- Panel ---------------- */
async function loadDashboard() {
  const [s, deals, changes, alerts] = await Promise.all([refreshStatus(), api('/api/deals'), api('/api/changes?limit=12'), api('/api/alerts?limit=8')]);
  $('#demoNotice').hidden = s.provider !== 'demo';
  $('#emptyDest').hidden = s.destinations > 0;
  $('#kpis').innerHTML = [
    [s.destinations, 'destinos vigilados'], [s.origins.length, 'aeropuertos de origen'],
    [s.quotes.toLocaleString('es-ES'), 'días con precio'], [s.unread_alerts, 'alertas sin leer'],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#deals').innerHTML = deals.length ? deals.map((d) => {
    const pct = Math.round(d.savings * 100);
    const cls = pct >= 30 ? 'good' : pct >= 10 ? 'warn' : 'neutral';
    const l = bookingLinks(d.origin, d.destination, d.depart_date, d.return_date);
    return `<div class="card">
      <div class="top"><div><div class="dest">${esc(d.name)}</div><div class="meta">${esc(d.country)} · desde ${esc(d.origin)}</div></div>
      ${pct > 0 ? `<span class="pill ${cls}">−${pct}%</span>` : ''}</div>
      <div class="price">${money(d.price)}</div>
      <div class="meta">${esc(d.date_label)}${d.return_date ? ' · vuelta ' + esc(dlabel(d.return_date)) : ''} · ${d.transfers === 0 ? 'directo' : d.transfers != null ? d.transfers + ' escala(s)' : ''}</div>
      <div class="meta">Habitual: ${money(d.median)}${d.max_price ? ` · tu máximo ${money(d.max_price)}` : ''}</div>
      <div class="actions">
        <button class="btn small" data-cal="${esc(d.origin)}|${esc(d.destination)}">Calendario</button>
        <button class="btn small" data-day="${esc(d.origin)}|${esc(d.destination)}|${esc(d.depart_date)}">Detalle</button>
        <a class="btn small" href="${esc(d.link || l.aviasales)}" target="_blank" rel="noopener">Reservar</a>
      </div></div>`;
  }).join('') : '<p class="muted">Sin datos todavía. Añade destinos y pulsa «Escanear ahora».</p>';
  $('#changes').innerHTML = changes.length ? changes.map((c) => `
    <div class="item"><div class="grow"><b>${esc(c.origin)} → ${esc(c.name)}</b> · ${esc(c.date_label)}<br>
      <span class="muted">${money(c.prev_price)} → <b>${money(c.price)}</b> · ${ago(c.seen_at)}</span></div>
      <span class="${c.pct < 0 ? 'down' : 'up'}">${c.pct < 0 ? '▼' : '▲'} ${Math.abs(c.pct).toFixed(0)}%</span></div>`).join('')
    : '<p class="muted">Aún no se han detectado cambios (aparecen a partir del segundo escaneo).</p>';
  $('#lastAlerts').innerHTML = alerts.length ? alerts.map(alertItem).join('') : '<p class="muted">Sin alertas todavía.</p>';
}
function alertItem(a) {
  const [label, cls] = KIND[a.kind] || [a.kind, 'neutral'];
  return `<div class="item ${a.read ? '' : 'unread'}"><span class="pill ${cls}">${esc(label)}</span>
    <div class="grow">${esc(a.message)}<div class="links">${linksHtml(a.links, a.link)}
    <a href="#" data-day="${esc(a.origin)}|${esc(a.destination)}|${esc(a.depart_date)}">Detalle</a></div>
    <span class="muted">${ago(a.created_at)}</span></div></div>`;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cal]');
  if (c) { e.preventDefault(); const [o, d] = c.dataset.cal.split('|'); calTarget = { o, d }; showTab('calendar'); }
  const dd = e.target.closest('[data-day]');
  if (dd) { e.preventDefault(); const [o, d, day] = dd.dataset.day.split('|'); openDay(o, d, day); }
});

/* ---------------- Detalle de un día ---------------- */
async function openDay(o, d, day) {
  const [cal, hist] = await Promise.all([
    api(`/api/calendar?origin=${o}&destination=${d}`), api(`/api/quote-history?origin=${o}&destination=${d}&date=${day}`)]);
  const q = cal.quotes.find((x) => x.depart_date === day);
  const links = q ? q.links : bookingLinks(o, d, day);
  const pct = q && cal.median ? Math.round((1 - q.price / cal.median) * 100) : null;
  $('#modalBody').innerHTML = `
    <h2 style="margin-top:0">${esc(o)} → ${esc(cal.destination.name)} (${esc(d)})</h2>
    <p class="muted">${esc(dlabel(day))}${q && q.return_date ? ' · vuelta ' + esc(dlabel(q.return_date)) : ''}</p>
    ${q ? `<div class="hero" style="grid-template-columns:1fr 1fr">
      <div><div class="big">${money(q.price)}</div>
        ${pct != null ? `<span class="pill ${pct >= 20 ? 'good' : pct >= 0 ? 'neutral' : 'bad'}">${pct >= 0 ? '−' + pct : '+' + -pct}% vs. habitual ${money(cal.median)}</span>` : ''}
        <p class="muted">${q.airline ? 'Aerolínea ' + esc(q.airline) + ' · ' : ''}${q.transfers === 0 ? 'Directo' : q.transfers != null ? q.transfers + ' escala(s)' : ''}<br>
        Antes: ${money(q.prev_price)} · Mínimo visto: ${money(q.lowest_price)}<br>Actualizado ${ago(q.updated_at)}</p></div>
      <div><p><b>Reservar / comparar:</b></p><div class="links">${linksHtml(links, q.link)}</div></div></div>` : '<p class="muted">Sin precio para este día.</p>'}
    <h3>Evolución del precio de este día</h3><div class="chart" id="dayHist"></div>
    <div class="inline-form" style="margin-top:12px">
      <label>Precio objetivo (opcional)<input id="watchTarget" type="number" min="0" placeholder="${cur()}"></label>
      <button class="btn primary" id="watchBtn">Vigilar este vuelo</button>
      ${state.status?.live_check ? '<button class="btn" id="liveBtn">Comprobar precio real (Google Flights)</button>' : '<span class="muted">Añade una clave de SerpApi en Ajustes para comprobar el precio en vivo y ver el histórico de Google.</span>'}
    </div>
    <div id="liveResult"></div>`;
  $('#modal').hidden = false;
  lineChart($('#dayHist'), [{ name: 'Precio', color: 'var(--accent)', data: hist.map((h) => ({ x: h.seen_at.slice(0, 16), y: h.price })) }],
    { height: 180, xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
  $('#watchBtn').onclick = async () => {
    await api('/api/watches', { method: 'POST', body: { origin: o, destination: d, date: day, target_price: $('#watchTarget').value } });
    toast('Vuelo añadido a Vigilados');
  };
  const lb = $('#liveBtn');
  if (lb) lb.onclick = () => liveCheck(o, d, day, q && q.return_date, $('#liveResult'), lb);
}
async function liveCheck(o, d, day, ret, box, btn) {
  btn.disabled = true; box.innerHTML = '<p class="muted">Consultando Google Flights…</p>';
  try {
    const r = await api('/api/live-check', { method: 'POST', body: { origin: o, destination: d, date: day, return_date: ret } });
    const lvl = { low: ['bajo', 'good'], typical: ['normal', 'warn'], high: ['alto', 'bad'] }[r.price_level] || [r.price_level || '—', 'neutral'];
    box.innerHTML = `<h3>Precio real ahora: ${money(r.lowest_price)} <span class="pill ${lvl[1]}">Google: precio ${esc(lvl[0])}</span></h3>
      ${r.typical_range ? `<p class="muted">Rango habitual según Google: ${money(r.typical_range[0])} – ${money(r.typical_range[1])}</p>` : ''}
      ${r.advice ? `<div class="verdict ${r.advice.level}">${esc(r.advice.verdict)}</div><ul class="reasons">${r.advice.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${r.history.length ? '<h3>Histórico de Google Flights</h3><div class="chart" id="gHist"></div>' : ''}
      <table class="flights"><tr><th>Precio</th><th>Aerolínea</th><th>Escalas</th><th>Salida</th><th>Duración</th></tr>
      ${r.flights.map((f) => `<tr><td><b>${money(f.price)}</b></td><td>${esc(f.airlines.join(', '))}</td><td>${f.stops}</td><td>${esc(f.departure || '')}</td><td>${f.duration_min ? Math.floor(f.duration_min / 60) + 'h ' + (f.duration_min % 60) + 'm' : ''}</td></tr>`).join('')}</table>
      ${r.google_url ? `<p><a href="${esc(r.google_url)}" target="_blank" rel="noopener">Abrir en Google Flights</a></p>` : ''}`;
    if (r.history.length) lineChart($('#gHist'), [{ name: 'Google', color: 'var(--good)', data: r.history.map((h) => ({ x: new Date(h.t * 1000).toISOString().slice(0, 10), y: h.price })) }], { height: 170, xFmt: (x) => dlabel(x).split(',')[1] || x });
  } catch (e) { box.innerHTML = `<p class="up">${esc(e.message)}</p>`; }
  btn.disabled = false;
}
$('#modalClose').onclick = () => ($('#modal').hidden = true);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

/* ---------------- Mejor día ---------------- */
async function prepSearch() {
  if (!state.settings) state.settings = await api('/api/settings');
  const sel = $('#sOrigin');
  if (!sel.options.length) {
    const own = state.settings.origins;
    sel.innerHTML = `<option value="mine">Mis orígenes (${esc(own.join(', '))})</option><option value="ES">Toda España (${12} aeropuertos)</option>` +
      [...new Set([...own, 'MAD', 'BCN', 'AGP', 'PMI', 'ALC', 'VLC', 'SVQ', 'BIO', 'LPA', 'TCI', 'IBZ', 'SCQ'])].map((c) => `<option value="${c}">${esc(cityName(c))} (${c})</option>`).join('');
  }
}
function resolveDest(text) {
  const t = text.trim();
  if (!t) return {};
  const code = t.match(/\(([A-Z]{3})\)\s*$/);
  if (code) return { destinations: [code[1]] };
  if (/^[A-Za-z]{3}$/.test(t)) return { destinations: [t.toUpperCase()] };
  const low = t.toLowerCase();
  const country = state.countries.find((c) => c.country.toLowerCase() === low || `${c.country.toLowerCase()} (país)` === low);
  if (country) return { country: country.country_code };
  const city = state.catalog.find((c) => c.name.toLowerCase() === low) || state.catalog.find((c) => c.name.toLowerCase().includes(low));
  if (city) return { destinations: [city.code] };
  return {};
}
$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dest = resolveDest($('#sDest').value);
  if (!dest.destinations && !dest.country) { toast('No reconozco ese destino. Usa un código IATA de 3 letras.'); return; }
  const body = { origins: $('#sOrigin').value, ...dest, date_from: $('#sFrom').value, date_to: $('#sTo').value };
  if (!['mine', 'ES'].includes(body.origins)) body.origins = [body.origins];
  const box = $('#searchProgress'); box.hidden = false; $('#searchResult').innerHTML = '';
  try {
    let job = await api('/api/search', { method: 'POST', body });
    while (job.status === 'running') {
      $('.bar', box).style.width = `${job.total ? (job.done / job.total) * 100 : 5}%`;
      $('span', box).textContent = `Buscando ${job.current || ''}… (${job.done}/${job.total} rutas)`;
      await new Promise((r) => setTimeout(r, 700));
      job = await api(`/api/search/${job.id}`);
    }
    box.hidden = true;
    if (job.status === 'error') throw new Error(job.error);
    renderSearch(job.result);
  } catch (err) { box.hidden = true; $('#searchResult').innerHTML = `<p class="up">${esc(err.message)}</p>`; }
});
function renderSearch(r) {
  if (!r.found) { $('#searchResult').innerHTML = `<div class="empty"><h3>Sin precios para esa búsqueda</h3><p class="muted">Puede que no haya datos recientes para esa ruta. ${r.errors.length ? esc(r.errors[0]) : ''}</p></div>`; return; }
  const b = r.best, a = r.advice, pct = Math.round(b.savings * 100);
  $('#searchResult').innerHTML = `
    <div class="panel hero">
      <div>
        <div class="muted">Día más barato encontrado</div>
        <div class="big">${money(b.price)}</div>
        <p><b>${esc(b.date_label)}</b>${b.return_date ? ' · vuelta ' + esc(dlabel(b.return_date)) : ''}<br>
        ${esc(b.origin)} → ${esc(b.dest_name)} (${esc(b.destination)}) · ${b.transfers === 0 ? 'directo' : b.transfers != null ? b.transfers + ' escala(s)' : ''}${b.airline ? ' · ' + esc(b.airline) : ''}</p>
        <p class="muted">Precio mediano del periodo: ${money(r.median)} ${pct > 0 ? `· <span class="down">−${pct}%</span>` : ''}</p>
        <div class="links">${linksHtml(b.links, b.link)}</div>
        <div class="inline-form" style="margin-top:10px">
          <button class="btn primary" data-day="${esc(b.origin)}|${esc(b.destination)}|${esc(b.depart_date)}">Detalle / vigilar</button>
          <button class="btn" data-cal="${esc(b.origin)}|${esc(b.destination)}">Ver calendario</button>
        </div>
      </div>
      <div>
        <div class="verdict ${a.level}">${esc(a.verdict)}</div>
        <ul class="reasons">${a.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="muted">Consejo orientativo basado en los precios del año, el histórico registrado y patrones típicos de antelación.${r.provider === 'demo' ? ' <b>Datos simulados (modo demo).</b>' : ''}</p>
      </div>
    </div>
    <h3>Precio más barato de cada día</h3>
    <p class="muted">Pulsa en el gráfico para ver el detalle de un día.</p>
    <div class="chart" id="yearChart"></div>
    <div class="two-col">
      <div><h3>Los 15 días más baratos</h3><div class="table-wrap"><table>
        <tr><th>Fecha</th><th>Ruta</th><th>Precio</th><th></th></tr>
        ${r.top.map((t) => `<tr><td>${esc(t.date_label)}</td><td>${esc(t.origin)} → ${esc(t.destination)}</td><td><b>${money(t.price)}</b></td>
          <td><a href="#" data-day="${esc(t.origin)}|${esc(t.destination)}|${esc(t.depart_date)}">detalle</a></td></tr>`).join('')}
      </table></div></div>
      <div><h3>El mejor día de cada mes</h3><div class="chart" id="monthChart"></div></div>
    </div>`;
  const lo = Math.min(...r.days.map((d) => d.price)), hi = Math.max(...r.days.map((d) => d.price));
  lineChart($('#yearChart'), [{ name: '', color: 'var(--accent)', data: r.days.map((d) => ({ x: d.date, y: d.price, label: `${d.origin}→${d.destination}`, color: colorFor(d.price, lo, hi) })) }],
    { bars: true, xFmt: (x, full) => full ? dlabel(x) : MONTHS[+x.slice(5, 7) - 1].slice(0, 3), onClick: (x) => { const d = r.days.find((q) => q.date === x); if (d) openDay(d.origin, d.destination, d.date); } });
  lineChart($('#monthChart'), [{ name: '', color: 'var(--accent)', data: r.by_month.map((m) => ({ x: m.depart_date.slice(0, 7), y: m.price, label: `${m.date_label} (${m.origin})`, color: colorFor(m.price, lo, hi) })) }],
    { bars: true, height: 230, xFmt: (x) => MONTHS[+x.slice(5, 7) - 1].slice(0, 3) });
}

/* ---------------- Calendario ---------------- */
let calTarget = null;
async function loadCalendar() {
  const [s, dests] = await Promise.all([api('/api/settings'), api('/api/destinations')]);
  state.settings = s; state.destinations = dests;
  const oSel = $('#cOrigin'), dSel = $('#cDest');
  oSel.innerHTML = s.origins.map((o) => `<option value="${o}">${esc(cityName(o))} (${o})</option>`).join('');
  dSel.innerHTML = dests.map((d) => `<option value="${d.code}">${esc(d.name)} (${d.code})</option>`).join('');
  if (calTarget) {
    if (![...oSel.options].some((x) => x.value === calTarget.o)) oSel.add(new Option(calTarget.o, calTarget.o));
    if (![...dSel.options].some((x) => x.value === calTarget.d)) dSel.add(new Option(cityName(calTarget.d), calTarget.d));
    oSel.value = calTarget.o; dSel.value = calTarget.d; calTarget = null;
  }
  renderCalendar();
}
$('#cOrigin').addEventListener('change', renderCalendar);
$('#cDest').addEventListener('change', renderCalendar);
async function renderCalendar() {
  const o = $('#cOrigin').value, d = $('#cDest').value;
  if (!o || !d) { $('#calendarGrid').innerHTML = '<p class="muted">Añade destinos y orígenes primero.</p>'; return; }
  const [cal, hist] = await Promise.all([api(`/api/calendar?origin=${o}&destination=${d}`), api(`/api/history?origin=${o}&destination=${d}`)]);
  const byDay = new Map(cal.quotes.map((q) => [q.depart_date, q]));
  const prices = cal.quotes.map((q) => q.price).sort((a, b) => a - b);
  const lo = prices[Math.floor(prices.length * 0.05)] ?? 0, hi = prices[Math.floor(prices.length * 0.95)] ?? 1;
  const best = cal.quotes.reduce((m, q) => (!m || q.price < m.price ? q : m), null);
  $('#calSummary').innerHTML = best ? `<div class="panel"><b>${esc(o)} → ${esc(cal.destination.name)}</b>: el día más barato es
    <a href="#" data-day="${o}|${d}|${best.depart_date}"><b>${esc(dlabel(best.depart_date))}</b> por <b>${money(best.price)}</b></a>.
    Precio habitual ${money(cal.median)} · rango ${money(cal.min)} – ${money(cal.max)} · ${cal.quotes.length} días con precio.</div>` : '<p class="muted">Sin precios aún para esta ruta. Pulsa «Escanear ahora».</p>';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let html = '';
  for (let k = 0; k < 13; k++) {
    const first = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const y = first.getFullYear(), m = first.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const mPrices = [];
    let cells = DOW.map((x) => `<div class="dow">${x}</div>`).join('');
    const offset = (first.getDay() + 6) % 7;
    cells += '<div></div>'.repeat(offset);
    for (let dd = 1; dd <= days; dd++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const q = byDay.get(iso);
      if (q) {
        mPrices.push(q.price);
        const ch = q.prev_price ? (q.price < q.prev_price ? ' ▼' : q.price > q.prev_price ? ' ▲' : '') : '';
        cells += `<div class="day ${best && best.depart_date === iso ? 'best' : ''}" style="background:${colorFor(Math.min(Math.max(q.price, lo), hi), lo, hi)}" data-day="${o}|${d}|${iso}" title="${esc(dlabel(iso))}: ${money(q.price)}${ch}"><span class="n">${dd}</span><span class="p">${Math.round(q.price)}</span></div>`;
      } else cells += `<div class="day none"><span class="n">${dd}</span></div>`;
    }
    if (k === 12 && !mPrices.length) break;
    html += `<div class="month"><h4><span>${MONTHS[m]} ${y}</span><span class="muted">${mPrices.length ? 'desde ' + money(Math.min(...mPrices)) : ''}</span></h4><div class="grid">${cells}</div></div>`;
  }
  $('#calendarGrid').innerHTML = html;
  lineChart($('#routeHistory'), [
    { name: 'Mínimo', color: 'var(--good)', data: hist.map((h) => ({ x: h.scanned_at.slice(0, 16), y: h.min_price })) },
    { name: 'Mediana', color: 'var(--muted)', dash: true, data: hist.map((h) => ({ x: h.scanned_at.slice(0, 16), y: h.median_price })) },
  ], { xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
}

/* ---------------- Vigilados ---------------- */
async function loadWatches() {
  const ws = await api('/api/watches');
  $('#watchList').innerHTML = ws.length ? `<div class="table-wrap"><table>
    <tr><th>Fecha</th><th>Ruta</th><th>Precio al vigilar/último aviso</th><th>Precio actual</th><th>Objetivo</th><th></th></tr>
    ${ws.map((w) => {
    const diff = w.current_price != null && w.last_price != null ? w.current_price - w.last_price : 0;
    return `<tr><td>${esc(w.date_label)}</td><td>${esc(w.origin)} → ${esc(w.name)}</td><td>${money(w.last_price)}</td>
      <td><b>${money(w.current_price)}</b> ${diff ? `<span class="${diff < 0 ? 'down' : 'up'}">${diff < 0 ? '▼' : '▲'} ${money(Math.abs(diff))}</span>` : ''}</td>
      <td>${money(w.target_price)}</td>
      <td><a href="#" data-day="${w.origin}|${w.destination}|${w.depart_date}">detalle</a> · <a href="#" data-unwatch="${w.id}">quitar</a></td></tr>`;
  }).join('')}</table></div>` : '<div class="empty"><p>No vigilas ningún vuelo concreto todavía.</p><p class="muted">Abre un día en el calendario o en «Mejor día» y pulsa «Vigilar este vuelo».</p></div>';
}
document.addEventListener('click', async (e) => {
  const u = e.target.closest('[data-unwatch]');
  if (u) { e.preventDefault(); await api(`/api/watches/${u.dataset.unwatch}`, { method: 'DELETE' }); loadWatches(); }
});

/* ---------------- Destinos ---------------- */
async function loadDestinations() {
  const dests = await api('/api/destinations');
  state.destinations = dests;
  $('#countrySel').innerHTML = state.countries.map((c) => `<option value="${c.country_code}">${esc(c.country)} (${c.count})</option>`).join('');
  $('#destList').innerHTML = dests.length ? `<div class="table-wrap"><table>
    <tr><th>Activo</th><th>Destino</th><th>País</th><th>Precio máx.</th><th>Mejor precio</th><th>Días con datos</th><th></th></tr>
    ${dests.map((d) => `<tr>
      <td><input type="checkbox" data-toggle="${d.id}" ${d.enabled ? 'checked' : ''}></td>
      <td><b>${esc(d.name)}</b> <span class="muted">${esc(d.code)}</span></td><td>${esc(d.country)}</td>
      <td><input type="number" min="0" value="${d.max_price ?? ''}" data-max="${d.id}" placeholder="—"></td>
      <td>${money(d.best_price)}</td><td>${d.days}</td>
      <td><a href="#" data-cal="${esc((state.settings?.origins || ['MAD'])[0])}|${esc(d.code)}">calendario</a> · <a href="#" data-del="${d.id}" class="up">borrar</a></td></tr>`).join('')}
  </table></div>` : '<p class="muted">Todavía no tienes destinos favoritos.</p>';
}
$('#addDest').addEventListener('click', async () => {
  const r = resolveDest($('#destInput').value);
  try {
    if (r.country) await api('/api/destinations/country', { method: 'POST', body: { country_code: r.country } });
    else if (r.destinations) await api('/api/destinations', { method: 'POST', body: { code: r.destinations[0], max_price: $('#destMax').value } });
    else throw new Error('Destino no reconocido');
    $('#destInput').value = ''; $('#destMax').value = ''; toast('Destino añadido. Se incluirá en el próximo escaneo.'); loadDestinations();
  } catch (e) { toast(e.message); }
});
$('#addCountry').addEventListener('click', async () => {
  await api('/api/destinations/country', { method: 'POST', body: { country_code: $('#countrySel').value } });
  toast('País añadido'); loadDestinations();
});
$('#destList').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.toggle) await api(`/api/destinations/${t.dataset.toggle}`, { method: 'PATCH', body: { enabled: t.checked } });
  if (t.dataset.max) { await api(`/api/destinations/${t.dataset.max}`, { method: 'PATCH', body: { max_price: t.value } }); toast('Precio máximo guardado'); }
});
$('#destList').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-del]');
  if (d) { e.preventDefault(); await api(`/api/destinations/${d.dataset.del}`, { method: 'DELETE' }); loadDestinations(); }
});

/* ---------------- Alertas ---------------- */
async function loadAlerts() {
  const alerts = await api('/api/alerts?limit=200');
  $('#alertList').innerHTML = alerts.length ? alerts.map(alertItem).join('') : '<p class="muted">No hay alertas.</p>';
}
$('#markRead').onclick = async () => { await api('/api/alerts/read', { method: 'POST' }); loadAlerts(); refreshStatus(); };
$('#clearAlerts').onclick = async () => { await api('/api/alerts', { method: 'DELETE' }); loadAlerts(); refreshStatus(); };

/* ---------------- Ajustes ---------------- */
let originsDraft = [];
async function loadSettings() {
  const s = await api('/api/settings');
  state.settings = s; originsDraft = [...s.origins];
  const f = $('#settingsForm');
  for (const el of f.elements) {
    if (!el.name || !(el.name in s)) continue;
    el.value = typeof s[el.name] === 'boolean' ? String(s[el.name]) : s[el.name];
  }
  renderOrigins();
}
function renderOrigins() {
  $('#originChips').innerHTML = originsDraft.map((o) => `<span class="chip">${esc(cityName(o))} (${o})<button type="button" data-rm="${o}" aria-label="Quitar">×</button></span>`).join('') || '<span class="muted">Sin orígenes</span>';
}
$('#originChips').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { originsDraft = originsDraft.filter((o) => o !== b.dataset.rm); renderOrigins(); } });
$('#addOrigin').onclick = () => {
  const r = resolveDest($('#originInput').value);
  const codes = r.destinations || (r.country ? state.catalog.filter((c) => c.country_code === r.country).map((c) => c.code) : []);
  if (!codes.length) { toast('Origen no reconocido'); return; }
  originsDraft = [...new Set([...originsDraft, ...codes])]; $('#originInput').value = ''; renderOrigins();
};
$('#spainOrigins').onclick = async () => {
  const sp = await api('/api/catalog/spain-origins');
  originsDraft = [...new Set([...originsDraft, ...sp.map((c) => c.code)])]; renderOrigins();
  toast('Añadidos los principales aeropuertos de España. Más orígenes = escaneos más largos.');
};
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { origins: originsDraft };
  for (const el of e.target.elements) if (el.name) body[el.name] = el.value;
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body });
    $('#saveMsg').textContent = 'Guardado ✓'; setTimeout(() => ($('#saveMsg').textContent = ''), 2500);
    $('#sOrigin').innerHTML = ''; refreshStatus();
  } catch (err) { toast(err.message); }
});
$('#testNotif').onclick = async () => {
  $('#testResult').textContent = 'Enviando… (guarda antes los cambios)';
  const r = await api('/api/settings/test-notification', { method: 'POST' });
  $('#testResult').textContent = r.error || Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ');
};

/* ---------------- Inicio ---------------- */
(async function init() {
  const [cat, countries, settings] = await Promise.all([api('/api/catalog?limit=500'), api('/api/catalog/countries'), api('/api/settings')]);
  state.catalog = cat; state.countries = countries; state.settings = settings;
  $('#catalogList').innerHTML = cat.map((c) => `<option value="${esc(c.name)} (${c.code})">${esc(c.country)}</option>`).join('') +
    countries.map((c) => `<option value="${esc(c.country)} (país)">${c.count} ciudad(es)</option>`).join('');
  refreshStatus().catch(() => {});
  const start = location.hash.slice(1);
  showTab($(`#tab-${start}`) ? start : 'dashboard');
})();
