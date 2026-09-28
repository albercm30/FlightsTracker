/* Flight Tracker — «modo estático»: la web pública de solo lectura (GitHub Pages).
   Sustituye las llamadas a /api por ficheros JSON generados en cada escaneo y hace
   en el navegador los cálculos que en la app local hace el servidor. */
'use strict';
S.static = !!window.STATIC;

const SD = { cache: {} };
async function sdGet(file, fallback) {
  if (file in SD.cache) return SD.cache[file];
  try {
    const r = await fetch(`data/${file}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    SD.cache[file] = await r.json();
  } catch (e) { SD.cache[file] = fallback; }
  return SD.cache[file];
}

/* ---------- preferencias del visitante (se guardan solo en su navegador) ---------- */
function prefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('ft-prefs') || '{}'); } catch (e) { /* sin almacenamiento */ }
  return { resident_discount: p.resident_discount || '', passengers: +p.passengers || null, baggage: p.baggage || null };
}
function savePrefs(p) { try { localStorage.setItem('ft-prefs', JSON.stringify(p)); } catch (e) { /* */ } }

/* ---------- distancia / equipaje / residente (mismo cálculo que el servidor) ---------- */
function distKm(a, b) {
  const A = S.catalog.find((c) => c.code === a), B = S.catalog.find((c) => c.code === b);
  if (!A || !B || A.lat == null || B.lat == null) return 2500;
  const r = Math.PI / 180, h = Math.sin((B.lat - A.lat) * r / 2) ** 2 + Math.cos(A.lat * r) * Math.cos(B.lat * r) * Math.sin((B.lon - A.lon) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function bagEstimate(code, longHaul, option = 'personal', legs = 1, pax = 1) {
  const all = S.meta.airline_policies || {}, a = all[(code || '').toUpperCase()];
  let p;
  if (!a) p = longHaul ? { name: code || '—', known: false, cabin: 'included', checked: 'depends', cabin_fee: [0, 0], checked_fee: [60, 100] }
    : { name: code || '—', known: false, cabin: 'fee', checked: 'fee', cabin_fee: [10, 35], checked_fee: [20, 50] };
  else {
    p = { name: a.name, known: true, cabin: a.cabin, checked: a.checked, cabin_fee: a.cabin_fee || [0, 0], checked_fee: a.checked_fee || [0, 0], personal_size: a.personal_size };
    if (longHaul) {
      if (a.long_checked) p.checked = a.long_checked;
      if (a.checked_fee_long) p.checked_fee = a.checked_fee_long;
      else if (p.checked !== 'included') p.checked_fee = [Math.max(p.checked_fee[0], 50), Math.max(p.checked_fee[1], 90)];
    }
  }
  let lo = 0, hi = 0;
  if ((option === 'cabin' || option === 'cabin_checked') && p.cabin === 'fee') { lo += p.cabin_fee[0]; hi += p.cabin_fee[1]; }
  if ((option === 'checked' || option === 'cabin_checked') && p.checked !== 'included') { lo += p.checked === 'depends' ? 0 : p.checked_fee[0]; hi += p.checked_fee[1]; }
  const m = Math.max(1, legs) * Math.max(1, pax); lo *= m; hi *= m;
  return { airline: p.name, known: p.known, personal: 'included', cabin: p.cabin, checked: p.checked, personal_size: p.personal_size,
    fee_min: Math.round(lo), fee_max: Math.round(hi), fee_est: hi ? Math.round(lo + (hi - lo) * 0.4) : 0, option };
}
function residentPrice(price, o, d, legs, region) {
  const air = (S.meta.resident_airports || {})[region];
  if (!air) return null;
  const O = cityInfo(o), D = cityInfo(d);
  if (O.country_code !== 'ES' || D.country_code !== 'ES') return null;
  if (!air.includes(o) && !air.includes(d)) return null;
  const tax = Math.min(price * 0.5, (S.meta.tax_per_leg || 12) * legs);
  return Math.round((price - tax) * 0.25 + tax);
}
function hydrate(q, extra = {}, paxN = null, bag = null) {
  const r = { ...q, ...extra };
  const pr = prefs();
  const P = paxN || pr.passengers || S.settings.passengers || 1, B = bag || pr.baggage || S.settings.baggage || 'personal';
  r.trip = r.trip || (r.return_date ? 'rt' : 'ow');
  const info = cityInfo(r.destination);
  Object.assign(r, { dest_name: info.name, dest_cc: info.country_code, dest_region: info.region, dest_country: info.country,
    origin_name: cityInfo(r.origin).name, airline_name: (S.meta.airlines || {})[r.airline] || r.airline || '' });
  if (r.return_date && r.nights == null) r.nights = Math.round((d8(r.return_date) - d8(r.depart_date)) / 86400000);
  r.long_haul = distKm(r.origin, r.destination) > 3800;
  const legs = r.trip === 'rt' ? 2 : 1;
  r.baggage = bagEstimate(r.airline, r.long_haul, B, legs, P);
  r.resident_price = residentPrice(r.price, r.origin, r.destination, legs, pr.resident_discount);
  const base = r.resident_price != null ? r.resident_price : r.price;
  r.pax = P; r.price_total = Math.round(base * P + r.baggage.fee_est); r.price_pp_bags = Math.round(base + r.baggage.fee_est / P);
  return r;
}

/* ---------- consejo (versión cliente) ---------- */
function staticAdvice(price, depart, o, d, prices) {
  const lead = Math.round((d8(depart) - d8(todayIso())) / 86400000), lh = distKm(o, d) > 3800;
  const [lo, hi] = lh ? [60, 170] : [21, 90];
  const s = prices.slice().sort((a, b) => a - b), rank = s.length ? s.filter((x) => x < price).length / s.length : null;
  const points = []; let score = 0;
  if (rank != null) {
    if (rank <= 0.05) { score += 3; points.push({ t: 'Top 5 % más barato del periodo', tone: 'good' }); }
    else if (rank <= 0.2) { score += 2; points.push({ t: 'Top 20 % más barato del periodo', tone: 'good' }); }
    else if (rank <= 0.5) { score += 1; points.push({ t: 'Más barato que la mitad de fechas', tone: 'good' }); }
    else { score -= 1; points.push({ t: 'Hay fechas más baratas', tone: 'bad' }); }
  }
  if (lead < 21) { score += 1; points.push({ t: 'Faltan menos de 3 semanas: suele subir', tone: 'info' }); }
  else if (lead < lo) points.push({ t: 'Recta final: esperar suele salir caro', tone: 'info' });
  else if (lead <= hi) points.push({ t: `Buena ventana de compra (${lo}–${hi} días antes)`, tone: 'good' });
  else { score -= 1; points.push({ t: `Aún es pronto: mejor entre ${lo} y ${hi} días antes`, tone: 'info' }); }
  const [verdict, level] = score >= 3 ? ['¡Cómpralo ya!', 'buy'] : score >= 1 ? ['Buen precio', 'good'] : score >= 0 ? ['Precio normal', 'watch'] : ['Caro: mejor espera', 'wait'];
  const base = rank != null ? (1 - rank) * 100 : 50;
  return { verdict, level, points, score: Math.max(1, Math.min(99, Math.round(base * 0.75 + (score + 2) * 5))), lead_days: lead };
}

/* ---------- búsqueda en el navegador sobre los datos publicados ---------- */
async function staticSearch(p) {
  const st = await sdGet('status.json', {}), routes = new Set((await sdGet('routes.json', { routes: [] })).routes);
  const favs = (await sdGet('destinations.json', [])).map((x) => x.code);
  const origins = !p.origins || p.origins === 'mine' || p.origins === 'ES' ? S.settings.origins : [].concat(p.origins);
  let dests = [];
  if (p.destinations) dests = p.destinations; else if (p.country) dests = S.catalog.filter((c) => c.country_code === p.country).map((c) => c.code);
  if (p.mode === 'explore' && !dests.length) {
    dests = favs;
    if (p.theme && !p.favorites) dests = dests.filter((c) => (S.meta.theme_codes[p.theme] || []).includes(c));
    if (p.region) dests = dests.filter((c) => cityInfo(c).region === p.region);
  }
  dests = dests.filter((c) => favs.includes(c));
  const params = { ...p, trip: p.trip === 'ow' ? 'ow' : 'rt', pax: p.pax || 1, baggage: p.baggage || 'personal' };
  if (!(st.trips || []).includes(params.trip)) params.trip = (st.trips || ['rt'])[0];
  if (!dests.length) return { found: false, params, error: `Esta web solo tiene precios de: ${favs.map(cityName).join(', ')}.` };
  const from = p.date_from || addDays(todayIso(), 1), to = p.date_to || addDays(todayIso(), 365);
  const opts = [];
  for (const o of origins) for (const d of dests) {
    const key = `${o}-${d}-${params.trip}`;
    if (!routes.has(key)) continue;
    const cal = await sdGet(`cal/${key}.json`, { quotes: [] });
    for (const q of cal.quotes) {
      if (q.depart_date < from || q.depart_date > to) continue;
      const wd = (d8(q.depart_date).getDay() + 6) % 7;
      if (p.weekdays && p.weekdays.length && !p.weekdays.includes(wd)) continue;
      if (params.trip === 'rt') {
        if (p.min_nights && q.nights < p.min_nights) continue;
        if (p.max_nights && q.nights > p.max_nights) continue;
        if (p.return_from && q.return_date < p.return_from) continue;
        if (p.return_to && q.return_date > p.return_to) continue;
        if (p.return_weekdays && p.return_weekdays.length && !p.return_weekdays.includes((d8(q.return_date).getDay() + 6) % 7)) continue;
      }
      if (p.direct_only && (q.transfers || q.return_transfers)) continue;
      const h = hydrate(q, { origin: o, destination: d, trip: params.trip }, params.pax, params.baggage);
      if (p.max_price && h.price_pp_bags > p.max_price) continue;
      opts.push(h);
    }
  }
  if (!opts.length) return { found: false, params, errors: [], error: 'No hay precios publicados para esa combinación. Prueba con otras fechas, más noches o sin filtros.' };
  opts.sort((a, b) => a.price_total - b.price_total || a.depart_date.localeCompare(b.depart_date));
  const all = opts.map((o) => o.price).sort((a, b) => a - b);
  const q25 = all[Math.floor(all.length * 0.25)], q75 = all[Math.floor(all.length * 0.75)];
  opts.forEach((o) => { o.level = o.price <= q25 ? 'low' : o.price >= q75 ? 'high' : 'typical'; });
  const byDay = {}; opts.forEach((o) => { if (!byDay[o.depart_date]) byDay[o.depart_date] = o; });
  const days = Object.values(byDay).sort((a, b) => a.depart_date.localeCompare(b.depart_date));
  const dp = days.map((x) => x.price).sort((a, b) => a - b), median = dp[Math.floor(dp.length / 2)];
  const byMonth = {}; days.forEach((r) => { const m = r.depart_date.slice(0, 7); if (!byMonth[m] || r.price_total < byMonth[m].price_total) byMonth[m] = r; });
  const ranges = {}; opts.forEach((o) => (ranges[o.destination] = ranges[o.destination] || []).push(o.price));
  Object.keys(ranges).forEach((k) => { const v = ranges[k].sort((a, b) => a - b); ranges[k] = [v[0], v[Math.floor(v.length / 2)], v[v.length - 1]]; });
  opts.forEach((o) => { o.range = ranges[o.destination]; o.savings = median ? 1 - o.price / median : 0; });
  const byDest = {}; opts.forEach((o) => { if (!byDest[o.destination]) { const c = cityInfo(o.destination); byDest[o.destination] = { ...o, options: 0, lat: c.lat, lon: c.lon }; } byDest[o.destination].options++; });
  const seen = new Set(), top = [];
  for (const o of opts) { const k = `${o.depart_date}|${o.return_date}|${o.destination}`; if (seen.has(k)) continue; seen.add(k); top.push(o); if (top.length >= 20) break; }
  const best = opts[0];
  return {
    found: true, params, best, top, by_month: Object.keys(byMonth).sort().map((k) => byMonth[k]),
    by_destination: Object.values(byDest).sort((a, b) => a.price_total - b.price_total),
    days: days.map((r) => ({ date: r.depart_date, price: r.price, total: r.price_total, origin: r.origin, destination: r.destination, return_date: r.return_date, nights: r.nights })),
    matrix: null, median, history: [], routes: origins.length * dests.length, options: opts.length, errors: [], provider: st.provider,
    advice: staticAdvice(best.price, best.depart_date, best.origin, best.destination, opts.filter((o) => o.destination === best.destination).map((o) => o.price)),
  };
}

/* ---------- enrutador de la «API» estática ---------- */
async function staticApi(path, opts = {}) {
  const [base, qs] = path.split('?'); const q = new URLSearchParams(qs || '');
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
  const settingsMerged = async () => { const s = await sdGet('settings.json', {}); const pr = prefs(); return { ...s, ...Object.fromEntries(Object.entries(pr).filter(([, v]) => v)), resident_discount: pr.resident_discount }; };
  switch (base) {
    case '/api/status': return sdGet('status.json', {});
    case '/api/settings':
      if (method === 'PUT') { savePrefs({ resident_discount: body.resident_discount || '', passengers: body.passengers, baggage: body.baggage }); SD.hyd = null; }
      return settingsMerged();
    case '/api/meta': return sdGet('meta.json', {});
    case '/api/catalog': return sdGet('catalog.json', []);
    case '/api/catalog/countries': return sdGet('countries.json', []);
    case '/api/destinations': return sdGet('destinations.json', []);
    case '/api/deals': return (await sdGet(`deals-${q.get('trip') || 'rt'}.json`, [])).map((d) => ({ ...hydrate(d), name: d.name, country: d.country, median: d.median, range: d.range, savings: d.savings }));
    case '/api/changes': return sdGet('changes.json', []);
    case '/api/alerts': return sdGet('alerts.json', []);
    case '/api/holidays': return sdGet(`holidays-${q.get('region') || S.settings.holiday_region || 'es'}.json`, { items: [] });
    case '/api/calendar': {
      const o = q.get('origin'), d = q.get('destination'), t = q.get('trip') || 'rt';
      const cal = await sdGet(`cal/${o}-${d}-${t}.json`, { quotes: [], origin: cityInfo(o), destination: cityInfo(d), trip: t });
      return { ...cal, quotes: cal.quotes.map((x) => hydrate(x, { origin: o, destination: d, trip: t })) };
    }
    case '/api/history': return sdGet(`hist/${q.get('origin')}-${q.get('destination')}-${q.get('trip') || 'rt'}.json`, []);
    case '/api/baggage': return bagEstimate(q.get('airline'), q.get('long_haul') === '1', q.get('option') || 'personal', +q.get('legs') || 1, +q.get('pax') || 1);
    case '/api/search': return { id: 'static', status: 'done', result: await staticSearch(body) };
    case '/api/quote-history': case '/api/watches': return [];
    default: return {};
  }
}
