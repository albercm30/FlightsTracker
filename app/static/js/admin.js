/* Flight Tracker — Mis destinos y Ajustes, sin usuarios ni claves.
   Tus ajustes están en config.json, en tu repositorio. Al pulsar «Guardar», se abre GitHub con
   una issue ya rellena con tus cambios: como ya tienes la sesión de GitHub iniciada, solo
   pulsas «Create» y el workflow «Guardar ajustes» los aplica y vuelve a buscar precios. */
'use strict';

const DRAFT_KEY = 'ft-draft';
function repoName() {
  if (S.meta && S.meta.repo) return S.meta.repo;
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i), p = location.pathname.split('/').filter(Boolean)[0];
  return m && p ? `${m[1]}/${p}` : '';
}
/* Lo que hay publicado ahora mismo (lo que usa GitHub en sus escaneos) */
async function currentConfig() {
  const st = S.settings || {}, dests = await api('/api/destinations');
  return {
    origins: st.origins || [], destinations: dests.map((d) => d.code),
    trip_type: st.trip_type || 'rt', min_nights: st.min_nights ?? 3, max_nights: st.max_nights ?? 10,
    passengers: st.passengers ?? 1, baggage: st.baggage || 'personal', resident_discount: st.resident_discount || '',
    months_ahead: st.months_ahead ?? 12, holiday_region: st.holiday_region || '',
    alert_level: st.alert_level || 'muy_buena', alert_drops: !!st.alert_drops, min_days_ahead: st.min_days_ahead ?? 14,
    max_stops: st.max_stops ?? -1, max_duration_h: st.max_duration_h || 0, dep_windows: st.dep_windows || '',
    exclude_airlines: st.exclude_airlines || [], trip_lengths: st.trip_lengths || {},
  };
}
const sameCfg = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
function saveDraft(d) { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ } }
/* Borrador pendiente = lo que enviaste y aún no se ha publicado (o cambios sin enviar) */
async function workingConfig() {
  const cur = await currentConfig(), d = loadDraft();
  if (d && sameCfg(d.cfg, cur)) { saveDraft(null); return { cfg: cur, cur, draft: null }; }
  if (d && d.sent && Date.now() - d.sent > 3 * 3600e3) { saveDraft(null); return { cfg: cur, cur, draft: null }; }
  return { cfg: d ? { ...cur, ...d.cfg } : cur, cur, draft: d };
}
function sendConfig(cfg, extra = {}) {
  const repo = repoName();
  if (!repo) { toast('No sé cuál es tu repositorio'); return; }
  const body = 'Pulsa **Create** (o «Submit new issue») para guardar estos ajustes. Se aplicarán en unos minutos.\n\n```json\n'
    + JSON.stringify({ ...cfg, ...extra }, null, 1) + '\n```';
  const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent('⚙️ Guardar ajustes')}&body=${encodeURIComponent(body)}`;
  saveDraft({ cfg, sent: Date.now() });
  window.open(url, '_blank', 'noopener');
}
function pendingBanner(draft) {
  if (!draft) return '';
  return draft.sent
    ? `<div class="banner info">⏳ <div><b>Cambios enviados.</b> Si ya pulsaste «Create» en GitHub, en unos minutos aparecerán aquí. <a href="#" data-resend>Volver a abrir GitHub</a> · <a href="#" data-discard>Descartar</a></div></div>`
    : `<div class="banner warn">✏️ <div><b>Tienes cambios sin guardar.</b></div></div>`;
}
function bindPending(el, cfg) {
  el.querySelector('[data-resend]')?.addEventListener('click', (e) => { e.preventDefault(); sendConfig(cfg); });
  el.querySelector('[data-discard]')?.addEventListener('click', (e) => { e.preventDefault(); saveDraft(null); route(true); });
}
function saveHelp() {
  return '<p class="tiny muted" style="margin:8px 0 0">«Guardar» abre GitHub con tus cambios ya escritos: pulsa <b>Create</b> y listo. Se aplican y se buscan precios en unos minutos.</p>';
}

/* ---------- MIS DESTINOS ---------- */
async function destinationsView(el) {
  const published = new Set((await api('/api/destinations')).map((d) => d.code));
  const w = await workingConfig();
  let list = [...w.cfg.destinations];
  let lengths = { ...(w.cfg.trip_lengths || {}) };
  const keep = () => saveDraft({ cfg: { ...w.cfg, destinations: list, trip_lengths: lengths } });
  const draw = () => {
    const changed = !sameCfg(list, w.cur.destinations) || !sameCfg(lengths, w.cur.trip_lengths || {});
    el.innerHTML = `<div class="page-head"><div><h1>Mis destinos</h1><p>Los vigilamos cada día y a las 8:00 te llega un email con sus mejores ofertas. Elige cuánto quieres viajar a cada país.</p></div></div>
      ${pendingBanner(w.draft)}
      <div class="card pad"><div class="row">
        <div style="flex:1;min-width:220px"><input id="sdIn" placeholder="Ciudad, código o país entero…"></div>
        <button class="btn primary" id="sdAdd">${ic('plus')} Añadir</button></div>
        <div class="chips" style="margin-top:12px"><span class="small muted" style="align-self:center">De golpe:</span>${Object.entries(S.meta.themes).map(([k, t]) => `<button class="chip" data-th="${k}">${t.icon} ${esc(t.label)}</button>`).join('')}</div></div>
      <div class="card pad section"><div class="row"><h3>${list.length} destinos</h3><span class="spacer"></span>
        <button class="btn ${changed ? 'primary' : ''}" id="sdSave" ${changed ? '' : 'disabled'}>${ic('check')} Guardar</button></div>
        <div class="dest-groups">${destGroups(list, published, lengths)}</div>
        ${saveHelp()}</div>`;
    paintIcons(el); bindPending(el, w.cfg);
    attachAC($('#sdIn'), { onPick: () => setTimeout(() => $('#sdAdd')?.click(), 0) });
    const add = (arr) => { const n = arr.filter((c) => !list.includes(c)); list = [...list, ...n]; keep(); draw(); toast(n.length ? `⭐ ${n.length} añadido${n.length > 1 ? 's' : ''}. Pulsa «Guardar».` : 'Ya estaba en la lista'); };
    $('#sdAdd').onclick = () => {
      const r = resolvePlace($('#sdIn').value);
      if (r.destinations) add(r.destinations);
      else if (r.country) add(S.catalog.filter((c) => c.country_code === r.country).map((c) => c.code));
      else toast('Elige un destino de la lista');
    };
    el.onclick = (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { list = list.filter((c) => c !== rm.dataset.rm); keep(); draw(); return; }
      const th = e.target.closest('[data-th]'); if (th) add((S.meta.theme_codes[th.dataset.th] || []).filter((c) => !(w.cfg.origins || []).includes(c)));
    };
    el.onchange = (e) => {
      const t = e.target.closest('[data-len]'); if (!t) return;
      if (t.value) lengths[t.dataset.len] = t.value === 'weekend' ? 'weekend' : +t.value; else delete lengths[t.dataset.len];
      keep(); draw();
    };
    $('#sdSave').onclick = () => { Object.assign(w.cfg, { destinations: list, trip_lengths: lengths }); sendConfig(w.cfg); w.draft = loadDraft(); draw(); };
  };
  draw();
}
/* Destinos agrupados por país, con la duración del viaje de cada país */
const LEN_OPTS = [['', 'Duración general'], ['weekend', 'Fin de semana (vie–dom)'], ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 25, 30].map((n) => [String(n), `${n} días`])];
function lenLabel(v) { return v === 'weekend' ? 'fin de semana' : v ? `${v} días` : ''; }
function destGroups(list, published, lengths) {
  if (!list.length) return '<p class="muted small" style="margin:12px 0 0">Aún no hay destinos. Añade alguno arriba.</p>';
  const groups = {};
  list.forEach((c) => { const cc = cityInfo(c).country_code || '??'; (groups[cc] = groups[cc] || []).push(c); });
  const cname = (cc) => (S.countries.find((x) => x.country_code === cc) || {}).country || cityInfo(groups[cc][0]).country || cc;
  return Object.keys(groups).sort((a, b) => cname(a).localeCompare(cname(b))).map((cc) => {
    const v = lengths[cc] ?? '';
    return `<div class="dgroup"><div class="dg-head">${flag(cc)}<b>${esc(cname(cc))}</b><span class="spacer"></span>
      <select data-len="${cc}" title="Duración del viaje a ${esc(cname(cc))}">${LEN_OPTS.map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="chips dest-chips">${groups[cc].map((c) => `<span class="chip">${esc(cityName(c))} <span class="tiny muted">${c}</span>${published.has(c) ? '' : ' <span class="pill warn" title="Tendrá precios tras guardar">nuevo</span>'}<button class="x" data-rm="${c}" title="Quitar">×</button></span>`).join('')}</div></div>`;
  }).join('');
}

/* «Guardar top 5» de Explorar */
async function addFavorites(codes) {
  const w = await workingConfig();
  const list = [...new Set([...w.cfg.destinations, ...codes])];
  saveDraft({ cfg: { ...w.cfg, destinations: list } });
  toast('⭐ Añadidos. Revisa y pulsa «Guardar» en Mis destinos.', 5000);
  go('destinations');
}

/* ---------- AJUSTES ---------- */
async function settingsView(el) {
  const w = await workingConfig(), c = w.cfg;
  let origins = [...(c.origins || [])];
  const wins = String(c.dep_windows || '').split(',').filter(Boolean), excl = c.exclude_airlines || [];
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(cur) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const lvlHelp = { excepcional: 'Solo errores de tarifa y ofertas de ≥40 % bajo lo habitual.', muy_buena: 'Ofertas de ≥30 % bajo lo habitual y entre las fechas más baratas del año.', buena: 'Ofertas de ≥20 % bajo lo habitual. Más chollos en el resumen.' };
  const demo = S.status?.provider === 'demo', repo = repoName();
  el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Cada mañana recibes un email con las mejores ofertas de tus destinos.</p></div></div>
  ${pendingBanner(w.draft)}
  ${demo ? `<div class="banner warn">🎲 <div><b>Precios simulados.</b> Para precios reales, añade tu clave gratuita de Travelpayouts como secret <code>TRAVELPAYOUTS_TOKEN</code> en <a href="https://github.com/${esc(repo)}/settings/secrets/actions/new" target="_blank" rel="noopener">GitHub → Secrets</a>.</div></div>` : ''}
  <div class="card pad"><h2>✈️ Desde dónde sales</h2>
    <div class="chips" id="oChips" style="margin-top:10px"></div>
    <div class="row" style="margin-top:10px"><div style="flex:1;min-width:200px"><input id="oIn" placeholder="Añadir aeropuerto (p. ej. Tenerife)…"></div><button class="btn" id="oAdd">${ic('plus')} Añadir</button></div></div>

  <div class="card pad section"><h2>🧳 Tu viaje</h2><div class="grid-form" style="margin-top:12px">
    <label class="f">Vigilar${sel('sTrip', [['rt', 'Ida y vuelta'], ['ow', 'Solo ida'], ['both', 'Las dos']], c.trip_type)}</label>
    <label class="f">Noches mínimas<input id="sMinN" type="number" min="1" max="60" value="${esc(c.min_nights)}"></label>
    <label class="f">Noches máximas<input id="sMaxN" type="number" min="1" max="60" value="${esc(c.max_nights)}"></label>
    <label class="f">Viajeros<input id="sPax" type="number" min="1" max="9" value="${esc(c.passengers)}"></label>
    <label class="f">Equipaje${sel('sBag', Object.entries(S.meta.baggage_options), c.baggage)}</label>
    <label class="f">Descuento de residente${sel('sRes', [['', 'No'], ['canarias', 'Canarias (75 %)'], ['baleares', 'Baleares (75 %)']], c.resident_discount)}</label>
    <label class="f">Festivos de${sel('sHol', Object.entries(S.meta.holiday_regions || { '': 'España' }), c.holiday_region)}</label>
    <label class="f">Meses a vigilar<input id="sMonths" type="number" min="1" max="12" value="${esc(c.months_ahead)}"></label>
  </div></div>

  <div class="card pad section"><h2>🔥 Qué es un chollo</h2>
    <p class="small muted" style="margin:4px 0 12px">Los chollos aparecen destacados en tu email diario, como mucho uno por destino.</p>
    <div class="seg" id="lvlSeg">${Object.entries(S.meta.alert_levels).map(([k, l]) => `<button type="button" data-l="${k}" class="${c.alert_level === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <p class="tiny muted" id="lvlHelp" style="margin:8px 0 0">${esc(lvlHelp[c.alert_level] || '')}</p>
    <div class="grid-form" style="margin-top:12px">
      <label class="f">Contar también bajadas simples${sel('sDrops', [['false', 'No (recomendado)'], ['true', 'Sí']], String(!!c.alert_drops))}</label>
      <label class="f">Solo vuelos que salgan dentro de al menos (días)<input id="sLead" type="number" min="0" max="120" value="${esc(c.min_days_ahead)}"></label>
    </div></div>

  <div class="card pad section"><h2>🧭 Filtros</h2>
    <p class="small muted" style="margin:4px 0 12px">Solo se vigilan los vuelos que los cumplan. También son los filtros por defecto de tus búsquedas.</p>
    <div class="grid-form">
      <label class="f">Escalas${sel('sStops', [[-1, 'Cualquiera'], [0, 'Solo directos'], [1, 'Máx. 1 escala'], [2, 'Máx. 2 escalas']], c.max_stops)}</label>
      <label class="f">Duración máx. por trayecto (horas, 0 = sin límite)<input id="sDur" type="number" min="0" max="60" value="${esc(c.max_duration_h || 0)}"></label>
    </div>
    <div class="fl" style="margin-top:12px">Hora de salida</div>
    <div class="chips" id="sWin" style="margin-top:6px">${Object.entries(S.meta.windows).map(([k, l]) => `<button type="button" class="chip ${wins.includes(k) ? 'on' : ''}" data-w="${k}">${WIN_ICON[k]} ${esc(l)} <span class="tiny muted">${WIN_RANGE[k]}</span></button>`).join('')}</div>
    <div class="fl" style="margin-top:12px">Aerolíneas que NO quiero</div>
    <div class="chips" id="sAl" style="margin-top:6px">${Object.entries(S.meta.airlines).sort((x, y) => x[1].localeCompare(y[1])).map(([k, l]) => `<button type="button" class="chip ${excl.includes(k) ? 'off' : ''}" data-a="${k}">${esc(l)}</button>`).join('')}</div>
  </div>

  <div class="card pad section" style="position:sticky;bottom:10px;z-index:5;box-shadow:var(--shadow-lg)"><div class="row"><button class="btn primary" id="sSave">${ic('check')} Guardar</button><button class="btn" id="sMail">📧 Enviarme el resumen ahora</button></div>${saveHelp()}</div>

  <div class="card pad section"><h2>📧 Tu email diario</h2>
    <p class="small muted" style="margin:6px 0 0">Cada día a las 8:00 GitHub te envía el resumen a <b>albertocm30.2001@gmail.com</b>, el email de tu cuenta de GitHub. Si no te llega, revisa en GitHub → <a href="https://github.com/settings/notifications" target="_blank" rel="noopener">Settings → Notifications</a> que el email por defecto sea ese y que «Email» esté marcado, y mira en Spam o Promociones la primera vez.</p></div>`;
  paintIcons(el); bindPending(el, c);

  const drawO = () => { $('#oChips').innerHTML = origins.map((o) => `<span class="chip">${flag(cityInfo(o).country_code)} ${esc(cityName(o))} (${o})<button type="button" class="x" data-rmo="${o}">×</button></span>`).join('') || '<span class="muted small">Añade al menos un aeropuerto</span>'; };
  drawO(); attachAC($('#oIn'), { countries: false });
  $('#oChips').onclick = (e) => { const b = e.target.closest('[data-rmo]'); if (b) { origins = origins.filter((x) => x !== b.dataset.rmo); drawO(); } };
  $('#oAdd').onclick = () => { const r = resolvePlace($('#oIn').value); if (!r.destinations) { toast('Elige un aeropuerto de la lista'); return; } origins = [...new Set([...origins, ...r.destinations])]; $('#oIn').value = ''; drawO(); };
  $('#lvlSeg').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; $$('#lvlSeg [data-l]').forEach((x) => x.classList.toggle('on', x === b)); $('#lvlHelp').textContent = lvlHelp[b.dataset.l] || ''; };
  $('#sWin').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) b.classList.toggle('on'); };
  $('#sAl').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) b.classList.toggle('off'); };
  const read = () => {
    const minN = Math.max(1, +$('#sMinN').value || 1);
    return { ...c, origins, trip_type: $('#sTrip').value, min_nights: minN, max_nights: Math.max(minN, +$('#sMaxN').value || minN),
      passengers: Math.max(1, +$('#sPax').value || 1), baggage: $('#sBag').value, resident_discount: $('#sRes').value, holiday_region: $('#sHol').value,
      months_ahead: Math.min(12, Math.max(1, +$('#sMonths').value || 12)), alert_level: $('#lvlSeg .on')?.dataset.l || 'muy_buena',
      alert_drops: $('#sDrops').value === 'true', min_days_ahead: +$('#sLead').value || 0, max_stops: +$('#sStops').value,
      max_duration_h: +$('#sDur').value || 0, dep_windows: $$('#sWin .on').map((x) => x.dataset.w).join(','),
      exclude_airlines: $$('#sAl .off').map((x) => x.dataset.a) };
  };
  $('#sSave').onclick = () => { if (!origins.length) { toast('Añade al menos un aeropuerto de salida'); return; } sendConfig(read()); route(true); };
  $('#sMail').onclick = () => { sendConfig(read(), { _resumen: true }); toast('Pulsa «Create» en GitHub: el resumen te llegará en unos minutos.', 6000); };
}
