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
    ${itinerary(o)}
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

    <div><h3>📈 Precio más barato de esta ruta, escaneo a escaneo</h3><div id="dHist" style="margin-top:8px"></div></div>

    <p class="tiny muted" style="margin:0">${S.status?.provider === 'demo' ? '🎲 Precio simulado (modo demo).' : 'Precio de búsquedas recientes: confírmalo al reservar.'}</p>
  </div>
  <div class="sh-foot">
    <button class="btn primary" id="bookBtn">${ic('ext')} Reservar</button>
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

  // acciones
  $('#bookBtn').onclick = (e) => {
    e.stopPropagation();
    popMenu(e.currentTarget, [['Aviasales', L.aviasales], ['Skyscanner', L.skyscanner], ['Google Flights', L.google], ['Kayak', L.kayak]]
      .map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${ic('ext')} ${n}</a>`).join(''));
  };
  $('#shareBtn').onclick = () => shareText('Vuelo barato', `✈️ ${o.origin} → ${info.name}: ${money(o.price)} ${o.return_date ? `ida y vuelta (${dshort(o.depart_date)} – ${dshort(o.return_date)})` : `solo ida (${dshort(o.depart_date)})`}`, L.google);
  $('#icsBtn').onclick = () => download(`vuelo_${o.origin}_${o.destination}_${o.depart_date}.ics`,
    icsEvent({ title: `✈️ ${o.origin} → ${info.name}`, start: o.depart_date, end: o.return_date, desc: `Precio visto: ${money(o.price)} por persona\nReservar: ${L.aviasales}`, url: L.google }), 'text/calendar');
  // cómo ha cambiado el precio mínimo de esta ruta en los últimos escaneos
  api(`/api/history?origin=${o.origin}&destination=${o.destination}&trip=${o.trip}`).then((h) => {
    const box = $('#dHist'); if (!box) return;
    if (h.length < 2) { box.innerHTML = '<p class="muted small">Se irá llenando con cada escaneo.</p>'; return; }
    chart(box, [{ name: 'Mínimo de la ruta', color: 'var(--series-1)', data: h.map((x) => ({ x: x.scanned_at.slice(0, 16), y: x.min_price })) }],
      { height: 160, xFmt: (x) => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) });
  }).catch(() => {});
}
