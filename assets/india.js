// Who Runs India: home, MP screener, MP profiles. Views are plain hash names: #mps, #mp-4589, #services (IAS), #officer-<id>, #ips, #sources.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let DATA = null;
const byId = new Map();

async function load() {
  if (DATA) return DATA;
  DATA = await (await fetch('data/india/mps.json')).json();
  for (const m of DATA.mps) byId.set(String(m.id), m);
  $('#updated').textContent = `Data rebuilt ${new Date(DATA.generated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} from Sansad and MyNeta.`;
  return DATA;
}

/* ---------- formatting ---------- */
function inr(n) {
  if (n == null) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e9 ? 0 : 1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}
const fmtDob = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const initials = (n) => esc((n || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
function photo(m, cls = 'avatar') {
  if (!m.photo) return `<span class="${cls}">${initials(m.name)}</span>`;
  return `<img class="${cls}" src="${esc(m.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;${cls}&quot;>${initials(m.name)}</span>'">`;
}
const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const EDU_ORDER = ['Illiterate', 'Literate', '5th Pass', '8th Pass', '10th Pass', '12th Pass', 'Diploma', 'Graduate', 'Graduate Professional', 'Post Graduate', 'Doctorate', 'Others'];
const edu = (m) => m.affidavit?.education || m.qualification || '';

/* ---------- structure / states / elections (assets/india-states.js) ---------- */
const loadStates = () => window.IN.loadStates();
const structure = () => window.IN.structure(app, DATA);
const states = () => window.IN.states(app, DATA);
const state = ([code]) => window.IN.state(app, DATA, (code || '').toUpperCase());
const elections = () => window.IN.elections(app, DATA);
const union = () => window.IN.union(app, DATA);
const police = (args) => window.IN.police(app, DATA, args);
window.IN_setStateFilter = (name) => { S.f = { ...DEFAULT_F, state: DATA.mps.find((m) => m.state.toLowerCase().replace(/&/g, 'and') === name.toLowerCase())?.state || '' }; S.title = `MPs from ${name}`; S.page = 1; };

/* ---------- router ---------- */
const routes = { '': home, home, mps, mp, services, officers: services, officer, ips: () => window.IN.officers(app), companies, sources, structure, states, state, elections, union, police };
let lastHash = location.hash;
async function router() {
  // In-page anchors (#dists, #t-union, …) scroll to the section instead of changing view.
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw && !(raw.split('-')[0] in routes) && document.getElementById(raw)) {
    document.getElementById(raw).scrollIntoView({ block: 'start' });
    history.replaceState(null, '', lastHash || location.pathname);
    return;
  }
  lastHash = location.hash;
  const [name, ...args] = raw.split('-');
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'mp' && a.dataset.nav === 'mps') || (name === 'state' && a.dataset.nav === 'states') || (['officer', 'officers', 'ips'].includes(name) && a.dataset.nav === 'services')));
  await load();
  if (['structure', 'states', 'state', 'elections', 'home', '', 'union', 'police', 'services', 'officers', 'officer', 'ips'].includes(name)) await loadStates();
  await (routes[name] || home)(args);
  if (!router.keep) window.scrollTo(0, 0);
  router.keep = false;
}
window.addEventListener('hashchange', router);

/* ---------- home ---------- */
const PRESETS = {
  richest: { title: 'Richest MPs', sub: 'Declared total assets, 2024 affidavit', sort: 'assets', dir: -1, val: (m) => inr(m.affidavit?.assets) },
  cases: { title: 'MPs with the most criminal cases', sub: 'Cases declared in the 2024 affidavit (pending, not convictions)', sort: 'cases', dir: -1, filter: { cases: 'yes' }, val: (m) => `${m.affidavit.criminalCases} cases` },
  youngest: { title: 'Youngest MPs', sub: 'By current age', sort: 'age', dir: 1, val: (m) => `${m.age} yrs` },
  veterans: { title: 'Longest-serving MPs', sub: 'Most Lok Sabha terms', sort: 'terms', dir: -1, val: (m) => `${m.terms} terms` },
  women: { title: 'Women MPs', sub: 'Sorted by number of terms', sort: 'terms', dir: -1, filter: { gender: 'Female' }, val: (m) => `${m.terms} term${m.terms > 1 ? 's' : ''}` },
  first: { title: 'First-time MPs', sub: 'First elected in 2024, by declared assets', sort: 'assets', dir: -1, filter: { terms: '1' }, val: (m) => inr(m.affidavit?.assets) },
};

