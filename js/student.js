/* Student dashboard. Reads its data from the link the tutor shares; practice history stays on this device. */
(function () {
  'use strict';
  const { DRILLS, uid, esc, today, fmtDate, daysSince, nextSession, encode, decode, streak, toast, copyText } = window.TD;

  const ROUND = 10;
  const BAR = {
    none: { pct: 8, label: 'Up next', cls: '' },
    shaky: { pct: 55, label: 'Building', cls: 'shaky' },
    solid: { pct: 100, label: 'Solid', cls: 'solid' }
  };
  const CONF = [[1, 'Not yet'], [2, 'A little'], [3, 'Getting there'], [4, 'Pretty good'], [5, 'Very confident']];

  const $view = document.getElementById('view');
  let store = null;   // { data, log: [], sentAt }
  let key = null;
  let drill = null;   // active drill round
  let pending = null; // waiting for a confidence rating

  /* ---------- Load ---------- */

  function boot() {
    const m = location.hash.match(/d=([A-Za-z0-9_-]+)/);
    let incoming = null;
    if (m) { try { incoming = decode(m[1]); } catch (e) { incoming = null; } }
    const sid = incoming ? incoming.sid : TD.load('td-student-last');
    if (!sid) { renderMissing(m); return; }
    key = 'td-student-' + sid;
    store = TD.load(key) || { data: null, log: [], sentAt: null };
    if (incoming && (!store.data || incoming.made >= (store.data.made || ''))) store.data = incoming;
    if (!store.data) { renderMissing(m); return; }
    TD.save(key, store);
    TD.save('td-student-last', sid);
    document.title = store.data.name + '\'s Practice';
    document.getElementById('title').textContent = 'Hi, ' + store.data.name + '!';
    render();
  }

  function renderMissing(hadHash) {
    $view.innerHTML = '<div class="card"><h2>' + (hadHash ? 'This link looks incomplete' : 'Open your link') + '</h2>' +
      '<p class="muted">Ask your tutor to send your practice link again, then open it on this device.</p></div>';
  }

  function persist() { TD.save(key, store); }
  const D = () => store.data;
  const topic = id => D().topics.find(t => t.id === id);

  /* ---------- Render ---------- */

  function render() {
    if (drill) { renderDrill(); return; }
    const d = D();
    let h = heroCard();
    if (pending) h += confidenceCard();
    h += nextCard() + drillsCard() + progressCard() + recapCard() + sendCard();
    $view.innerHTML = h;
  }

  function stats() {
    const st = streak(store.log.map(e => e.date));
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const wk = TD.toISO(weekAgo);
    const problems = store.log.filter(e => e.date >= wk).reduce((n, e) => n + (e.total || 0), 0);
    return Object.assign(st, { problems });
  }

  function heroCard() {
    const d = D();
    const st = stats();
    const solid = d.topics.filter(t => t.s === 'solid').length;
    const building = d.topics.filter(t => t.s === 'shaky').length;
    let msg;
    if (st.current >= 3) msg = st.current + ' days in a row. That consistency is exactly how skills stick.';
    else if (st.current >= 1 && daysSince(store.log[store.log.length - 1].date) === 0) msg = 'You practiced today. Nice work!';
    else if (st.current >= 1) msg = 'You practiced yesterday. A few minutes today keeps your streak going.';
    else if (st.days > 0) msg = 'Welcome back! A quick drill is a great way to warm up.';
    else msg = 'Ready when you are. Even five minutes of practice helps.';
    const prog = solid ? 'You have ' + solid + ' topic' + (solid === 1 ? '' : 's') + ' solid' + (building ? ' and ' + building + ' building' : '') + '.'
      : building ? 'You are building ' + building + ' topic' + (building === 1 ? '' : 's') + ' right now.' : '';
    return '<div class="card hero"><h2>' + esc(msg) + '</h2>' + (prog ? '<p class="small">' + esc(prog) + '</p>' : '') +
      '<div class="stats"><div class="stat"><b>' + st.current + '</b><span>day streak</span></div>' +
      '<div class="stat"><b>' + st.best + '</b><span>best streak</span></div>' +
      '<div class="stat"><b>' + st.problems + '</b><span>problems this week</span></div></div></div>';
  }

  function bar(status) {
    const b = BAR[status] || BAR.none;
    return '<div class="row"><div class="pbar grow ' + b.cls + '" role="img" aria-label="' + b.label + '"><span style="width:' + b.pct + '%"></span></div>' +
      '<span class="small" style="width:64px;text-align:right">' + b.label + '</span></div>';
  }

  function nextCard() {
    const d = D();
    let h = '<div class="card"><h2>What to practice next</h2>';
    const rec = d.rec && topic(d.rec.id);
    if (rec) {
      h += '<div class="topic" style="border-color:var(--accent)"><div class="small muted">Recommended for you</div>' +
        '<div class="topic-name">' + esc(rec.name) + '</div>' + (rec.details ? '<div class="small muted">' + esc(rec.details) + '</div>' : '') +
        '<div style="margin:8px 0">' + bar(rec.s) + '</div>' + drillButtons(rec) + '</div>';
    }
    const warm = d.warm && topic(d.warm);
    if (warm && warm !== rec) {
      h += '<div class="topic"><div class="small muted">Quick warm-up (5-10 min)</div><div class="topic-name">' + esc(warm.name) + '</div>' +
        '<div style="margin:8px 0">' + bar(warm.s) + '</div>' + drillButtons(warm) + '</div>';
    }
    const doneIds = new Set(store.log.filter(e => e.kind === 'assignment').map(e => e.assignmentId));
    const todo = d.assignments.filter(a => !doneIds.has(a.id));
    const done = d.assignments.filter(a => doneIds.has(a.id));
    h += '<h3 style="margin-top:14px">From your tutor</h3>';
    if (!d.assignments.length) h += '<div class="empty">No assigned practice right now.</div>';
    h += '<ul class="list">' + todo.map(a => {
      const t = topic(a.t);
      return '<li><div class="row"><div class="grow"><b>' + esc(a.title) + '</b>' +
        '<div class="small muted">' + esc(t ? t.name : '') + (a.due ? ' · due ' + fmtDate(a.due, { weekday: 'short', month: 'short', day: 'numeric' }) : '') + '</div></div>' +
        (/^https?:\/\//i.test(a.link || '') ? '<a class="btn small" href="' + esc(a.link) + '" target="_blank" rel="noopener">Open</a>' : '') +
        '<button class="btn small primary" data-act="didIt" data-id="' + a.id + '">I did it</button></div></li>';
    }).join('') + done.map(a => '<li><div class="row"><span class="pill solid"><span class="dot"></span>Done</span><span class="grow muted">' + esc(a.title) + '</span></div></li>').join('') + '</ul>';
    return h + '</div>';
  }

  function drillButtons(t) {
    if (!t.d || !t.d.length) return '';
    return '<div class="row">' + t.d.map(k => '<button class="btn small primary" data-act="startDrill" data-drill="' + k + '" data-topic="' + t.id + '">Start ' + esc(DRILLS[k].name.toLowerCase()) + ' drill</button>').join('') + '</div>';
  }

  function drillsCard() {
    const d = D();
    const recDrills = new Set([].concat(...[d.rec && topic(d.rec.id), d.warm && topic(d.warm)].filter(Boolean).map(t => t.d || [])));
    return '<div class="card"><h2>Practice drills</h2><p class="small muted">' + ROUND + ' quick problems with instant feedback.</p><div class="drill-grid">' +
      Object.keys(DRILLS).map(k => {
        const best = store.log.filter(e => e.drill === k).reduce((m, e) => Math.max(m, e.correct || 0), 0);
        return '<button class="drill-btn' + (recDrills.has(k) ? ' rec' : '') + '" data-act="startDrill" data-drill="' + k + '"><b>' + esc(DRILLS[k].name) + '</b>' +
          '<span>' + esc(DRILLS[k].blurb) + '</span>' + (best ? '<span style="display:block">Best: ' + best + '/' + ROUND + '</span>' : '') + '</button>';
      }).join('') + '</div></div>';
  }

  function progressCard() {
    const d = D();
    const solid = d.topics.filter(t => t.s === 'solid').length;
    let h = '<div class="card"><div class="card-head"><h2>My progress</h2><span class="small muted">' + solid + ' of ' + d.topics.length + ' solid</span></div>';
    d.groups.forEach(g => {
      const ts = d.topics.filter(t => t.g === g.id);
      if (!ts.length) return;
      h += '<div class="small muted" style="margin:10px 0 4px">' + esc(g.name) + '</div>';
      ts.forEach(t => { h += '<div style="margin-bottom:10px"><div class="small" style="font-weight:600">' + esc(t.name) + '</div>' + bar(t.s) + '</div>'; });
    });
    return h + '<p class="small muted" style="margin:6px 0 0">"Building" means you are in the middle of learning it. That is right where learning happens.</p></div>';
  }

  function recapCard() {
    const d = D();
    const ns = nextSession(d.schedule);
    let h = '<div class="card"><h2>Last session</h2>';
    if (d.last) {
      h += '<p class="small muted">' + fmtDate(d.last.date, { weekday: 'long', month: 'short', day: 'numeric' }) + '</p>' +
        d.last.items.map(i => '<div style="margin-bottom:10px"><div class="small" style="font-weight:600">' + esc(i.name) + '</div>' + bar(i.s) + '</div>').join('');
    } else h += '<div class="empty">Your first session recap will show up here.</div>';
    if (ns) h += '<p style="margin:8px 0 0"><b>Next session:</b> ' + esc(ns.label) + '</p>';
    return h + '</div>';
  }

  function sendCard() {
    const unsent = store.log.filter(e => !store.sentAt || e.at > store.sentAt).length;
    return '<div class="card"><h2>Send to my tutor</h2><p class="small muted">' +
      (unsent ? unsent + ' new practice ' + (unsent === 1 ? 'entry' : 'entries') + ' to share.' : 'Your tutor is up to date.') +
      ' Tap below, then paste the code in a text to your tutor.</p>' +
      '<div class="row"><button class="btn primary" data-act="sendCode"' + (store.log.length ? '' : ' disabled') + '>Copy check-in code</button>' +
      (navigator.share && store.log.length ? '<button class="btn" data-act="shareCode">Share…</button>' : '') + '</div></div>';
  }

  function confidenceCard() {
    return '<div class="card" id="confCard" style="border-color:var(--accent)"><h2>How confident do you feel?</h2>' +
      '<p class="small muted">' + esc(pending.label) + '</p><div class="conf">' +
      CONF.map(([v, w]) => '<button data-act="rate" data-v="' + v + '"><b>' + v + '</b>' + w + '</button>').join('') + '</div>' +
      '<button class="btn link small" data-act="skipRate" style="margin-top:8px">Skip</button></div>';
  }

  /* ---------- Drills ---------- */

  function startDrill(k, topicId) {
    if (!topicId) {
      const d = D();
      const match = d.topics.filter(t => (t.d || []).includes(k));
      const pref = match.find(t => d.rec && t.id === d.rec.id) || match.find(t => t.id === d.warm) || match[0];
      topicId = pref ? pref.id : null;
    }
    drill = { key: k, topicId, n: 0, correct: 0, q: Drills.make(k), answered: false };
    renderDrill();
    window.scrollTo(0, 0);
  }

  function renderDrill() {
    const k = drill.key;
    if (drill.n >= ROUND) {
      const c = drill.correct;
      const msg = c === ROUND ? 'Perfect round!' : c >= 8 ? 'Great work!' : c >= 5 ? 'Solid effort. Each round gets easier.' : 'Thanks for sticking with it. Every problem you try builds the skill.';
      $view.innerHTML = '<div class="card"><h2>' + esc(msg) + '</h2><div class="question">' + c + ' / ' + ROUND + '</div>' +
        '<div class="row"><button class="btn primary grow" data-act="again">Another round</button><button class="btn grow" data-act="finish">Done</button></div></div>';
      return;
    }
    const q = drill.q;
    $view.innerHTML = '<div class="card"><div class="card-head"><h2>' + esc(DRILLS[k].name) + '</h2><span class="small muted">' + (drill.n + 1) + ' of ' + ROUND + ' · ' + drill.correct + ' right</span></div>' +
      '<div class="pbar" style="margin-bottom:6px"><span style="width:' + (drill.n / ROUND * 100) + '%"></span></div>' +
      '<div class="question">' + Drills.pretty(esc(q.q)) + '</div>' +
      '<form id="ansForm" class="answer-row"><input id="ans" autocomplete="off" inputmode="' + (k === 'fractions' ? 'text' : 'numeric') + '" aria-label="Your answer" placeholder="Answer">' +
      '<button class="btn primary" type="submit">' + (drill.answered ? 'Next' : 'Check') + '</button></form>' +
      '<div class="small muted" style="text-align:center;margin-top:6px">' + esc(q.hint || 'Use - for negative numbers.') + '</div>' +
      '<div class="feedback" id="fb" aria-live="polite"></div>' +
      '<button class="btn link small" data-act="quit" style="margin-top:6px">Stop drill</button></div>';
    const inp = document.getElementById('ans');
    inp.focus();
  }

  function submitAnswer() {
    const inp = document.getElementById('ans');
    const fb = document.getElementById('fb');
    const btn = document.querySelector('#ansForm button');
    if (drill.answered) {
      drill.n++; drill.answered = false; drill.q = Drills.make(drill.key);
      if (drill.n >= ROUND) { logDrill(); }
      renderDrill();
      return;
    }
    if (!inp.value.trim()) { fb.className = 'feedback no'; fb.textContent = 'Type an answer first.'; return; }
    const r = drill.q.check(inp.value);
    if (r === 'unsimplified') { fb.className = 'feedback no'; fb.textContent = 'Right value! Can you simplify it?'; return; }
    drill.answered = true;
    if (r) { drill.correct++; fb.className = 'feedback ok'; fb.textContent = pickOne(['Correct!', 'Nice!', 'Yes!', 'Got it!']); }
    else { fb.className = 'feedback no'; fb.textContent = 'Not quite. The answer is ' + drill.q.answer + '.'; }
    inp.readOnly = true;
    btn.textContent = 'Next';
    btn.focus();
  }

  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }

  function logDrill() {
    const entry = { id: uid(), at: Date.now(), date: today(), kind: 'drill', drill: drill.key, topicId: drill.topicId, correct: drill.correct, total: ROUND };
    store.log.push(entry);
    persist();
    const t = drill.topicId && topic(drill.topicId);
    pending = { id: entry.id, label: t ? t.name : DRILLS[drill.key].name };
  }

  /* ---------- Actions ---------- */

  function checkinCode() {
    const since = new Date(); since.setDate(since.getDate() - 60);
    const s = TD.toISO(since);
    const entries = store.log.filter(e => e.date >= s).map(e => {
      const o = Object.assign({}, e); delete o.at; return o;
    });
    return 'CHECKIN:' + encode({ sid: D().sid, name: D().name, entries });
  }

  const actions = {
    startDrill: el => startDrill(el.dataset.drill, el.dataset.topic),
    again: () => startDrill(drill.key, drill.topicId),
    finish: () => { drill = null; render(); const c = document.getElementById('confCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    quit: () => { drill = null; render(); },
    didIt: el => {
      const a = D().assignments.find(x => x.id === el.dataset.id);
      const t = topic(a.t);
      const entry = { id: uid(), at: Date.now(), date: today(), kind: 'assignment', assignmentId: a.id, topicId: a.t, title: a.title };
      store.log.push(entry);
      persist();
      pending = { id: entry.id, label: t ? t.name : a.title };
      render();
      toast('Nice work finishing that!');
      document.getElementById('confCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    rate: el => {
      const e = store.log.find(x => x.id === pending.id);
      if (e) { e.confidence = Number(el.dataset.v); e.at = Date.now(); }
      persist();
      pending = null;
      render();
      toast(Number(el.dataset.v) >= 4 ? 'Love that confidence!' : 'Thanks for being honest. Your tutor will help with this.');
    },
    skipRate: () => { pending = null; render(); },
    sendCode: () => { copyText(checkinCode()); store.sentAt = Date.now(); persist(); render(); },
    shareCode: () => {
      navigator.share({ text: checkinCode() }).then(() => { store.sentAt = Date.now(); persist(); render(); }).catch(() => {});
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'ansForm') { e.preventDefault(); submitAnswer(); }
  });
  window.addEventListener('hashchange', () => { drill = null; boot(); });

  boot();
})();
