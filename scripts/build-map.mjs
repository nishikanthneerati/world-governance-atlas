#!/usr/bin/env node
/**
 * Clickable India map data: state/UT outlines as simplified SVG paths + district headquarters as points.
 *  - State boundaries: DataMeet "States/Admin2" shapefile (official Survey of India outline, current 36 states/UTs),
 *    https://github.com/datameet/maps, CC BY 4.0 (DataMeet India community).
 *  - District HQ coordinates: Wikipedia (coordinates of each district's article in data/india/union.json).
 * Writes data/india/map.json. Run once (boundaries rarely change) or when districts change.
 */
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const SRC = 'https://raw.githubusercontent.com/datameet/maps/master/States/Admin2';
const UA = `WorldGovernanceAtlas/1.0 (open public-data project${process.env.CONTACT ? '; ' + process.env.CONTACT : ''})`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CODES = {
  'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', assam: 'AS', bihar: 'BR', chhattisgarh: 'CG', goa: 'GA', gujarat: 'GJ', haryana: 'HR',
  'himachal pradesh': 'HP', jharkhand: 'JH', karnataka: 'KA', kerala: 'KL', 'madhya pradesh': 'MP', maharashtra: 'MH', manipur: 'MN', meghalaya: 'ML',
  mizoram: 'MZ', nagaland: 'NL', odisha: 'OD', punjab: 'PB', rajasthan: 'RJ', sikkim: 'SK', 'tamil nadu': 'TN', telangana: 'TS', tripura: 'TR',
  'uttar pradesh': 'UP', uttarakhand: 'UK', 'west bengal': 'WB', 'andaman & nicobar': 'AN', chandigarh: 'CH',
  'dadra and nagar haveli and daman and diu': 'DN', delhi: 'DL', 'jammu & kashmir': 'JK', ladakh: 'LA', lakshadweep: 'LD', puducherry: 'PY',
};

// Projection: equirectangular around 23°N, scaled so India is 1000 units wide.
const LON0 = 68, LON1 = 97.5, LAT_TOP = 37.2, K = Math.cos((23 * Math.PI) / 180);
const S = 1000 / ((LON1 - LON0) * K);
export const project = (lon, lat) => [+((lon - LON0) * K * S).toFixed(1), +((LAT_TOP - lat) * S).toFixed(1)];

async function get(url, type = 'buffer') {
  for (let i = 0; i < 7; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { wait: +r.headers.get('retry-after') * 1000 || 0 });
      return type === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 6) throw e; await sleep(Math.max(e.wait || 0, 4000 * 2 ** i)); }
  }
}

