#!/usr/bin/env node
/**
 * Local-government counts per state/UT from the Local Government Directory (LGD, Ministry of Panchayati Raj):
 * "Report on State wise Administrative Units & Panchayati Raj Institutions" (public, no CAPTCHA).
 * Districts, sub-districts, blocks, district / intermediate / village panchayats, traditional local bodies,
 * villages, urban local bodies and cantonment boards.
 * Writes data/india/lgd.json. LGD may refuse requests from outside India; run from an Indian connection.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const BASE = 'https://lgdirectory.gov.in/';
const REPORT = 'reportonStatewiseEntityDetails.do';
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LGD state names -> the site's state codes.
const CODES = {
  andamanandnicobarislands: 'AN', andhrapradesh: 'AP', arunachalpradesh: 'AR', assam: 'AS', bihar: 'BR', chandigarh: 'CH', chhattisgarh: 'CG',
  delhi: 'DL', goa: 'GA', gujarat: 'GJ', haryana: 'HR', himachalpradesh: 'HP', jammuandkashmir: 'JK', jharkhand: 'JH', karnataka: 'KA',
  kerala: 'KL', ladakh: 'LA', lakshadweep: 'LD', madhyapradesh: 'MP', maharashtra: 'MH', manipur: 'MN', meghalaya: 'ML', mizoram: 'MZ',
  nagaland: 'NL', odisha: 'OD', puducherry: 'PY', punjab: 'PB', rajasthan: 'RJ', sikkim: 'SK', tamilnadu: 'TN', telangana: 'TS', tripura: 'TR',
  thedadraandnagarhavelianddamananddiu: 'DN', dadraandnagarhavelianddamananddiu: 'DN', uttarpradesh: 'UP', uttarakhand: 'UK', westbengal: 'WB',
};
// Report columns, in order after S.No. and State name.
const COLS = ['districts', 'districtPanchayats', 'districtTraditionalBodies', 'subDistricts', 'blocks', 'intermediatePanchayats',
  'intermediateTraditionalBodies', 'villages', 'villagePanchayats', 'villageTraditionalBodies', 'traditionalLocalBodies', 'urbanLocalBodies', 'cantonmentBoards'];

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function fetchReport() {
  // The home page hands out a session cookie and the CSRF token that the report link needs.
  const home = await fetch(BASE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!home.ok) throw new Error(`LGD home HTTP ${home.status}`);
  const cookie = (home.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const html = await home.text();
  const href = html.match(new RegExp(`${REPORT.replace('.', '\\.')}\\?OWASP_CSRFTOKEN=[A-Z0-9-]+`))?.[0] || REPORT;
  await sleep(1000);
  const r = await fetch(BASE + href, { headers: { 'User-Agent': UA, Cookie: cookie, Referer: BASE }, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`LGD report HTTP ${r.status}`);
  return r.text();
}

export function parseReport(html) {
  const states = {};
  let total = null;
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (c.length < COLS.length + 1) continue;
    const isTotal = /^total$/i.test(c[0]);
    const [name, ...vals] = isTotal ? c : c.slice(1);
    if (!isTotal && !/^\d+$/.test(c[0])) continue;
    const row = { name: isTotal ? 'India' : name };
    COLS.forEach((k, i) => { const v = (vals[i] || '').replace(/,/g, ''); row[k] = /^\d+$/.test(v) ? +v : null; });
    if (isTotal) { total = row; continue; }
    const code = CODES[norm(name)];
    if (!code) { log(`  unknown state in LGD report: ${name}`); continue; }
    states[code] = row;
  }
  if (!total && Object.keys(states).length) { total = { name: 'India' }; for (const k of COLS) total[k] = Object.values(states).reduce((a, r) => a + (r[k] || 0), 0); }
  const generatedOn = html.match(/Report Generated on\s*([\d/]+)/)?.[1]?.split('/').reverse().join('-') || null;
  return { states, total, generatedOn };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, 'lgd.json');
  log('LGD: state-wise administrative units & PRIs');
  let parsed = null;
  for (let i = 0; i < 4 && !(Object.keys(parsed?.states || {}).length >= 30); i++) {
    try { parsed = parseReport(await fetchReport()); } catch (e) { log(`  attempt ${i + 1}: ${e.message}`); await sleep(5000 * 2 ** i); }
  }
  if (!parsed || Object.keys(parsed.states).length < 30) {
    if (existsSync(file)) { log('  LGD unavailable, keeping previous lgd.json'); return; }
    throw new Error('LGD report unavailable (it may refuse connections from outside India)');
  }
  await writeFile(file, JSON.stringify({
    generated: new Date().toISOString(), reportDate: parsed.generatedOn,
    source: `${BASE}${REPORT}`, sourceName: 'Local Government Directory (LGD), Ministry of Panchayati Raj',
    note: 'Villages = rural and urbanised villages. Traditional local bodies are customary councils (mainly North-East) that stand in for panchayats.',
    total: parsed.total, states: parsed.states,
  }));
  log(`Wrote data/india/lgd.json (${Object.keys(parsed.states).length} states/UTs; ${parsed.total.villagePanchayats} village panchayats, ${parsed.total.villages} villages)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
