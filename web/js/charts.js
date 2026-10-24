/* Flight Tracker — gráficos SVG propios (sin librerías) */
'use strict';
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const STOPS = [[16, 185, 129], [132, 204, 22], [251, 191, 36], [249, 115, 22], [239, 68, 68]];
  const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* color de 0 (barato, verde) a 1 (caro, rojo) */
  function colorAt(t) {
    t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
  }
  /* escala por posición (cuantil) entre todos los precios: los colores se reparten bien aunque haya extremos */
  function scale(values) {
    const s = [...values].sort((a, b) => a - b);
    if (!s.length) return () => colorAt(.5);
    return (v) => {
      let lo = 0, hi = s.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; }
      return colorAt(s.length > 1 ? lo / (s.length - 1) : 0);
    };
  }

  /* ---------- tooltip ---------- */
  let tip;
  function showTip(html, e) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
    tip.innerHTML = html; tip.style.display = 'block';
    const x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14), y = Math.min(window.innerHeight - tip.offsetHeight - 10, e.clientY + 14);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  document.addEventListener('scroll', hideTip, true);

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgFor(box, w, h) {
    box.innerHTML = '';
    return el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img' }, box);
  }
  /* vuelve a dibujar al cambiar el ancho del contenedor */
  function responsive(box, draw) {
    let last = 0;
    const run = () => { const w = Math.max(240, Math.floor(box.clientWidth)); if (w !== last) { last = w; draw(w); } };
    run();
    if (window.ResizeObserver) new ResizeObserver(run).observe(box);
  }
  function niceTicks(lo, hi, n = 4) {
    if (hi <= lo) hi = lo + 1;
    const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    const out = []; for (let v = Math.floor(lo / step) * step; ; v += step) { out.push(+v.toFixed(6)); if (v >= hi - 1e-9) break; }
    return out;
  }
  const fmtDay = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${MON[d.getMonth()]}`; };

  /* ---------- línea (histórico) ---------- */
  function line(box, { series, band, height = 230, yFmt = (v) => v, xFmt = fmtDay }) {
    responsive(box, (W) => {
      const H = height, L = 48, R = 12, T = 12, B = 26;
      const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])).concat(band ? band.map((b) => b[0]) : []))].sort();
      const ys = series.flatMap((s) => s.points.map((p) => p[1])).concat(band ? band.flatMap((b) => [b[1], b[2]]) : []).filter((v) => v != null);
      const svg = svgFor(box, W, H);
      if (!xs.length) { el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 13 }, svg).textContent = 'Se irá llenando con cada actualización diaria'; return; }
      const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
      const ticks = niceTicks(lo - pad, hi + pad);
      const y0 = ticks[0], y1 = ticks[ticks.length - 1];
      const X = (x) => L + (xs.length === 1 ? (W - L - R) / 2 : (xs.indexOf(x) / (xs.length - 1)) * (W - L - R));
      const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
      ticks.forEach((t) => {
        el('line', { x1: L, x2: W - R, y1: Y(t), y2: Y(t), stroke: 'var(--line)' }, svg);
        el('text', { x: L - 8, y: Y(t) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 }, svg).textContent = yFmt(t);
      });
      const every = Math.max(1, Math.ceil(xs.length / Math.floor((W - L) / 70)));
      xs.forEach((x, i) => { if (i % every === 0 || i === xs.length - 1) el('text', { x: X(x), y: H - 6, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, svg).textContent = xFmt(x); });
      if (band && band.length > 1) {
        const top = band.map((b) => `${X(b[0])},${Y(b[2])}`), bot = band.slice().reverse().map((b) => `${X(b[0])},${Y(b[1])}`);
        el('polygon', { points: top.concat(bot).join(' '), fill: 'rgba(124,92,255,.14)' }, svg);
      }
      const defs = el('defs', {}, svg);
      series.forEach((s, si) => {
        const pts = s.points.filter((p) => p[1] != null);
        if (!pts.length) return;
        if (s.area) {
          const g = el('linearGradient', { id: `g${si}`, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
          el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': '.35' }, g);
          el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': '0' }, g);
          el('path', { d: `M${X(pts[0][0])},${Y(y0)} ` + pts.map((p) => `L${X(p[0])},${Y(p[1])}`).join(' ') + ` L${X(pts[pts.length - 1][0])},${Y(y0)} Z`, fill: `url(#g${si})` }, svg);
        }
        el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || '' }, svg);
        if (pts.length < 40) pts.forEach((p) => el('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3, fill: s.color }, svg));
      });
      const cross = el('line', { y1: T, y2: H - B, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', opacity: 0 }, svg);
      const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (e) => {
        const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
        const i = Math.max(0, Math.min(xs.length - 1, Math.round(((px - L) / (W - L - R)) * (xs.length - 1))));
        const x = xs[i]; cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('opacity', 1);
        const rows = series.map((s) => { const p = s.points.find((q) => q[0] === x); return p && p[1] != null ? `<div><span style="color:${s.color}">●</span> ${s.name}: <b>${yFmt(p[1])}</b></div>` : ''; }).join('');
        showTip(`<b>${xFmt(x)}</b>${rows}`, e);
      });
      hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('opacity', 0); });
    });
  }

  /* ---------- columnas (por mes, noches, día de la semana) ---------- */
  function columns(box, items, { height = 210, fmt = (v) => v, colorBy = 'value' } = {}) {
    responsive(box, (W) => {
      const H = height, T = 22, B = 26, L = 6, R = 6;
      const svg = svgFor(box, W, H);
      const vals = items.map((i) => i.value).filter((v) => v != null);
      if (!vals.length) return;
      const mx = Math.max(...vals), mn = Math.min(...vals), sc = scale(vals);
      const bw = (W - L - R) / items.length, gap = Math.min(10, bw * 0.25);
      items.forEach((it, i) => {
        const x = L + i * bw + gap / 2, w = bw - gap;
        if (it.value == null) { el('text', { x: x + w / 2, y: H - B - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 10 }, svg).textContent = '—'; }
        else {
          const h = Math.max(4, ((it.value - mn * 0.6) / (mx - mn * 0.6 || 1)) * (H - T - B));
          const r = el('rect', { x, y: H - B - h, width: w, height: h, rx: Math.min(7, w / 3), fill: it.color || (colorBy === 'value' ? sc(it.value) : 'var(--brand)'), style: it.onClick ? 'cursor:pointer' : '' }, svg);
          if (it.value === mn) r.setAttribute('stroke', 'var(--ink)'), r.setAttribute('stroke-width', 1.5);
          if (w > 26) el('text', { x: x + w / 2, y: H - B - h - 6, 'text-anchor': 'middle', fill: 'var(--ink2)', 'font-size': 10.5, 'font-weight': 700 }, svg).textContent = fmt(it.value);
          r.addEventListener('mousemove', (e) => showTip(`<b>${it.title || it.label}</b><br>${fmt(it.value)}${it.sub ? `<br><span style="opacity:.75">${it.sub}</span>` : ''}`, e));
          r.addEventListener('mouseleave', hideTip);
          if (it.onClick) r.addEventListener('click', it.onClick);
        }
        el('text', { x: x + w / 2, y: H - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, svg).textContent = it.label;
      });
    });
  }

  /* ---------- barras horizontales (destinos) ---------- */
  function hbars(box, items, { fmt = (v) => v } = {}) {
    const vals = items.map((i) => i.value), mx = Math.max(...vals, 1), sc = scale(vals);
    box.innerHTML = `<div style="display:grid;gap:9px">${items.map((it, i) => `
      <div class="hb" data-i="${i}" style="display:grid;grid-template-columns:minmax(90px,170px) 1fr auto;gap:10px;align-items:center;${it.onClick ? 'cursor:pointer' : ''}">
        <div style="display:flex;gap:8px;align-items:center;min-width:0;font-weight:650;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.label}</div>
        <div style="height:12px;border-radius:99px;background:var(--card-hi);overflow:hidden"><i style="display:block;height:100%;width:${Math.max(4, (it.value / mx) * 100)}%;background:${sc(it.value)};border-radius:99px"></i></div>
        <div class="price" style="min-width:64px;text-align:right">${fmt(it.value)}</div></div>`).join('')}</div>`;
    box.querySelectorAll('.hb').forEach((n) => { const it = items[+n.dataset.i]; if (it.onClick) n.addEventListener('click', it.onClick); });
  }

  /* ---------- calendario mapa de calor ---------- */
  function calendar(box, days, { onClick, fmt = (v) => v } = {}) {
    const keys = Object.keys(days).sort();
    if (!keys.length) { box.innerHTML = '<div class="empty">Sin precios para estas fechas.</div>'; return; }
    const sc = scale(keys.map((k) => days[k].p));
    const first = new Date(keys[0] + 'T00:00:00'), last = new Date(keys[keys.length - 1] + 'T00:00:00');
    let html = '';
    for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth()); m === 11 ? (y++, m = 0) : m++) {
      const lead = (new Date(y, m, 1).getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
      let cells = '<span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span>' + '<i></i>'.repeat(lead);
      for (let d = 1; d <= n; d++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, v = days[iso];
        cells += v ? `<div class="d has ${v.top ? 'star' : ''}" data-d="${iso}" style="background:${sc(v.p)}">${d}</div>` : `<div class="d none">${d}</div>`;
      }
      html += `<div class="m"><h4>${MONTHS[m]} ${y}</h4><div class="wk">${cells}</div></div>`;
    }
    box.innerHTML = `<div class="cal">${html}</div>`;
    box.querySelectorAll('.d.has').forEach((c) => {
      const v = days[c.dataset.d];
      c.addEventListener('mousemove', (e) => showTip(`<b>${fmtDay(c.dataset.d)}</b><br>desde <b>${fmt(v.p)}</b>${v.n ? `<br>${v.n} opciones` : ''}${v.top ? '<br>🔥 chollo' : ''}`, e));
      c.addEventListener('mouseleave', hideTip);
      if (onClick) c.addEventListener('click', () => { hideTip(); onClick(c.dataset.d); });
    });
  }

  /* ---------- histograma ---------- */
  function histogram(box, h, { markers = [], fmt = (v) => v, height = 190 } = {}) {
    responsive(box, (W) => {
      const H = height, T = 26, B = 24, L = 4, R = 4, n = h.counts.length, mx = Math.max(...h.counts, 1);
      const svg = svgFor(box, W, H), bw = (W - L - R) / n;
      const X = (v) => L + ((v - h.from) / (h.step * n)) * (W - L - R);
      h.counts.forEach((c, i) => {
        const hh = (c / mx) * (H - T - B), x = L + i * bw;
        const r = el('rect', { x: x + 1, y: H - B - hh, width: bw - 2, height: hh, rx: 4, fill: colorAt(i / (n - 1)) }, svg);
        r.addEventListener('mousemove', (e) => showTip(`${fmt(h.from + i * h.step)} – ${fmt(h.from + (i + 1) * h.step)}<br><b>${c}</b> opciones`, e));
        r.addEventListener('mouseleave', hideTip);
      });
      el('text', { x: L, y: H - 6, fill: 'var(--muted)', 'font-size': 11 }, svg).textContent = fmt(h.from);
      el('text', { x: W - R, y: H - 6, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 }, svg).textContent = fmt(h.from + h.step * n);
      markers.forEach((m, i) => {
        if (m.value == null) return;
        const x = Math.max(L, Math.min(W - R, X(m.value)));
        el('line', { x1: x, x2: x, y1: T - 4, y2: H - B, stroke: m.color, 'stroke-width': 2, 'stroke-dasharray': '4 3' }, svg);
        el('text', { x, y: 12 + (i % 2) * 0, 'text-anchor': x > W - 80 ? 'end' : x < 80 ? 'start' : 'middle', fill: m.color, 'font-size': 11, 'font-weight': 700 }, svg).textContent = `${m.label} ${fmt(m.value)}`;
      });
    });
  }

  /* ---------- pequeños ---------- */
  function ring(score, size = 54) {
    const r = size / 2 - 5, c = 2 * Math.PI * r, col = score >= 80 ? '#34d399' : score >= 60 ? '#a3e635' : score >= 40 ? '#fbbf24' : '#f87171';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="${size * 0.3}" font-weight="800" fill="var(--ink)">${score}</text></svg>`;
  }
  function spark(values, w = 120, h = 34, color = '#22d3ee') {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const mn = Math.min(...v), mx = Math.max(...v), X = (i) => (i / (v.length - 1)) * (w - 4) + 2, Y = (x) => h - 3 - ((x - mn) / (mx - mn || 1)) * (h - 6);
    const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d} L${X(v.length - 1)},${h} L2,${h} Z" fill="${color}" opacity=".15"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${X(v.length - 1)}" cy="${Y(v[v.length - 1])}" r="2.8" fill="${color}"/></svg>`;
  }
  /* tira de los próximos N días coloreada por precio */
  function strip(days, from, n = 120) {
    const sc = scale(Object.values(days).map((d) => d.p));
    const d0 = new Date(from + 'T00:00:00'); let out = '';
    for (let i = 0; i < n; i++) {
      const d = new Date(d0); d.setDate(d0.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out += `<i style="background:${days[iso] ? sc(days[iso].p) : 'var(--card-hi)'}" title="${iso}${days[iso] ? ` · ${Math.round(days[iso].p)}` : ''}"></i>`;
    }
    return `<div class="strip">${out}</div>`;
  }
  return { colorAt, scale, line, columns, hbars, calendar, histogram, ring, spark, strip, showTip, hideTip, MON, MONTHS };
})();
