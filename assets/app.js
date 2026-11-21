import { lineChart, sparkline } from './charts.js';

/* ================================================================== utilities */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const TODAY = new Date().toISOString().slice(0, 10);
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

const state = { index: null, people: null, countries: new Map(), byIso: new Map(), ind: new Map() };

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function loadIndex() {
  if (state.index) return state.index;
  state.index = await getJSON('data/index.json');
  for (const c of state.index.countries) state.byIso.set(c.iso3, c);
  for (const i of state.index.indicators) state.ind.set(i.key, i);
  $('#updated').textContent = `Data rebuilt ${fmtDate(state.index.generated.slice(0, 10))}. Leader profiles and air quality load live.`;
  return state.index;
}
async function loadPeople() {
  if (!state.people) state.people = await getJSON('data/people.json');
  return state.people;
}
async function loadCountry(iso3) {
  if (!state.countries.has(iso3)) state.countries.set(iso3, getJSON(`data/countries/${iso3}.json`));
  return state.countries.get(iso3);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseD(d) {
  const m = String(d || '').match(/^(-?)(\d+)(?:-(\d\d?))?(?:-(\d\d?))?/);
  if (!m) return null;
  return { y: (m[1] ? -1 : 1) * +m[2], m: +(m[3] || 0), d: +(m[4] || 0) };
}
function fmtDate(d) {
  const p = parseD(d);
  if (!p) return '';
  const y = p.y < 0 ? `${-p.y} BCE` : `${p.y}`;
  if (!p.m) return y;
  if (!p.d) return `${MONTHS[p.m - 1]} ${y}`;
  return `${p.d} ${MONTHS[p.m - 1]} ${y}`;
}
function toTime(d) {
  const p = parseD(d);
  if (!p) return NaN;
  const t = new Date(Date.UTC(2000, Math.max(1, p.m) - 1, Math.max(1, p.d)));
  t.setUTCFullYear(p.y);
  return t.getTime();
}
const year = (d) => { const p = parseD(d); return p ? (p.y < 0 ? `${-p.y} BCE` : `${p.y}`) : ''; };
function daysBetween(a, b) { return (toTime(b) - toTime(a)) / 864e5; }
function fmtDuration(days) {
  if (days == null || isNaN(days) || days < 0) return '';
  if (days < 60) return `${Math.max(1, Math.round(days))} days`;
  const total = Math.round(days / 30.4375);
  const y = Math.floor(total / 12);
  const mo = total % 12;
  if (!y) return `${mo} mo`;
  return mo ? `${y} yr ${mo} mo` : `${y} yr`;
}
function age(born, at) {
  if (!born || !at) return null;
  return Math.floor(daysBetween(born, at) / 365.25);
}
export function fmtValue(v, unit) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const short = (n) => (abs >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : abs >= 1e9 ? `${(n / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}B` : abs >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(n / 1e3).toFixed(0)}K` : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));
  switch (unit) {
    case 'usd': return `$${short(v)}`;
    case 'people': return short(v);
    case 'pct': return `${v.toFixed(abs < 10 ? 1 : 0)}%`;
    case 'ugm3': return `${v.toFixed(1)} µg/m³`;
    case 'years': return `${v.toFixed(1)} yrs`;
    case 'tonnes': return `${v.toFixed(2)} t`;
    case 'score': return `${v.toFixed(0)}/100`;
    case 'rate': return v.toFixed(abs < 10 ? 2 : 1);
    default: return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
}
const tickFmt = (unit) => (v) => (unit === 'usd' || unit === 'people' ? fmtValue(v, unit) : unit === 'pct' ? `${+v.toFixed(1)}%` : (+v.toFixed(2)).toLocaleString());

function initials(name) {
  return esc((name || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');
}
function avatar(p, cls = '') {
  const name = p?.name || '';
  if (p?.img) return `<img class="avatar ${cls}" src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;avatar ${cls}&quot;>${initials(name)}</span>'">`;
  return `<span class="avatar ${cls}">${initials(name)}</span>`;
}
const flag = (c, cls = '') => (c?.flag ? `<img class="flag ${cls}" src="${esc(c.flag)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0">` : `<span class="flag ${cls}"></span>`);
const wikiUrl = (t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(String(t).replace(/ /g, '_'))}`;
const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

// Views are plain hash names (letters, digits, hyphens) so links work inside Claude artifacts too:
// #country-IND-leaders, #leader-Q1047, #compare-IND-CHN-USA-pm25, #rankings-pm25-IND
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split(/[-/]/).filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'home') parts.shift();
  return { parts };
}
function setHash(name) {
  try { history.replaceState(null, '', `#${name}`); } catch (e) {}
}
const isIso = (x) => /^[A-Z]{3}$/.test(x);
const uiState = { countries: { q: '', continent: '', sort: 'name' } };

/* rank helpers */
function rankOf(iso3, key) {
  const ind = state.ind.get(key);
  const vals = state.index.countries.filter((c) => c.latest[key]).map((c) => [c.iso3, c.latest[key][1]]);
  vals.sort((a, b) => (ind?.better === 'low' ? a[1] - b[1] : b[1] - a[1]));
  const i = vals.findIndex((v) => v[0] === iso3);
  return i < 0 ? null : { rank: i + 1, of: vals.length };
}

/* ================================================================== router */
const routes = { '': home, countries, country, leader, compare, rankings, sources: about, about };
async function router() {
  const { parts } = parseHash();
  const view = routes[parts[0] || ''] || notFound;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === parts[0] || (parts[0] === 'country' && a.dataset.nav === 'countries')));
  try {
    await loadIndex();
    await view(parts.slice(1));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty">Couldn't load this page. ${esc(e.message)}</div>`;
  }
  if (!router.keepScroll) window.scrollTo(0, 0);
  router.keepScroll = false;
}
window.addEventListener('hashchange', router);

function notFound() {
  app.innerHTML = `<div class="empty"><h2>Page not found</h2><p><a href="#home">Back to the atlas</a></p></div>`;
}

