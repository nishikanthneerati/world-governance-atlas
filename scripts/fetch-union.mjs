#!/usr/bin/env node
/**
 * Union Council of Ministers, Rajya Sabha members, state police chiefs (DGPs), districts and MLCs.
 * Source: Wikipedia's current-office lists (each table cites official notifications).
 * Writes data/india/union.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wikiHtml, parseTable, rowsAsObjects, pick, tookOffice, text, norm, log, sleep, STATES } from './fetch-states.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const clean = (s) => String(s || '').replace(/\s*,?\s*\bIPS\b\.?/g, '').replace(/\s*\(politician\)|\s*\(Indian politician\)/g, '').replace(/\s+/g, ' ').trim();
const headOf = (t) => (t[0] || []).map((c) => c.text.toLowerCase()).join(' | ');

/** Walk a page in order, yielding {heading, table} so each table knows which section (state) it sits under. */
async function sections(page) {
  const html = await wikiHtml(page);
  const out = [];
  let heading = '';
  for (const m of html.matchAll(/<h[234][^>]*>([\s\S]*?)<\/h[234]>|(<table class="wikitable[\s\S]*?<\/table>)/g)) {
    if (m[1] != null) heading = text(m[1]).replace(/\[edit\]/g, '').trim();
    else out.push({ heading, table: parseTable(m[2]) });
  }
  return out;
}
const stateFor = (s) => STATES.find((x) => norm(s).includes(norm(x.name)) || (x.code === 'DL' && /delhi/i.test(s)) || (x.code === 'JK' && /jammu/i.test(s)))?.code || null;

async function ministers() {
  for (const page of ['Union Council of Ministers', 'Third Modi ministry']) {
    const secs = await sections(page);
    const tabs = secs.filter((s) => /portfolio/.test(headOf(s.table)) && /minister/.test(headOf(s.table)));
    if (tabs.length < 2) { await sleep(1500); continue; }
    const ranks = ['Cabinet Minister', 'Minister of State (Independent Charge)', 'Minister of State'];
    const people = new Map();
    tabs.slice(0, 3).forEach((s, i) => {
      for (const r of rowsAsObjects(s.table)) {
        const left = pick(r, 'left office')?.text || '';
        const who = pick(r, 'minister');
        if (!who?.text || !/incumbent/i.test(left)) continue;
        const key = who.text;
        if (!people.has(key)) people.set(key, { name: clean(who.text), wiki: who.link, rank: ranks[i], party: pick(r, 'party')?.text || '', since: tookOffice(pick(r, 'took office')?.text), portfolios: [] });
        const p = people.get(key);
        const port = pick(r, 'portfolio')?.text;
        if (port && !p.portfolios.includes(port)) p.portfolios.push(port);
      }
    });
    log(`  ministers: ${people.size} from "${page}"`);
    return { source: page, list: [...people.values()] };
  }
  return { source: null, list: [] };
}

async function rajyaSabha() {
  const secs = await sections('List of current members of the Rajya Sabha');
  const list = [];
  for (const s of secs) {
    const h = headOf(s.table);
    if (!/name/.test(h) || !/term/.test(h)) continue;
    const code = stateFor(s.heading);
    for (const r of rowsAsObjects(s.table)) {
      const n = pick(r, 'name');
      if (!n?.text || /^\d+$/.test(n.text)) continue;
      list.push({ name: clean(n.text), wiki: n.link, party: pick(r, 'party')?.text || '', state: code, stateLabel: s.heading, termStart: pick(r, 'term start')?.text || null, termEnd: pick(r, 'term end')?.text || null });
    }
  }
  log(`  Rajya Sabha: ${list.length} members`);
  return list;
}

async function dgps() {
  const secs = await sections('Director general of police');
  const list = [];
  for (const s of secs) {
    const h = headOf(s.table);
    if (!/police chief/.test(h)) continue;
    for (const r of rowsAsObjects(s.table)) {
      const where = pick(r, 'state', 'union territory');
      const who = pick(r, 'name of');
      if (!where?.text || !who?.text) continue;
      list.push({ state: stateFor(where.text), place: where.text, name: clean(who.text), wiki: who.link, batch: pick(r, 'batch')?.text || null, rank: pick(r, 'rank')?.text || 'DGP', hq: pick(r, 'headquarters')?.text || null });
    }
  }
  log(`  police chiefs: ${list.length}`);
  return list;
}

async function districts() {
  const secs = await sections('List of districts in India');
  const by = {};
  for (const s of secs) {
    const h = headOf(s.table);
    if (!/district/.test(h) || !/headquarters/.test(h)) continue;
    const code = stateFor(s.heading);
    if (!code) continue;
    for (const r of rowsAsObjects(s.table)) {
      const d = pick(r, 'district');
      if (!d?.text || d.text.length > 60) continue;
      (by[code] ??= []).push({ name: d.text, hq: pick(r, 'headquarters')?.text || null, wiki: d.link });
    }
  }
  log(`  districts: ${Object.values(by).reduce((a, x) => a + x.length, 0)} in ${Object.keys(by).length} states/UTs`);
  return by;
}

async function councils() {
  const by = {};
  for (const st of STATES.filter((x) => x.mlc)) {
    const secs = await sections(`${st.name} Legislative Council`);
    const seen = new Set();
    by[st.code] = [];
    for (const s of secs) {
      const h = headOf(s.table);
      if (!/(name|member)/.test(h) || !/party/.test(h) || s.table.length < 3) continue;
      if (/former|past|previous|history|chair|leader|officials|presiding|composition|by party|elections?\b/i.test(s.heading)) continue;
      for (const r of rowsAsObjects(s.table)) {
        const n = pick(r, 'name', 'member');
        if (!n?.text || /^\d+$/.test(n.text) || /vacant/i.test(n.text) || seen.has(n.text)) continue;
        seen.add(n.text);
        by[st.code].push({ name: clean(n.text), wiki: n.link, party: pick(r, 'party')?.text || '', seat: pick(r, 'constituency', 'elected by', 'category', 'type')?.text || s.heading, termEnd: pick(r, 'term end', 'retire', 'till')?.text || null });
      }
    }
    log(`  ${st.name} Legislative Council: ${by[st.code].length} members`);
    await sleep(1500);
  }
  return by;
}

async function vicePresident() {
  const html = await wikiHtml('Vice President of India');
  const ib = html.match(/<table class="infobox[\s\S]*?<\/table>/)?.[0] || '';
  const m = text(ib).match(/Incumbent\s+(.+?)\s+since\s+(\d{1,2} \w+ \d{4})/);
  return m ? { name: m[1].trim(), since: tookOffice(m[2]), wiki: m[1].trim() } : null;
}

async function municipal() {
  const secs = await sections('List of municipal corporations in India');
  const list = [];
  for (const s of secs) {
    const h = headOf(s.table);
    if (!/corporation/.test(h) || !/ward/.test(h)) continue;
    const code = stateFor(s.heading);
    for (const r of rowsAsObjects(s.table)) {
      const n = pick(r, 'corporation');
      if (!n?.text) continue;
      list.push({ name: n.text, wiki: n.link, state: code, district: pick(r, 'district')?.text || null, wards: +(pick(r, 'ward')?.text || '').replace(/\D/g, '') || null, established: pick(r, 'established')?.text || null, lastElection: pick(r, 'last election')?.text || null, population: +(pick(r, 'population')?.text || '').replace(/\D/g, '') || null });
    }
  }
  log(`  municipal corporations: ${list.length}`);
  return list;
}

async function judges() {
  const secs = await sections('List of sitting judges of the Supreme Court of India');
  const t = secs.map((s) => s.table).find((t) => /name/.test(headOf(t)) && /retirement/.test(headOf(t)));
  const list = t ? rowsAsObjects(t).map((r) => { const n = pick(r, 'name', 'judge'); return n?.text && !/^\d+$/.test(n.text) ? { name: clean(n.text), wiki: n.link, since: tookOffice(pick(r, 'date of appointment')?.text), retires: tookOffice(pick(r, 'retirement')?.text), cjiFrom: tookOffice(pick(r, 'becomes cji')?.text), parentHC: pick(r, 'parent high court')?.text || null } : null; }).filter(Boolean) : [];
  log(`  Supreme Court judges: ${list.length}`);
  return list;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const prev = existsSync(path.join(OUT, 'union.json')) ? JSON.parse(await readFile(path.join(OUT, 'union.json'), 'utf8')) : {};
  const keep = (v, old) => (Array.isArray(v) ? (v.length ? v : old || v) : v && Object.keys(v).length ? v : old || v);
  log('Wikipedia: Union ministers, Rajya Sabha, police chiefs, districts, MLCs');
  const m = await ministers(); await sleep(1500);
  const rs = await rajyaSabha(); await sleep(1500);
  const dg = await dgps(); await sleep(1500);
  const ds = await districts(); await sleep(1500);
  const mlc = await councils(); await sleep(1500);
  const vp = await vicePresident(); await sleep(1500);
  const mc = await municipal(); await sleep(1500);
  const sc = await judges();
  const out = {
    generated: new Date().toISOString(),
    ministrySource: m.source || prev.ministrySource,
    ministers: keep(m.list, prev.ministers),
    rajyaSabha: keep(rs, prev.rajyaSabha),
    police: keep(dg, prev.police),
    districts: keep(ds, prev.districts),
    councils: keep(mlc, prev.councils),
    vicePresident: vp || prev.vicePresident || null,
    municipalCorporations: keep(mc, prev.municipalCorporations),
    supremeCourt: keep(sc, prev.supremeCourt),
  };
  await writeFile(path.join(OUT, 'union.json'), JSON.stringify(out));
  log('Wrote data/india/union.json');
}
main().catch((e) => { console.error(e); process.exit(1); });
