// Police: India -> State/UT -> District drill-down with a clickable map. Loaded after india-states.js; replaces window.IN.police.
// Views: #police (India), #police-UP (state), #police-UP-Agra (district). Data: police.json (BPR&D DoPO), ips.json (MHA IPS
// Civil List), union.json (DGPs, districts), collectors.json (IAS district heads), map.json (DataMeet outlines), police-stations/<CODE>.json (optional).
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ext = (href, t) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(t)}</a>`;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const pct = (a, b) => (a != null && b ? Math.round((a / b) * 100) : null);
  const cache = {};
  const json = (u) => (cache[u] ??= fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null));

  // IPS cadre serving each state/UT (joint cadres AGMUT and Assam-Meghalaya).
  const CADRE_OF = { AR: 'AGMUT', GA: 'AGMUT', MZ: 'AGMUT', DL: 'AGMUT', JK: 'AGMUT', LA: 'AGMUT', PY: 'AGMUT', AN: 'AGMUT', CH: 'AGMUT', DN: 'AGMUT', LD: 'AGMUT', AS: 'Assam-Meghalaya', ML: 'Assam-Meghalaya' };
  const PLACE_RX = { AR: /arunachal/i, GA: /\bgoa\b/i, MZ: /mizoram|aizawl/i, DL: /delhi/i, JK: /j\s*&\s*k|jammu|kashmir|srinagar/i, LA: /ladakh|leh|kargil/i, PY: /puducherry|pondicherry/i, AN: /andaman|nicobar|port blair/i, CH: /chandigarh/i, DN: /daman|diu|dadra|silvassa/i, LD: /lakshadweep|kavaratti/i, AS: /assam|guwahati/i, ML: /meghalaya|shillong/i };
  const LEVELS = [
    ['zones', 'Police zones', 'ADGP / IGP', 'A zone groups several ranges, headed by an Additional DGP or Inspector General.'],
    ['ranges', 'Police ranges', 'DIG / IGP', 'A range groups 2–5 police districts, headed by a Deputy Inspector General.'],
    ['districts', 'Police districts', 'SP / SSP', 'The basic unit of policing, headed by a Superintendent of Police. Big cities have a Commissioner of Police instead (see commissionerates).'],
    ['subDivisions', 'Sub-divisions', 'DSP / ASP', 'Part of a district, headed by a Deputy SP (state service) or an Assistant SP (IPS).'],
    ['circles', 'Circles', 'Inspector (CI)', 'A group of police stations under a Circle Inspector (used in some states only).'],
    ['policeStations', 'Police stations', 'Inspector / SI (SHO)', 'Where FIRs are registered. The Station House Officer is an Inspector or Sub-Inspector.'],
  ];
  const RANK_LABEL = { DGP: 'DGP / Spl. DGP', ADGP: 'Addl. DGP', IGP: 'Inspector General (IGP)', DIG: 'Deputy IG (DIG)', SP: 'SP / SSP / Commandant', ASP: 'Addl. SP', DSP: 'ASP / Dy. SP', INSP: 'Inspector', SI: 'Sub-Inspector', ASI: 'Asst. Sub-Inspector', HC: 'Head Constable', CONST: 'Constable', OTHER: 'Others', TOTAL: 'Total civil police' };

  async function loadAll() {
    const [P, M, IPS, CO] = await Promise.all([json('data/india/police.json'), json('data/india/map.json'), json('data/india/ips.json'), json('data/india/collectors.json')]);
    return { P, M, IPS: IPS || { officers: [] }, CO: CO || {}, ST: window.IN.getStates(), UN: window.IN.getUnion() || {} };
  }
  const stateOf = (D, code) => D.ST?.states.find((s) => s.code === code);
  const officersOf = (D, code) => {
    const st = stateOf(D, code), cad = CADRE_OF[code] || st?.name;
    let all = D.IPS.officers.filter((o) => o.cadre === cad);
    if (CADRE_OF[code]) all = all.filter((o) => PLACE_RX[code]?.test(o.post || '') || (D.UN.districts?.[code] || []).some((d) => new RegExp(`\\b${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(o.post || '')));
    return all;
  };
  const by = (rx, not) => (o) => rx.test(o.post || '') && !(not && not.test(o.post || ''));
  const SPECIAL = /CID|Crime|Intelligence|Vigilance|Railway|Rly|GRP|Training|Academy|Security|Cyber|Traffic|SCRB|STF|ATS|EOW|ACB|Battalion|Bn\b|Armed|Commandant|AIG|Staff|Headquarters|\bHQ|Prison|Fire|Home Guard|SDRF|Coastal|Wireless|Telecom|Economic|Anti|Special Branch|SB\b|Modernisation|Provisioning|Welfare|Recruitment/i;
  const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function districtChief(D, code, district) {
    const name = escRx(district.replace(/ district$/i, ''));
    const rx = new RegExp(`^(SP|SSP|Sr\\.?\\s*SP|Superintendent of Police|District Police Chief|DCP)\\b[^,]*,?\\s*(${name})\\b`, 'i');
    return officersOf(D, code).filter((o) => rx.test(o.post || '') && !SPECIAL.test(o.post || ''));
  }
  const commissioner = (D, code, city) => {
    const words = city.replace(/\(.*?\)/g, '').split(/[\s-]+/).filter((w) => w.length > 3).map(escRx);
    const rx = new RegExp(`(\\bCP\\b|Commissioner of Police|Police Commissioner)[^,]*,?[^,]*\\b(${words.join('|')})`, 'i');
    return words.length ? officersOf(D, code).filter((o) => rx.test(o.post || '') && !/Jt\.?|Joint|Addl|Additional|Dy\.|Deputy|DCP|ACP/i.test(o.post || '')) : [];
  };

  // Commissionerate whose city is this district (Agra, Lucknow, Kanpur Nagar, Gautam Buddh Nagar, Mumbai …).
  const commOf = (comms, district) => {
    const dn = district.toLowerCase().replace(/ (district|city|urban|nagar)$/, '');
    return comms.find((c) => { const cn = c.city.toLowerCase().replace(/\(.*?\)/g, '').trim(); return cn === district.toLowerCase() || cn.split(/[\s-]+/)[0] === dn.split(/\s+/)[0]; });
  };

  /* ---------------------------------------------------------------- map */
  // Sequential single-hue scale on the saffron accent; 5 steps, plus "no data".
  const STEPS = [0.16, 0.32, 0.5, 0.7, 0.92];
  function mapSvg(D, { focus = null, metric = null, dots = null, active = null } = {}) {
    const M = D.M; if (!M) return '<p class="muted">Map data not built yet (node scripts/build-map.mjs).</p>';
    let vb = M.viewBox;
    if (focus && M.states[focus]) { const [x0, y0, x1, y1] = M.states[focus].box; const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 4; vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad]; }
    const unit = vb[2] / 460; // ≈ one screen pixel at the usual map width, so strokes and dots look the same at any zoom
    const vals = metric ? Object.entries(M.states).map(([c]) => metric.value(c)).filter((v) => v != null) : [];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    // Quantile classes: small UTs with extreme ratios would otherwise wash out a linear scale.
    const sorted = [...vals].sort((a, b) => a - b);
    const cuts = [1, 2, 3, 4].map((i) => sorted[Math.floor((sorted.length * i) / 5)]);
    const step = (v) => (v == null ? -1 : cuts.filter((c) => v >= c).length);
    const paths = Object.entries(M.states).map(([c, s]) => {
      const isFocus = focus === c, dim = focus && !isFocus;
      const k = metric ? step(metric.value(c)) : -1;
      const fill = dim ? 'var(--surface-2)' : k >= 0 ? `color-mix(in srgb, var(--saffron) ${Math.round(STEPS[k] * 100)}%, var(--surface))` : isFocus ? 'color-mix(in srgb, var(--saffron) 14%, var(--surface))' : 'var(--surface-2)';
      const label = metric ? `${s.name}: ${metric.fmt(metric.value(c))}` : s.name;
      return `<path class="map-st${dim ? ' dim' : ''}" data-st="${c}" d="${s.d}" fill="${fill}" stroke-width="${(isFocus ? 1.3 : 0.45) * unit}"><title>${esc(label)}</title></path>`;
    }).join('');
    const dotSvg = (dots || []).map((d) => `<g class="map-dot${active === d.name ? ' on' : ''}" data-d="${esc(d.name)}" transform="translate(${d.xy[0]},${d.xy[1]})"><circle r="${(active === d.name ? 6 : 4) * unit}" stroke-width="${1.4 * unit}"/><title>${esc(d.label || d.name)}</title></g>`).join('');
    const labels = focus ? (dots || []).filter((d) => d.show).map((d) => `<text x="${d.xy[0] + 6 * unit}" y="${d.xy[1] + 3.5 * unit}" font-size="${10 * unit}" class="map-lbl">${esc(d.name)}</text>`).join('') : '';
    const legend = metric && vals.length ? `<div class="map-legend"><span>${esc(metric.label)}</span>${STEPS.map((s, i) => `<i style="background:color-mix(in srgb, var(--saffron) ${Math.round(s * 100)}%, var(--surface))" title="${metric.fmt(i ? cuts[i - 1] : lo)} – ${metric.fmt(i < 4 ? cuts[i] : hi)}"></i>`).join('')}<small>${metric.fmt(lo)} … ${metric.fmt(hi)} (fifths of states)</small></div>` : '';
    return `<div class="map-wrap"><svg class="india-map" viewBox="${vb.join(' ')}" role="img" aria-label="Map of India${focus ? ', ' + esc(M.states[focus]?.name) : ''}">${paths}${dotSvg}${labels}</svg>${legend}</div>`;
  }
  function bindMap(root, onState, onDot) {
    $$('.map-st', root).forEach((p) => p.addEventListener('click', () => onState?.(p.dataset.st)));
    $$('.map-dot', root).forEach((g) => g.addEventListener('click', (e) => { e.stopPropagation(); onDot?.(g.dataset.d); }));
  }

  /* ---------------------------------------------------------------- shared blocks */
  const crumbs = (parts) => `<div class="crumbs">${parts.map(([t, h]) => (h ? `<a href="${h}">${esc(t)}</a>` : esc(t))).join(' / ')}</div>`;
  function rankLadder(r, women) {
    if (!r) return '';
    const max = Math.max(...r.filter((x) => !['TOTAL', 'OTHER'].includes(x.rank)).map((x) => Math.max(x.s || 0, x.a || 0)));
    return `<div class="table-wrap"><table class="mp-table ladder-t"><thead><tr><th>Rank (top to bottom)</th><th class="n">Sanctioned</th><th class="n">In position</th><th class="n">Vacant</th><th>Filled</th>${women ? '<th class="n">Women</th>' : ''}</tr></thead><tbody>
      ${r.map((x) => { const p = pct(x.a, x.s); const tot = x.rank === 'TOTAL'; return `<tr class="${tot ? 'tot' : ''}"><td><b>${esc(RANK_LABEL[x.rank] || x.rank)}</b></td><td class="n">${n(x.s)}</td><td class="n">${n(x.a)}</td><td class="n ${x.v > 0 ? 'vac' : ''}">${x.v == null ? '—' : x.v < 0 ? `+${n(-x.v)} over` : n(x.v)}</td>
        <td>${tot ? (p != null ? `${p}%` : '') : `<span class="bar"><i style="width:${max ? ((x.s || 0) / max) * 100 : 0}%"></i><b style="width:${max ? (Math.min(x.a || 0, x.s || 0) / max) * 100 : 0}%"></b></span> <small class="muted">${p != null ? p + '%' : ''}</small>`}</td>
        ${women ? `<td class="n">${n(women[x.rank])}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`;
  }
  const stepCard = (i, title, count, who, body) => `<div class="step"><div class="step-n">${i}</div><div class="step-b"><div class="step-h"><b>${esc(title)}</b>${count != null ? `<span class="num">${n(count)}</span>` : ''}${who ? `<span class="pill">${esc(who)}</span>` : ''}</div>${body || ''}</div></div>`;
  const offList = (list, max = 12) => (list.length ? `<ul class="off-list">${list.slice(0, max).map((o) => `<li><b>${esc(o.name)}</b> <span class="muted">${esc(o.post)}${o.batch ? ` · IPS ${o.batch}` : ''}</span></li>`).join('')}${list.length > max ? `<li class="muted">+ ${list.length - max} more in the <a href="#ips">IPS screener</a></li>` : ''}</ul>` : '');

  /* ---------------------------------------------------------------- India */
  let metricKey = 'perLakh';
  const METRICS = {
    perLakh: { label: 'Civil police per lakh people (actual)', value: (P, c) => P.states[c]?.perLakh?.civilA, fmt: (v) => (v == null ? 'no data' : v.toFixed(0)) },
    vacancy: { label: 'Civil police posts vacant', value: (P, c) => { const t = P.states[c]?.ranks?.find((r) => r.rank === 'TOTAL'); return t?.s ? (t.v / t.s) * 100 : null; }, fmt: (v) => (v == null ? 'no data' : v.toFixed(0) + '%') },
    stations: { label: 'Police stations (actual)', value: (P, c) => P.states[c]?.policeStations?.total?.a, fmt: (v) => (v == null ? 'no data' : Math.round(v).toLocaleString('en-IN')) },
    women: { label: 'Women in civil police', value: (P, c) => { const s = P.states[c]; const t = s?.ranks?.find((r) => r.rank === 'TOTAL')?.a; return t && s.womenCivil?.TOTAL != null ? (s.womenCivil.TOTAL / t) * 100 : null; }, fmt: (v) => (v == null ? 'no data' : v.toFixed(1) + '%') },
  };

  async function india(app, D) {
    document.title = 'Police · Who Runs India';
    const P = D.P;
    if (!P) { app.innerHTML = '<div class="soon-box"><h1>Police</h1><p>Police data not built yet: run <code>node scripts/fetch-police.mjs</code>.</p></div>'; return; }
    const N = P.national, u = N.units, total = N.ranks.find((r) => r.rank === 'TOTAL');
    const codes = Object.keys(P.states).sort((a, b) => (stateOf(D, a)?.name || a).localeCompare(stateOf(D, b)?.name || b));
    const draw = () => {
      const m = METRICS[metricKey], metric = { label: m.label, value: (c) => m.value(P, c), fmt: m.fmt };
      $('#pmap').innerHTML = mapSvg(D, { metric });
      bindMap($('#pmap'), (c) => { location.hash = `#police-${c}`; });
      $$('#pm button').forEach((b) => b.classList.toggle('on', b.dataset.k === metricKey));
    };
    app.innerHTML = `
      ${crumbs([['India', null]])}
      <div class="screener-head"><div><div class="eyebrow">Police · India</div><h1>Who polices India, top to bottom</h1>
      <p class="muted" style="margin-top:6px">Police is a state subject: each of the 36 states and UTs runs its own force under a DGP. Tap a state on the map to drill down to its zones, ranges, districts and police stations.</p></div></div>
      <div class="police-top">
        <div class="card"><div class="seg" id="pm">${Object.entries(METRICS).map(([k, x]) => `<button data-k="${k}">${esc(x.label.replace(/ \(actual\)/, ''))}</button>`).join('')}</div><div id="pmap"></div>
          <p class="src">Boundaries: ${ext(D.M?.attribution?.boundariesUrl || 'https://github.com/datameet/maps', 'DataMeet')} (CC BY 4.0), official outline of India.</p></div>
        <div>
          <h2 style="margin-bottom:10px">The chain of command</h2>
          <div class="steps">
            ${stepCard(1, 'Ministry of Home Affairs', null, 'Union', '<p class="note">Funds and coordinates. Runs the central forces (CRPF, BSF, CISF, ITBP, SSB, NSG), the IB and Delhi Police; manages the IPS cadre. It does not command state police.</p>')}
            ${stepCard(2, 'State police headquarters', 36, 'DGP', '<p class="note">Every state and UT police force is headed by a Director General of Police (an IPS officer), under the state Home Department.</p>')}
            ${LEVELS.map(([k, t, who, note], i) => stepCard(i + 3, t, u?.[k], who, `<p class="note">${note}</p>`)).join('')}
            ${stepCard(9, 'Police outposts', N.outposts?.total?.a, 'ASI / Head Constable', '<p class="note">Small posts under a police station (rural, urban and railway).</p>')}
            ${stepCard('★', 'Police commissionerates', Object.values(P.states).reduce((a, s) => a + (s.commissionerates?.length || 0), 0), 'Commissioner of Police', '<p class="note">In 77 big cities the Commissioner of Police (ADGP/IGP rank) has magisterial powers and replaces the SP-district structure.</p>')}
          </div>
        </div>
      </div>
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin:24px 0">
        <div class="kpi"><div class="v">${n(total.a)}</div><div class="l">civil police in position, of ${n(total.s)} sanctioned</div></div>
        <div class="kpi"><div class="v">${pct(total.v, total.s)}%</div><div class="l">posts vacant (${n(total.v)})</div></div>
        <div class="kpi"><div class="v">${N.perLakh?.civilA ?? '—'}</div><div class="l">civil police per lakh people (sanctioned ${N.perLakh?.civilS ?? '—'})</div></div>
        <div class="kpi"><div class="v">${n(N.policeStations?.total?.a)}</div><div class="l">police stations: ${n(N.policeStations?.rural?.a)} rural, ${n(N.policeStations?.urban?.a)} urban, ${n(N.policeStations?.special?.a)} special</div></div>
      </div>
      <div class="section-head"><h2>Every rank, nationally</h2><span class="note">Civil police, sanctioned vs in position, as on ${fmt(P.asOn)}</span></div>
      ${rankLadder(N.ranks, N.womenCivil)}
      <div class="section-head" style="margin-top:36px"><h2>States & UTs</h2><span class="note">Tap a row to drill down</span></div>
      <div class="table-wrap"><table class="mp-table"><thead><tr><th>State / UT</th><th>DGP</th><th class="n">Zones</th><th class="n">Ranges</th><th class="n">Districts</th><th class="n">Comm.</th><th class="n">Police stations</th><th class="n">Civil police</th><th class="n">Vacant</th><th class="n">Per lakh</th></tr></thead><tbody>
        ${codes.map((c) => { const s = P.states[c], t = s.ranks?.find((r) => r.rank === 'TOTAL'), dg = (D.UN.police || []).find((x) => x.state === c); return `<tr class="rowlink" data-href="#police-${c}"><td><a href="#police-${c}"><b>${esc(stateOf(D, c)?.name || c)}</b></a></td><td>${esc(dg?.name || '')}</td><td class="n">${n(s.units?.zones)}</td><td class="n">${n(s.units?.ranges)}</td><td class="n">${n(s.units?.districts)}</td><td class="n">${n(s.commissionerates?.length)}</td><td class="n">${n(s.policeStations?.total?.a)}</td><td class="n">${n(t?.a)}</td><td class="n">${t?.s ? pct(t.v, t.s) + '%' : '—'}</td><td class="n">${s.perLakh?.civilA ?? '—'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="src">Source: ${ext(P.source, P.sourceName)}, as on ${fmt(P.asOn)}; DGPs from ${ext('https://en.wikipedia.org/wiki/Director_general_of_police', 'Wikipedia')}. Counts are as reported by each state to BPR&D.</p>`;
    $$('#pm button').forEach((b) => b.addEventListener('click', () => { metricKey = b.dataset.k; draw(); }));
    $$('tr.rowlink').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
    draw();
  }

  /* ---------------------------------------------------------------- State / UT */
  async function stateView(app, D, code) {
    const st = stateOf(D, code), S = D.P?.states?.[code];
    if (!st || !S) return india(app, D);
    document.title = `${st.name} Police · Who Runs India`;
    const PS = await json(`data/india/police-stations/${code}.json`);
    const offs = officersOf(D, code);
    const dg = (D.UN.police || []).find((x) => x.state === code);
    // The IPS list is as on 1 January: if Wikipedia names a newer DGP, drop older "head of police force" entries.
    const HOPF = /state police chief|head of police force|\bHoPF\b|DGP\s*(cum|&)\s*(state|HoPF)/i;
    const top = offs.filter(by(/^(DGP|DG\b|Director General|Spl\.?\s*DGP)/i))
      .filter((o) => !(dg && HOPF.test(o.post || '') && o.name.toLowerCase() !== dg.name.toLowerCase()))
      .sort((a, b) => (a.batch || 9999) - (b.batch || 9999));
    const adg = offs.filter(by(/^(ADGP|Addl\.?\s*DGP|Additional DGP|ADG\b)/i));
    const zoneHeads = offs.filter(by(/\bzone\b/i, /DCP|ACP|Traffic|Railway/i));
    const rangeHeads = offs.filter(by(/\brange\b/i, /Traffic|Railway/i));
    const dists = (D.UN.districts?.[code] || []);
    const dpts = Object.fromEntries((D.M?.districts?.[code] || []).map((d) => [d.name, d.xy]));
    const chiefs = Object.fromEntries(dists.map((d) => [d.name, districtChief(D, code, d.name)]));
    const comms = (S.commissionerates || []).map((c) => ({ city: c, cp: commissioner(D, code, c) }));
    const t = S.ranks?.find((r) => r.rank === 'TOTAL');
    const nat = D.P.national;
    const stationsByDist = PS?.stations ? PS.stations.reduce((o, s) => ((o[s.district] ??= []).push(s), o), {}) : null;
    app.innerHTML = `
      ${crumbs([['India', '#police'], [st.name, null]])}
      <div class="screener-head"><div><div class="eyebrow">Police · ${esc(st.name)}</div><h1>${esc(st.name)} Police</h1>
      <p class="muted" style="margin-top:6px">${n(t?.a)} civil police in position (of ${n(t?.s)} sanctioned), ${n(S.policeStations?.total?.a)} police stations, ${S.perLakh?.civilA ?? '—'} police per lakh people (India ${nat.perLakh?.civilA ?? '—'}).</p></div>
      <a class="btn" href="#state-${code}">State overview →</a></div>
      <div class="police-top">
        <div class="card"><div id="smap"></div><p class="note" style="margin-top:6px">Dots are district headquarters; tap one for its police chief${PS ? ' and police stations' : ''}.</p></div>
        <div>
          <h2 style="margin-bottom:10px">Top to bottom</h2>
          <div class="steps">
            ${stepCard(1, 'Director General of Police', S.ranks?.[0]?.a, 'DGP', `${dg ? `<p><b>${esc(dg.name)}</b> <span class="muted">DGP${dg.batch ? `, IPS ${esc(dg.batch)}` : ''}${dg.hq ? ` · Police HQ ${esc(dg.hq)}` : ''}</span></p>` : ''}${offList(top.filter((o) => o.name !== dg?.name), 6)}`)}
            ${stepCard(2, 'Additional DGPs', S.ranks?.[1]?.a, 'ADGP', `<p class="note">Head wings at police HQ (law & order, crime, intelligence, armed police, training) and some zones.</p>${offList(adg, 8)}`)}
            ${stepCard(3, 'Police zones', S.units?.zones, 'ADGP / IGP', zoneHeads.length ? offList(zoneHeads) : '<p class="note">No zone heads found in the IPS list.</p>')}
            ${stepCard(4, 'Police ranges', S.units?.ranges, 'DIG / IGP', rangeHeads.length ? offList(rangeHeads) : '<p class="note">No range heads found in the IPS list.</p>')}
            ${comms.length ? stepCard(5, 'Police commissionerates', comms.length, 'Commissioner of Police', `<ul class="off-list">${comms.map((c) => `<li><b>${esc(c.city)}</b> ${c.cp.length ? `<span class="muted">· ${esc(c.cp[0].name)}, ${esc(c.cp[0].post)}</span>` : ''}</li>`).join('')}</ul>`) : ''}
            ${stepCard(comms.length ? 6 : 5, 'Police districts', S.units?.districts, 'SP / SSP', `<p class="note">${Object.values(chiefs).filter((x) => x.length).length} district police chiefs named below, from the IPS list.</p>`)}
            ${stepCard(comms.length ? 7 : 6, 'Sub-divisions', S.units?.subDivisions, 'DSP / ASP', '')}
            ${S.units?.circles ? stepCard(comms.length ? 8 : 7, 'Circles', S.units.circles, 'Circle Inspector', '') : ''}
            ${stepCard('▾', 'Police stations', S.policeStations?.total?.a, 'SHO', `<p class="note">${n(S.policeStations?.rural?.a)} rural · ${n(S.policeStations?.urban?.a)} urban · ${n(S.policeStations?.special?.a)} special-purpose (women, cyber, SC/ST, traffic …)${PS ? ` · <b>${n(PS.stations.length)} listed by name</b>` : ''}</p>`)}
            ${stepCard('▾', 'Outposts', S.outposts?.total?.a, 'ASI / HC', '')}
          </div>
        </div>
      </div>
      <div class="section-head" style="margin-top:28px" id="pdists"><h2>Districts${comms.length ? ' & commissionerates' : ''}</h2><span class="note">${dists.length} revenue districts · ${n(S.units?.districts)} police districts reported</span></div>
      <div class="district-grid">${dists.map((d) => { const c = chiefs[d.name]; const cm = commOf(comms, d.name); const k = stationsByDist?.[d.name]?.length; return `<a class="district dlink" href="#police-${code}-${encodeURIComponent(d.name)}"><b>${esc(d.name)}</b>${cm ? `<span class="dc">Commissionerate${cm.cp[0] ? `: ${esc(cm.cp[0].name)}${cm.cp[0].batch ? ` · IPS ${cm.cp[0].batch}` : ''}` : ''}</span>` : ''}${c.length ? `<span class="dc">${esc(c[0].post.split(',')[0])}: ${esc(c[0].name)}${c[0].batch ? ` · IPS ${c[0].batch}` : ''}</span>` : cm ? '' : '<span class="dc muted">SP not in IPS list</span>'}${k ? `<span>${k} police stations</span>` : ''}</a>`; }).join('')}</div>
      <div class="section-head" style="margin-top:36px"><h2>Every rank in ${esc(st.name)} Police</h2><span class="note">Civil police as on ${fmt(D.P.asOn)}</span></div>
      ${rankLadder(S.ranks, S.womenCivil)}
      <p class="src">Units, stations, ranks and ratios: ${ext(D.P.source, D.P.sourceName)} (as on ${fmt(D.P.asOn)}). Officers: ${ext(D.IPS.source || 'https://www.mha.gov.in', 'MHA IPS Civil List')} (posts as on 1 January; postings change during the year).${CADRE_OF[code] ? ` ${esc(st.name)} draws officers from the joint ${esc(CADRE_OF[code])} cadre; only those whose post names a place in ${esc(st.name)} are shown.` : ''}${PS ? ` Police stations: ${ext(PS.source, PS.sourceName || 'state police website')}.` : ''}</p>`;
    const dots = dists.filter((d) => dpts[d.name]).map((d) => ({ name: d.name, xy: dpts[d.name], label: `${d.name}${chiefs[d.name][0] ? ' · ' + chiefs[d.name][0].name : ''}`, show: dists.length <= 40 }));
    $('#smap').innerHTML = mapSvg(D, { focus: code, dots });
    bindMap($('#smap'), (c) => { if (c !== code) location.hash = `#police-${c}`; }, (d) => { location.hash = `#police-${code}-${encodeURIComponent(d)}`; });
  }

  /* ---------------------------------------------------------------- District */
  async function districtView(app, D, code, dname) {
    const st = stateOf(D, code), d = (D.UN.districts?.[code] || []).find((x) => x.name === dname);
    if (!st || !d) return stateView(app, D, code);
    document.title = `${d.name} Police, ${st.name} · Who Runs India`;
    const PS = await json(`data/india/police-stations/${code}.json`);
    const chiefs = districtChief(D, code, d.name);
    const col = D.CO.collectors?.[code]?.[d.name];
    const cm = commOf((D.P.states[code]?.commissionerates || []).map((c) => ({ city: c, cp: commissioner(D, code, c) })), d.name);
    const comm = cm ? [cm.city] : [];
    const cps = cm ? cm.cp : [];
    const stations = (PS?.stations || []).filter((s) => s.district === d.name);
    const dpts = Object.fromEntries((D.M?.districts?.[code] || []).map((x) => [x.name, x.xy]));
    const dots = Object.entries(dpts).map(([nm, xy]) => ({ name: nm, xy, show: nm === d.name }));
    app.innerHTML = `
      ${crumbs([['India', '#police'], [st.name, `#police-${code}`], [d.name, null]])}
      <div class="screener-head"><div><div class="eyebrow">Police · ${esc(st.name)}</div><h1>${esc(d.name)} district</h1>
      <p class="muted" style="margin-top:6px">${d.hq && d.hq !== d.name ? `Headquarters ${esc(d.hq)}. ` : ''}Police district under ${esc(st.name)} Police.</p></div><a class="btn" href="#state-${code}">State overview →</a></div>
      <div class="police-top">
        <div class="card"><div id="dmap"></div></div>
        <div><div class="steps">
          ${stepCard(1, `${st.name} Police HQ`, null, 'DGP', `<p class="note"><a href="#police-${code}">State chain of command →</a></p>`)}
          ${cps.length ? stepCard(2, `Commissioner of Police${comm.length ? ', ' + comm.join(', ') : ''}`, null, 'CP', offList(cps)) : ''}
          ${stepCard(cps.length ? 3 : 2, 'District police chief', null, 'SP / SSP', chiefs.length ? offList(chiefs) : '<p class="note">Not found in the IPS list (the SP may be from the State Police Service, or the post was filled after 1 January).</p>')}
          ${stepCard(cps.length ? 4 : 3, 'District Collector / Magistrate', null, 'IAS', col ? `<p><a href="#officer-${esc(col.id)}"><b>${esc(col.name)}</b></a> <span class="muted">${esc(col.designation)} · IAS ${esc(col.batch)}</span></p><p class="note">Holds executive magistrate powers for law and order alongside the SP.</p>` : '<p class="note">Not matched in the IAS records.</p>')}
          ${stepCard('▾', 'Police stations', stations.length || null, 'SHO', stations.length ? '' : `<p class="note">${PS ? 'None listed for this district in the state police directory.' : `A station-by-station list for ${esc(st.name)} is not available yet.`}</p>`)}
        </div></div>
      </div>
      ${stations.length ? `<div class="section-head" style="margin-top:28px"><h2>Police stations in ${esc(d.name)}</h2><span class="note">${stations.length} listed</span></div>
        <div class="filters"><input class="input" type="search" id="ps-q" placeholder="Find a police station or area"></div>
        <div id="ps-t"></div>
        <p class="src">From ${ext(PS.source, PS.sourceName || 'the state police website')}${PS.generated ? `, fetched ${fmt(PS.generated)}` : ''}. Official station numbers only.</p>` : ''}`;
    $('#dmap').innerHTML = mapSvg(D, { focus: code, dots, active: d.name });
    bindMap($('#dmap'), (c) => { location.hash = `#police-${c}`; }, (x) => { location.hash = `#police-${code}-${encodeURIComponent(x)}`; });
    if (stations.length) {
      const cols = ['subDivision', 'circle', 'phone', 'email', 'address'].filter((k) => stations.some((s) => s[k]));
      const label = { subDivision: 'Sub-division', circle: 'Circle', phone: 'Phone', email: 'Email', address: 'Address' };
      const draw = () => {
        const q = ($('#ps-q').value || '').toLowerCase();
        const rows = stations.filter((s) => !q || Object.values(s).join(' ').toLowerCase().includes(q));
        $('#ps-t').innerHTML = `<div class="table-wrap"><table class="mp-table"><thead><tr><th>Police station</th>${cols.map((k) => `<th>${label[k]}</th>`).join('')}</tr></thead><tbody>${rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td>${cols.map((k) => `<td class="${k === 'phone' ? 'num' : ''}">${esc(s[k] || '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">No match</td></tr>`}</tbody></table></div>`;
      };
      $('#ps-q').addEventListener('input', draw); draw();
    }
  }

  async function police(app, _D, args = []) {
    app.innerHTML = '<div class="loading">Loading police data…</div>';
    const D = await loadAll();
    const [code, ...rest] = args;
    if (code && rest.length) return districtView(app, D, code.toUpperCase(), decodeURIComponent(rest.join('-')));
    if (code) return stateView(app, D, code.toUpperCase());
    return india(app, D);
  }
  window.IN.police = police;
})();