/* ================================================================== home */
async function home() {
  const idx = state.index;
  const totalLeaders = idx.countries.reduce((s, c) => s + c.leaders, 0);
  const people = await loadPeople().catch(() => ({}));
  const uniqueLeaders = Object.keys(people).length || totalLeaders;
  const big = [...idx.countries].filter((c) => c.latest.population).sort((a, b) => b.latest.population[1] - a.latest.population[1]).slice(0, 12);
  document.title = 'World Governance Atlas — leaders, history and public data of every country';

  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Open public data · ${idx.countries.length} sovereign states</div>
        <h1>Who has governed the world, <em>and how it's going.</em></h1>
        <p class="lede">Every head of state and government since each country's founding, with history, firsts and public indicators: governance, crime, air quality, economy and health. You can compare any country with any other.</p>
        <div class="hero-actions">
          <a class="btn primary" href="#country-IND">Start with India →</a>
          <a class="btn" href="#compare-IND-CHN-USA">Compare countries</a>
          <a class="btn" href="#rankings-pm25">Air quality ranking</a>
        </div>
      </div>
      <div class="hero-stats">
        <div class="stat"><div class="v">${idx.countries.length}</div><div class="l">countries covered</div></div>
        <div class="stat"><div class="v">${uniqueLeaders.toLocaleString()}</div><div class="l">heads of state & government</div></div>
        <div class="stat"><div class="v">${idx.indicators.length}</div><div class="l">public indicators per country</div></div>
        <div class="stat"><div class="v">Daily</div><div class="l">automatic refresh from official open data</div></div>
      </div>
    </section>

    <section class="section card" id="feature">
      <div class="feature">
        <div class="feature-intro">
          <div class="eyebrow">Featured · India since 1947</div>
          <h2>Prime Ministers of India</h2>
          <p class="muted">From Jawaharlal Nehru on Independence Day 1947 to the present, with every term, tenure and party.</p>
          <a class="btn" href="#country-IND-leaders">Full timeline</a>
          <a class="btn" href="#country-IND-firsts" style="margin-top:8px">India's firsts</a>
        </div>
        <div class="strip" id="india-strip"><div class="skeleton" style="height:150px;flex:1"></div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Leaders of the most populous countries</h2><p>Current heads of government, from Wikidata</p></div>
      <div class="grid g4">${big.map((c) => leaderCard(c)).join('')}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>At a glance</h2><a href="#rankings">All rankings →</a></div>
      <div class="grid g3">
        ${miniRank('pm25', 'Most polluted air', 'desc')}
        ${miniRank('homicide', 'Highest homicide rate', 'desc')}
        ${miniRank('corruptionControl', 'Best control of corruption', 'best')}
        ${miniRank('womenParliament', 'Most women in parliament', 'desc')}
        ${miniRank('lifeExpectancy', 'Longest life expectancy', 'desc')}
        ${miniRank('gdp', 'Largest economies', 'desc')}
      </div>
    </section>`;

  const ind = await loadCountry('IND').catch(() => null);
  if (ind) {
    const pms = ind.terms.filter((t) => t.roles.includes('hog'));
    $('#india-strip').innerHTML = pms.map((t, i) => {
      const p = ind.people[t.person];
      return `<a class="strip-item" href="#leader-${t.person}">${avatar(p)}<div class="no">#${i + 1}</div><div class="n">${esc(p.name)}</div><div class="y">${year(t.start)}–${t.end ? year(t.end) : 'now'}</div></a>`;
    }).join('');
    const strip = $('#india-strip');
    strip.scrollLeft = strip.scrollWidth;
  }
}

function leaderCard(c) {
  const p = c.hog || c.hos;
  if (!p) return '';
  return `<a class="leader-card" href="#leader-${p.id}">${avatar(p)}<div><div class="t">${esc(c.hog ? c.hogTitle : c.hosTitle)}</div><div class="n">${esc(p.name)}</div><div class="c">${flag(c)}${esc(c.name)}</div></div></a>`;
}

function miniRank(key, title, dir) {
  const ind = state.ind.get(key);
  if (!ind) return '';
  let rows = state.index.countries.filter((c) => c.latest[key]);
  const desc = dir === 'desc' || (dir === 'best' && ind.better !== 'low');
  rows.sort((a, b) => (desc ? b.latest[key][1] - a.latest[key][1] : a.latest[key][1] - b.latest[key][1]));
  rows = rows.slice(0, 5);
  return `<div class="card rank-card"><h3>${esc(title)}</h3><div class="sub">${esc(ind.label)}</div>
    <ol class="mini-rank">${rows.map((c, i) => `<li><span class="r">${i + 1}</span>${flag(c)}<a href="#country-${c.iso3}">${esc(c.name)}</a><span class="num">${fmtValue(c.latest[key][1], ind.unit)}</span></li>`).join('')}</ol>
    <a class="note" href="#rankings-${key}">See all ${state.index.countries.filter((c) => c.latest[key]).length} →</a></div>`;
}

