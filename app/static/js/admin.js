/* Flight Tracker — tu panel de control en la web.
   Tus ajustes viven en tu repositorio de GitHub (variables y secrets de Actions), que es
   donde se ejecutan los escaneos. Esta página los lee y los cambia con la API de GitHub,
   usando tu clave (token) guardada SOLO en este dispositivo: se conecta una vez y listo. */
'use strict';

const ADMIN_KEY = 'ft-admin';
function repoGuess() {
  if (S.meta && S.meta.repo) return S.meta.repo;
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i), p = location.pathname.split('/').filter(Boolean)[0];
  return m && p ? `${m[1]}/${p}` : '';
}
function adminCfg() {
  try { const a = JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); return a && a.token && a.repo ? a : null; } catch (e) { return null; }
}
function setAdminCfg(a) { try { if (a) localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); else localStorage.removeItem(ADMIN_KEY); } catch (e) { /* */ } }
const isAdmin = () => !!adminCfg();

/* ---------- API de GitHub ---------- */
async function gh(path, { method = 'GET', body, ok = [200, 201, 204] } = {}) {
  const a = adminCfg(); if (!a) throw new Error('Conecta primero tu GitHub (Ajustes)');
  const r = await fetch(`https://api.github.com/repos/${a.repo}${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${a.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!ok.includes(r.status)) {
    let m = ''; try { m = (await r.json()).message || ''; } catch (e) { /* */ }
    if (r.status === 401) throw new Error('Tu clave de GitHub no es válida o ha caducado. Crea otra en Ajustes.');
    if (r.status === 403) throw new Error(`Tu clave de GitHub no tiene permiso para esto (${m}). Necesita Actions, Secrets y Variables en «Read and write».`);
    if (r.status === 404 && path === '') throw new Error('No encuentro el repositorio (¿nombre correcto? ¿la clave tiene acceso a él?)');
    throw new Error(`GitHub respondió ${r.status}${m ? ': ' + m : ''}`);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function ghVars() {
  const r = await gh('/actions/variables?per_page=50');
  return Object.fromEntries((r.variables || []).map((v) => [v.name, v.value]));
}
async function ghGetVar(name) {
  const r = await gh(`/actions/variables/${name}`, { ok: [200, 404] });
  return r && r.value != null ? r.value : null;
}
async function ghSetVar(name, value) {
  value = value == null ? '' : String(value);
  if (!value) { await gh(`/actions/variables/${name}`, { method: 'DELETE', ok: [204, 404] }); return; }
  const r = await gh(`/actions/variables/${name}`, { method: 'PATCH', body: { name, value }, ok: [204, 404] });
  if (r === null) return;  // 204
  await gh('/actions/variables', { method: 'POST', body: { name, value } });
}
async function ghSecretNames() {
  const r = await gh('/actions/secrets?per_page=50');
  return new Set((r.secrets || []).map((x) => x.name));
}
/* Los secrets se cifran aquí con la clave pública del repositorio (sealed box, como GitHub CLI) */
async function ghSetSecret(name, value) {
  const k = await gh('/actions/secrets/public-key');
  const pk = Uint8Array.from(atob(k.key), (c) => c.charCodeAt(0));
  const sealed = SealBox.seal(new TextEncoder().encode(value), pk);
  let b = ''; sealed.forEach((x) => { b += String.fromCharCode(x); });
  await gh(`/actions/secrets/${name}`, { method: 'PUT', body: { encrypted_value: btoa(b), key_id: k.key_id } });
}
async function ghRunScan(test = false) {
  const info = await gh('');
  await gh('/actions/workflows/scan.yml/dispatches', { method: 'POST', body: { ref: info.default_branch || 'main', inputs: { demo: 'false', ...(test ? { test: 'true' } : {}) } } });
}
async function ghLastRun() {
  const r = await gh('/actions/workflows/scan.yml/runs?per_page=1', { ok: [200, 404] });
  return r && r.workflow_runs ? r.workflow_runs[0] : null;
}
async function ghRunIfIdle() {
  const run = await ghLastRun().catch(() => null);
  if (run && run.status !== 'completed') return false;
  await ghRunScan(); return true;
}

/* ---------- conectar (una vez por dispositivo) ---------- */
function connectHtml() {
  const repo = repoGuess();
  return `<div class="card pad admin-box"><h2>🔑 Conecta tu GitHub (una sola vez)</h2>
    <p class="small muted" style="margin:6px 0 10px">Tus ajustes se guardan en tu repositorio. Para cambiarlos desde aquí, esta página necesita una clave de GitHub. Se guarda <b>solo en este dispositivo</b> y no tendrás que volver a ponerla.</p>
    <ol class="small" style="margin:0 0 12px;padding-left:18px;line-height:1.7">
      <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener"><b>GitHub → Fine-grained token</b></a>.</li>
      <li>Nombre: «Flight Tracker». Caducidad: la más larga que te deje.</li>
      <li><b>Repository access</b> → «Only select repositories» → <b>${esc(repo || 'tu repositorio')}</b>.</li>
      <li><b>Permissions</b> → <b>Actions</b>, <b>Secrets</b> y <b>Variables</b> → «Read and write».</li>
      <li>Pulsa <b>Generate token</b>, cópialo y pégalo aquí.</li></ol>
    <div class="grid-form">
      <label class="f">Repositorio<input id="adRepo" value="${esc(repo)}" placeholder="usuario/repositorio"></label>
      <label class="f">Clave (token)<input id="adTok" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary" id="adGo">${ic('check')} Conectar</button>
    </div><p class="small" id="adMsg" style="margin:8px 0 0"></p></div>`;
}
function bindConnect(root) {
  $('#adGo', root)?.addEventListener('click', async () => {
    const repo = $('#adRepo', root).value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, ''), token = $('#adTok', root).value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { $('#adMsg', root).textContent = 'Rellena el repositorio (usuario/repositorio) y la clave.'; return; }
    setAdminCfg({ repo, token });
    $('#adMsg', root).textContent = 'Comprobando…';
    try { await gh(''); await ghVars(); await ghSecretNames(); toast('🔑 Conectado. Ya puedes gestionarlo todo desde aquí.'); refreshStatus(); route(true); }
    catch (e) { setAdminCfg(null); $('#adMsg', root).textContent = `❌ ${e.message}`; }
  });
}

/* ---------- MIS DESTINOS ---------- */
async function destinationsView(el) {
  const published = await api('/api/destinations');
  const admin = isAdmin();
  let codes = published.map((d) => d.code), err = '';
  if (admin) { try { const v = await ghGetVar('DESTINATIONS'); if (v != null) codes = v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); } catch (e) { err = e.message; } }
  const pubSet = new Set(published.map((d) => d.code));
  let list = [...codes];
  const draw = () => {
    const changed = list.join(',') !== codes.join(',');
    el.innerHTML = `<div class="page-head"><div><h1>Mis destinos</h1><p>Los vigilamos cada 6 horas y te avisamos por email de los chollos.</p></div></div>
      ${err ? `<div class="banner warn">⚠️ <div>${esc(err)}</div></div>` : ''}
      ${admin ? `<div class="card pad"><div class="row">
          <div style="flex:1;min-width:220px"><input id="sdIn" placeholder="Ciudad, código o país entero…"></div>
          <button class="btn primary" id="sdAdd">${ic('plus')} Añadir</button></div>
          <div class="chips" style="margin-top:12px"><span class="small muted" style="align-self:center">De golpe:</span>${Object.entries(S.meta.themes).map(([k, t]) => `<button class="chip" data-th="${k}">${t.icon} ${esc(t.label)}</button>`).join('')}</div></div>` : ''}
      <div class="card pad section"><div class="row"><h3>${list.length} destinos</h3><span class="spacer"></span>
        ${admin ? `<button class="btn ${changed ? 'primary' : ''}" id="sdSave" ${changed ? '' : 'disabled'}>${ic('check')} Guardar</button>` : ''}</div>
        <div class="chips dest-chips" style="margin-top:12px">${list.map((c) => `<span class="chip">${flag(cityInfo(c).country_code)} ${esc(cityName(c))} <span class="tiny muted">${c}</span>${pubSet.has(c) ? '' : ' <span class="pill warn" title="Tendrá precios tras el próximo escaneo">nuevo</span>'}${admin ? `<button class="x" data-rm="${c}" title="Quitar">×</button>` : ''}</span>`).join('') || '<span class="muted small">Aún no hay destinos.</span>'}</div>
        ${admin && changed ? '<p class="tiny muted" style="margin:10px 0 0">Tienes cambios sin guardar.</p>' : ''}
        <p class="tiny muted" id="sdRun" style="margin:10px 0 0"></p></div>
      ${admin ? '' : `<div class="section">${connectHtml()}</div>`}`;
    paintIcons(el);
    if (!admin) { bindConnect(el); return; }
    attachAC($('#sdIn'));
    const add = (arr) => { const n = arr.filter((c) => !list.includes(c)); list = [...list, ...n]; draw(); toast(n.length ? `⭐ ${n.length} añadido${n.length > 1 ? 's' : ''}. Pulsa «Guardar».` : 'Ya estaba en la lista'); };
    $('#sdAdd').onclick = () => {
      const r = resolvePlace($('#sdIn').value);
      if (r.destinations) add(r.destinations);
      else if (r.country) add(S.catalog.filter((c) => c.country_code === r.country).map((c) => c.code));
      else toast('Elige un destino de la lista');
    };
    el.onclick = (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { list = list.filter((c) => c !== rm.dataset.rm); draw(); return; }
      const th = e.target.closest('[data-th]'); if (th) add((S.meta.theme_codes[th.dataset.th] || []).filter((c) => !(S.settings.origins || []).includes(c)));
    };
    $('#sdSave').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await ghSetVar('DESTINATIONS', list.join(','));
        codes = [...list];
        toast(await ghRunIfIdle().catch(() => false) ? '✅ Guardado. Buscando precios: tu web se actualizará en unos minutos.' : '✅ Guardado. Se aplicará en el próximo escaneo.', 6000);
        draw(); pollRun($('#sdRun'));
      } catch (err2) { toast(err2.message, 7000); draw(); }
    };
  };
  draw();
  if (admin) pollRun($('#sdRun'));
}
async function pollRun(box) {
  try {
    const run = await ghLastRun(); if (!box || !run || !box.isConnected) return;
    const ok = run.conclusion === 'success';
    box.innerHTML = run.status === 'completed'
      ? `Último escaneo: ${ok ? '✅' : '❌'} ${ago(run.updated_at)}${ok ? '' : ' (ha fallado)'} · <a href="${esc(run.html_url)}" target="_blank" rel="noopener">ver detalles</a>`
      : `⏳ Escaneando ahora (empezó ${ago(run.created_at)})… <a href="${esc(run.html_url)}" target="_blank" rel="noopener">ver</a>`;
    if (run.status !== 'completed') setTimeout(() => pollRun(box), 15000);
  } catch (e) { /* */ }
}

/* ---------- AJUSTES ---------- */
async function settingsView(el) {
  if (!isAdmin()) {
    el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Destinos, filtros, avisos por email… todo desde aquí.</p></div></div>${connectHtml()}`;
    paintIcons(el); bindConnect(el); return;
  }
  el.innerHTML = '<div class="page-head"><div><h1>Ajustes</h1></div></div><div class="card pad"><div class="skel" style="height:160px"></div></div>';
  let V, secrets;
  try { [V, secrets] = await Promise.all([ghVars(), ghSecretNames()]); }
  catch (e) { el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1></div></div><div class="banner warn">⚠️ <div>${esc(e.message)}</div></div>`; return; }
  const st = S.settings || {};
  const val = (name, key, dflt = '') => (V[name] != null ? V[name] : (st[key] != null && st[key] !== '' ? st[key] : dflt));
  let origins = String(val('ORIGINS', 'origins', '')).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const wins = String(val('DEP_WINDOWS', 'dep_windows', '')).split(',').filter(Boolean);
  const excl = String(V.EXCLUDE_AIRLINES ?? (st.exclude_airlines || []).join(',')).split(',').filter(Boolean);
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(cur) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const lvl = val('ALERT_LEVEL', 'alert_level', 'muy_buena');
  const lvlHelp = { excepcional: 'Solo errores de tarifa y ofertas de ≥40 % bajo lo habitual. Muy pocos emails.', muy_buena: 'Ofertas de ≥30 % bajo lo habitual y entre las fechas más baratas del año.', buena: 'Ofertas de ≥20 % bajo lo habitual. Más emails.' };
  const hasTP = secrets.has('TRAVELPAYOUTS_TOKEN'), hasMail = !!V.EMAIL_TO && secrets.has('SMTP_PASSWORD');
  el.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Se guardan en tu GitHub y se aplican en el siguiente escaneo.</p></div></div>
  <div class="card pad"><h2>✈️ Desde dónde sales</h2>
    <div class="chips" id="oChips" style="margin-top:10px"></div>
    <div class="row" style="margin-top:10px"><div style="flex:1;min-width:200px"><input id="oIn" placeholder="Añadir aeropuerto (p. ej. Tenerife)…"></div><button class="btn" id="oAdd">${ic('plus')} Añadir</button></div></div>

  <div class="card pad section"><h2>🧳 Tu viaje</h2><div class="grid-form" style="margin-top:12px">
    <label class="f">Vigilar${sel('sTrip', [['rt', 'Ida y vuelta'], ['ow', 'Solo ida'], ['both', 'Las dos']], val('TRIP_TYPE', 'trip_type', 'rt'))}</label>
    <label class="f">Noches mínimas<input id="sMinN" type="number" min="1" max="60" value="${esc(val('MIN_NIGHTS', 'min_nights', 3))}"></label>
    <label class="f">Noches máximas<input id="sMaxN" type="number" min="1" max="60" value="${esc(val('MAX_NIGHTS', 'max_nights', 10))}"></label>
    <label class="f">Viajeros<input id="sPax" type="number" min="1" max="9" value="${esc(val('PASSENGERS', 'passengers', 1))}"></label>
    <label class="f">Equipaje${sel('sBag', Object.entries(S.meta.baggage_options), val('BAGGAGE', 'baggage', 'personal'))}</label>
    <label class="f">Descuento de residente${sel('sRes', [['', 'No'], ['canarias', 'Canarias (75 %)'], ['baleares', 'Baleares (75 %)']], val('RESIDENT_DISCOUNT', 'resident_discount', ''))}</label>
    <label class="f">Meses a vigilar<input id="sMonths" type="number" min="1" max="12" value="${esc(val('MONTHS_AHEAD', 'months_ahead', 12))}"></label>
  </div></div>

  <div class="card pad section"><h2>🔔 Qué merece un email</h2>
    <p class="small muted" style="margin:4px 0 12px">Como mucho <b>un aviso por destino</b>, y no se repite salvo que salga algo claramente mejor.</p>
    <div class="seg" id="lvlSeg">${Object.entries(S.meta.alert_levels).map(([k, l]) => `<button type="button" data-l="${k}" class="${lvl === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <p class="tiny muted" id="lvlHelp" style="margin:8px 0 0">${esc(lvlHelp[lvl] || '')}</p>
    <div class="grid-form" style="margin-top:12px">
      <label class="f">Avisar también de bajadas simples${sel('sDrops', [['false', 'No (recomendado)'], ['true', 'Sí']], val('ALERT_DROPS', 'alert_drops', 'false'))}</label>
      <label class="f">Solo vuelos que salgan dentro de al menos (días)<input id="sLead" type="number" min="0" max="120" value="${esc(val('MIN_DAYS_AHEAD', 'min_days_ahead', 14))}"></label>
      <label class="f">No enviar emails entre (horas)<input id="sQuiet" placeholder="p. ej. 23-8" value="${esc(val('QUIET_HOURS', 'quiet_hours', ''))}"></label>
    </div></div>

  <div class="card pad section"><h2>🧭 Filtros</h2>
    <p class="small muted" style="margin:4px 0 12px">Solo se vigilan (y avisan) los vuelos que los cumplan. También son los filtros por defecto de tus búsquedas.</p>
    <div class="grid-form">
      <label class="f">Escalas${sel('sStops', [[-1, 'Cualquiera'], [0, 'Solo directos'], [1, 'Máx. 1 escala'], [2, 'Máx. 2 escalas']], val('MAX_STOPS', 'max_stops', -1))}</label>
      <label class="f">Duración máx. por trayecto (horas, 0 = sin límite)<input id="sDur" type="number" min="0" max="60" value="${esc(val('MAX_DURATION_H', 'max_duration_h', 0))}"></label>
    </div>
    <div class="fl" style="margin-top:12px">Hora de salida</div>
    <div class="chips" id="sWin" style="margin-top:6px">${Object.entries(S.meta.windows).map(([k, l]) => `<button type="button" class="chip ${wins.includes(k) ? 'on' : ''}" data-w="${k}">${WIN_ICON[k]} ${esc(l)} <span class="tiny muted">${WIN_RANGE[k]}</span></button>`).join('')}</div>
    <div class="fl" style="margin-top:12px">Aerolíneas que NO quiero</div>
    <div class="chips" id="sAl" style="margin-top:6px">${Object.entries(S.meta.airlines).sort((x, y) => x[1].localeCompare(y[1])).map(([k, l]) => `<button type="button" class="chip ${excl.includes(k) ? 'off' : ''}" data-a="${k}">${esc(l)}</button>`).join('')}</div>
  </div>

  <div class="row section" style="position:sticky;bottom:calc(var(--bottomnav-h, 0px) + 10px);z-index:5"><button class="btn primary" id="sSave" style="box-shadow:var(--shadow-lg)">${ic('check')} Guardar ajustes</button><span class="small muted" id="sMsg"></span></div>

  <div class="card pad section admin-box"><h2>✉️ Email para los avisos ${hasMail ? '<span class="pill good">activo</span>' : '<span class="pill warn">sin configurar</span>'}</h2>
    <p class="small muted" style="margin:6px 0 12px">Con Gmail necesitas una <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">contraseña de aplicación</a> (requiere verificación en 2 pasos). No es tu contraseña normal.</p>
    <div class="grid-form">
      <label class="f">Tu email<input id="emTo" type="email" value="${esc(V.EMAIL_TO || '')}" placeholder="tu@gmail.com"></label>
      <label class="f">Contraseña de aplicación<input id="emPw" type="password" autocomplete="new-password" placeholder="${secrets.has('SMTP_PASSWORD') ? '•••• guardada (vacío = mantener)' : '16 letras'}"></label>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="emSave">${ic('check')} Guardar email</button><button class="btn" id="emTest">📨 Enviarme un email de prueba</button></div></div>

  <div class="card pad section"><h2>🔌 Precios reales ${hasTP ? '<span class="pill good">activo</span>' : '<span class="pill warn">modo demo</span>'}</h2>
    <p class="small muted" style="margin:6px 0 12px">${hasTP ? 'Tu clave de Travelpayouts está guardada.' : 'Sin clave se usan precios simulados.'} La clave es gratis en <a href="https://www.travelpayouts.com" target="_blank" rel="noopener">travelpayouts.com</a> → Tools → API.</p>
    <div class="row"><input id="tpTok" type="password" autocomplete="off" placeholder="${hasTP ? '•••• guardada (pega otra para cambiarla)' : 'Clave (API token) de Travelpayouts'}" style="flex:1;min-width:200px"><button class="btn" id="tpSave">Guardar clave</button></div></div>

  <div class="card pad section"><h2>⏱️ Escaneos</h2>
    <label class="check" style="margin-top:8px"><input type="checkbox" id="sSched" ${V.ENABLE_SCHEDULED_SCAN === 'true' ? 'checked' : ''}> Buscar precios automáticamente cada 6 horas</label>
    <div class="row" style="margin-top:12px"><button class="btn" id="sRun">${ic('refresh')} Escanear ahora</button><span class="tiny muted" id="sRunSt"></span></div></div>

  <div class="row section"><span class="tiny muted">Conectado a <b>${esc(adminCfg().repo)}</b> desde este dispositivo.</span><span class="spacer"></span><button class="btn ghost sm" id="sOut">Desconectar este dispositivo</button></div>`;
  paintIcons(el);

  const drawO = () => { $('#oChips').innerHTML = origins.map((o) => `<span class="chip">${flag(cityInfo(o).country_code)} ${esc(cityName(o))} (${o})<button type="button" class="x" data-rmo="${o}">×</button></span>`).join('') || '<span class="muted small">Añade al menos un aeropuerto</span>'; };
  drawO(); attachAC($('#oIn'), { countries: false });
  $('#oChips').onclick = (e) => { const b = e.target.closest('[data-rmo]'); if (b) { origins = origins.filter((x) => x !== b.dataset.rmo); drawO(); } };
  $('#oAdd').onclick = () => { const r = resolvePlace($('#oIn').value); if (!r.destinations) { toast('Elige un aeropuerto de la lista'); return; } origins = [...new Set([...origins, ...r.destinations])]; $('#oIn').value = ''; drawO(); };
  $('#lvlSeg').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; $$('#lvlSeg [data-l]').forEach((x) => x.classList.toggle('on', x === b)); $('#lvlHelp').textContent = lvlHelp[b.dataset.l] || ''; };
  $('#sWin').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) b.classList.toggle('on'); };
  $('#sAl').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) b.classList.toggle('off'); };
  pollRun($('#sRunSt'));

  $('#sSave').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!origins.length) { toast('Añade al menos un aeropuerto de salida'); return; }
    const minN = Math.max(1, +$('#sMinN').value || 1);
    const want = {
      ORIGINS: origins.join(','), TRIP_TYPE: $('#sTrip').value, MIN_NIGHTS: minN, MAX_NIGHTS: Math.max(minN, +$('#sMaxN').value || minN),
      PASSENGERS: Math.max(1, +$('#sPax').value || 1), BAGGAGE: $('#sBag').value, RESIDENT_DISCOUNT: $('#sRes').value,
      MONTHS_AHEAD: Math.min(12, Math.max(1, +$('#sMonths').value || 12)),
      ALERT_LEVEL: $('#lvlSeg .on')?.dataset.l || 'muy_buena', ALERT_DROPS: $('#sDrops').value, MIN_DAYS_AHEAD: +$('#sLead').value || 0,
      QUIET_HOURS: /^\d{1,2}-\d{1,2}$/.test($('#sQuiet').value.trim()) ? $('#sQuiet').value.trim() : '',
      MAX_STOPS: $('#sStops').value, MAX_DURATION_H: +$('#sDur').value ? +$('#sDur').value : '',
      DEP_WINDOWS: $$('#sWin .on').map((x) => x.dataset.w).join(','), EXCLUDE_AIRLINES: $$('#sAl .off').map((x) => x.dataset.a).join(','),
      SITE_URL: location.origin + location.pathname.replace(/index\.html$/, ''), PUBLISH_SITE: 'true',
    };
    btn.disabled = true; $('#sMsg').textContent = 'Guardando…';
    try {
      const changed = Object.entries(want).filter(([k, v]) => String(V[k] ?? '') !== String(v));
      for (const [k, v] of changed) { await ghSetVar(k, v); V[k] = String(v); }
      if (!V.ENABLE_SCHEDULED_SCAN) { await ghSetVar('ENABLE_SCHEDULED_SCAN', 'true'); V.ENABLE_SCHEDULED_SCAN = 'true'; $('#sSched').checked = true; }
      const ran = changed.length ? await ghRunIfIdle().catch(() => false) : false;
      $('#sMsg').textContent = changed.length ? (ran ? '✅ Guardado. Aplicándolo: tu web se actualizará en unos minutos.' : '✅ Guardado. Se aplicará en el próximo escaneo.') : 'No había cambios.';
      pollRun($('#sRunSt'));
    } catch (err) { $('#sMsg').textContent = ''; toast(err.message, 7000); }
    btn.disabled = false;
  };
  $('#emSave').onclick = async (e) => {
    const btn = e.currentTarget, to = $('#emTo').value.trim(), pw = $('#emPw').value.replace(/\s+/g, '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Escribe un email válido'); return; }
    if (!pw && !secrets.has('SMTP_PASSWORD')) { toast('Falta la contraseña de aplicación'); return; }
    btn.disabled = true;
    try {
      await ghSetVar('EMAIL_TO', to); V.EMAIL_TO = to;
      if (pw) { await ghSetSecret('SMTP_PASSWORD', pw); secrets.add('SMTP_PASSWORD'); $('#emPw').value = ''; }
      if (!/@(gmail|googlemail)\.com$/i.test(to)) toast('Guardado. Ojo: está pensado para Gmail; con otros correos puede no funcionar.', 7000);
      else toast('✅ Email guardado. Pulsa «Enviarme un email de prueba» para comprobarlo.', 6000);
    } catch (err) { toast(err.message, 7000); }
    btn.disabled = false;
  };
  $('#emTest').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await ghRunScan(true); toast('📨 Enviando… te llegará en 1–2 minutos. Si no llega, mira «Último escaneo» abajo.', 7000); setTimeout(() => pollRun($('#sRunSt')), 4000); }
    catch (err) { toast(err.message, 7000); }
    btn.disabled = false;
  };
  $('#tpSave').onclick = async (e) => {
    const btn = e.currentTarget, v = $('#tpTok').value.trim();
    if (!v) { toast('Pega la clave de Travelpayouts'); return; }
    btn.disabled = true;
    try { await ghSetSecret('TRAVELPAYOUTS_TOKEN', v); $('#tpTok').value = ''; toast(await ghRunIfIdle().catch(() => false) ? '✅ Guardada. Buscando precios reales…' : '✅ Guardada.', 6000); }
    catch (err) { toast(err.message, 7000); }
    btn.disabled = false;
  };
  $('#sSched').onchange = async (e) => {
    try { await ghSetVar('ENABLE_SCHEDULED_SCAN', e.target.checked ? 'true' : 'false'); toast(e.target.checked ? '✅ Escaneo automático activado' : 'Escaneo automático pausado'); }
    catch (err) { toast(err.message, 7000); e.target.checked = !e.target.checked; }
  };
  $('#sRun').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await ghRunScan(); toast('✈️ Escaneando: tu web se actualizará en unos minutos.', 6000); setTimeout(() => pollRun($('#sRunSt')), 4000); } catch (err) { toast(err.message, 7000); }
    btn.disabled = false;
  };
  $('#sOut').onclick = () => { if (confirm('¿Desconectar tu GitHub de este dispositivo?')) { setAdminCfg(null); refreshStatus(); route(true); } };
}
