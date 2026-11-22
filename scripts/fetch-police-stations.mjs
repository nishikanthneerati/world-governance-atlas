#!/usr/bin/env node
/**
 * Police stations, state by state, from each state/UT police force's own public website.
 * One adapter per source; each returns rows { name, unit, subDivision?, circle?, phone?, mobile?, email?, address?, jurisdiction? }.
 * `unit` (the police district / section as the source names it) is mapped onto the site's district list (union.json).
 * Writes data/india/police-stations/<CODE>.json. Official contacts only: station landlines, official CUG mobiles and
 * official e-mail. Residence numbers and personal details are never stored. Sources behind a CAPTCHA or login are skipped.
 *   ONLY=KA,BR node scripts/fetch-police-stations.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india', 'police-stations');
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { type = 'text', body, headers = {}, tries = 3, timeout = 30000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: body ? 'POST' : 'GET', body, headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === 'json' ? await r.json() : type === 'raw' ? r : await r.text();
    } catch (e) {
      if (i === tries - 1) {
        // Some government servers reject Node's TLS handshake but answer curl.
        if (!body && type !== 'raw') {
          try { const out = execFileSync('curl', ['-sS', '-L', '-m', String(Math.round(timeout / 1000)), '-A', UA, url], { maxBuffer: 1 << 27 }).toString('utf8'); return type === 'json' ? JSON.parse(out) : out; } catch {}
        }
        log(`  give up ${url.slice(0, 90)}: ${e.message}`); return null;
      }
      await sleep(2000 * 2 ** i);
    }
  }
}
async function pool(items, n, fn) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); await sleep(150); } })); return out; }

const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#39;|&#039;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;|&#8211;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (h) => decode(String(h ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const cells = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => m[1]);
const rows = (h) => h.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
const deobf = (s) => String(s || '').replace(/\s*\[\s*at\s*\]\s*/gi, '@').replace(/\s*\[\s*dot\s*\]\s*/gi, '.').trim();
const email = (s) => (deobf(s).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0] || null;
const clean = (s) => { const t = text(s); return t && t !== '-' && t !== '—' ? t : null; };
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bPs\b/g, 'PS');
// Cloudflare-protected e-mail: data-cfemail hex, XOR with the first byte.
const cfmail = (h) => { const m = String(h).match(/email-protection#([0-9a-f]+)/i) || String(h).match(/data-cfemail="([0-9a-f]+)"/i); if (!m) return null; const b = m[1].match(/../g).map((x) => parseInt(x, 16)); return String.fromCharCode(...b.slice(1).map((x) => x ^ b[0])); };

/* ------------------------------------------------------------------ adapters */
const A = {};

// Jharkhand: one Drupal page, a table per district. Residence numbers are dropped.
A.JH = async () => {
  const h = await get('https://www.jhpolice.gov.in/police-station');
  return { source: 'https://www.jhpolice.gov.in/police-station', sourceName: 'Jharkhand Police: police stations', rows: (h?.match(/<table[\s\S]*?<\/table>/g) || []).flatMap((t) => {
    const unit = text(t.match(/<caption>([\s\S]*?)<\/caption>/)?.[1]);
    return rows(t).map(cells).filter((c) => c.length >= 5).map((c) => ({ name: text(c[0]), unit, code: clean(c[1]), phone: clean(c[2]), mobile: clean(c[4]) })).filter((r) => r.name && /\bPS\b|thana/i.test(r.name));
  }) };
};

// Karnataka: KSP contact directory. Title rows mark district / sub-division / circle; station rows mention "PS".
const KA_CITY = { 'Bengaluru City': 'Bengaluru City', 'Belagavi City': 'Belagavi', 'Hubballi–Dharwad City': 'Dharwad', 'Mangaluru City': 'Dakshina Kannada', 'Mysuru City': 'Mysore', 'Kalaburagi City': 'Kalaburagi' };
A.KA = async () => {
  const url = 'https://ksp.karnataka.gov.in/ksp_contact/en';
  const h = await get(url, { timeout: 60000 });
  const out = [];
  for (const sec of (h || '').split('class="sub-header"').slice(1)) {
    const title = text(sec.match(/<span>([\s\S]*?)<\/span>/)?.[1]);
    const isCity = KA_CITY[title], isRange = /Range/.test(title);
    if (!isCity && !isRange) continue;
    let unit = isCity || null, sub = null, circle = null;
    const seen = new Set();
    for (const tr of rows(sec)) {
      const c = cells(tr);
      if (/title-row/.test(tr)) {
        const t = text(c[0]).replace(/\s*-\s*\d{3,5}$/, '');
        if (/^OTHER\b/i.test(t)) continue;
        if (/ DISTRICT$/i.test(t)) { unit = titleCase(t.replace(/ DISTRICT$/i, '')); sub = circle = null; }
        else if (/SUB[\s-]?DIVISION|DIVISION$/i.test(t)) { sub = titleCase(t.replace(/\s*SUB[\s-]?DIVISION/i, '').replace(/\s*DIVISION$/i, '')); circle = null; }
        else if (/CIRCLE$/i.test(t)) circle = titleCase(t.replace(/\s*CIRCLE$/i, ''));
        continue;
      }
      if (c.length < 3 || !unit) continue;
      const des = text(c[0]);
      if (!/\bPS\b/.test(des) || /^(DSP|ACP|SP|DCP|ADDL)/i.test(des)) continue;
      const name = des.replace(/^(PI|PSI|CPI|WPI|WPSI|SHO|ASI|Inspector|Sub[- ]Inspector)\b[\s,.]*/i, '').trim();
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const tel = text(c[1]).split(/\s+/).filter((x) => /\d{5,}/.test(x) && !/^RES/i.test(x)).join(', ');
      out.push({ name, unit, subDivision: sub, circle, phone: tel || null, mobile: clean(c[2]), email: cfmail(c[3]) || email(text(c[3])) });
    }
  }
  return { source: url, sourceName: 'Karnataka State Police contact directory', rows: out };
};

// Mizoram: one table, District | PS/OP | number (district cell spans rows).
A.MZ = async () => {
  const url = 'https://police.mizoram.gov.in/page/contact-numbers-of-police-stations-and-outposts';
  const h = await get(url);
  const t = h?.match(/<table[\s\S]*?<\/table>/)?.[0] || '';
  let unit = null;
  return { source: url, sourceName: 'Mizoram Police: police stations & outposts', rows: rows(t).slice(1).map(cells).map((c) => {
    if (c.length >= 3) unit = text(c[0]).replace(/[()]/g, '').trim() || unit;
    const [nm, no] = c.length >= 3 ? [c[1], c[2]] : [c[0], c[1]];
    return { name: text(nm), unit, mobile: clean(no) };
  }).filter((r) => r.name && /\bPS\b/.test(r.name)) };
};

// Kerala: contacts page, one JSON POST per unit (needs session cookie + CSRF token).
A.KL = async () => {
  const page = 'https://keralapolice.gov.in/page/contacts';
  const r0 = await get('https://keralapolice.gov.in/switch/language/en', { type: 'raw' });
  let cookie = (r0?.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const r = await get(page, { type: 'raw', headers: { Cookie: cookie } });
  if (!r) return null;
  cookie = [cookie, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const h = await r.text();
  const token = h.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  const units = [...(h.match(/<select[^>]*unit_id[\s\S]*?<\/select>/)?.[0] || '').matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], name: text(m[2]) }))
    .filter((u) => /city|rural|district|idukki|wayanad|kasaragod|kannur|kozhikode|malappuram|palakkad|thrissur|ernakulam|kottayam|alappuzha|pathanamthitta|kollam|thiruvananthapuram/i.test(u.name) && !/range|zone|battalion|crime|special|vigilance|training|armed/i.test(u.name));
  const out = [];
  for (const u of units) {
    const j = await get('https://keralapolice.gov.in/contacts/list', { type: 'json', body: new URLSearchParams({ _token: token, unit_id: u.id }), headers: { Cookie: cookie, 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Referer: page } });
    for (const c of rows(j?.html || '').map(cells)) {
      if (c.length < 6) continue;
      const name = text(c[1]);
      if (!/\bPS\b|police station/i.test(name)) continue;
      const std = text(c[2]), off = text(c[3]);
      out.push({ name, unit: u.name, phone: off ? `${std ? std + '-' : ''}${off}` : null, mobile: clean(c[4]), email: email(text(c[5])) });
    }
    await sleep(400);
  }
  return { source: page, sourceName: 'Kerala Police contacts', rows: out };
};

// Bihar: JSON handler, one request per police district.
A.BR = async () => {
  const base = 'https://police.bihar.gov.in/PoliceStationHandler.ashx';
  const d = await get(`${base}?action=getalldistricts&lang=en`, { type: 'json' });
  const out = [];
  for (const x of d?.districts || []) {
    const j = await get(`${base}?action=search&districtId=${x.id}&lang=en`, { type: 'json' });
    for (const s of j?.stations || j?.data || (Array.isArray(j) ? j : [])) out.push({ name: s.ps_name_en || s.ps_name, unit: s.district_name || x.name_en, mobile: s.mobile || null, email: s.email || null });
    await sleep(300);
  }
  return { source: 'https://police.bihar.gov.in/', sourceName: 'Bihar Police: police stations', rows: out };
};

// Chhattisgarh: Drupal JSON. District list in one call, then one call per thana for contact + jurisdiction.
A.CG = async () => {
  const list = await get('https://cgpolice.gov.in/cms/district-list', { type: 'json' });
  if (!list) return null;
  const dist = Object.fromEntries(list.filter((x) => !x.parent_target_id).map((x) => [x.tid, x.name]));
  const thanas = list.filter((x) => x.parent_target_id && dist[x.parent_target_id]);
  const out = await pool(thanas, 4, async (t) => {
    const j = await get(`https://cgpolice.gov.in/cms/api/thana-details?dis_id=${t.tid}`, { type: 'json', tries: 2 });
    const d = Array.isArray(j) ? j[0] : j?.data?.[0] || j;
    return { name: text(d?.title || t.name), unit: dist[t.parent_target_id], subDivision: clean(d?.field_name_of_sub_division), mobile: clean(d?.field_contact_number), email: email(d?.field_email_id), jurisdiction: clean(d?.field_jurisdiction_of_police_sta) };
  });
  return { source: 'https://cgpolice.gov.in/', sourceName: 'Chhattisgarh Police: thana details', rows: out.filter((r) => r?.name) };
};

// Puducherry: JSON list + a page per station for phone / e-mail.
A.PY = async () => {
  const list = await get('https://police.py.gov.in/get_station.php', { type: 'json' });
  const out = await pool(list || [], 3, async (s) => {
    const h = await get(`https://police.py.gov.in/station.php?id=${s.id}`, { tries: 2 });
    const c = h?.match(/Contact Details[\s\S]{0,400}/)?.[0] || '';
    return { name: titleCase(s.ps_name), unit: titleCase(s.district), phone: (text(c).match(/Phone:\s*([\d\s,-]+)/) || [])[1]?.trim() || null, email: email(text(c)) };
  });
  return { source: 'https://police.py.gov.in/', sourceName: 'Puducherry Police', rows: out.filter(Boolean) };
};

// Jammu & Kashmir: a section per police district; "SDPO X (phone)" | "P/S Y (phones)".
A.JK = async () => {
  const url = 'https://jkpolice.gov.in/Police-Stations';
  const h = await get(url);
  const out = [];
  for (const sec of (h || '').split(/<div class="row" id="/).slice(1)) {
    const unit = text(sec.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]);
    let sub = null;
    for (const c of rows(sec).map(cells)) {
      if (c.length < 2) continue;
      const a = text(c[0]), b = text(c[1]);
      if (a) sub = a.replace(/\s*\(.*$/, '').replace(/^(SDPO|Addl\.? SP|Dy\.?\s*SP( Hqrs\.?)?)\s*/i, '') || sub;
      if (!/^P\/S/i.test(b)) continue;
      out.push({ name: b.replace(/^P\/S\s*/i, '').replace(/\s*\(.*$/, '') + ' PS', unit, subDivision: sub, phone: (b.match(/\(([^)]*)\)/) || [])[1] || null });
    }
  }
  return { source: url, sourceName: 'J&K Police: police stations', rows: out };
};

// Chandigarh: directory table; SHO rows name the station.
A.CH = async () => {
  const url = 'https://portal.chandigarhpolice.gov.in/public/Pages/Complaint-Registration';
  const h = await get(url);
  return { source: url, sourceName: 'Chandigarh Police directory', rows: rows(h || '').map(cells).filter((c) => c.length >= 6 && /SHO,\s*POLICE STATION/i.test(text(c[2]))).map((c) => {
    const ph = text(c[3]).split(/[,/]/).map((x) => x.trim()).filter(Boolean);
    return { name: titleCase(text(c[2]).replace(/^SHO,\s*/i, '').replace(/\s*-\s*/, ' ')), unit: 'Chandigarh', phone: ph.find((x) => /^0172/.test(x)) || null, mobile: ph.find((x) => /^[6-9]\d{9}$/.test(x)) || null, email: email(text(c[4])), address: clean(c[5]) };
  }) };
};

// Kolkata Police (West Bengal): division tables on the contact page.
A.WB = async () => {
  const url = 'https://kolkatapolice.gov.in/contact/';
  const h = await get(url, { timeout: 60000 });
  const out = [];
  for (const c of rows(h || '').map(cells)) {
    if (c.length < 6 || !/detailPSModal/.test(c[0])) continue;
    const ph = text(c[2]).split('/').map((x) => x.trim());
    out.push({ name: `${text(c[0])} PS`, unit: 'Kolkata', phone: ph.find((x) => /^033/.test(x)) || null, mobile: ph.find((x) => /^[6-9]\d{9}$/.test(x.replace(/\s/g, ''))) || null, email: email(text(c[5])) });
  }
  out.push(...wbState());
  return { source: 'https://wbpolice.gov.in/WBP/Common/WBP_SubUnit_List.aspx?IsKYP=True', sourceName: 'West Bengal Police "Know your police station" + Kolkata Police contacts', rows: out };
};

// West Bengal Police "Know your police station": ASP.NET cascading dropdowns (unit type > police district > PS).
// The view state is too large for a command line, so each form body goes through a temp file.
function wbState() {
  const url = 'https://wbpolice.gov.in/WBP/Common/WBP_SubUnit_List.aspx?IsKYP=True';
  const jar = path.join(os.tmpdir(), `wbpolice-${process.pid}.jar`), bodyFile = path.join(os.tmpdir(), `wbpolice-${process.pid}.body`);
  const curl = (args) => { for (let i = 0; i < 3; i++) { try { return execFileSync('curl', ['-sS', '-m', '60', '-A', UA, '-c', jar, '-b', jar, ...args], { maxBuffer: 1 << 26 }).toString('utf8'); } catch {} } return ''; };
  const P = 'ctl00$ContentPlaceHolder1$';
  const hv = (h, id) => decode((h.match(new RegExp(`id="${id}" value="([^"]*)"`)) || [])[1] || '');
  const opts = (h, name) => { const i = h.indexOf(`name="${name}"`); if (i < 0) return []; return [...h.slice(i, h.indexOf('</select>', i)).matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)].map((m) => [m[1], decode(m[2]).trim()]).filter(([v]) => v && !/select/i.test(v)); };
  const post = (h, target, fields) => {
    writeFileSync(bodyFile, Object.entries({ __EVENTTARGET: target, __EVENTARGUMENT: '', __LASTFOCUS: '', __VIEWSTATE: hv(h, '__VIEWSTATE'), __VIEWSTATEGENERATOR: hv(h, '__VIEWSTATEGENERATOR'), __VIEWSTATEENCRYPTED: '', ...fields }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'));
    return curl(['-e', url, '--data-binary', `@${bodyFile}`, '-H', 'Content-Type: application/x-www-form-urlencoded', url]);
  };
  const field = (h, label) => { const t = text(h.slice(h.indexOf('Details Information'))); const m = t.match(new RegExp(`${label}\\s*:\\s*(.*?)\\s*(?:Police Unit|Police Sub Unit|Office Address|Email Id|Telephone No\\.|Mobile No\\.|Contents provided|$)`)); return m && m[1] && !/^0?$/.test(m[1]) ? m[1] : null; };
  const out = [];
  const h0 = curl([url]);
  for (const type of ['02', '01', '03']) {
    const f1 = { [P + 'ddl_unit_Type']: type };
    const h1 = post(h0, P + 'ddl_unit_Type', f1);
    for (const [uv, uname] of opts(h1, P + 'ddl_Unit_Name')) {
      if (/^kolkata/i.test(uname)) continue; // Kolkata Police is taken from its own site
      const f2 = { ...f1, [P + 'ddl_Unit_Name']: uv };
      const h2 = post(h1, P + 'ddl_Unit_Name', f2);
      const f3 = { ...f2, [P + 'ddl_Sub_Unit_Type']: '30' };
      const h3 = post(h2, P + 'ddl_Sub_Unit_Type', f3);
      const unit = type === '03' ? 'GRP' : uname.replace(/\s*Police (District|Commissionerate)\s*$/i, '').trim();
      for (const [pv, pname] of opts(h3, P + 'ddl_Sub_Unit_Name')) {
        const d = post(h3, P + 'ddl_Sub_Unit_Name', { ...f3, [P + 'ddl_Sub_Unit_Name']: pv });
        const tel = field(d, 'Telephone No\\.'), mob = (field(d, 'Mobile No\\.') || '').replace(/\D/g, '');
        out.push({ name: /\bPS$/i.test(pname) ? pname : `${pname} PS`, unit, address: field(d, 'Office Address'), phone: tel && !/^[6-9]\d{9}$/.test(tel) ? tel : null, mobile: /^[6-9]\d{9}$/.test(mob) ? mob : tel && /^[6-9]\d{9}$/.test(tel) ? tel : null, email: email(field(d, 'Email Id') || '') });
      }
      log(`  WB ${uname}: ${out.length} so far`);
    }
  }
  return out;
}

// Haryana: statewide "Know Your Police Station" map (Google My Maps KML) with station name + district.
A.HR = async () => {
  const url = 'https://www.google.com/maps/d/kml?mid=1JpSYcFL77-Z3WLng7EuTUz4-QwF4D-4&forcekml=1';
  const k = await get(url, { timeout: 60000 });
  const data = (pm, key) => text(pm.match(new RegExp(`<Data name="${key}">\\s*<value>([\\s\\S]*?)</value>`, 'i'))?.[1]);
  return { source: 'https://haryanapolice.gov.in/', sourceName: 'Haryana Police "Know Your Police Station" map', rows: (k?.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || []).map((pm) => ({ name: titleCase(data(pm, 'Police Station Name') || text(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1])) + ' PS', unit: titleCase(data(pm, 'DISTRICT') || '') })).filter((r) => r.name.length > 3) };
};

// Meghalaya: "Know your police station" page, Range > District Executive Force > station names.
A.ML = async () => {
  const url = 'https://megpolice.gov.in/know-your-police-station';
  const h = (await get(url) || '').replace(/<script[\s\S]*?<\/script>/g, '');
  const out = [];
  let unit = null;
  for (const m of h.matchAll(/<(h\d|strong|b|li|p|td)[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = text(m[2]);
    if (!t) continue;
    if (/(District|D\.E\.F)/i.test(t) && !/\bPS\b|Police Station/i.test(t) && t.length < 80) { unit = t.replace(/\s*(District Executive Force|D\.E\.F\.?|District)\s*/gi, ' ').replace(/[:()-]/g, ' ').trim(); continue; }
    if (unit && !unit.startsWith('/') && /\bP\.?S\.?$|Police Station$/i.test(t) && t.length < 60) out.push({ name: t.replace(/\s*P\.?S\.?$/i, ' PS'), unit });
  }
  return { source: url, sourceName: 'Meghalaya Police: know your police station', rows: out };
};

// Small UTs with one static page each.
A.DN = async () => {
  const url = 'https://police.ddd.gov.in/police-station/';
  const h = (await get(url) || '').replace(/<script[\s\S]*?<\/script>/g, '');
  const out = [];
  for (const m of h.matchAll(/<h2>\s*<a[^>]*>([^<]*Police Station[^<]*)<\/a>\s*<\/h2>\s*<p>([\s\S]*?)<\/p>/gi)) {
    const t = text(m[2]);
    const name = text(m[1]);
    out.push({ name, unit: /silvassa|khanvel|dadra/i.test(name + t) ? 'Dadra and Nagar Haveli' : /diu|vanakbara/i.test(name + t) ? 'Diu' : 'Daman', address: t.replace(/^Address:\s*/i, '').replace(/\s*Contact No[\s\S]*$/i, '').slice(0, 160) || null, phone: (t.match(/0\d{2,4}[-\s]?\d{6,8}/) || [])[0] || null });
  }
  return { source: url, sourceName: 'DNH & DD Police: police stations', rows: out };
};

// Goa: a page per station; North / South district from the home-page menu.
A.GA = async () => {
  const base = 'https://citizen.goapolice.gov.in';
  const home = await get(base + '/');
  if (!home) return null;
  const iN = home.indexOf('North District'), iS = home.indexOf('South District'), iO = home.indexOf('Other Police');
  const links = [...home.matchAll(/href="(\/web\/guest\/[^"]*police-station[^"]*)"/g)].map((m) => ({ href: m[1], at: m.index }))
    .filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i);
  const out = await pool(links, 3, async (l) => {
    const h = (await get(base + l.href, { tries: 2 }) || '').replace(/<script[\s\S]*?<\/script>/g, '');
    const t = text(h);
    const name = (t.match(/([A-Z][A-Z .()&-]+POLICE STATION)[\s>-]*INCHARGE/) || [])[1];
    if (!name) return null;
    return {
      name: titleCase(name), unit: l.at > iO && iO > 0 ? 'Other units' : l.at > iS && iS > 0 ? 'South Goa' : 'North Goa',
      incharge: (t.match(/INCHARGE:\s*([^|]+?)\s*(Contact No|$)/i) || [])[1]?.replace(/\s*,\s*/, ', ').trim() || null,
      phone: (t.match(/Contact No:\s*([\d\s,/-]+)/i) || [])[1]?.trim() || null, mobile: (t.match(/Mobile No:\s*([\d\s,/]+)/i) || [])[1]?.trim() || null,
      email: email((t.match(/Email:\s*(\S+)/i) || [])[1]),
    };
  });
  return { source: base, sourceName: 'Goa Police: police stations', rows: out.filter(Boolean) };
};

// Delhi: telephone directory, "Police Station Email-ID" view (all SHOs). ASP.NET postback.
// The site's firewall only accepts the postback from a client that keeps its cookie jar, so this one uses curl.
A.DL = async () => {
  const url = 'https://delhipolice.gov.in/telephonedirectory';
  const jar = path.join(os.tmpdir(), `dlpolice-${process.pid}.jar`);
  const curl = (args) => { try { return execFileSync('curl', ['-sS', '-m', '45', '-A', UA, '-c', jar, '-b', jar, ...args], { maxBuffer: 1 << 26 }).toString('utf8'); } catch { return ''; } };
  const h = curl([url]);
  const hv = (id) => decode((h.match(new RegExp(`id="${id}" value="([^"]*)"`)) || [])[1] || '');
  const districts = [...(h.match(/<select[^>]*ddldistrict[\s\S]*?<\/select>/)?.[0] || '').matchAll(/<option[^>]*value="([^"]+)"/gi)].map((m) => decode(m[1])).filter((v) => !/Email-ID|select|^0$|^CP|JT\.|SPL|ADDL/i.test(v));
  const DL_UNIT = { 'SOUTH WEST': 'South West Delhi', 'NORTH WEST': 'North West Delhi', 'SOUTH EAST': 'South East Delhi', 'NORTH EAST': 'North East Delhi', SOUTH: 'South Delhi', NORTH: 'North Delhi', EAST: 'East Delhi', WEST: 'West Delhi', CENTRAL: 'Central Delhi', 'NEW DELHI': 'New Delhi', SHAHDARA: 'Shahdara', DWARKA: 'South West Delhi', ROHINI: 'North West Delhi', 'OUTER NORTH': 'North West Delhi', OUTER: 'West Delhi' };
  const out = [];
  for (const d of districts) {
    const p = curl(['-e', url, ...['__EVENTTARGET=ctl00$MainContent$ddldistrict', '__EVENTARGUMENT=', `__VIEWSTATE=${hv('__VIEWSTATE')}`, `__VIEWSTATEGENERATOR=${hv('__VIEWSTATEGENERATOR')}`, `__EVENTVALIDATION=${hv('__EVENTVALIDATION')}`, `ctl00$MainContent$ddldistrict=${d}`, 'ctl00$MainContent$ddlrecord=200'].flatMap((x) => ['--data-urlencode', x]), url]);
    const u = d.toUpperCase().replace(/\s*(DISTRICT|DISTT\.?)\s*$/, '').trim();
    for (const c of rows(p).map(cells)) {
      if (c.length < 7 || !/^SHO\b/i.test(text(c[1]))) continue;
      out.push({ name: titleCase(text(c[1]).replace(/^SHO[\s/.]*/i, '')) + ' PS', unit: DL_UNIT[u] || titleCase(u), phone: clean(c[2]), mobile: clean(c[3]), email: email(text(c[6])) });
    }
    await sleep(500);
  }
  return { source: url, sourceName: 'Delhi Police telephone directory', rows: out };
};

// Lakshadweep: table of island police stations with the SHO.
A.LD = async () => {
  const url = 'https://lakshadweeppolice.gov.in/index.php/police_stations';
  const h = await get(url);
  const t = (h?.match(/<table[\s\S]*?<\/table>/g) || []).find((x) => /Name of Police Station/i.test(x)) || '';
  return { source: url, sourceName: 'Lakshadweep Police', rows: rows(t).map(cells).filter((c) => c.length >= 4 && /^PS\b/i.test(text(c[1]))).map((c) => ({ name: text(c[1]).replace(/^PS\s*/i, '') + ' PS', unit: 'Lakshadweep', incharge: `${text(c[2])}, ${text(c[3])}` })) };
};

// Andaman & Nicobar: helpline page table of police stations with phones.
const NM_ANDAMAN = /Rangat|Mayabunder|Kalighat|Diglipur|Billiground|Kadamtala|Kadamatala|Baratang|Shibpur/i;
A.AN = async () => {
  const url = 'https://police.andamannicobar.gov.in/index.php/en/public-information/emergency-helpline-numbers.html';
  const h = await get(url);
  const t = (h?.match(/<table[\s\S]*?<\/table>/g) || []).find((x) => /Police Stations with Phone/i.test(x)) || '';
  let nicobar = false;
  const out = [];
  for (const c of rows(t).map(cells)) {
    const a = text(c[1] || c[0]);
    if (/Nicobar/i.test(text(c.join(' '))) && !/^PS\b/i.test(a)) { nicobar = true; continue; }
    if (!/^PS\b/i.test(a)) continue;
    out.push({ name: a.replace(/^PS\s*/i, '') + ' PS', unit: nicobar ? 'Nicobar' : NM_ANDAMAN.test(a) ? 'North and Middle Andaman' : 'South Andaman', phone: clean(c[2]) });
  }
  return { source: url, sourceName: 'Andaman & Nicobar Police', rows: out };
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Odisha: "Know your police station", one static table (office no., CUG mobile, e-mail, officer in charge).
A.OD = async () => {
  const url = 'https://police.odisha.gov.in/en/sun/knowyourstation';
  const h = await get(url, { headers: { 'User-Agent': BROWSER_UA }, timeout: 60000 });
  const t = (h?.match(/<table[\s\S]*?<\/table>/g) || []).sort((a, b) => b.length - a.length)[0] || '';
  return { source: url, sourceName: 'Odisha Police: know your police station', rows: rows(t).slice(1).map(cells).filter((c) => c.length >= 4).map((c) => {
    const v = c.map(text);
    const nums = v.slice(4).join(' ').match(/\b\d{10,12}\b/g) || [];
    return { name: v[2], unit: v[1], incharge: v[3] || null, phone: nums.find((x) => /^0/.test(x)) || null, mobile: nums.find((x) => /^[6-9]\d{9}$/.test(x)) || null, email: email(v.find((x) => /\[at\]|@/.test(x))) };
  }).filter((r) => r.name) };
};

// Tamil Nadu: open JSON API; station names per district / city unit.
A.TN = async () => {
  const base = 'https://www.police.tn.gov.in/digigov/contactUs';
  const H = { headers: { 'User-Agent': BROWSER_UA }, type: 'json' };
  const units = [...((await get(`${base}/getDistrict?officeTypeId=3`, H))?.responseObject?.data || []), ...((await get(`${base}/getDistrict?officeTypeId=7`, H))?.responseObject?.data || [])];
  const out = [];
  for (const u of units) {
    const j = await get(`${base}/getPoliceStation?prntOrgId=${u.ORGANIZATION_ID}`, H);
    for (const s of j?.responseObject?.data || []) out.push({ name: titleCase(s.ORGANIZATION_NAME) + ' PS', unit: titleCase(u.ORGANIZATION_NAME) });
    await sleep(250);
  }
  return { source: 'https://www.police.tn.gov.in/', sourceName: 'Tamil Nadu Police: contact us', rows: out };
};

// Uttar Pradesh: station list per district (JSON), then each station's page (jurisdiction, SHO's official CUG, circle).
A.UP = async () => {
  const H = { headers: { 'User-Agent': BROWSER_UA } };
  const home = await get('https://uppolice.gov.in/', H);
  const dists = [...(home?.match(/<select[^>]*id="parentDDL"[\s\S]*?<\/select>/)?.[0] || '').matchAll(/<option value="(\d+)">([^<]+)</g)].map((m) => ({ id: m[1], name: titleCase(text(m[2]).replace(/\s*\(COMMISSIONERATE\)/i, '')) }));
  const list = [];
  for (const d of dists) {
    const j = await get(`https://uppolice.gov.in/thanaHandler.ashx?c=${d.id}`, { ...H, type: 'json' });
    (j?.districts || []).forEach((x, i) => list.push({ d, name: x.d, t: j.districtsCode?.[i]?.c }));
    await sleep(200);
  }
  const details = process.env.UP_DETAILS !== '0';
  const out = await pool(list, 4, async (s) => {
    const row = { name: `${s.name} PS`.replace(/ PS PS$/, ' PS').replace(/Police Station PS$/, 'PS'), unit: s.d.name };
    if (!details || !s.t) return row;
    const h = (await get(`https://uppolice.gov.in/en/ThanaDetails?d=${s.d.id}&t=${s.t}`, { ...H, tries: 2 }) || '').replace(/<script[\s\S]*?<\/script>/g, '');
    const label = (l) => text((h.match(new RegExp(`${l}[\\s\\S]*?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i')) || [])[1]);
    const sho = (h.match(/Name of SHO\/SO[\s\S]*?<\/tr>\s*<tr[^>]*>([\s\S]*?)<\/tr>/i) || [])[1];
    const c = sho ? cells(sho).map(text) : [];
    return { ...row, jurisdiction: label('Jurisdiction of Police Station') || null, incharge: c[1] ? `${c[1]}, ${c[2]}` : null, mobile: /^9454\d{6}$/.test(c[3] || '') ? c[3] : null, email: email(c[5]), circle: label('Name of Circle') || null };
  });
  return { source: 'https://uppolice.gov.in/', sourceName: 'Uttar Pradesh Police: thana details', rows: out.filter(Boolean) };
};

// Telangana: each district's "know your PS" page embeds a Division > Circle > PS tree (Astro props).
const astro = (v) => {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') return v[0] === 1 ? v[1].map(astro) : astro(v[1]);
  if (Array.isArray(v)) return v.map(astro);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, astro(x)]));
  return v;
};
A.TS = async () => {
  const H = { headers: { 'User-Agent': BROWSER_UA } };
  const unitsPage = await get('https://www.tspolice.gov.in/main/police-unit', H) || '';
  // District selector props: [{ name, url: slug, isExternal }]; external ones (Hyderabad, Cyberabad, Malkajgiri) have their own sites.
  const slugs = [...new Set([...decode(unitsPage).matchAll(/"url":\[0,"([a-z0-9-]+)"\],"isExternal":\[0,false\]/g)].map((m) => m[1]))];
  const out = [];
  for (const slug of slugs) {
    const h = await get(`https://www.tspolice.gov.in/${slug}/know-your-ps`, { ...H, tries: 2 });
    for (const m of (h || '').matchAll(/props="([^"]*treeNodes[^"]*)"/g)) {
      let props; try { props = astro(JSON.parse(decode(m[1]))); } catch { continue; }
      const nodes = props.treeNodes || [];
      const byCode = {};
      const all = [];
      const walk = (n, ctx) => { if (!n || typeof n !== 'object') return; if (n.Level) { all.push({ n, ctx }); const c2 = { ...ctx, [n.Level]: n.Name }; for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach((x) => walk(x, c2)); } else for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach((x) => walk(x, ctx)); };
      nodes.forEach((n) => walk(n, {}));
      for (const { n, ctx } of all) {
        if (!/POLICE STATION/i.test(n.Level)) continue;
        const od = (n.OfficerDetails || [])[0] || {};
        out.push({ name: titleCase(n.Name.replace(/^SHO\s+/i, '')), unit: titleCase(slug.replace(/-/g, ' ')), subDivision: ctx.DIVISION ? titleCase(ctx.DIVISION.replace(/^SDPO\s*/i, '').replace(/^ACP\s*/i, '')) : null, circle: ctx.CIRCLE ? titleCase(ctx.CIRCLE.replace(/^CIRCLE\s*/i, '')) : null, incharge: od.OfficerName ? `${od.OfficerName}, ${od.Designation || 'SHO'}` : null, phone: od.PsLandlineNumber || null, mobile: od.PsContactNumber || null, email: email(od.PsEmailID), address: od.PsLocation || null });
        byCode[n.Code] = n;
      }
    }
    await sleep(400);
  }
  return { source: 'https://www.tspolice.gov.in/', sourceName: 'Telangana Police: know your PS', rows: out };
};

// Tripura: each of the 8 district police sites has its own contact table. The officer-in-charge's mobile is
// usually a personal number there, so only the station landline and official e-mail are kept.
A.TR = async () => {
  const SITES = { 'West Tripura': 'https://westpolice.tripura.gov.in/node/96', 'North Tripura': 'https://northpolice.tripura.gov.in/contact', Dhalai: 'https://dhalaipolice.tripura.gov.in/contact', Gomati: 'https://gomatipolice.tripura.gov.in/contact', Khowai: 'https://khowaipolice.tripura.gov.in/contact', Sepahijala: 'https://sepahijalapolice.tripura.gov.in/contact%20us', 'South Tripura': 'https://southpolice.tripura.gov.in/contact', Unakoti: 'https://unakotipolice.tripura.gov.in/contact' };
  const out = [];
  for (const [unit, url] of Object.entries(SITES)) {
    const h = await get(url);
    for (const c of rows(h || '').map(cells).map((r) => r.map(text))) {
      const t = c.join(' | ');
      const m = t.match(/(?:\bO\/?C\b|Officer-in-?\s?Charge,?)\s+([A-Za-z][A-Za-z. ]*?)\s*(?:\bP\.?S\b\.?|Police Station)/i) || t.match(/\bOC\s+(Women)\s+PS\s+(\w+)/i);
      if (!m) continue;
      const name = titleCase(m[2] ? `${m[2]} ${m[1]}` : m[1]).replace(/\s+/g, ' ').trim() + ' PS';
      // Officer's rank + name: the text before "O/C" in the matching cell, or the cells before it (rank and name may be split).
      const k = c.findIndex((x) => /\bO\/?C\b|Officer-in-?\s?Charge/i.test(x));
      const before = c[k].replace(/[,\s]*(?:\bO\/?C\b|Officer-in-?\s?Charge)[\s\S]*$/i, '').trim();
      const who = [...c.slice(0, k).filter((x) => x && !/^\d+$/.test(x)), before].filter(Boolean).join(' ').replace(/^Inspr\.?\s*\(UB\)|^Inspr\.\s*\./, 'Inspr.').replace(/[\s,]+$/, '').trim();
      const mail = (t.match(/([\w.-]+)\s*(?:@|\[at\])?\s*tripurapolice\s*\[dot\]\s*nic\s*\[dot\]\s*in/i) || [])[1];
      const land = (t.match(/\(?0\d{3,4}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}/) || [])[0] || (t.match(/(\d{3})-(\d{3})\s*\((0\d{4})\)/) || []).slice(1).reduce((a, b, i) => (i === 2 ? `${b}-${a}` : a + b), '') || null;
      out.push({ name, unit, incharge: who && who.length < 60 && !/^(OC|O\/C)$/i.test(who) ? `${who}, Officer-in-charge` : null, phone: land && !/^[6-9]\d{9}$/.test(land.replace(/\D/g, '')) ? land.trim() : null, email: mail ? `${mail}@tripurapolice.nic.in` : email(t) });
    }
    await sleep(500);
  }
  return { source: 'https://police.tripura.gov.in/district_police', sourceName: 'Tripura district police websites (8 districts)', rows: out };
};

// Rajasthan: SCRB contact directory, an R Shiny app (no login or CAPTCHA). Its "PS Contacts" table is sent over the
// app's SockJS websocket, so we speak that protocol directly. The table lists every staff member with a mobile;
// only each station's office details (name, office phone, official e-mail) are kept.
A.RJ = async () => {
  const host = 'shinyserver.rajasthan.gov.in', app = '/cctnsco/';
  const rnd = (n) => Math.random().toString(36).slice(2, 2 + n);
  await get(`https://${host}${app}`); // starts an app worker, as a browser visit does
  const data = await new Promise((resolve) => {
    const ws = new WebSocket(`wss://${host}${app}__sockjs__/n=${rnd(18)}/${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}/${rnd(8)}/websocket`);
    const done = (v) => { clearTimeout(timer); try { ws.close(); } catch {} resolve(v); };
    const timer = setTimeout(() => { log('  RJ: timed out'); done(null); }, 240000);
    ws.onmessage = (e) => {
      const d = String(e.data);
      if (d === 'o') {
        ws.send(JSON.stringify(['0#0|o|']));
        ws.send(JSON.stringify(['0#0|m|' + JSON.stringify({ method: 'init', data: { rbCategory1: '5. District DCP/SP', rbCategory2: '1. Sub-Inspector & Above (All)', '.clientdata_output_resultsContacts1_hidden': true, '.clientdata_output_resultsContacts4_hidden': false, '.clientdata_output_resultsContacts4_width': 1000, '.clientdata_output_resultsContacts4_height': 400, '.clientdata_pixelratio': 1, '.clientdata_url_protocol': 'https:', '.clientdata_url_hostname': host, '.clientdata_url_port': '', '.clientdata_url_pathname': app, '.clientdata_url_search': '', '.clientdata_url_hash_initial': '', '.clientdata_url_hash': '', '.clientdata_singletons': '' } })]));
        return;
      }
      if (d[0] !== 'a' || !d.includes('resultsContacts4') || !d.includes('values')) return;
      for (const m of JSON.parse(d.slice(1))) { const j = JSON.parse(m.slice(m.indexOf('|m|') + 3)); const t = j.values?.resultsContacts4?.x?.tag?.attribs?.data; if (t) return done(t); }
    };
    ws.onerror = () => { log('  RJ: websocket error'); done(null); };
  });
  if (!data) return null;
  const seen = new Set(), out = [];
  data.DISTRICT_NAME.forEach((unit, i) => {
    const p = String(data.OFFICE_DETAILS[i]).split(/<br\s*\/?>/i).map(text);
    const key = `${unit}|${p[0]}`;
    if (seen.has(key) || /NOT APPLICABLE/i.test(unit)) return;
    seen.add(key);
    const off = (p.find((x) => /\(OFF\)/i.test(x)) || '').replace(/\s*\(OFF\)/i, '').replace(/\D/g, '');
    out.push({ name: titleCase(p[0].replace(/\s*\(PS\)$/i, '')) + ' PS', unit: /^GRP/i.test(unit) ? 'GRP' : titleCase(unit), phone: off.length >= 10 ? off.replace(/^([1-5]\d{9})$/, '0$1') : null, email: email(p.find((x) => x.includes('@')) || '') });
  });
  return { source: 'https://police.rajasthan.gov.in/portal/Directory', sourceName: 'Rajasthan Police (SCRB) contact directory', rows: out };
};

// Sikkim: one telephone table, "X DISTRICT" header rows, then SHO/<station> rows with official mobile + e-mail.
A.SK = async () => {
  const url = 'https://police.sikkim.gov.in/visitor/telephonepolice';
  const h = await get(url);
  const out = [];
  let unit = null;
  for (const c of rows(h || '').map(cells)) {
    const t = c.map(text);
    const head = t.find((x) => /^[A-Z ]+ DISTRICT$/.test(x));
    if (head && t.filter(Boolean).length === 1) { unit = titleCase(head.replace(/ DISTRICT$/, '')); continue; }
    const post = t[1] || '';
    if (!unit || !/^SHO\s*\//i.test(post)) continue;
    const mob = (t.slice(2).join(' ').match(/\b[6-9]\d{9}\b/) || [])[0];
    out.push({ name: titleCase(post.replace(/^SHO\s*\/\s*/i, '')) + ' PS', unit, mobile: mob || null, email: email(t.slice(2).join(' ')) });
  }
  return { source: url, sourceName: 'Sikkim Police: telephone directory', rows: out };
};

// Uttarakhand: telephone directory, one accordion table per district. Only the police CUG series (9411x/9412x) is kept.
A.UK = async () => {
  const url = 'https://uttarakhandpolice.uk.gov.in/telephone_directory';
  const h = (await get(url) || '').replace(/<script[\s\S]*?<\/script>/g, '');
  const parts = h.split(/<table/i);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    // The accordion title (district name) is the last text before each table.
    const district = (text(parts[i - 1].slice(-1500)).replace(/\s*\+\s*$/, '').match(/(Udham Singh Nagar|Pauri Garhwal|Tehri Garhwal|[A-Z][A-Za-z]+)$/) || [])[1];
    for (const c of rows(parts[i].split(/<\/table>/i)[0]).map(cells).map((r) => r.map(text))) {
      if (c.length < 5 || !/^\d+$/.test(c[0])) continue;
      const mob = c[3].replace(/\D/g, '');
      out.push({ name: titleCase(c[1]).replace(/\s+PS$/i, '') + ' PS', unit: district, phone: /^0?\d{3,5}-?\d{5,8}$/.test(c[2].replace(/\s/g, '')) && !/^[6-9]\d{9}$/.test(c[2]) ? c[2].replace(/^([1-5]\d{9})$/, '0$1') : null, mobile: /^941[12]\d{6}$/.test(mob) ? mob : null, email: email(c[4]) });
    }
  }
  return { source: url, sourceName: 'Uttarakhand Police: telephone directory', rows: out };
};

// Punjab: the office e-mail directory lists every station as "PS <name> (<police district>)".
A.PB = async () => {
  const url = 'https://www.punjabpolice.gov.in/en/contact-us/punjab-police-officer/';
  const h = await get(url, { timeout: 90000 });
  const out = [];
  let last = null;
  for (const c of rows(h || '').map(cells).map((r) => r.map((x) => deobf(text(x))))) {
    const n = c.find((v) => /^PS\b/i.test(v));
    if (!n) continue;
    let unit = n.match(/\(([^)]+)\)\s*$/)?.[1];
    let nm = n.replace(/\s*\([^)]*\)\s*$/, '');
    if (/\bGRP\b/i.test(nm)) unit = 'GRP';
    if (!unit) { const m = nm.match(/\s((?:Nawan Shahar|Tarn Taran|[A-Z][a-z]+)(?:-[CR])?)$/); if (m && m[1].length > 3) { unit = m[1]; nm = nm.slice(0, -m[0].length); } }
    unit ||= last; last = unit;
    out.push({ name: nm.replace(/^PS\s+/i, '') + ' PS', unit, email: email(c.join(' ')) });
  }
  return { source: url, sourceName: 'Punjab Police: office e-mail directory', rows: out };
};

// Assam: "One Post One Number" PDF of official CUG numbers, post by post under district headers.
// The number column does not line up reliably with the post names in the PDF text, so only station names are kept.
A.AS = async () => {
  const url = 'https://police.assam.gov.in/sites/default/files/swf1/dms76_opon-final.pdf';
  const r = await get(url, { type: 'raw', timeout: 90000 });
  if (!r) return null;
  const file = path.join(os.tmpdir(), `as-opon-${process.pid}.pdf`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  const txt = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 27 }).toString('utf8');
  const KEYS = [['WEST KARBI', 'West Karbi Anglong'], ['HAMREN', 'West Karbi Anglong'], ['KARBI', 'Karbi Anglong'], ['K/ANGLONG', 'Karbi Anglong'], ['KAMRUP METRO', 'Kamrup Metropolitan'], ['GUWAHATI', 'Kamrup Metropolitan'], ['KAMRUP', 'Kamrup'], ['SOUTH SALMARA', 'South Salmara-Mankachar'], ['BISWANATH', 'Biswanath'], ['SADIYA', 'Tinsukia'], ['DIMA HASAO', 'Dima Hasao'], ['SPR PANDU', 'GRP'], ['HEADQUARTERS', 'HQ'],
    ...['Baksa', 'Bajali', 'Barpeta', 'Bongaigaon', 'Cachar', 'Charaideo', 'Chirang', 'Darrang', 'Dhemaji', 'Dhubri', 'Dibrugarh', 'Goalpara', 'Golaghat', 'Hailakandi', 'Hojai', 'Jorhat', 'Karimganj', 'Kokrajhar', 'Lakhimpur', 'Majuli', 'Morigaon', 'Nagaon', 'Nalbari', 'Sivasagar', 'Sonitpur', 'Tamulpur', 'Tinsukia', 'Udalguri'].map((d) => [d.toUpperCase(), d])];
  const out = [];
  let unit = null;
  for (const line of txt.split('\n')) {
    const up = line.toUpperCase();
    const isPost = /\b(O\/C|O\.?C|I\/C|IN-?CHARGE)|P\.?\s?S\.?\b|O\.?P\b/.test(up);
    // District headers: un-numbered title lines, or the "S.P <district>" row that opens each section.
    if ((!isPost && !/^\s*\d/.test(up)) || /^\s*\d+\s+S\.?\s?P\.?\s/.test(up)) { const k = KEYS.find(([w]) => up.includes(w)); if (k && !/DUPLICATE|GIVEN TO/.test(up)) unit = k[1]; }
    // "O/C Rangia P.S.", "Officer-In-Charge, Dispur P.S", "O/C, Sonari Police Station", or "Rangapara P.S., O/C".
    const m = line.match(/(?:O\/C|\bO\.?\s?C\.?|I\/C|Officer\s*-?\s*In\s*-?\s*Charge)[\s,]*([A-Za-z][A-Za-z .()-]*?)\s*(?:\bP\.?\s?S\b\.?|Police Station)/i)
      || line.match(/^\s*\d+\s+([A-Za-z][A-Za-z .-]*?)\s*(?:\bP\.?\s?S\b\.?|Police Station)[,\s]*(?:as\s+)?O\/C\b/i);
    const nm = m && titleCase(m[1].replace(/[.,]$/, '').replace(/\bsador\b/i, 'Sadar').trim()) + ' PS';
    // The PDF repeats some sections (e.g. Hojai under Nagaon); keep the first.
    if (nm && unit && unit !== 'HQ' && !out.some((r) => r.name === nm)) out.push({ name: nm, unit });
  }
  return { source: url, sourceName: 'Assam Police: "One Post One Number" list (station names)', rows: out };
};

// States with no station list, and why (from a survey of every state police website, Nov 2026).
const NOT_AVAILABLE = {
  AP: 'appolice.gov.in serves its station list only to a browser session (anti-bot check).',
  AR: 'Arunachal Police publishes district SPs but no police-station list.',
  GJ: 'police.gujarat.gov.in did not respond.',
  HP: 'hppolice.gov.in returns 404; the citizen portal needs a CAPTCHA login.',
  LA: 'Ladakh Police publishes control-room numbers only.',
  MH: 'Maharashtra has no state-wide list; each commissionerate and district runs its own site.',
  MN: 'manipurpolice.gov.in did not respond.',
  MP: 'mppolice.gov.in did not respond.',
  NL: 'Nagaland Police publishes headquarters officers only.',
};

/* ------------------------------------------------------------------ district matching */
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(district|police|city|rural|urban|commissionerate|range|def|executive force|town)\b/g, '').replace(/[^a-z]/g, '');
const ALIAS = { anugola: 'angul', baleshwar: 'balasore', baragada: 'bargarh', debagada: 'debagarh', kataka: 'cuttack', kendrapada: 'kendrapara', sundaragada: 'sundargarh', raurkela: 'sundargarh', bhubaneswar: 'khordha', khurda: 'khordha', keonjhar: 'kendujhar', sonepur: 'subarnapur', bolangir: 'balangir', nowrangpur: 'nabarangpur', trichy: 'tiruchirappalli', avadi: 'tiruvallur', tambaram: 'chengalpattu', tirupattur: 'tirupathur', bhadradrikothagudem: 'bhadradrikothagudem', ramagundam: 'peddapalli', rachakonda: 'medchalmalkajgiri', tumkur: 'tumakuru', kgf: 'kolar', naughachhia: 'bhagalpur', lohardega: 'lohardaga', siaha: 'saiha', awantipora: 'pulwama', handwara: 'kupwara', sopore: 'baramulla', dabwali: 'sirsa', hansi: 'hisar', sribhumi: 'karimganj',bangalore: 'bengaluru', bengaluruurban: 'bangaloreurban', bengaluru: 'bangaloreurban', bengalururural: 'bangalorerural', mysuru: 'mysore', belagavi: 'belagavi', shivamogga: 'shimoga', chikkamagaluru: 'chikmagalur', vijayapura: 'bijapur', gadag: 'gadaga', chikkaballapura: 'chikkaballapur', chamarajanagara: 'chamarajanagar', trivandrum: 'thiruvananthapuram', tvm: 'thiruvananthapuram', kochi: 'ernakulam', calicut: 'kozhikode', purnea: 'purnia', bettiah: 'westchamparan', bagaha: 'westchamparan', motihari: 'eastchamparan', naugachia: 'bhagalpur', gurgaon: 'gurugram', yamunanagar: 'yamunanagar', sribhumi: 'karimganj', kawardha: 'kabirdham', gpm: 'gaurelapendramarwahi', mcb: 'manendragarhchirmiribharatpur', baikunthpur: 'koriya', ambikapur: 'surguja', jagdalpur: 'bastar', dantewada: 'dakshinbastardantewada', kanker: 'uttarbastarkanker', khairagarh: 'khairagarhchhuikhadangandai', mohla: 'mohlamanpurambagarhchowki', bilaigarh: 'sarangarhbilaigarh', bhadoi: 'bhadohi', kheri: 'lakhimpurkheri', batala: 'gurdaspur', nawanshahar: 'shahidbhagatsinghnagar', sbsnagar: 'shahidbhagatsinghnagar', khanna: 'ludhiana', ropar: 'rupnagar', mohali: 'sahibzadaajitsinghnagar', sasnagar: 'sahibzadaajitsinghnagar', ferozpur: 'firozpur', ferozepur: 'firozpur', firozepur: 'firozpur', muktsar: 'srimuktsarsahib', mukatsar: 'srimuktsarsahib', fardikot: 'faridkot', pathannkot: 'pathankot', jalr: 'jalandhar', jalandharrl: 'jalandhar', jalandar: 'jalandhar', amritsarc: 'amritsar', amritsarr: 'amritsar', jalandharc: 'jalandhar', jalandharr: 'jalandhar', ludhianac: 'ludhiana', ludhianar: 'ludhiana', ganganagar: 'sriganganagar', hanumangargh: 'hanumangarh', bhiwadi: 'khairthaltijara', jalore: 'jalore' };
const canon = (s) => { const n = norm(s); return ALIAS[n] || n; };
const bigrams = (s) => { const o = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); return o; };
const dice = (a, b) => { const A2 = bigrams(a), B = bigrams(b); if (!A2.length || !B.length) return 0; const m = new Map(); for (const x of A2) m.set(x, (m.get(x) || 0) + 1); let h = 0; for (const x of B) if (m.get(x) > 0) { h++; m.set(x, m.get(x) - 1); } return (2 * h) / (A2.length + B.length); };
function districtOf(unit, districts, overrides = {}) {
  if (overrides[unit]) return overrides[unit];
  const u = canon(unit);
  if (!u) return null;
  let best = null, score = 0;
  for (const d of districts) {
    for (const k of [canon(d.name), canon(d.hq)]) {
      if (!k) continue;
      const s = u === k ? 1 : (u.length >= 5 && k.startsWith(u)) || (k.length >= 5 && u.startsWith(k)) ? 0.92 : dice(u, k);
      if (s > score) { score = s; best = d.name; }
    }
  }
  return score >= 0.8 ? best : null;
}
const OVERRIDE = { KA: { 'Bengaluru City': 'Bangalore Urban', Bengaluru: 'Bangalore Rural' }, DL: {}, WB: { Kolkata: 'Kolkata', 'Asansol-Durgapur': 'Paschim Bardhaman', Barrackpore: 'North 24 Parganas', Bidhannagar: 'North 24 Parganas', Bangaon: 'North 24 Parganas', Barasat: 'North 24 Parganas', Basirhat: 'North 24 Parganas', Chandannagar: 'Hooghly', 'Hooghly Rural': 'Hooghly', Howrah: 'Howrah', 'Howrah Rural': 'Howrah', Siliguri: 'Darjeeling', Baruipur: 'South 24 Parganas', 'Diamond Harbour': 'South 24 Parganas', Sundarban: 'South 24 Parganas', Islampur: 'Uttar Dinajpur', Raiganj: 'Uttar Dinajpur', Jangipur: 'Murshidabad', Murshidabad: 'Murshidabad', Krishnanagar: 'Nadia', Ranaghat: 'Nadia', Coochbehar: 'Cooch Behar', Malda: 'Maldah', 'Purba Burdwan': 'Purba Bardhaman' } };

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim().toUpperCase()) : null;
  const districts = JSON.parse(await readFile(path.join(ROOT, 'data', 'india', 'union.json'), 'utf8')).districts || {};
  const summary = [];
  for (const [code, fn] of Object.entries(A)) {
    if (only && !only.includes(code)) continue;
    log(`${code}: fetching`);
    let res = null;
    try { res = await fn(); } catch (e) { log(`  ${code} failed: ${e.message}`); }
    if (!res?.rows?.length) { log(`  ${code}: no stations parsed, keeping any previous file`); summary.push(`${code}:0`); continue; }
    const seen = new Set(), unmatched = new Set();
    const stations = [];
    for (const r of res.rows) {
      const district = districtOf(r.unit, districts[code] || [], OVERRIDE[code]) || (districts[code]?.length === 1 ? districts[code][0].name : null);
      if (!district && r.unit) unmatched.add(r.unit);
      const key = `${district || r.unit}|${r.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Official e-mail only: personal addresses (gmail etc.) that some sources list are dropped.
      const official = r.email && /\.(gov|nic)\.in$/i.test(r.email) ? r.email : null;
      stations.push(Object.fromEntries(Object.entries({ ...r, email: official, district: district || r.unit || null, unit: r.unit !== district ? r.unit : undefined }).filter(([, v]) => v != null && v !== '')));
    }
    stations.sort((a, b) => (a.district || '').localeCompare(b.district || '') || a.name.localeCompare(b.name));
    await writeFile(path.join(OUT, `${code}.json`), JSON.stringify({ generated: new Date().toISOString(), source: res.source, sourceName: res.sourceName, stations }));
    log(`  ${code}: ${stations.length} stations${unmatched.size ? `; units not matched to a district: ${[...unmatched].slice(0, 12).join(', ')}` : ''}`);
    summary.push(`${code}:${stations.length}`);
  }
  // Coverage index for the site: which states have a station list, and why the others don't.
  const idxFile = path.join(OUT, 'index.json');
  let idx = {};
  try { idx = JSON.parse(await readFile(idxFile, 'utf8')).states || {}; } catch {}
  for (const code of Object.keys(A)) {
    try { const f = JSON.parse(await readFile(path.join(OUT, `${code}.json`), 'utf8')); idx[code] = { count: f.stations.length, source: f.source, sourceName: f.sourceName, generated: f.generated }; } catch {}
  }
  await writeFile(idxFile, JSON.stringify({ generated: new Date().toISOString(), states: idx, notAvailable: NOT_AVAILABLE }));
  log(`Done. ${summary.join(' ')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
