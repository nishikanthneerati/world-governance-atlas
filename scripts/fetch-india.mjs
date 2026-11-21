#!/usr/bin/env node
/**
 * India leadership directory: data pipeline.
 *  - Lok Sabha members: official Sansad API (sansad.in/api_ls/member)
 *  - Election affidavit data (assets, liabilities, criminal cases, education): MyNeta / ADR, Lok Sabha 2024 winners
 * Writes data/india/mps.json. Personal phone numbers and home addresses are deliberately not stored.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'india');
const UA = 'Mozilla/5.0 (compatible; WhoRunsIndia/1.0; public-records research)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = 'json', tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : 'text/html' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * 2 ** i);
    }
  }
}

const norm = (s) => String(s || '').toUpperCase().replace(/\((SC|ST)\)/g, '').replace(/[^A-Z]/g, '');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const text = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// Dice coefficient on letter bigrams: tolerant of spelling variants (Coochbehar / Cooch Behar).
const bigrams = (s) => { const t = norm(s); const out = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const m = new Map(); for (const x of A) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0; for (const x of B) if (m.get(x) > 0) { hit++; m.set(x, m.get(x) - 1); }
  return (2 * hit) / (A.length + B.length);
}
const rupees = (s) => { const m = String(s).match(/Rs\s*([\d,]+)/); return m ? +m[1].replace(/,/g, '') : null; };

async function sansadMembers() {
  log('Sansad: Lok Sabha members');
  const all = [];
  for (let page = 1; page < 20; page++) {
    const j = await get(`https://sansad.in/api_ls/member?loksabha=18&page=${page}&size=100&locale=en`);
    all.push(...j.membersDtoList);
    if (page >= j.metaDatasDto.totalPages) break;
    await sleep(500);
  }
  log(`  ${all.length} members`);
  return all;
}

async function mynetaWinners() {
  log('MyNeta: Lok Sabha 2024 affidavits');
  const html = await get('https://www.myneta.info/LokSabha2024/index.php?action=show_winners&sort=default', 'text');
  const rows = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    if (!tds || tds.length < 8) continue;
    const c = tds.map(text);
    if (!/^\d+$/.test(c[0])) continue;
    const id = tr.match(/candidate_id=(\d+)/)?.[1];
    rows.push({ name: c[1], constituency: c[2], party: c[3], criminalCases: +c[4] || 0, education: c[5], assets: rupees(c[6]), liabilities: rupees(c[7]), mynetaId: id ? +id : null });
  }
  log(`  ${rows.length} affidavits`);
  return rows;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const [members, affidavits] = await Promise.all([sansadMembers(), mynetaWinners()]);
  const byConst = new Map();
  for (const a of affidavits) byConst.set(norm(a.constituency), a);

  let matched = 0;
  const used = new Set();
  const pick = (m) => {
    const exact = byConst.get(norm(m.constName));
    if (exact) return exact;
    let best = null, score = 0;
    for (const a of affidavits) {
      if (used.has(a)) continue;
      const sc = dice(a.constituency, m.constName) * 0.6 + dice(a.name, m.mpFirstLastName) * 0.4;
      if (sc > score) { score = sc; best = a; }
    }
    return score >= 0.62 ? best : null;
  };
  for (const m of members) { const a = byConst.get(norm(m.constName)); if (a) used.add(a); }
  const mps = members.map((m) => {
    const a = pick(m);
    if (a) used.add(a);
    if (a) matched++;
    const official = (Array.isArray(m.email) ? m.email : []).find((e) => /sansad\.(nic\.)?in$|nic\.in$/.test(e)) || null;
    return {
      id: m.mpsno,
      name: m.mpFirstLastName?.trim(),
      title: m.initial?.trim() || '',
      gender: m.gender,
      age: m.age || null,
      dob: m.dob || null,
      party: m.partySname?.trim(),
      partyName: m.partyFname?.trim(),
      state: m.stateName,
      constituency: m.constName,
      reserved: /\((SC|ST)\)/.exec(a?.constituency || '')?.[1] || null,
      terms: m.noOfTerms || 1,
      profession: [m.profession, m.profession2].filter((x) => x && x.trim()).join(', '),
      qualification: m.qualification || a?.education || '',
      status: m.status,
      photo: m.imageUrl || null,
      email: official,
      affidavit: a ? { assets: a.assets, liabilities: a.liabilities, criminalCases: a.criminalCases, education: a.education, mynetaId: a.mynetaId } : null,
    };
  }).filter((m) => m.status === 'Sitting');
  log(`Joined: ${mps.length} sitting MPs, ${matched} matched to affidavits`);

  // Sansad sends photos with Cross-Origin-Resource-Policy: same-site, so browsers won't show them on
  // another site. Keep a local copy (downloaded once per MP).
  const PHOTOS = path.join(OUT, 'photos');
  await mkdir(PHOTOS, { recursive: true });
  let fetched = 0;
  for (const m of mps) {
    if (!m.photo) continue;
    const file = path.join(PHOTOS, `${m.id}.jpg`);
    if (!existsSync(file)) {
      try {
        const r = await fetch(m.photo, { headers: { 'User-Agent': UA } });
        const ct = r.headers.get('content-type') || '';
        if (r.ok && ct.startsWith('image/')) { await writeFile(file, Buffer.from(await r.arrayBuffer())); fetched++; }
        await sleep(150);
      } catch (e) { log(`  photo ${m.id} failed: ${e.message}`); }
    }
    m.photoSource = m.photo;
    m.photo = existsSync(file) ? `data/india/photos/${m.id}.jpg` : null;
  }
  log(`Photos: ${fetched} downloaded, ${mps.filter((m) => m.photo).length} available`);

  await writeFile(path.join(OUT, 'mps.json'), JSON.stringify({
    generated: new Date().toISOString(),
    house: '18th Lok Sabha',
    sources: {
      members: 'https://sansad.in/ls/members',
      affidavits: 'https://www.myneta.info/LokSabha2024/',
    },
    mps,
  }));
  log('Wrote data/india/mps.json');
}
main().catch((e) => { console.error(e); process.exit(1); });
