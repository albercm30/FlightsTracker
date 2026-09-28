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
      if (q) o = { ...q, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)), price: q.price, median: cal.median, range: cal.range };
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
  const sav = o.median ? 1 - o.price / o.median : o.savings;
  openSheet(`
  <div class="hdr cover ${rg(info.region)}">${flag(info.country_code)}
    <div class="t"><h2>${esc(o.origin)} → ${esc(info.name)}</h2><div class="sub">${tripLabel(o.trip)} · ${esc(info.country || '')}</div></div>
    ${saveBadge(sav)}<button class="btn icon ghost close" data-close aria-label="Cerrar" style="color:#fff">${ic('x')}</button></div>
  <div class="sh-body">
    <div class="pricehead">
      <div><div class="row" style="align-items:baseline"><span class="bigprice">${money(o.price)}</span><span class="muted">/persona</span>${lvl ? `<span class="pill ${lvl[1]}">${lvl[0]}</span>` : ''}</div>
        ${o.resident_price != null ? `<div class="resident" style="margin-top:8px">🏝️ Con descuento de residente ≈ ${money(o.resident_price)}</div>` : ''}</div>
    </div>
    ${meter(o.price, o.range)}
    <div class="facts">
      <div class="fact"><span>Ida</span><b>${esc(dshort(o.depart_date))}</b></div>
      ${o.return_date ? `<div class="fact"><span>Vuelta</span><b>${esc(dshort(o.return_date))}</b></div><div class="fact"><span>Estancia</span><b>${nights} noches</b></div>` : ''}
      <div class="fact"><span>Escalas</span><b>${o.transfers === 0 ? '✈ Directo' : o.transfers != null ? o.transfers : '—'}${o.return_date && o.return_transfers != null ? ` / ${o.return_transfers === 0 ? 'directo' : o.return_transfers}` : ''}</b></div>
      <div class="fact"><span>Aerolínea</span><b>${esc(o.airline_name || o.airline || '—')}</b></div>
      <div class="fact"><span>Faltan</span><b>${lead} días</b></div>
      ${o.updated_at ? `<div class="fact"><span>Visto</span><b>${ago(o.updated_at)}</b></div>` : ''}
    </div>

    <div class="card pad" style="box-shadow:none">
      <div class="row" style="margin-bottom:12px"><h3>🧳 Equipaje y total</h3><span class="spacer"></span>${paxBagControl('dPaxBag', p, o.baggage?.option || S.settings.baggage)}</div>
      <div id="bagBox"><div class="skel" style="height:80px"></div></div>
    </div>

    ${o.trip === 'rt' && !S.static ? `<div><div class="row"><h3>📆 Prueba otras fechas</h3><span class="muted small">filas: ida · columnas: vuelta</span></div><div id="dGrid" style="margin-top:8px"><div class="skel" style="height:120px"></div></div></div>` : ''}

    ${S.static ? '' : '<div><h3>📈 Cómo ha cambiado este precio</h3><div id="dHist" style="margin-top:8px"></div></div>'}

    <details class="card pad ${S.static ? 'hidden' : ''}" style="box-shadow:none">
      <summary style="cursor:pointer;font-weight:800">⚡ Precio real ahora en Google Flights</summary>
      <div style="margin-top:12px">${S.status?.live_check ? `<div class="row"><select id="lcClass" style="width:auto"><option value="1">Turista</option><option value="2">Turista superior</option><option value="3">Business</option><option value="4">Primera</option></select>
        <label class="check"><input type="checkbox" id="lcDirect"> Solo directos</label><button class="btn primary sm" id="liveBtn">Consultar</button></div>` : '<p class="small muted" style="margin:0">Añade una clave gratuita de SerpApi en Ajustes para activarlo.</p>'}
      <div id="liveBox" style="margin-top:10px"></div></div>
    </details>
    <p class="tiny muted" style="margin:0">${o.provider === 'demo' || S.status?.provider === 'demo' ? '🎲 Precio simulado (modo demo).' : 'Precio de búsquedas recientes: confírmalo al reservar.'}</p>
  </div>
  <div class="sh-foot">
    <button class="btn primary" id="bookBtn">${ic('ext')} Reservar</button>
    <button class="btn ${S.static ? 'hidden' : ''}" id="watchBtn">${ic('eye')} Vigilar</button>
    <input id="wTarget" class="${S.static ? 'hidden' : ''}" type="number" min="0" placeholder="Avísame a… ${sym()}" style="width:150px">
    <span class="spacer"></span>
    <button class="btn icon ghost" id="shareBtn" title="Compartir">${ic('share')}</button>
    <button class="btn icon ghost" id="icsBtn" title="Añadir al calendario">${ic('calendar')}</button>
  </div>`);

  // equipaje
  const updBag = async () => {
    const { pax: pp, baggage } = readPaxBag($('#dPaxBag'));
    const b = await api(`/api/baggage?airline=${encodeURIComponent(o.airline || '')}&long_haul=${o.long_haul ? 1 : 0}&option=${baggage}&legs=${o.trip === 'rt' ? 2 : 1}&pax=${pp}`);
    const tile = (icon, nm, st) => `<div class="tile ${st === 'included' ? 'inc' : st === 'fee' ? 'fee' : 'dep'}"><span class="ico">${icon}</span><span class="nm">${nm}</span><span class="st">${st === 'included' ? '✓ Incluida' : st === 'fee' ? '€ De pago' : '? Según tarifa'}</span></div>`;
    const base = (o.resident_price != null ? o.resident_price : o.price) * pp;
    const total = base + b.fee_est;
    const fw = total ? (base / total) * 100 : 100;
    $('#bagBox').className = '';
    $('#bagBox').innerHTML = `<div class="tiles">${tile('🎒', 'Mochila', 'included')}${tile('🧳', 'Cabina 10 kg', b.cabin)}${tile('🛄', 'Facturada 23 kg', b.checked)}</div>
      <div class="row" style="margin-top:14px;align-items:flex-end"><div><div class="tiny muted" style="font-weight:800">TOTAL ESTIMADO · ${pp} ${pp > 1 ? 'personas' : 'persona'}</div><div style="font-size:1.9rem;font-weight:900;letter-spacing:-.03em">${money(total)}</div></div>
        <span class="spacer"></span><div class="small muted" style="text-align:right">billetes ${money(base)}<br>equipaje ${b.fee_max ? `≈ ${money(b.fee_est)}` : '0 €'}</div></div>
      <div class="stack"><i class="fare" style="width:${fw}%"></i><i class="bags" style="width:${100 - fw}%"></i></div>
      <div class="stack-legend"><span><i style="background:var(--series-1)"></i>billetes</span><span><i style="background:#eda100"></i>equipaje (${esc(b.airline)}${b.known ? '' : ', típico'})</span><span title="Estimación según la política habitual de la aerolínea. La norma UE de cabina incluida aún no se aplica.">ⓘ estimación</span></div>`;
    S.detail.pax = pp;
  };
  $('#dPaxBag').addEventListener('change', updBag);
  updBag();

  // cuadrícula ida x vuelta
  if (o.trip === 'rt' && !S.static) {
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
  if (!S.static) api(`/api/quote-history?origin=${o.origin}&destination=${o.destination}&trip=${o.trip}&date=${o.depart_date}`).then((h) => {
    chart($('#dHist'), [{ name: 'Precio', color: 'var(--series-1)', data: h.map((x) => ({ x: x.seen_at.slice(0, 16), y: x.price })) }],
      { height: 170, xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
    if (!h.length) $('#dHist').innerHTML = '<p class="muted small">Aún no hay histórico para esta fecha: se irá llenando con cada escaneo.</p>';
  });

  // acciones
  $('#bookBtn').onclick = (e) => {
    e.stopPropagation();
    popMenu(e.currentTarget, [['Aviasales', L.aviasales], ['Skyscanner', L.skyscanner], ['Google Flights', L.google], ['Kayak', L.kayak]]
      .map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${ic('ext')} ${n}</a>`).join(''));
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
    lb.disabled = true; $('#liveBox').innerHTML = '<div class="skel" style="height:60px"></div>';
    try {
      const { pax: pp, baggage } = readPaxBag($('#dPaxBag'));
      const r = await api('/api/live-check', { method: 'POST', body: { origin: o.origin, destination: o.destination, date: o.depart_date, return_date: o.return_date, pax: pp, baggage, travel_class: $('#lcClass').value, direct_only: $('#lcDirect').checked } });
      const lv = { low: ['bajo', 'good'], typical: ['normal', 'warn'], high: ['alto', 'bad'] }[r.price_level] || [r.price_level || '—', 'neutral'];
      $('#liveBox').innerHTML = `<div class="row"><div class="bigprice" style="font-size:2rem">${money(r.lowest_price)}</div><span class="pill ${lv[1]}">Google: precio ${esc(lv[0])}</span>
        ${r.typical_range ? `<span class="small muted">Rango habitual ${money(r.typical_range[0])} – ${money(r.typical_range[1])}</span>` : ''}</div>
        ${r.advice ? `<div style="margin-top:12px">${verdictBox(r.advice)}</div>` : ''}
        ${r.history.length ? '<h3 style="margin-top:12px">Historial de Google Flights</h3><div id="gHist"></div>' : ''}
        <div class="table-wrap" style="margin-top:12px"><table><tr><th>Precio</th><th>Aerolínea</th><th>Escalas</th><th>Salida</th><th>Duración</th><th>Detalles</th></tr>
        ${r.flights.map((f) => `<tr><td><b>${money(f.price)}</b></td><td>${esc(f.airlines.join(', '))}</td><td>${f.stops || 'Directo'}</td><td>${esc((f.departure || '').slice(-5))}</td><td>${f.duration_min ? Math.floor(f.duration_min / 60) + 'h ' + (f.duration_min % 60) + 'm' : ''}</td><td class="tiny">${esc((f.extensions || []).join(' · '))}</td></tr>`).join('')}</table></div>
        ${r.google_url ? `<p><a href="${esc(r.google_url)}" target="_blank" rel="noopener">${ic('ext')} Abrir esta búsqueda en Google Flights</a></p>` : ''}`;
      if (r.history.length) chart($('#gHist'), [{ name: 'Google', color: 'var(--series-1)', data: r.history.map((h) => ({ x: new Date(h.t * 1000).toISOString().slice(0, 10), y: h.price })) }], { height: 160, xFmt: (x) => dshort(x) });
    } catch (err) { $('#liveBox').innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
    lb.disabled = false;
  };
}
