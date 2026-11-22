#!/usr/bin/env node
/**
 * IAS officers from DoPT (Department of Personnel & Training), public pages only:
 *  - IAS Civil List (iascivillist.dopt.gov.in/Home/ViewList, one form POST per cadre):
 *    name, identity no., allotment year (batch), cadre, domicile, source of recruitment,
 *    qualification, pay level, remarks, current posting.
 *  - Public Executive Record Sheet (supremo.dopt.gov.in/ERSheetHtml.aspx): posting history.
 *  - District Collectors / DMs / DCs: each district in data/india/union.json matched to the
 *    officer whose current posting is head of that district.
 * Writes data/india/ias.json, data/india/ias/<CADRE>.json (posting histories) and data/india/collectors.json.
 *
 * Stores official service data only: no photos, no phone numbers, no addresses, and no full
 * date of birth (only the superannuation month derived from it).
 * DoPT blocks requests from outside India, so run this from an Indian connection.
 *   ER=0 node scripts/fetch-ias.mjs     skip the ER sheets (keeps previous histories)
 *   ONLY=UP,TN node scripts/fetch-ias.mjs   only these cadres (others kept from the previous run)
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
const LIST = 'https://iascivillist.dopt.gov.in/Home/ViewList';
const ER = 'https://supremo.dopt.gov.in/ERSheetHtml.aspx';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DoPT cadre code -> name and the site's state/UT codes it serves.
export const CADRES = {
  UT: ['AGMUT', ['DL', 'GA', 'AR', 'MZ', 'AN', 'CH', 'DN', 'LD', 'PY', 'JK', 'LA']],
  AP: ['Andhra Pradesh', ['AP']], AM: ['Assam-Meghalaya', ['AS', 'ML']], BH: ['Bihar', ['BR']], CG: ['Chhattisgarh', ['CG']],
  GJ: ['Gujarat', ['GJ']], HY: ['Haryana', ['HR']], HP: ['Himachal Pradesh', ['HP']], JH: ['Jharkhand', ['JH']],
  KN: ['Karnataka', ['KA']], KL: ['Kerala', ['KL']], MP: ['Madhya Pradesh', ['MP']], MH: ['Maharashtra', ['MH']],
  MN: ['Manipur', ['MN']], NL: ['Nagaland', ['NL']], OD: ['Odisha', ['OD']], PB: ['Punjab', ['PB']], RJ: ['Rajasthan', ['RJ']],
  SK: ['Sikkim', ['SK']], TN: ['Tamil Nadu', ['TN']], TG: ['Telangana', ['TS']], TR: ['Tripura', ['TR']],
  UP: ['Uttar Pradesh', ['UP']], UD: ['Uttarakhand', ['UK']], WB: ['West Bengal', ['WB']],
};

async function get(url, { body, tries = 5 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body, signal: AbortSignal.timeout(180000),
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) { log(`  give up ${url.slice(0, 90)}: ${e.message}`); return null; }
      await sleep(3000 * 2 ** i);
    }
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (h) => decode(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const iso = (d) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const field = (card, label) => { const m = card.match(new RegExp(`<b>${label}[^<]*</b>([\\s\\S]*?)</(?:p|span)>`, 'i')); return m ? oneLine(text(m[1])) : null; };

/** Parse the Civil List page for one cadre. */
export function parseList(html, cadre) {
  html = html.replace(/src="data:[^"]*"/g, 'src=""');
  const out = [];
  for (const tr of html.match(/<tr>\s*<td>\d+<\/td>[\s\S]*?<\/tr>/g) || []) {
    const er = tr.match(/OffIDErhtml=([^"&]+)/)?.[1];
    const name = oneLine(text(tr.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] || '').replace(/^Name:\s*/i, ''));
    if (!name) continue;
    const dob = iso(tr.match(/DOB:\s*([\d/]+)/)?.[1]);
    const cd = field(tr, 'Cadre & Domicile:') || '';
    const postings = [...(tr.match(/<b>Posting:-<\/b>[\s\S]*?<\/ul>/)?.[0] || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => {
      const t = text(m[1]);
      return { title: oneLine(t.replace(/Posting W\.E\.F\.:.*$/s, '')), since: iso(t.match(/W\.E\.F\.:\s*([\d/]+)/)?.[1]) };
    }).filter((p) => p.title);
    const pay = field(tr, 'Pay Scale:');
    const erId = er ? decodeURIComponent(er) : null;
    out.push({
      id: field(tr, 'Identity No.:'),
      er: erId,
      name,
      cadre,
      batch: +field(tr, 'Allotment Year:') || null,
      recruitment: field(tr, 'Source of Recruitment:'),
      qualification: field(tr, 'Qualification\\(Subject\\):'),
      payLevel: +(pay || '').match(/Level\s*(\d+)/i)?.[1] || null,
      remarks: field(tr, 'Remarks:') || null,
      domicile: oneLine(cd.split('&').slice(1).join('&')) || null,
      retires: retirement(dob),
      postings,
    });
  }
  return out;
}
// All India Services officers retire on the last day of the month in which they turn 60.
function retirement(dob) {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  // Born on the 1st: retires at the end of the previous month.
  const ry = y + 60, rm = d === 1 ? m - 1 : m;
  return rm === 0 ? `${ry - 1}-12` : `${ry}-${String(rm).padStart(2, '0')}`;
}

/** Parse a public ER sheet: profile fields + posting history, newest first. */
export function parseER(html) {
  const updated = html.match(/Profile Last Updated On:\s*([\d-]+)/)?.[1]?.split('-').reverse().join('-') || null;
  const gender = text(html.match(/Gender\s*:[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/)?.[1] || '') || null;
  const status = text(html.match(/Retirement Reason\s*:[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/)?.[1] || '') || null;
  const deput = /Whether Presently on deputation to GOI \?[\s\S]*?<td[^>]*>(?:\s|<b>)*Yes/i.test(html);
  const sec = html.slice(html.indexOf('IV. Experience'), html.indexOf('V. Mid Career'));
  const history = [];
  for (const tr of sec.match(/<tr>\s*<td>\d+<\/td>[\s\S]*?<\/tr>/g) || []) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (c.length < 6) continue;
    const [desig, level] = c[1].split('\n');
    const place = c[2].split('\n').map(oneLine).filter(Boolean);
    const [from, to] = c[5].split('-').map((x) => iso(x.trim()));
    history.push({ designation: oneLine(desig || ''), level: oneLine(level || ''), office: place, org: c[3], field: c[4], from, to });
  }
  return { updated, gender: gender && gender.length < 12 ? gender : null, status, centralDeputation: deput, history };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/* ------------------------------------------------------------ District Collectors */
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(district|distt|dist)\b/g, '').replace(/[^a-z]/g, '');
const bigrams = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const m = new Map(); for (const x of A) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0; for (const x of B) if (m.get(x) > 0) { hit++; m.set(x, m.get(x) - 1); }
  return (2 * hit) / (A.length + B.length);
}
// Common spelling variants between the DoPT record and Wikipedia's district names.
const ALIAS = {
  gurgaon: 'gurugram', allahabad: 'prayagraj', faizabad: 'ayodhya', sasnagar: 'mohali', sahibzadaajitsinghnagar: 'mohali', ropar: 'rupnagar',
  bangalore: 'bengaluru', bangaloreurban: 'bengaluruurban', bangalorerural: 'bengalururural', mysore: 'mysuru', belgaum: 'belagavi', gulbarga: 'kalaburagi',
  bellary: 'ballari', bijapur: 'vijayapura', shimoga: 'shivamogga', tumkur: 'tumakuru', chikmagalur: 'chikkamagaluru', hubli: 'dharwad',
  trichy: 'tiruchirappalli', tuticorin: 'thoothukudi', kanchipuram: 'kancheepuram', nilgiris: 'thenilgiris', trivandrum: 'thiruvananthapuram',
  calicut: 'kozhikode', quilon: 'kollam', alleppey: 'alappuzha', palghat: 'palakkad', trichur: 'thrissur', cannanore: 'kannur',
  baroda: 'vadodara', panchmahals: 'panchmahal', ahmednagar: 'ahilyanagar', aurangabad: 'chhatrapatisambhajinagar', osmanabad: 'dharashiv',
  nasik: 'nashik', poona: 'pune', bombay: 'mumbai', mumbaicity: 'mumbai', hoshangabad: 'narmadapuram', calcutta: 'kolkata', burdwan: 'bardhaman',
  midnapore: 'medinipur', howrah: 'haora', hooghly: 'hugli', darjiling: 'darjeeling', coochbehar: 'koochbehar', jagatsinghapur: 'jagatsinghpur',
  balasore: 'baleshwar', keonjhar: 'kendujhar', sonepur: 'subarnapur', boudh: 'baudh', deogarh: 'debagarh', khurda: 'khordha',
  kamrupmetro: 'kamrupmetropolitan', northlakhimpur: 'lakhimpur', sibsagar: 'sivasagar', nowgong: 'nagaon', ranga: 'rangareddy', rangareddi: 'rangareddy', purnea: 'purnia', maldah: 'malda', gaya: 'gaya', gayaji: 'gaya', coochbihar: 'koochbehar', chumukedima: 'chumoukedima', sribhumi: 'karimganj',
};
const canon = (s) => { const n = norm(s); return ALIAS[n] || n; };
const STATE_CANON = ['andhrapradesh', 'arunachal', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana', 'himachal', 'jharkhand', 'karnataka', 'kerala',
  'madhyapradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamilnadu', 'telangana', 'tripura',
  'uttarpradesh', 'uttarakhand', 'westbengal', 'delhi', 'jammu', 'kashmir', 'ladakh', 'puducherry', 'chandigarh', 'andaman', 'lakshadweep', 'dadra', 'daman', 'govt', 'government'];
const HEAD = /(^|\b)(collector|district magistrate|d\.?\s?m\.?|deputy commissioner|district commissioner|d\.?\s?c\.?|dist(rict)? collector|dc\s*&\s*dm|collector\s*&\s*dm)(\b|$)/i;
const NOT_HEAD = /additional|addl|joint|asst|assistant|sub.?divisional|\bsdm\b|municipal|excise|commercial|tax|labour|land reforms|development commissioner|police|\bacm\b|\badc\b|\badm\b|deputy collector|sub.?collector|trainee|o\/o|\bosd\b|officer on special duty|\bto\b|astt|\bco-|special deputy|regional deputy|\bspl\b/i;

/**
 * Current posting: whichever of the latest ER row and the Civil List entry started more recently.
 * ER sheets are often left un-updated for years with an open end date, so "open-ended" alone means little.
 */
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
function currentPosting(o) {
  const h = o.history?.[0];
  const p = o.postings?.[0];
  let list = null;
  if (p) {
    const [first, ...rest] = p.title.split(',');
    const bracketed = [...first.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
    list = { title: p.title, designation: first.trim(), office: [...bracketed, ...rest].map((x) => x.trim()).filter(Boolean), field: '', since: p.since, src: 'list' };
  }
  if (h && (!list || (h.from || '') >= (list.since || ''))) {
    // Same posting in both records but the ER row has no place: borrow the Civil List's.
    const office = h.office.length ? h.office : list && list.since && h.from && days(list.since, h.from) <= 90 ? list.office : [];
    return { title: [h.designation, office.join(', ')].filter(Boolean).join(', '), designation: h.designation, office, field: h.field, since: h.from, src: 'er' };
  }
  return list;
}

export function matchCollectors(officers, districts) {
  const out = {};
  const claims = [];
  for (const o of officers) {
    const cur = o.current;
    if (!cur) continue;
    // The ER "field" is often blank or generic ("Public Administration"), so the designation decides.
    if (!HEAD.test(cur.designation) || NOT_HEAD.test(cur.designation)) continue;
    // Places: office parts plus anything in brackets ("DM (South-West)", "D.C., Dibrugarh (Assam)").
    const raw = [...[...cur.designation.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]), ...(cur.office.length ? cur.office : [cur.title])];
    const places = [...new Set(raw.flatMap((x) => [x.replace(/\([^)]*\)/g, ''), ...[...x.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])]).map(canon).filter(Boolean))];
    for (const st of CADRES[o.cadre][1]) {
      for (const d of districts[st] || []) {
        // Delhi's districts are posted as "DM (South-West)", so also try the name without "Delhi".
        // Only an exact hit counts for that short form ("south" must not match "North Goa" minus "goa").
        const keys = [canon(d.name), canon(d.hq)].filter((k) => k.length >= 4);
        const short = st === 'DL' ? canon(d.name).replace(/delhi$/, '') : null;
        let best = 0;
        for (const p of places) {
          if (short && p === short) best = 1;
          for (const k of keys) {
            // Drop state names before the substring test: "jammuandkashmir" must not count as "jammu",
            // but "dibrugarhassam" or "paschimbardhamanintherankof…westbengal" should still find the district.
            const parts = STATE_CANON.reduce((s, x) => s.replaceAll(x, '|'), p).split('|').filter(Boolean);
            best = Math.max(best, p === k ? 1 : k.length >= 5 && parts.some((part) => part.includes(k)) ? 0.95 : dice(p, k));
          }
        }
        if (best >= 0.85) claims.push({ st, d: d.name, o, score: best });
      }
    }
  }
  // Highest score wins; on a tie, the most recent posting.
  claims.sort((a, b) => b.score - a.score || (b.o.current.since || '').localeCompare(a.o.current.since || ''));
  const used = new Set();
  for (const c of claims) {
    out[c.st] ??= {};
    if (out[c.st][c.d] || used.has(c.o.id)) continue;
    used.add(c.o.id);
    out[c.st][c.d] = { name: c.o.name, id: c.o.id, batch: c.o.batch, designation: c.o.current.designation, since: c.o.current.since };
  }
  return out;
}

// Chief Secretary of each state/UT: current posting titled "Chief Secretary" (not Additional / to the CS).
const STATE_NAMES = { DL: 'delhi', GA: 'goa', AR: 'arunachal', MZ: 'mizoram', AN: 'andaman', CH: 'chandigarh', DN: 'dadra|daman', LD: 'lakshadweep', PY: 'puducherry|pondicherry', JK: 'jammu|kashmir', LA: 'ladakh', AS: 'assam', ML: 'meghalaya', MN: 'manipur', NL: 'nagaland', TR: 'tripura', SK: 'sikkim' };
export function matchChiefSecretaries(officers) {
  const out = {};
  for (const o of officers) {
    const d = o.current?.designation || '';
    if (!/^\s*chief (secretary|secy)\b/i.test(d) || /\bto\s+(the\s+)?chief secretary/i.test(o.current.title)) continue;
    const states = CADRES[o.cadre][1];
    const where = o.current.title.toLowerCase();
    // Officers of a joint cadre (or on inter-cadre deputation) are placed by the state named in the posting.
    const named = Object.keys(STATE_NAMES).filter((s) => new RegExp(STATE_NAMES[s]).test(where));
    const st = named.length === 1 ? named[0] : states.length === 1 ? states[0] : null;
    if (!st || (out[st] && (out[st].since || '') > (o.current.since || ''))) continue;
    out[st] = { name: o.name, id: o.id, batch: o.batch, since: o.current.since };
  }
  return out;
}

/* ------------------------------------------------------------ main */
async function main() {
  await mkdir(path.join(OUT, 'ias'), { recursive: true });
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim().toUpperCase()) : null;
  const prevFile = path.join(OUT, 'ias.json');
  const prev = existsSync(prevFile) ? JSON.parse(await readFile(prevFile, 'utf8')) : null;
  const prevById = new Map((prev?.officers || []).map((o) => [o.id, o]));
  // Previous run's histories (compact rows) turned back into parsed ER records, so a failed or skipped ER fetch keeps them.
  const prevHist = async (cadre) => {
    const f = path.join(OUT, 'ias', `${cadre}.json`);
    if (!existsSync(f)) return {};
    const rows = JSON.parse(await readFile(f, 'utf8'));
    return Object.fromEntries(Object.entries(rows).map(([id, h]) => {
      const p = prevById.get(id) || {};
      return [id, { updated: p.erUpdated, gender: p.gender, status: null, centralDeputation: p.centralDeputation,
        history: h.map(([from, to, designation, level, office, org, fld]) => ({ from, to, designation, level, office: String(office || '').split(', ').filter(Boolean), org, field: fld })) }];
    }));
  };
  const fromPrev = (o) => ({ ...o, postings: o.postings || (o.posting ? [{ title: o.posting, since: o.since }] : []) });

  const officers = [];
  let asOn = prev?.asOn || null;
  for (const [cadre, [name]] of Object.entries(CADRES)) {
    if (only && !only.includes(cadre)) { officers.push(...(prev?.officers || []).filter((o) => o.cadre === cadre).map(fromPrev)); continue; }
    const html = await get(LIST, { body: `ViewCadreCode=${cadre}&btn_submit=Submit` });
    const list = html ? parseList(html, cadre) : [];
    asOn = html?.match(/Civil List as on\s*<strong>([\d.]+)/i)?.[1]?.split('.').reverse().join('-') || asOn;
    const want = +(html?.match(/Total Count:\s*<span><b[^>]*>(\d+)/)?.[1] || 0);
    if (!list.length) {
      const old = (prev?.officers || []).filter((o) => o.cadre === cadre);
      log(`  ${name}: civil list unavailable, keeping ${old.length} from previous run`);
      officers.push(...old.map(fromPrev));
      continue;
    }
    log(`  ${name}: ${list.length} officers${want && want !== list.length ? ` (page says ${want})` : ''}`);
    officers.push(...list);
    await sleep(1500);
  }
  if (!officers.length) throw new Error('No officers fetched. DoPT only answers requests from India.');

  // Posting histories from the public ER sheets.
  const hist = {};
  for (const c of Object.keys(CADRES)) hist[c] = await prevHist(c);
  if (process.env.ER !== '0') {
    const todo = officers.filter((o) => o.er && (!only || only.includes(o.cadre)));
    log(`ER sheets: ${todo.length} officers`);
    let done = 0, fail = 0;
    await pool(todo, +process.env.CONCURRENCY || 4, async (o) => {
      const html = await get(`${ER}?OffIDErhtml=${encodeURIComponent(o.er)}&PageId=`, { tries: 3 });
      const er = html && /Executive Record Sheet/i.test(html) ? parseER(html) : null;
      if (er) hist[o.cadre][o.id] = er; else fail++;
      if (++done % 250 === 0) log(`  ${done}/${todo.length}${fail ? ` (${fail} failed, previous kept)` : ''}`);
      await sleep(250);
    });
    log(`  ER sheets done: ${done - fail} parsed, ${fail} failed`);
  }

  for (const o of officers) {
    const h = hist[o.cadre]?.[o.id];
    if (h) { o.gender = h.gender; o.status = h.status; o.centralDeputation = h.centralDeputation; o.erUpdated = h.updated; o.history = h.history; }
    o.current = currentPosting(o);
  }
  const districts = JSON.parse(await readFile(path.join(OUT, 'union.json'), 'utf8')).districts || {};
  const collectors = matchCollectors(officers, districts);
  const total = Object.values(districts).reduce((a, x) => a + x.length, 0);
  const matched = Object.values(collectors).reduce((a, x) => a + Object.keys(x).length, 0);
  log(`Collectors: ${matched} of ${total} districts matched to an IAS officer`);
  const chiefSecretaries = matchChiefSecretaries(officers);
  log(`Chief Secretaries: ${Object.keys(chiefSecretaries).length} found`);

  // Compact output: ias.json = list + current posting; ias/<CADRE>.json = posting histories (loaded on demand).
  const slim = officers.map((o) => ({
    id: o.id, er: o.er, name: o.name, cadre: o.cadre, batch: o.batch, recruitment: o.recruitment, qualification: o.qualification,
    payLevel: o.payLevel, domicile: o.domicile, gender: o.gender || null, retires: o.retires, remarks: o.remarks,
    centralDeputation: o.centralDeputation ?? /on c\.?d\.?/i.test(o.remarks || ''),
    posting: o.current?.title || null, since: o.current?.since || null, field: o.current?.field || null,
    erUpdated: o.erUpdated || null, hasHistory: !!o.history?.length,
  }));
  for (const c of Object.keys(CADRES)) {
    const h = {};
    for (const o of officers) if (o.cadre === c && o.history?.length) h[o.id] = o.history.map((x) => [x.from, x.to, x.designation, x.level, x.office.join(', '), x.org, x.field]);
    if (Object.keys(h).length) await writeFile(path.join(OUT, 'ias', `${c}.json`), JSON.stringify(h));
  }
  await writeFile(prevFile, JSON.stringify({
    generated: new Date().toISOString(), asOn,
    sources: { civilList: 'https://iascivillist.dopt.gov.in/', erSheet: 'https://supremo.dopt.gov.in/ERSheetHtml.aspx' },
    cadres: Object.fromEntries(Object.entries(CADRES).map(([k, [n, s]]) => [k, { name: n, states: s }])),
    historyColumns: ['from', 'to', 'designation', 'level', 'office', 'organisation', 'field'],
    officers: slim,
  }));
  await writeFile(path.join(OUT, 'collectors.json'), JSON.stringify({ generated: new Date().toISOString(), matched, total, collectors, chiefSecretaries }));
  log(`Wrote data/india/ias.json (${slim.length} officers), data/india/ias/*.json, data/india/collectors.json`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
