/* Flight Tracker — núcleo: API, utilidades, iconos, gráficos, componentes */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = { settings: null, status: null, meta: null, catalog: [], countries: [], destinations: [], view: 'home', last: {} };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MON3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DOW1 = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const KIND = {
  record: ['🏆 Mínimo histórico', 'good'], deal: ['🔥 Chollo', 'hot'], target: ['🎯 Bajo tu precio', 'good'],
  drop: ['📉 Bajada', 'brand'], watch_down: ['👀 Vigilado ↓', 'good'], watch_up: ['👀 Vigilado ↑', 'bad'],
};
const LEVEL = { low: ['Precio bajo', 'good'], typical: ['Precio normal', 'neutral'], high: ['Precio alto', 'bad'] };

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const o = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts };
  if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
  const r = await fetch(path, o);
  if (r.status === 401 && !path.includes('/login')) { location.href = '/login'; throw new Error('Sesión caducada'); }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

/* ---------- formato ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sym = () => ({ eur: '€', usd: '$', gbp: '£' }[S.settings?.currency || 'eur'] || '€');
const money = (v) => (v == null || isNaN(v) ? '—' : `${Math.round(v).toLocaleString('es-ES')} ${sym()}`);
const pct = (v) => `${v > 0 ? '−' : '+'}${Math.abs(Math.round(v * 100))}%`;
const d8 = (iso) => new Date(iso + 'T12:00:00');
const dshort = (iso) => { const d = d8(iso); return `${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]}`; };
const dlong = (iso) => d8(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const addDays = (iso, n) => { const d = d8(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayIso = () => new Date().toISOString().slice(0, 10);
const ago = (iso) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};
const until = (iso) => {
  if (!iso) return '—';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s < 60) return 'en breve';
  if (s < 3600) return `en ${Math.round(s / 60)} min`;
  return `en ${Math.round(s / 3600)} h`;
};
const cityName = (code) => (S.catalog.find((c) => c.code === code) || {}).name || code;
const cityInfo = (code) => S.catalog.find((c) => c.code === code) || { code, name: code, country: '', country_code: '' };
const stops = (n) => (n === 0 ? 'Directo' : n == null ? '' : `${n} escala${n > 1 ? 's' : ''}`);
const tripLabel = (t) => (t === 'rt' ? 'Ida y vuelta' : 'Solo ida');
const pax = () => Math.max(1, +(S.settings?.passengers || 1));

/* ---------- iconos (trazos estilo Lucide, licencia ISC) ---------- */
const ICONS = {
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  swap: '<path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>',
  bag: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V4h6v3M9 11v6M15 11v6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  map: '<path d="m9 3-6 3v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
};
const ic = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
function paintIcons(root = document) { $$('[data-icon]', root).forEach((el) => { if (!el.dataset.painted) { el.innerHTML = ic(el.dataset.icon); el.dataset.painted = 1; } }); }

/* ---------- banderas (imágenes: Windows no muestra emojis de banderas) ---------- */
const flag = (cc) => cc ? `<img class="flag" loading="lazy" alt="${esc(cc)}" src="https://flagcdn.com/w40/${esc(cc.toLowerCase())}.png" onerror="this.outerHTML='<span class=&quot;flag&quot;>${esc(cc)}</span>'">` : '<span class="flag">✈</span>';