/* ================================================================== countries */
async function countries() {
  document.title = 'Countries — World Governance Atlas';
  const conts = [...new Set(state.index.countries.flatMap((c) => c.continent))].filter(Boolean).sort();
  const { continent: cont, sort, q } = uiState.countries;
  app.innerHTML = `
    <div class="section-head"><div><h1>Countries</h1><p class="muted" style="margin-top:6px">${state.index.countries.length} sovereign states with their current leaders and key numbers.</p></div></div>
    <div class="toolbar">
      <input class="input" id="cq" placeholder="Filter by name or capital" value="${esc(q)}" style="flex:1 1 220px">
      <select id="cc" aria-label="Continent"><option value="">All continents</option>${conts.map((c) => `<option ${c === cont ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="cs" aria-label="Sort by">
        ${[['name', 'Name A–Z'], ['population', 'Population'], ['gdp', 'GDP'], ['gdpPerCapita', 'GDP per capita'], ['inception', 'Founded (oldest)'], ['leaders', 'Most leaders']].map(([k, l]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="grid g4" id="clist"></div>`;
  const draw = () => {
    const qv = $('#cq').value.trim().toLowerCase();
    const cv = $('#cc').value;
    const sv = $('#cs').value;
    uiState.countries = { q: qv, continent: cv, sort: sv };
    let list = state.index.countries.filter((c) => (!cv || c.continent.includes(cv)) && (!qv || c.name.toLowerCase().includes(qv) || (c.capital || '').toLowerCase().includes(qv)));
    const v = (c) => (sv === 'leaders' ? c.leaders : sv === 'inception' ? -(parseD(c.inception)?.y ?? 9999) : c.latest[sv]?.[1] ?? -Infinity);
    if (sv !== 'name') list = [...list].sort((a, b) => v(b) - v(a));
    $('#clist').innerHTML = list.map(countryCard).join('') || '<div class="empty">No matching countries</div>';
  };
  $('#cq').addEventListener('input', draw);
  $('#cc').addEventListener('change', draw);
  $('#cs').addEventListener('change', draw);
  draw();
}

function countryCard(c) {
  const person = (p, role) => (p ? `<div class="person">${avatar(p)}<div><span class="role">${esc(role || '')}</span>${esc(p.name)}</div></div>` : '');
  const same = c.hog && c.hos && c.hog.id === c.hos.id;
  return `<a class="country-card" href="#country-${c.iso3}">
    <div class="top">${flag(c)}<div><div class="name">${esc(c.name)}</div><div class="cap">${esc(c.capital || '')}${c.inception ? ` · since ${year(c.inception)}` : ''}</div></div></div>
    <div class="people">${person(c.hog, c.hogTitle)}${same ? '' : person(c.hos, c.hosTitle)}</div>
    <div class="kv"><span><b>${fmtValue(c.latest.population?.[1], 'people')}</b>people</span><span><b>${fmtValue(c.latest.gdp?.[1], 'usd')}</b>GDP</span><span><b>${c.leaders}</b>leaders</span></div>
  </a>`;
}

/* ================================================================== country */
async function country([iso3, tab = 'overview']) {
  iso3 = (iso3 || '').toUpperCase();
  const meta = state.byIso.get(iso3);
  if (!meta) return notFound();
  app.innerHTML = `<div class="loading">Loading ${esc(meta.name)}…</div>`;
  const c = await loadCountry(iso3);
  document.title = `${c.name} — leaders, history & data · World Governance Atlas`;
  const tabs = [['overview', 'Overview'], ['leaders', 'Leaders'], ['firsts', 'Firsts'], ['history', 'History'], ['data', 'Data & trends']];
  app.innerHTML = `
    <div class="crumbs"><a href="#countries">Countries</a> / ${esc(c.continent.join(', '))}</div>
    <div class="country-head">
      ${flag(c, 'lg')}
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="meta">
          ${c.capital ? `<span class="pill">Capital · ${esc(c.capital)}</span>` : ''}
          ${c.inception ? `<span class="pill accent">Modern state since ${fmtDate(c.inception)}</span>` : ''}
          ${c.government.slice(0, 2).map((g) => `<span class="pill">${esc(g)}</span>`).join('')}
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="#compare-${c.iso3}${c.iso3 === 'IND' ? '-CHN-USA' : '-IND'}">Compare</a>
        ${c.website ? `<a class="btn" href="${esc(c.website)}" target="_blank" rel="noopener">Official portal ↗</a>` : ''}
      </div>
    </div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#country-${c.iso3}-${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  const el = $('#tab');
  ({ overview: countryOverview, leaders: countryLeaders, firsts: countryFirsts, history: countryHistory, data: countryData }[tab] || countryOverview)(c, el);
}

function paragraphs(text, max = 3) {
  return text.split(/\n+/).filter((p) => p.trim().length > 40).slice(0, max).map((p) => `<p>${esc(p)}</p>`).join('');
}

const KEY_TILES = ['population', 'gdp', 'gdpPerCapita', 'gdpGrowth', 'lifeExpectancy', 'literacy', 'homicide', 'pm25', 'corruptionControl', 'ruleOfLaw', 'unemployment', 'womenParliament'];

function tiles(c, keys) {
  return keys.map((k) => {
    const ind = state.ind.get(k);
    const s = c.indicators[k];
    if (!ind || !s?.length) return '';
    const [yr, v] = s[s.length - 1];
    const r = rankOf(c.iso3, k);
    return `<a class="tile" href="#rankings-${k}-${c.iso3}" style="color:inherit;text-decoration:none">
      <span class="l">${esc(ind.label)}</span>
      <span class="v">${fmtValue(v, ind.unit)}</span>
      <span class="f"><span>${yr}${r ? ` · #${r.rank} of ${r.of}` : ''}</span>${sparkline(s)}</span>
    </a>`;
  }).join('');
}

function countryOverview(c, el) {
  const hog = c.currentHog && c.people[c.currentHog];
  const hos = c.currentHos && c.people[c.currentHos];
  const office = (role) => c.offices.find((o) => o.role === role)?.title || '';
  const termOf = (pid, role) => c.terms.filter((t) => t.person === pid && t.roles.includes(role) && !t.end).pop();
  const nowCard = (p, role) => {
    if (!p) return '';
    const t = termOf(p.id, role);
    return `<a class="now-card" href="#leader-${p.id}">${avatar(p, 'lg')}<div><div class="t">${esc(office(role))}</div><div class="n">${esc(p.name)}</div><div class="s">${t?.start ? `Since ${fmtDate(t.start)} · ${fmtDuration(daysBetween(t.start, TODAY))}` : ''}</div><div class="s">${esc(p.parties[0] || '')}</div></div></a>`;
  };
  el.innerHTML = `
    <div class="overview">
      <div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-bottom:20px">
          ${nowCard(hog, 'hog')}${hos && hos.id !== hog?.id ? nowCard(hos, 'hos') : ''}
        </div>
        <div class="prose">${paragraphs(c.summary, 3) || '<p class="muted">No summary available.</p>'}</div>
        <p class="src">Summary from ${ext(wikiUrl(c.wiki), 'Wikipedia')} (CC BY-SA).</p>
        <div class="section-head" style="margin-top:28px"><h2>Key numbers</h2><a href="#country-${c.iso3}-data">All ${Object.keys(c.indicators).length} indicators →</a></div>
        <div class="tiles">${tiles(c, KEY_TILES)}</div>
      </div>
      <aside class="grid">
        <div class="card" id="aqi"><div class="eyebrow">Live air quality · ${esc(c.capital || '')}</div><div class="skeleton" style="height:120px;margin-top:12px"></div></div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:8px">Facts</div>
          <dl class="facts">
            ${fact('Capital', c.capital)}
            ${fact('Founded', c.inception && fmtDate(c.inception))}
            ${fact('Government', c.government.join(', '))}
            ${fact('Legislature', c.legislature.join(', '))}
            ${fact('Head of govt.', office('hog'))}
            ${fact('Head of state', office('hos'))}
            ${fact('Leaders on record', `${new Set(c.terms.map((t) => t.person)).size}`)}
            ${fact('Continent', c.continent.join(', '))}
            ${c.website ? `<div><dt>Official site</dt><dd>${ext(c.website, c.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</dd></div>` : ''}
          </dl>
        </div>
      </aside>
    </div>`;
  liveAQI(c, $('#aqi'));
}
const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '');

/* live air quality via Open-Meteo (no key, CORS enabled) */
const AQI_BANDS = [
  [50, 'Good', 'var(--good)', '●'],
  [100, 'Moderate', 'var(--warning)', '▲'],
  [150, 'Unhealthy for sensitive groups', 'var(--serious)', '▲'],
  [200, 'Unhealthy', 'var(--critical)', '■'],
  [300, 'Very unhealthy', '#8f3f97', '■'],
  [Infinity, 'Hazardous', '#7e0023', '■'],
];
async function liveAQI(c, el) {
  if (!c.capitalCoord) { el.innerHTML = '<div class="eyebrow">Live air quality</div><p class="muted">No capital coordinates available.</p>'; return; }
  const [lat, lon] = c.capitalCoord;
  try {
    const d = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&timezone=auto`);
    const cur = d.current;
    const aqi = Math.round(cur.us_aqi);
    const [, label, color, icon] = AQI_BANDS.find((b) => aqi <= b[0]);
    const annual = c.indicators.pm25?.slice(-1)[0];
    el.innerHTML = `<div class="eyebrow"><span class="live-dot"></span>&nbsp; Live air quality · ${esc(c.capital)}</div>
      <div class="aqi" style="margin-top:12px">
        <div class="aqi-top"><div class="aqi-badge" style="background:${color}">${aqi}</div>
          <div><div class="aqi-cat"><span aria-hidden="true">${icon}</span>${esc(label)}</div><div class="note">US AQI · updated ${esc(cur.time.replace('T', ' '))} local</div></div></div>
        <div class="aqi-grid">
          <div><b>${cur.pm2_5?.toFixed(0)}</b><span>PM2.5</span></div><div><b>${cur.pm10?.toFixed(0)}</b><span>PM10</span></div>
          <div><b>${cur.nitrogen_dioxide?.toFixed(0)}</b><span>NO₂</span></div><div><b>${cur.ozone?.toFixed(0)}</b><span>O₃</span></div>
        </div>
        ${annual ? `<div class="note">National annual mean PM2.5 exposure: <b>${annual[1].toFixed(1)} µg/m³</b> (${annual[0]}, World Bank). The WHO guideline is 5 µg/m³.</div>` : ''}
        <div class="src">Model data from ${ext('https://open-meteo.com/en/docs/air-quality-api', 'Open-Meteo / CAMS')}, in µg/m³.</div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="eyebrow">Live air quality</div><p class="muted">Live feed unavailable right now.</p>`;
  }
}

/* ---------------------------------------------------------------- leaders tab */
function countryLeaders(c, el) {
  const roles = [...new Set(c.offices.map((o) => o.role))];
  const hasBoth = roles.length > 1 && c.offices.find((o) => o.role === 'hog')?.id !== c.offices.find((o) => o.role === 'hos')?.id;
  let role = roles.includes('hog') ? 'hog' : roles[0];
  let order = 'asc';
  const draw = () => {
    const off = c.offices.filter((o) => o.role === role);
    const terms = c.terms.filter((t) => t.roles.includes(role) && t.start);
    if (!terms.length) { $('#lt').innerHTML = '<div class="empty">No term records on Wikidata for this office yet.</div>'; return; }
    // party palette: top 4 parties by total tenure, rest grey
    const tenureBy = {};
    for (const t of terms) {
      const party = c.people[t.person].parties[0] || 'Independent / none listed';
      tenureBy[party] = (tenureBy[party] || 0) + daysBetween(t.start, t.end || TODAY);
    }
    const top = Object.entries(tenureBy).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
    const colorOf = (party) => (top.includes(party) ? SERIES[top.indexOf(party)] : 'var(--series-other)');
    const t0 = terms[0].start, span = daysBetween(t0, TODAY);
    const era = terms.map((t) => {
      const p = c.people[t.person];
      const party = p.parties[0] || 'Independent / none listed';
      const l = (daysBetween(t0, t.start) / span) * 100, w = Math.max(0.25, (daysBetween(t.start, t.end || TODAY) / span) * 100);
      return `<span tabindex="0" style="left:${l}%;width:${w}%;background:${colorOf(party)}" title="${esc(`${p.name} · ${year(t.start)}–${t.end ? year(t.end) : 'present'} · ${party}`)}" data-id="${t.person}"></span>`;
    }).join('');
    const list = order === 'asc' ? terms : [...terms].reverse();
    const numbers = new Map();
    let n = 0;
    for (const t of terms) if (!numbers.has(t.person)) numbers.set(t.person, ++n);
    $('#lt').innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="section-head" style="margin-bottom:4px"><h3>${esc(off.map((o) => o.title).join(' / '))} · ${terms.length} terms, ${numbers.size} people</h3><span class="note">Hover a block for details</span></div>
        <div class="era" role="list" aria-label="Tenure timeline">${era}</div>
        <div class="era-axis"><span>${year(t0)}</span><span>${fmtDate(String(Math.round((parseD(t0).y + parseD(TODAY).y) / 2)))}</span><span>Today</span></div>
        <div class="legend">${top.map((p, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(p)}</span>`).join('')}${Object.keys(tenureBy).length > top.length ? '<span><i style="background:var(--series-other)"></i>Other parties</span>' : ''}</div>
      </div>
      <ol class="timeline">${list.map((t) => {
        const p = c.people[t.person];
        const d = daysBetween(t.start, t.end || TODAY);
        const a = age(p.born, t.start);
        return `<li class="${!t.end ? 'current' : ''}">
          <a href="#leader-${p.id}">${avatar(p)}</a>
          <div class="body"><div class="no">#${numbers.get(t.person)} · ${esc(c.offices.find((o) => o.id === t.office)?.title || '')}</div>
            <a class="nm" href="#leader-${p.id}">${esc(p.name)}</a>
            <div class="sub">${esc([p.parties[0], a ? `took office aged ${a}` : null].filter(Boolean).join(' · '))}</div></div>
          <div class="dur"><b>${fmtDuration(d)}</b>${fmtDate(t.start)} – ${t.end ? fmtDate(t.end) : 'present'}</div>
        </li>`;
      }).join('')}</ol>
      <p class="src">Terms from ${ext(`https://www.wikidata.org/wiki/${off[0]?.id}`, 'Wikidata')}. Acting and caretaker terms are included where Wikidata records them.</p>`;
    $$('.era span').forEach((s) => s.addEventListener('click', () => (location.hash = `#leader-${s.dataset.id}`)));
  };
  el.innerHTML = `<div class="toolbar">
      ${hasBoth ? `<div class="seg" id="role"><button data-r="hog" class="${role === 'hog' ? 'on' : ''}">Head of government</button><button data-r="hos" class="${role === 'hos' ? 'on' : ''}">Head of state</button></div>` : ''}
      <div class="seg" id="ord"><button data-o="asc" class="on">Oldest first</button><button data-o="desc">Newest first</button></div>
    </div><div id="lt"></div>`;
  $$('#role button').forEach((b) => b.addEventListener('click', () => { role = b.dataset.r; $$('#role button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $$('#ord button').forEach((b) => b.addEventListener('click', () => { order = b.dataset.o; $$('#ord button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
}

/* ---------------------------------------------------------------- firsts tab */
function autoFirsts(c) {
  const out = [];
  for (const o of c.offices) {
    if (out.some((x) => x.office === o.id)) continue;
    const terms = c.terms.filter((t) => t.office === o.id && t.start);
    if (!terms.length) continue;
    const P = (id) => c.people[id];
    const add = (title, t, extra) => out.push({ office: o.id, title, p: P(t.person), date: t.start, extra });
    add(`First ${o.title}`, terms[0]);
    const woman = terms.find((t) => P(t.person).gender === 'F');
    if (woman) add(`First woman ${o.title}`, woman);
    const tenure = {};
    for (const t of terms) tenure[t.person] = (tenure[t.person] || 0) + daysBetween(t.start, t.end || TODAY);
    const longest = Object.entries(tenure).sort((a, b) => b[1] - a[1])[0];
    if (longest) out.push({ office: o.id, title: `Longest-serving ${o.title}`, p: P(longest[0]), extra: `${fmtDuration(longest[1])} in total` });
    const aged = terms.map((t) => ({ t, a: age(P(t.person).born, t.start) })).filter((x) => x.a != null && x.a > 15);
    if (aged.length > 2) {
      const y = aged.reduce((m, x) => (x.a < m.a ? x : m));
      const ol = aged.reduce((m, x) => (x.a > m.a ? x : m));
      add(`Youngest to take office`, y.t, `aged ${y.a}`);
      add(`Oldest to take office`, ol.t, `aged ${ol.a}`);
    }
    const counts = {};
    for (const t of terms) counts[t.person] = (counts[t.person] || 0) + 1;
    const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (most && most[1] > 1) out.push({ office: o.id, title: `Most separate terms`, p: P(most[0]), extra: `${most[1]} terms` });
  }
  return out;
}

function countryFirsts(c, el) {
  const cur = c.curated?.firsts || [];
  const cats = [...new Set(cur.map((f) => f.cat))];
  const auto = autoFirsts(c);
  el.innerHTML = `
    ${cur.length ? cats.map((cat) => `<div class="cat-head"><h3>${esc(cat)}</h3></div>
      <div class="grid g3">${cur.filter((f) => f.cat === cat).map((f) => `
        <a class="first" href="${esc(wikiUrl(f.wiki))}" target="_blank" rel="noopener">
          ${avatar({ name: f.name, img: f.img })}
          <div><div class="ti">${esc(f.title)}</div><div class="nm">${esc(f.name)}</div><div class="dt">${fmtDate(f.date)}</div>${f.desc ? `<div class="ds">${esc(f.desc)}</div>` : ''}</div>
        </a>`).join('')}</div>`).join('') : `<div class="card note">No hand-curated firsts for ${esc(c.name)} yet. The records below are computed automatically from office-holder data. Curated entries live in <code>curated/firsts.json</code>.</div>`}
    <div class="cat-head"><h3>From the office-holder records</h3><span class="pill">Computed automatically</span></div>
    <div class="grid g3">${auto.map((f) => `
      <a class="first" href="#leader-${f.p.id}">${avatar(f.p)}
        <div><div class="ti">${esc(f.title)}</div><div class="nm">${esc(f.p.name)}</div><div class="dt">${esc([f.date && fmtDate(f.date), f.extra].filter(Boolean).join(' · '))}</div></div>
      </a>`).join('') || '<div class="empty">No records</div>'}</div>
    <p class="src">Curated entries link to Wikipedia. Computed entries use Wikidata gender, birth and term data, and are only as complete as those records.</p>`;
}

/* ---------------------------------------------------------------- history tab */
function countryHistory(c, el) {
  const ms = c.curated?.milestones || [];
  const fromTerms = c.terms.filter((t) => t.start && t.roles.includes('hog')).slice(0, 1);
  el.innerHTML = `
    <div class="overview">
      <div>
        ${ms.length ? `<h2 style="margin-bottom:18px">Milestones</h2><ol class="milestones">${ms.map((m) => `
          <li><div class="d">${fmtDate(m.date)}</div><div class="t">${esc(m.title)}</div><div class="x">${esc(m.text)} ${m.wiki ? ext(wikiUrl(m.wiki), 'Read more ↗') : ''}</div></li>`).join('')}</ol>` : ''}
        <h2 style="margin:${ms.length ? '28px' : '0'} 0 14px">${esc(c.historyTitle)}</h2>
        <div class="prose">${paragraphs(c.history, 8) || '<p class="muted">No history overview available.</p>'}</div>
        <p class="src">From ${ext(wikiUrl(c.historyTitle), `Wikipedia: ${c.historyTitle}`)} (CC BY-SA). ${ext(wikiUrl(c.historyTitle), 'Read the full article ↗')}</p>
      </div>
      <aside class="card">
        <div class="eyebrow" style="margin-bottom:8px">The modern state</div>
        <dl class="facts">
          ${fact('Founded', c.inception && fmtDate(c.inception))}
          ${fromTerms[0] ? fact('First head of govt.', `${c.people[fromTerms[0].person].name} (${year(fromTerms[0].start)})`) : ''}
          ${fact('Government', c.government.join(', '))}
          ${fact('Leaders on record', `${new Set(c.terms.map((t) => t.person)).size}`)}
        </dl>
        <a class="btn" style="margin-top:12px" href="#country-${c.iso3}-leaders">Leaders timeline</a>
      </aside>
    </div>`;
}

/* ---------------------------------------------------------------- data tab */
function countryData(c, el) {
  const groups = [...new Set(state.index.indicators.map((i) => i.group))];
  el.innerHTML = groups.map((g) => {
    const inds = state.index.indicators.filter((i) => i.group === g && c.indicators[i.key]?.length);
    if (!inds.length) return '';
    return `<div class="section-head" style="margin-top:8px"><h2>${esc(g)}</h2></div>
      <div class="grid g3" style="margin-bottom:28px">${inds.map((i) => {
        const s = c.indicators[i.key];
        const r = rankOf(c.iso3, i.key);
        return `<div class="card chart-card"><h3>${esc(i.label)}</h3>
          <div class="big">${fmtValue(s[s.length - 1][1], i.unit)}</div>
          <div class="sub">${s[s.length - 1][0]}${r ? ` · ranked ${r.rank} of ${r.of} (${i.better === 'low' ? 'lower is better' : i.better === 'high' ? 'higher is better' : 'by value'})` : ''}</div>
          <div data-chart="${i.key}"></div>
          <div class="src"><a href="#compare-${c.iso3}-${i.key}">Compare</a> · <a href="#rankings-${i.key}-${c.iso3}">Ranking</a> · ${ext(`https://data.worldbank.org/indicator/${i.id}?locations=${c.iso2}`, 'World Bank ↗')}</div></div>`;
      }).join('')}</div>`;
  }).join('') || '<div class="empty">No indicator data available.</div>';
  requestAnimationFrame(() => $$('[data-chart]', el).forEach((n) => {
    const i = state.ind.get(n.dataset.chart);
    lineChart(n, [{ name: c.name, color: 'var(--series-1)', points: c.indicators[i.key] }], { height: 150, format: (v) => fmtValue(v, i.unit), tick: tickFmt(i.unit), zero: !['gdpGrowth', 'inflation'].includes(i.key) });
  }));
}

/* ================================================================== leader profile */
async function leader([id]) {
  app.innerHTML = '<div class="loading">Loading profile…</div>';
  const people = await loadPeople();
  const entry = people[id];
  if (!entry) return notFound();
  const cs = await Promise.all(entry.c.map(loadCountry));
  const p = cs[0].people[id];
  document.title = `${p.name} — World Governance Atlas`;
  const offices = cs.flatMap((c) => c.terms.filter((t) => t.person === id).map((t) => {
    const same = c.terms.filter((x) => x.office === t.office && x.start).sort((a, b) => a.start.localeCompare(b.start));
    const i = same.indexOf(t);
    const prev = same.slice(0, i).reverse().find((x) => x.person !== id);
    const next = same.slice(i + 1).find((x) => x.person !== id);
    return { c, t, title: c.offices.find((o) => o.id === t.office)?.title, prev: prev && c.people[prev.person], next: next && c.people[next.person] };
  })).sort((a, b) => (a.t.start || '').localeCompare(b.t.start || ''));
  const totalDays = offices.reduce((s, o) => s + (o.t.start ? daysBetween(o.t.start, o.t.end || TODAY) : 0), 0);
  const firstStart = offices.find((o) => o.t.start)?.t.start;
  app.innerHTML = `
    <div class="crumbs"><a href="#country-${cs[0].iso3}-leaders">${esc(cs[0].name)}: leaders</a></div>
    <div class="profile">
      <div>${avatar(p, 'xl')}</div>
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="desc">${esc(p.desc)}</div>
        <div class="tiles" style="margin-bottom:20px">
          <div class="tile"><span class="l">Born</span><span class="v" style="font-size:18px">${p.born ? fmtDate(p.born) : '—'}</span><span class="f">${esc(p.birthplace || '')}</span></div>
          <div class="tile"><span class="l">${p.died ? 'Died' : 'Age'}</span><span class="v" style="font-size:18px">${p.died ? fmtDate(p.died) : p.born ? `${age(p.born, TODAY)} years` : '—'}</span><span class="f">${p.died && p.born ? `aged ${age(p.born, p.died)}` : ''}</span></div>
          <div class="tile"><span class="l">Time in top office</span><span class="v" style="font-size:18px">${fmtDuration(totalDays)}</span><span class="f">${offices.length} term${offices.length > 1 ? 's' : ''}</span></div>
          <div class="tile"><span class="l">Age taking office</span><span class="v" style="font-size:18px">${age(p.born, firstStart) ?? '—'}</span><span class="f">${firstStart ? year(firstStart) : ''}</span></div>
        </div>
        <div class="card" style="margin-bottom:20px">
          <h3 style="margin-bottom:6px">Offices held</h3>
          <ul class="office-list">${offices.map((o) => `<li>${flag(o.c)}<div><div class="o">${esc(o.title)}</div><div class="d">${fmtDate(o.t.start)} – ${o.t.end ? fmtDate(o.t.end) : 'present'} · ${fmtDuration(o.t.start ? daysBetween(o.t.start, o.t.end || TODAY) : null)}</div></div>
            <div class="nav2">${o.prev ? `← <a href="#leader-${o.prev.id}">${esc(o.prev.name)}</a>` : ''}${o.prev && o.next ? '<br>' : ''}${o.next ? `<a href="#leader-${o.next.id}">${esc(o.next.name)}</a> →` : ''}</div></li>`).join('')}</ul>
        </div>
        <div class="grid g2" style="margin-bottom:20px">
          ${p.parties.length ? `<div class="card"><div class="eyebrow">Political parties</div><p style="margin-top:6px">${p.parties.map(esc).join(' · ')}</p></div>` : ''}
          ${p.education.length || p.occupations.length ? `<div class="card"><div class="eyebrow">Education & occupation</div><p style="margin-top:6px">${[...p.education, ...p.occupations].map(esc).join(' · ')}</p></div>` : ''}
        </div>
        <h2 style="margin-bottom:12px">Biography</h2>
        <div class="prose" id="bio"><div class="skeleton" style="height:120px"></div></div>
        <p class="src">Live from ${p.wiki ? ext(wikiUrl(p.wiki), 'Wikipedia') : 'Wikipedia'} (CC BY-SA) · facts from ${ext(`https://www.wikidata.org/wiki/${id}`, 'Wikidata')}</p>
      </div>
    </div>`;
  if (p.wiki) {
    try {
      const s = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.wiki.replace(/ /g, '_'))}`);
      const ext2 = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(p.wiki)}`).catch(() => null);
      const long = ext2 && Object.values(ext2.query.pages)[0]?.extract;
      $('#bio').innerHTML = paragraphs(long || s.extract || '', 5) + `<p>${ext(wikiUrl(p.wiki), 'Continue reading on Wikipedia ↗')}</p>`;
      if (!p.img && s.thumbnail?.source) { const a = $('.profile .avatar'); a.outerHTML = avatar({ name: p.name, img: s.thumbnail.source }, 'xl'); }
    } catch { $('#bio').innerHTML = `<p class="muted">Biography couldn't be loaded. ${ext(wikiUrl(p.wiki), 'Open on Wikipedia ↗')}</p>`; }
  } else $('#bio').innerHTML = '<p class="muted">No English Wikipedia article.</p>';
}

/* ================================================================== compare */
async function compare(args) {
  document.title = 'Compare countries — World Governance Atlas';
  let sel = args.filter(isIso).filter((s) => state.byIso.has(s)).slice(0, 4);
  if (!sel.length) sel = ['IND', 'CHN', 'USA'];
  let key = args.find((a) => state.ind.has(a)) || 'gdpPerCapita';
  app.innerHTML = `
    <div class="section-head"><div><h1>Compare countries</h1><p class="muted" style="margin-top:6px">Pick up to four countries. The best value in each row is marked ▲.</p></div></div>
    <div class="toolbar"><div class="chips" id="chips"></div>
      <select id="add" aria-label="Add a country"><option value="">+ Add country</option>${state.index.countries.map((c) => `<option value="${c.iso3}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="card" style="margin-bottom:20px">
      <div class="section-head"><h3 id="ctitle"></h3><select id="ind" aria-label="Indicator">${groupedOptions(key)}</select></div>
      <div id="cchart"></div>
    </div>
    <div id="leaders" class="grid g4" style="margin-bottom:20px"></div>
    <div class="table-wrap" id="ctable"></div>`;
  const draw = async () => {
    setHash(['compare', ...sel, key].join('-'));
    const data = await Promise.all(sel.map(loadCountry));
    $('#chips').innerHTML = data.map((c, i) => `<span class="chip"><span class="sw" style="background:${SERIES[i]}"></span>${flag(c)}${esc(c.name)}<button data-x="${c.iso3}" aria-label="Remove ${esc(c.name)}">×</button></span>`).join('');
    $$('#chips button').forEach((b) => b.addEventListener('click', () => { sel = sel.filter((s) => s !== b.dataset.x); draw(); }));
    $('#add').disabled = sel.length >= 4;
    const ind = state.ind.get(key);
    $('#ctitle').textContent = ind.label;
    lineChart($('#cchart'), data.map((c, i) => ({ name: c.name, short: c.iso3, color: SERIES[i], points: c.indicators[key] })), { height: 300, format: (v) => fmtValue(v, ind.unit), tick: tickFmt(ind.unit), zero: !['gdpGrowth', 'inflation'].includes(key), yearFrom: 1960 });
    $('#leaders').innerHTML = data.map((c) => leaderCard(state.byIso.get(c.iso3))).join('');
    const groups = [...new Set(state.index.indicators.map((i) => i.group))];
    let rows = '';
    for (const g of groups) {
      rows += `<tr class="grp"><td colspan="${data.length + 1}">${esc(g)}</td></tr>`;
      for (const i of state.index.indicators.filter((x) => x.group === g)) {
        const vals = data.map((c) => c.indicators[i.key]?.slice(-1)[0]);
        if (!vals.some(Boolean)) continue;
        const nums = vals.map((v) => v?.[1]).filter((v) => v != null);
        const best = i.better && nums.length > 1 ? (i.better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
        rows += `<tr><td><a href="#" data-k="${i.key}">${esc(i.label)}</a></td>${vals.map((v) => `<td class="n ${v && v[1] === best ? 'best' : ''}">${v ? `${fmtValue(v[1], i.unit)}<span class="yr">${v[0]}</span>` : '—'}</td>`).join('')}</tr>`;
      }
    }
    const lrow = (label, fn) => `<tr><td>${label}</td>${data.map((c) => `<td class="n">${fn(c)}</td>`).join('')}</tr>`;
    $('#ctable').innerHTML = `<table><thead><tr><th>Indicator</th>${data.map((c) => `<th class="n">${esc(c.name)}</th>`).join('')}</tr></thead><tbody>
      <tr class="grp"><td colspan="${data.length + 1}">Governance history</td></tr>
      ${lrow('Modern state since', (c) => esc(year(c.inception) || '—'))}
      ${lrow('Leaders on record', (c) => new Set(c.terms.map((t) => t.person)).size)}
      ${lrow('Women heads of state/govt.', (c) => new Set(c.terms.filter((t) => c.people[t.person].gender === 'F').map((t) => t.person)).size)}
      ${rows}</tbody></table>`;
    $$('#ctable [data-k]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); key = a.dataset.k; $('#ind').value = key; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  };
  $('#add').addEventListener('change', (e) => { const v = e.target.value; if (v && !sel.includes(v) && sel.length < 4) { sel.push(v); draw(); } e.target.value = ''; });
  $('#ind').addEventListener('change', (e) => { key = e.target.value; draw(); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => parseHash().parts[0] === 'compare' && draw(), 200); });
  draw();
}

function groupedOptions(selected) {
  const groups = [...new Set(state.index.indicators.map((i) => i.group))];
  return groups.map((g) => `<optgroup label="${esc(g)}">${state.index.indicators.filter((i) => i.group === g).map((i) => `<option value="${i.key}" ${i.key === selected ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</optgroup>`).join('');
}

/* ================================================================== rankings */
async function rankings(args) {
  document.title = 'Rankings — World Governance Atlas';
  let key = args.find((a) => state.ind.has(a)) || 'corruptionControl';
  const hl = args.find(isIso) || '';
  app.innerHTML = `
    <div class="section-head"><div><h1>World rankings</h1><p class="muted" style="margin-top:6px">Every country ranked on its latest reported value.</p></div></div>
    <div class="toolbar">
      <select id="ri" aria-label="Indicator">${groupedOptions(key)}</select>
      <div class="seg" id="rdir"><button data-d="best" class="on">Best first</button><button data-d="worst">Worst first</button></div>
      <input class="input" id="rq" placeholder="Find a country" style="flex:0 1 200px">
    </div>
    <div class="card"><div class="note" id="rnote" style="margin-bottom:10px"></div><ol class="bars" id="rlist"></ol></div>`;
  let dir = 'best';
  const draw = () => {
    setHash(['rankings', key, hl].filter(Boolean).join('-'));
    const ind = state.ind.get(key);
    let rows = state.index.countries.filter((c) => c.latest[key]);
    const asc = (ind.better === 'low') === (dir === 'best');
    rows.sort((a, b) => (asc ? a.latest[key][1] - b.latest[key][1] : b.latest[key][1] - a.latest[key][1]));
    const max = Math.max(...rows.map((c) => Math.abs(c.latest[key][1])));
    const q = $('#rq').value.trim().toLowerCase();
    $('#rnote').innerHTML = `${esc(ind.label)} · ${rows.length} countries · ${ind.better === 'low' ? 'lower is better' : ind.better === 'high' ? 'higher is better' : 'neither direction is "better"; sorted by value'} · source ${ext(`https://data.worldbank.org/indicator/${ind.id}`, 'World Bank')}${ind.lastUpdated ? `, updated ${fmtDate(ind.lastUpdated)}` : ''}`;
    $('#rlist').innerHTML = rows.map((c, i) => {
      const [yr, v] = c.latest[key];
      const show = !q || c.name.toLowerCase().includes(q);
      return `<li class="${c.iso3 === hl ? 'hl' : ''}" ${show ? '' : 'hidden'} id="r-${c.iso3}"><span class="r">${i + 1}</span>${flag(c)}<a href="#country-${c.iso3}">${esc(c.name)}</a><span class="track"><span class="bar" style="width:${(Math.abs(v) / max) * 100}%"></span></span><span class="v">${fmtValue(v, ind.unit)}<small>${yr}</small></span></li>`;
    }).join('');
    if (hl) $(`#r-${hl}`)?.scrollIntoView({ block: 'center' });
  };
  $('#ri').addEventListener('change', (e) => { key = e.target.value; draw(); });
  $('#rq').addEventListener('input', draw);
  $$('#rdir button').forEach((b) => b.addEventListener('click', () => { dir = b.dataset.d; $$('#rdir button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
  if (hl) router.keepScroll = true;
}

/* ================================================================== about */
async function about() {
  document.title = 'Sources & methodology — World Governance Atlas';
  const idx = state.index;
  app.innerHTML = `
    <div style="max-width:760px">
      <h1>Sources & methodology</h1>
      <p class="prose" style="margin-top:14px">The atlas is rebuilt automatically every day from open public data. National governments report to these aggregators; links on each country page lead to the official government portal.</p>
      <div class="table-wrap" style="margin:20px 0"><table><thead><tr><th>What</th><th>Source</th><th>Refresh</th></tr></thead><tbody>
        <tr><td>Countries, offices, every head of state & government with term dates, photos, parties, birth & death</td><td>${ext('https://www.wikidata.org', 'Wikidata')} (SPARQL + entity API)</td><td>Daily rebuild</td></tr>
        <tr><td>Country summaries, national history overviews</td><td>${ext('https://en.wikipedia.org', 'Wikipedia')}</td><td>Daily rebuild</td></tr>
        <tr><td>Leader biographies</td><td>Wikipedia REST API</td><td>Live, on every visit</td></tr>
        <tr><td>Economy, crime (homicide, conflict deaths), PM2.5, CO₂, health, education, women in parliament, military spending</td><td>${ext('https://data.worldbank.org', 'World Bank WDI')}, which compiles national statistics offices, UNODC and WHO</td><td>Daily rebuild (sources publish yearly)</td></tr>
        <tr><td>Governance scores: corruption, effectiveness, rule of law, voice, stability, regulation</td><td>${ext('https://www.worldbank.org/en/publication/worldwide-governance-indicators', 'Worldwide Governance Indicators')}</td><td>Daily rebuild (published yearly)</td></tr>
        <tr><td>Live air quality (US AQI, PM2.5, PM10, NO₂, O₃) in each capital</td><td>${ext('https://open-meteo.com/en/docs/air-quality-api', 'Open-Meteo')} / Copernicus CAMS</td><td>Live, hourly</td></tr>
        <tr><td>Curated "firsts" & milestones (India, USA, UK so far)</td><td>Hand-edited <code>curated/firsts.json</code>, each linked to Wikipedia</td><td>On edit</td></tr>
      </tbody></table></div>
      <h2 style="margin:28px 0 10px">Indicators</h2>
      <div class="table-wrap"><table><thead><tr><th>Indicator</th><th>Group</th><th>Code</th><th>Updated at source</th></tr></thead><tbody>
        ${idx.indicators.map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.group)}</td><td><code>${esc(i.id)}</code></td><td class="num">${i.lastUpdated ? fmtDate(i.lastUpdated) : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <h2 style="margin:28px 0 10px">Caveats</h2>
      <ul class="prose" style="font-size:15px">
        <li>Leader records are only as complete as Wikidata. Acting and caretaker terms appear where they are recorded.</li>
        <li>"Modern state since" is Wikidata's inception date for the current state. For many countries this is independence; for others it is a later constitution.</li>
        <li>Crime figures use intentional homicide rates, the most comparable crime statistic across countries. Reporting practices still differ.</li>
        <li>Indicators carry the year of the latest available value. Some countries report with a lag of several years.</li>
      </ul>
      <p class="note">Last full rebuild: ${esc(idx.generated)}</p>
    </div>`;
}

/* ================================================================== search */
function initSearch() {
  const input = $('#search');
  const box = $('#search-results');
  let sel = -1;
  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    await loadIndex();
    const people = await loadPeople().catch(() => ({}));
    const cs = state.index.countries.filter((c) => c.name.toLowerCase().includes(q) || c.iso3.toLowerCase() === q).slice(0, 6);
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const ps = Object.entries(people).filter(([, p]) => norm(p.n).includes(norm(q))).sort((a, b) => norm(a[1].n).indexOf(norm(q)) - norm(b[1].n).indexOf(norm(q))).slice(0, 8);
    box.innerHTML = (cs.length ? `<div class="sr-head">Countries</div>${cs.map((c) => `<a href="#country-${c.iso3}">${flag(c)}${esc(c.name)}<span class="kind">${esc(c.capital || '')}</span></a>`).join('')}` : '')
      + (ps.length ? `<div class="sr-head">Leaders</div>${ps.map(([id, p]) => `<a href="#leader-${id}">${esc(p.n)}<span class="kind">${esc(p.c.map((x) => state.byIso.get(x)?.name).filter(Boolean).slice(0, 2).join(', '))}</span></a>`).join('')}` : '')
      || '<div class="sr-head">No matches</div>';
    box.hidden = false;
    sel = -1;
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    const items = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((a, i) => a.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') {
      const a = items[sel] || items[0];
      if (a) { location.hash = a.getAttribute('href'); box.hidden = true; input.blur(); }
    } else if (e.key === 'Escape') box.hidden = true;
  });
  box.addEventListener('click', () => { box.hidden = true; input.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
}

function initTheme() {
  $('#theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('wga-theme', root.dataset.theme); } catch (e) {}
    if (parseHash().parts[0] === 'compare' || parseHash().parts[2] === 'data') { router.keepScroll = true; router(); }
  });
}

initSearch();
initTheme();
router();
