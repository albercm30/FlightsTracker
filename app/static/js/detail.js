/* Flight Tracker — ficha de detalle de un vuelo (hoja/modal) */
'use strict';

function linksFor(o) {
  const p = o.pax || pax(), d = o.depart_date, r = o.return_date;
  const dt = d8(d), dd = String(dt.getDate()).padStart(2, '0'), mm = String(dt.getMonth() + 1).padStart(2, '0'), yy = String(dt.getFullYear()).slice(2);
  let rr = '', rsky = '';
  if (r) { const x = d8(r); rr = String(x.getDate()).padStart(2, '0') + String(x.getMonth() + 1).padStart(2, '0'); rsky = `${String(x.getFullYear()).slice(2)}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}/`; }
  const q = encodeURIComponent(`Flights from ${o.origin} to ${o.destination} on ${d}` + (r ? ` returning ${r}` : ' one way') + (p > 1 ? ` for ${p} adults` : ''));
  return {
    aviasales: o.link && o.link.includes('aviasales') ? o.link : `https://www.aviasales.com/search/${o.origin}${dd}${mm}${o.destination}${rr}${p}`,
    skyscanner: `https://www.skyscanner.es/transporte/vuelos/${o.origin.toLowerCase()}/${o.destination.toLowerCase()}/${yy}${mm}${dd}/${rsky}?adultsv2=${p}`,
    google: `https://www.google.com/travel/flights?hl=es&curr=EUR&q=${q}`,
    kayak: `https://www.kayak.es/flights/${o.origin}-${o.destination}/${d}${r ? '/' + r : ''}${p > 1 ? `/${p}adults` : ''}?sort=price_a`,
  };
}

async function openDetail(input) {
  let o = { ...input };
  o.trip = o.trip || (o.return_date ? 'rt' : 'ow');
  if (o.price == null) {
    try {
      const cal = await api(`/api/calendar?origin=${o.origin}&destination=${o.destination}&trip=${o.trip}`);
      const q = cal.quotes.find((x) => x.depart_date === o.depart_date);
      if (q) o = { ...q, ...o, price: q.price, median: cal.median };
    } catch (e) { /* sin datos */ }
  }
  S.detail = o;
  renderDetail();
}