function readDbf(b) {
  const n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const f = []; for (let o = 32; b[o] !== 0x0d; o += 32) f.push([b.toString('latin1', o, o + 11).replace(/\0.*/, ''), b[o + 16]]);
  return Array.from({ length: n }, (_, i) => { let o = hl + i * rl + 1; const r = {}; for (const [nm, len] of f) { r[nm] = b.toString('utf8', o, o + len).trim(); o += len; } return r; });
}
/** Polygon / PolygonZ / PolygonM records -> arrays of rings of [lon, lat]. */
function readShp(b) {
  const shapes = [];
  for (let o = 100; o + 8 <= b.length;) {
    const len = b.readInt32BE(o + 4) * 2, c = o + 8, type = b.readInt32LE(c);
    if ([5, 15, 25].includes(type)) {
      const np = b.readInt32LE(c + 36), nPts = b.readInt32LE(c + 40);
      const parts = Array.from({ length: np }, (_, i) => b.readInt32LE(c + 44 + 4 * i));
      const p0 = c + 44 + 4 * np;
      const rings = parts.map((s, i) => { const e = i + 1 < np ? parts[i + 1] : nPts; const ring = []; for (let k = s; k < e; k++) ring.push([b.readDoubleLE(p0 + 16 * k), b.readDoubleLE(p0 + 16 * k + 8)]); return ring; });
      shapes.push(rings);
    } else shapes.push([]);
    o = c + len;
  }
  return shapes;
}
// Douglas-Peucker on projected points.
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  // A closed ring starts and ends on the same point, so anchor on the point farthest from the start too.
  let far = 1, fd = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const stack = [[0, far], [far, pts.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop(); let best = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[z], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < z; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > best) { best = d; idx = i; } }
    if (best > tol) { keep[idx] = 1; stack.push([a, idx], [idx, z]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : pts; // tiny islands collapse to a line otherwise
}
const area = (r) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const pathOf = (rings) => rings.map((r) => 'M' + r.map(([x, y]) => `${x},${y}`).join('L') + 'Z').join('');

async function districtPoints() {
  const u = JSON.parse(await readFile(path.join(OUT, 'union.json'), 'utf8'));
  const all = Object.entries(u.districts || {}).flatMap(([st, ds]) => ds.map((d) => ({ st, name: d.name, title: d.wiki })).filter((d) => d.title));
  const coord = {};
  for (let i = 0; i < all.length; i += 50) {
    const titles = all.slice(i, i + 50).map((d) => d.title).join('|');
    const j = await get(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=coordinates&redirects=1&colimit=max&titles=${encodeURIComponent(titles)}`, 'json');
    const redir = Object.fromEntries([...(j.query.normalized || []), ...(j.query.redirects || [])].map((r) => [r.from, r.to]));
    const byTitle = Object.fromEntries(Object.values(j.query.pages).filter((p) => p.coordinates).map((p) => [p.title, p.coordinates[0]]));
    for (const d of all.slice(i, i + 50)) { let t = d.title; for (let k = 0; k < 3 && redir[t]; k++) t = redir[t]; if (byTitle[t]) coord[`${d.st}|${d.name}`] = byTitle[t]; }
    await sleep(2000);
  }
  const out = {};
  for (const d of all) { const c = coord[`${d.st}|${d.name}`]; if (c) (out[d.st] ??= []).push({ name: d.name, xy: project(c.lon, c.lat) }); }
  log(`  district points: ${Object.values(out).flat().length} of ${all.length}`);
  return out;
}

async function main() {
  log('DataMeet state boundaries');
  const [shp, dbf] = await Promise.all([get(`${SRC}.shp`), get(`${SRC}.dbf`)]);
  const recs = readDbf(dbf), shapes = readShp(shp);
  const states = {};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  recs.forEach((r, i) => {
    const code = CODES[String(r.ST_NM || '').toLowerCase()];
    if (!code) { log(`  unknown state ${r.ST_NM}`); return; }
    const tol = ['LD', 'CH', 'PY', 'DN', 'GA', 'DL'].includes(code) ? 0.15 : 0.7; // small UTs need more detail
    let rings = shapes[i].map((ring) => simplify(ring.map(([lon, lat]) => project(lon, lat)), tol)).filter((r) => r.length >= 3);
    const big = Math.max(...rings.map(area));
    // Drop specks (always keeping the largest piece), but keep the islands of the island territories.
    rings = rings.filter((r) => area(r) === big || (code === 'LD' ? area(r) > 0.005 : code === 'AN' ? area(r) > 0.4 : area(r) > Math.max(1.5, big * 0.0005)));
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const main = rings.reduce((a, b) => (area(b) > area(a) ? b : a), rings[0]);
    const cx = main.reduce((s, p) => s + p[0], 0) / main.length, cy = main.reduce((s, p) => s + p[1], 0) / main.length;
    const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
    states[code] = { name: r.ST_NM, d: pathOf(rings), c: [+cx.toFixed(1), +cy.toFixed(1)], box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(1)) };
  });
  log(`  ${Object.keys(states).length} states/UTs`);
  log('Wikipedia: district headquarters coordinates');
  const districts = await districtPoints();
  await writeFile(path.join(OUT, 'map.json'), JSON.stringify({
    generated: new Date().toISOString(),
    viewBox: [Math.floor(minX) - 5, Math.floor(minY) - 5, Math.ceil(maxX - minX) + 10, Math.ceil(maxY - minY) + 10],
    attribution: { boundaries: 'DataMeet India community, States (Admin2), CC BY 4.0', boundariesUrl: 'https://github.com/datameet/maps', points: 'Wikipedia district coordinates' },
    states, districts,
  }));
  log('Wrote data/india/map.json');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
