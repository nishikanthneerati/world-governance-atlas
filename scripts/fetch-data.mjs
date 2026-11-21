#!/usr/bin/env node
/**
 * World Governance Atlas — data pipeline.
 *
 * Pulls public data for every sovereign state and writes static JSON into /data:
 *   - Wikidata (SPARQL + entity API): countries, offices, every head of state /
 *     head of government with term dates, photos, parties, birth/death.
 *   - Wikipedia (extracts API): country summary + "History of <country>" text.
 *   - World Bank Open Data (+ Worldwide Governance Indicators): economy, crime,
 *     air quality, health, governance scores as yearly time series.
 *
 * Run: node scripts/fetch-data.mjs     (no dependencies, Node >= 20)
 * Scheduled daily by .github/workflows/update-data.yml.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
// Wikimedia asks bots for a descriptive User-Agent with contact info: set CONTACT=you@example.com or a repo URL.
const UA = `WorldGovernanceAtlas/1.0 (open public-data project${process.env.CONTACT ? '; ' + process.env.CONTACT : ''})`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // e.g. ONLY=IND,USA for quick tests

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(url, opts = {}, tries = 7) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } });
      if (res.status === 429 || res.status >= 500) {
        const ra = +res.headers.get('retry-after');
        const err = new Error(`HTTP ${res.status}`);
        err.wait = ra ? ra * 1000 + 500 : null;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      const wait = e.wait || 2000 * 2 ** i;
      log(`retry ${i + 1} in ${wait}ms: ${e.message}`);
      await sleep(wait);
    }
  }
}

async function sparql(query) {
  const body = new URLSearchParams({ query });
  const json = await getJSON('https://query.wikidata.org/sparql', {
    method: 'POST',
    body,
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const qid = (uri) => (uri ? uri.split('/').pop() : null);
// Wikidata times look like +1947-08-15T00:00:00Z, -0029-00-00T… (BCE) or +1885-00-00 (year precision).
const day = (iso) => {
  if (!iso) return null;
  const m = iso.match(/^([+-]?)(\d+)-(\d\d)-(\d\d)/);
  if (!m) return null;
  return `${m[1] === '-' ? '-' : ''}${m[2].slice(-4).padStart(4, '0')}-${m[3]}-${m[4]}`;
};
// Direct upload.wikimedia.org thumbnail URL (no redirect). Path uses the md5 of the file name.
// Widths are Wikimedia's standard thumbnail steps (330 for portraits/flags).
const commonsThumb = (file, w = 330) => {
  if (!file) return null;
  const name = decodeURIComponent(file.split('/').pop()).replace(/ /g, '_');
  const h = createHash('md5').update(name).digest('hex');
  const enc = encodeURIComponent(name);
  const suffix = /\.(svg|tiff?|pdf|webp)$/i.test(name) ? '.png' : '';
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${enc}/${w}px-${enc}${suffix}`;
};

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------------------------------------------------------------- countries
async function fetchCountries() {
  log('Wikidata: sovereign states');
  const rows = await sparql(`
    SELECT ?c ?iso2 ?iso3 ?inception ?hog ?hos ?gov ?flag ?cap ?coord ?site ?cont ?legis WHERE {
      ?c wdt:P31 wd:Q3624078; wdt:P297 ?iso2; wdt:P298 ?iso3.
      FILTER NOT EXISTS { ?c wdt:P31 wd:Q3024240 }
      OPTIONAL { ?c wdt:P571 ?inception }
      OPTIONAL { ?c wdt:P1313 ?hog }
      OPTIONAL { ?c wdt:P1906 ?hos }
      OPTIONAL { ?c wdt:P122 ?gov }
      OPTIONAL { ?c wdt:P41 ?flag }
      OPTIONAL { ?c wdt:P36 ?cap. OPTIONAL { ?cap wdt:P625 ?coord } }
      OPTIONAL { ?c wdt:P856 ?site }
      OPTIONAL { ?c wdt:P30 ?cont }
      OPTIONAL { ?c wdt:P194 ?legis }
    }`);
  const map = new Map();
  for (const r of rows) {
    const id = qid(r.c);
    if (!map.has(id)) {
      map.set(id, { id, iso2: r.iso2, iso3: r.iso3, inception: null, hogPos: new Set(), hosPos: new Set(), gov: new Set(), flag: null, capital: null, coord: null, site: null, continent: new Set(), legislature: new Set() });
    }
    const c = map.get(id);
    if (r.inception && (!c.inception || r.inception > c.inception)) c.inception = r.inception; // latest = modern state
    if (r.hog) c.hogPos.add(qid(r.hog));
    if (r.hos) c.hosPos.add(qid(r.hos));
    if (r.gov) c.gov.add(qid(r.gov));
    if (r.flag && !c.flag) c.flag = r.flag;
    if (r.cap && !c.capital) c.capital = qid(r.cap);
    if (r.coord && !c.coord) {
      const m = r.coord.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (m) c.coord = [+m[2], +m[1]];
    }
    if (r.site && !c.site) c.site = r.site;
    if (r.cont) c.continent.add(qid(r.cont));
    if (r.legis) c.legislature.add(qid(r.legis));
  }
  let list = [...map.values()];
  if (ONLY) list = list.filter((c) => ONLY.includes(c.iso3));
  log(`  ${list.length} countries`);
  return list;
}

// ---------------------------------------------------------------- office holders
async function fetchHolders(countries) {
  log('Wikidata: heads of state & government (all terms)');
  const positions = new Set(countries.flatMap((c) => [...c.hogPos, ...c.hosPos]));
  const rows = [];
  for (const part of chunk([...positions], 150)) {
    rows.push(
      ...(await sparql(`
      SELECT ?pos ?person ?start ?end ?st WHERE {
        VALUES ?pos { ${part.map((p) => 'wd:' + p).join(' ')} }
        ?person p:P39 ?st. ?st ps:P39 ?pos.
        OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
      }`))
    );
  }
  log(`  ${rows.length} terms of office`);
  return rows.map((r) => ({ pos: qid(r.pos), person: qid(r.person), start: day(r.start), end: day(r.end), st: r.st.split('/').pop() }));
}

// ---------------------------------------------------------------- entity details
const enLabel = (e) => e?.labels?.en?.value || e?.labels?.mul?.value || null;
const claim = (e, p) => e.claims?.[p]?.filter((s) => s.rank !== 'deprecated') ?? [];
const val = (s) => s?.mainsnak?.datavalue?.value;
const firstVal = (e, p) => {
  const cs = claim(e, p);
  const pref = cs.find((s) => s.rank === 'preferred') || cs[0];
  return val(pref);
};

async function fetchEntities(ids, props = 'labels|descriptions|claims|sitelinks/urls') {
  const out = {};
  const parts = chunk([...new Set(ids)].filter(Boolean), 50);
  let done = 0;
  await pool(parts, 2, async (part) => {
    await sleep(300);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en|mul&sitefilter=enwiki&props=${props}&ids=${part.join('|')}`;
    const json = await getJSON(url);
    Object.assign(out, json.entities || {});
    done++;
    if (done % 20 === 0) log(`  entities ${done}/${parts.length}`);
  });
  return out;
}

function personRecord(e, labels) {
  const time = (p) => day(firstVal(e, p)?.time);
  const fileName = firstVal(e, 'P18');
  const gender = firstVal(e, 'P21')?.id;
  const parties = claim(e, 'P102').map((s) => val(s)?.id).filter(Boolean);
  const edu = claim(e, 'P69').map((s) => val(s)?.id).filter(Boolean).slice(0, 4);
  const occ = claim(e, 'P106').map((s) => val(s)?.id).filter(Boolean).slice(0, 4);
  return {
    id: e.id,
    name: enLabel(e) || e.id,
    desc: e.descriptions?.en?.value || '',
    img: fileName ? commonsThumb(fileName, 330) : null,
    gender: gender === 'Q6581072' || gender === 'Q1052281' ? 'F' : gender === 'Q6581097' || gender === 'Q2449503' ? 'M' : null,
    born: time('P569'),
    died: time('P570'),
    birthplace: firstVal(e, 'P19')?.id || null,
    parties,
    education: edu,
    occupations: occ,
    wiki: e.sitelinks?.enwiki?.title || null,
    _labelIds: [gender, firstVal(e, 'P19')?.id, ...parties, ...edu, ...occ].filter(Boolean),
  };
}

// ---------------------------------------------------------------- wikipedia
async function fetchExtracts(titles) {
  const out = {};
  for (const part of chunk([...new Set(titles)].filter(Boolean), 20)) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&titles=${encodeURIComponent(part.join('|'))}`;
    const json = await getJSON(url);
    const redirects = Object.fromEntries([...(json.query?.normalized || []), ...(json.query?.redirects || [])].map((r) => [r.to, r.from]));
    for (const p of Object.values(json.query?.pages || {})) {
      if (!p.extract) continue;
      let t = p.title;
      out[t] = p.extract;
      while (redirects[t]) {
        t = redirects[t];
        out[t] = p.extract;
      }
    }
    await sleep(600);
  }
  return out;
}

async function fetchPageCards(titles) {
  // thumbnail + short description for curated entries; also validates titles
  const out = {};
  for (const part of chunk([...new Set(titles)].filter(Boolean), 40)) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|description&piprop=thumbnail&pithumbsize=240&pilimit=50&redirects=1&titles=${encodeURIComponent(part.join('|'))}`;
    const json = await getJSON(url);
    const back = {};
    for (const r of [...(json.query?.normalized || []), ...(json.query?.redirects || [])]) back[r.to] = [...(back[r.to] || []), r.from];
    for (const p of Object.values(json.query?.pages || {})) {
      const card = p.missing !== undefined ? null : { img: p.thumbnail?.source || null, desc: p.description || '' };
      const names = [p.title];
      for (let i = 0; i < names.length; i++) names.push(...(back[names[i]] || []));
      for (const n of names) out[n] = card;
    }
    await sleep(600);
  }
  for (const t of titles) if (!out[t]) log(`  WARNING: Wikipedia page not found for curated title "${t}"`);
  return out;
}

// ---------------------------------------------------------------- world bank
export const INDICATORS = [
  // id, key, label, unit, group, better ('high'|'low'|null), source
  ['SP.POP.TOTL', 'population', 'Population', 'people', 'Society', null],
  ['NY.GDP.MKTP.CD', 'gdp', 'GDP (current US$)', 'usd', 'Economy', 'high'],
  ['NY.GDP.PCAP.CD', 'gdpPerCapita', 'GDP per capita (US$)', 'usd', 'Economy', 'high'],
  ['NY.GDP.MKTP.KD.ZG', 'gdpGrowth', 'GDP growth (annual %)', 'pct', 'Economy', 'high'],
  ['FP.CPI.TOTL.ZG', 'inflation', 'Inflation (annual %)', 'pct', 'Economy', 'low'],
  ['SL.UEM.TOTL.ZS', 'unemployment', 'Unemployment (% of labour force)', 'pct', 'Economy', 'low'],
  ['GC.DOD.TOTL.GD.ZS', 'debt', 'Central government debt (% of GDP)', 'pct', 'Economy', 'low'],
  ['SI.POV.GINI', 'gini', 'Gini index (inequality)', 'index', 'Economy', 'low'],
  ['VC.IHR.PSRC.P5', 'homicide', 'Intentional homicides (per 100k)', 'rate', 'Crime & Safety', 'low'],
  ['VC.BTL.DETH', 'conflictDeaths', 'Battle-related deaths', 'people', 'Crime & Safety', 'low'],
  ['EN.ATM.PM25.MC.M3', 'pm25', 'PM2.5 air pollution (µg/m³)', 'ugm3', 'Environment', 'low'],
  ['EN.GHG.CO2.PC.CE.AR5', 'co2PerCapita', 'CO₂ emissions per capita (t)', 'tonnes', 'Environment', 'low'],
  ['AG.LND.FRST.ZS', 'forest', 'Forest area (% of land)', 'pct', 'Environment', 'high'],
  ['SP.DYN.LE00.IN', 'lifeExpectancy', 'Life expectancy (years)', 'years', 'Health & Education', 'high'],
  ['SP.DYN.IMRT.IN', 'infantMortality', 'Infant mortality (per 1,000 births)', 'rate', 'Health & Education', 'low'],
  ['SH.XPD.CHEX.GD.ZS', 'healthSpend', 'Health spending (% of GDP)', 'pct', 'Health & Education', 'high'],
  ['SE.ADT.LITR.ZS', 'literacy', 'Adult literacy rate (%)', 'pct', 'Health & Education', 'high'],
  ['SE.XPD.TOTL.GD.ZS', 'eduSpend', 'Education spending (% of GDP)', 'pct', 'Health & Education', 'high'],
  ['IT.NET.USER.ZS', 'internet', 'Internet users (% of population)', 'pct', 'Society', 'high'],
  ['SP.URB.TOTL.IN.ZS', 'urban', 'Urban population (%)', 'pct', 'Society', null],
  ['SG.GEN.PARL.ZS', 'womenParliament', 'Women in parliament (% of seats)', 'pct', 'Governance', 'high'],
  ['MS.MIL.XPND.GD.ZS', 'military', 'Military spending (% of GDP)', 'pct', 'Governance', null],
  ['GOV_WGI_CC.SC', 'corruptionControl', 'Control of Corruption (score 0–100)', 'score', 'Governance', 'high', 3],
  ['GOV_WGI_GE.SC', 'govEffectiveness', 'Government Effectiveness (score 0–100)', 'score', 'Governance', 'high', 3],
  ['GOV_WGI_RL.SC', 'ruleOfLaw', 'Rule of Law (score 0–100)', 'score', 'Governance', 'high', 3],
  ['GOV_WGI_VA.SC', 'voice', 'Voice & Accountability (score 0–100)', 'score', 'Governance', 'high', 3],
  ['GOV_WGI_PV.SC', 'stability', 'Political Stability & No Violence (score 0–100)', 'score', 'Governance', 'high', 3],
  ['GOV_WGI_RQ.SC', 'regulatoryQuality', 'Regulatory Quality (score 0–100)', 'score', 'Governance', 'high', 3],
].map(([id, key, label, unit, group, better, source]) => ({ id, key, label, unit, group, better, source: source || 2 }));

async function fetchIndicators(iso3s) {
  log('World Bank: indicators');
  const want = new Set(iso3s);
  const series = {}; // iso3 -> key -> [[year, value], ...]
  const meta = {};
  await pool(INDICATORS, 3, async (ind) => {
    try {
      const url = `https://api.worldbank.org/v2/country/all/indicator/${ind.id}?format=json&per_page=20000&date=1960:2030&source=${ind.source}`;
      const json = await getJSON(url);
      meta[ind.key] = { lastUpdated: json[0]?.lastupdated || null };
      for (const r of json[1] || []) {
        if (r.value == null || !want.has(r.countryiso3code)) continue;
        ((series[r.countryiso3code] ??= {})[ind.key] ??= []).push([+r.date, +(+r.value).toPrecision(6)]);
      }
      log(`  ${ind.id} ok`);
    } catch (e) {
      log(`  ${ind.id} FAILED: ${e.message}`);
    }
  });
  for (const c of Object.values(series)) for (const k in c) c[k].sort((a, b) => a[0] - b[0]);
  return { series, meta };
}

// ---------------------------------------------------------------- build
function overlaps(t) {
  return t.start || t.end;
}

async function main() {
  await mkdir(path.join(OUT, 'countries'), { recursive: true });
  const curated = existsSync(path.join(ROOT, 'curated', 'firsts.json'))
    ? JSON.parse(await readFile(path.join(ROOT, 'curated', 'firsts.json'), 'utf8'))
    : {};

  const countries = await fetchCountries();
  const holders = await fetchHolders(countries);

  // entity details for countries, positions, people
  const personIds = [...new Set(holders.map((h) => h.person))];
  const posIds = [...new Set(countries.flatMap((c) => [...c.hogPos, ...c.hosPos]))];
  log(`Wikidata: ${countries.length} countries, ${posIds.length} offices, ${personIds.length} people`);
  const ents = await fetchEntities([...countries.map((c) => c.id), ...posIds, ...personIds]);

  const people = {};
  const labelIds = new Set();
  for (const id of personIds) {
    if (!ents[id]) continue;
    const p = personRecord(ents[id], null);
    p._labelIds.forEach((x) => labelIds.add(x));
    people[id] = p;
  }
  for (const c of countries) {
    [...c.gov, ...c.continent, ...c.legislature, c.capital].forEach((x) => x && labelIds.add(x));
  }
  log(`Wikidata: ${labelIds.size} labels`);
  const labelEnts = await fetchEntities([...labelIds], 'labels');
  const L = (id) => enLabel(labelEnts[id]) || enLabel(ents[id]);
  for (const p of Object.values(people)) {
    p.birthplace = L(p.birthplace);
    p.parties = p.parties.map(L).filter(Boolean);
    p.education = p.education.map(L).filter(Boolean);
    p.occupations = p.occupations.map(L).filter(Boolean);
    delete p._labelIds;
  }

  // wikipedia text
  const names = countries.map((c) => ents[c.id]?.sitelinks?.enwiki?.title).filter(Boolean);
  log('Wikipedia: country summaries + histories');
  const extracts = await fetchExtracts([...names, ...names.map((n) => `History of ${n.replace(/^The /, 'the ')}`)]);

  const curatedTitles = Object.entries(curated)
    .filter(([k]) => !k.startsWith('_') && countries.some((c) => c.iso3 === k))
    .flatMap(([, v]) => [...(v.firsts || []), ...(v.milestones || [])].map((x) => x.wiki));
  log(`Wikipedia: ${curatedTitles.length} curated entries`);
  const cards = await fetchPageCards(curatedTitles);
  for (const [k, v] of Object.entries(curated)) {
    if (k.startsWith('_')) continue;
    for (const x of [...(v.firsts || []), ...(v.milestones || [])]) Object.assign(x, cards[x.wiki] || {});
  }

  const { series, meta } = await fetchIndicators(countries.map((c) => c.iso3));

  const index = [];
  const peopleIndex = {};
  for (const c of countries) {
    const e = ents[c.id] || {};
    const name = enLabel(e) || c.iso3;
    const wiki = e.sitelinks?.enwiki?.title || name;
    const offices = (role, set) =>
      [...set].map((pos) => ({ id: pos, role, title: enLabel(ents[pos]) || pos }));
    const officeList = [...offices('hog', c.hogPos), ...offices('hos', c.hosPos)];
    const roleOf = (pos) => officeList.filter((o) => o.id === pos).map((o) => o.role);

    // terms
    const terms = holders
      .filter((h) => officeList.some((o) => o.id === h.pos) && people[h.person] && overlaps(h))
      .map((h) => ({ office: h.pos, roles: roleOf(h.pos), person: h.person, start: h.start, end: h.end }));
    // de-dup identical terms (multiple statements)
    const seen = new Set();
    const uniq = terms.filter((t) => {
      const k = `${t.office}|${t.person}|${t.start}|${t.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => (a.start || a.end || '').localeCompare(b.start || b.end || ''));

    const usedPeople = {};
    for (const t of uniq) {
      usedPeople[t.person] = people[t.person];
      (peopleIndex[t.person] ??= { n: people[t.person].name, c: [] }).c.includes(c.iso3) || peopleIndex[t.person].c.push(c.iso3);
    }

    const today = new Date().toISOString().slice(0, 10);
    const current = (role) => {
      const live = uniq.filter((t) => t.roles.includes(role) && !t.end && t.start && t.start <= today);
      live.sort((a, b) => b.start.localeCompare(a.start));
      return live[0]?.person || null;
    };

    const s = series[c.iso3] || {};
    const latest = Object.fromEntries(Object.entries(s).map(([k, arr]) => [k, arr[arr.length - 1]]));

    const record = {
      id: c.id,
      iso2: c.iso2,
      iso3: c.iso3,
      name,
      wiki,
      description: e.descriptions?.en?.value || '',
      flag: c.flag ? commonsThumb(c.flag, 330) : null,
      capital: L(c.capital),
      capitalCoord: c.coord,
      inception: day(c.inception),
      government: [...c.gov].map(L).filter(Boolean),
      legislature: [...c.legislature].map(L).filter(Boolean),
      continent: [...c.continent].map(L).filter(Boolean),
      website: c.site,
      offices: officeList,
      currentHog: current('hog'),
      currentHos: current('hos'),
      terms: uniq,
      people: usedPeople,
      summary: extracts[wiki] || '',
      history: extracts[`History of ${wiki.replace(/^The /, 'the ')}`] || '',
      historyTitle: `History of ${wiki.replace(/^The /, 'the ')}`,
      curated: curated[c.iso3] || null,
      indicators: s,
      updated: new Date().toISOString(),
    };
    await writeFile(path.join(OUT, 'countries', `${c.iso3}.json`), JSON.stringify(record));

    const cur = (pid) => (pid ? { id: pid, name: people[pid]?.name, img: people[pid]?.img } : null);
    index.push({
      iso2: c.iso2, iso3: c.iso3, name, flag: record.flag, capital: record.capital, continent: record.continent,
      government: record.government, inception: record.inception,
      hog: cur(record.currentHog), hos: cur(record.currentHos),
      hogTitle: officeList.find((o) => o.role === 'hog')?.title || null,
      hosTitle: officeList.find((o) => o.role === 'hos')?.title || null,
      leaders: new Set(uniq.map((t) => t.person)).size,
      latest,
    });
  }

  index.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(
    path.join(OUT, 'index.json'),
    JSON.stringify({ generated: new Date().toISOString(), indicators: INDICATORS.map(({ id, key, label, unit, group, better }) => ({ id, key, label, unit, group, better, ...meta[key] })), countries: index })
  );
  await writeFile(path.join(OUT, 'people.json'), JSON.stringify(peopleIndex));
  log(`Done: ${index.length} countries, ${Object.keys(peopleIndex).length} leaders`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