function renderDetail() {
  const o = S.detail, info = cityInfo(o.destination), p = o.pax || pax();
  const lead = Math.round((d8(o.depart_date) - d8(todayIso())) / 86400000);
  const nights = o.return_date ? Math.round((d8(o.return_date) - d8(o.depart_date)) / 86400000) : null;
  const lvl = LEVEL[o.level];
  const L = linksFor(o);
  openSheet(`
  <div class="sh-head">${flag(info.country_code)}
    <div><h2>${esc(o.origin)} → ${esc(info.name)} <span class="muted small">(${esc(o.destination)})</span></h2>
    <div class="small muted">${tripLabel(o.trip)} · ${esc(info.country || '')}</div></div>
    <button class="btn icon ghost close" data-close aria-label="Cerrar">${ic('x')}</button></div>
  <div class="sh-body">
    <div class="row" style="align-items:flex-end;gap:18px">
      <div><div class="bigprice">${money(o.price)}</div><div class="small muted">por persona · ${o.trip === 'rt' ? 'ida y vuelta' : 'solo ida'}</div></div>
      <div class="row">${lvl ? `<span class="pill ${lvl[1]}">${lvl[0]}</span>` : ''}
        ${o.median ? `<span class="pill ${o.price < o.median ? 'good' : 'neutral'}">${o.price < o.median ? pct(1 - o.price / o.median) : '+' + Math.round((o.price / o.median - 1) * 100) + '%'} vs. habitual ${money(o.median)}</span>` : ''}</div>
    </div>
    <div class="info-grid">
      <div><div class="k">Salida</div><div class="v">${esc(dlong(o.depart_date))}</div></div>
      ${o.return_date ? `<div><div class="k">Vuelta</div><div class="v">${esc(dlong(o.return_date))}</div><div class="small muted">${nights} noches</div></div>` : ''}
      <div><div class="k">Aerolínea</div><div class="v">${esc(o.airline_name || o.airline || '—')}</div></div>
      <div><div class="k">Escalas</div><div class="v">${esc(stops(o.transfers)) || '—'}${o.return_date && o.return_transfers != null ? ` / ${esc(stops(o.return_transfers))}` : ''}</div></div>
      <div><div class="k">Antelación</div><div class="v">${lead} días</div></div>
      ${o.updated_at ? `<div><div class="k">Precio visto</div><div class="v">${ago(o.updated_at)}</div>${o.prev_price ? `<div class="small muted">antes ${money(o.prev_price)}</div>` : ''}</div>` : ''}
    </div>

    <div class="card pad" style="box-shadow:none">
      <div class="row" style="margin-bottom:10px"><h3>${ic('bag')} Equipaje y precio total</h3><span class="spacer"></span>${paxBagControl('dPaxBag', p, o.baggage?.option || S.settings.baggage)}</div>
      <div id="bagBox" class="muted small">Calculando…</div>
    </div>

    ${o.trip === 'rt' ? `<div><div class="row"><h3>Cambia las fechas</h3><span class="muted small">salida ↓ · vuelta →</span></div><div id="dGrid" class="muted small" style="margin-top:8px">Cargando cuadrícula…</div></div>` : ''}

    <div><h3>Evolución del precio de este día</h3><div id="dHist" style="margin-top:8px"></div></div>

    <div class="row">
      <div style="position:relative"><button class="btn primary" id="bookBtn">${ic('ext')} Reservar</button></div>
      <input id="wTarget" type="number" min="0" placeholder="Precio objetivo ${sym()}" style="width:170px">
      <button class="btn" id="watchBtn">${ic('eye')} Vigilar este vuelo</button>
      <button class="btn ghost" id="shareBtn">${ic('share')} Compartir</button>
      <button class="btn ghost" id="icsBtn">${ic('calendar')} Al calendario</button>
    </div>
    <div class="card pad" style="box-shadow:none">
      <div class="row"><h3>${ic('zap')} Comprobar precio real ahora</h3><span class="spacer"></span>
        ${S.status?.live_check ? `<select id="lcClass" style="width:auto"><option value="1">Turista</option><option value="2">Turista superior</option><option value="3">Business</option><option value="4">Primera</option></select>
        <label class="check"><input type="checkbox" id="lcDirect"> Solo directos</label>
        <button class="btn" id="liveBtn">Consultar Google Flights</button>` : ''}</div>
      <div id="liveBox" class="small muted" style="margin-top:8px">${S.status?.live_check ? 'Consulta el precio en vivo, el nivel de precio de Google, su historial y las opciones de equipaje reales (gasta 1 búsqueda de SerpApi).' : 'Añade una clave gratuita de SerpApi en Ajustes para ver aquí el precio en vivo de Google Flights y su historial de precios.'}</div>
    </div>
    <p class="tiny muted">Precios de ${esc(o.provider === 'demo' || S.status?.provider === 'demo' ? 'simulación (modo demo)' : 'Aviasales (búsquedas recientes)')}. Pueden cambiar: confirma siempre el precio final en la web de reserva.</p>
  </div>`);

  // equipaje
  const updBag = async () => {
    const { pax: pp, baggage } = readPaxBag($('#dPaxBag'));
    const b = await api(`/api/baggage?airline=${encodeURIComponent(o.airline || '')}&long_haul=${o.long_haul ? 1 : 0}&option=${baggage}&legs=${o.trip === 'rt' ? 2 : 1}&pax=${pp}`);
    const row = (k, lbl, st, rng) => `<div>${k}</div><div>${lbl}</div><div class="${st === 'included' ? 'ok' : st === 'fee' ? 'fee' : 'dep'}">${st === 'included' ? 'Incluida' : st === 'fee' ? `De pago${rng ? ` · ${rng}` : ''}` : 'Según tarifa'}</div>`;
    const total = o.price * pp + b.fee_est;
    $('#bagBox').className = '';
    $('#bagBox').innerHTML = `<div class="bag-table">
      ${row('🎒', `Artículo personal${b.personal_size ? ` (${esc(b.personal_size)})` : ''}`, 'included')}
      ${row('🧳', 'Maleta de cabina (~10 kg)', b.cabin)}
      ${row('🛄', 'Maleta facturada (20–23 kg)', b.checked)}
    </div>
    <div class="row" style="margin-top:12px;align-items:baseline">
      <div><div class="k tiny muted">TOTAL ESTIMADO (${pp} ${pp > 1 ? 'personas' : 'persona'}${baggage !== 'personal' ? ', con equipaje' : ''})</div>
      <div style="font-size:1.6rem;font-weight:850">${money(total)}</div></div>
      <div class="small muted">${money(o.price)} × ${pp}${b.fee_max ? ` + equipaje ${money(b.fee_min)}–${money(b.fee_max)} (≈ ${money(b.fee_est)})` : ''}</div>
    </div>
    <p class="tiny muted" style="margin:8px 0 0">Estimación según la política habitual de ${esc(b.airline)}${b.known ? '' : ' (aerolínea sin datos: valores típicos)'}. Añadirlo al reservar suele ser más barato que en el aeropuerto. La norma UE de maleta de cabina incluida aún no está en vigor.</p>`;
    S.detail.pax = pp;
  };
  $('#dPaxBag').addEventListener('change', updBag);
  updBag();

  // cuadrícula ida x vuelta
  if (o.trip === 'rt') {
    api(`/api/grid?origin=${o.origin}&destination=${o.destination}&depart=${o.depart_date}&return=${o.return_date}`).then((g) => {
      const cells = new Map(g.cells.map((c) => [`${c.depart}|${c.return}`, c]));
      const prices = g.cells.map((c) => c.price);
      if (!prices.length) { $('#dGrid').textContent = 'Sin combinaciones cercanas.'; return; }
      const lo = Math.min(...prices), hi = Math.max(...prices), med = prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)];
      let h = `<div class="matrix" style="grid-template-columns:80px repeat(${g.returns.length},1fr)"><div></div>${g.returns.map((r) => `<div class="h">${esc(dshort(r))}</div>`).join('')}`;
      g.departs.forEach((d) => {
        h += `<div class="h" style="text-align:left">${esc(dshort(d))}</div>`;
        g.returns.forEach((r) => {
          const c = cells.get(`${d}|${r}`);
          if (!c) { h += '<div class="c none">—</div>'; return; }
          const col = priceColor(c.price, med, lo, hi);
          h += `<div class="c ${d === o.depart_date && r === o.return_date ? 'sel' : ''}" data-g="${d}|${r}|${c.price}|${c.airline || ''}" style="background:${col.bg};color:${col.fg}">${Math.round(c.price)}</div>`;
        });
      });
      $('#dGrid').innerHTML = h + '</div>';
      $('#dGrid').onclick = (e) => {
        const c = e.target.closest('[data-g]'); if (!c) return;
        const [d, r, pr, al] = c.dataset.g.split('|');
        Object.assign(S.detail, { depart_date: d, return_date: r, price: +pr, airline: al || o.airline, airline_name: al ? (S.meta.airlines[al] || al) : o.airline_name, link: null, updated_at: null, prev_price: null, level: null });
        renderDetail();
      };
    }).catch((e) => { $('#dGrid').textContent = e.message; });
  }

  // histórico del día
  api(`/api/quote-history?origin=${o.origin}&destination=${o.destination}&trip=${o.trip}&date=${o.depart_date}`).then((h) => {
    chart($('#dHist'), [{ name: 'Precio', color: 'var(--series-1)', data: h.map((x) => ({ x: x.seen_at.slice(0, 16), y: x.price })) }],
      { height: 170, xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
    if (!h.length) $('#dHist').innerHTML = '<p class="muted small">Aún no hay histórico para esta fecha: se irá llenando con cada escaneo.</p>';
  });

  // acciones
  $('#bookBtn').onclick = (e) => {
    e.stopPropagation();
    const old = $('#bookMenu'); if (old) { old.remove(); return; }
    const m = document.createElement('div'); m.className = 'menu'; m.id = 'bookMenu'; m.style.bottom = '48px';
    m.innerHTML = [['Aviasales', L.aviasales], ['Skyscanner', L.skyscanner], ['Google Flights', L.google], ['Kayak', L.kayak]]
      .map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${ic('ext')} ${n}</a>`).join('');
    e.target.closest('div').appendChild(m);
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
  };
  $('#watchBtn').onclick = async () => {
    try {
      await api('/api/watches', { method: 'POST', body: { origin: o.origin, destination: o.destination, date: o.depart_date, return_date: o.return_date || '', price: o.price, target_price: $('#wTarget').value } });
      toast('👀 Vigilando este vuelo: te avisaremos si cambia'); refreshStatus();
    } catch (err) { toast(err.message); }
  };
  $('#shareBtn').onclick = () => shareText('Vuelo barato', `✈️ ${o.origin} → ${info.name}: ${money(o.price)} ${o.return_date ? `ida y vuelta (${dshort(o.depart_date)} – ${dshort(o.return_date)})` : `solo ida (${dshort(o.depart_date)})`}`, L.google);
  $('#icsBtn').onclick = () => download(`vuelo_${o.origin}_${o.destination}_${o.depart_date}.ics`,
    icsEvent({ title: `✈️ ${o.origin} → ${info.name}`, start: o.depart_date, end: o.return_date, desc: `Precio visto: ${money(o.price)} por persona\nReservar: ${L.aviasales}`, url: L.google }), 'text/calendar');
  const lb = $('#liveBtn');
  if (lb) lb.onclick = async () => {
    lb.disabled = true; $('#liveBox').innerHTML = '<div class="progress"><div style="width:60%"></div></div>';
    try {
      const { pax: pp, baggage } = readPaxBag($('#dPaxBag'));
      const r = await api('/api/live-check', { method: 'POST', body: { origin: o.origin, destination: o.destination, date: o.depart_date, return_date: o.return_date, pax: pp, baggage, travel_class: $('#lcClass').value, direct_only: $('#lcDirect').checked } });
      const lv = { low: ['bajo', 'good'], typical: ['normal', 'warn'], high: ['alto', 'bad'] }[r.price_level] || [r.price_level || '—', 'neutral'];
      $('#liveBox').innerHTML = `<div class="row"><div class="bigprice" style="font-size:2rem">${money(r.lowest_price)}</div><span class="pill ${lv[1]}">Google: precio ${esc(lv[0])}</span>
        ${r.typical_range ? `<span class="small muted">Rango habitual ${money(r.typical_range[0])} – ${money(r.typical_range[1])}</span>` : ''}</div>
        ${r.advice ? `<div class="verdict ${r.advice.level}" style="margin-top:10px">${esc(r.advice.verdict)}</div><ul class="reasons">${r.advice.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.history.length ? '<h3 style="margin-top:12px">Historial de Google Flights</h3><div id="gHist"></div>' : ''}
        <div class="table-wrap" style="margin-top:12px"><table><tr><th>Precio</th><th>Aerolínea</th><th>Escalas</th><th>Salida</th><th>Duración</th><th>Detalles</th></tr>
        ${r.flights.map((f) => `<tr><td><b>${money(f.price)}</b></td><td>${esc(f.airlines.join(', '))}</td><td>${f.stops || 'Directo'}</td><td>${esc((f.departure || '').slice(-5))}</td><td>${f.duration_min ? Math.floor(f.duration_min / 60) + 'h ' + (f.duration_min % 60) + 'm' : ''}</td><td class="tiny">${esc((f.extensions || []).join(' · '))}</td></tr>`).join('')}</table></div>
        ${r.google_url ? `<p><a href="${esc(r.google_url)}" target="_blank" rel="noopener">${ic('ext')} Abrir esta búsqueda en Google Flights</a></p>` : ''}`;
      if (r.history.length) chart($('#gHist'), [{ name: 'Google', color: 'var(--series-1)', data: r.history.map((h) => ({ x: new Date(h.t * 1000).toISOString().slice(0, 10), y: h.price })) }], { height: 160, xFmt: (x) => dshort(x) });
    } catch (err) { $('#liveBox').innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
    lb.disabled = false;
  };
}
