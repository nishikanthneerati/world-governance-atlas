// Structure, States, State pages and Elections for Who Runs India. Loaded as a classic script before india.js; exposes window.IN.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ext = (href, t) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(t)}</a>`;
  const wiki = (t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(String(t).replace(/ /g, '_'))}`;
  const inr = (n) => (n == null ? '—' : n >= 1e7 ? `₹${(n / 1e7).toFixed(n >= 1e9 ? 0 : 1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${n.toLocaleString('en-IN')}`);
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const ini = (n) => esc((n || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
  const face = (p, cls = 'avatar') => (p?.img ? `<img class="${cls}" src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;${cls}&quot;>${ini(p.name)}</span>'">` : `<span class="${cls}">${ini(p?.name)}</span>`);
  const TYPE = { S: 'State', U: 'Union territory with legislature', X: 'Union territory' };
  let ST = null, UN = null;

  async function loadStates() {
    if (!ST) [ST, UN] = await Promise.all([fetch('data/india/states.json').then((r) => r.json()), fetch('data/india/union.json').then((r) => r.json()).catch(() => ({}))]);
    return ST;
  }
  const wl = (p) => (p.wiki ? `<a href="${wiki(p.wiki)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name));
  const smallTable = (cols, rows) => `<div class="table-wrap"><table class="mp-table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${cols.length}" class="empty">None listed</td></tr>`}</tbody></table></div>`;

  /* ---------------------------------------------------------------- union government */
  let rsFilter = { state: '', party: '', q: '' };
  function union(app, D) {
    document.title = 'Union Government · Who Runs India';
    const M = UN.ministers || [];
    const ranks = ['Cabinet Minister', 'Minister of State (Independent Charge)', 'Minister of State'];
    const mpByName = (n) => D.mps.find((m) => m.name.toLowerCase() === n.toLowerCase());
    const minCard = (m) => { const mp = mpByName(m.name); return `<div class="min-card"><div class="mc-top">${face({ name: m.name, img: mp?.photo })}<div><div class="n">${mp ? `<a href="#mp-${mp.id}">${esc(m.name)}</a>` : wl(m)}</div><div class="s">${esc(m.party)}${mp ? ` · MP, ${esc(mp.constituency)}` : ''}</div></div></div><ul>${m.portfolios.flatMap((x) => x.split(/\s(?=(?:Minister|Department|Ministry) of\b)|;\s*and\s+/)).map((x) => `<li>${esc(x.trim())}</li>`).join('')}</ul></div>`; };
    const RS = UN.rajyaSabha || [];
    const rsParties = [...new Set(RS.map((x) => x.party).filter(Boolean))].sort();
    const rsStates = [...new Set(RS.map((x) => x.stateLabel))].sort();
    app.innerHTML = `
      <div class="screener-head"><div><div class="eyebrow">Union government</div><h1>Who runs the Government of India</h1>
      <p class="muted" style="margin-top:6px">The President, the Prime Minister and ${M.length} ministers in the Union Council of Ministers, plus all ${RS.length} members of the Rajya Sabha.</p></div></div>
      <div class="grid g3" style="margin:20px 0">
        <a class="now-card" href="index.html#country-IND-leaders"><span class="avatar lg">DM</span><div><div class="t">President of India</div><div class="n">Droupadi Murmu</div><div class="s">Head of state · since 25 Jul 2022</div></div></a>
        <a class="now-card" href="#mp-4589">${face({ name: 'Narendra Modi', img: 'data/india/photos/4589.jpg' }, 'avatar lg')}<div><div class="t">Prime Minister</div><div class="n">Narendra Modi</div><div class="s">Head of government · since 26 May 2014</div></div></a>
        <a class="now-card" href="#elections"><span class="avatar lg">${M.length}</span><div><div class="t">Union Council of Ministers</div><div class="n">${M.filter((m) => m.rank === ranks[0]).length} Cabinet · ${M.filter((m) => m.rank !== ranks[0]).length} MoS</div><div class="s">${esc(UN.ministrySource || '')}</div></div></a>
      </div>
      ${ranks.map((r) => { const list = M.filter((m) => m.rank === r); return list.length ? `<div class="cat-head"><h3>${r}s</h3><span class="pill">${list.length}</span></div><div class="grid g3">${list.map(minCard).join('')}</div>` : ''; }).join('')}
      <div class="section-head" style="margin-top:40px"><h2>Rajya Sabha (Council of States)</h2><span class="note" id="rs-count"></span></div>
      <div class="filters"><input class="input" type="search" id="rs-q" placeholder="Name"><select id="rs-s" aria-label="State"><option value="">All states</option>${rsStates.map((x) => `<option>${esc(x)}</option>`).join('')}</select><select id="rs-p" aria-label="Party"><option value="">All parties</option>${rsParties.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div id="rs-table"></div>
      <p class="src">Ministers and portfolios from ${ext(wiki(UN.ministrySource || 'Union Council of Ministers'), `Wikipedia: ${UN.ministrySource || 'Union Council of Ministers'}`)}; Rajya Sabha from ${ext(wiki('List of current members of the Rajya Sabha'), 'Wikipedia: current members of the Rajya Sabha')}. Official records: ${ext('https://cabsec.gov.in', 'Cabinet Secretariat')}, ${ext('https://sansad.in/rs', 'Sansad (Rajya Sabha)')}.</p>`;
    const draw = () => {
      const q = rsFilter.q.toLowerCase();
      const rows = RS.filter((x) => (!rsFilter.state || x.stateLabel === rsFilter.state) && (!rsFilter.party || x.party === rsFilter.party) && (!q || x.name.toLowerCase().includes(q)));
      $('#rs-count').textContent = `${rows.length} of ${RS.length} members`;
      $('#rs-table').innerHTML = smallTable(['Member', 'Party', 'State', 'Term'], rows.map((x) => `<tr><td><b>${wl(x)}</b></td><td><span class="ptag">${esc(x.party || '—')}</span></td><td>${x.state ? `<a href="#state-${x.state}">${esc(x.stateLabel)}</a>` : esc(x.stateLabel)}</td><td class="num">${esc(x.termStart || '')} – ${esc(x.termEnd || '')}</td></tr>`));
    };
    $('#rs-q').addEventListener('input', (e) => { rsFilter.q = e.target.value; draw(); });
    $('#rs-s').addEventListener('change', (e) => { rsFilter.state = e.target.value; draw(); });
    $('#rs-p').addEventListener('change', (e) => { rsFilter.party = e.target.value; draw(); });
    draw();
  }

  /* ---------------------------------------------------------------- police */
  function police(app) {
    document.title = 'Police chiefs · Who Runs India';
    const P = (UN.police || []).slice().sort((a, b) => a.place.localeCompare(b.place));
    app.innerHTML = `
      <div class="screener-head"><div><div class="eyebrow">Police</div><h1>Who heads the police in every state</h1>
      <p class="muted" style="margin-top:6px">Police is a state subject: each state and UT has its own force, headed by a Director General of Police (DGP) from the Indian Police Service.</p></div></div>
      <div class="grid g4" style="margin:20px 0">${P.map((x) => `<a class="leader-card" href="${x.state ? `#state-${x.state}` : '#'}"><span class="sc-code">${esc(x.state || '—')}</span><div><div class="t">${esc(x.rank || 'DGP')}, ${esc(x.place)}</div><div class="n">${esc(x.name)}</div><div class="c">IPS${x.batch ? ` · ${esc(x.batch)} batch` : ''}${x.hq ? ` · HQ ${esc(x.hq)}` : ''}</div></div></a>`).join('')}</div>
      <div class="card"><div class="eyebrow">Ranks, top to bottom</div><p style="margin-top:6px">DGP → ADGP → IGP → DIG → SP / SSP (district) → ASP / DSP → Inspector (SHO, police station) → Sub-Inspector → ASI → Head Constable → Constable. Metropolitan cities have a Commissioner of Police instead of an SP. <a href="#structure">See the full structure →</a></p></div>
      <p class="src">From ${ext(wiki('Director general of police'), 'Wikipedia: Director general of police')}. District SPs and station officers need the state police rosters, which are on the to-do list.</p>`;
  }
  const mpsOf = (name, mps) => mps.filter((m) => m.state.toLowerCase().replace(/&/g, 'and') === name.toLowerCase());

  /* ---------------------------------------------------------------- structure */
  const tier = (title, rows, note) => `<section class="tier"><h2>${title}</h2>${note ? `<p class="tier-note">${note}</p>` : ''}<div class="ladder">${rows.map(([role, how, who, href]) => `
      <div class="rung"><div class="rung-role">${href ? `<a href="${href}">${role}</a>` : role}</div><div class="rung-how">${how}</div>${who ? `<div class="rung-who">${who}</div>` : ''}</div>`).join('')}</div></section>`;

  function structure(app, D) {
    document.title = 'How India is governed · Who Runs India';
    const S = ST.states, mlaSeats = S.reduce((s, x) => s + (x.assembly?.seats || 0), 0), mlas = S.reduce((s, x) => s + x.mlas.length, 0);
    const pm = 'Narendra Modi';
    app.innerHTML = `
      <div class="structure-head"><div class="eyebrow">How India is governed</div><h1>From the President to the Gram Panchayat</h1>
      <p class="lede">India has three tiers of elected government (Union, State and local), each with its own executive, legislature and civil service. Tap a tier to jump; tap any office in blue to see who holds it.</p>
      <div class="tier-nav"><a href="#t-union">Union</a><a href="#t-state">State</a><a href="#t-district">District</a><a href="#t-rural">Rural local</a><a href="#t-urban">Urban local</a><a href="#t-police">Police</a><a href="#t-courts">Courts</a><a href="#t-elections">Who runs elections</a></div></div>
      <div id="t-union">${tier('1 · Union (national) government', [
        ['President', 'Head of state. Elected for 5 years by an electoral college of all elected MPs and MLAs.', 'Droupadi Murmu', 'index.html#country-IND-leaders'],
        ['Vice-President', 'Elected for 5 years by all MPs. Chairs the Rajya Sabha.', null],
        ['Prime Minister & Union Council of Ministers', 'The PM leads the party or coalition with a Lok Sabha majority. Ministers are appointed by the President on the PM\'s advice and must be MPs within 6 months.', `${(UN.ministers || []).length} ministers`, '#union'],
        ['Lok Sabha (House of the People)', `543 elected seats, one per constituency, for 5 years. ${D.mps.length} members sitting now.`, `${D.mps.length} MPs`, '#mps'],
        ['Rajya Sabha (Council of States)', 'Up to 250 members: elected by state MLAs plus 12 nominated by the President. 6-year terms; one-third retire every 2 years, so it is never dissolved.', `${(UN.rajyaSabha || []).length} members`, '#union'],
        ['Union civil service', 'Cabinet Secretary (senior-most civil servant) → Secretaries to the Government of India → Additional / Joint Secretaries → Directors.', null, '#services'],
      ])}</div>
      <div id="t-state">${tier('2 · State government', [
        ['Governor', 'Head of the state. Appointed by the President for 5 years. In Union Territories this role is held by a Lieutenant Governor or Administrator.', `${S.filter((x) => x.governor).length} listed`, '#states'],
        ['Chief Minister & Council of Ministers', 'The CM leads the majority in the Legislative Assembly. The council can have at most 15% of the assembly\'s strength.', `${S.filter((x) => x.cm).length} CMs`, '#states'],
        ['Legislative Assembly (Vidhan Sabha)', `Directly elected MLAs, 5-year term. ${mlaSeats.toLocaleString('en-IN')} seats across ${S.filter((x) => x.assembly).length} assemblies.`, `${mlas.toLocaleString('en-IN')} MLAs with affidavits`, '#states'],
        ['Legislative Council (Vidhan Parishad)', 'Upper house in 6 states only: Andhra Pradesh, Bihar, Karnataka, Maharashtra, Telangana and Uttar Pradesh. MLCs serve 6 years, one-third retiring every 2 years; elected by MLAs, local bodies, graduates and teachers, plus nominees.', `${Object.values(UN.councils || {}).reduce((a, x) => a + x.length, 0)} MLCs`, '#states'],
        ['Chief Secretary', 'Senior-most IAS officer of the state; heads the state civil service and secretariat.', null, '#services'],
        ['Director General of Police (DGP)', 'Head of the state police force, an IPS officer.', `${(UN.police || []).length} DGPs`, '#police'],
      ])}</div>
      <div id="t-district">${tier('3 · District administration', [
        ['District Collector / District Magistrate', 'IAS officer who heads the district: revenue, law and order, elections and development.', `${Object.values(UN.districts || {}).reduce((a, x) => a + x.length, 0)} districts`, '#states'],
        ['Superintendent of Police (SP)', 'IPS officer who heads district police. Big cities have a Commissioner of Police instead.', null],
        ['Sub-Divisional Magistrate (SDM)', 'Heads a sub-division of the district.', null],
        ['Tehsildar / Mamlatdar / Talukdar', 'Heads a tehsil or taluka: land records, revenue and certificates.', null],
        ['Block Development Officer (BDO)', 'Runs rural development schemes in a block and works with the Panchayat Samiti.', null],
      ], `India has ${Object.values(UN.districts || {}).reduce((a, x) => a + x.length, 0)} districts; each state page lists them.`)}</div>
      <div id="t-rural">${tier('4 · Rural local government (Panchayati Raj)', [
        ['Zila Parishad (district)', 'Elected district council. Chairperson often called Zila Parishad Adhyaksha or President; a CEO (often IAS) runs its administration.', null],
        ['Panchayat Samiti (block)', 'Elected council for a block of villages; head called Pradhan or Chairperson.', null],
        ['Gram Panchayat (village)', 'Elected village council led by a Sarpanch / Mukhiya / Pradhan, with ward members (Panch). About 2.5 lakh Gram Panchayats nationwide.', null],
        ['Gram Sabha', 'Every adult voter in the village. Approves plans and audits the Panchayat.', null],
      ], 'Set up by the 73rd Constitutional Amendment (1992). 5-year terms; at least one-third of seats reserved for women (50% in many states), with SC/ST reservation.')}</div>
      <div id="t-urban">${tier('5 · Urban local government', [
        ['Municipal Corporation', 'Large cities. Elected councillors (corporators) and a Mayor; a Municipal Commissioner (IAS) runs the administration.', null],
        ['Municipal Council (Nagar Palika)', 'Smaller cities and towns, led by a Chairperson.', null],
        ['Nagar Panchayat', 'Areas moving from rural to urban.', null],
        ['Ward', 'Each city is divided into wards, each electing one councillor.', null],
      ], 'Set up by the 74th Constitutional Amendment (1992). Elections every 5 years.')}</div>
      <div id="t-police">${tier('6 · Police ranks (state police)', [
        ['DGP', 'Director General of Police: head of the state force.', null],
        ['ADGP → IGP → DIG', 'Additional DGP, Inspector General and Deputy Inspector General: zones and ranges.', null],
        ['SP / SSP', 'Superintendent of Police: heads a district.', null],
        ['ASP / DSP', 'Additional or Deputy Superintendent: sub-division.', null],
        ['Inspector (SHO)', 'Usually the Station House Officer in charge of a police station.', null],
        ['Sub-Inspector → ASI → Head Constable → Constable', 'Station-level ranks.', null],
      ], 'Police is a state subject. Officers from DSP upward are mostly from the IPS or the State Police Service.')}</div>
      <div id="t-courts">${tier('7 · Courts', [
        ['Supreme Court', 'Chief Justice of India and up to 33 other judges.', null],
        ['High Courts', '25 High Courts, some covering more than one state or UT.', null],
        ['District & Sessions Courts', 'Civil and criminal courts in each district, with subordinate courts below.', null],
      ])}</div>
      <div id="t-elections">${tier('Who runs elections', [
        ['Election Commission of India', 'President, Vice-President, Lok Sabha, Rajya Sabha, State Assemblies and Legislative Councils.', null, '#elections'],
        ['State Election Commissions', 'One per state: Panchayat and Municipal elections. Their dates vary state by state.', null],
      ])}</div>
      <p class="src">Constitutional structure as set out in the Constitution of India (Parts V, VI, IX and IX-A). Office-holder counts are from this site's data.</p>`;
  }

  /* ---------------------------------------------------------------- states */
  function stateCard(s, D) {
    const ls = mpsOf(s.name, D.mps).length;
    return `<a class="state-card" href="#state-${s.code}">
      <div class="sc-top"><div><div class="sc-name">${esc(s.name)}</div><div class="sc-type">${TYPE[s.type]}${s.council ? ' · Bicameral' : ''}</div></div><span class="sc-code">${s.code}</span></div>
      ${s.cm ? `<div class="sc-person">${face(s.cm)}<div><span class="r">Chief Minister</span>${esc(s.cm.name)}</div></div>` : ''}
      ${s.governor ? `<div class="sc-person small">${face(s.governor)}<div><span class="r">${esc(s.governor.title)}</span>${esc(s.governor.name)}</div></div>` : '<div class="sc-person small"><div><span class="r">Administered by</span>Union Government</div></div>'}
      <div class="sc-kv">${s.assembly ? `<span><b>${s.assembly.seats}</b>MLA seats</span>` : ''}<span><b>${ls}</b>Lok Sabha MPs</span>${s.lastElection ? `<span><b>${s.nextElectionDue}</b>next election due</span>` : ''}</div>
    </a>`;
  }
  let stateFilter = 'all';
  function states(app, D) {
    document.title = 'States & UTs · Who Runs India';
    const S = ST.states;
    app.innerHTML = `
      <div class="screener-head"><div><h1>States & Union Territories</h1><p class="muted" style="margin-top:6px">28 states and 8 union territories: who leads each, how big its legislature is, and when it votes next.</p></div></div>
      <div class="toolbar" style="margin-top:16px"><div class="seg" id="sf">${[['all', 'All 36'], ['S', 'States'], ['U', 'UTs with legislature'], ['X', 'Other UTs'], ['bi', 'Bicameral']].map(([k, l]) => `<button data-k="${k}" class="${k === stateFilter ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="input" id="sq" placeholder="Find a state or CM" style="flex:1 1 200px"></div>
      <div class="grid g4" id="slist"></div>`;
    const draw = () => {
      const q = $('#sq').value.trim().toLowerCase();
      const list = S.filter((s) => (stateFilter === 'all' || s.type === stateFilter || (stateFilter === 'bi' && s.council)) && (!q || `${s.name} ${s.cm?.name || ''} ${s.governor?.name || ''}`.toLowerCase().includes(q)));
      $('#slist').innerHTML = list.map((s) => stateCard(s, D)).join('') || '<div class="empty">No match</div>';
    };
    $$('#sf button').forEach((b) => b.addEventListener('click', () => { stateFilter = b.dataset.k; $$('#sf button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#sq').addEventListener('input', draw);
    draw();
  }

  /* ---------------------------------------------------------------- state page */
  const MS = { q: '', party: '', sort: 'assets', dir: -1, page: 1 };
  function state(app, D, code) {
    const s = ST.states.find((x) => x.code === code);
    if (!s) return states(app, D);
    document.title = `${s.name} · Who Runs India`;
    const ls = mpsOf(s.name, D.mps).sort((a, b) => a.constituency.localeCompare(b.constituency));
    const parties = Object.entries(s.mlas.reduce((o, m) => ((o[m.party] = (o[m.party] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]);
    const withCases = s.mlas.filter((m) => m.criminalCases > 0).length;
    const crore = s.mlas.filter((m) => m.assets >= 1e7).length;
    const card = (p, role) => p ? `<a class="now-card" href="${p.wiki ? wiki(p.wiki) : '#'}" target="_blank" rel="noopener">${face(p, 'avatar lg')}<div><div class="t">${esc(role)}</div><div class="n">${esc(p.name)}</div><div class="s">${[p.party, p.since && `since ${fmt(p.since)}`].filter(Boolean).map(esc).join(' · ')}</div></div></a>` : '';
    Object.assign(MS, { q: '', party: '', sort: 'assets', dir: -1, page: 1 });
    app.innerHTML = `
      <div class="crumbs"><a href="#states">States & UTs</a> / ${TYPE[s.type]}</div>
      <div class="country-head"><div><h1>${esc(s.name)}</h1><div class="meta">
        <span class="pill accent">${TYPE[s.type]}</span>${s.assembly?.rulingParty ? `<span class="pill">Ruling: ${esc(s.assembly.rulingParty)}</span>` : ''}${s.council ? '<span class="pill">Bicameral legislature</span>' : ''}</div></div></div>
      <h2 style="margin:28px 0 12px">Who leads ${esc(s.name)}</h2>
      <div class="grid g3">${card(s.governor, s.governor?.title || 'Governor')}${card(s.cm, 'Chief Minister')}${s.deputyCms.map((d) => card(d, 'Deputy Chief Minister')).join('')}
        ${!s.cm && !s.governor ? '<div class="card note">Administered directly by the Union Government through an Administrator appointed by the President.</div>' : ''}</div>

      <div class="grid g3" style="margin-top:20px">
        ${s.assembly ? `<div class="card"><div class="eyebrow">Legislative Assembly</div><div class="big num" style="margin-top:6px">${s.assembly.seats} seats</div>
          <dl class="facts" style="margin-top:8px">${f('Term', s.assembly.term)}${f('Ruling party', s.assembly.rulingParty)}${f('Majority mark', Math.floor(s.assembly.seats / 2) + 1)}${s.council ? f('Legislative Council', `${s.council.seats} MLC seats`) : ''}</dl></div>` : ''}
        <div class="card"><div class="eyebrow">Elections</div><dl class="facts" style="margin-top:8px">
          ${s.lastElection ? f('Last assembly election', s.lastElection) + f('Next due', `by ${s.nextElectionDue}`) : f('Assembly', 'None')}
          ${f('Lok Sabha', '2024 · next due by 2029')}
          ${f('Panchayat & municipal', 'Held by the State Election Commission')}</dl></div>
        <div class="card"><div class="eyebrow">In Parliament</div><div class="big num" style="margin-top:6px">${ls.length} Lok Sabha MPs</div>
          <p class="note" style="margin-top:8px"><a href="#mps" id="state-mps">Open them in the MP screener →</a></p></div>
      </div>

      ${(() => {
        const dg = (UN.police || []).find((x) => x.state === s.code);
        const rs = (UN.rajyaSabha || []).filter((x) => x.state === s.code);
        const mlc = (UN.councils || {})[s.code] || [];
        const ds = (UN.districts || {})[s.code] || [];
        return `
        <div class="grid g3" style="margin-top:20px">
          ${dg ? `<div class="card"><div class="eyebrow">Police chief</div><div class="n" style="font-weight:700;font-size:18px;margin-top:6px">${esc(dg.name)}</div><p class="note">${esc(dg.rank || 'DGP')} · IPS ${esc(dg.batch || '')} batch${dg.hq ? ` · HQ ${esc(dg.hq)}` : ''}</p><a class="note" href="#police">All police chiefs →</a></div>` : ''}
          <div class="card"><div class="eyebrow">Districts</div><div class="big num" style="margin-top:6px">${ds.length}</div><p class="note">Each run by a District Collector / Magistrate (IAS) with a Superintendent of Police (IPS).</p><a class="note" href="#dists">See all districts ↓</a></div>
          <div class="card"><div class="eyebrow">Rajya Sabha</div><div class="big num" style="margin-top:6px">${rs.length} members</div><p class="note">Elected by the state's MLAs for 6-year terms.</p><a class="note" href="#rsm">See them ↓</a></div>
        </div>
        ${mlc.length ? `<div class="section-head" style="margin-top:36px"><h2>Legislative Council (MLCs)</h2><span class="note">${mlc.length} of ${s.council?.seats || '?'} seats listed</span></div>
          ${smallTable(['Member', 'Party', 'Seat / elected by', 'Term ends'], mlc.map((x) => `<tr><td><b>${wl(x)}</b></td><td><span class="ptag">${esc(x.party || '—')}</span></td><td>${esc(x.seat)}</td><td class="num">${esc(x.termEnd || '')}</td></tr>`))}
          <p class="src">From ${ext(wiki(`${s.name} Legislative Council`), `Wikipedia: ${s.name} Legislative Council`)}.</p>` : ''}
        <div class="section-head" style="margin-top:36px" id="rsm"><h2>Rajya Sabha members from ${esc(s.name)}</h2></div>
        ${smallTable(['Member', 'Party', 'Term'], rs.map((x) => `<tr><td><b>${wl(x)}</b></td><td><span class="ptag">${esc(x.party || '—')}</span></td><td class="num">${esc(x.termStart || '')} – ${esc(x.termEnd || '')}</td></tr>`))}
        <div class="section-head" style="margin-top:36px" id="dists"><h2>Districts of ${esc(s.name)}</h2><span class="note">${ds.length} districts</span></div>
        <div class="district-grid">${ds.map((d) => `<div class="district"><b>${d.wiki ? `<a href="${wiki(d.wiki)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</b>${d.hq && d.hq !== d.name ? `<span>HQ ${esc(d.hq)}</span>` : ''}</div>`).join('')}</div>
        <p class="src">From ${ext(wiki('List of districts in India'), 'Wikipedia: List of districts in India')}. Collectors and SPs for each district are coming with the officer data.</p>`;
      })()}

      ${s.mlas.length ? `
      <div class="section-head" style="margin-top:36px"><h2>MLAs (${s.lastElection} election)</h2><span class="note">${s.mlas.length} affidavits · ${withCases} declared criminal cases · ${crore} crorepatis</span></div>
      <div class="card" style="margin-bottom:16px"><ul class="party-bars">${parties.slice(0, 8).map(([p, n]) => `<li><b>${esc(p)}</b><span class="tr"><span style="width:${(n / parties[0][1]) * 100}%"></span></span><span class="num">${n}</span></li>`).join('')}</ul>
        <p class="majority">Party seats among MLAs with affidavit data. Defections and by-elections since ${s.lastElection} are not reflected.</p></div>
      <div class="filters"><input class="input" type="search" id="m-q" placeholder="Name, constituency or party"><select id="m-p" aria-label="Party"><option value="">All parties</option>${parties.map(([p]) => `<option>${esc(p)}</option>`).join('')}</select>
        <button class="chip-toggle" id="m-c">Criminal cases</button></div>
      <div class="table-wrap"><table class="mp-table"><thead><tr id="m-head"></tr></thead><tbody id="m-body"></tbody></table></div>
      <div class="pager" id="m-pager"></div>
      <p class="src">MLA affidavits via ${ext(`https://www.myneta.info/${s.mynetaSlug}/`, `MyNeta, ${s.name} ${s.lastElection}`)}. Criminal cases are pending cases, not convictions.</p>` : ''}

      <div class="section-head" style="margin-top:36px"><h2>Lok Sabha MPs from ${esc(s.name)}</h2></div>
      <div class="grid g4">${ls.map((m) => `<a class="leader-card" href="#mp-${m.id}">${face({ name: m.name, img: m.photo })}<div><div class="t">${esc(m.party)} · ${esc(m.constituency)}</div><div class="n">${esc(m.name)}</div></div></a>`).join('') || '<p class="muted">None</p>'}</div>
      <p class="src">Leaders from Wikipedia (${ext(wiki('Chief minister (India)'), 'Chief Ministers')}, ${ext(wiki('List of current Indian lieutenant governors and administrators'), 'Governors')}); assembly sizes from ${ext(wiki('State legislative assemblies of India'), 'Wikipedia')}.</p>`;
    $('#state-mps')?.addEventListener('click', () => window.IN_setStateFilter?.(s.name));
    if (s.mlas.length) mlaTable(s);
  }
  const f = (k, v) => (v || v === 0 ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '');

  function mlaTable(s) {
    let cases = false;
    const cols = [['MLA', 'name'], ['Constituency', 'constituency'], ['Party', 'party'], ['Education', null], ['Assets', 'assets'], ['Liabilities', 'liabilities'], ['Cases', 'criminalCases']];
    const draw = () => {
      const q = MS.q.toLowerCase();
      let rows = s.mlas.filter((m) => (!q || `${m.name} ${m.constituency} ${m.party}`.toLowerCase().includes(q)) && (!MS.party || m.party === MS.party) && (!cases || m.criminalCases > 0));
      rows = rows.sort((a, b) => { const x = a[MS.sort] ?? -1, y = b[MS.sort] ?? -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * MS.dir; });
      const per = 40, pages = Math.max(1, Math.ceil(rows.length / per));
      MS.page = Math.min(MS.page, pages);
      $('#m-head').innerHTML = cols.map(([l, k]) => `<th class="${['Assets', 'Liabilities', 'Cases'].includes(l) ? 'n' : ''}">${k ? `<button data-k="${k}">${l}${MS.sort === k ? (MS.dir > 0 ? ' ↑' : ' ↓') : ''}</button>` : l}</th>`).join('');
      $('#m-body').innerHTML = rows.slice((MS.page - 1) * per, MS.page * per).map((m) => `<tr>
        <td><b>${m.id ? ext(`https://www.myneta.info/${s.mynetaSlug}/candidate.php?candidate_id=${m.id}`, m.name) : esc(m.name)}</b></td><td>${esc(m.constituency)}</td><td><span class="ptag">${esc(m.party)}</span></td>
        <td>${esc(m.education)}</td><td class="n">${inr(m.assets)}</td><td class="n">${inr(m.liabilities)}</td><td class="n"><span class="cases ${m.criminalCases ? '' : 'zero'}">${m.criminalCases}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No MLAs match</td></tr>';
      $('#m-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === MS.page ? 'on' : ''}" data-p="${i + 1}">${i + 1}</button>`).join('') : '';
      $$('#m-head button').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.k; MS.dir = MS.sort === k ? -MS.dir : ['assets', 'liabilities', 'criminalCases'].includes(k) ? -1 : 1; MS.sort = k; draw(); }));
      $$('#m-pager button').forEach((b) => b.addEventListener('click', () => { MS.page = +b.dataset.p; draw(); }));
    };
    $('#m-q').addEventListener('input', (e) => { MS.q = e.target.value; MS.page = 1; draw(); });
    $('#m-p').addEventListener('change', (e) => { MS.party = e.target.value; MS.page = 1; draw(); });
    $('#m-c').addEventListener('click', (e) => { cases = !cases; e.target.classList.toggle('on', cases); MS.page = 1; draw(); });
    draw();
  }

  /* ---------------------------------------------------------------- elections */
  function elections(app) {
    document.title = 'Elections · Who Runs India';
    const rows = ST.states.filter((s) => s.lastElection).sort((a, b) => a.nextElectionDue - b.nextElectionDue || a.name.localeCompare(b.name));
    const now = new Date().getFullYear();
    const groups = {};
    for (const s of rows) (groups[s.nextElectionDue] ??= []).push(s);
    app.innerHTML = `
      <div class="screener-head"><div><h1>Election calendar</h1><p class="muted" style="margin-top:6px">When each legislature next goes to the polls. Assemblies sit for 5 years, so an election falls due by the fifth year after the last one; exact dates are announced by the Election Commission.</p></div></div>
      <div class="grid g3" style="margin:20px 0">
        <div class="card"><div class="eyebrow">Lok Sabha</div><div class="big">Due by 2029</div><p class="note">Last held April–June 2024.</p></div>
        <div class="card"><div class="eyebrow">Rajya Sabha</div><div class="big">Every 2 years</div><p class="note">One-third of members retire biennially; elected by MLAs.</p></div>
        <div class="card"><div class="eyebrow">President & Vice-President</div><div class="big">Due 2027</div><p class="note">5-year terms; elected by MPs (and MLAs for President).</p></div>
      </div>
      ${Object.entries(groups).map(([y, list]) => `<div class="cat-head"><h3>${y}${+y <= now ? ' · due now or overdue' : ''}</h3><span class="pill">${list.length} assembl${list.length > 1 ? 'ies' : 'y'}</span></div>
        <div class="grid g4">${list.map((s) => `<a class="leader-card" href="#state-${s.code}"><span class="sc-code">${s.code}</span><div><div class="t">Last election ${s.lastElection}${s.assembly ? ` · ${s.assembly.seats} seats` : ''}</div><div class="n">${esc(s.name)}</div><div class="c">${esc(s.assembly?.rulingParty || '')}</div></div></a>`).join('')}</div>`).join('')}
      <div class="card" style="margin-top:28px"><div class="eyebrow">Panchayat and municipal elections</div><p style="margin-top:6px">These are run by each state's own State Election Commission, on dates that differ by state. They are not yet in this calendar.</p></div>
      <p class="src">Last-election years from the affidavit records on MyNeta. Early dissolution or President's Rule can move a date.</p>`;
  }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  window.IN = { loadStates, structure, states, state, elections, union, police, getStates: () => ST, getUnion: () => UN };
})();