/* ---------- avisos ---------- */
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------- modal / hoja ---------- */
function openSheet(html, onClose) {
  $('#sheet').innerHTML = html; paintIcons($('#sheet'));
  $('#modal').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  openSheet._onClose = onClose;
  $('#sheet').scrollTop = 0;
}
function closeSheet() {
  $('#modal').classList.add('hidden'); document.body.style.overflow = '';
  closeMenus();
  if (openSheet._onClose) openSheet._onClose();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- escala de color de precio: divergente azul (barato) · gris (habitual) · rojo (caro) ---------- */
function hex2rgb(h) { h = h.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function priceColor(price, median, lo, hi) {
  const cheap = hex2rgb(cssVar('--cheap-strong')), mid = hex2rgb(cssVar('--mid')), exp = hex2rgb(cssVar('--exp-strong'));
  let t, a, b;
  if (price <= median) { t = median > lo ? (median - price) / (median - lo) : 0; a = mid; b = cheap; }
  else { t = hi > median ? (price - median) / (hi - median) : 0; a = mid; b = exp; }
  t = Math.max(0, Math.min(1, t));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return { bg: `rgb(${c.join(',')})`, fg: lum > 0.55 ? '#111827' : '#ffffff' };
}

/* ---------- gráficos SVG con tooltip ---------- */
function chart(el, series, { height = 220, bars = false, yFmt = money, xFmt = (x) => x, tipFmt = null, onClick = null } = {}) {
  el.innerHTML = '';
  const pts = series.flatMap((s) => s.data);
  if (!pts.length) { el.innerHTML = '<p class="muted small">Aún no hay datos suficientes.</p>'; return; }
  el.classList.add('chart');
  const W = Math.max(320, Math.round(el.clientWidth || 800)), H = height, L = 52, R = 10, T = 10, B = 26;
  const xs = [...new Set(pts.map((p) => p.x))].sort();
  const xi = new Map(xs.map((x, i) => [x, i]));
  let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  if (y0 === y1) { y0 *= 0.9; y1 *= 1.1; }
  const pad = (y1 - y0) * 0.1; y0 = bars ? 0 : Math.max(0, y0 - pad); y1 += pad;
  const inset = bars ? (W - L - R) / xs.length / 2 : 0;
  const X = (x) => L + inset + (xs.length === 1 ? (W - L - R) / 2 - inset : (xi.get(x) / (xs.length - 1)) * (W - L - R - 2 * inset));
  const Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, y = Y(v); s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(yFmt(v))}</text>`; }
  const step = Math.max(1, Math.ceil(xs.length / Math.max(4, Math.floor(W / 90))));
  xs.forEach((x, i) => { if (i % step === 0) s += `<text class="ax" x="${X(x)}" y="${H - 7}" text-anchor="middle">${esc(xFmt(x))}</text>`; });
  series.forEach((sr) => {
    if (bars) {
      const bw = Math.max(1.5, ((W - L - R) / xs.length) - (xs.length > 120 ? 0.6 : 2));
      sr.data.forEach((p) => { const y = Y(p.y), h = Math.max(1, H - B - y); s += `<rect x="${X(p.x) - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(4, bw / 2)}" style="fill:${p.color || sr.color}"/>`; });
    } else {
      const d = sr.data.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      s += `<path d="${d}" style="fill:none;stroke:${sr.color}" stroke-width="2" ${sr.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    }
  });
  s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = s + '<div class="tip hidden"></div>';
  const tip = $('.tip', el), svg = $('svg', el), xh = $('.xh', el);
  const near = (ev) => { const r = svg.getBoundingClientRect(); const vx = ((ev.clientX - r.left) / r.width) * W; const i = Math.round(((vx - L - inset) / (W - L - R - 2 * inset)) * (xs.length - 1)); return xs[Math.max(0, Math.min(xs.length - 1, i))]; };
  svg.addEventListener('mousemove', (ev) => {
    const x = near(ev), r = svg.getBoundingClientRect();
    const rows = series.map((sr) => { const p = sr.data.find((q) => q.x === x); return p ? (tipFmt ? tipFmt(p, sr) : `${sr.name ? esc(sr.name) + ': ' : ''}<b>${esc(yFmt(p.y))}</b>`) : null; }).filter(Boolean);
    tip.innerHTML = `<div class="tiny" style="opacity:.8">${esc(xFmt(x, true))}</div>${rows.join('<br>')}`;
    tip.classList.remove('hidden');
    const p0 = series[0].data.find((q) => q.x === x);
    const tl = (X(x) / W) * r.width, tw = tip.offsetWidth || 120; tip.style.left = `${Math.max(tw / 2, Math.min(r.width - tw / 2, tl))}px`; tip.style.top = `${((p0 ? Y(p0.y) : T) / H) * r.height}px`;
    xh.setAttribute('x1', X(x)); xh.setAttribute('x2', X(x)); xh.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); xh.setAttribute('visibility', 'hidden'); });
  if (onClick) { svg.style.cursor = 'pointer'; svg.addEventListener('click', (ev) => onClick(near(ev))); }
}
function sparkline(values, w = 220, h = 28) {
  if (!values || values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), n = values.length;
  const pts = values.map((v, i) => `${(i / (n - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)}`);
  const minI = values.indexOf(lo);
  const [mx, my] = pts[minI].split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" style="fill:none;stroke:var(--series-1)" stroke-width="1.6"/><circle cx="${mx}" cy="${my}" r="3" style="fill:var(--series-1)"/></svg>`;
}

