/* Flight Tracker — modo administrador de la web pública (solo el dueño).
   La web pública es estática (GitHub Pages): no tiene servidor donde guardar cambios.
   Para que el dueño pueda gestionar sus destinos y avisos desde el móvil, este módulo
   habla directamente con la API de GitHub usando un token personal que se guarda SOLO
   en el navegador de ese móvil (nunca se publica). Cambia las variables de Actions
   (DESTINATIONS, ALERT_LEVEL…) y lanza un escaneo; la web se regenera en unos minutos. */
'use strict';

const ADMIN_KEY = 'ft-admin';
function adminCfg() {
  try { const a = JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); return a && a.token && a.repo ? a : null; } catch (e) { return null; }
}
function setAdminCfg(a) { try { if (a) localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); else localStorage.removeItem(ADMIN_KEY); } catch (e) { /* */ } }
const isAdmin = () => S.static && !!adminCfg();

async function gh(path, { method = 'GET', body, ok = [200, 201, 204] } = {}) {
  const a = adminCfg(); if (!a) throw new Error('Conecta primero tu cuenta de GitHub');
  const r = await fetch(`https://api.github.com/repos/${a.repo}${path}`, {
    method, headers: { Authorization: `Bearer ${a.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!ok.includes(r.status)) {
    let m = ''; try { m = (await r.json()).message || ''; } catch (e) { /* */ }
    if (r.status === 401) throw new Error('Token de GitHub no válido o caducado');
    if (r.status === 403) throw new Error(`El token no tiene permiso (${m}). Necesita «Variables» y «Actions» en Read and write.`);
    if (r.status === 404 && path === '') throw new Error('No encuentro el repositorio (¿nombre correcto? ¿el token tiene acceso?)');
    throw new Error(`GitHub respondió ${r.status}${m ? ': ' + m : ''}`);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function ghGetVar(name) {
  const r = await gh(`/actions/variables/${name}`, { ok: [200, 404] });
  return r && r.value != null ? r.value : null;
}
async function ghSetVar(name, value) {
  value = value == null ? '' : String(value);
  if (!value) { await gh(`/actions/variables/${name}`, { method: 'DELETE', ok: [204, 404] }); return; }
  const r = await fetch(`https://api.github.com/repos/${adminCfg().repo}/actions/variables/${name}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${adminCfg().token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value }) });
  if (r.status === 404) await gh('/actions/variables', { method: 'POST', body: { name, value } });
  else if (r.status !== 204) { let m = ''; try { m = (await r.json()).message; } catch (e) { /* */ } throw new Error(r.status === 403 ? 'El token no tiene permiso para cambiar variables («Variables: Read and write»).' : `GitHub respondió ${r.status} ${m}`); }
}
async function ghRunScan() {
  const info = await gh('');
  await gh('/actions/workflows/scan.yml/dispatches', { method: 'POST', body: { ref: info.default_branch || 'main', inputs: { demo: 'false' } } });
}
async function ghLastRun() {
  const r = await gh('/actions/workflows/scan.yml/runs?per_page=1', { ok: [200, 404] });
  return r && r.workflow_runs ? r.workflow_runs[0] : null;
}

/* ---------- conectar (solo en el dispositivo del dueño) ---------- */
function adminConnectHtml() {
  const repo = S.meta.repo || '';
  return `<div class="card pad admin-box"><h2>🔑 Modo administrador</h2>
    <p class="small muted" style="margin:6px 0 10px">Para cambiar destinos y avisos desde aquí, conecta tu GitHub una vez. El token se guarda <b>solo en este navegador</b>; nunca se publica.</p>
    <ol class="small" style="margin:0 0 12px;padding-left:18px;line-height:1.6">
      <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a>.</li>
      <li><b>Repository access</b>: «Only select repositories» → <b>${esc(repo || 'tu repositorio')}</b>.</li>
      <li><b>Permissions</b>: <b>Actions</b> y <b>Variables</b> → «Read and write».</li>
      <li>Genera el token y pégalo aquí.</li></ol>
    <div class="grid-form">
      <label class="f">Repositorio<input id="adRepo" value="${esc(repo)}" placeholder="usuario/repositorio"></label>
      <label class="f">Token<input id="adTok" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary" id="adGo">${ic('check')} Conectar</button>
    </div><p class="tiny muted" id="adMsg" style="margin:8px 0 0"></p></div>`;
}
function bindAdminConnect(root, after) {
  $('#adGo', root)?.addEventListener('click', async () => {
    const repo = $('#adRepo', root).value.trim(), token = $('#adTok', root).value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { $('#adMsg', root).textContent = 'Rellena el repositorio (usuario/repositorio) y el token.'; return; }
    setAdminCfg({ repo, token });
    $('#adMsg', root).textContent = 'Comprobando…';
    try { await gh(''); await ghGetVar('DESTINATIONS'); toast('🔑 Conectado. Ya puedes gestionar la web desde aquí.'); after(); }
    catch (e) { setAdminCfg(null); $('#adMsg', root).textContent = `❌ ${e.message}`; }
  });
}

/* ---------- Destinos (web pública) ---------- */
const staticDestView = async (el) => {
  const published = await api('/api/destinations');
  const admin = isAdmin();
  let codes = published.map((d) => d.code), remoteErr = '';
  if (admin) {
    try { const v = await ghGetVar('DESTINATIONS'); if (v != null) codes = v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); } catch (e) { remoteErr = e.message; }
  }
  const pubSet = new Set(published.map((d) => d.code));
  let list = [...codes];
  const draw = () => {
    const changed = list.join(',') !== codes.join(',');
    el.innerHTML = `<div class="page-head"><div><h1>Destinos vigilados</h1><p>${admin ? 'Añade o quita destinos: la web se actualiza sola en unos minutos.' : 'Los precios de esta web son de estos destinos.'}</p></div></div>
      ${remoteErr ? `<div class="banner warn">⚠️ <div>${esc(remoteErr)}</div></div>` : ''}
      ${admin ? `<div class="card pad"><div class="row">
          <div style="flex:1;min-width:220px"><input id="sdIn" placeholder="Ciudad, código o país entero…"></div>
          <button class="btn primary" id="sdAdd">${ic('plus')} Añadir</button></div>
          <div class="chips" style="margin-top:12px"><span class="small muted" style="align-self:center">De golpe:</span>${Object.entries(S.meta.themes).map(([k, t]) => `<button class="chip" data-th="${k}">${t.icon} ${esc(t.label)}</button>`).join('')}</div></div>` : ''}
      <div class="card pad section"><div class="row"><h3>${list.length} destinos</h3><span class="spacer"></span>
        ${admin ? `<button class="btn ${changed ? 'primary' : ''}" id="sdSave" ${changed ? '' : 'disabled'}>${ic('check')} Guardar y actualizar la web</button>` : ''}</div>
        <div class="chips dest-chips" style="margin-top:12px">${list.map((c) => `<span class="chip">${flag(cityInfo(c).country_code)} ${esc(cityName(c))} <span class="tiny muted">${c}</span>${pubSet.has(c) ? '' : ' <span class="pill warn" title="Aparecerá tras el próximo escaneo">nuevo</span>'}${admin ? `<button class="x" data-rm="${c}" title="Quitar">×</button>` : ''}</span>`).join('') || '<span class="muted small">Sin destinos.</span>'}</div>
        ${admin && changed ? '<p class="tiny muted" style="margin:10px 0 0">Tienes cambios sin guardar.</p>' : ''}
        <p class="tiny muted" id="sdRun" style="margin:10px 0 0"></p></div>
      ${admin ? `<div class="row section"><span class="tiny muted">Conectado a ${esc(adminCfg().repo)}</span><span class="spacer"></span><button class="btn ghost sm" id="sdOut">Desconectar este móvil</button></div>`
        : (isOwnerDevice() ? `<div class="section">${adminConnectHtml()}</div>` : '<div class="card pad section small muted">Solo el dueño de esta web puede cambiar los destinos.</div>')}`;
    paintIcons(el);
    if (!admin) { bindAdminConnect(el, () => route(true)); return; }
    attachAC($('#sdIn'));
    const add = (arr) => { const n = arr.filter((c) => !list.includes(c)); list = [...list, ...n]; draw(); if (n.length) toast(`⭐ ${n.length} añadido${n.length > 1 ? 's' : ''}. Pulsa «Guardar».`); else toast('Ya estaba en la lista'); };
    $('#sdAdd').onclick = () => {
      const r = resolvePlace($('#sdIn').value);
      if (r.destinations) add(r.destinations);
      else if (r.country) add(S.catalog.filter((c) => c.country_code === r.country).map((c) => c.code));
      else toast('Elige un destino de la lista');
    };
    $('#sdIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(() => $('#sdAdd').click(), 0); });
    el.onclick = async (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { list = list.filter((c) => c !== rm.dataset.rm); draw(); return; }
      const th = e.target.closest('[data-th]'); if (th) { add((S.meta.theme_codes[th.dataset.th] || []).filter((c) => !(S.settings.origins || []).includes(c))); return; }
    };
    $('#sdOut').onclick = () => { if (confirm('¿Desconectar tu GitHub de este navegador?')) { setAdminCfg(null); route(true); } };
    $('#sdSave').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await ghSetVar('DESTINATIONS', list.join(','));
        codes = [...list];
        try { await ghRunScan(); toast('✅ Guardado. Escaneando: la web se actualizará en unos minutos.', 6000); }
        catch (err) { toast(`Guardado, pero no pude lanzar el escaneo (${err.message}). Se hará en el próximo automático.`, 8000); }
        draw(); pollRun();
      } catch (err) { toast(err.message, 7000); draw(); }
    };
  };
  const pollRun = async () => {
    try {
      const run = await ghLastRun(); const box = $('#sdRun'); if (!box || !run) return;
      box.innerHTML = run.status === 'completed' ? `Último escaneo: ${run.conclusion === 'success' ? '✅' : '❌'} ${ago(run.updated_at)} · <a href="${esc(run.html_url)}" target="_blank" rel="noopener">ver</a>`
        : `⏳ Escaneo en marcha (${ago(run.created_at)})… <a href="${esc(run.html_url)}" target="_blank" rel="noopener">ver</a>`;
      if (run.status !== 'completed' && S.view === 'destinations') setTimeout(pollRun, 15000);
    } catch (e) { /* */ }
  };
  draw();
  if (admin) pollRun();
};

/* ---------- Avisos y filtros (web pública, solo administrador) ---------- */
async function adminAlertsCard(box) {
  if (!isAdmin()) { box.innerHTML = isOwnerDevice() ? adminConnectHtml() : ''; bindAdminConnect(box, () => route(true)); return; }
  box.innerHTML = '<div class="card pad"><div class="skel" style="height:90px"></div></div>';
  const names = ['ALERT_LEVEL', 'ALERT_DROPS', 'MAX_STOPS', 'MAX_DURATION_H', 'DEP_WINDOWS'];
  let cur = {};
  try { const vals = await Promise.all(names.map(ghGetVar)); names.forEach((n, i) => { cur[n] = vals[i]; }); }
  catch (e) { box.innerHTML = `<div class="banner warn">⚠️ <div>${esc(e.message)}</div></div>`; return; }
  const st = S.settings;
  const v = { level: cur.ALERT_LEVEL || st.alert_level || 'muy_buena', drops: (cur.ALERT_DROPS || String(!!st.alert_drops)) === 'true',
    stops: cur.MAX_STOPS ?? String(st.max_stops ?? -1), dur: cur.MAX_DURATION_H || String(st.max_duration_h || 0),
    wins: (cur.DEP_WINDOWS ?? st.dep_windows ?? '').split(',').filter(Boolean) };
  box.innerHTML = `<div class="card pad admin-box"><h2>🔔 Mis avisos</h2>
    <p class="small muted" style="margin:6px 0 12px">Como mucho un aviso por destino y escaneo. Elige cuánto de buena tiene que ser una oferta:</p>
    <div class="seg" id="aLvl">${Object.entries(S.meta.alert_levels || {}).map(([k, l]) => `<button type="button" data-l="${k}" class="${v.level === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <div class="grid-form" style="margin-top:12px">
      <label class="f">Bajadas simples<select id="aDrops"><option value="false">No avisar</option><option value="true" ${v.drops ? 'selected' : ''}>Avisar</option></select></label>
      <label class="f">Escalas<select id="aStops">${[[-1, 'Cualquiera'], [0, 'Solo directos'], [1, 'Máx. 1'], [2, 'Máx. 2']].map(([k, l]) => `<option value="${k}" ${String(k) === String(v.stops) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Duración máx. por trayecto (h, 0 = sin límite)<input id="aDur" type="number" min="0" max="60" value="${esc(v.dur)}"></label>
    </div>
    <div class="fl" style="margin-top:12px">Hora de salida</div>
    <div class="chips" id="aWin" style="margin-top:6px">${Object.entries(S.meta.windows || {}).map(([k, l]) => `<button type="button" class="chip ${v.wins.includes(k) ? 'on' : ''}" data-w="${k}">${WIN_ICON[k]} ${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="aSave">${ic('check')} Guardar</button><span class="tiny muted">Se aplica desde el próximo escaneo.</span></div></div>`;
  paintIcons(box);
  $('#aLvl', box).onclick = (e) => { const b = e.target.closest('[data-l]'); if (b) $$('#aLvl [data-l]', box).forEach((x) => x.classList.toggle('on', x === b)); };
  $('#aWin', box).onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) b.classList.toggle('on'); };
  $('#aSave', box).onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await ghSetVar('ALERT_LEVEL', $('#aLvl .on', box)?.dataset.l || 'muy_buena');
      await ghSetVar('ALERT_DROPS', $('#aDrops', box).value);
      await ghSetVar('MAX_STOPS', $('#aStops', box).value);
      await ghSetVar('MAX_DURATION_H', +$('#aDur', box).value ? $('#aDur', box).value : '');
      await ghSetVar('DEP_WINDOWS', $$('#aWin .on', box).map((x) => x.dataset.w).join(','));
      toast('✅ Avisos guardados');
    } catch (err) { toast(err.message, 7000); }
    btn.disabled = false;
  };
}
