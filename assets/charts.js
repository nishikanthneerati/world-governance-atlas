// Small dependency-free SVG charts: line chart with crosshair tooltip, and sparklines.
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

/**
 * series: [{ name, color, points: [[year, value], ...] }]
 * opts: { height, format(v), zero (bool, include 0), yearFrom }
 */
export function lineChart(el, series, opts = {}) {
  const fmt = opts.format || ((v) => v.toLocaleString());
  series = series.map((s) => ({ ...s, points: (s.points || []).filter((p) => p[1] != null && (!opts.yearFrom || p[0] >= opts.yearFrom)) })).filter((s) => s.points.length);
  el.innerHTML = '';
  el.classList.add('chart');
  if (!series.length) {
    el.innerHTML = '<div class="empty" style="padding:30px 0">No data reported</div>';
    return;
  }
  const W = Math.max(260, el.clientWidth || 600);
  const H = opts.height || 220;
  const labels = series.length > 1 && series.length <= 4 && W > 480;
  const m = { t: 12, r: labels ? 96 : 14, b: 24, l: 48 };
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (opts.zero !== false && y0 > 0) y0 = 0;
  const ticks = niceTicks(y0, y1);
  y0 = ticks[0]; y1 = ticks[ticks.length - 1];
  const X = (v) => m.l + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label || series.map((s) => s.name).join(', '));
  let g = '';
  // grid + y axis
  for (const t of ticks) {
    g += `<line class="${t === 0 ? 'baseline' : 'gridline'}" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
    g += `<g class="axis"><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(opts.tick ? opts.tick(t) : fmt(t))}</text></g>`;
  }
  // x axis ticks
  const xt = niceTicks(x0, x1, Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 80)))).filter((t) => t >= x0 && t <= x1 && Number.isInteger(t));
  for (const t of xt) g += `<g class="axis"><text x="${X(t)}" y="${H - 6}" text-anchor="middle">${t}</text></g>`;
  // lines
  series.forEach((s) => {
    let d = '';
    let prev = null;
    for (const [x, y] of s.points) {
      d += `${prev != null && x - prev <= 1 ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`;
      prev = x;
    }
    if (series.length === 1) {
      const pts = s.points;
      const base = Y(Math.max(y0, Math.min(0, y1)));
      g += `<path class="area" fill="${s.color}" d="M${X(pts[0][0])},${base}${pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')}L${X(pts[pts.length - 1][0])},${base}Z"/>`;
    }
    g += `<path class="line" stroke="${s.color}" d="${d}"/>`;
    if (s.points.length === 1) g += `<circle class="dot" r="4" fill="${s.color}" cx="${X(s.points[0][0])}" cy="${Y(s.points[0][1])}"/>`;
  });
  // direct labels at line ends, nudged apart
  if (labels) {
    const ends = series.map((s) => ({ s, y: Y(s.points[s.points.length - 1][1]), x: X(s.points[s.points.length - 1][0]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) g += `<text class="dlabel" x="${W - m.r + 8}" y="${e.y + 4}">${esc(e.s.short || e.s.name)}</text>`;
  }
  g += `<g class="hover" style="display:none"><line class="cross" y1="${m.t}" y2="${H - m.b}"/>${series.map((s) => `<circle class="dot" r="4.5" fill="${s.color}"/>`).join('')}</g>`;
  g += `<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" style="cursor:crosshair"/>`;
  svg.innerHTML = g;
  el.appendChild(svg);

  // hover layer
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  el.appendChild(tip);
  const hover = svg.querySelector('.hover');
  const cross = hover.querySelector('line');
  const dots = hover.querySelectorAll('circle');
  const years = [...new Set(xs)].sort((a, b) => a - b);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const yr = years.reduce((best, y) => (Math.abs(X(y) - px) < Math.abs(X(best) - px) ? y : best), years[0]);
    hover.style.display = '';
    cross.setAttribute('x1', X(yr));
    cross.setAttribute('x2', X(yr));
    let rows = '';
    series.forEach((s, i) => {
      const p = s.points.find((q) => q[0] === yr);
      if (p) {
        dots[i].style.display = '';
        dots[i].setAttribute('cx', X(yr));
        dots[i].setAttribute('cy', Y(p[1]));
      } else dots[i].style.display = 'none';
      rows += `<div class="r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${p ? esc(fmt(p[1])) : '—'}</b></div>`;
    });
    tip.innerHTML = `<div class="h">${yr}</div>${rows}`;
    tip.hidden = false;
    const left = (X(yr) / W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${left + 14 + tw > r.width ? left - tw - 14 : left + 14}px`;
    tip.style.top = `8px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { hover.style.display = 'none'; tip.hidden = true; });
}

export function sparkline(points, color = 'var(--series-1)') {
  const pts = (points || []).slice(-25);
  if (pts.length < 2) return '';
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (v) => 2 + ((v - x0) / (x1 - x0 || 1)) * 80;
  const Y = (v) => 26 - ((v - y0) / (y1 - y0 || 1)) * 22;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 84 28" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(last[0])}" cy="${Y(last[1])}" r="2.5" fill="${color}"/></svg>`;
}
