#!/usr/bin/env node
/**
 * Police organisation of every state/UT from BPR&D's "Data on Police Organisations" (DoPO), the official
 * annual return of all police forces (Bureau of Police Research & Development, MHA).
 *  - Police units: zones, ranges, police districts, sub-divisions, circles, police stations, outposts
 *  - Police stations and outposts: rural / urban / special purpose (railway for outposts), sanctioned vs actual
 *  - Commissionerate cities
 *  - Civil police strength in every rank, DGP down to Constable: sanctioned, actual, vacant
 *  - Women in civil police by rank; police per lakh population and per 100 sq km
 * Writes data/india/police.json. Needs `pdftotext` (poppler-utils) on PATH.
 *   DOPO_PDF=/path/to/file.pdf node scripts/fetch-police.mjs   use a downloaded copy
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const PAGE = 'https://bprd.mha.gov.in/page/data_on_police_organization_dopo';
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// DoPO row order and spelling -> site state codes.
const ROWS = [
  ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'], ['CG', 'Chhattisgarh'], ['GA', 'Goa'], ['GJ', 'Gujarat'],
  ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'], ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'],
  ['MN', 'Manipur'], ['ML', 'Meghalaya'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OD', 'Odisha'], ['PB', 'Punjab'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'], ['TS', 'Telangana'], ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal'],
  ['AN', 'A & N Islands'], ['CH', 'Chandigarh'], ['DN', 'Dadra and Nagar Haveli and Daman and Diu'], ['DL', 'Delhi'], ['JK', 'Jammu and Kashmir'],
  ['LA', 'Ladakh'], ['LD', 'Lakshadweep'], ['PY', 'Puducherry'],
];
export const RANKS = [
  ['DGP', 'DGP / Spl. DGP'], ['ADGP', 'Addl. DGP'], ['IGP', 'IGP'], ['DIG', 'DIG'], ['SP', 'SSP / SP / AIGP / Commandant'], ['ASP', 'Addl. SP / Dy. Commandant'],
  ['DSP', 'ASP / Dy. SP / Asst. Commandant'], ['INSP', 'Inspector'], ['SI', 'Sub-Inspector'], ['ASI', 'Asst. Sub-Inspector'], ['HC', 'Head Constable'],
  ['CONST', 'Constable'], ['OTHER', 'Others'], ['TOTAL', 'Total'],
];

async function pdfPath() {
  if (process.env.DOPO_PDF) return { file: process.env.DOPO_PDF, url: null };
  const html = await (await fetch(PAGE, { headers: { 'User-Agent': UA } })).text();
  const href = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1].replace(/&#x3A;/g, ':').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&'))
    .find((h) => /police organi[sz]ation/i.test(decodeURIComponent(h)));
  if (!href) throw new Error('DoPO PDF link not found on ' + PAGE);
  const url = new URL(href.replace(/ /g, '%20'), PAGE).href;
  const file = path.join(os.tmpdir(), 'dopo-' + path.basename(decodeURIComponent(url)).replace(/[^\w.()-]+/g, '_'));
  if (!existsSync(file)) {
    log(`Downloading ${url}`);
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`DoPO download HTTP ${r.status}`);
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
  }
  return { file, url };
}

const pages = (file) => execFileSync('pdftotext', ['-raw', file, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split('\f');
/** All pages of one table: its first page plus any "(CONTINUED...)" pages right after. */
function tablePages(P, id) {
  const head = `TABLE ${id} --`;
  const i = P.findIndex((p) => p.includes(head) && !/\.{5,}/.test(p) && !p.includes('List of Tables'));
  if (i < 0) return [];
  const out = [P[i]];
  for (let j = i + 1; j < P.length && P[j].includes(`TABLE ${id} -- (CONTINUED`); j++) out.push(P[j]);
  return out;
}
const num = (t) => (t === '-' ? 0 : /^-?[\d,]+(\.\d+)?$/.test(t) ? +t.replace(/,/g, '') : null); // NA / NP -> null
/** Numbers in one state's row on a page (handles names wrapped over two lines and "Bihar *"). */
function rowValues(page, idx) {
  const lines = page.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${idx + 1}\\s+[A-Z]`).test(l));
  if (start < 0) return null;
  let text = lines[start];
  for (let k = start + 1; k < lines.length && !new RegExp(`^(${idx + 2}\\s+[A-Z]|TOTAL\\b|All India|S: Sanctioned|\\(NA\\))`).test(lines[k]); k++) text += ' ' + lines[k];
  const name = ROWS[idx][1].split(' ');
  const toks = text.replace(/\*/g, ' ').trim().split(/\s+/).slice(1);
  // Drop the state name words, then keep numeric-ish tokens.
  let t = 0; while (t < toks.length && name.includes(toks[t])) t++;
  return toks.slice(t).filter((x) => /^(-|NA|NP|-?[\d,]+(\.\d+)?)$/.test(x)).map(num);
}
// The national row is "TOTAL …" or "All India …" (not the "TOTAL POLICE STATIONS" column header).
const NUMTOK = '(?:-|NA|NP|-?[\\d,]+(?:\\.\\d+)?)';
const totalRow = (page) => { const m = page.match(new RegExp(`\\n(?:TOTAL|All India)\\s+((?:${NUMTOK}\\s+)*${NUMTOK})\\s*\\n`)); return m ? m[1].trim().split(/\s+/).map(num) : null; };

function parseTable(P, id, width) {
  const pg = tablePages(P, id);
  if (!pg.length) { log(`  table ${id} not found`); return null; }
  const states = {}, total = [];
  for (const page of pg) {
    ROWS.forEach(([code], i) => { const v = rowValues(page, i); if (v) (states[code] ??= []).push(...v.slice(0, width ? width(page) : undefined)); });
    const t = totalRow(page); if (t) total.push(...t);
  }
  return { states, total, pages: pg.length };
}

export function parseDopo(P) {
  const asOn = ((tablePages(P, '5.1.1')[0] || P.join('')).match(/AS ON (\d{2})\.(\d{2})\.(\d{4})/) || []).slice(1).reverse().join('-') || null;
  const units = parseTable(P, '5.1.1');
  const ps = parseTable(P, '5.1.2');
  const op = parseTable(P, '5.1.3');
  const ranks = parseTable(P, '3.1.2');
  const women = parseTable(P, '3.1.9');
  const ratio = parseTable(P, '2.1.3');
  const comm = tablePages(P, '5.1.5');
  const cities = parseCommissionerates(comm[0] || '');
  const out = {};
  const sa = (v, i) => ({ s: v?.[i] ?? null, a: v?.[i + 1] ?? null });
  const build = (code, pick) => {
    const u = pick(units), p = pick(ps), o = pick(op), r = pick(ranks), w = pick(women), q = pick(ratio);
    return {
      units: u && { zones: u[0], ranges: u[1], districts: u[2], subDivisions: u[3], circles: u[4], policeStations: u[5] },
      policeStations: p && { rural: sa(p, 0), urban: sa(p, 2), special: sa(p, 4), total: sa(p, 6) },
      outposts: o && { rural: sa(o, 0), urban: sa(o, 2), railway: sa(o, 4), other: sa(o, 6), total: sa(o, 8) },
      ranks: r && RANKS.map(([k], i) => ({ rank: k, s: r[i * 3] ?? null, a: r[i * 3 + 1] ?? null, v: r[i * 3 + 2] ?? null })),
      womenCivil: w && Object.fromEntries(RANKS.filter(([k]) => k !== 'OTHER').map(([k], i) => [k, w[i] ?? null])),
      perLakh: q && { civilS: q[0], civilA: q[1], totalS: q[8], totalA: q[9] },
      commissionerates: code ? cities[code] || [] : undefined,
    };
  };
  for (const [code] of ROWS) out[code] = build(code, (t) => t?.states[code]);
  const national = build(null, (t) => t?.total);
  return { asOn, national, states: out, checks: { unitsTotal: units?.total, cities: Object.values(cities).flat().length } };
}

// Commissionerate city names wrap across lines; rebuild them from the row text using each state's count.
const JOIN_NEXT = /^(Nagar|City|Railway|Chinchwad|Sambhajinagar|\(Aurangabad\)|Durgapur|Bhayandar-?|Vasai-Virar|Cuttack|Dharwad)$/;
function parseCommissionerates(page) {
  const out = {};
  const lines = page.split('\n');
  ROWS.forEach(([code, name], i) => {
    const s = lines.findIndex((l) => new RegExp(`^${i + 1}\\s+${name.split(' ')[0].replace(/[&]/g, '\\&')}`).test(l));
    if (s < 0) return;
    let text = lines[s];
    for (let k = s + 1; k < lines.length && !new RegExp(`^(${i + 2}\\s+\\S|TOTAL\\b|\\(NA\\))`).test(lines[k]); k++) text += '\n' + lines[k];
    text = text.replace(new RegExp(`^${i + 1}\\s+`), '');
    for (const w of name.split(' ')) text = text.replace(new RegExp(`^\\s*${w.replace(/[&]/g, '\\&')}\\b`), '');
    const m = text.trim().match(/^(\d+|-)\s*([\s\S]*)$/);
    const n = m && m[1] !== '-' ? +m[1] : 0;
    if (!n) { out[code] = []; return; }
    const toks = m[2].split(/\s+/).filter((x) => x && x !== '-');
    const names = [];
    for (const t of toks) {
      const prev = names[names.length - 1];
      if (prev && (JOIN_NEXT.test(t) || (/^(Navi|Chhatrapati|Kanpur|Gautam|Gutambudh)$/.test(prev.split(' ').pop()) && !/\)$/.test(prev)) || /-$/.test(prev) || /^\(/.test(t) || /^[a-z]/.test(t))) names[names.length - 1] = `${prev}${/-$/.test(prev) ? '' : ' '}${t}`;
      else names.push(t);
    }
    // Still too many words: glue the shortest adjacent pair until the count matches.
    while (names.length > n) { let b = 0; for (let j = 1; j < names.length - 1; j++) if (names[j].length + names[j + 1].length < names[b].length + names[b + 1].length) b = j; names.splice(b, 2, `${names[b]} ${names[b + 1]}`); }
    out[code] = names.map((x) => x.replace(/^N\.T\.R\. City/, 'NTR City').replace(/Gutambudh/, 'Gautam Buddh'));
  });
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { file, url } = await pdfPath();
  log(`Parsing ${file}`);
  const d = parseDopo(pages(file));
  const bad = Object.entries(d.states).filter(([, s]) => !s.units || !s.ranks || s.ranks.some((r) => r.s == null && r.rank !== 'OTHER')).map(([c]) => c);
  if (bad.length) log(`  incomplete rows: ${bad.join(', ')}`);
  const sumPS = Object.values(d.states).reduce((a, s) => a + (s.units?.policeStations || 0), 0);
  log(`  as on ${d.asOn}: ${sumPS} sanctioned police stations (table total ${d.national.units?.policeStations}), ${d.checks.cities} commissionerate cities`);
  await writeFile(path.join(OUT, 'police.json'), JSON.stringify({
    generated: new Date().toISOString(), asOn: d.asOn,
    source: url || PAGE, sourceName: 'Data on Police Organisations, Bureau of Police Research & Development (MHA)',
    rankNames: Object.fromEntries(RANKS),
    national: d.national, states: d.states,
  }));
  log('Wrote data/india/police.json');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