function home() {
  document.title = 'Who Runs India';
  const M = DATA.mps;
  const women = M.filter((m) => m.gender === 'Female').length;
  const withAff = M.filter((m) => m.affidavit);
  const withCases = withAff.filter((m) => m.affidavit.criminalCases > 0).length;
  const crorepatis = withAff.filter((m) => m.affidavit.assets >= 1e7).length;
  const first = M.filter((m) => m.terms === 1).length;
  const parties = Object.entries(M.reduce((o, m) => ((o[m.party] = (o[m.party] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]);
  const top = parties.slice(0, 9), rest = parties.slice(9).reduce((s, p) => s + p[1], 0);
  const max = top[0][1];
  app.innerHTML = `
    <section class="in-hero">
      <h1>Who runs India.<br><em>Searchable.</em></h1>
      <p>Every Member of Parliament: party, constituency, education, declared wealth and criminal cases. Straight from public records.</p>
      <div class="big-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input id="hero-search" type="search" placeholder="Try “Varanasi”, “Shashi Tharoor” or “DMK”" autocomplete="off" aria-label="Search MPs">
        <div id="hero-results" class="search-results" hidden></div>
      </div>
      <div class="quick"><a href="#mps" data-preset="richest">Richest MPs</a><a href="#mps" data-preset="cases">Criminal cases</a><a href="#mps" data-preset="women">Women MPs</a><a href="#mps" data-preset="youngest">Youngest</a><a href="#mps" data-preset="first">First-timers</a></div>
    </section>

    <section class="cats">
      <a class="cat" href="#structure"><span class="st live"><span class="live-dot"></span>Explainer</span><span class="n">7 tiers</span><span class="t">How India is governed</span><span class="d">From the President to the Gram Panchayat: who is elected, who is appointed, and who runs each election.</span><span class="go">See the structure →</span></a>
      <a class="cat" href="#states"><span class="st live"><span class="live-dot"></span>Live · 36 states & UTs</span><span class="n">${window.IN.getStates()?.states.reduce((a, x) => a + x.mlas.length, 0).toLocaleString('en-IN')}</span><span class="t">States, CMs, Governors & MLAs</span><span class="d">Every Chief Minister, Deputy CM, Governor and MLA, with assets, criminal cases and the next election date.</span><span class="go">Open states →</span></a>
      <a class="cat" href="#mps"><span class="st live"><span class="live-dot"></span>Live · Lok Sabha</span><span class="n">${M.length}</span><span class="t">Members of Parliament</span><span class="d">18th Lok Sabha. Filter by state, party, education, assets and criminal cases.</span><span class="go">Open MP screener →</span></a>
      <a class="cat" href="index.html#country-IND-leaders"><span class="st live"><span class="live-dot"></span>Live · Since 1947</span><span class="n">18</span><span class="t">Prime Ministers & Presidents</span><span class="d">Every PM and President with terms, tenure and party, from Nehru and Rajendra Prasad to today.</span><span class="go">Open timeline →</span></a>
      <a class="cat" href="#services"><span class="st live"><span class="live-dot"></span>Live · DoPT & MHA</span><span class="n">IAS · IPS</span><span class="t">Officers & Collectors</span><span class="d">Every serving IAS and IPS officer with cadre, batch and present posting; IAS posting histories and the Collector / DM of each district.</span><span class="go">Open officer screeners →</span></a>
      <a class="cat soon" href="#companies"><span class="st">Next · NSE filings</span><span class="n">CEOs</span><span class="t">Companies & CEOs</span><span class="d">Leaders of India's largest listed companies, from stock-exchange filings and annual reports.</span><span class="go">See plan →</span></a>
    </section>

    <section class="section glance">
      <div class="card">
        <div class="section-head" style="margin-bottom:10px"><h2>Lok Sabha by party</h2><span class="note">${M.length} sitting members</span></div>
        <ul class="party-bars">${top.map(([p, n]) => `<li><b title="${esc(M.find((m) => m.party === p)?.partyName)}">${esc(p)}</b><span class="tr"><span style="width:${(n / max) * 100}%"></span></span><span class="num">${n}</span></li>`).join('')}
        ${rest ? `<li><b>Others</b><span class="tr"><span style="width:${(rest / max) * 100}%;background:var(--series-other)"></span></span><span class="num">${rest}</span></li>` : ''}</ul>
        <p class="majority">272 seats needed for a majority. Party shown as listed by Sansad.</p>
      </div>
      <div class="kpis">
        ${kpi(pct(women, M.length) + '%', `${women} women MPs`, pct(women, M.length))}
        ${kpi(pct(first, M.length) + '%', `${first} first-time MPs`, pct(first, M.length))}
        ${kpi(pct(crorepatis, withAff.length) + '%', `crorepatis (₹1 Cr+ assets)`, pct(crorepatis, withAff.length))}
        ${kpi(pct(withCases, withAff.length) + '%', `declared criminal cases`, pct(withCases, withAff.length))}
        ${kpi(median(M.map((m) => m.age).filter(Boolean)) + ' yrs', 'median age')}
        ${kpi(inr(median(withAff.map((m) => m.affidavit.assets))), 'median declared assets')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Insights</h2><p>Lists built from the records. Tap any to open the full screener.</p></div>
      <div class="insights">${Object.entries(PRESETS).map(([k, p]) => insightCard(k, p)).join('')}</div>
    </section>`;
  bindSearch($('#hero-search'), $('#hero-results'));
  $$('[data-preset]').forEach((a) => a.addEventListener('click', () => applyPreset(a.dataset.preset)));
}
const kpi = (v, l, meter) => `<div class="kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div>${meter != null ? `<div class="meter"><i style="width:${meter}%"></i></div>` : ''}</div>`;

function presetRows(p) {
  return sortRows(filterRows(DATA.mps, { ...DEFAULT_F, ...(p.filter || {}) }), p.sort, p.dir);
}
function insightCard(k, p) {
  const rows = presetRows(p).slice(0, 5);
  return `<div class="card ins"><h3>${esc(p.title)}</h3><div class="sub">${esc(p.sub)}</div>
    <ol class="plist">${rows.map((m) => `<li><a href="#mp-${m.id}">${photo(m)}<span><span class="nm">${esc(m.name)}</span><br><span class="meta">${esc(m.party)} · ${esc(m.constituency)}</span></span><span class="val">${esc(p.val(m))}</span></a></li>`).join('')}</ol>
    <a class="more" href="#mps" data-preset="${k}">View all →</a></div>`;
}

/* ---------- screener ---------- */
const DEFAULT_F = { q: '', state: '', party: '', gender: '', edu: '', cases: '', terms: '' };
const S = { f: { ...DEFAULT_F }, sort: 'name', dir: 1, page: 1, per: 50, title: 'MP Screener' };
function applyPreset(k) {
  const p = PRESETS[k];
  Object.assign(S, { f: { ...DEFAULT_F, ...(p.filter || {}) }, sort: p.sort, dir: p.dir, page: 1, title: p.title });
}
function filterRows(rows, f) {
  const q = f.q.trim().toLowerCase();
  return rows.filter((m) =>
    (!q || `${m.name} ${m.constituency} ${m.party} ${m.partyName} ${m.state}`.toLowerCase().includes(q)) &&
    (!f.state || m.state === f.state) && (!f.party || m.party === f.party) && (!f.gender || m.gender === f.gender) &&
    (!f.edu || edu(m) === f.edu) &&
    (!f.cases || (f.cases === 'yes' ? m.affidavit?.criminalCases > 0 : m.affidavit && m.affidavit.criminalCases === 0)) &&
    (!f.terms || (f.terms === '1' ? m.terms === 1 : f.terms === '2' ? m.terms >= 2 : m.terms >= 5)));
}
const KEYS = { name: (m) => m.name, state: (m) => m.state, party: (m) => m.party, age: (m) => m.age ?? 999, terms: (m) => m.terms, assets: (m) => m.affidavit?.assets ?? -1, cases: (m) => m.affidavit?.criminalCases ?? -1 };
function sortRows(rows, key, dir) {
  const k = KEYS[key];
  return [...rows].sort((a, b) => { const x = k(a), y = k(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.name.localeCompare(b.name); });
}

function mps() {
  document.title = `${S.title} · Who Runs India`;
  const M = DATA.mps;
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const states = [...new Set(M.map((m) => m.state))].sort();
  const parties = [...new Set(M.map((m) => m.party))].sort();
  const edus = [...new Set(M.map(edu).filter(Boolean))].sort((a, b) => EDU_ORDER.indexOf(a) - EDU_ORDER.indexOf(b));
  app.innerHTML = `
    <div class="screener-head"><div><h1 id="sc-title">${esc(S.title)}</h1><p class="muted" style="margin-top:6px">18th Lok Sabha · affidavit data from the 2024 election</p></div><span class="note" id="count"></span></div>
    <div class="filters">
      <input class="input" type="search" id="f-q" placeholder="Name, constituency or party" value="${esc(S.f.q)}">
      <select id="f-state" aria-label="State">${opts(states, S.f.state, 'All states')}</select>
      <select id="f-party" aria-label="Party">${opts(parties, S.f.party, 'All parties')}</select>
      <select id="f-edu" aria-label="Education">${opts(edus, S.f.edu, 'Any education')}</select>
      <select id="f-terms" aria-label="Terms"><option value="">Any terms</option><option value="1" ${S.f.terms === '1' ? 'selected' : ''}>First-time</option><option value="2" ${S.f.terms === '2' ? 'selected' : ''}>2+ terms</option><option value="5" ${S.f.terms === '5' ? 'selected' : ''}>5+ terms</option></select>
      <button class="chip-toggle ${S.f.gender === 'Female' ? 'on' : ''}" id="f-women">Women</button>
      <button class="chip-toggle ${S.f.cases === 'yes' ? 'on' : ''}" id="f-cases">Criminal cases</button>
      <button class="chip-toggle" id="f-reset">Reset</button>
    </div>
    <div class="table-wrap"><table class="mp-table"><thead><tr id="thead"></tr></thead><tbody id="tbody"></tbody></table></div>
    <div class="pager" id="pager"></div>
    <p class="src">Members: ${ext(DATA.sources.members, 'Sansad')} · Assets, liabilities, criminal cases and education: self-declared 2024 election affidavits via ${ext(DATA.sources.affidavits, 'MyNeta / ADR')}. Criminal cases are pending cases, not convictions.</p>`;
  const cols = [['#', null], ['MP', 'name'], ['Party', 'party'], ['State', 'state'], ['Age', 'age'], ['Terms', 'terms'], ['Education', null], ['Assets', 'assets'], ['Cases', 'cases']];
  const draw = () => {
    const rows = sortRows(filterRows(M, S.f), S.sort, S.dir);
    const pages = Math.max(1, Math.ceil(rows.length / S.per));
    S.page = Math.min(S.page, pages);
    $('#count').textContent = `${rows.length} of ${M.length} MPs`;
    $('#thead').innerHTML = cols.map(([l, k]) => `<th class="${['Age', 'Terms', 'Assets', 'Cases'].includes(l) ? 'n' : ''} ${S.sort === k ? 'sorted' : ''}">${k ? `<button data-k="${k}">${l}${S.sort === k ? (S.dir > 0 ? ' ↑' : ' ↓') : ''}</button>` : l}</th>`).join('');
    $('#tbody').innerHTML = rows.slice((S.page - 1) * S.per, S.page * S.per).map((m, i) => `<tr>
      <td class="muted num">${(S.page - 1) * S.per + i + 1}</td>
      <td><div class="who">${photo(m)}<div><a href="#mp-${m.id}">${esc(m.name)}</a><small>${esc(m.constituency)}${m.reserved ? ` (${m.reserved})` : ''}</small></div></div></td>
      <td><span class="ptag" title="${esc(m.partyName)}">${esc(m.party)}</span></td>
      <td>${esc(m.state)}</td><td class="n">${m.age ?? '—'}</td><td class="n">${m.terms}</td>
      <td>${esc(edu(m))}</td><td class="n">${inr(m.affidavit?.assets)}</td>
      <td class="n"><span class="cases ${m.affidavit?.criminalCases ? '' : 'zero'}">${m.affidavit ? m.affidavit.criminalCases : '—'}</span></td></tr>`).join('') || `<tr><td colspan="9" class="empty">No MPs match these filters.</td></tr>`;
    const pg = [];
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - S.page) <= 2) pg.push(p); else if (pg[pg.length - 1] !== '…') pg.push('…');
    $('#pager').innerHTML = pages > 1 ? `<button ${S.page === 1 ? 'disabled' : ''} data-p="${S.page - 1}">‹</button>${pg.map((p) => (p === '…' ? '<span>…</span>' : `<button class="${p === S.page ? 'on' : ''}" data-p="${p}">${p}</button>`)).join('')}<button ${S.page === pages ? 'disabled' : ''} data-p="${S.page + 1}">›</button>` : '';
    $$('#thead button').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.k; S.dir = S.sort === k ? -S.dir : ['assets', 'cases', 'terms'].includes(k) ? -1 : 1; S.sort = k; draw(); }));
    $$('#pager button').forEach((b) => b.addEventListener('click', () => { S.page = +b.dataset.p; draw(); $('.table-wrap').scrollIntoView({ block: 'start' }); }));
  };
  const set = (k, v) => { S.f[k] = v; S.page = 1; S.title = 'MP Screener'; $('#sc-title').textContent = S.title; draw(); };
  $('#f-q').addEventListener('input', (e) => set('q', e.target.value));
  for (const k of ['state', 'party', 'edu', 'terms']) $(`#f-${k}`).addEventListener('change', (e) => set(k, e.target.value));
  $('#f-women').addEventListener('click', (e) => { e.target.classList.toggle('on'); set('gender', S.f.gender ? '' : 'Female'); });
  $('#f-cases').addEventListener('click', (e) => { e.target.classList.toggle('on'); set('cases', S.f.cases ? '' : 'yes'); });
  $('#f-reset').addEventListener('click', () => { Object.assign(S, { f: { ...DEFAULT_F }, sort: 'name', dir: 1, page: 1, title: 'MP Screener' }); mps(); });
  draw();
}
const ext = (href, t) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(t)}</a>`;

/* ---------- profile ---------- */
function mp([id]) {
  const m = byId.get(id);
  if (!m) return home();
  document.title = `${m.name} · Who Runs India`;
  const M = DATA.mps, a = m.affidavit;
  const withAff = M.filter((x) => x.affidavit);
  const richerThan = a ? pct(withAff.filter((x) => x.affidavit.assets < a.assets).length, withAff.length) : null;
  const sameState = M.filter((x) => x.state === m.state && x.id !== m.id).sort((x, y) => (y.affidavit?.assets ?? 0) - (x.affidavit?.assets ?? 0));
  const sameParty = M.filter((x) => x.party === m.party && x.id !== m.id && x.state === m.state);
  const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : '');
  app.innerHTML = `
    <div class="crumbs"><a href="#mps">MPs</a> / ${esc(m.state)}</div>
    <div class="mp-profile">
      <div>${photo(m, 'mp-photo')}</div>
      <div>
        <h1>${esc(m.name)}</h1>
        <div class="role">Member of Parliament, Lok Sabha · ${esc(m.constituency)}${m.reserved ? ` (${m.reserved})` : ''}, ${esc(m.state)}</div>
        <div class="badges"><span class="pill accent">${esc(m.partyName)} (${esc(m.party)})</span><span class="pill">${ord(m.terms)} term</span>${m.age ? `<span class="pill">Age ${m.age}</span>` : ''}<span class="pill">${esc(m.gender)}</span></div>
        <div class="grid g2">
          <div class="card">
            <div class="eyebrow" style="margin-bottom:6px">Profile</div>
            <dl class="facts">
              ${fact('Born', esc(fmtDob(m.dob)))}
              ${fact('Education', esc(edu(m)))}
              ${fact('Profession', esc(m.profession))}
              ${fact('Constituency', esc(`${m.constituency}, ${m.state}`))}
              ${fact('Lok Sabha terms', `${m.terms}`)}
              ${m.email ? fact('Official email', `<span class="num" style="user-select:all">${esc(m.email)}</span>`) : ''}
            </dl>
          </div>
          <div class="card ${a ? (a.criminalCases ? 'warn-card' : 'ok-card') : ''}">
            <div class="eyebrow" style="margin-bottom:10px">2024 election affidavit</div>
            ${a ? `<div class="money">
                <div class="tile"><span class="l">Total assets</span><span class="v">${inr(a.assets)}</span></div>
                <div class="tile"><span class="l">Liabilities</span><span class="v">${inr(a.liabilities)}</span></div>
                <div class="tile"><span class="l">Criminal cases declared</span><span class="v ${a.criminalCases ? 'cases' : ''}">${a.criminalCases}</span></div>
              </div>
              <p class="pct-line">Declared more assets than <b>${richerThan}%</b> of MPs with affidavit data.</p>
              <p class="src">Self-declared to the Election Commission. ${a.mynetaId ? ext(`https://www.myneta.info/LokSabha2024/candidate.php?candidate_id=${a.mynetaId}`, 'Full affidavit on MyNeta ↗') : ''}</p>`
              : `<p class="muted">No affidavit summary matched for this MP yet.</p>`}
          </div>
        </div>
        <div class="section-head" style="margin-top:28px"><h2>Other MPs from ${esc(m.state)}</h2><span class="note">${sameState.length} · ${sameParty.length} from ${esc(m.party)}</span></div>
        <div class="grid g3">${sameState.slice(0, 9).map((x) => `<a class="leader-card" href="#mp-${x.id}">${photo(x)}<div><div class="t">${esc(x.party)} · ${esc(x.constituency)}</div><div class="n">${esc(x.name)}</div><div class="c">${inr(x.affidavit?.assets)} assets</div></div></a>`).join('')}</div>
        <p class="src">Sources: ${ext('https://sansad.in/ls/members', 'Sansad, Lok Sabha members')}${a?.mynetaId ? ` · ${ext(`https://www.myneta.info/LokSabha2024/candidate.php?candidate_id=${a.mynetaId}`, 'MyNeta affidavit')}` : ''}</p>
      </div>
    </div>`;
}

/* ---------- officers (IAS) ---------- */
let IAS = null;
const iasById = new Map();
const histCache = {};
async function loadIAS() {
  if (IAS) return IAS;
  IAS = await fetch('data/india/ias.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const o of IAS?.officers || []) iasById.set(o.id, o);
  return IAS;
}
const erUrl = (o) => `https://supremo.dopt.gov.in/ERSheetHtml.aspx?OffIDErhtml=${encodeURIComponent(o.er)}&PageId=`;
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtYM = (ym) => (ym ? new Date(ym + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—');
const cadreName = (c) => IAS?.cadres?.[c]?.name || c;
// Past the age-60 date but still listed: service extended or re-employed.
const retTxt = (o) => (o.retires && o.retires < new Date().toISOString().slice(0, 7) ? `<span title="Age-60 date ${fmtYM(o.retires)}; service extended">extended</span>` : fmtYM(o.retires));
// Posting categories, matched on the current posting title.
const NOT_DIST = /addl|additional|joint|asst|assistant|sub.?div|\bsdm\b|municipal|excise|commercial|tax|labour|police|development commissioner|\badm\b|\badc\b/i;
const POST_CATS = {
  district: ['District Collectors / DMs / DCs', (o) => /collector|district magistrate|deputy commissioner|\bd\.?\s?m\.?\b/i.test(o.posting || '') && !NOT_DIST.test((o.posting || '').split(',')[0])],
  cs: ['Chief Secretaries', (o) => /^\s*chief secretary\b/i.test(o.posting || '')],
  secy: ['Addl. Chief / Principal Secretaries', (o) => /^\s*(additional chief secretary|addl\.? chief secretary|a\.?c\.?s\b|principal secretary|prin\.? secy|pr\.? secy)/i.test(o.posting || '')],
  centre: ['On central deputation', (o) => o.centralDeputation],
  gois: ['Secretaries to the Government of India', (o) => o.centralDeputation && /^\s*(secretary|special secretary)\b/i.test(o.posting || '')],
  junior: ['Assistant Collectors / SDMs / in training', (o) => /assistant collector|asst\.? collector|sub.?divisional|\bsdm\b|training|probation|lbsnaa|\bo\.?t\.?\b/i.test(o.posting || '')],
  wait: ['Awaiting posting / on leave', (o) => /awaiting|waiting|compulsory wait|leave|suspen/i.test(`${o.posting || ''} ${o.remarks || ''}`)],
};
const DEFAULT_OF = { q: '', cadre: '', batch: '', post: '', pq: '', pay: '', rec: '', women: false };
const OS = { f: { ...DEFAULT_OF }, sort: 'batch', dir: 1, page: 1, per: 50 };
const OKEYS = { name: (o) => o.name.replace(/^(shri|smt|ms|mr|mrs|dr)\.?\s+/i, ''), cadre: (o) => cadreName(o.cadre), batch: (o) => o.batch ?? 9999, since: (o) => o.since || '', payLevel: (o) => o.payLevel ?? -1, retires: (o) => o.retires || '9999' };

async function services() {
  document.title = 'IAS officers · Who Runs India';
  await loadIAS();
  if (!IAS?.officers?.length) {
    app.innerHTML = `<div class="soon-box"><div class="eyebrow">Officers</div><h1>IAS officers</h1><p>The officer data has not been built yet. Run <code>node scripts/fetch-ias.mjs</code> from an Indian connection.</p><a class="btn" href="#mps">Explore MPs meanwhile</a></div>`;
    return;
  }
  const O = IAS.officers;
  const women = O.filter((o) => o.gender === 'Female').length, withG = O.filter((o) => o.gender).length;
  const dr = O.filter((o) => o.recruitment === 'DR').length;
  const cd = O.filter((o) => o.centralDeputation).length;
  const CO = window.IN.getCollectors?.() || {};
  const cadres = Object.keys(IAS.cadres).filter((c) => O.some((o) => o.cadre === c)).sort((a, b) => cadreName(a).localeCompare(cadreName(b)));
  const batches = [...new Set(O.map((o) => o.batch).filter(Boolean))].sort((a, b) => b - a);
  const pays = [...new Set(O.map((o) => o.payLevel).filter(Boolean))].sort((a, b) => b - a);
  const strength = cadres.map((c) => [c, O.filter((o) => o.cadre === c).length]).sort((a, b) => b[1] - a[1]);
  const sel = (id, label, opts, cur) => `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  app.innerHTML = `
    <div class="seg" style="margin-bottom:14px"><a href="#services" class="on">IAS</a><a href="#ips" class="">IPS</a></div>
    <div class="screener-head"><div><div class="eyebrow">Officers · Indian Administrative Service</div><h1>IAS Officer Screener</h1>
      <p class="muted" style="margin-top:6px">Every serving IAS officer in DoPT's Civil List (as on ${fmtD(IAS.asOn)}), with current posting from the Civil List or their Executive Record Sheet, whichever is newer. Filter by cadre, batch and posting.</p></div><span class="note" id="o-count"></span></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:18px 0">
      ${kpi(O.length.toLocaleString('en-IN'), 'serving IAS officers')}
      ${withG ? kpi(pct(women, withG) + '%', `women (${women.toLocaleString('en-IN')})`, pct(women, withG)) : ''}
      ${kpi(pct(dr, O.length) + '%', 'direct recruits (UPSC); rest promoted from state services', pct(dr, O.length))}
      ${kpi(cd.toLocaleString('en-IN'), 'on central deputation')}
      ${CO.matched ? kpi(`${CO.matched}`, `district heads identified, of ${CO.total} districts`) : ''}
    </div>
    <div class="filters">
      <input class="input" type="search" id="o-q" placeholder="Officer name or ID" value="${esc(OS.f.q)}">
      ${sel('o-cadre', 'All cadres', cadres.map((c) => [c, cadreName(c)]), OS.f.cadre)}
      ${sel('o-batch', 'All batches', batches.map((b) => [b, b]), OS.f.batch)}
      ${sel('o-post', 'Any posting', Object.entries(POST_CATS).map(([k, [l]]) => [k, l]), OS.f.post)}
      <input class="input" type="search" id="o-pq" placeholder="Posting contains, e.g. Finance, Lucknow" value="${esc(OS.f.pq)}">
      ${sel('o-pay', 'Any pay level', pays.map((p) => [p, `Level ${p}`]), OS.f.pay)}
      ${sel('o-rec', 'Any recruitment', [['DR', 'Direct recruit'], ['SCS', 'Promoted (SCS)'], ['other', 'Selected (non-SCS)']], OS.f.rec)}
      ${withG ? `<button class="chip-toggle ${OS.f.women ? 'on' : ''}" id="o-women">Women</button>` : ''}
      <button class="chip-toggle" id="o-reset">Reset</button>
    </div>
    <div class="table-wrap"><table class="mp-table"><thead><tr id="o-head"></tr></thead><tbody id="o-body"></tbody></table></div>
    <div class="pager" id="o-pager"></div>
    <div class="card" style="margin-top:28px"><div class="eyebrow" style="margin-bottom:10px">Cadre strength</div>
      <ul class="party-bars">${strength.map(([c, n]) => `<li><b><button class="linkish" data-cadre="${c}">${esc(cadreName(c))}</button></b><span class="tr"><span style="width:${(n / strength[0][1]) * 100}%"></span></span><span class="num">${n}</span></li>`).join('')}</ul>
      <p class="majority">AGMUT serves Delhi, Goa, Arunachal Pradesh, Mizoram and the Union Territories; Assam-Meghalaya is a joint cadre. Jammu & Kashmir officers joined AGMUT in 2019.</p></div>
    <p class="src">Sources: ${ext(IAS.sources.civilList, 'DoPT IAS Civil List')} (name, identity no., batch, cadre, domicile, recruitment, qualification, pay level) and DoPT's public Executive Record Sheets on ${ext('https://supremo.dopt.gov.in', 'SUPREMO')} (posting history). Rebuilt ${fmtD(IAS.generated)}. Postings change often; the ER sheet is updated by the officer's cadre and may lag. Only official service data is shown.</p>`;
  const cols = [['#', null], ['Officer', 'name'], ['Cadre', 'cadre'], ['Batch', 'batch'], ['Current posting', 'since'], ['Pay', 'payLevel'], ['Retires', 'retires']];
  const draw = () => {
    const f = OS.f, q = f.q.trim().toLowerCase(), pq = f.pq.trim().toLowerCase(), cat = POST_CATS[f.post]?.[1];
    let rows = O.filter((o) => (!q || `${o.name} ${o.id}`.toLowerCase().includes(q)) && (!f.cadre || o.cadre === f.cadre) && (!f.batch || o.batch === +f.batch)
      && (!cat || cat(o)) && (!pq || (o.posting || '').toLowerCase().includes(pq)) && (!f.pay || o.payLevel === +f.pay)
      && (!f.rec || (f.rec === 'other' ? !['DR', 'SCS'].includes(o.recruitment) : o.recruitment === f.rec)) && (!f.women || o.gender === 'Female'));
    const k = OKEYS[OS.sort];
    rows = rows.sort((a, b) => { const x = k(a), y = k(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * OS.dir || OKEYS.name(a).localeCompare(OKEYS.name(b)); });
    const pages = Math.max(1, Math.ceil(rows.length / OS.per));
    OS.page = Math.min(OS.page, pages);
    $('#o-count').textContent = `${rows.length.toLocaleString('en-IN')} of ${O.length.toLocaleString('en-IN')} officers`;
    $('#o-head').innerHTML = cols.map(([l, key]) => `<th class="${['Batch', 'Pay'].includes(l) ? 'n' : ''} ${OS.sort === key ? 'sorted' : ''}">${key ? `<button data-k="${key}">${l}${OS.sort === key ? (OS.dir > 0 ? ' ↑' : ' ↓') : ''}</button>` : l}</th>`).join('');
    $('#o-body').innerHTML = rows.slice((OS.page - 1) * OS.per, OS.page * OS.per).map((o, i) => `<tr>
      <td class="muted num">${(OS.page - 1) * OS.per + i + 1}</td>
      <td><div class="who"><span class="avatar">${initials(o.name.replace(/^(shri|smt|ms|mr|mrs|dr)\.?\s+/i, ''))}</span><div><a href="#officer-${esc(o.id)}">${esc(o.name)}</a><small class="num">${esc(o.id)}${o.recruitment === 'SCS' ? ' · promoted' : ''}</small></div></div></td>
      <td>${esc(cadreName(o.cadre))}</td><td class="n">${o.batch ?? '—'}</td>
      <td style="max-width:420px">${esc(o.posting || '—')}${o.since ? `<small class="muted" style="display:block">since ${fmtD(o.since)}${o.centralDeputation ? ' · central deputation' : ''}</small>` : ''}</td>
      <td class="n">${o.payLevel ? `L${o.payLevel}` : '—'}</td><td class="num">${retTxt(o)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No officers match these filters.</td></tr>`;
    const pg = [];
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - OS.page) <= 2) pg.push(p); else if (pg[pg.length - 1] !== '…') pg.push('…');
    $('#o-pager').innerHTML = pages > 1 ? `<button ${OS.page === 1 ? 'disabled' : ''} data-p="${OS.page - 1}">‹</button>${pg.map((p) => (p === '…' ? '<span>…</span>' : `<button class="${p === OS.page ? 'on' : ''}" data-p="${p}">${p}</button>`)).join('')}<button ${OS.page === pages ? 'disabled' : ''} data-p="${OS.page + 1}">›</button>` : '';
    $$('#o-head button').forEach((b) => b.addEventListener('click', () => { const key = b.dataset.k; OS.dir = OS.sort === key ? -OS.dir : ['payLevel', 'since'].includes(key) ? -1 : 1; OS.sort = key; draw(); }));
    $$('#o-pager button').forEach((b) => b.addEventListener('click', () => { OS.page = +b.dataset.p; draw(); $('.table-wrap').scrollIntoView({ block: 'start' }); }));
  };
  const set = (key, v) => { OS.f[key] = v; OS.page = 1; draw(); };
  $('#o-q').addEventListener('input', (e) => set('q', e.target.value));
  $('#o-pq').addEventListener('input', (e) => set('pq', e.target.value));
  for (const key of ['cadre', 'batch', 'post', 'pay', 'rec']) $(`#o-${key}`).addEventListener('change', (e) => set(key, e.target.value));
  $('#o-women')?.addEventListener('click', (e) => { e.target.classList.toggle('on'); set('women', !OS.f.women); });
  $('#o-reset').addEventListener('click', () => { Object.assign(OS, { f: { ...DEFAULT_OF }, sort: 'batch', dir: 1, page: 1 }); services(); });
  $$('[data-cadre]').forEach((b) => b.addEventListener('click', () => { OS.f = { ...DEFAULT_OF, cadre: b.dataset.cadre }; OS.page = 1; services(); window.scrollTo(0, 0); }));
  draw();
}

async function officer([id]) {
  await loadIAS();
  const o = iasById.get(decodeURIComponent(id || ''));
  if (!o) return services();
  document.title = `${o.name} · IAS · Who Runs India`;
  const CO = window.IN.getCollectors?.() || {};
  const heads = Object.entries(CO.collectors || {}).flatMap(([st, ds]) => Object.entries(ds).filter(([, x]) => x.id === o.id).map(([d]) => [st, d]));
  const csOf = Object.entries(CO.chiefSecretaries || {}).find(([, x]) => x.id === o.id)?.[0];
  const stName = (c) => window.IN.getStates()?.states.find((s) => s.code === c)?.name || c;
  const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '');
  const recruit = { DR: 'Direct recruitment (UPSC Civil Services Examination)', SCS: 'Promotion from the State Civil Service' }[o.recruitment] || o.recruitment;
  app.innerHTML = `
    <div class="crumbs"><a href="#services">Officers</a> / ${esc(cadreName(o.cadre))} cadre</div>
    <div class="mp-profile">
      <div><span class="mp-photo avatar">${initials(o.name.replace(/^(shri|smt|ms|mr|mrs|dr)\.?\s+/i, ''))}</span></div>
      <div>
        <h1>${esc(o.name)}</h1>
        <div class="role">Indian Administrative Service · ${esc(cadreName(o.cadre))} cadre · ${o.batch} batch</div>
        <div class="badges"><span class="pill accent">IAS ${o.batch}</span><span class="pill">${esc(cadreName(o.cadre))}</span>${o.payLevel ? `<span class="pill">Pay Level ${o.payLevel}</span>` : ''}${o.recruitment ? `<span class="pill">${o.recruitment === 'DR' ? 'Direct recruit' : o.recruitment === 'SCS' ? 'Promoted' : esc(o.recruitment)}</span>` : ''}${o.centralDeputation ? '<span class="pill">Central deputation</span>' : ''}
          ${heads.map(([st, d]) => `<a class="pill accent" href="#state-${st}">Heads ${esc(d)} district, ${esc(stName(st))}</a>`).join('')}${csOf ? `<a class="pill accent" href="#state-${csOf}">Chief Secretary, ${esc(stName(csOf))}</a>` : ''}</div>
        <div class="grid g2">
          <div class="card"><div class="eyebrow" style="margin-bottom:6px">Current posting</div>
            <p style="font-weight:600;font-size:17px">${esc(o.posting || 'Not listed')}</p>
            <dl class="facts" style="margin-top:8px">${fact('Since', fmtD(o.since))}${fact('Field', o.field && o.field !== '/' ? o.field : '')}${fact('Remarks', o.remarks)}</dl></div>
          <div class="card"><div class="eyebrow" style="margin-bottom:6px">Service record</div>
            <dl class="facts">${fact('Identity no.', o.id)}${fact('Allotment year (batch)', o.batch)}${fact('Cadre', cadreName(o.cadre))}${fact('Domicile', o.domicile)}${fact('Recruitment', recruit)}${fact('Qualification', o.qualification)}${fact('Superannuation (age 60)', fmtYM(o.retires) + (o.retires && o.retires < new Date().toISOString().slice(0, 7) ? ' · serving on extension / re-employment' : ''))}${fact('ER sheet updated', fmtD(o.erUpdated))}</dl></div>
        </div>
        <div class="section-head" style="margin-top:28px"><h2>Posting history</h2><span class="note" id="h-note"></span></div>
        <div id="hist"><p class="muted">Loading…</p></div>
        <p class="src">From DoPT: ${ext(IAS.sources.civilList, 'IAS Civil List')}${o.er ? ` · ${ext(erUrl(o), 'Executive Record Sheet ↗')}` : ''}. Official service data only.</p>
      </div>
    </div>`;
  const H = (histCache[o.cadre] ??= fetch(`data/india/ias/${o.cadre}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  const rows = (await H)[o.id] || [];
  if (!$('#hist')) return;
  const today = new Date().toISOString().slice(0, 10);
  // An open-ended row is "now" only if it is the current posting; otherwise the ER sheet simply wasn't updated.
  const until = (from, to) => (to && to <= today ? fmtD(to) : from === o.since ? 'now' : '<span title="End date not recorded on the ER sheet">…</span>');
  const stale = rows[0] && o.since && (rows[0][0] || '') < o.since;
  $('#h-note').textContent = rows.length ? `${rows.length} postings${stale ? ' · ER sheet older than the Civil List posting above' : ''}` : '';
  $('#hist').innerHTML = rows.length ? `<div class="table-wrap"><table class="mp-table"><thead><tr><th>Period</th><th>Designation</th><th>Office / location</th><th>Level</th><th>Field</th></tr></thead><tbody>${rows.map(([from, to, des, lvl, office, org, fld]) => `<tr>
      <td class="num" style="white-space:nowrap">${fmtD(from) || '—'} – ${until(from, to)}</td><td><b>${esc(des)}</b><small class="muted" style="display:block">${esc(org)}</small></td><td>${esc(office)}</td><td>${esc(lvl)}</td><td>${esc(fld && fld !== '/' ? fld : '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No posting history published for this officer yet.</p>';
}
function companies() {
  document.title = 'Companies & CEOs · Who Runs India';
  app.innerHTML = `<div class="soon-box"><div class="eyebrow">Next section</div><h1>Companies & CEOs</h1>
    <p>India's largest listed companies and their leaders: CEO, chair, tenure, education, pay and company size, from stock-exchange filings and annual reports.</p>
    <a class="btn" href="#mps">Explore MPs meanwhile</a></div>`;
}
function sources() {
  document.title = 'Sources · Who Runs India';
  app.innerHTML = `<div style="max-width:760px"><h1>Sources & method</h1>
    <p class="prose" style="margin-top:14px">Every figure comes from a public record and links back to it. Nothing is estimated.</p>
    <ul class="src-list">
      <li><b>Lok Sabha members</b>: ${ext('https://sansad.in/ls/members', 'Sansad')} official members API: name, party, state, constituency, age, terms, education, profession, photo, official email.</li>
      <li><b>Assets, liabilities, criminal cases</b>: ${ext('https://www.myneta.info/LokSabha2024/', 'MyNeta (ADR)')}, summarising the affidavits candidates filed with the Election Commission in 2024. Criminal cases are pending cases the candidate declared, not convictions.</li>
      <li><b>Chief Ministers, Deputy CMs, Governors, LGs, assembly sizes</b>: Wikipedia's current-office lists (${ext('https://en.wikipedia.org/wiki/Chief_minister_(India)', 'Chief ministers')}, ${ext('https://en.wikipedia.org/wiki/List_of_current_Indian_lieutenant_governors_and_administrators', 'Governors & LGs')}, ${ext('https://en.wikipedia.org/wiki/State_legislative_assemblies_of_India', 'Assemblies')}).</li>
      <li><b>MLAs</b>: affidavits from each state's latest assembly election via ${ext('https://www.myneta.info/', 'MyNeta (ADR)')}.</li>
      <li><b>IAS officers</b>: DoPT's ${ext('https://iascivillist.dopt.gov.in/', 'IAS Civil List')} (identity no., batch, cadre, domicile, recruitment, qualification, pay level, posting) and each officer's public ${ext('https://supremo.dopt.gov.in', 'Executive Record Sheet (SUPREMO)')} for posting history. Full dates of birth, photos and personal contact details are not stored; only the superannuation month is shown.</li>
      <li><b>District Collectors / DMs / Deputy Commissioners</b>: matched from each IAS officer's current posting to the district list. A district shows no name if it is headed by a non-IAS officer or the officer's record has not been updated yet.</li>
      <li><b>Local government counts</b>: ${ext('https://lgdirectory.gov.in/', 'Local Government Directory (LGD)')}, Ministry of Panchayati Raj, "Report on State wise Administrative Units & Panchayati Raj Institutions".</li>
      <li><b>Police organisation</b>: ${ext('https://bprd.mha.gov.in/page/data_on_police_organization_dopo', 'Data on Police Organisations')}, Bureau of Police Research & Development (MHA): zones, ranges, police districts, sub-divisions, circles, police stations, outposts, commissionerates and the strength of every rank in each state, as reported by the states.</li>
      <li><b>Map</b>: state boundaries from ${ext('https://github.com/datameet/maps', 'DataMeet')} (official outline of India, CC BY 4.0); district headquarters from Wikipedia coordinates.</li>
      <li><b>Prime Ministers and Presidents</b>: Wikidata, via the ${ext('index.html#country-IND-leaders', 'World Governance Atlas')}.</li>
    </ul>
    <p class="note" style="margin-top:16px">Personal phone numbers and home addresses are published by Sansad but deliberately not shown here. The data is rebuilt automatically every day. ${DATA.mps.filter((m) => !m.affidavit).length} MPs have no matched affidavit summary yet.</p></div>`;
}

/* ---------- search ---------- */
function bindSearch(input, box) {
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    const hits = DATA.mps.filter((m) => `${m.name} ${m.constituency} ${m.party} ${m.partyName} ${m.state}`.toLowerCase().includes(q)).slice(0, 6);
    const ST = window.IN.getStates()?.states || [];
    const sts = ST.filter((x) => `${x.name} ${x.cm?.name || ''} ${x.governor?.name || ''}`.toLowerCase().includes(q)).slice(0, 4);
    const mlas = ST.flatMap((x) => x.mlas.filter((m) => `${m.name} ${m.constituency}`.toLowerCase().includes(q)).map((m) => [x, m])).slice(0, 5);
    if (!IAS && !bindSearch.iasLoading) { bindSearch.iasLoading = true; loadIAS().then(() => input.value.trim().length >= 2 && input.dispatchEvent(new Event('input'))); }
    const offs = (IAS?.officers || []).filter((o) => o.name.toLowerCase().includes(q)).slice(0, 4);
    box.innerHTML = (sts.length ? `<div class="sr-head">States & UTs</div>${sts.map((x) => `<a href="#state-${x.code}"><span class="sc-code">${x.code}</span><span><b>${esc(x.name)}</b><br><small class="muted">CM ${esc(x.cm?.name || '—')}</small></span></a>`).join('')}` : '')
      + (hits.length ? `<div class="sr-head">MPs</div>${hits.map((m) => `<a href="#mp-${m.id}">${photo(m)}<span><b>${esc(m.name)}</b><br><small class="muted">${esc(m.constituency)}, ${esc(m.state)}</small></span><span class="kind">${esc(m.party)}</span></a>`).join('')}` : '')
      + (mlas.length ? `<div class="sr-head">MLAs</div>${mlas.map(([x, m]) => `<a href="#state-${x.code}"><span class="avatar">${initials(m.name)}</span><span><b>${esc(m.name)}</b><br><small class="muted">MLA, ${esc(m.constituency)}, ${esc(x.name)}</small></span><span class="kind">${esc(m.party)}</span></a>`).join('')}` : '')
      + (offs.length ? `<div class="sr-head">IAS officers</div>${offs.map((o) => `<a href="#officer-${esc(o.id)}"><span class="avatar">${initials(o.name.replace(/^(shri|smt|ms|mr|mrs|dr)\.?\s+/i, ''))}</span><span><b>${esc(o.name)}</b><br><small class="muted">${esc((o.posting || '').slice(0, 60))}</small></span><span class="kind">${esc(cadreName(o.cadre))} ${o.batch}</span></a>`).join('')}` : '')
      || '<div class="sr-head">No matches</div>';
    box.hidden = false;
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('a', box); if (a) location.hash = a.getAttribute('href'); } if (e.key === 'Escape') box.hidden = true; });
  box.addEventListener('click', () => { box.hidden = true; input.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search, .big-search')) box.hidden = true; });
}

$('#theme').addEventListener('click', () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('wga-theme', r.dataset.theme); } catch (e) {}
});
load().then(() => loadStates()).then(() => bindSearch($('#search'), $('#search-results')));
router();
