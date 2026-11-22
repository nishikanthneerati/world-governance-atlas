#!/usr/bin/env node
/**
 * India states & UTs: leaders, legislatures, MLAs.
 *  - Chief Ministers, Deputy CMs: Wikipedia "Chief minister (India)" tables
 *  - Governors / LGs: Wikipedia "Governor (India)" + "Lieutenant governor (India)" tables
 *  - Assembly size, ruling party, term: Wikipedia "State legislative assemblies of India"
 *  - MLAs with affidavit data: MyNeta / ADR, latest assembly election per state (auto-discovered)
 * Writes data/india/states.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const WP_UA = `WorldGovernanceAtlas/1.0 (open public-data project${process.env.CONTACT ? '; ' + process.env.CONTACT : ''})`;
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const YEAR = new Date().getFullYear();

// Canonical list. type: S = state, U = union territory with legislature, X = UT without legislature.
// mlc = seats in the Legislative Council (bicameral states only).
export const STATES = [
  ['AP', 'Andhra Pradesh', 'S', 'AndhraPradesh', 58], ['AR', 'Arunachal Pradesh', 'S', 'ArunachalPradesh'], ['AS', 'Assam', 'S', 'Assam'],
  ['BR', 'Bihar', 'S', 'Bihar', 75], ['CG', 'Chhattisgarh', 'S', 'Chhattisgarh'], ['GA', 'Goa', 'S', 'Goa'], ['GJ', 'Gujarat', 'S', 'Gujarat'],
  ['HR', 'Haryana', 'S', 'Haryana'], ['HP', 'Himachal Pradesh', 'S', 'HimachalPradesh'], ['JH', 'Jharkhand', 'S', 'Jharkhand'],
  ['KA', 'Karnataka', 'S', 'Karnataka', 75], ['KL', 'Kerala', 'S', 'Kerala'], ['MP', 'Madhya Pradesh', 'S', 'MadhyaPradesh'],
  ['MH', 'Maharashtra', 'S', 'Maharashtra', 78], ['MN', 'Manipur', 'S', 'Manipur'], ['ML', 'Meghalaya', 'S', 'Meghalaya'],
  ['MZ', 'Mizoram', 'S', 'Mizoram'], ['NL', 'Nagaland', 'S', 'Nagaland'], ['OD', 'Odisha', 'S', 'Odisha'], ['PB', 'Punjab', 'S', 'Punjab'],
  ['RJ', 'Rajasthan', 'S', 'Rajasthan'], ['SK', 'Sikkim', 'S', 'Sikkim'], ['TN', 'Tamil Nadu', 'S', 'TamilNadu'], ['TS', 'Telangana', 'S', 'Telangana', 40],
  ['TR', 'Tripura', 'S', 'Tripura'], ['UP', 'Uttar Pradesh', 'S', 'UttarPradesh', 100], ['UK', 'Uttarakhand', 'S', 'Uttarakhand'],
  ['WB', 'West Bengal', 'S', 'WestBengal'],
  ['DL', 'Delhi', 'U', 'Delhi'], ['JK', 'Jammu and Kashmir', 'U', 'JammuKashmir'], ['PY', 'Puducherry', 'U', 'Puducherry'],
  ['AN', 'Andaman and Nicobar Islands', 'X'], ['CH', 'Chandigarh', 'X'], ['DN', 'Dadra and Nagar Haveli and Daman and Diu', 'X'],
  ['LA', 'Ladakh', 'X'], ['LD', 'Lakshadweep', 'X'],
].map(([code, name, type, myneta, mlc]) => ({ code, name, type, myneta: myneta || null, mlc: mlc || null }));

export async function get(url, { type = 'text', ua = UA, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { const ra = +r.headers.get('retry-after'); throw Object.assign(new Error(`HTTP ${r.status}`), { wait: ra ? ra * 1000 + 500 : null }); }
      if (!r.ok) return null;
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) {
      if (i === tries - 1) { log(`  give up ${url.slice(0, 90)}: ${e.message}`); return null; }
      await sleep(e.wait || 2500 * 2 ** i);
    }
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
export const text = (h) => decode(h.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const rupees = (s) => { const m = String(s).match(/Rs\s*([\d,]+)/); return m ? +m[1].replace(/,/g, '') : null; };

/** Parse one wikitable's HTML into rows of {text, link, img}, expanding rowspan/colspan. */
export function parseTable(t) {
  const rows = [];
  const carry = [];
  for (const tr of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const raw = [...tr.matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/\1>/g)];
    const out = [];
    let ci = 0;
    const pushCarry = () => { while (carry[ci] && carry[ci].left > 0) { out.push(carry[ci].cell); carry[ci].left--; ci++; } };
    for (const [, , attrs, inner] of raw) {
      pushCarry();
      const lk = inner.match(/<a href="\/wiki\/(?!File:)([^"#]+)"/);
      const cell = { text: text(inner), link: lk ? decodeURIComponent(lk[1]).replace(/_/g, ' ') : null, img: (inner.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null };
      const span = +(attrs.match(/rowspan="?(\d+)/) || [])[1] || 1;
      const cs = +(attrs.match(/colspan="?(\d+)/) || [])[1] || 1;
      for (let k = 0; k < cs; k++) { out.push(cell); if (span > 1) carry[ci] = { cell, left: span - 1 }; ci++; }
    }
    pushCarry();
    rows.push(out);
  }
  return rows;
}
export async function wikiHtml(page) {
  const j = await get(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=text&redirects=1&page=${encodeURIComponent(page)}`, { type: 'json', ua: WP_UA });
  if (!j || j.error) { log(`  Wikipedia page missing: ${page}`); return ''; }
  return j.parse.text['*'];
}
export async function wikiTables(page) {
  return ((await wikiHtml(page)).match(/<table class="wikitable[\s\S]*?<\/table>/g) || []).map(parseTable);
}
export const fullImg = (src) => (src ? (src.startsWith('//') ? 'https:' + src : src).replace(/\/(\d+)px-/, '/250px-') : null);

export function tableByHeader(tables, ...want) {
  return tables.find((t) => t[0] && want.every((w) => t[0].some((c) => c.text.toLowerCase().includes(w))));
}
export function rowsAsObjects(t) {
  const head = t[0].map((c) => c.text.toLowerCase());
  return t.slice(1).filter((r) => r.length >= head.length - 1).map((r) => {
    const o = {};
    head.forEach((h, i) => { if (r[i] && (!o[h] || (!o[h].text && r[i].text))) o[h] = r[i]; });
    return o;
  });
}
export const pick = (o, ...keys) => { for (const k of Object.keys(o)) if (keys.some((x) => k.includes(x))) return o[k]; return null; };
export const tookOffice = (s) => { const m = String(s || '').match(/(\d{1,2} \w+ \d{4})/); return m ? new Date(m[1] + ' UTC').toISOString().slice(0, 10) : null; };

async function myneta(slugBase) {
  for (let y = YEAR; y >= YEAR - 6; y--) {
    for (const slug of [`${slugBase}${y}`, `${slugBase.toLowerCase()}${y}`]) {
      const html = await get(`https://www.myneta.info/${slug}/index.php?action=show_winners&sort=default`);
      await sleep(400);
      if (!html) continue;
      const rows = [];
      for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
        const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g);
        if (!tds || tds.length < 8) continue;
        const c = tds.map(text);
        if (!/^\d+$/.test(c[0])) continue;
        const id = tr.match(/candidate_id=(\d+)/)?.[1];
        rows.push({ name: c[1], constituency: c[2].replace(/\s*:\s*BYE ELECTION.*$/i, ''), party: c[3], criminalCases: +c[4] || 0, education: c[5], assets: rupees(c[6]), liabilities: rupees(c[7]), id: id ? +id : null });
      }
      if (rows.length) return { slug, year: y, mlas: rows };
    }
  }
  return null;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  log('Wikipedia: chief ministers, deputy CMs, governors, assemblies');
  const cmTables = await wikiTables('Chief minister (India)');
  await sleep(1500);
  const govTables = await wikiTables('List of current Indian lieutenant governors and administrators');
  await sleep(1500);
  const ltTables = [];
  await sleep(1500);
  const asmTables = await wikiTables('State legislative assemblies of India');

  const cms = rowsAsObjects(tableByHeader(cmTables, 'officeholder', 'ministry') || [[]]);
  const dcms = rowsAsObjects(tableByHeader(cmTables, 'officeholder', "chief minister's party") || [[]]);
  const govRows = [...govTables, ...ltTables].filter((t) => t[0]?.some((c) => /state|union territor/i.test(c.text)) && t[0]?.some((c) => /name|governor|incumbent|officeholder/i.test(c.text))).flatMap(rowsAsObjects);
  const asm = rowsAsObjects(tableByHeader(asmTables, 'legislative assembly', 'members') || [[]]);
  log(`  CMs ${cms.length}, deputy CMs ${dcms.length}, governor rows ${govRows.length}, assemblies ${asm.length}`);

  const find = (rows, st, ...keys) => rows.filter((r) => { const v = pick(r, ...keys); return v && (norm(v.text) === norm(st.name) || norm(v.text).includes(norm(st.name))); });
  const person = (cell, extra = {}) => (cell ? { name: cell.text, wiki: cell.link, img: fullImg(cell.img), ...extra } : null);

  const prev = existsSync(path.join(OUT, 'states.json')) ? JSON.parse(await readFile(path.join(OUT, 'states.json'), 'utf8')) : null;
  const out = [];
  for (const st of STATES) {
    const cmRow = find(cms, st, 'state')[0];
    const dRows = find(dcms, st, 'state');
    const gRow = find(govRows, st, 'state', 'union territor', 'ut')[0];
    const aRow = find(asm, st, 'legislative assembly')[0];
    let leg = null;
    if (st.myneta) {
      leg = await myneta(st.myneta);
      if (!leg) { const old = prev?.states.find((x) => x.code === st.code); if (old?.mlas?.length) leg = { slug: old.mynetaSlug, year: old.lastElection, mlas: old.mlas }; }
      log(`  ${st.name}: ${leg ? `${leg.mlas.length} MLAs (${leg.slug})` : 'no MyNeta data found'}`);
    }
    const imgOf = (row) => row && Object.values(row).find((c) => c.img && !/Flag|Emblem|Seal/i.test(c.img))?.img;
    out.push({
      code: st.code, name: st.name, type: st.type,
      cm: cmRow ? person(pick(cmRow, 'officeholder'), { party: pick(cmRow, 'political party', 'party')?.text, since: tookOffice(pick(cmRow, 'took office')?.text), img: fullImg(imgOf(cmRow)) }) : null,
      deputyCms: dRows.map((r) => person(pick(r, 'officeholder'), { party: pick(r, 'party')?.text, since: tookOffice(pick(r, 'took office')?.text) })).filter(Boolean),
      governor: gRow ? person(pick(gRow, 'name', 'incumbent', 'officeholder', 'governor'), { since: tookOffice(pick(gRow, 'took office', 'assumed')?.text), title: st.type === 'S' ? 'Governor' : ['CH', 'DN', 'LD'].includes(st.code) ? 'Administrator' : 'Lieutenant Governor' }) : null,
      assembly: aRow ? { seats: +(pick(aRow, 'no. of members', 'members')?.text || '').replace(/\D/g, '') || null, rulingParty: pick(aRow, 'ruling')?.text || null, term: pick(aRow, 'current term', 'term')?.text || null } : null,
      council: st.mlc ? { seats: st.mlc } : null,
      lastElection: leg?.year || null,
      nextElectionDue: leg?.year ? leg.year + 5 : null,
      mynetaSlug: leg?.slug || null,
      mlas: leg?.mlas || [],
    });
  }
  await writeFile(path.join(OUT, 'states.json'), JSON.stringify({ generated: new Date().toISOString(), states: out }));
  log(`Wrote data/india/states.json (${out.reduce((s, x) => s + x.mlas.length, 0)} MLAs)`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
