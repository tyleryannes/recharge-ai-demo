/*
 * The V3 plan workspace. Renders the finished plan as a workspace the merchant can work
 * in: overview, shopper journeys, analytics, subscription strategy, the store audit, the
 * action plan (with editable assumptions that re-rank live), tests and tracking, and
 * sources. Every block can take comments; there's a notes pad, a status and owner per
 * move, and each move opens a "Build this for me" / "Walk me through it" sheet.
 *
 * The merchant's layer (comments, notes, statuses, edits, walkthrough progress) is saved
 * next to the run on the server, or in this browser for the offline file.
 */
(() => {
  const GP = () => window.GP;
  const S = () => window.GP.state;
  const esc = (s) => window.GP.esc(s);
  const pt = (s) => window.GP.pt(s);
  const usd = (n) => window.GP.usdShort(n);
  const pct = (r, d = 1) => window.GP.pctS(r, d);
  const num = (n) => window.GP.num(n);
  const CONF = { H: ['High', 1], M: ['Medium', 0.7], L: ['Low', 0.4] };
  const EFF = { S: ['Small', 1], M: ['Medium', 2], L: ['Large', 4] };
  const STATUS = [['', 'Not started'], ['planned', 'Planned'], ['doing', 'In progress'], ['done', 'Done'], ['not-now', 'Not now']];
  const PERSONA = { 'first-time': ['🛍️', '#3A2433', 'First-time shopper'], returning: ['🔁', '#1C3440', 'Returning customer'], subscriber: ['☕', '#2E2548', 'Subscriber'] };
  const SECTIONS = [
    ['overview', '◎', 'Overview'],
    ['journeys', '🧭', 'Shopper journeys'],
    ['analytics', '📈', 'Growth analytics'],
    ['strategy', '🔁', 'Subscription strategy'],
    ['audit', '🔎', 'Store audit'],
    ['plan', '🗂️', 'Action plan'],
    ['tests', '🧪', 'Tests & tracking'],
    ['sources', '📚', 'Sources'],
  ];

  /* ---------------- the merchant's layer ---------------- */
  const blank = () => ({ comments: [], notes: '', status: {}, owners: {}, overrides: {}, walk: {}, built: {}, week: {}, review: {} });
  const ws = { runId: null, data: blank(), loading: false, version: 0, saveTimer: 0, savedAt: null };
  let author = '';
  try { author = localStorage.getItem('gp.author') || ''; } catch {}
  const lsKey = (id) => `gp.ws.${id}`;
  async function ensureLoaded(runId) {
    if (!runId || ws.runId === runId || ws.loading) return;
    ws.loading = true; ws.loaded = false; ws.runId = runId; ws.data = blank();
    let got = null;
    try { const cached = localStorage.getItem(lsKey(runId)); if (cached) got = JSON.parse(cached); } catch {}
    if (!GP().LOCAL) {
      try { const res = await fetch(`${GP().API}/api/runs/${encodeURIComponent(runId)}/workspace`); if (res.ok) { const server = await res.json(); if (server && Object.keys(server).length) got = server; } } catch {}
    }
    ws.data = { ...blank(), ...(got || {}) };
    ws.loading = false; ws.loaded = true; ws.version++; GP().invalidate();
    // A review opened before the saved progress arrived should resume at the right card.
    if (rv.open && !rv.summary) { const d = deck(), next = d.findIndex((c) => !decided(c)); if (next < 0) rv.summary = true; else rv.i = next; renderReview(true); }
  }
  function changed(rerender = true) {
    ws.version += rerender ? 1 : 0;
    try { localStorage.setItem(lsKey(ws.runId), JSON.stringify(ws.data)); } catch {}
    clearTimeout(ws.saveTimer);
    ws.saveTimer = setTimeout(async () => {
      if (!GP().LOCAL) {
        try {
          await fetch(`${GP().API}/api/runs/${encodeURIComponent(ws.runId)}/workspace`, { method: 'PUT', headers: { 'content-type': 'application/json', ...GP().authHeaders() }, body: JSON.stringify(ws.data) });
        } catch {}
      }
      ws.savedAt = new Date();
      const el = document.querySelector('.saved'); if (el) el.textContent = savedText();
    }, 500);
    if (rerender) GP().invalidate();
  }
  const savedText = () => (ws.savedAt ? `Saved ${ws.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${GP().LOCAL ? ' in this browser' : ''}` : GP().LOCAL ? 'Saved in this browser' : 'Saved with this run');

  /* ---------------- view state ---------------- */
  const view = { section: 'overview', journey: 'first-time', jfilter: null, rail: false, railTab: 'comments', target: null, targetLabel: '', build: null };
  let renderedKey = '';
  // Deep links for demos: ?section=journeys&journey=subscriber, ?build=o8, ?walk=o2
  const qp = new URLSearchParams(location.search);
  if (qp.get('section')) view.section = qp.get('section');
  if (qp.get('journey')) view.journey = qp.get('journey');
  let deepReview = qp.get('review') === '1';
  const deepSheet = qp.get('build') ? ['build', qp.get('build')] : qp.get('walk') ? ['walk', qp.get('walk')] : null;

  /* ---------------- scoring with the merchant's edits ---------------- */
  function effective() {
    const items = S().priorities || [];
    const out = items.map((o) => {
      if (o.locked || o.excluded) return { ...o, eff: null };
      const ov = ws.data.overrides[o.id] || {};
      const target = ov.target ?? o.targetRate.value;
      const confidence = ov.confidence ?? o.confidence;
      const effort = ov.effort ?? o.effort;
      const impact = o.audience.value * (target - o.currentRate.value) * o.valuePerConversion.value * 12;
      const score = (impact * CONF[confidence][1]) / EFF[effort][1];
      return { ...o, eff: { target, confidence, effort, impact, score, edited: !!Object.keys(ov).length } };
    });
    const live = out.filter((o) => o.eff).sort((a, b) => b.eff.score - a.eff.score);
    live.forEach((o, i) => (o.eff.rank = i + 1));
    return [...live, ...out.filter((o) => !o.eff)];
  }
  const pkgOf = (id) => (S().packages || []).find((p) => p.opportunityId === id);
  const initOf = (id) => (S().plan?.initiatives || []).find((i) => i.opportunityId === id);
  const testOf = (id) => (S().tests?.tests || []).find((t) => t.opportunityId === id);
  const oppTitle = (id) => (S().priorities || []).find((o) => o.id === id)?.title || id;
  const rankOf = (id) => effective().find((o) => o.id === id)?.eff?.rank;
  const commentsOn = (target) => ws.data.comments.filter((c) => c.target === target && !c.resolved).length;
  const cbtn = (target, label, inline = false) => { const n = commentsOn(target); return `<button type="button" class="cbtn ${n ? 'has' : ''} ${inline ? 'inline' : ''}" data-comment="${esc(target)}" data-label="${esc(label)}" title="Comment">💬${n ? ` ${n}` : ''}</button>`; };
  const moveLink = (id, text) => (id && (S().priorities || []).some((o) => o.id === id) ? `<button type="button" class="link-move" data-goto-move="${esc(id)}">${esc(text || `→ Move #${rankOf(id) ?? '–'}: ${oppTitle(id)}`)}</button>` : '');

  /* ---------------- shell ---------------- */
  function shell(root) {
    if (root.querySelector('.ws')) return;
    root.innerHTML = `<div class="ws"><nav class="ws-nav" id="ws-nav"></nav><section class="ws-main" id="ws-main"></section><aside class="ws-rail" id="ws-rail"></aside></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
  }
  function render(root) {
    shell(root);
    const st = S();
    if (st.runId && ws.runId !== st.runId) ensureLoaded(st.runId);
    renderNav();
    const key = `${view.section}:${st.planVersion}:${st.verdicts.size}:${ws.version}:${view.journey}:${view.jfilter}:${view.rail}`;
    if (key !== renderedKey) {
      renderedKey = key;
      const main = document.getElementById('ws-main');
      const top = main.scrollTop;
      main.innerHTML = topbar() + `<div class="ws-page">${(PAGES[view.section] || PAGES.overview)()}</div>`;
      main.scrollTop = top;
    }
    renderRail();
    renderReview();
    if (deepReview && deck().length && ws.loaded) { deepReview = false; openReview(); }
    if (deepSheet && pkgOf(deepSheet[1])) { const [m, id] = deepSheet; deepSheet.length = 0; openSheet(id, m); }
    renderSheet();
  }
  const available = {
    overview: () => !!S().report || !!S().priorities,
    journeys: () => Object.keys(S().journeySteps || {}).length > 0,
    analytics: () => !!S().analytics,
    strategy: () => !!S().strategy,
    audit: () => !!S().profile,
    plan: () => !!S().priorities,
    tests: () => !!S().tests,
    sources: () => S().ledger.size > 0,
  };
  function renderNav() {
    const st = S();
    const counts = {
      journeys: Object.values(st.journeySteps || {}).flat().filter((s) => s.verdict === 'issue').length,
      plan: (st.priorities || []).filter((o) => o.rank).length,
      tests: st.tests?.tests.length,
      sources: st.ledger.size + st.webFindings.length,
    };
    if (!available[view.section]()) view.section = (SECTIONS.find(([id]) => available[id]()) || SECTIONS[0])[0];
    document.getElementById('ws-nav').innerHTML = `
      <div class="brand"><span class="logo">B&amp;B</span><div><b>${esc(st.store?.name || 'Growth plan')}</b><span>Growth plan · demo data</span></div></div>
      ${SECTIONS.map(([id, ico, label]) => `<button type="button" class="nav" data-section="${id}" aria-current="${view.section === id}" ${available[id]() ? '' : 'disabled'}><span class="ico">${ico}</span>${label}${counts[id] ? `<span class="count">${counts[id]}</span>` : ''}</button>`).join('')}
      <div class="sep"></div>
      ${deck().length ? `<button type="button" class="nav" data-review-open><span class="ico">💘</span>Quick review<span class="count">${reviewCount()}/${deck().length}</span></button>` : ''}
      <button type="button" class="nav" data-rail="comments"><span class="ico">💬</span>Comments<span class="count">${ws.data.comments.filter((c) => !c.resolved).length || ''}</span></button>
      <button type="button" class="nav" data-rail="notes"><span class="ico">📝</span>Notes</button>
      <button type="button" class="nav" data-watch><span class="ico">▶</span>Watch the crew</button>
      <div class="foot">Every store number is demo data. Nothing here is sent to Skio, Klaviyo or Postscript.</div>`;
  }
  function topbar() {
    const label = SECTIONS.find(([id]) => id === view.section)?.[2] || '';
    const open = ws.data.comments.filter((c) => !c.resolved).length;
    return `<div class="ws-top"><span class="crumbs">Plan · <b>${esc(label)}</b></span><span class="grow"></span>
      <span class="saved">${esc(savedText())}</span>
      <button type="button" class="ws-btn sm" data-rail="notes">📝 Notes</button>
      <button type="button" class="ws-btn sm" data-rail="comments">💬 Comments ${open ? `<span class="badge">${open}</span>` : ''}</button></div>`;
  }

  /* ---------------- pages ---------------- */
  const PAGES = {};

  PAGES.overview = () => {
    const st = S();
    const eff = effective();
    const top = eff.filter((o) => o.eff).slice(0, 5);
    const total = top.reduce((s, o) => s + o.eff.impact, 0);
    const contrib = st.analytics?.kpis?.find((k) => k.label === 'Left over per order');
    const rate = contrib?.note ? Number(contrib.note.replace(/[^0-9]/g, '')) / 100 : 0.4;
    const rb = st.runBrief;
    const bits = rb ? GP().briefBits(rb) : [];
    let html = `<div class="hero"><div>
        <div class="eyebrow">Growth plan · ${esc(st.store?.name || '')} · demo data</div>
        <h1>${esc(st.brief || '')}</h1>
        <div class="tags">${bits.map((b) => `<span class="tag">${esc(b)}</span>`).join('')}</div>
        <p class="muted" style="margin:14px 0 0">${esc(st.analytics?.headline || '')}</p>
      </div><div class="right">
        <div class="dim small">Upside from the top ${top.length} moves</div>
        <div class="big">${usd(total)}<small> / year</small></div>
        <div class="muted small">≈ ${usd(total * rate)} a year after product, shipping and fees${eff.some((o) => o.eff?.edited) ? ' · includes your edits' : ''}</div>
        <div class="tags" style="margin-top:6px"><span class="tag good">${(st.reportCounts?.data.recomputed ?? 0)} store numbers checked</span><span class="tag">${st.claims.length} web claims</span></div>
      </div></div>`;
    if (st.analytics?.kpis?.length) html += `<div class="kpis">${st.analytics.kpis.map((k) => `<div class="kpi ${k.tone || ''}"><div class="k">${esc(k.label)}</div><div class="v">${esc(k.value)}${k.ref ? pt(` [${k.ref}]`) : ''}</div>${k.note ? `<div class="n">${esc(k.note)}</div>` : ''}</div>`).join('')}</div>`;
    const dk = deck();
    if (dk.length) {
      const n = reviewCount(), loved = dk.filter((c) => ws.data.review[c.opportunityId]?.decision === 'love').length;
      html += `<div class="review-cta"><div class="big-ico">💘</div><div><h3>${n ? (n < dk.length ? 'Pick up your quick review' : 'Your shortlist is ready') : 'Quick review: make this plan yours in 3 minutes'}</h3>
        <p>${n ? `${n} of ${dk.length} moves reviewed · ${loved} saved. ` : ''}Swipe through each move like a profile, pick the version you like (or several), heart it to save it, pass on what doesn't fit, and leave notes or requests. It saves as you go.</p></div>
        <button type="button" class="ws-btn primary" data-review-open>${n ? (n < dk.length ? 'Continue' : 'See my shortlist') : 'Start quick review'}</button></div>`;
    }
    if (top.length) {
      html += `<div class="ws-h2"><h2>Your top 3 moves</h2><span class="sub">Ranked by yearly value × confidence ÷ effort</span><span class="grow"></span><button type="button" class="ws-btn sm" data-section="plan">See all ${eff.filter((o) => o.eff).length}</button></div>
        <div class="grid3">${top.slice(0, 3).map((o) => moveCard(o)).join('')}</div>`;
    }
    if (st.scorecard?.length) html += `<div class="ws-h2"><h2>Health check</h2><span class="sub">How each part of the business is doing, and what's already working</span></div>
      <div class="scorecard">${st.scorecard.map((a) => `<div class="area"><div class="grade ${a.grade}">${a.grade}</div><div><h4>${esc(a.area)}</h4><div class="line">${pt(a.line)}</div><div class="ok">${pt(a.working)}</div></div>${cbtn(`area:${a.area}`, `Health check · ${a.area}`)}</div>`).join('')}</div>`;
    const js = Object.values(st.journeys || {});
    if (js.length) html += `<div class="ws-h2"><h2>What our shoppers saw</h2><span class="sub">Three agents walked your store as real customers</span></div>
      <div class="grid3">${['first-time', 'returning', 'subscriber'].map((id) => st.journeys[id]).filter(Boolean).map((j) => {
        const issues = j.steps.filter((s) => s.verdict === 'issue').length, good = j.steps.filter((s) => s.verdict === 'good').length;
        const [ico, bg] = PERSONA[j.id];
        return `<div class="persona" data-journey="${j.id}"><div class="who"><span class="avatar" style="background:${bg}">${ico}</span><div><h4>${esc(j.persona)}</h4><div class="dim small">${esc(j.who)}</div></div></div><p>${esc(j.headline)}</p><div class="tags"><span class="tag bad">${issues} to fix</span><span class="tag good">${good} working</span></div></div>`;
      }).join('')}</div>`;
    const week = startThisWeek(st.report || '');
    if (week.length) html += `<div class="ws-h2"><h2>Start here this week</h2><span class="sub">Tick them off as you go</span></div>
      <ul class="checklist">${week.map((w, i) => `<li class="${ws.data.week[i] ? 'done' : ''}"><input type="checkbox" data-week="${i}" ${ws.data.week[i] ? 'checked' : ''} aria-label="Done"><span>${GP().pillify(inlineMd(w))}</span></li>`).join('')}</ul>`;
    if (st.report) html += `<details class="full card" style="margin-top:22px"><summary>Read the full written summary</summary><article class="report">${GP().pillify(GP().markdown(st.report), true)}</article></details>`;
    return html;
  };
  function moveCard(o) {
    const init = initOf(o.id);
    const status = ws.data.status[o.id] || '';
    return `<div class="move-card"><div class="rank">#${o.eff.rank} · ${esc(o.area)}</div><h3>${esc(o.title)}</h3>${cbtn(`move:${o.id}`, o.title)}
      <div class="money">${usd(o.eff.impact)}<small> / year</small></div>
      <div class="tags"><span class="tag">${EFF[o.eff.effort][0]} effort</span><span class="tag">~${o.timeToSignalWeeks} weeks to know</span>${o.goalFit ? '<span class="tag good">Fits your goal</span>' : ''}${status ? `<span class="tag accent">${esc(STATUS.find(([k]) => k === status)[1])}</span>` : ''}${reviewTags(o.id)}</div>
      <div class="muted small">${pt(init ? firstSentence(init.why) : firstSentence(o.rationale))}</div>
      <div class="actions">${pkgOf(o.id) ? `<button type="button" class="ws-btn primary sm" data-build="${o.id}">⚡ Build this for me</button><button type="button" class="ws-btn sm" data-walk="${o.id}">🧭 Walk me through it</button>` : ''}</div></div>`;
  }
  const firstSentence = (t) => { const m = String(t).match(/^.+?[.!?](\s|$)/); return m ? m[0].trim() : t; };
  const inlineMd = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  function startThisWeek(md) {
    const i = md.indexOf('## Start here this week');
    if (i < 0) return [];
    return md.slice(i).split('\n').slice(1).filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, ''));
  }

  PAGES.journeys = () => {
    const st = S();
    const goal = st.runBrief?.goal;
    if (view.jfilter === null) view.jfilter = goal ? 'goal' : 'all';
    const ids = ['first-time', 'returning', 'subscriber'].filter((id) => st.journeySteps[id]);
    if (!ids.includes(view.journey)) view.journey = ids[0];
    const j = st.journeys[view.journey];
    const steps = (j ? j.steps : st.journeySteps[view.journey]) || [];
    const fits = (s) => goal && s.goals.includes(goal);
    let shown = steps;
    if (view.jfilter === 'issues') shown = steps.filter((s) => s.verdict === 'issue');
    else if (view.jfilter === 'working') shown = steps.filter((s) => s.verdict !== 'issue');
    else if (view.jfilter === 'goal') shown = [...steps.filter(fits), ...steps.filter((s) => !fits(s))];
    const [ico, bg, name] = PERSONA[view.journey];
    const goalLabel = st.runBrief?.goal ? GP().briefBits({ goal: st.runBrief.goal })[0] : '';
    return `<h1>Shopper journeys</h1><p class="lede">Three agents shopped your store the way your customers do and wrote down everything they noticed: what gets in the way, and what already works. Steps that matter for your goal${goalLabel ? ` (${esc(goalLabel.toLowerCase())})` : ''} are highlighted and come first.</p>
      <div class="row" style="gap:12px"><div class="seg">${ids.map((id) => `<button type="button" data-journey="${id}" aria-pressed="${view.journey === id}">${PERSONA[id][0]} ${PERSONA[id][2]}<span class="n">${(st.journeySteps[id] || []).filter((s) => s.verdict === 'issue').length}</span></button>`).join('')}</div>
      <div class="seg">${[['goal', 'Your goal first', !!goal], ['issues', 'To fix', true], ['working', 'Working', true], ['all', 'In order', true]].filter(([, , ok]) => ok).map(([k, l]) => `<button type="button" data-jfilter="${k}" aria-pressed="${view.jfilter === k}">${l}</button>`).join('')}</div></div>
      <div class="journey-head"><span class="avatar" style="background:${bg}">${ico}</span><div><h2>${esc(name)}${j ? ` · ${esc(j.who)}` : ''}</h2><p>${esc(j?.entry || 'Walking the store…')}</p></div></div>
      ${j ? `<div class="card soft"><b>What they'd tell you:</b> ${esc(j.headline)}</div>` : ''}
      <div class="timeline">${shown.map((s) => jstep(s, fits(s), view.jfilter === 'goal' && goal && !fits(s))).join('')}</div>
      ${!j ? '<p class="dim">This shopper is still walking the store.</p>' : ''}`;
  };
  function jstep(s, fit, dim) {
    const tag = s.verdict === 'good' ? '<span class="tag good">Working</span>' : s.verdict === 'info' ? '<span class="tag">Worth knowing</span>' : `<span class="tag ${s.severity === 'high' ? 'bad' : 'warn'}">${s.severity === 'high' ? 'Fix first' : 'Worth fixing'}</span>`;
    const target = `journey:${view.journey}:${s.n}`;
    return `<div class="jstep ${fit ? 'fit' : ''} ${dim ? 'dimmed' : ''}"><div class="dot ${s.verdict}">${s.n}</div><div class="sketch">${sketch(s)}</div>
      <div class="body">${cbtn(target, `${PERSONA[view.journey][2]} · step ${s.n}`)}<h4>${s.device === 'mobile' ? '📱' : '💻'} ${esc(s.place)}</h4><p class="saw">${esc(s.saw)}</p><p class="why">${pt(s.why)}</p>
      <div class="foot">${tag}${fit ? '<span class="tag accent">Fits your goal</span>' : ''}<span class="dim small">${esc(s.path)}</span>${moveLink(s.opportunityId)}</div></div></div>`;
  }
  /* A small wireframe of the page the shopper was on, with the spot marked. */
  function sketch(s) {
    const mobile = s.device === 'mobile';
    const w = mobile ? 90 : 132, h = mobile ? 160 : 96, x0 = mobile ? 21 : 0;
    const c = s.verdict === 'issue' ? (s.severity === 'high' ? '#EF6F61' : '#F5B94A') : s.verdict === 'good' ? '#55C38A' : '#94A5B9';
    const r = (x, y, ww, hh, f = '#2E4058', rx = 2) => `<rect x="${x0 + x}" y="${y}" width="${ww}" height="${hh}" rx="${rx}" fill="${f}"/>`;
    const iw = w - 12;
    const blocks = {
      ad: r(6, 10, iw, 50, '#3A2433') + r(6, 66, iw * 0.7, 6) + r(6, 78, iw * 0.5, 6) + r(6, h - 24, iw, 14, '#5B8DEF', 4),
      collection: r(6, 10, iw, 30, '#26364C') + r(6, 46, iw / 2 - 3, 40) + r(6 + iw / 2 + 3, 46, iw / 2 - 3, 40) + r(6, 92, iw / 2 - 3, 40) + r(6 + iw / 2 + 3, 92, iw / 2 - 3, 40),
      popup: r(6, 10, iw, 30) + r(6, 46, iw / 2 - 3, 40) + `<rect x="${x0}" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,.45)"/>` + r(12, 40, w - 24, 70, '#EEF3F8', 6) + r(20, 52, w - 40, 6, '#94A5B9') + r(20, 90, w - 40, 12, '#6b4530', 4),
      pdp: r(6, 8, iw, mobile ? 64 : 40, '#6b4530') + r(6, mobile ? 78 : 52, iw * 0.8, 6, '#EEF3F8') + r(6, mobile ? 90 : 62, iw * 0.4, 6) + r(6, mobile ? 102 : 72, iw, 12, '#94A5B9', 4) + r(6, mobile ? 120 : 86, iw, 8, '#2E4058'),
      reviews: r(6, 8, iw, 40, '#6b4530') + `<text x="${x0 + 8}" y="64" font-size="10" fill="#F5B94A">★★★★★</text>` + r(6, 72, iw, 6) + r(6, 84, iw * 0.8, 6),
      cart: r(6, 8, iw, 12, '#55C38A', 3) + r(6, 28, iw, 26) + r(6, 60, iw, 26) + r(6, h - 26, iw, 14, '#EEF3F8', 4),
      checkout: r(6, 10, iw, 14, '#5B8DEF', 4) + r(6, 30, iw, 14, '#EEF3F8', 4) + r(6, 52, iw, 8) + r(6, 66, iw, 8) + r(6, 80, iw, 8),
      thanks: `<circle cx="${x0 + w / 2}" cy="30" r="14" fill="#1E3D2F"/>` + r(6, 52, iw, 6, '#EEF3F8') + r(6, 64, iw * 0.7, 6) + r(6, 84, iw, 30, '#26364C', 4),
      email: r(6, 8, iw, 10) + r(6, 24, iw, 44, '#efe4cf', 3) + r(6, 74, iw * 0.8, 6, '#94A5B9') + r(6, 86, iw * 0.6, 6) + r(6, 100, iw, 12, '#6b4530', 4),
      sms: r(6, 20, iw * 0.8, 30, '#26303F', 8),
      account: r(6, 8, iw, 12) + r(6, 28, iw, 20) + r(6, 54, iw, 20) + r(6, 80, iw, 20),
      portal: r(6, 8, iw, 20, '#3A2D5C', 4) + r(6, 34, iw / 2 - 3, 22) + r(6 + iw / 2 + 3, 34, iw / 2 - 3, 22) + r(6, 62, iw, 10) + r(6, 78, iw, 10) + r(6, 94, iw, 10),
      cancel: r(6, 8, iw, 10, '#EEF3F8') + r(6, 26, iw, 14) + r(6, 44, iw, 14) + r(6, 62, iw, 14) + r(6, 86, iw, 20, '#3A2D5C', 4),
      support: r(6, 10, iw * 0.8, 26, '#26303F', 6) + r(6 + iw * 0.2, 44, iw * 0.8, 36, '#3A2D5C', 6),
      speed: `<circle cx="${x0 + w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="none" stroke="#2E4058" stroke-width="7"/><path d="M${x0 + w / 2} ${h / 2} L${x0 + w / 2 + 16} ${h / 2 - 18}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    }[s.sketch] || '';
    const my = Math.max(4, Math.min(h - 18, (s.mark ?? 0.5) * h - 9));
    const frame = mobile
      ? `<rect x="${x0 - 3}" y="-3" width="${w + 6}" height="${h + 6}" rx="12" fill="#0B111A" stroke="#2E4058"/>`
      : `<rect x="-1" y="-1" width="${w + 2}" height="${h + 2}" rx="6" fill="#0B111A" stroke="#2E4058"/><rect x="-6" y="${h + 2}" width="${w + 12}" height="6" rx="3" fill="#2E4058"/>`;
    return `<svg viewBox="-8 -6 ${Math.max(w, 132) + 16} ${h + 18}" role="img" aria-label="Sketch of ${esc(s.place)}">${frame}${blocks}<rect x="${x0 + 2}" y="${my}" width="${w - 4}" height="18" rx="4" fill="none" stroke="${c}" stroke-width="2"/></svg>`;
  }

  PAGES.analytics = () => {
    const a = S().analytics;
    if (!a) return '<p class="dim">The growth analyst is still working.</p>';
    return `<h1>Growth analytics</h1><p class="lede">${esc(a.headline)}</p>
      <div class="kpis">${a.kpis.map((k) => `<div class="kpi ${k.tone || ''}"><div class="k">${esc(k.label)}</div><div class="v">${esc(k.value)}${k.ref ? pt(` [${k.ref}]`) : ''}</div>${k.note ? `<div class="n">${esc(k.note)}</div>` : ''}</div>`).join('')}</div>
      <div class="grid2" style="margin-top:16px">${a.charts.map((c) => `<div class="chart-card ${['channels', 'funnel', 'ltv'].includes(c.id) ? 'wide' : ''}">${cbtn(`chart:${c.id}`, c.title)}<h3>${esc(c.title)}</h3>${chart(c)}<p class="insight">${pt(c.insight)}</p>${moveLink(c.opportunityId)}</div>`).join('')}</div>`;
  };

  /* ---------------- charts (inline SVG, hover tooltips) ---------------- */
  const fmtU = (v, unit) => (unit === 'ratio' ? pct(v, v < 0.1 ? 1 : 0) : unit === 'usd' ? (Math.abs(v) >= 1000 ? usd(v) : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(Math.abs(v) < 100 && v % 1 ? 2 : 0)}`) : unit === 'x' ? `${v}×` : String(v));
  function chart(c) {
    if (c.kind === 'table' || (!c.series.length && c.table)) return tableOf(c.table);
    if (c.kind === 'funnel') return funnel(c);
    if (c.kind === 'lines') return lines(c);
    if (c.kind === 'waterfall') return waterfall(c);
    if (c.kind === 'split') return split(c);
    return bars(c) + (c.table ? `<details><summary class="dim small" style="cursor:pointer">Show the table</summary>${tableOf(c.table)}</details>` : '');
  }
  const tableOf = (t) => `<div style="overflow-x:auto"><table class="ws-table"><tr>${t.columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  function bars(c) {
    const pts = c.series[0].points;
    const max = Math.max(...pts.map((p) => p.y), c.benchmark?.value || 0) * 1.12;
    const W = 560, L = 170, R = 60, rowH = 30, H = pts.length * rowH + 26;
    const x = (v) => L + (v / max) * (W - L - R);
    let g = '';
    pts.forEach((p, i) => {
      const y = 8 + i * rowH;
      g += `<text x="${L - 10}" y="${y + 15}" text-anchor="end">${esc(p.x)}</text>`;
      g += `<rect x="${L}" y="${y + 4}" width="${Math.max(2, x(p.y) - L)}" height="16" rx="4" fill="var(--series-1)" data-tip="<b>${esc(p.x)}</b><br>${esc(fmtU(p.y, c.unit))}"/>`;
      g += `<text class="val" x="${x(p.y) + 6}" y="${y + 16}">${esc(fmtU(p.y, c.unit))}</text>`;
    });
    if (c.benchmark) g += `<line class="bench" x1="${x(c.benchmark.value)}" x2="${x(c.benchmark.value)}" y1="2" y2="${H - 18}"/><text x="${x(c.benchmark.value)}" y="${H - 4}" text-anchor="middle">${esc(c.benchmark.label)}</text>`;
    return `<div class="viz"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">${g}</svg></div>${c.benchmark?.ref ? `<div class="dim small">Benchmark ${pt(c.benchmark.ref)}</div>` : ''}`;
  }
  function funnel(c) {
    const [a, b] = c.series;
    const W = 620, L = 150, R = 70, rowH = 46, H = a.points.length * rowH + 10;
    const max = Math.max(...c.series.flatMap((s) => s.points.map((p) => p.y))) * 1.1;
    const x = (v) => L + (v / max) * (W - L - R);
    let g = '';
    a.points.forEach((p, i) => {
      const y = 6 + i * rowH;
      g += `<text x="${L - 10}" y="${y + 22}" text-anchor="end">${esc(p.x)}</text>`;
      [[a, 'var(--series-1)', 0], [b, 'var(--series-2)', 1]].forEach(([s, col, k]) => {
        const v = s.points[i].y, yy = y + 4 + k * 19;
        g += `<rect x="${L}" y="${yy}" width="${Math.max(2, x(v) - L)}" height="15" rx="4" fill="${col}" data-tip="<b>${esc(s.name)} · ${esc(p.x)}</b><br>${esc(pct(v, v < 0.1 ? 1 : 0))} of visits"/>`;
        g += `<text class="val" x="${x(v) + 6}" y="${yy + 12}">${esc(pct(v, v < 0.1 ? 1 : 0))}</text>`;
      });
    });
    return `<div class="legend"><span><i style="background:var(--series-1)"></i>${esc(a.name)}</span><span><i style="background:var(--series-2)"></i>${esc(b.name)}</span></div><div class="viz"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">${g}</svg></div>`;
  }
  function lines(c) {
    const W = 680, H = 240, L = 46, R = 160, T = 12, B = 28;
    const n = c.series[0].points.length;
    const max = Math.ceil(Math.max(...c.series.flatMap((s) => s.points.map((p) => p.y))) / 100) * 100;
    const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - v / max) * (H - T - B);
    let g = '';
    for (let v = 0; v <= max; v += max / 4) g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">$${v}</text>`;
    c.series[0].points.forEach((p, i) => { if (i % 2 === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.x)}</text>`; });
    const cols = ['var(--series-1)', 'var(--series-2)'];
    c.series.forEach((s, k) => {
      g += `<polyline fill="none" stroke="${cols[k]}" stroke-width="2.5" stroke-linejoin="round" points="${s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')}"/>`;
      const last = s.points[n - 1];
      g += `<circle cx="${x(n - 1)}" cy="${y(last.y)}" r="4" fill="${cols[k]}" stroke="var(--ws-card)" stroke-width="2"/><text class="val" x="${x(n - 1) + 10}" y="${y(last.y) + 4}">${esc(s.name)} $${last.y}</text>`;
    });
    const tips = c.series[0].points.map((p, i) => `<rect x="${x(i) - (W - L - R) / (n - 1) / 2}" y="${T}" width="${(W - L - R) / (n - 1)}" height="${H - T - B}" fill="transparent" data-tip="<b>${esc(p.x)}</b><br>${c.series.map((s) => `${esc(s.name)}: $${s.points[i].y}`).join('<br>')}" data-cross="${x(i)}"/>`).join('');
    return `<div class="legend">${c.series.map((s, k) => `<span><i style="background:${cols[k]}"></i>${esc(s.name)}</span>`).join('')}</div><div class="viz"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">${g}<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ws-muted)" stroke-width="1" opacity="0"/>${tips}</svg></div>`;
  }
  function waterfall(c) {
    const pts = c.series[0].points;
    const W = 620, H = 230, L = 20, B = 44, T = 16;
    const max = pts[0].y * 1.08, bw = (W - L * 2) / pts.length;
    const y = (v) => T + (1 - v / max) * (H - T - B);
    let run = 0, g = '';
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      let top, bot;
      if (i === 0 || last) { top = p.y; bot = 0; run = i === 0 ? p.y : run; }
      else { top = run; bot = run + p.y; run = bot; }
      const col = i === 0 ? 'var(--series-1)' : last ? 'var(--ws-good)' : 'var(--series-2)';
      const x0 = L + i * bw + 8;
      g += `<rect x="${x0}" y="${y(Math.max(top, bot))}" width="${bw - 16}" height="${Math.max(2, Math.abs(y(top) - y(bot)))}" rx="4" fill="${col}" data-tip="<b>${esc(p.x)}</b><br>${esc(fmtU(p.y, 'usd'))}"/>`;
      g += `<text class="val" x="${x0 + (bw - 16) / 2}" y="${y(Math.max(top, bot)) - 6}" text-anchor="middle">${esc(fmtU(p.y, 'usd'))}</text>`;
      g += `<text x="${x0 + (bw - 16) / 2}" y="${H - 22}" text-anchor="middle">${esc(p.x)}</text>`;
    });
    return `<div class="viz"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">${g}</svg></div>`;
  }
  function split(c) {
    const [f, k] = c.series[0].points;
    const b = c.benchmark;
    return `<div class="legend"><span><i style="background:var(--series-1)"></i>${esc(f.x)} ${esc(pct(f.y, 0))}</span><span><i style="background:var(--series-2)"></i>${esc(k.x)} ${esc(pct(k.y, 0))}</span></div>
      <div style="position:relative;margin:10px 0 22px"><div class="splitbar" style="height:34px"><div style="width:${f.y * 100}%;background:var(--series-1)" data-tip="<b>${esc(f.x)}</b><br>${esc(pct(f.y, 0))}"></div><div style="width:${k.y * 100}%;background:var(--series-2)" data-tip="<b>${esc(k.x)}</b><br>${esc(pct(k.y, 0))}"></div></div>
      ${b ? `<div style="position:absolute;left:${b.value * 100}%;top:-6px;bottom:-6px;border-left:2px dashed var(--ws-text);opacity:.7"></div><div class="dim small" style="position:absolute;left:${b.value * 100}%;top:40px;transform:translateX(-10%)">${esc(b.label)} ${b.ref ? pt(b.ref) : ''}</div>` : ''}</div>`;
  }

  PAGES.strategy = () => {
    const s = S().strategy;
    if (!s) return '<p class="dim">The subscription strategist is still working.</p>';
    const R = 52, C = 2 * Math.PI * R;
    return `<h1>Subscription strategy</h1><p class="lede">Subscriptions aren't one feature in one app. They get sold on the product page, remembered in email and SMS, protected in the portal, and saved in support. Here's how each tool in your stack is doing its part.</p>
      <div class="grid2"><div class="card soft">${cbtn('strategy:why', 'Why subscriptions matter')}<h3 style="margin:0 0 12px;font-size:17px">Why subscriptions matter for ${esc(S().store?.name || 'you')}</h3><ul class="why-list">${s.why.map((w, i) => `<li data-n="${i + 1}"><span>${pt(w)}</span></li>`).join('')}</ul></div>
      <div class="card" style="display:flex;gap:20px;align-items:center"><svg class="ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--ws-line)" stroke-width="12"/><circle cx="60" cy="60" r="${R}" fill="none" stroke="url(#rg)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C * s.maturity) / 100} ${C}" transform="rotate(-90 60 60)"/><defs><linearGradient id="rg"><stop offset="0" stop-color="#F5B94A"/><stop offset="1" stop-color="#FF8A5B"/></linearGradient></defs><text x="60" y="66" text-anchor="middle" font-size="26" font-weight="700" fill="#EEF3F8">${s.maturity}</text></svg>
      <div><h3 style="margin:0 0 6px;font-size:17px">Subscription maturity: ${s.maturity}/100</h3><p class="muted small" style="margin:0">Each connected tool scored 0–4 against what the best subscription brands do. Everything you need is installed; most of it isn't switched on for subscriptions yet.</p></div></div></div>
      <div class="ws-h2"><h2>Tool by tool</h2><span class="sub">Where you are today, what great looks like, and the plays that close the gap</span></div>
      <div class="grid2">${s.stack.map((t) => `<div class="stack-card">${cbtn(`stack:${t.tool}`, `Strategy · ${t.tool}`)}<div class="top">${t.source ? GP().mono(t.source, false) : ''}<div><h4>${esc(t.tool)}</h4><div class="role">${esc(t.role)}</div></div><div class="meter" title="${t.maturity} of 4">${[1, 2, 3, 4].map((i) => `<i class="${i <= t.maturity ? 'on' : ''}"></i>`).join('')}</div></div>
        <div class="tg"><div><b>Today</b><p>${pt(t.today)}</p></div><div><b>What great looks like</b><p class="muted">${esc(t.great)}</p></div></div>
        <div class="plays">${t.plays.map((p) => (p.opportunityId && (S().priorities || []).some((o) => o.id === p.opportunityId) ? `<button type="button" data-goto-move="${esc(p.opportunityId)}">→ ${esc(p.text)}</button>` : `<button type="button" disabled style="opacity:.7">${esc(p.text)}</button>`)).join('')}</div></div>`).join('')}</div>`;
  };

  PAGES.audit = () => {
    const p = S().profile;
    if (!p) return '<p class="dim">The store audit is still running.</p>';
    const tiles = (ts) => (ts?.length ? `<div class="kpis">${ts.map((t) => `<div class="kpi"><div class="k">${esc(t.label)}</div><div class="v">${esc(t.display)} ${pt(`[${t.dataRef}]`)}</div></div>`).join('')}</div>` : '');
    const sev = (f) => (f.positive ? '<span class="tag good">Working</span>' : `<span class="tag ${f.severity === 'high' ? 'bad' : f.severity === 'med' ? 'warn' : ''}">${f.severity === 'med' ? 'Medium' : f.severity === 'high' ? 'High' : 'Low'}</span>`);
    let html = `<h1>Store audit</h1><p class="lede">${pt(p.headline)}</p>${tiles(p.tiles)}`;
    if (p.contradictions.length) html += `<div class="ws-h2"><h2>Where your tools disagree</h2></div><div class="card"><table class="ws-table"><tr><th>Topic</th><th>One says</th><th>Another says</th><th>What the plan does</th></tr>${p.contradictions.map((c) => `<tr><td>${esc(c.topic)}</td><td>${GP().mono(c.first.source)} ${pt(c.first.claim)}</td><td>${GP().mono(c.second.source)} ${pt(c.second.claim)}</td><td class="muted">${esc(c.resolution)}</td></tr>`).join('')}</table></div>`;
    html += '<div class="ws-h2"><h2>By area</h2></div>';
    for (const s of p.sections) {
      html += `<div class="card" style="margin-bottom:12px">${cbtn(`audit:${s.area}`, `Audit · ${s.area}`)}<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">${s.source.map((x) => GP().mono(x)).join('')}<h3 style="margin:0;font-size:17px">${esc(s.area)}</h3></div><p style="margin:0 0 8px">${pt(s.headline)}</p>${tiles(s.tiles)}`;
      if (s.area === 'Email & SMS' && p.flows) html += `<div class="dim small" style="margin-top:10px">Klaviyo flows</div><div class="grid4" style="margin-top:6px">${p.flows.map((f) => `<div class="kpi" style="border-color:${f.status === 'live' ? 'rgba(85,195,138,.45)' : f.status === 'warn' ? 'rgba(245,185,74,.45)' : 'rgba(239,111,97,.45)'};${f.status === 'missing' ? 'border-style:dashed' : ''}"><div style="font-weight:600">${f.status === 'live' ? '✓' : f.status === 'warn' ? '⚠' : '✗'} ${esc(f.name)}${f.dataRef ? pt(` [${f.dataRef}]`) : ''}</div><div class="n">${esc(f.note)}</div></div>`).join('')}</div>`;
      if (s.area === 'Catalogue & inventory' && p.quarters.length) html += `<table class="ws-table" style="margin-top:10px"><tr><th>Quarter</th><th>Best seller</th><th>Weakest</th></tr>${p.quarters.map((q) => `<tr><td>${esc(q.quarter)}</td><td>${esc(q.best)} <span class="muted">${esc(q.bestNote)}</span>${q.bestRef ? pt(` [${q.bestRef}]`) : ''}</td><td>${esc(q.worst)} <span class="muted">${esc(q.worstNote)}</span>${q.worstRef ? pt(` [${q.worstRef}]`) : ''}</td></tr>`).join('')}</table>`;
      html += `<div style="display:grid;gap:8px;margin-top:12px">${s.findings.map((f) => `<div style="display:flex;gap:10px;align-items:baseline">${sev(f)}<span>${pt(f.claim)}</span></div>`).join('')}</div></div>`;
    }
    html += `<div class="ws-h2"><h2>What we couldn't see</h2></div><div class="card"><ul style="margin:0;padding-left:18px">${p.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
    return html;
  };

  PAGES.plan = () => {
    const st = S();
    const eff = effective();
    const ranked = eff.filter((o) => o.eff), locked = eff.filter((o) => o.locked), excl = eff.filter((o) => o.excluded && !o.locked);
    const edited = ranked.filter((o) => o.eff.edited);
    const r = st.plan?.roadmap;
    let html = `<h1>Action plan</h1><p class="lede">Every move is ranked by what it's worth in a year, how sure we are, and how much work it takes. Open any move to see the maths and change an assumption; the ranking updates as you go. Each one can be built for you, or walked through step by step.</p>
      <div class="formula-note">Score = yearly value × confidence (High 1.0 · Medium 0.7 · Low 0.4) ÷ effort (Small 1 · Medium 2 · Large 4). Every input has a store-data <span class="dref">d</span> or web <span class="claim">c</span> source.</div>`;
    if (edited.length) html += `<div class="edited-banner">✏️ Re-ranked with your edits to ${edited.length} move${edited.length > 1 ? 's' : ''}.<span style="flex:1"></span><button type="button" class="ws-btn sm" data-reset-edits>Reset to the crew's numbers</button></div>`;
    if (r) {
      const col = (t, items) => `<div class="col"><h4>${t}</h4>${items.length ? items.map((i) => `<div class="item ${i.kind}" ${i.kind === 'build' && i.opportunityId ? `data-goto-move="${esc(i.opportunityId)}"` : ''}>${esc(i.title)}</div>`).join('') : '<div class="dim small">Nothing yet</div>'}</div>`;
      html += `<div class="ws-h2"><h2>30 / 60 / 90 days</h2><span class="sub">${esc(r.capacityNote)}</span></div><div class="board">${col('Days 0–30', r.days30)}${col('Days 31–60', r.days60)}${col('Days 61–90', r.days90)}${col('After 90 days', r.later)}</div>`;
    }
    html += `<div class="ws-h2"><h2>Moves, ranked</h2><span class="sub">${ranked.length} moves${locked.length ? ` · ${locked.length} locked` : ''}</span></div>`;
    html += ranked.map((o) => moveRow(o)).join('');
    if (excl.length) html += `<div class="ws-h2"><h2>Ruled out by your constraints</h2></div>${excl.map((o) => moveRow(o)).join('')}`;
    if (locked.length) html += `<div class="ws-h2"><h2>Locked: connect a source to unlock</h2></div>${locked.map((o) => moveRow(o)).join('')}`;
    return html;
  };
  function moveRow(o) {
    const init = initOf(o.id), pkg = pkgOf(o.id), status = ws.data.status[o.id] || '';
    if (!o.eff) return `<div class="move ${o.locked ? 'locked' : 'excluded'}" id="move-${o.id}"><div class="move-head"><div class="num">${o.locked ? '🔒' : '—'}</div><div><h3>${esc(o.title)}</h3><div class="muted">${esc((o.locked || o.excluded).message)}</div></div><div></div></div></div>`;
    const was = o.rank && o.rank !== o.eff.rank ? `<small>was #${o.rank}</small>` : '';
    const open = view.openMove === o.id || (!view.openMove && o.eff.rank === 1);
    return `<div class="move" id="move-${o.id}"><div class="move-head"><div class="num">#${o.eff.rank}${was}</div><div><h3>${esc(o.title)}${o.goalFit ? ' <span class="tag good" style="vertical-align:3px">Fits your goal</span>' : ''}</h3>
        <div class="tags"><span class="tag">Confidence: ${CONF[o.eff.confidence][0]}</span><span class="tag">Effort: ${EFF[o.eff.effort][0]}</span><span class="tag">~${o.timeToSignalWeeks} weeks to know</span><span class="tag">${esc(o.area)}</span>${o.eff.edited ? '<span class="tag warn">Edited</span>' : ''}${reviewTags(o.id)}</div></div>
        <div class="impact"><div class="big">${usd(o.eff.impact)}<span class="muted" style="font-size:14px;font-weight:500">/yr</span></div><div class="small">score ${usd(o.eff.score)}</div></div></div>
      <div class="move-controls">${pkg ? `<button type="button" class="ws-btn primary" data-build="${o.id}">⚡ Build this for me</button><button type="button" class="ws-btn" data-walk="${o.id}">🧭 Walk me through it</button>` : ''}
        <select data-status="${o.id}" class="status-${status || 'none'}" aria-label="Status">${STATUS.map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input data-owner="${o.id}" placeholder="Owner" value="${esc(ws.data.owners[o.id] || '')}" aria-label="Owner">
        ${ws.data.built[o.id] ? '<span class="tag good">Build kit ready</span>' : ''}${cbtn(`move:${o.id}`, o.title, true)}</div>
      <details class="move-more" data-move="${o.id}" ${open ? 'open' : ''}><summary>Why, how, and the maths</summary><div class="move-body">
        <div><h4>Why this, why now</h4><div>${pt(init ? init.why : o.rationale)}</div></div>
        ${init ? `<div><h4>How</h4><ol>${init.steps.map((s) => `<li>${pt(s)}</li>`).join('')}</ol></div>
        <div class="meta4"><div><span>Owner</span>${esc(ws.data.owners[o.id] || init.owner)}</div><div><span>Tools</span>${esc(init.tools.join(', '))}</div><div><span>Depends on</span>${esc(init.dependencies.join(', ') || 'Nothing')}</div><div><span>Success looks like</span>${esc(init.success.metric)}: ${esc(init.success.target)} by ${esc(init.success.by)}</div></div>` : ''}
        ${assumptions(o)}
        ${o.overlapNote ? `<div class="dim small">${esc(o.overlapNote)}</div>` : ''}
      </div></details></div>`;
  }
  function assumptions(o) {
    const e = o.eff;
    const cur = o.currentRate.value;
    const lo = Math.max(cur + 0.002, 0), hi = Math.max(o.targetRate.value * 2, cur + 0.05);
    const deltaPts = Math.round((e.target - cur) * 1000) / 10;
    return `<div class="assume" data-assume="${o.id}"><h4>The maths, with your assumptions</h4><table>
      <tr><td>Who it reaches</td><td>${esc(o.audience.display)} ${o.audience.ref ? pt(o.audience.ref) : ''}</td></tr>
      <tr><td>Today</td><td>${esc(o.currentRate.display)} ${o.currentRate.note ? `<span class="muted">${esc(o.currentRate.note)}</span>` : ''} ${o.currentRate.ref ? pt(o.currentRate.ref) : ''}</td></tr>
      <tr><td>Target</td><td><input type="range" min="${lo.toFixed(3)}" max="${hi.toFixed(3)}" step="0.001" value="${e.target}" data-target="${o.id}" aria-label="Target rate"> <b data-target-out="${o.id}">${esc(pct(e.target))}</b> <span class="muted">crew's pick ${esc(o.targetRate.display)}</span> ${o.targetRate.ref ? pt(o.targetRate.ref) : ''}</td></tr>
      <tr><td>Value per customer</td><td>${esc(o.valuePerConversion.display)} ${o.valuePerConversion.ref ? pt(o.valuePerConversion.ref) : ''}</td></tr>
      <tr><td>Confidence</td><td><select data-conf="${o.id}">${Object.entries(CONF).map(([k, [l]]) => `<option value="${k}" ${k === e.confidence ? 'selected' : ''}>${l}</option>`).join('')}</select> <span class="muted small">${esc(o.confidenceWhy)}</span></td></tr>
      <tr><td>Effort</td><td><select data-effort="${o.id}">${Object.entries(EFF).map(([k, [l]]) => `<option value="${k}" ${k === e.effort ? 'selected' : ''}>${l}</option>`).join('')}</select> <span class="muted small">${esc(o.effortWhy)}</span></td></tr></table>
      <div class="eq" data-eq="${o.id}">${num(o.audience.value)} × <b>${deltaPts}</b> pts × $${o.valuePerConversion.value} × 12 = <b>${usd(e.impact)}/yr</b> · × ${CONF[e.confidence][1]} ÷ ${EFF[e.effort][1]} = score <b>${usd(e.score)}</b></div></div>`;
  }

  PAGES.tests = () => {
    const t = S().tests;
    if (!t) return '<p class="dim">The planner is designing the tests.</p>';
    let html = `<h1>Tests & tracking</h1><p class="lede">How you'll know each move worked, how long it takes to find out, and the "before" numbers to compare against. Sample sizes come from the standard formula at 95% confidence and 80% power; when your traffic can't reach one in a sensible time, the plan says so.</p>`;
    html += t.tests.map((x) => {
      const pk = pkgOf(x.opportunityId);
      return `<div class="card" style="margin-bottom:14px">${cbtn(`test:${x.opportunityId}`, `Test · ${x.title}`)}<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><h3 style="margin:0;font-size:17px">#${rankOf(x.opportunityId) ?? x.rank} ${esc(x.title)}</h3><span class="tag">${num(x.nPerArm)} per group</span><span class="tag">~${Math.round(x.totalWeeks)} weeks</span></div>
        <div class="grid2" style="margin-top:12px"><table class="ws-table">
          <tr><td class="muted">We think</td><td>${esc(x.hypothesis)}</td></tr><tr><td class="muted">How we test it</td><td>${esc(x.design)}</td></tr>
          <tr><td class="muted">We measure</td><td>${esc(x.primaryMetric)}</td></tr><tr><td class="muted">We watch so nothing breaks</td><td>${esc(x.guardrails.join(' · '))}</td></tr>
          <tr><td class="muted">How many people</td><td>~${num(x.nPerArm)} per group to tell ${esc(pct(x.baseline))} from ${esc(pct(x.target))}. ${num(x.eligiblePerMonth)} ${pt(x.eligibleNote)}.</td></tr>
          <tr><td class="muted">How long</td><td>~${x.weeksToEnrol} weeks to fill both groups + ${x.readoutLagWeeks} week${x.readoutLagWeeks === 1 ? '' : 's'} to see results${x.proxy ? `<div class="dim small">${esc(x.proxy)}</div>` : ''}</td></tr>
          <tr><td class="muted">We ship it if</td><td>${esc(x.decisionRule)}</td></tr></table>
        ${pk ? `<div><h4 class="dim small" style="margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em">Before numbers (today)</h4><table class="ws-table">${pk.tracking.baseline.map((b) => `<tr><td>${esc(b.metric)}</td><td><b>${esc(b.value)}</b> ${b.ref ? pt(`[${b.ref}]`) : ''}</td></tr>`).join('')}</table>
          <h4 class="dim small" style="margin:12px 0 6px;text-transform:uppercase;letter-spacing:.05em">Events we track</h4><div class="tags">${pk.tracking.events.map((e) => `<span class="tag">${esc(e)}</span>`).join('')}</div>
          <p class="muted small" style="margin:10px 0 0">${esc(pk.tracking.compare)}</p></div>` : ''}</div></div>`;
    }).join('');
    if (t.feasibility.length) html += `<div class="ws-h2"><h2>Tests we didn't run as asked</h2></div>${t.feasibility.map((f) => `<div class="card" style="border-style:dashed;border-color:rgba(245,185,74,.5);margin-bottom:10px"><b>${esc(f.name)}</b><div style="margin:4px 0">Needs about <b>${num(f.nPerArm)}</b> per group; the store has ${num(f.available)} ${pt(f.availableLabel)}.</div><div class="muted">${esc(f.instead)}</div></div>`).join('')}`;
    return html;
  };

  const srcFilter = { kind: 'all', source: null };
  PAGES.sources = () => {
    const st = S();
    const vPill = (id) => { const v = st.verdicts.get(id); return v ? `<span class="tag ${v.verdict === 'mismatch' ? 'warn' : v.verdict === 'unsupported' ? '' : 'good'}">${esc(v.verdict === 'mismatch' ? 'corrected' : v.verdict)}</span>` : '<span class="dim small">not cited</span>'; };
    const sources = GP().SRC_ORDER.concat('storefront').filter((s) => [...st.ledger.values()].some((e) => e.source === s));
    let html = `<h1>Sources</h1><p class="lede">Every web claim and every store number the crew used, with what the fact-checker found. Store numbers are demo data; web sources are illustrative.</p>
      <div class="seg">${[['all', 'Everything'], ['web', `Web (${st.webFindings.length})`], ['data', `Store data (${st.ledger.size})`]].map(([k, l]) => `<button type="button" data-srckind="${k}" aria-pressed="${srcFilter.kind === k}">${l}</button>`).join('')}</div>
      <div class="tags" style="margin:10px 0 16px">${sources.map((s) => `<button type="button" class="tag" data-srcsource="${s}" style="cursor:pointer;${srcFilter.source === s ? 'border-color:var(--ws-accent);color:var(--ws-text)' : ''}">${GP().mono(s)} ${esc(GP().srcLabel(s))}</button>`).join('')}</div>`;
    if (srcFilter.kind !== 'data' && !srcFilter.source) html += `<div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 8px;font-size:16px">Web claims</h3><table class="ws-table"><tr><th></th><th>Claim</th><th>Source</th><th>Fact-check</th></tr>${st.webFindings.map((f) => `<tr><td>${pt(`[${f.id}]`)}</td><td>${esc(f.claim)}<div class="dim small">${esc(f.evidence)}</div></td><td>${f.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="muted">${esc(s.title)}</a>`).join(', ')}</td><td>${vPill(f.id)}</td></tr>`).join('')}</table></div>`;
    if (srcFilter.kind !== 'web') html += `<div class="card"><h3 style="margin:0 0 8px;font-size:16px">Store data ledger <span class="demo-tag">Demo data</span></h3><table class="ws-table"><tr><th></th><th>Source</th><th>Metric</th><th>Value</th><th>Fact-check</th></tr>${[...st.ledger.values()].filter((e) => !srcFilter.source || e.source === srcFilter.source).map((e) => `<tr><td>${pt(`[${e.id}]`)}</td><td>${GP().mono(e.source)}</td><td>${esc(e.label)}<div class="dim small"><code>${esc(e.tool)}(${esc(Object.entries(e.args).map(([k, v]) => `${k}=${v}`).join(', '))})</code></div></td><td><b>${esc(GP().fmtValue(e.value, e.unit))}</b></td><td>${vPill(e.id)}</td></tr>`).join('')}</table></div>`;
    return html;
  };

  /* ---------------- build / walkthrough sheet ---------------- */
  let buildTimer = 0;
  function openSheet(id, mode) {
    view.build = { id, mode, step: 0, phase: mode === 'build' && !ws.data.built[id] ? 'running' : 'done', log: 0 };
    if (view.build.phase === 'running') runBuild();
    GP().invalidate(); renderSheet();
  }
  function runBuild() {
    clearInterval(buildTimer);
    const pk = pkgOf(view.build.id);
    buildTimer = setInterval(() => {
      if (!view.build || view.build.phase !== 'running') { clearInterval(buildTimer); return; }
      view.build.log++;
      if (view.build.log >= pk.buildLog.length + 1) {
        clearInterval(buildTimer);
        view.build.phase = 'done';
        ws.data.built[view.build.id] = new Date().toISOString();
        changed(false);
      }
      renderSheet(true);
    }, 420);
  }
  function closeSheet() { clearInterval(buildTimer); view.build = null; renderSheet(); GP().invalidate(); }
  let sheetKey = '';
  function renderSheet(force) {
    let wrap = document.getElementById('ws-sheet');
    if (!view.build) { if (wrap) wrap.remove(); sheetKey = ''; return; }
    const b = view.build, pk = pkgOf(b.id);
    if (!pk) { view.build = null; return; }
    const key = `${b.id}:${b.mode}:${b.step}:${b.phase}:${b.log}:${ws.version}`;
    if (!force && key === sheetKey && wrap) return;
    sheetKey = key;
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'ws-sheet'; wrap.className = 'sheet-wrap ws';
      wrap.style.display = 'flex';
      wrap.addEventListener('click', onClick); wrap.addEventListener('change', onChange);
      document.body.appendChild(wrap);
    }
    const o = effective().find((x) => x.id === b.id);
    const bodyScroll = wrap.querySelector('.sheet-body')?.scrollTop || 0;
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(pk.title)}"><div class="sheet-head"><div><div class="dim small">Move #${o?.eff?.rank ?? '–'} · ${o?.eff ? `${usd(o.eff.impact)} a year` : ''}</div><h2>${esc(pk.title)}</h2></div><span class="grow"></span>
      <div class="seg"><button type="button" data-mode="build" aria-pressed="${b.mode === 'build'}">⚡ Build it for me</button><button type="button" data-mode="walk" aria-pressed="${b.mode === 'walk'}">🧭 Walk me through it</button></div>
      <button type="button" class="ws-btn ghost" data-close aria-label="Close">✕</button></div>
      <div class="sheet-body">${b.mode === 'walk' ? walkView(pk) : b.phase === 'running' ? runView(pk) : kitView(pk)}</div>
      <div class="sheet-foot">${footer(pk)}</div></div>`;
    const sb = wrap.querySelector('.sheet-body'); if (sb && !force) sb.scrollTop = bodyScroll;
  }
  function footer(pk) {
    const b = view.build;
    if (b.mode === 'walk') {
      const done = ws.data.walk[b.id] || {};
      const n = pk.walkthrough.length, d = pk.walkthrough.filter((_, i) => done[i]).length;
      return `<div style="width:220px"><div class="bar"><i style="width:${(d / n) * 100}%"></i></div><div class="dim small" style="margin-top:4px">${d} of ${n} steps done</div></div><span class="grow"></span>
        <button type="button" class="ws-btn" data-step="${Math.max(0, b.step - 1)}" ${b.step === 0 ? 'disabled' : ''}>← Back</button>
        <button type="button" class="ws-btn" data-stepdone="${b.step}">${done[b.step] ? '✓ Done' : 'Mark this step done'}</button>
        ${b.step < n - 1 ? `<button type="button" class="ws-btn primary" data-step="${b.step + 1}">Next step →</button>` : `<button type="button" class="ws-btn primary" data-approve>Finish</button>`}`;
    }
    if (b.phase === 'running') return '<span class="dim small">Building on demo data. Nothing is being sent to your tools.</span>';
    return `<span class="dim small">Demo mode: this is a preview of what would be created. Nothing has been sent to Skio, Klaviyo, Postscript or Gorgias.</span><span class="grow"></span>
      <button type="button" class="ws-btn" data-mode="walk">🧭 Walk me through it instead</button>
      <button type="button" class="ws-btn primary" data-approve>✓ Approve and add to the plan</button>`;
  }
  function runView(pk) {
    const b = view.build;
    return `<div class="build-run"><div class="dim small">Building</div><h3>${esc(pk.title)}</h3><p class="muted">${esc(pk.summary)}</p><div class="bar" style="margin-top:14px"><i style="width:${Math.min(100, (b.log / pk.buildLog.length) * 100)}%"></i></div>
      <ul class="build-log">${pk.buildLog.map((l, i) => `<li class="${i < b.log ? 'done' : i === b.log ? 'now' : ''}"><span class="st">${i < b.log ? '✓' : ''}</span>${esc(l)}</li>`).join('')}</ul></div>`;
  }
  function kitView(pk) {
    return `<div class="kit"><div class="kit-side">${kitBanner(view.build.id)}
        <div><h4>Why this is worth building</h4><ul>${pk.plainCase.map((s) => `<li>${pt(s)}</li>`).join('')}</ul></div>
        <div><h4>What you get</h4><p style="margin:0 0 6px">${esc(pk.summary)}</p><p class="muted small" style="margin:0"><b>Paired messages:</b> ${esc(pk.comms)}</p></div>
        <div><h4>The test</h4><table class="ws-table"><tr><td class="muted">Split</td><td>${esc(pk.test.split)}</td></tr><tr><td class="muted">Measure</td><td>${esc(pk.test.metric)}</td></tr><tr><td class="muted">Watch</td><td>${esc(pk.test.guardrail)}</td></tr><tr><td class="muted">How long</td><td>${esc(pk.test.runFor)}</td></tr><tr><td class="muted">Using</td><td>${esc(pk.test.tool)}</td></tr></table></div>
        <div><h4>Before numbers we saved</h4><table class="ws-table">${pk.tracking.baseline.map((x) => `<tr><td>${esc(x.metric)}</td><td><b>${esc(x.value)}</b> ${x.ref ? pt(`[${x.ref}]`) : ''}</td></tr>`).join('')}</table><p class="muted small" style="margin:8px 0 0">${esc(pk.tracking.compare)}</p></div>
        <div><h4>What we track</h4><ul>${pk.tracking.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
      </div><div class="kit-main"><div class="asset-nav">${pk.assets.map((a) => `<button type="button" data-jump="${esc(a.id)}">${esc(a.platform)} · ${esc(a.name)}</button>`).join('')}</div>${pk.assets.map((a) => assetView(a)).join('')}</div></div>`;
  }
  function walkView(pk) {
    const b = view.build, done = ws.data.walk[b.id] || {};
    const s = pk.walkthrough[b.step];
    const assets = (s.assets || []).map((id) => pk.assets.find((a) => a.id === id)).filter(Boolean);
    return `<div class="walk"><div class="walk-steps">${pk.walkthrough.map((w, i) => `<button type="button" data-step="${i}" aria-current="${i === b.step}" class="${done[i] ? 'done' : ''}"><span class="n2">${done[i] ? '✓' : i + 1}</span><span>${esc(w.title)}<br><span class="dim small">~${w.minutes} min</span></span></button>`).join('')}
        <div class="dim small" style="padding:12px 10px">About ${pk.walkthrough.reduce((t, w) => t + w.minutes, 0)} minutes in total.</div></div>
      <div class="walk-main">${kitBanner(view.build.id)}<div class="dim small">Step ${b.step + 1} of ${pk.walkthrough.length} · about ${s.minutes} minutes</div><h3>${esc(s.title)}</h3><div><span class="crumb">📍 ${esc(s.where)}</span></div>
        <ol class="do-list">${s.do.map((d) => `<li>${pt(d)}</li>`).join('')}</ol>
        ${s.values?.length ? `<div class="values">${s.values.map((v) => `<div><span>${esc(v.label)}</span><b>${esc(v.value)}</b><button type="button" class="copy" data-copy="${esc(v.value)}">Copy</button></div>`).join('')}</div>` : ''}
        <div class="whybox"><b>Why this matters:</b> ${pt(s.why)}</div>
        ${assets.map((a) => assetView(a)).join('')}</div></div>`;
  }
  const art = {
    bag: '<svg viewBox="0 0 420 150"><rect x="160" y="18" width="100" height="124" rx="10" fill="#6b4530"/><rect x="160" y="18" width="100" height="22" rx="6" fill="#4f3324"/><rect x="176" y="62" width="68" height="44" rx="6" fill="#efe4cf"/><text x="210" y="82" text-anchor="middle" font-size="11" fill="#6b4530" font-family="Georgia">BRAMBLE</text><text x="210" y="97" text-anchor="middle" font-size="11" fill="#6b4530" font-family="Georgia">&amp; BEAN</text><circle cx="110" cy="110" r="22" fill="#c79a6b"/><circle cx="320" cy="96" r="14" fill="#c79a6b"/><circle cx="345" cy="124" r="9" fill="#a26d49"/></svg>',
    calendar: '<svg viewBox="0 0 420 150"><rect x="130" y="16" width="160" height="124" rx="12" fill="#fff" stroke="#c79a6b" stroke-width="3"/><rect x="130" y="16" width="160" height="30" rx="10" fill="#6b4530"/><g fill="#eadfcd">' + Array.from({ length: 14 }, (_, i) => `<rect x="${144 + (i % 7) * 20}" y="${58 + Math.floor(i / 7) * 34}" width="14" height="14" rx="3" ${i === 9 ? 'fill="#e8a17a"' : ''}/>`).join('') + '</g><path d="M314 70 q20 20 0 40" stroke="#c79a6b" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
    cups: '<svg viewBox="0 0 420 150"><rect x="120" y="60" width="70" height="70" rx="10" fill="#fff" stroke="#6b4530" stroke-width="3"/><path d="M190 76 q24 0 24 18 t-24 18" stroke="#6b4530" stroke-width="3" fill="none"/><rect x="236" y="76" width="56" height="54" rx="9" fill="#fff" stroke="#c79a6b" stroke-width="3"/><path d="M150 50 q8 -14 0 -28 M168 50 q8 -14 0 -28" stroke="#c79a6b" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
    gift: '<svg viewBox="0 0 420 150"><rect x="150" y="54" width="120" height="86" rx="8" fill="#e8a17a"/><rect x="140" y="40" width="140" height="24" rx="6" fill="#d98a62"/><rect x="202" y="40" width="16" height="100" fill="#6b4530"/><path d="M210 40 q-30 -34 -40 -6 q10 10 40 6 q30 4 40 -6 q-10 -28 -40 6" fill="#6b4530"/></svg>',
    box: '<svg viewBox="0 0 420 150"><path d="M130 60 L210 30 L290 60 L290 128 L210 150 L130 128 Z" fill="#c79a6b"/><path d="M130 60 L210 88 L290 60" stroke="#8b5a3c" stroke-width="3" fill="none"/><path d="M210 88 L210 150" stroke="#8b5a3c" stroke-width="3"/><rect x="226" y="98" width="40" height="18" rx="3" fill="#efe4cf"/></svg>',
    heart: '<svg viewBox="0 0 420 150"><path d="M210 138 C120 86 130 30 180 30 C198 30 206 42 210 50 C214 42 222 30 240 30 C290 30 300 86 210 138 Z" fill="#e8a17a"/></svg>',
  };
  /* Previews read like the real message: Klaviyo/Gorgias tags get sample values; "Copy text" keeps the tags. */
  const SAMPLE = [
    [/\{\{\s*first_name\|default:'there'\s*\}\}/g, 'Jamie'], [/\{\{ticket\.customer\.firstname\}\}/g, 'Jamie'],
    [/\{\{\s*person\.skio_nextBillingDate\|date:"M j"\s*\}\}/g, 'Oct 9'], [/\{\{ticket\.customer\.integrations\.skio\.next_billing_date\}\}/g, 'Oct 30'],
    [/\{\{\s*event\.nextBillingDate\|date:"l"\s*\}\}/g, 'Thursday'], [/\{\{\s*event\.extra\.line_items\.0\.product\.title\|default:'coffee'\s*\}\}/g, 'House Blend'],
    [/\{\{\s*event\.ProductName\s*\}\}/g, 'Ethiopia Guji 12oz'], [/\{%\s*unsubscribe[^%]*%\}/g, 'Unsubscribe'],
  ];
  const sample = (t) => SAMPLE.reduce((s2, [re, v]) => s2.replace(re, v), String(t ?? ''));
  function assetView(a) {
    const target = `asset:${a.id}`;
    const head = `<div class="asset-head"><span class="plat ${esc(a.platform.split(' ')[0])}">${esc(a.platform)}</span><h4>${esc(a.name)}</h4>${a.kind === 'email' || a.kind === 'sms' || a.kind === 'macro' ? `<button type="button" class="copy" data-copyasset="${esc(a.id)}">Copy text</button>` : ''}${cbtn(target, a.name, true)}</div>`;
    let body = '';
    if (a.kind === 'email') {
      body = `<div class="mail"><div class="mail-meta"><div><b>From:</b> ${esc(a.from)}</div><div><b>Subject:</b> ${esc(sample(a.subject))}</div><div><b>Preview:</b> ${esc(a.preview)}</div><div class="muted">Sends: ${esc(a.timing)} · preview uses sample data (Jamie)</div></div>${a.blocks.map((bl) => {
        switch (bl.type) {
          case 'hero': return `<div class="mail-hero">${art[bl.art] || art.bag}<div class="cap">${esc(sample(bl.text))}</div></div>`;
          case 'heading': return `<div class="mail-body" style="padding-bottom:0"><h3>${esc(sample(bl.text))}</h3></div>`;
          case 'text': return `<div class="mail-body" style="padding-top:6px;padding-bottom:0"><p>${esc(sample(bl.text))}</p></div>`;
          case 'button': return `<div class="mail-body" style="padding-top:0;padding-bottom:0"><a class="mail-btn ${bl.note && !/Quick Action/.test(bl.note) ? 'alt' : ''}" href="#" onclick="return false" title="${esc(bl.href)}">${esc(bl.text)}</a>${bl.note ? `<div class="mail-note">${/Quick Action/.test(bl.note) ? '⚡ ' : ''}${esc(bl.note)}<br><code>${esc(bl.href)}</code></div>` : ''}</div>`;
          case 'products': return `<div class="mail-body" style="padding-top:0;padding-bottom:0"><div class="mail-products">${bl.items.map((it) => `<div><i></i><span><b>${esc(it.name)}</b>${it.note ? `<small>${esc(it.note)}</small>` : ''}</span><b>${esc(it.price)}</b></div>`).join('')}</div></div>`;
          case 'quote': return `<div class="mail-body" style="padding-top:0;padding-bottom:0"><div class="mail-quote">${esc(bl.text)}</div></div>`;
          case 'footer': return `<div class="mail-body" style="padding-top:0"><div class="mail-foot">${esc(sample(bl.text))}</div></div>`;
          default: return '';
        }
      }).join('')}</div>`;
    } else if (a.kind === 'sms') {
      body = `<div class="phone"><div class="from">${esc(a.platform)} · ${esc(a.timing)}</div><div class="bubble">${esc(a.body)}</div><div class="chars">${a.body.length} characters · ${Math.ceil(a.body.length / 160)} segment${a.body.length > 160 ? 's' : ''}</div></div>${a.link ? `<div class="dim small" style="text-align:center;margin-top:10px">🔗 ${esc(a.link.note)}<br><code style="font-size:11px">${esc(a.link.href)}</code></div>` : ''}`;
    } else if (a.kind === 'flow') {
      body = `<div class="flowd"><div class="node trigger">⚡ Trigger: ${esc(a.trigger)}</div><div class="filters">${a.filters.map((f) => `Filter: ${esc(f)}`).join(' · ')}</div>${a.steps.map((s) => `<div class="arrow"></div><div class="node ${s.kind}">${esc(s.label)}</div>`).join('')}</div>`;
    } else if (a.kind === 'config') {
      body = `<div class="where">${esc(a.where)}</div><table class="cfg">${a.settings.map((s) => `<tr><td>${esc(s.label)}</td><td>${/^https?:/.test(s.value) ? `<code>${esc(s.value)}</code> <button type="button" class="copy" data-copy="${esc(s.value)}">Copy</button>` : esc(s.value)}</td></tr>`).join('')}</table>`;
    } else if (a.kind === 'cancel-flow') {
      body = `<div class="where">${esc(a.where)}</div><div class="cf">${a.reasons.map((r) => `<div class="cf-reason"><div><b>“${esc(r.reason)}”</b><span class="dim small">${r.share ? `${esc(r.share)} of cancels ` : ''}${r.ref ? pt(`[${r.ref}]`) : ''}</span></div><div class="cf-offers">${r.offers.map((of, i) => `<div class="cf-offer"><small>Treatment ${i + 1} · ${esc(of.type)}</small>${esc(of.label)}</div>`).join('')}</div></div>`).join('')}</div>
        <div style="margin-top:14px" class="dim small">A/B test traffic split</div><div class="splitbar">${a.variants.map((v, i) => `<div style="width:${v.split}%;background:${i ? 'rgba(178,139,245,.35)' : 'var(--ws-card-3)'}" title="${esc(v.description)}">${esc(v.name)} · ${v.split}%</div>`).join('')}</div>`;
    } else if (a.kind === 'macro') {
      body = `<div class="where">Use when: ${esc(a.when)}</div><div class="macro-body">${esc(sample(a.body)).replace(/(https:\/\/\S+)/g, '<span class="dim">$1</span>')}</div><div class="tags" style="margin-top:10px">${a.actions.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>`;
    } else if (a.kind === 'print') {
      body = `<div class="print-cards"><div>${esc(a.front)}</div><div style="background:#6b4530;color:#f6efe1">${esc(a.back)}</div></div>`;
    } else if (a.kind === 'ad') {
      body = `<div class="ad"><div class="p"><b>Bramble &amp; Bean</b> · Sponsored<br>${esc(a.primary)}</div><div class="vis">${esc(a.visual)}<br><br><small>${esc(a.format)}</small></div><div class="bar2"><b>${esc(a.headline)}</b><span>${esc(a.cta)}</span></div></div>`;
    }
    return `<div class="asset" id="asset-${esc(a.id)}">${head}<div class="asset-body">${body}</div></div>`;
  }
  function assetText(a) {
    if (a.kind === 'email') return [`Subject: ${a.subject}`, `Preview: ${a.preview}`, '', ...a.blocks.map((b) => (b.type === 'button' ? `[${b.text}] ${b.href}` : b.type === 'products' ? b.items.map((i) => `- ${i.name} ${i.price}`).join('\n') : b.text || '')).filter(Boolean)].join('\n');
    if (a.kind === 'sms') return a.body;
    if (a.kind === 'macro') return a.body;
    return '';
  }

  /* ---------------- quick review: a deck of strategy "profiles" ---------------- */
  const REQS = ['Less work for us', 'Test it small first', 'Cheaper to run', 'Softer, less salesy', 'Go bigger', 'Use our brand voice'];
  const LOOK = { Storefront: ['🛍️', '#4A2440', '#1F2E4A'], 'Email & SMS': ['✉️', '#4A3F17', '#1E2B3F'], Subscriptions: ['☕', '#3A2D5C', '#1C2A40'], Support: ['🎧', '#5A3322', '#1C2A40'], 'Paid & social': ['📣', '#1E3560', '#2A2140'] };
  const rv = { open: false, i: 0, anim: null, learn: false, summary: false, enter: false };
  const deck = () => (S().reviewDeck || []).filter((c) => (S().priorities || []).some((o) => o.id === c.opportunityId && o.rank));
  const rstate = (id) => (ws.data.review[id] ||= { decision: null, picks: [], requests: [], note: '' });
  const decided = (c) => !!ws.data.review[c.opportunityId]?.decision;
  const reviewCount = () => deck().filter(decided).length;
  function openReview(summary = false) {
    const d = deck(), next = d.findIndex((c) => !decided(c));
    Object.assign(rv, { open: true, summary: summary || next < 0, i: next < 0 ? 0 : next, learn: false, anim: null, enter: true });
    renderReview(true);
  }
  function closeReview() { rv.open = false; renderReview(); renderedKey = ''; GP().invalidate(); }
  function decide(kind) {
    const d = deck(), c = d[rv.i];
    if (!c || rv.anim) return;
    const r = rstate(c.opportunityId);
    r.decision = kind; r.at = new Date().toISOString();
    if (kind === 'love' && !r.picks.length) { const rec = c.options.find((o) => o.recommended); if (rec) r.picks = [rec.id]; }
    changed(false);
    rv.anim = kind === 'love' ? 'fly-right' : 'fly-left';
    renderReview(true);
    setTimeout(() => {
      rv.anim = null; rv.learn = false; rv.enter = true;
      const after = d.findIndex((x, k) => k > rv.i && !decided(x)), any = d.findIndex((x) => !decided(x));
      if (after >= 0) rv.i = after; else if (any >= 0) rv.i = any; else rv.summary = true;
      ws.version++; renderReview(true); GP().invalidate();
    }, 320);
  }
  const moneyOf = (o) => (o?.eff ? o.eff.impact : o?.annualImpact || 0);
  function ring(pctv) {
    const R = 24, C = 2 * Math.PI * R;
    return `<div class="rv-match"><svg viewBox="0 0 58 58"><circle cx="29" cy="29" r="${R}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5"/><circle cx="29" cy="29" r="${R}" fill="none" stroke="#FF6B8B" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * pctv) / 100} ${C}"/></svg><span>${pctv}%<small>match</small></span></div>`;
  }
  function reviewCard(c, cls) {
    const o = effective().find((x) => x.id === c.opportunityId);
    const [ico, a, b] = LOOK[o?.area] || ['✨', '#2E2548', '#1C2A40'];
    const r = ws.data.review[c.opportunityId] || { picks: [], requests: [], note: '' };
    const hero = `<div class="rv-hero" style="--rv-a:${a};--rv-b:${b}"><div class="ico">${ico}</div><div class="rank"><b>#${o?.eff?.rank ?? '–'}</b>${ring(c.match)}</div>
      <h3>${esc(o?.title || c.opportunityId)}</h3><div class="money">${usd(moneyOf(o))}<small> / year at full strength</small></div>
      <div class="tags"><span class="tag">${EFF[o?.eff?.effort || o?.effort || 'S'][0]} effort</span><span class="tag">~${o?.timeToSignalWeeks ?? '?'} weeks to know</span>${o?.goalFit ? '<span class="tag">Fits your goal</span>' : ''}</div></div>`;
    if (cls !== 'main') return `<div class="rv-card ${cls}" aria-hidden="true">${hero}</div>`;
    const init = initOf(c.opportunityId), hasKit = !!pkgOf(c.opportunityId);
    return `<div class="rv-card ${rv.anim || ''} ${rv.enter && !rv.anim ? 'enter' : ''}" role="group" aria-label="${esc(o?.title || '')}">
      ${rv.anim === 'fly-right' ? '<div class="rv-stamp love">SAVED ♥</div>' : rv.anim === 'fly-left' ? '<div class="rv-stamp pass">PASS</div>' : ''}
      ${hero}<div class="rv-body">
        <p class="rv-bio">${esc(c.bio)}</p>
        <div class="rv-why">${c.matchWhy.map((w) => `<span>${esc(w)}</span>`).join('')}</div>
        <div><div class="rv-label">Pick your version · choose one or more</div><div class="rv-opts">${c.options.map((op, k) => {
          const on = r.picks.includes(op.id), off = !!op.needs;
          return `<button type="button" class="rv-opt" data-rv="pick:${esc(op.id)}" aria-pressed="${on}" ${off ? 'disabled' : ''}><span class="box">${on ? '✓' : k + 1}</span>
            <span><b>${esc(op.label)}</b>${op.recommended ? '<span class="rv-pick">Crew\'s pick</span>' : ''}<p>${esc(op.pitch)}</p>
            <span class="pc">${op.pros.map((p) => `<span class="p">+ ${esc(p)}</span>`).join('')}${op.cons.map((p) => `<span class="c">– ${esc(p)}</span>`).join('')}</span>
            <div class="best">${off ? `🔒 Needs ${esc(op.needs.map((n) => GP().srcLabel(n)).join(', '))} connected` : `Best if: ${esc(op.bestIf)}`}</div></span>
            <span class="val">${usd(op.impact)}<small>/ year · ${EFF[op.effort][0].toLowerCase()} effort</small></span></button>`;
        }).join('')}</div></div>
        <div><div class="rv-label">Tweak it</div><div class="rv-chips">${REQS.map((q) => `<button type="button" data-rv="req:${esc(q)}" aria-pressed="${r.requests.includes(q)}">${esc(q)}</button>`).join('')}</div></div>
        <textarea class="rv-note" data-rv-note="${esc(c.opportunityId)}" placeholder="Notes or requests for this move, e.g. “use 15% instead of 10%” or “ask Priya first”">${esc(r.note)}</textarea>
        ${rv.learn ? `<div class="rv-more"><div class="rv-label">Why this, why now</div><div>${pt(init ? init.why : o?.rationale || '')}</div>${init ? `<div class="rv-label" style="margin-top:12px">How it works</div><ol>${init.steps.map((s) => `<li>${pt(s)}</li>`).join('')}</ol>` : ''}
          ${hasKit ? `<div class="tags"><button type="button" class="ws-btn primary sm" data-rv="kit:build">⚡ See the build kit</button><button type="button" class="ws-btn sm" data-rv="kit:walk">🧭 Walk me through it</button></div>` : ''}</div>` : ''}
      </div></div>`;
  }
  function reviewSummary() {
    const d = deck();
    const loved = d.filter((c) => ws.data.review[c.opportunityId]?.decision === 'love');
    const passed = d.filter((c) => ws.data.review[c.opportunityId]?.decision === 'pass');
    const left = d.filter((c) => !decided(c));
    const labels = (c) => { const r = ws.data.review[c.opportunityId]; return c.options.filter((op) => r.picks.includes(op.id)).map((op) => op.label).join(' + ') || 'No version picked yet'; };
    const value = loved.reduce((s, c) => { const r = ws.data.review[c.opportunityId]; const picked = c.options.filter((op) => r.picks.includes(op.id)); return s + (picked.length ? Math.max(...picked.map((op) => op.impact)) : 0); }, 0);
    const item = (c, kind) => { const o = effective().find((x) => x.id === c.opportunityId); const r = ws.data.review[c.opportunityId] || {};
      return `<div class="rv-item"><div class="heart">${kind === 'love' ? '💖' : kind === 'pass' ? '✕' : '…'}</div><div><h4>#${o?.eff?.rank ?? '–'} ${esc(o?.title || '')}</h4><div class="muted">${kind === 'love' ? esc(labels(c)) : kind === 'pass' ? 'Passed for now' : 'Not reviewed yet'}${r.requests?.length ? ` · asked for: ${esc(r.requests.join(', '))}` : ''}${r.note ? ` · “${esc(r.note)}”` : ''}</div></div>
        <div class="tags">${kind === 'pass' ? `<button type="button" class="ws-btn sm" data-rv="undo:${esc(c.opportunityId)}">Undo</button>` : ''}<button type="button" class="ws-btn sm" data-rv="goto:${d.indexOf(c)}">${kind === 'love' ? 'Edit' : 'Review'}</button></div></div>`; };
    return `<div class="rv-summary"><div class="dim small">Quick review</div><h2>${left.length ? `You've reviewed ${d.length - left.length} of ${d.length}` : 'Your shortlist'}</h2>
      <p class="muted">${loved.length ? `You saved ${loved.length} move${loved.length > 1 ? 's' : ''}, worth about <b>${usd(value)}</b> a year in the versions you picked. They're marked in your action plan, and each build kit uses your pick.` : 'Nothing saved yet. Heart a move to add it to your shortlist.'}</p>
      <div class="tags" style="margin:12px 0">${left.length ? `<button type="button" class="ws-btn primary" data-rv="resume">Pick up where you left off</button>` : ''}<button type="button" class="ws-btn ${left.length ? '' : 'primary'}" data-rv="plan">Open the action plan</button><button type="button" class="ws-btn" data-rv="restart">Start over</button></div>
      ${loved.length ? `<div class="rv-label" style="margin-top:18px">Saved</div><div class="rv-list">${loved.map((c) => item(c, 'love')).join('')}</div>` : ''}
      ${left.length ? `<div class="rv-label" style="margin-top:18px">Still to review</div><div class="rv-list">${left.map((c) => item(c, 'left')).join('')}</div>` : ''}
      ${passed.length ? `<div class="rv-label" style="margin-top:18px">Passed</div><div class="rv-list">${passed.map((c) => item(c, 'pass')).join('')}</div>` : ''}</div>`;
  }
  let reviewKey = '';
  function renderReview(force) {
    let wrap = document.getElementById('ws-review');
    if (!rv.open) { if (wrap) wrap.remove(); reviewKey = ''; return; }
    const d = deck();
    const key = `${rv.i}:${rv.anim}:${rv.learn}:${rv.summary}:${ws.version}:${d.length}`;
    if (!force && wrap && key === reviewKey) return;
    if (wrap && wrap.contains(document.activeElement) && document.activeElement.matches('textarea') && !force) return;
    reviewKey = key;
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'ws-review'; wrap.className = 'rv-wrap ws';
      wrap.style.display = 'flex';
      wrap.addEventListener('click', onReviewClick);
      wrap.addEventListener('input', (e) => { const id = e.target.dataset?.rvNote; if (id) { rstate(id).note = e.target.value; changed(false); } });
      document.body.appendChild(wrap);
    }
    const done = reviewCount();
    const upcoming = d.filter((c, k) => k > rv.i && !decided(c)).slice(0, 2);
    wrap.innerHTML = `<div class="rv-top"><h2>💘 Quick review</h2><span class="dim small">${done} of ${d.length} reviewed · saved as you go</span>
        <div class="rv-dots">${d.map((c, k) => `<i class="${ws.data.review[c.opportunityId]?.decision || ''} ${k === rv.i && !rv.summary ? 'now' : ''}" data-rv="goto:${k}" title="${esc(effective().find((o) => o.id === c.opportunityId)?.title || '')}"></i>`).join('')}</div>
        <span class="grow"></span><button type="button" class="ws-btn sm" data-rv="summary">💖 Shortlist ${d.filter((c) => ws.data.review[c.opportunityId]?.decision === 'love').length}</button><button type="button" class="ws-btn ghost" data-rv="close" aria-label="Close">✕</button></div>
      <div class="rv-stage">${rv.summary ? reviewSummary() : `<div class="rv-deck">${upcoming.slice().reverse().map((c, k, arr) => reviewCard(c, arr.length - k === 2 ? 'behind2' : 'behind1')).join('')}${d[rv.i] ? reviewCard(d[rv.i], 'main') : ''}</div>`}</div>
      ${rv.summary ? '' : `<div class="rv-actions"><button type="button" class="rv-btn small" data-rv="back" title="Back (↑)" aria-label="Back">↶</button><button type="button" class="rv-btn pass" data-rv="pass" title="Pass (←)" aria-label="Pass">✕</button><button type="button" class="rv-btn love" data-rv="love" title="Save (→)" aria-label="Save">♥</button><button type="button" class="rv-btn small ${rv.learn ? 'on' : ''}" data-rv="learn" title="Learn more (L)" aria-label="Learn more">ℹ</button></div>
      <div class="rv-hint">← pass · → save · 1–3 pick a version · L learn more · ${ws.data.review[d[rv.i]?.opportunityId]?.decision ? `you ${ws.data.review[d[rv.i].opportunityId].decision === 'love' ? 'saved' : 'passed on'} this one` : 'not decided yet'}</div>`}`;
    rv.enter = false;
  }
  function onReviewClick(e) {
    const t = e.target.closest('[data-rv]'); if (!t) return;
    const [cmd, arg] = t.dataset.rv.split(/:(.*)/s);
    const d = deck(), c = d[rv.i];
    if (cmd === 'close') return closeReview();
    if (cmd === 'love' || cmd === 'pass') return decide(cmd);
    if (cmd === 'back') { const prev = rv.i - 1; if (prev >= 0) { rv.i = prev; rv.learn = false; rv.enter = true; renderReview(true); } return; }
    if (cmd === 'learn') { rv.learn = !rv.learn; renderReview(true); return; }
    if (cmd === 'summary') { rv.summary = true; renderReview(true); return; }
    if (cmd === 'resume') { const n = d.findIndex((x) => !decided(x)); rv.summary = false; rv.i = n < 0 ? 0 : n; rv.enter = true; renderReview(true); return; }
    if (cmd === 'goto') { rv.summary = false; rv.i = Number(arg); rv.learn = false; rv.enter = true; renderReview(true); return; }
    if (cmd === 'restart') { if (!window.confirm('Clear every heart, pass and pick and start the review again? Your notes stay.')) return; for (const k of Object.keys(ws.data.review)) { ws.data.review[k].decision = null; ws.data.review[k].picks = []; } rv.summary = false; rv.i = 0; changed(false); ws.version++; renderReview(true); return; }
    if (cmd === 'plan') { closeReview(); view.section = 'plan'; renderedKey = ''; GP().invalidate(); return; }
    if (cmd === 'undo') { rstate(arg).decision = null; changed(false); ws.version++; renderReview(true); return; }
    if (cmd === 'kit') { const id = c?.opportunityId; closeReview(); if (id) openSheet(id, arg); return; }
    if (!c) return;
    const r = rstate(c.opportunityId);
    if (cmd === 'pick') { r.picks = r.picks.includes(arg) ? r.picks.filter((x) => x !== arg) : [...r.picks, arg]; changed(false); ws.version++; renderReview(true); return; }
    if (cmd === 'req') { r.requests = r.requests.includes(arg) ? r.requests.filter((x) => x !== arg) : [...r.requests, arg]; changed(false); ws.version++; renderReview(true); return; }
  }
  document.addEventListener('keydown', (e) => {
    if (!rv.open || e.target.matches?.('textarea, input')) return;
    if (e.key === 'Escape') { closeReview(); return; }
    if (rv.summary) return;
    const c = deck()[rv.i];
    if (e.key === 'ArrowLeft') { e.preventDefault(); decide('pass'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); decide('love'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onReviewClick({ target: { closest: () => ({ dataset: { rv: 'back' } }) } }); }
    else if (e.key.toLowerCase() === 'l') { rv.learn = !rv.learn; renderReview(true); }
    else if (/^[1-3]$/.test(e.key) && c) { const op = c.options[Number(e.key) - 1]; if (op && !op.needs) onReviewClick({ target: { closest: () => ({ dataset: { rv: `pick:${op.id}` } }) } }); }
  });
  function reviewTags(id) {
    const r = ws.data.review[id]; if (!r?.decision) return '';
    const c = (S().reviewDeck || []).find((x) => x.opportunityId === id);
    const picks = c ? c.options.filter((op) => r.picks.includes(op.id)).map((op) => op.label) : [];
    return r.decision === 'love' ? `<span class="tag" style="color:#FF8FA8;border-color:rgba(255,107,139,.45);background:rgba(255,107,139,.08)">♥ Saved${picks.length ? ` · ${esc(picks.join(' + '))}` : ''}</span>` : '<span class="tag">✕ You passed</span>';
  }
  function kitBanner(id) {
    const r = ws.data.review[id]; if (!r || (!r.picks.length && !r.requests.length && !r.note)) return '';
    const c = (S().reviewDeck || []).find((x) => x.opportunityId === id);
    const picks = c ? c.options.filter((op) => r.picks.includes(op.id)).map((op) => op.label) : [];
    return `<div class="rv-kit-banner">${picks.length ? `<b>Your pick:</b> ${esc(picks.join(' + '))}. ` : ''}${r.requests.length ? `<b>You asked for:</b> ${esc(r.requests.join(', '))}. ` : ''}${r.note ? `<b>Your note:</b> “${esc(r.note)}”` : ''}</div>`;
  }

  /* ---------------- rail: comments and notes ---------------- */
  function renderRail() {
    const rail = document.getElementById('ws-rail');
    if (!rail) return;
    rail.classList.toggle('open', view.rail);
    // Commenting from inside a build sheet: float the rail above it.
    rail.classList.toggle('over', !!view.build);
    if (!view.rail) { rail.innerHTML = ''; return; }
    if (rail.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return; // don't wipe what they're typing
    const list = ws.data.comments.slice().reverse().filter((c) => !view.target || c.target === view.target);
    rail.innerHTML = `<div class="rail-head"><div class="seg"><button type="button" data-railtab="comments" aria-pressed="${view.railTab === 'comments'}">💬 Comments</button><button type="button" data-railtab="notes" aria-pressed="${view.railTab === 'notes'}">📝 Notes</button></div><button type="button" class="ws-btn ghost sm" data-rail="close" aria-label="Close">✕</button></div>
      <div class="rail-body">${view.railTab === 'notes' ? `<div class="notes"><div class="dim small" style="margin-bottom:8px">Your notes on this plan: decisions, questions for the team, anything. Saved as you type.</div><textarea data-notes placeholder="e.g. Ask Priya about the Q4 creative calendar before we start #5…">${esc(ws.data.notes)}</textarea><div class="saved" style="margin-top:6px">${esc(savedText())}</div></div>` : `
        ${view.target ? `<div class="target-chip">On <b>${esc(view.targetLabel)}</b><button type="button" class="copy" data-target-clear>Show all</button></div>` : '<div class="dim small">Click 💬 on anything in the plan to comment on it, or leave a general comment here.</div>'}
        <div class="composer2">${author ? '' : '<input data-author placeholder="Your name (shown on comments)" style="margin-bottom:8px">'}<textarea data-newcomment rows="3" placeholder="${view.target ? 'Add a comment…' : 'Add a general comment…'}"></textarea><div class="row2"><span class="dim small">${author ? `Commenting as ${esc(author)}` : ''}</span><button type="button" class="ws-btn primary sm" data-postcomment>Comment</button></div></div>
        ${list.length ? list.map((c) => `<div class="comment ${c.resolved ? 'resolved' : ''}"><div class="who2"><span class="avatar">${esc((c.author || '?').slice(0, 1).toUpperCase())}</span><b>${esc(c.author || 'Someone')}</b><span>${esc(new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span></div>${!view.target && c.target ? `<button type="button" class="on" data-comment="${esc(c.target)}" data-label="${esc(c.label || '')}">on ${esc(c.label || c.target)}</button>` : ''}<p>${esc(c.text)}</p><div class="acts"><button type="button" data-resolve="${esc(c.id)}">${c.resolved ? 'Reopen' : 'Resolve'}</button><button type="button" data-delcomment="${esc(c.id)}">Delete</button></div></div>`).join('') : '<div class="dim small">No comments yet.</div>'}`}</div>`;
  }

  /* ---------------- events ---------------- */
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }
  function gotoMove(id) {
    view.section = 'plan'; view.openMove = id; renderedKey = '';
    GP().invalidate();
    setTimeout(() => document.getElementById(`move-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  function onClick(e) {
    const t = e.target.closest('button, [data-journey], [data-goto-move], .item[data-goto-move]');
    if (!t) return;
    const d = t.dataset;
    if (d.reviewOpen != null) { openReview(); return; }
    if (d.section) { view.section = d.section; document.getElementById('ws-main')?.scrollTo(0, 0); GP().invalidate(); return; }
    if (d.journey && !t.matches('.seg button') && t.classList.contains('persona')) { view.section = 'journeys'; view.journey = d.journey; GP().invalidate(); return; }
    if (d.journey) { view.journey = d.journey; GP().invalidate(); return; }
    if (d.jfilter) { view.jfilter = d.jfilter; GP().invalidate(); return; }
    if (d.gotoMove) { if (view.build) closeSheet(); gotoMove(d.gotoMove); return; }
    if (d.watch != null) { GP().setPlanMode('watch'); return; }
    if (d.rail) { if (d.rail === 'close') view.rail = false; else { view.rail = !(view.rail && view.railTab === d.rail); view.railTab = d.rail; if (d.rail === 'comments') view.target = null; } renderedKey = ''; GP().invalidate(); return; }
    if (d.railtab) { view.railTab = d.railtab; renderRail(); return; }
    if (d.comment) { view.rail = true; view.railTab = 'comments'; view.target = d.comment; view.targetLabel = d.label || d.comment; renderedKey = ''; GP().invalidate(); setTimeout(() => document.querySelector('[data-newcomment]')?.focus(), 60); return; }
    if (d.targetClear != null) { view.target = null; renderRail(); return; }
    if (d.postcomment != null) {
      const ta = document.querySelector('[data-newcomment]'); const nameIn = document.querySelector('[data-author]');
      if (nameIn && nameIn.value.trim()) { author = nameIn.value.trim(); try { localStorage.setItem('gp.author', author); } catch {} }
      const text = ta?.value.trim(); if (!text) return;
      ws.data.comments.push({ id: `cm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, target: view.target, label: view.targetLabel, author: author || 'You', text, at: new Date().toISOString(), resolved: false });
      ta.value = ''; document.activeElement?.blur(); changed(); renderRail(); return;
    }
    if (d.resolve) { const c = ws.data.comments.find((x) => x.id === d.resolve); if (c) c.resolved = !c.resolved; changed(); renderRail(); return; }
    if (d.delcomment) { ws.data.comments = ws.data.comments.filter((x) => x.id !== d.delcomment); changed(); renderRail(); return; }
    if (d.build) { openSheet(d.build, 'build'); return; }
    if (d.walk) { openSheet(d.walk, 'walk'); return; }
    if (d.close != null) { closeSheet(); return; }
    if (d.mode && view.build) { view.build.mode = d.mode; if (d.mode === 'build' && !ws.data.built[view.build.id]) { view.build.phase = 'running'; view.build.log = 0; runBuild(); } renderSheet(); return; }
    if (d.step != null && view.build) { view.build.step = Number(d.step); renderSheet(); document.querySelector('#ws-sheet .sheet-body')?.scrollTo(0, 0); return; }
    if (d.stepdone != null && view.build) { const m = (ws.data.walk[view.build.id] ||= {}); m[d.stepdone] = !m[d.stepdone]; changed(false); renderSheet(true); return; }
    if (d.approve != null && view.build) {
      const id = view.build.id; if (!ws.data.status[id]) ws.data.status[id] = 'planned';
      changed(); closeSheet(); toast('Added to the plan as “Planned”. Demo mode: nothing was sent to your tools.'); return;
    }
    if (d.jump) { document.getElementById(`asset-${d.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.copy != null) { navigator.clipboard?.writeText(d.copy).then(() => toast('Copied')).catch(() => {}); return; }
    if (d.copyasset) { const a = pkgOf(view.build?.id)?.assets.find((x) => x.id === d.copyasset); if (a) navigator.clipboard?.writeText(assetText(a)).then(() => toast('Copied')).catch(() => {}); return; }
    if (d.resetEdits != null) { ws.data.overrides = {}; changed(); return; }
    if (d.srckind) { srcFilter.kind = d.srckind; renderedKey = ''; GP().invalidate(); return; }
    if (d.srcsource) { srcFilter.source = srcFilter.source === d.srcsource ? null : d.srcsource; renderedKey = ''; GP().invalidate(); return; }
  }
  function onChange(e) {
    const t = e.target, d = t.dataset;
    if (d.status) { ws.data.status[d.status] = t.value; changed(); return; }
    if (d.owner) { ws.data.owners[d.owner] = t.value; changed(); return; }
    if (d.week != null) { ws.data.week[d.week] = t.checked; changed(); return; }
    if (d.target) { setOverride(d.target, 'target', Number(t.value)); return; }
    if (d.conf) { setOverride(d.conf, 'confidence', t.value); return; }
    if (d.effort) { setOverride(d.effort, 'effort', t.value); return; }
  }
  function onInput(e) {
    const t = e.target, d = t.dataset;
    if (d.notes != null) { ws.data.notes = t.value; changed(false); return; }
    if (d.target) {
      // Live numbers while dragging; the re-rank happens on release.
      const o = (S().priorities || []).find((x) => x.id === d.target); if (!o) return;
      const v = Number(t.value), cur = o.currentRate.value;
      const ov = ws.data.overrides[o.id] || {};
      const conf = ov.confidence ?? o.confidence, eff = ov.effort ?? o.effort;
      const impact = o.audience.value * (v - cur) * o.valuePerConversion.value * 12;
      const out = document.querySelector(`[data-target-out="${o.id}"]`); if (out) out.textContent = pct(v);
      const eq = document.querySelector(`[data-eq="${o.id}"]`);
      if (eq) eq.innerHTML = `${num(o.audience.value)} × <b>${Math.round((v - cur) * 1000) / 10}</b> pts × $${o.valuePerConversion.value} × 12 = <b>${usd(impact)}/yr</b> · × ${CONF[conf][1]} ÷ ${EFF[eff][1]} = score <b>${usd((impact * CONF[conf][1]) / EFF[eff][1])}</b>`;
    }
  }
  function setOverride(id, key, value) {
    const o = (S().priorities || []).find((x) => x.id === id); if (!o) return;
    const base = { target: o.targetRate.value, confidence: o.confidence, effort: o.effort }[key];
    const ov = (ws.data.overrides[id] ||= {});
    if (value === base || (key === 'target' && Math.abs(value - base) < 0.0005)) delete ov[key]; else ov[key] = value;
    if (!Object.keys(ov).length) delete ws.data.overrides[id];
    view.openMove = id;
    changed();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.build) closeSheet(); });
  // One tooltip for every chart mark.
  let tip = null;
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) { if (tip) tip.hidden = true; document.querySelectorAll('.viz .cross').forEach((c) => c.setAttribute('opacity', '0')); return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'ws-tip'; document.body.appendChild(tip); }
    tip.hidden = false; tip.innerHTML = el.dataset.tip;
    tip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 14)}px`; tip.style.top = `${e.clientY + 14}px`;
    if (el.dataset.cross) { const cr = el.closest('svg').querySelector('.cross'); cr.setAttribute('x1', el.dataset.cross); cr.setAttribute('x2', el.dataset.cross); cr.setAttribute('opacity', '.6'); }
  });

  window.GPWorkspace = { render };
})();