/* ---------- capas flotantes (se pintan sobre todo, nunca quedan tapadas) ---------- */
function floatAt(el, anchor, { width = null, align = 'left' } = {}) {
  const place = () => {
    if (!document.body.contains(anchor)) { el.remove(); return; }
    const r = anchor.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    const w = width || Math.max(r.width, 260);
    el.style.width = `${Math.min(w, vw - 16)}px`;
    let left = align === 'right' ? r.right - Math.min(w, vw - 16) : r.left;
    left = Math.max(8, Math.min(left, vw - Math.min(w, vw - 16) - 8));
    el.style.left = `${left}px`;
    const below = vh - r.bottom - 8, above = r.top - 8;
    const h = Math.min(el.scrollHeight, 340);
    if (below < h && above > below) { el.style.top = ''; el.style.bottom = `${vh - r.top + 4}px`; el.style.maxHeight = `${Math.min(340, above)}px`; }
    else { el.style.bottom = ''; el.style.top = `${r.bottom + 4}px`; el.style.maxHeight = `${Math.max(160, Math.min(340, below))}px`; }
  };
  el.classList.add('floating'); document.body.appendChild(el); place();
  const onMove = () => place();
  window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove);
  el._cleanup = () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); el.remove(); };
  return el;
}
function popMenu(anchor, html) {
  closeMenus();
  const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html;
  floatAt(m, anchor, { width: 230 });
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }));
  return m;
}
function closeMenus() { $$('.menu.floating').forEach((m) => (m._cleanup ? m._cleanup() : m.remove())); }

/* ---------- autocompletar ciudades/países ---------- */
function attachAC(input, { countries = true, anywhere = false, onPick } = {}) {
  let list = null, items = [], idx = -1;
  const close = () => { if (list) { list._cleanup(); list = null; } idx = -1; };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = [];
    if (anywhere && (!q || 'cualquier destino'.includes(q))) items.push({ type: 'any', label: '🌍 Cualquier destino', sub: 'Explorar todo', value: 'Cualquier destino' });
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nq = norm(q);
    const score = (c) => { const n = norm(c.name), k = c.code.toLowerCase(), co = norm(c.country);
      if (k === nq) return 0; if (n.startsWith(nq)) return 1; if (co.startsWith(nq)) return 2; if (n.split(/[\s(]+/).some((w) => w.startsWith(nq))) return 3; if (n.includes(nq)) return 4; if (co.includes(nq)) return 5; return 9; };
    const cities = (q ? S.catalog.map((c) => [score(c), c]).filter(([sc]) => sc < 9).sort((a, b) => a[0] - b[0]).map(([, c]) => c) : S.catalog).slice(0, 8);
    cities.forEach((c) => items.push({ type: 'city', c, label: c.name, sub: c.country, value: `${c.name} (${c.code})` }));
    if (countries) S.countries.filter((c) => q && norm(c.country).includes(nq)).slice(0, 4)
      .forEach((c) => items.push({ type: 'country', cc: c.country_code, label: `${c.country} · todo el país`, sub: `${c.count} ciudades`, value: `${c.country} (país)` }));
    if (/^[a-z]{3}$/i.test(q) && !cities.some((c) => c.code.toLowerCase() === q)) items.push({ type: 'code', label: `Usar código ${q.toUpperCase()}`, value: q.toUpperCase() });
    if (!items.length) return close();
    const html = items.map((it, i) => `<div data-i="${i}" class="${i === idx ? 'on' : ''}">${it.type === 'city' ? flag(it.c.country_code) : it.type === 'country' ? flag(it.cc) : '<span class="flag">✈</span>'}<span class="lbl"><b>${esc(it.label)}</b>${it.sub ? `<span class="muted"> · ${esc(it.sub)}</span>` : ''}</span>${it.c ? `<span class="code">${it.c.code}</span>` : ''}</div>`).join('');
    if (!list) {
      list = document.createElement('div'); list.className = 'ac-list'; list.innerHTML = html;
      list.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(+d.dataset.i); } });
      floatAt(list, input);
    } else { list.innerHTML = html; }
    const on = $('.on', list); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = it.value; close(); onPick && onPick(it); input.dispatchEvent(new Event('change')); };
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => { idx = -1; render(); });
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('keydown', (e) => {
    if (!list) return;
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(idx >= 0 ? idx : 0); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
function resolvePlace(text) {
  const t = (text || '').trim();
  if (!t || /^cualquier destino$/i.test(t)) return { any: true };
  const m = t.match(/\(([A-Z]{3})\)\s*$/); if (m) return { destinations: [m[1]] };
  if (/^[A-Za-z]{3}$/.test(t)) return { destinations: [t.toUpperCase()] };
  const low = t.toLowerCase().replace(/\s*\(país\)$/, '');
  const c = S.countries.find((x) => x.country.toLowerCase() === low); if (c) return { country: c.country_code };
  const city = S.catalog.find((x) => x.name.toLowerCase() === low) || S.catalog.find((x) => x.name.toLowerCase().startsWith(low));
  if (city) return { destinations: [city.code] };
  return {};
}

/* ---------- equipaje ---------- */
const BAG_ICON = { included: '✓', fee: '€', depends: '¿?' };
function bagLine(b) {
  if (!b) return '';
  const extra = b.fee_est ? ` · equipaje ≈ ${money(b.fee_est)}` : ' · equipaje incluido';
  return `<div class="bagline" title="Estimación según la política habitual de ${esc(b.airline)}">🎒 ✓ · 🧳 cabina ${BAG_ICON[b.cabin]} · 🛄 facturada ${BAG_ICON[b.checked]}${b.option !== 'personal' ? extra : ''}</div>`;
}

/* ---------- exportar / compartir / calendario ---------- */
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toCSV(rows, cols) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [cols.map((c) => q(c[0])).join(';'), ...rows.map((r) => cols.map((c) => q(c[1](r))).join(';'))].join('\n');
}
function icsEvent({ title, start, end, desc, url }) {
  const f = (iso) => iso.replace(/-/g, '');
  const e = end ? f(addDays(end, 1)) : f(addDays(start, 1));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FlightTracker//ES', 'BEGIN:VEVENT', `UID:${Date.now()}@flighttracker`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${f(start)}`, `DTEND;VALUE=DATE:${e}`,
    `SUMMARY:${title}`, `DESCRIPTION:${(desc || '').replace(/\n/g, '\\n')}`, url ? `URL:${url}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
async function shareText(title, text, url) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { /* cancelado */ } }
  try { await navigator.clipboard.writeText(`${text}\n${url || ''}`); toast('Copiado al portapapeles'); } catch (e) { prompt('Copia el texto:', `${text} ${url || ''}`); }
}

/* ---------- tema ---------- */
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('ft-theme', t || 'auto'); } catch (e) { /* sin almacenamiento */ }
}
(function () { let t = 'auto'; try { t = localStorage.getItem('ft-theme') || 'auto'; } catch (e) { /* */ } applyTheme(t); })();
function cycleTheme() {
  let t = 'auto'; try { t = localStorage.getItem('ft-theme') || 'auto'; } catch (e) { /* */ }
  const next = { auto: 'dark', dark: 'light', light: 'auto' }[t];
  applyTheme(next); toast(`Tema: ${{ auto: 'automático', dark: 'oscuro', light: 'claro' }[next]}`);
  if (S.view) route(true);
}

/* ---------- selector de viajeros y equipaje ---------- */
function paxBagControl(id, p = pax(), bag = S.settings?.baggage || 'personal') {
  const opts = Object.entries(S.meta?.baggage_options || {}).map(([k, v]) => `<option value="${k}" ${k === bag ? 'selected' : ''}>${esc(v)}</option>`).join('');
  return `<div class="row" id="${id}">
    <span class="small muted">Viajeros</span>
    <span class="stepper"><button type="button" data-pax="-1">−</button><span data-paxv>${p}</span><button type="button" data-pax="1">+</button></span>
    <select data-bag style="width:auto">${opts}</select></div>`;
}
function readPaxBag(root) { return { pax: +$('[data-paxv]', root).textContent, baggage: $('[data-bag]', root).value }; }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pax]'); if (!b) return;
  const v = $('[data-paxv]', b.parentElement); v.textContent = Math.max(1, Math.min(9, +v.textContent + +b.dataset.pax));
  v.dispatchEvent(new Event('change', { bubbles: true }));
});

/* ---------- piezas visuales ---------- */
const REGION_NAMES = { EU: 'Europa', AF: 'África', ME: 'Oriente Medio', NA: 'Norteamérica', LA: 'Latinoamérica', AS: 'Asia', OC: 'Oceanía' };
const rg = (region) => `rg-${region || 'EU'}`;
function meter(price, range, { labels = true } = {}) {
  if (!range || range[2] <= range[0]) return '';
  const [lo, med, hi] = range;
  const pos = Math.max(0, Math.min(100, ((price - lo) / (hi - lo)) * 100));
  const mpos = Math.max(0, Math.min(100, ((med - lo) / (hi - lo)) * 100));
  return `<div class="meter" title="Mínimo ${money(lo)} · habitual ${money(med)} · máximo ${money(hi)}">
    <div class="bar"><i class="med" style="left:${mpos}%"></i><i class="dot" style="left:${pos}%"></i></div>
    ${labels ? `<div class="lbls"><span>${money(lo)}</span><span>habitual ${money(med)}</span><span>${money(hi)}</span></div>` : ''}</div>`;
}
function bagChips(b) {
  if (!b) return '';
  const c = (st, icon, name) => `<span class="bchip ${st === 'included' ? 'inc' : st === 'fee' ? 'fee' : 'dep'}" title="${name}: ${st === 'included' ? 'incluida' : st === 'fee' ? 'de pago' : 'según tarifa'}">${icon}${st === 'included' ? '✓' : st === 'fee' ? '€' : '?'}</span>`;
  return `<span class="bchips">${c('included', '🎒', 'Mochila')}${c(b.cabin, '🧳', 'Maleta de cabina')}${c(b.checked, '🛄', 'Maleta facturada')}</span>`;
}
function dateChip(d, r, n) {
  return `<span class="datechip">📅 ${esc(dshort(d))}${r ? ` <b>→</b> ${esc(dshort(r))} <em>${n ?? ''}${n != null ? 'n' : ''}</em>` : ''}</span>`;
}
function saveBadge(s) { if (!s || s < 0.05) return ''; return `<span class="savebadge ${s >= 0.3 ? 'big' : ''}">−${Math.round(s * 100)}%</span>`; }
function scoreRing(score, level, size = 84) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score || 0));
  const col = { buy: 'var(--good)', good: 'var(--good)', watch: 'var(--warn)', wait: 'var(--bad)' }[level] || 'var(--brand)';
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Puntuación ${v} de 100">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" style="fill:none;stroke:var(--surface-3)" stroke-width="7"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" style="fill:none;stroke:${col}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" style="fill:var(--ink);font-weight:900;font-size:${size / 3.4}px">${v}</text></svg>`;
}
function pointsList(points) {
  return `<ul class="points">${(points || []).map((p) => `<li class="${p.tone}"><i>${p.tone === 'good' ? '✓' : p.tone === 'bad' ? '!' : 'i'}</i>${esc(p.t)}</li>`).join('')}</ul>`;
}
function verdictBox(a) {
  if (!a) return '';
  return `<div class="verdictbox ${a.level}">${scoreRing(a.score, a.level)}<div><div class="vt">${a.level === 'buy' ? '🔥' : a.level === 'good' ? '👍' : a.level === 'watch' ? '👀' : '⏳'} ${esc(a.verdict)}</div><div class="tiny muted">Puntuación del chollo</div></div></div>${pointsList(a.points)}`;
}
function weekStrip(start, end, holidays) {
  const out = []; let d = start;
  const hs = new Set(holidays || []);
  const from = addDays(start, -1), to = addDays(end, 1);
  d = from;
  while (d <= to) {
    const wd = d8(d).getDay(), inside = d >= start && d <= end;
    const cls = !inside ? 'out' : hs.has(d) ? 'hol' : (wd === 0 || wd === 6) ? 'we' : 'off';
    out.push(`<span class="${cls}" title="${esc(dlong(d))}"><b>${['D', 'L', 'M', 'X', 'J', 'V', 'S'][wd]}</b>${d8(d).getDate()}</span>`);
    d = addDays(d, 1);
  }
  return `<div class="wk">${out.join('')}</div>`;
}
