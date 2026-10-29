/* Tutor dashboard. All data lives in this browser's localStorage. */
(function () {
  'use strict';
  const { STATUSES, STATUS, GROUP_KINDS, DAYS, DRILLS, uid, esc, today, fmtDate, daysSince,
    sessionText, nextSession, guessDrills, planTopics, suggestPlan, encode, decode,
    weekStart, parseISO, toISO, streak, toast, copyText, statusPill } = window.TD;

  const KEY = 'tutor-dashboard-v1';
  const TABS = [
    ['tracker', '📚 Topics'], ['log', '📝 Log session'], ['plan', '🧭 Next session'], ['practice', '🎯 Practice'],
    ['scores', '📊 Scores'], ['progress', '📈 Progress'], ['share', '🔗 Student link']
  ];
  const PRONOUNS = {
    he: { subj: 'He', be: 'is' },
    she: { subj: 'She', be: 'is' },
    they: { subj: 'They', be: 'are' }
  };
  const CONF_WORDS = ['', 'Not yet', 'A little', 'Getting there', 'Pretty good', 'Very confident'];

  let state = migrate(TD.load(KEY)) || seed();
  let view = 'tracker';
  let breakMode = false;
  let lastLoggedId = null;
  let subjectFilter = 'all';
  let progRange = 12;
  let progSel = null;

  /* ---------- Data ---------- */

  function seed() {
    const d = today();
    const math = { id: uid(), name: 'Math', now: 'Geometry', next: 'Algebra 2' };
    const [gA, gB, gC] = defaultGroups(math.id);
    const t = (g, name, details) => ({
      id: uid(), groupId: g.id, name, details, status: 'none', lastWorked: null, notes: '',
      drills: guessDrills(name), cards: [], history: [{ date: d, status: 'none' }]
    });
    const noah = {
      id: uid(), shareId: uid(), name: 'Noah', grade: '', pronoun: 'he',
      subjects: [math],
      schedule: { day: 3, start: '17:30', end: '18:30' },
      groups: [gA, gB, gC],
      topics: [
        t(gA, 'Solving equations', 'Multi-step, variables on both sides'),
        t(gA, 'Slope and linear equations', 'Graphing, slope-intercept form, parallel/perpendicular lines'),
        t(gA, 'Systems of equations', ''),
        t(gB, 'Fractions and negative numbers', ''),
        t(gB, 'Exponents and integer operations', ''),
        t(gC, 'Functions and data', 'Function notation, reading graphs'),
        t(gC, 'Algebra 1 back-half rebuild', '')
      ],
      sessions: [], assignments: [], scores: [], checkins: []
    };
    return { v: 1, currentId: noah.id, students: [noah] };
  }

  function defaultGroups(subjectId) {
    return [
      { id: uid(), subjectId, name: 'Group A', kind: 'school' },
      { id: uid(), subjectId, name: 'Group B', kind: 'fluency' },
      { id: uid(), subjectId, name: 'Group C', kind: 'break' }
    ];
  }

  // Older saves had one class per student; move it into the subjects list.
  function migrate(data) {
    if (!data || !Array.isArray(data.students)) return null;
    data.students.forEach(s => {
      if (!s.subjects) {
        s.subjects = [{ id: uid(), name: 'Math', now: s.subject || '', next: s.nextYear || '' }];
        delete s.subject; delete s.nextYear;
      }
      const first = s.subjects[0] && s.subjects[0].id;
      s.groups.forEach(g => { if (!s.subjects.some(x => x.id === g.subjectId)) g.subjectId = first; });
      s.topics.forEach(t => { t.cards = t.cards || []; t.drills = t.drills || []; });
      s.scores.forEach(x => { if (!x.subjectId) x.subjectId = first; });
    });
    return data;
  }

  function persist() { TD.save(KEY, state); }
  function cur() { return state.students.find(s => s.id === state.currentId) || state.students[0] || null; }
  function topicById(s, id) { return s.topics.find(t => t.id === id); }
  function groupById(s, id) { return s.groups.find(g => g.id === id); }
  function subjectById(s, id) { return s.subjects.find(x => x.id === id); }
  function groupsOf(s, subjectId) { return s.groups.filter(g => g.subjectId === subjectId); }
  function orderedGroups(s) {
    return s.subjects.flatMap(x => groupsOf(s, x.id)).concat(s.groups.filter(g => !subjectById(s, g.subjectId)));
  }
  function groupLabel(s, g) {
    const sub = subjectById(s, g.subjectId);
    return s.subjects.length > 1 && sub ? sub.name + ' · ' + g.name : g.name;
  }
  function shownSubjects(s) {
    const f = subjectFilter !== 'all' && subjectById(s, subjectFilter);
    return f ? [f] : s.subjects;
  }
  function subjVar(s, x) { return '--subj:var(--subj-' + (Math.max(0, s.subjects.indexOf(x)) % 5) + ')'; }
  function subjectLine(x) {
    return [x.now ? esc(x.now) + ' now' : null, x.next ? esc(x.next) + ' next year' : null].filter(Boolean).join(' · ');
  }
  function subjectChips(s) {
    if (s.subjects.length < 2) return '';
    return '<div class="row" style="margin-bottom:12px">' + [['all', 'All subjects']].concat(s.subjects.map(x => [x.id, x.name])).map(([id, n]) =>
      '<button class="btn small chip" data-act="filter" data-id="' + id + '" aria-pressed="' + (subjectFilter === id) + '">' + esc(n) + '</button>').join('') + '</div>';
  }
  function topicOptions(s) {
    return s.subjects.map(x => {
      const opts = s.topics.filter(t => groupsOf(s, x.id).some(g => g.id === t.groupId))
        .map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
      return opts ? (s.subjects.length > 1 ? '<optgroup label="' + esc(x.name) + '">' + opts + '</optgroup>' : opts) : '';
    }).join('');
  }
  // Built-in drills are math only, so only guess them for math-like subjects.
  function autoDrills(s, groupId, name) {
    const g = groupById(s, groupId);
    const sub = g && subjectById(s, g.subjectId);
    return sub && /math|algebra|geometry|calc|trig|arith|stat/i.test(sub.name + ' ' + (sub.now || '')) ? guessDrills(name) : [];
  }
  function parseCards(text) {
    return text.split('\n').map(l => l.split('|')).filter(p => p.length >= 2 && p[0].trim() && p.slice(1).join('|').trim())
      .map(p => ({ q: p[0].trim(), a: p.slice(1).join('|').trim() }));
  }

  function setStatus(topic, status, date) {
    topic.status = status;
    topic.history = topic.history || [];
    const same = topic.history.find(h => h.date === date);
    if (same) same.status = status; else topic.history.push({ date, status });
    topic.history.sort((a, b) => a.date.localeCompare(b.date));
  }

  function latestConfidence(s, topicId) {
    const list = s.checkins.filter(c => c.topicId === topicId && c.confidence).sort((a, b) => a.date.localeCompare(b.date));
    return list[list.length - 1] || null;
  }

  function listJoin(arr) {
    if (arr.length <= 1) return arr.join('');
    if (arr.length === 2) return arr[0] + ' and ' + arr[1];
    return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
  }
  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  function parentMessage(s, session) {
    const p = PRONOUNS[s.pronoun] || PRONOUNS.they;
    const items = session.items;
    let msg = '';
    if (items.length) {
      msg += 'This week we worked on ' + listJoin(items.map(i => lowerFirst(i.name))) + '. ';
      if (items.length === 1) {
        msg += p.subj + ' ' + p.be + ' ' + STATUS[items[0].status].word + ' on it. ';
      } else {
        const parts = STATUSES.slice().reverse().map(st => {
          const names = items.filter(i => i.status === st.key).map(i => lowerFirst(i.name));
          return names.length ? st.word + ' on ' + listJoin(names) : null;
        }).filter(Boolean);
        msg += p.subj + ' ' + p.be + ' ' + parts.join(', and ') + '. ';
      }
    }
    if (session.gaps && session.gaps.length) {
      msg += 'I also noticed a gap in ' + listJoin(session.gaps.map(lowerFirst)) + ' in homework, so I added it to our list. ';
    }
    const plan = (session.plan || '').trim().replace(/\.+$/, '');
    msg += 'Next session we will ' + (plan ? lowerFirst(plan) : 'keep building on these skills') + '.';
    return msg.trim();
  }

  /* ---------- Rendering shell ---------- */

  const $view = document.getElementById('view');
  const $tabs = document.getElementById('tabs');
  const $picker = document.getElementById('studentPicker');

  function render() {
    const s = cur();
    $picker.innerHTML = state.students.map(st =>
      '<option value="' + st.id + '"' + (s && st.id === s.id ? ' selected' : '') + '>' + esc(st.name) + '</option>').join('');
    $picker.classList.toggle('hidden', !state.students.length);
    if (!s && view !== 'backup') view = 'roster';
    if (s && subjectFilter !== 'all' && !subjectById(s, subjectFilter)) subjectFilter = 'all';

    const inStudent = !['roster', 'backup'].includes(view);
    $tabs.innerHTML = inStudent ? TABS.map(([k, label]) =>
      '<button class="tab" role="tab" data-act="tab" data-tab="' + k + '" aria-selected="' + (view === k) + '">' + label + '</button>').join('') : '';
    $tabs.classList.toggle('hidden', !inStudent);

    const fn = { tracker: rTracker, log: rLog, plan: rPlan, practice: rPractice, scores: rScores,
      progress: rProgress, share: rShare, roster: rRoster, backup: rBackup }[view];
    $view.innerHTML = fn(s);
    if (view === 'scores') drawScoreChart(s);
    if (view === 'progress') drawMastery(s);
    const active = $tabs.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function studentHeader(s) {
    const ns = nextSession(s.schedule);
    let h = '<div class="card"><div class="card-head"><div><h2>' + esc(s.name) + '</h2>' +
      '<div class="small muted">' + [s.grade ? 'Grade ' + esc(s.grade) : null, esc(sessionText(s.schedule)), ns ? 'Next: ' + esc(ns.label) : null].filter(Boolean).join(' · ') + '</div></div>' +
      '<button class="btn small" data-act="editStudent" data-id="' + s.id + '">Edit</button></div>' +
      (s.notes ? '<details style="margin-bottom:10px"><summary>Private notes</summary><p class="small" style="white-space:pre-wrap;margin:6px 0 0">' + esc(s.notes) + '</p></details>' : '');
    h += '<div class="row">' + s.subjects.map(x => '<button class="btn small subj-btn" style="' + subjVar(s, x) + '" data-act="editSubject" data-id="' + x.id + '" title="Edit subject"><b>' + esc(x.name) + '</b>' +
      (subjectLine(x) ? '<span class="muted" style="font-weight:400">' + subjectLine(x) + '</span>' : '') + '</button>').join('') +
      '<button class="btn small link" data-act="addSubject">+ Add subject</button></div>';
    return h + '</div>';
  }

  function seg(status, act, id) {
    return '<div class="seg" role="group" aria-label="Status">' + STATUSES.map(st =>
      '<button type="button" data-act="' + act + '" data-id="' + (id || '') + '" data-s="' + st.key + '" aria-pressed="' + (status === st.key) + '">' + st.label + '</button>').join('') + '</div>';
  }

  /* ---------- Topics tab ---------- */

  function rTracker(s) {
    let h = studentHeader(s) + subjectChips(s);
    if (!s.subjects.length) h += '<div class="card empty">Add a subject to start tracking topics.</div>';
    shownSubjects(s).forEach(sub => {
      if (s.subjects.length > 1) h += '<h2 class="subject-title" style="' + subjVar(s, sub) + '">' + esc(sub.name) + '</h2>';
      groupsOf(s, sub.id).forEach(g => {
        const topics = s.topics.filter(t => t.groupId === g.id);
        h += '<section class="card group kind-' + esc(g.kind) + '"><div class="group-head"><h3>' + esc(g.name) + '</h3>' +
          '<span class="kind-tag">' + esc(GROUP_KINDS[g.kind] || '') + '</span><span class="grow"></span>' +
          '<button class="btn small link" data-act="editGroup" data-id="' + g.id + '">Edit group</button></div>';
        h += topics.length ? topics.map(t => topicCard(s, t)).join('') : '<div class="empty">No topics in this group yet.</div>';
        h += '<button class="btn small" data-act="addTopic" data-group="' + g.id + '">+ Add topic</button></section>';
      });
      h += '<button class="btn" data-act="addGroup" data-subject="' + sub.id + '" style="margin-bottom:16px">+ Add ' + esc(sub.name) + ' group</button>';
    });
    const orphan = s.topics.filter(t => !groupById(s, t.groupId));
    if (orphan.length && subjectFilter === 'all') h += '<section class="card"><h3>Ungrouped</h3>' + orphan.map(t => topicCard(s, t)).join('') + '</section>';
    return h;
  }

  function topicCard(s, t) {
    const ds = daysSince(t.lastWorked);
    const conf = latestConfidence(s, t.id);
    const meta = [
      t.lastWorked ? 'Last worked ' + fmtDate(t.lastWorked) + (ds > 0 ? ' (' + ds + 'd ago)' : ' (today)') : 'Not worked on yet',
      conf ? 'Student confidence ' + conf.confidence + '/5' : null,
      t.drills && t.drills.length ? 'Drills: ' + t.drills.map(k => DRILLS[k].name).join(', ') : null,
      t.cards && t.cards.length ? t.cards.length + ' practice question' + (t.cards.length === 1 ? '' : 's') : null
    ].filter(Boolean).join(' · ');
    return '<div class="topic st-' + t.status + '"><div class="topic-top"><div class="grow"><div class="topic-name">' + esc(t.name) + '</div>' +
      (t.details ? '<div class="small muted">' + esc(t.details) + '</div>' : '') +
      '<div class="topic-meta">' + esc(meta) + '</div></div>' + seg(t.status, 'topicStatus', t.id) + '</div>' +
      (t.notes ? '<p class="small" style="margin:8px 0 0;white-space:pre-wrap"><b>Notes:</b> ' + esc(t.notes) + '</p>' : '') +
      '<div class="row" style="margin-top:6px"><button class="btn small link" data-act="editTopic" data-id="' + t.id + '">Edit / notes</button></div></div>';
  }

  /* ---------- Log session tab ---------- */

  function rLog(s) {
    let h = '';
    const latest = s.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created)[0];
    const showId = lastLoggedId && s.sessions.find(x => x.id === lastLoggedId) ? lastLoggedId : latest && latest.id;
    if (showId) h += parentCard(s, s.sessions.find(x => x.id === showId));

    const mains = s.subjects.map(x => suggestPlan(s, { breakMode, subjectId: x.id }).main).filter(Boolean);
    const defaultPlan = mains.length ? 'work on ' + listJoin(mains.map(m => lowerFirst(m.topic.name))) : '';
    h += '<form class="card" id="logForm"><h2>Log a session</h2>' +
      '<div class="field"><label for="logDate">Date</label><input type="date" id="logDate" value="' + today() + '" required></div>' +
      '<label>What did you cover? Tap a topic, then set its new status.</label>';
    orderedGroups(s).forEach(g => {
      const topics = s.topics.filter(t => t.groupId === g.id);
      if (!topics.length) return;
      h += '<div class="small muted" style="margin:10px 0 4px">' + esc(groupLabel(s, g)) + '</div>';
      topics.forEach(t => {
        h += '<div class="topic log-row" data-topic="' + t.id + '"><div class="topic-top"><label class="row grow" style="margin:0;color:var(--text);cursor:pointer">' +
          '<input type="checkbox" class="log-check"> <span>' + esc(t.name) + '</span></label>' +
          '<div class="log-seg hidden">' + seg(t.status, 'pickSeg') + '</div></div></div>';
      });
    });
    h += '<div id="gapRows"></div><button type="button" class="btn small" data-act="addGapRow" style="margin:4px 0 14px">+ New gap spotted in homework</button>' +
      '<div class="field"><label for="logNote">Short note (private)</label><textarea id="logNote" placeholder="What clicked, what didn\'t"></textarea></div>' +
      '<div class="field"><label for="logPlan">Next session we will...</label><input id="logPlan" value="' + esc(defaultPlan) + '"></div>' +
      '<button class="btn primary block" type="submit">Save session</button></form>';

    h += '<div class="card"><h2>Past sessions</h2>';
    if (!s.sessions.length) h += '<div class="empty">No sessions logged yet.</div>';
    else {
      h += '<ul class="list">' + s.sessions.slice().sort((a, b) => b.date.localeCompare(a.date)).map(x =>
        '<li><div class="row"><b class="grow">' + fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + '</b>' +
        '<button class="btn small link" data-act="showParent" data-id="' + x.id + '">Parent message</button>' +
        '<button class="btn small link danger" data-act="delSession" data-id="' + x.id + '">Delete</button></div>' +
        '<div class="row" style="margin-top:4px">' + x.items.map(i => '<span class="small">' + esc(i.name) + '</span> ' + statusPill(i.status)).join(' ') + '</div>' +
        (x.gaps && x.gaps.length ? '<div class="small muted">New gaps: ' + esc(x.gaps.join(', ')) + '</div>' : '') +
        (x.note ? '<div class="small muted" style="white-space:pre-wrap">' + esc(x.note) + '</div>' : '') + '</li>').join('') + '</ul>';
    }
    return h + '</div>';
  }

  function parentCard(s, session) {
    return '<div class="card"><div class="card-head"><h2>Parent update</h2><span class="small muted">' +
      fmtDate(session.date, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span></div>' +
      '<textarea id="parentMsg" rows="6">' + esc(parentMessage(s, session)) + '</textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" data-act="copyParent">Copy message</button>' +
      '<span class="small muted">You can edit it before copying.</span></div></div>';
  }

  function gapRow(s) {
    return '<div class="topic gap-row"><div class="fields">' +
      '<div class="field full"><label>New gap topic</label><input class="gap-name" placeholder="e.g. Distributing negatives"></div>' +
      '<div class="field"><label>Group</label><select class="gap-group">' + orderedGroups(s).map(g => '<option value="' + g.id + '">' + esc(groupLabel(s, g)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Status</label>' + seg('shaky', 'pickSeg') + '</div></div>' +
      '<button type="button" class="btn small link danger" data-act="removeRow">Remove</button></div>';
  }

  function saveLog(s) {
    const date = document.getElementById('logDate').value || today();
    const items = [];
    document.querySelectorAll('.log-row').forEach(row => {
      if (!row.querySelector('.log-check').checked) return;
      const t = topicById(s, row.dataset.topic);
      const st = row.querySelector('[aria-pressed="true"]').dataset.s;
      items.push({ topicId: t.id, name: t.name, status: st });
    });
    const gaps = [];
    document.querySelectorAll('.gap-row').forEach(row => {
      const name = row.querySelector('.gap-name').value.trim();
      if (!name) return;
      gaps.push({ name, groupId: row.querySelector('.gap-group').value, status: row.querySelector('[aria-pressed="true"]').dataset.s });
    });
    if (!items.length && !gaps.length) { toast('Pick at least one topic or add a gap.'); return; }

    items.forEach(i => {
      const t = topicById(s, i.topicId);
      setStatus(t, i.status, date);
      if (!t.lastWorked || t.lastWorked < date) t.lastWorked = date;
    });
    gaps.forEach(g => {
      s.topics.push({ id: uid(), groupId: g.groupId, name: g.name, details: 'Spotted in homework ' + fmtDate(date),
        status: g.status, lastWorked: null, notes: '', drills: autoDrills(s, g.groupId, g.name), cards: [], history: [{ date, status: g.status }] });
    });
    const session = {
      id: uid(), created: Date.now(), date, items, gaps: gaps.map(g => g.name),
      note: document.getElementById('logNote').value.trim(),
      plan: document.getElementById('logPlan').value.trim()
    };
    s.sessions.push(session);
    lastLoggedId = session.id;
    persist();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Session saved. Tracker updated.');
  }

  /* ---------- Next session tab ---------- */

  function planItem(n, prefix, r, fallback) {
    return '<div class="plan-item"><div class="plan-rank">' + n + '</div><div><b>' + prefix + esc(r.topic.name) + '</b> ' + statusPill(r.topic.status) +
      '<div class="reasons">' + esc(r.reasons.join(' · ') || fallback) + '</div></div></div>';
  }

  function rPlan(s) {
    const ns = nextSession(s.schedule);
    let h = '<div class="card"><div class="card-head"><div><h2>Suggested next session</h2>' + (ns ? '<div class="small muted">' + esc(ns.label) + '</div>' : '') + '</div>' +
      '<label class="row" style="margin:0"><input type="checkbox" data-act="breakMode"' + (breakMode ? ' checked' : '') + '> School break</label></div>';
    if (!s.topics.length) return h + '<div class="empty">Add some topics first.</div></div>';
    let n = 0;
    s.subjects.forEach(sub => {
      const plan = suggestPlan(s, { breakMode, subjectId: sub.id });
      if (!plan.main) return;
      if (s.subjects.length > 1) h += '<h3 style="margin-top:12px">' + esc(sub.name) + '</h3>';
      h += planItem(++n, 'Main block: ', plan.main, 'Next up');
      if (plan.warm) h += planItem(++n, 'Warm-up (5-10 min): ', plan.warm, 'Keep it fresh');
    });
    h += '<p class="small muted" style="margin:10px 0 0">Shakiest topics, topics not touched in a while, and topics that match class now rise to the top.' +
      (breakMode ? ' Break mode is on, so Group C blocks are boosted.' : ' Turn on School break to boost the bigger Group C blocks.') + '</p></div>';
    s.subjects.forEach(sub => {
      const ranked = planTopics(s, { breakMode, subjectId: sub.id });
      if (!ranked.length) return;
      h += '<div class="card"><h2>' + (s.subjects.length > 1 ? esc(sub.name) + ': all topics by priority' : 'All topics, by priority') + '</h2>' +
        ranked.map((r, i) => '<div class="plan-item"><div class="plan-rank">' + (i + 1) + '</div><div class="grow"><div class="row"><b class="grow">' + esc(r.topic.name) + '</b>' + statusPill(r.topic.status) + '</div>' +
        '<div class="reasons">' + esc((groupById(s, r.topic.groupId) || {}).name || '') + (r.reasons.length ? ' · ' + esc(r.reasons.join(' · ')) : '') + '</div></div></div>').join('') + '</div>';
    });
    return h;
  }

  /* ---------- Practice tab ---------- */

  function rPractice(s) {
    const open = s.assignments.filter(a => !a.done);
    const done = s.assignments.filter(a => a.done).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''));
    let h = '<form class="card" id="assignForm"><h2>Assign practice</h2><div class="fields">' +
      '<div class="field"><label for="aTopic">Topic</label><select id="aTopic">' + topicOptions(s) + '</select></div>' +
      '<div class="field"><label for="aDue">Due (optional)</label><input type="date" id="aDue"></div>' +
      '<div class="field full"><label for="aTitle">What to do</label><input id="aTitle" required placeholder="e.g. Worksheet #3, problems 1-12"></div>' +
      '<div class="field full"><label for="aLink">Link (optional)</label><input id="aLink" inputmode="url" autocapitalize="off" placeholder="https://..."></div></div>' +
      '<button class="btn primary" type="submit">Assign</button></form>';

    h += '<div class="card"><h2>Assigned</h2>' + (open.length ? '<ul class="list">' + open.map(a => assignRow(s, a)).join('') + '</ul>' : '<div class="empty">Nothing open right now.</div>') + '</div>';
    if (done.length) h += '<div class="card"><details><summary><h2 style="display:inline">Completed (' + done.length + ')</h2></summary><ul class="list">' + done.map(a => assignRow(s, a)).join('') + '</ul></details></div>';

    // Student activity from check-in codes
    const ch = s.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));
    const st = streak(ch.map(c => c.date));
    h += '<div class="card"><div class="card-head"><h2>Student practice and confidence</h2>' +
      '<button class="btn small" data-act="tab" data-tab="share">Paste check-in code</button></div>';
    if (!ch.length) h += '<div class="empty">No check-ins yet. When ' + esc(s.name) + ' practices, they can send you a check-in code from their dashboard.</div>';
    else {
      h += '<p class="small muted">Practiced on ' + st.days + ' day' + (st.days === 1 ? '' : 's') + ' · current streak ' + st.current + ' · best ' + st.best + '</p>';
      h += '<table class="data"><thead><tr><th>Date</th><th>Practice</th><th>Result</th><th>Confidence</th></tr></thead><tbody>' +
        ch.slice(0, 30).map(c => {
          const t = c.topicId && topicById(s, c.topicId);
          const what = c.kind === 'drill' ? DRILLS[c.drill] ? DRILLS[c.drill].name + ' drill' : 'Drill' :
            c.kind === 'cards' ? 'Practice questions' : (c.title || (t ? t.name : 'Practice'));
          return '<tr><td>' + fmtDate(c.date) + '</td><td>' + esc(what) + (t && c.kind !== 'assignment' ? '<div class="small muted">' + esc(t.name) + '</div>' : '') + '</td>' +
            '<td>' + (c.total ? c.correct + '/' + c.total : (c.kind === 'assignment' ? 'Done' : '')) + '</td>' +
            '<td>' + (c.confidence ? c.confidence + '/5 <span class="small muted">' + CONF_WORDS[c.confidence] + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return h + '</div>';
  }

  function assignRow(s, a) {
    const t = topicById(s, a.topicId);
    return '<li><div class="row"><input type="checkbox" data-act="toggleAssign" data-id="' + a.id + '"' + (a.done ? ' checked' : '') + ' aria-label="Mark complete">' +
      '<div class="grow"><b>' + esc(a.title) + '</b>' + (/^https?:\/\//i.test(a.link || '') ? ' <a href="' + esc(a.link) + '" target="_blank" rel="noopener">link</a>' : '') +
      '<div class="small muted">' + esc(t ? t.name : 'Deleted topic') + (a.due ? ' · due ' + fmtDate(a.due) : '') +
      (a.done ? ' · done ' + fmtDate(a.doneDate) + (a.by === 'student' ? ' (reported by student)' : '') : '') + '</div></div>' +
      '<button class="btn small link danger" data-act="delAssign" data-id="' + a.id + '">Delete</button></div></li>';
  }

  /* ---------- Scores tab ---------- */

  function pct(x) { return x.max ? (x.score / x.max) * 100 : 0; }
  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

  function scoreList(s) {
    return s.scores.filter(x => subjectFilter === 'all' || x.subjectId === subjectFilter).sort((a, b) => a.date.localeCompare(b.date));
  }

  function rScores(s) {
    const list = scoreList(s);
    const multi = s.subjects.length > 1;
    let h = subjectChips(s) + '<form class="card" id="scoreForm"><h2>Add a score</h2><div class="fields">' +
      (multi ? '<div class="field full"><label for="sSubject">Subject</label><select id="sSubject">' + s.subjects.map(x =>
        '<option value="' + x.id + '"' + (x.id === subjectFilter ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' : '') +
      '<div class="field"><label for="sDate">Date</label><input type="date" id="sDate" value="' + today() + '" required></div>' +
      '<div class="field"><label for="sType">Type</label><select id="sType"><option value="homework">Homework</option><option value="test">Test / quiz</option></select></div>' +
      '<div class="field full"><label for="sLabel">What was it?</label><input id="sLabel" placeholder="e.g. Unit 3 test"></div>' +
      '<div class="field"><label for="sScore">Score</label><input id="sScore" type="number" inputmode="decimal" step="any" min="0" required></div>' +
      '<div class="field"><label for="sMax">Out of</label><input id="sMax" type="number" inputmode="decimal" step="any" min="1" value="100" required></div></div>' +
      '<button class="btn primary" type="submit">Add score</button></form>';

    h += '<div class="card"><h2>Homework vs. tests</h2>';
    shownSubjects(s).forEach(sub => {
      const own = list.filter(x => x.subjectId === sub.id || (s.subjects.length === 1 && !subjectById(s, x.subjectId)));
      const hw = own.filter(x => x.type === 'homework').slice(-5).map(pct);
      const ts = own.filter(x => x.type === 'test').slice(-5).map(pct);
      const name = multi ? esc(sub.name) + ': ' : '';
      if (hw.length && ts.length) {
        const gap = avg(hw) - avg(ts);
        const line = 'Recent homework average ' + Math.round(avg(hw)) + '% · recent test average ' + Math.round(avg(ts)) + '%.';
        if (gap >= 15) h += '<div class="flag" style="margin-bottom:8px"><b>' + name + 'Homework is strong but tests are weaker</b> (' + Math.round(gap) + ' points apart). ' + line + ' Worth practicing timed, closed-notes problems.</div>';
        else if (gap <= -15) h += '<div class="flag" style="margin-bottom:8px"><b>' + name + 'Tests are higher than homework</b> (' + Math.round(-gap) + ' points apart). ' + line + ' Homework may be rushed or incomplete.</div>';
        else h += '<div class="flag good" style="margin-bottom:8px"><b>' + name + 'Homework and tests line up.</b> ' + line + '</div>';
      } else {
        h += '<p class="small muted">' + name + 'Add at least one homework score and one test score to compare them.</p>';
      }
    });
    if (multi && subjectFilter === 'all' && list.length) h += '<p class="small muted">The chart shows every subject together. Pick a subject above to see just one.</p>';
    h += list.length ? '<div class="legend" style="margin:12px 0 4px"><span><i class="sw line" style="background:var(--series-1)"></i>Homework</span><span><i class="sw line" style="background:var(--series-2)"></i>Test / quiz</span></div><div class="chart" id="scoreChart"></div>' : '';
    h += '</div>';

    h += '<div class="card"><h2>All scores</h2>' + (list.length ? '<table class="data"><thead><tr><th>Date</th><th>Type</th><th>What</th><th>Score</th><th></th></tr></thead><tbody>' +
      list.slice().reverse().map(x => '<tr><td>' + fmtDate(x.date) + '</td><td>' + (x.type === 'test' ? 'Test / quiz' : 'Homework') + '</td><td>' + esc(x.label) + (multi && subjectById(s, x.subjectId) ? '<div class="small muted">' + esc(subjectById(s, x.subjectId).name) + '</div>' : '') + '</td>' +
        '<td>' + x.score + '/' + x.max + ' <span class="small muted">' + Math.round(pct(x)) + '%</span></td>' +
        '<td><button class="btn small link danger" data-act="delScore" data-id="' + x.id + '">Delete</button></td></tr>').join('') +
      '</tbody></table>' : '<div class="empty">No scores yet.</div>') + '</div>';
    return h;
  }

  function drawScoreChart(s) {
    const el = document.getElementById('scoreChart');
    if (!el) return;
    const list = scoreList(s);
    const W = Math.max(300, el.clientWidth || 640), H = 240, L = 34, R = 74, T = 10, B = 26;
    const t0 = parseISO(list[0].date).getTime();
    const t1 = parseISO(list[list.length - 1].date).getTime();
    const x = d => L + (t1 === t0 ? (W - L - R) / 2 : (parseISO(d).getTime() - t0) / (t1 - t0) * (W - L - R));
    const y = v => T + (1 - Math.min(v, 110) / 110) * (H - T - B);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Homework and test scores over time"><g class="grid axis">';
    [0, 25, 50, 75, 100].forEach(v => {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '%</text>';
    });
    const dates = Array.from(new Set(list.map(d => d.date)));
    const step = Math.max(1, Math.ceil(dates.length / 6));
    let lastX = -Infinity;
    dates.forEach((d, i) => {
      if (!(i % step === 0 || i === dates.length - 1) || x(d) - lastX < 46) return;
      lastX = x(d);
      svg += '<text x="' + x(d) + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtDate(d) + '</text>';
    });
    svg += '</g>';
    const pts = [];
    [['homework', 'var(--series-1)', 'Homework'], ['test', 'var(--series-2)', 'Test']].forEach(([type, color, name]) => {
      const ser = list.filter(d => d.type === type);
      if (!ser.length) return;
      svg += '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
        ser.map(d => x(d.date) + ',' + y(pct(d))).join(' ') + '"/>';
      ser.forEach(d => {
        svg += '<circle cx="' + x(d.date) + '" cy="' + y(pct(d)) + '" r="4" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>';
        pts.push({ d, name });
      });
      const last = ser[ser.length - 1];
      svg += '<text class="lbl" x="' + (x(last.date) + 9) + '" y="' + (y(pct(last)) + 4) + '">' + name + '</text>';
    });
    pts.forEach((p, i) => { svg += '<circle data-i="' + i + '" cx="' + x(p.d.date) + '" cy="' + y(pct(p.d)) + '" r="14" fill="transparent" style="cursor:pointer"/>'; });
    el.innerHTML = svg + '</svg><div class="tip hidden"></div>';
    const tip = el.querySelector('.tip');
    const svgEl = el.querySelector('svg');
    const show = e => {
      const c = e.target.closest('circle[data-i]');
      if (!c) { tip.classList.add('hidden'); return; }
      const p = pts[c.dataset.i];
      const scale = svgEl.getBoundingClientRect().width / W;
      tip.textContent = p.name + ' · ' + fmtDate(p.d.date) + (p.d.label ? ' · ' + p.d.label : '') + ' · ' + p.d.score + '/' + p.d.max + ' (' + Math.round(pct(p.d)) + '%)';
      tip.style.left = (c.getAttribute('cx') * scale) + 'px';
      tip.style.top = (c.getAttribute('cy') * scale) + 'px';
      tip.classList.remove('hidden');
    };
    svgEl.addEventListener('pointermove', show);
    svgEl.addEventListener('pointerdown', show);
    svgEl.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  }

  /* ---------- Progress tab ---------- */

  const RANK = { none: 0, shaky: 1, solid: 2 };
  const ABBREV = { none: '–', shaky: 'S', solid: '✓' };

  function weekEnd(w) { const d = parseISO(w); d.setDate(d.getDate() + 6); return toISO(d); }
  function statusAt(t, iso) {
    const hist = (t.history || []).filter(x => x.date <= iso);
    return hist.length ? hist[hist.length - 1].status : null;
  }
  function progTopics(s) {
    const ids = new Set(shownSubjects(s).flatMap(sub => groupsOf(s, sub.id).map(g => g.id)));
    return s.topics.filter(t => ids.has(t.groupId) || (subjectFilter === 'all' && !groupById(s, t.groupId)));
  }
  function progWeeks(s) {
    const all = progTopics(s).flatMap(t => (t.history || []).map(h => h.date)).sort();
    if (!all.length) return [];
    const weeks = [];
    const d = parseISO(weekStart(all[0]));
    const end = weekStart(today());
    while (toISO(d) <= end) { weeks.push(toISO(d)); d.setDate(d.getDate() + 7); }
    return progRange ? weeks.slice(-progRange) : weeks;
  }
  function weekLabel(w) { return fmtDate(w) + '–' + fmtDate(weekEnd(w)); }
  function inWeek(date, w) { return date >= w && date <= weekEnd(w); }

  function rProgress(s) {
    const topics = progTopics(s);
    let h = subjectChips(s);
    const weeks = progWeeks(s);
    if (!weeks.length) return h + '<div class="card"><h2>Progress</h2><div class="empty">No history yet. Log a session to start the timeline.</div></div>';

    // Summary tiles
    const ago = new Date(); ago.setDate(ago.getDate() - 30);
    const agoIso = toISO(ago);
    const count = st => topics.filter(t => t.status === st).length;
    const movedUp = topics.filter(t => RANK[t.status] > RANK[statusAt(t, agoIso) || 'none']).length;
    h += '<div class="tiles">' +
      '<div class="tile solid"><b>' + count('solid') + '</b><span>Solid</span></div>' +
      '<div class="tile shaky"><b>' + count('shaky') + '</b><span>Shaky</span></div>' +
      '<div class="tile none"><b>' + count('none') + '</b><span>Not started</span></div>' +
      '<div class="tile up"><b>' + (movedUp ? '▲ ' : '') + movedUp + '</b><span>Moved up in 30 days</span></div></div>';

    // Mastery chart
    h += '<div class="card"><div class="card-head"><h2>Mastery over time</h2><div class="row">' +
      [[4, '4 wks'], [12, '12 wks'], [0, 'All']].map(([n, l]) =>
        '<button class="btn small chip" data-act="progRange" data-n="' + n + '" aria-pressed="' + (progRange === n) + '">' + l + '</button>').join('') + '</div></div>' +
      '<div class="legend" style="margin:0 0 6px"><span><i class="sw" style="background:var(--st-solid)"></i>Solid</span>' +
      '<span><i class="sw" style="background:var(--st-shaky)"></i>Shaky</span><span><i class="sw" style="background:var(--st-none)"></i>Not started</span></div>' +
      '<div class="chart" id="masteryChart"></div><p class="small muted" style="margin:6px 0 0">Tap a week to see what happened.</p></div>';

    // Grid
    const selW = progSel && progSel.w;
    const selT = progSel && progSel.id;
    h += '<div class="card"><h2>Week by week</h2><p class="small muted">Where each topic stood at the end of each week. Tap a square, a week or a topic for details.</p>' +
      '<div class="tl-wrap"><table class="tl"><thead><tr><th class="topic-col">Topic</th>' +
      weeks.map(w => '<th><button class="tl-week' + (w === selW ? ' on' : '') + '" data-act="progWeek" data-w="' + w + '" title="Week of ' + esc(weekLabel(w)) + '">' +
        fmtDate(w, { month: 'numeric', day: 'numeric' }) + '</button></th>').join('') + '</tr></thead><tbody>';
    const rowGroups = shownSubjects(s).flatMap(sub => [{ header: sub }].concat(groupsOf(s, sub.id)));
    if (subjectFilter === 'all') rowGroups.push({ id: null });
    rowGroups.forEach(g => {
      if (g.header) {
        if (s.subjects.length > 1) h += '<tr><th class="topic-col" colspan="' + (weeks.length + 1) + '" style="padding-top:10px">' + esc(g.header.name) + '</th></tr>';
        return;
      }
      topics.filter(t => g.id ? t.groupId === g.id : !groupById(s, t.groupId)).forEach(t => {
        h += '<tr class="' + (t.id === selT ? 'row-on' : '') + '"><th class="topic-col" scope="row"><button class="tl-topic" data-act="progTopic" data-id="' + t.id + '">' + esc(t.name) + '</button></th>';
        weeks.forEach(w => {
          const st = statusAt(t, weekEnd(w));
          if (!st) { h += '<td class="blank' + (w === selW ? ' col-on' : '') + '"></td>'; return; }
          const changed = (t.history || []).some((x, i, arr) => i > 0 && inWeek(x.date, w) && arr[i - 1].status !== x.status);
          const on = progSel && progSel.kind === 'cell' && progSel.id === t.id && progSel.w === w;
          h += '<td class="cell ' + st + (w === selW ? ' col-on' : '') + (on ? ' on' : '') + '" data-act="progCell" data-id="' + t.id + '" data-w="' + w + '" ' +
            'title="' + esc(t.name + ', week of ' + weekLabel(w) + ': ' + STATUS[st].label) + '" tabindex="0" role="button">' + ABBREV[st] + (changed ? '<i class="tl-dot"></i>' : '') + '</td>';
        });
        h += '</tr>';
      });
    });
    h += '</tbody></table></div><div class="legend"><span><i class="sw" style="background:var(--surface-2);border:1px solid var(--border)"></i>– Not started</span>' +
      '<span><i class="sw" style="background:var(--st-shaky)"></i>S Shaky</span><span><i class="sw" style="background:var(--st-solid)"></i>✓ Solid</span>' +
      '<span><i class="tl-dot" style="position:static"></i>Changed that week</span></div></div>';

    if (progSel) h += progDetail(s);

    const changes = topics.flatMap(t => (t.history || []).map((x, i, arr) => ({ t, x, prev: arr[i - 1] })))
      .filter(c => c.prev && c.prev.status !== c.x.status).sort((a, b) => b.x.date.localeCompare(a.x.date));
    h += '<div class="card"><h2>Recent changes</h2>' + (changes.length ? '<ul class="list">' + changes.slice(0, 15).map(c =>
      '<li><button class="tl-change" data-act="progTopic" data-id="' + c.t.id + '"><span class="tl-change-name"><span class="small muted">' + fmtDate(c.x.date) + '</span> ' + esc(c.t.name) + '</span>' +
      '<span class="row">' + statusPill(c.prev.status) + '<span class="muted">→</span>' + statusPill(c.x.status) + '</span></button></li>').join('') + '</ul>' : '<div class="empty">No status changes yet.</div>') + '</div>';
    return h;
  }

  function sessionLine(x, onlyTopic) {
    const items = onlyTopic ? x.items.filter(i => i.topicId === onlyTopic) : x.items;
    return '<li><div class="row"><b class="grow">Session · ' + fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' }) + '</b></div>' +
      (items.length ? '<div class="row" style="margin-top:4px">' + items.map(i => '<span class="small">' + esc(i.name) + '</span> ' + statusPill(i.status)).join(' ') + '</div>' : '') +
      (x.gaps && x.gaps.length && !onlyTopic ? '<div class="small muted">New gaps: ' + esc(x.gaps.join(', ')) + '</div>' : '') +
      (x.note ? '<div class="small muted" style="white-space:pre-wrap;margin-top:2px">' + esc(x.note) + '</div>' : '') + '</li>';
  }
  function checkinLine(s, c) {
    const t = c.topicId && topicById(s, c.topicId);
    const what = c.kind === 'drill' ? (DRILLS[c.drill] ? DRILLS[c.drill].name + ' drill' : 'Drill') : c.kind === 'cards' ? 'Practice questions' : (c.title || 'Practice');
    return '<li><div class="tl-change-name"><span class="small muted">' + fmtDate(c.date) + '</span> ' + esc(what) +
      (t ? ' <span class="small muted">· ' + esc(t.name) + '</span>' : '') + '</div><div class="row" style="margin-top:4px">' +
      (c.total ? '<span class="pill info">' + c.correct + '/' + c.total + ' right</span>' : '') +
      (c.confidence ? '<span class="pill">Confidence ' + c.confidence + '/5</span>' : '') + '</div></li>';
  }

  function progDetail(s) {
    const sel = progSel;
    let h = '<div class="card detail" id="progDetail"><div class="card-head">';
    const close = '<button class="btn small" data-act="progClose" aria-label="Close details">✕</button>';
    const sec = (title, inner) => '<h3 style="margin-top:14px">' + title + '</h3>' + inner;

    if (sel.kind === 'week') {
      const w = sel.w;
      const sessions = s.sessions.filter(x => inWeek(x.date, w)).sort((a, b) => a.date.localeCompare(b.date));
      const changes = s.topics.flatMap(t => (t.history || []).map((x, i, arr) => ({ t, x, prev: arr[i - 1] })))
        .filter(c => inWeek(c.x.date, w) && (!c.prev || c.prev.status !== c.x.status));
      const checks = s.checkins.filter(c => inWeek(c.date, w));
      const scores = s.scores.filter(x => inWeek(x.date, w));
      h += '<div><div class="rec-label">Week</div><h2>' + esc(weekLabel(w)) + '</h2></div>' + close + '</div>';
      h += sec('Sessions', sessions.length ? '<ul class="list">' + sessions.map(x => sessionLine(x)).join('') + '</ul>' : '<div class="empty">No session logged this week.</div>');
      h += sec('Status changes', changes.length ? '<ul class="list">' + changes.map(c =>
        '<li class="row"><span class="grow">' + esc(c.t.name) + '</span>' + (c.prev ? statusPill(c.prev.status) + '<span class="muted">→</span>' : '<span class="small muted">added</span>') + statusPill(c.x.status) + '</li>').join('') + '</ul>' : '<div class="empty">No changes this week.</div>');
      if (checks.length) h += sec('Student practice', '<ul class="list">' + checks.map(c => checkinLine(s, c)).join('') + '</ul>');
      if (scores.length) h += sec('Scores', '<ul class="list">' + scores.map(x => '<li class="row"><span class="grow">' + esc(x.label || (x.type === 'test' ? 'Test / quiz' : 'Homework')) + '</span><span class="pill info">' + x.score + '/' + x.max + '</span></li>').join('') + '</ul>');
      return h + '</div>';
    }

    const t = topicById(s, sel.id);
    if (!t) return '';
    const g = groupById(s, t.groupId);
    const inRange = d => sel.kind !== 'cell' || inWeek(d, sel.w);
    const sessions = s.sessions.filter(x => x.items.some(i => i.topicId === t.id) && inRange(x.date)).sort((a, b) => b.date.localeCompare(a.date));
    const checks = s.checkins.filter(c => c.topicId === t.id && inRange(c.date)).sort((a, b) => b.date.localeCompare(a.date));
    const hist = (t.history || []).filter(x => inRange(x.date));
    const label = sel.kind === 'cell' ? 'Week of ' + weekLabel(sel.w) : [g ? groupLabel(s, g) : null, t.lastWorked ? 'last worked ' + fmtDate(t.lastWorked) : 'not worked on yet'].filter(Boolean).join(' · ');
    const st = sel.kind === 'cell' ? statusAt(t, weekEnd(sel.w)) : t.status;
    h += '<div><div class="rec-label">' + esc(label) + '</div><h2>' + esc(t.name) + '</h2>' + statusPill(st) + '</div>' + close + '</div>';

    h += sec(sel.kind === 'cell' ? 'Status that week' : 'Status timeline', hist.length ? '<ol class="tline">' + hist.slice().reverse().map(x => {
      const allH = t.history || [];
      const idx = allH.indexOf(x);
      const before = allH[idx - 1];
      const verb = !before ? 'Added as' : before.status === x.status ? 'Still' : (RANK[x.status] > RANK[before.status] ? 'Moved up to' : 'Moved to');
      return '<li class="' + x.status + '"><span class="small muted">' + fmtDate(x.date, { month: 'short', day: 'numeric', year: 'numeric' }) + '</span><div>' + verb + ' ' + statusPill(x.status) + '</div></li>';
    }).join('') + '</ol>' : '<div class="empty">No status changes ' + (sel.kind === 'cell' ? 'this week. It stayed ' + STATUS[st].word + '.' : 'yet.') + '</div>');
    h += sec('Sessions', sessions.length ? '<ul class="list">' + sessions.map(x => sessionLine(x, t.id)).join('') + '</ul>' : '<div class="empty">No sessions on this topic' + (sel.kind === 'cell' ? ' this week.' : ' yet.') + '</div>');
    if (checks.length) h += sec('Student practice', '<ul class="list">' + checks.map(c => checkinLine(s, c)).join('') + '</ul>');
    if (sel.kind !== 'cell') {
      const asg = s.assignments.filter(a => a.topicId === t.id);
      if (asg.length) h += sec('Assigned practice', '<ul class="list">' + asg.map(a => '<li class="row"><span class="grow">' + esc(a.title) + '</span>' +
        (a.done ? '<span class="pill solid"><span class="dot"></span>Done</span>' : '<span class="pill">Open</span>') + '</li>').join('') + '</ul>');
      if (t.notes) h += sec('Notes', '<p class="small" style="white-space:pre-wrap">' + esc(t.notes) + '</p>');
    }
    h += '<div class="row" style="margin-top:12px">' + (sel.kind === 'cell' ? '<button class="btn small" data-act="progTopic" data-id="' + t.id + '">Full history</button>' : '') +
      '<button class="btn small" data-act="editTopic" data-id="' + t.id + '">Edit / notes</button></div>';
    return h + '</div>';
  }

  function drawMastery(s) {
    const el = document.getElementById('masteryChart');
    if (!el) return;
    // Start the grid on the newest weeks, or on the selected week.
    const wrap = document.querySelector('.tl-wrap');
    const onCol = wrap && (wrap.querySelector('.tl-week.on') || wrap.querySelector('td.on'));
    if (wrap) wrap.scrollLeft = onCol ? onCol.offsetLeft - wrap.clientWidth / 2 : wrap.scrollWidth;
    const weeks = progWeeks(s);
    const topics = progTopics(s);
    const data = weeks.map(w => {
      const c = { w, solid: 0, shaky: 0, none: 0 };
      topics.forEach(t => { const st = statusAt(t, weekEnd(w)); if (st) c[st]++; });
      c.total = c.solid + c.shaky + c.none;
      return c;
    });
    const W = Math.max(300, el.clientWidth || 600), H = 190, L = 26, R = 8, T = 8, B = 24;
    const max = Math.max(1, ...data.map(d => d.total));
    const slot = (W - L - R) / data.length;
    const bw = Math.max(6, Math.min(40, slot * 0.66));
    const y = v => T + (1 - v / max) * (H - T - B);
    const step = Math.max(1, Math.ceil(max / 4));
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Topics solid, shaky and not started each week"><g class="grid axis">';
    for (let v = 0; v <= max; v += step) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    let lastX = -Infinity;
    data.forEach((d, i) => {
      const cx = L + slot * (i + 0.5);
      if (cx - lastX >= 44 || i === data.length - 1 && cx - lastX >= 30) { lastX = cx; svg += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtDate(d.w, { month: 'numeric', day: 'numeric' }) + '</text>'; }
    });
    svg += '</g>';
    const selW = progSel && progSel.kind === 'week' ? progSel.w : null;
    data.forEach((d, i) => {
      const x0 = L + slot * (i + 0.5) - bw / 2;
      let base = d.total ? 0 : null;
      const dim = selW && selW !== d.w ? ' opacity="0.35"' : '';
      ['solid', 'shaky', 'none'].forEach(k => {
        if (!d[k]) return;
        const y1 = y(base), y2 = y(base + d[k]);
        const hgt = Math.max(1, y1 - y2 - (base > 0 ? 2 : 0));
        svg += '<rect x="' + x0 + '" y="' + y2 + '" width="' + bw + '" height="' + hgt + '" rx="3" fill="var(--st-' + k + ')"' + dim + '/>';
        base += d[k];
      });
    });
    data.forEach((d, i) => { svg += '<rect class="hit" data-i="' + i + '" x="' + (L + slot * i) + '" y="' + T + '" width="' + slot + '" height="' + (H - T - B) + '" fill="transparent" style="cursor:pointer"/>'; });
    el.innerHTML = svg + '</svg><div class="tip hidden"></div>';
    const tip = el.querySelector('.tip');
    const svgEl = el.querySelector('svg');
    svgEl.addEventListener('pointermove', e => {
      const r = e.target.closest('rect.hit');
      if (!r) { tip.classList.add('hidden'); return; }
      const d = data[r.dataset.i];
      const scale = svgEl.getBoundingClientRect().width / W;
      tip.textContent = 'Week of ' + fmtDate(d.w) + ' · ' + d.solid + ' solid · ' + d.shaky + ' shaky · ' + d.none + ' not started';
      const cx = (L + slot * (Number(r.dataset.i) + 0.5)) * scale;
      tip.style.left = Math.min(Math.max(cx, 110), svgEl.getBoundingClientRect().width - 110) + 'px';
      tip.style.top = (y(d.total) * scale) + 'px';
      tip.classList.remove('hidden');
    });
    svgEl.addEventListener('pointerleave', () => tip.classList.add('hidden'));
    svgEl.addEventListener('click', e => {
      const r = e.target.closest('rect.hit');
      if (!r) return;
      const w = data[r.dataset.i].w;
      selectProg(progSel && progSel.kind === 'week' && progSel.w === w ? null : { kind: 'week', w });
    });
  }

  function selectProg(sel) {
    progSel = sel;
    render();
    const d = document.getElementById('progDetail');
    if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- Student link tab ---------- */

  function studentPayload(s) {
    const recs = s.subjects.map(x => suggestPlan(s, { breakMode, subjectId: x.id }))
      .filter(p => p.main).map(p => ({ id: p.main.topic.id, warm: p.warm ? p.warm.topic.id : null }));
    const last = s.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created)[0];
    return {
      v: 1, sid: s.shareId, name: s.name, made: today(), schedule: s.schedule,
      subjects: s.subjects.map(x => ({ id: x.id, name: x.name })),
      groups: orderedGroups(s).map(g => ({ id: g.id, sub: g.subjectId, name: g.name, kind: g.kind })),
      topics: s.topics.map(t => ({ id: t.id, g: t.groupId, name: t.name, details: t.details, s: t.status, d: t.drills || [], c: t.cards || [] })),
      assignments: s.assignments.filter(a => !a.done).map(a => ({ id: a.id, t: a.topicId, title: a.title, link: a.link, due: a.due })),
      last: last ? { date: last.date, items: last.items.map(i => ({ id: i.topicId, name: i.name, s: i.status })) } : null,
      recs
    };
  }

  function studentLink(s) {
    const base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'student.html#d=' + encode(studentPayload(s));
  }

  function rShare(s) {
    const link = studentLink(s);
    const local = location.protocol === 'file:';
    let h = '<div class="card"><h2>' + esc(s.name) + '\'s student link</h2>' +
      '<p class="small muted">This link opens ' + esc(s.name) + '\'s dashboard with only their own topics, status, assigned practice and last-session recap. Your notes, scores and other students are never included.</p>' +
      (local ? '<div class="flag" style="margin-bottom:12px">You opened this page as a file on this device, so this link only works here. Use the GitHub Pages address so it works on ' + esc(s.name) + '\'s phone.</div>' : '') +
      '<div class="row"><button class="btn primary" data-act="copyLink">Copy link</button>' +
      (navigator.share ? '<button class="btn" data-act="shareLink">Share…</button>' : '') +
      '<a class="btn" href="' + esc(link) + '" target="_blank" rel="noopener">Preview</a></div>' +
      '<p class="small muted" style="margin-top:10px">After you log a session or assign practice, send a fresh link so their dashboard stays up to date. Their streak and practice history stay saved on their device.</p></div>';

    h += '<form class="card" id="checkinForm"><h2>Paste a check-in code</h2>' +
      '<p class="small muted">When ' + esc(s.name) + ' practices, they tap "Send to my tutor" and text you a code. Paste it here to bring in their drill results, confidence ratings and finished assignments.</p>' +
      '<textarea id="checkinCode" class="code-box" placeholder="CHECKIN:..."></textarea>' +
      '<button class="btn primary" type="submit" style="margin-top:8px">Import check-in</button></form>';
    return h;
  }

  function importCheckin(text) {
    const m = text.trim().match(/CHECKIN:([A-Za-z0-9_-]+)/);
    if (!m) { toast('That does not look like a check-in code.'); return; }
    let data;
    try { data = decode(m[1]); } catch (e) { toast('That code looks incomplete. Ask for it again.'); return; }
    const s = state.students.find(x => x.shareId === data.sid);
    if (!s) { toast('This code is for a student who is not on this device.'); return; }
    const have = new Set(s.checkins.map(c => c.id));
    let added = 0, marked = 0;
    (data.entries || []).forEach(e => {
      if (have.has(e.id)) return;
      s.checkins.push(e); added++;
      if (e.kind === 'assignment' && e.assignmentId) {
        const a = s.assignments.find(x => x.id === e.assignmentId);
        if (a && !a.done) { a.done = true; a.doneDate = e.date; a.by = 'student'; marked++; }
      }
    });
    persist();
    state.currentId = s.id;
    view = 'practice';
    render();
    toast(added ? 'Imported ' + added + ' new check-in' + (added === 1 ? '' : 's') + (marked ? ', ' + marked + ' assignment' + (marked === 1 ? '' : 's') + ' marked done' : '') + '.' : 'Already up to date.');
  }

  /* ---------- Roster & backup ---------- */

  function rRoster() {
    let h = '<div class="card"><div class="card-head"><h2>Students</h2><button class="btn primary small" data-act="addStudent">+ Add student</button></div>';
    if (!state.students.length) h += '<div class="empty">No students yet.</div>';
    h += '<ul class="list">' + state.students.map(s => {
      const solid = s.topics.filter(t => t.status === 'solid').length;
      return '<li><div class="row"><div class="grow"><b>' + esc(s.name) + '</b>' +
        '<div class="small muted">' + [s.grade ? 'Grade ' + esc(s.grade) : null, esc(s.subjects.map(x => x.name).join(', ')), esc(sessionText(s.schedule))].filter(Boolean).join(' · ') + '</div>' +
        '<div class="small muted">' + solid + ' of ' + s.topics.length + ' topics solid</div></div>' +
        '<button class="btn small" data-act="openStudent" data-id="' + s.id + '">Open</button>' +
        '<button class="btn small link" data-act="editStudent" data-id="' + s.id + '">Edit</button>' +
        '<button class="btn small link danger" data-act="delStudent" data-id="' + s.id + '">Delete</button></div></li>';
    }).join('') + '</ul></div>';
    return h;
  }

  function rBackup() {
    return '<div class="card"><h2>Backup and move to another device</h2>' +
      '<p class="small muted">Your data is saved only in this browser. To use it on another phone or computer, export a backup here and import it there. Exporting now and then also protects you if the browser data gets cleared.</p>' +
      '<div class="row"><button class="btn primary" data-act="exportData">Export backup file</button>' +
      '<label class="btn" style="margin:0;color:var(--text)">Import backup or update file<input type="file" id="importFile" accept="application/json,.json" class="hidden"></label></div>' +
      '<p class="small muted" style="margin:10px 0 0">A backup file replaces everything on this device. An update file only adds new scores, topics and notes to one student and keeps everything else.</p></div>' +
      '<div class="card"><h2>Start over</h2><p class="small muted">Replace everything on this device with the Noah example. Export a backup first if you want to keep your data.</p>' +
      '<button class="btn danger" data-act="resetData">Reset to example data</button></div>';
  }

  /* Update files add to one student without replacing anything:
     { type: 'tutor-dashboard-update', student, grade, notes, scores: [{ date, type, label, score, max, subject }],
       topics: [{ name, details, group, subject }], assignments: [{ topic, title, link, done, doneDate }] } */
  function applyUpdate(u) {
    const s = state.students.find(x => x.name.trim().toLowerCase() === String(u.student || '').trim().toLowerCase());
    if (!s) { toast('No student named ' + (u.student || '?') + ' on this device.'); return; }
    const subj = name => s.subjects.find(x => x.name.toLowerCase() === String(name || '').toLowerCase()) || s.subjects[0];
    const counts = { scores: 0, topics: 0, assignments: 0 };
    if (u.grade && !s.grade) s.grade = u.grade;
    if (u.notes && !(s.notes || '').includes(u.notes)) s.notes = (s.notes ? s.notes + '\n\n' : '') + u.notes;
    (u.scores || []).forEach(x => {
      const sub = subj(x.subject);
      if (s.scores.some(y => y.date === x.date && y.label === x.label && y.type === x.type)) return;
      s.scores.push({ id: uid(), subjectId: sub && sub.id, date: x.date, type: x.type === 'test' ? 'test' : 'homework', label: x.label || '', score: Number(x.score), max: Number(x.max) || 100 });
      counts.scores++;
    });
    (u.topics || []).forEach(x => {
      if (s.topics.some(t => t.name.toLowerCase() === x.name.toLowerCase())) return;
      const sub = subj(x.subject);
      const groups = sub ? groupsOf(s, sub.id) : s.groups;
      const g = groups.find(gr => gr.name.toLowerCase() === String(x.group || '').toLowerCase()) || groups[0];
      if (!g) return;
      s.topics.push({ id: uid(), groupId: g.id, name: x.name, details: x.details || '', status: 'none', lastWorked: null, notes: x.notes || '',
        drills: autoDrills(s, g.id, x.name), cards: [], history: [{ date: today(), status: 'none' }] });
      counts.topics++;
    });
    (u.assignments || []).forEach(x => {
      const t = s.topics.find(tp => tp.name.toLowerCase() === String(x.topic || '').toLowerCase());
      if (!t || s.assignments.some(a => a.title === x.title)) return;
      s.assignments.push({ id: uid(), topicId: t.id, title: x.title, link: x.link || '', due: x.due || null,
        done: !!x.done, doneDate: x.done ? (x.doneDate || today()) : null, by: x.done ? 'tutor' : null, created: today() });
      counts.assignments++;
    });
    persist();
    state.currentId = s.id;
    view = 'scores';
    render();
    const n = counts.scores + counts.topics + counts.assignments;
    toast(n ? 'Added to ' + s.name + ': ' + counts.scores + ' scores, ' + counts.topics + ' topics, ' + counts.assignments + ' assignments.'
      : 'Already added. Nothing new in this file for ' + s.name + '.');
  }

  /* ---------- Dialog forms ---------- */

  const $dlg = document.getElementById('dlg');
  const $dlgForm = document.getElementById('dlgForm');

  // fields: [{ name, label, type, options, full, placeholder }]
  function formDialog(title, fields, values, onSave, onDelete) {
    let h = '<h2>' + esc(title) + '</h2><div class="fields">';
    fields.forEach(f => {
      const v = values[f.name] == null ? '' : values[f.name];
      h += '<div class="field' + (f.full ? ' full' : '') + '"><label for="f_' + f.name + '">' + esc(f.label) + '</label>';
      if (f.type === 'select') {
        h += '<select id="f_' + f.name + '" name="' + f.name + '">' + f.options.map(([ov, ol]) =>
          '<option value="' + esc(ov) + '"' + (String(ov) === String(v) ? ' selected' : '') + '>' + esc(ol) + '</option>').join('') + '</select>';
      } else if (f.type === 'textarea') {
        h += '<textarea id="f_' + f.name + '" name="' + f.name + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(v) + '</textarea>';
      } else if (f.type === 'checks') {
        h += '<div class="stack" id="f_' + f.name + '">' + f.options.map(([ov, ol]) =>
          '<label class="row" style="margin:0;color:var(--text)"><input type="checkbox" name="' + f.name + '" value="' + esc(ov) + '"' + ((v || []).includes(ov) ? ' checked' : '') + '> ' + esc(ol) + '</label>').join('') + '</div>';
      } else {
        h += '<input id="f_' + f.name + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + (f.required ? ' required' : '') + ' placeholder="' + esc(f.placeholder || '') + '">';
      }
      h += '</div>';
    });
    h += '</div><div class="row" style="margin-top:8px">' +
      (onDelete ? '<button type="button" class="btn danger" data-dlg="delete">Delete</button>' : '') +
      '<span class="grow"></span><button type="button" class="btn" data-dlg="cancel">Cancel</button>' +
      '<button type="submit" class="btn primary">Save</button></div>';
    $dlgForm.innerHTML = h;
    $dlgForm.onsubmit = e => {
      e.preventDefault();
      const out = {};
      fields.forEach(f => {
        if (f.type === 'checks') out[f.name] = Array.from($dlgForm.querySelectorAll('input[name="' + f.name + '"]:checked')).map(i => i.value);
        else out[f.name] = $dlgForm.elements[f.name].value.trim();
      });
      if (onSave(out) !== false) { $dlg.close(); persist(); render(); }
    };
    $dlgForm.onclick = e => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'cancel') $dlg.close();
      if (b.dataset.dlg === 'delete' && onDelete() !== false) { $dlg.close(); persist(); render(); }
    };
    $dlg.showModal();
    const first = $dlgForm.querySelector('input,select,textarea');
    if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
  }

  const studentFields = [
    { name: 'name', label: 'First name', required: true },
    { name: 'grade', label: 'Grade', placeholder: 'e.g. 9' },
    { name: 'subjects', label: 'Subjects (separate with commas)', placeholder: 'e.g. Math, Science', newOnly: true },
    { name: 'pronoun', label: "Student's pronoun (for parent updates)", type: 'select', options: [['he', 'He'], ['she', 'She'], ['they', 'They']] },
    { name: 'day', label: 'Weekly session day', type: 'select', options: [['', 'Not set']].concat(DAYS.map((d, i) => [String(i), d])) },
    { name: 'start', label: 'Start time', type: 'time' },
    { name: 'end', label: 'End time', type: 'time' },
    { name: 'notes', label: 'Private notes (never shown to the student)', type: 'textarea', full: true, placeholder: 'Background, grades, goals...' }
  ];

  function editStudent(s) {
    const isNew = !s;
    const v = s ? Object.assign({}, s, { day: s.schedule.day == null ? '' : String(s.schedule.day), start: s.schedule.start, end: s.schedule.end }) : { pronoun: 'they', subjects: 'Math' };
    const fields = isNew ? studentFields : studentFields.filter(f => !f.newOnly);
    formDialog(isNew ? 'Add student' : 'Edit ' + s.name, fields, v, out => {
      if (!out.name) { toast('Add a first name.'); return false; }
      const subjectNames = isNew ? out.subjects.split(',').map(x => x.trim()).filter(Boolean) : [];
      if (isNew && !subjectNames.length) { toast('Add at least one subject.'); return false; }
      const sched = { day: out.day === '' ? null : Number(out.day), start: out.start, end: out.end };
      if (isNew) {
        const subjects = subjectNames.map(name => ({ id: uid(), name, now: '', next: '' }));
        const groups = subjects.flatMap(x => defaultGroups(x.id));
        const ns = { id: uid(), shareId: uid(), name: out.name, grade: out.grade, pronoun: out.pronoun, schedule: sched, notes: out.notes,
          subjects, groups, topics: [], sessions: [], assignments: [], scores: [], checkins: [] };
        state.students.push(ns);
        state.currentId = ns.id;
        view = 'tracker';
        toast(out.name + ' added. Now add their topics.');
      } else {
        Object.assign(s, { name: out.name, grade: out.grade, pronoun: out.pronoun, schedule: sched, notes: out.notes });
      }
    }, isNew ? null : () => delStudent(s));
  }

  function editSubject(s, sub) {
    const isNew = !sub;
    const fields = [
      { name: 'name', label: 'Subject', full: true, required: true, placeholder: 'e.g. Science' },
      { name: 'now', label: 'Class now', placeholder: 'e.g. Biology' },
      { name: 'next', label: 'Next year', placeholder: 'e.g. Chemistry' }
    ];
    formDialog(isNew ? 'Add subject' : 'Edit ' + sub.name, fields, sub || {}, out => {
      if (!out.name) { toast('Add a subject name.'); return false; }
      if (isNew) {
        const ns = { id: uid(), name: out.name, now: out.now, next: out.next };
        s.subjects.push(ns);
        s.groups.push(...defaultGroups(ns.id));
        toast(out.name + ' added with Groups A, B and C. Rename or delete them as you like.');
      } else Object.assign(sub, out);
    }, isNew ? null : () => {
      const gids = groupsOf(s, sub.id).map(g => g.id);
      const n = s.topics.filter(t => gids.includes(t.groupId)).length;
      if (!confirm('Delete ' + sub.name + (n ? ' and its ' + n + ' topic' + (n === 1 ? '' : 's') : '') + '?')) return false;
      s.subjects = s.subjects.filter(x => x !== sub);
      s.groups = s.groups.filter(g => !gids.includes(g.id));
      s.topics = s.topics.filter(t => !gids.includes(t.groupId));
      s.scores = s.scores.filter(x => x.subjectId !== sub.id);
    });
  }

  function delStudent(s) {
    if (!confirm('Delete ' + s.name + ' and all their data? This cannot be undone.')) return false;
    state.students = state.students.filter(x => x !== s);
    if (state.currentId === s.id) state.currentId = state.students[0] ? state.students[0].id : null;
    view = state.students.length ? view : 'roster';
    persist(); render();
  }

  function editTopic(s, t, groupId) {
    const isNew = !t;
    const fields = [
      { name: 'name', label: 'Topic', full: true, required: true },
      { name: 'details', label: 'Details', full: true, placeholder: 'What this covers' },
      { name: 'groupId', label: 'Group', type: 'select', options: orderedGroups(s).map(g => [g.id, groupLabel(s, g)]) },
      { name: 'lastWorked', label: 'Last worked on', type: 'date' },
      { name: 'notes', label: 'Notes (private)', type: 'textarea', full: true },
      { name: 'cards', label: 'Practice questions for the student, one per line: question | answer', type: 'textarea', full: true,
        placeholder: 'What part of the cell makes energy? | Mitochondria\nWhat does DNA stand for? | Deoxyribonucleic acid' },
      { name: 'drills', label: 'Built-in math drills', type: 'checks', full: true, options: Object.keys(DRILLS).map(k => [k, DRILLS[k].name]) }
    ];
    const v = t ? Object.assign({}, t, { cards: (t.cards || []).map(c => c.q + ' | ' + c.a).join('\n') }) : { groupId, drills: [] };
    formDialog(isNew ? 'Add topic' : 'Edit topic', fields, v, out => {
      if (!out.name) { toast('Add a topic name.'); return false; }
      if (isNew) {
        s.topics.push({ id: uid(), groupId: out.groupId, name: out.name, details: out.details, status: 'none', lastWorked: out.lastWorked || null,
          notes: out.notes, drills: out.drills.length ? out.drills : autoDrills(s, out.groupId, out.name), cards: parseCards(out.cards),
          history: [{ date: today(), status: 'none' }] });
      } else {
        Object.assign(t, { name: out.name, details: out.details, groupId: out.groupId, lastWorked: out.lastWorked || null, notes: out.notes,
          drills: out.drills, cards: parseCards(out.cards) });
      }
    }, isNew ? null : () => {
      if (!confirm('Delete "' + t.name + '"? Its history goes with it.')) return false;
      s.topics = s.topics.filter(x => x !== t);
    });
  }

  function editGroup(s, g, subjectId) {
    const isNew = !g;
    const fields = [
      { name: 'name', label: 'Group name', full: true, required: true },
      { name: 'kind', label: 'What it is for', type: 'select', full: true, options: Object.entries(GROUP_KINDS) },
      { name: 'subjectId', label: 'Subject', type: 'select', full: true, options: s.subjects.map(x => [x.id, x.name]) }
    ];
    formDialog(isNew ? 'Add group' : 'Edit group', fields, g || { kind: 'other', subjectId }, out => {
      if (!out.name) { toast('Add a group name.'); return false; }
      if (isNew) s.groups.push({ id: uid(), subjectId: out.subjectId, name: out.name, kind: out.kind });
      else Object.assign(g, out);
    }, isNew ? null : () => {
      const n = s.topics.filter(t => t.groupId === g.id).length;
      if (!confirm('Delete ' + g.name + (n ? ' and its ' + n + ' topic' + (n === 1 ? '' : 's') : '') + '?')) return false;
      s.groups = s.groups.filter(x => x !== g);
      s.topics = s.topics.filter(t => t.groupId !== g.id);
    });
  }

  /* ---------- Events ---------- */

  const actions = {
    tab: el => { view = el.dataset.tab; progSel = null; render(); window.scrollTo(0, 0); },
    goRoster: () => { view = 'roster'; render(); },
    goBackup: () => { view = 'backup'; render(); },
    openStudent: el => { state.currentId = el.dataset.id; view = 'tracker'; persist(); render(); },
    addStudent: () => editStudent(null),
    editStudent: el => editStudent(state.students.find(s => s.id === el.dataset.id)),
    delStudent: el => delStudent(state.students.find(s => s.id === el.dataset.id)),
    addTopic: (el, s) => editTopic(s, null, el.dataset.group),
    editTopic: (el, s) => editTopic(s, topicById(s, el.dataset.id)),
    addGroup: (el, s) => editGroup(s, null, el.dataset.subject),
    addSubject: (el, s) => editSubject(s, null),
    editSubject: (el, s) => editSubject(s, subjectById(s, el.dataset.id)),
    filter: el => { subjectFilter = el.dataset.id; progSel = null; render(); },
    progRange: el => { progRange = Number(el.dataset.n); render(); },
    progWeek: el => selectProg(progSel && progSel.kind === 'week' && progSel.w === el.dataset.w ? null : { kind: 'week', w: el.dataset.w }),
    progTopic: el => selectProg({ kind: 'topic', id: el.dataset.id }),
    progCell: el => selectProg({ kind: 'cell', id: el.dataset.id, w: el.dataset.w }),
    progClose: () => { progSel = null; render(); },
    editGroup: (el, s) => editGroup(s, groupById(s, el.dataset.id)),
    topicStatus: (el, s) => {
      const t = topicById(s, el.dataset.id);
      if (t.status === el.dataset.s) return;
      setStatus(t, el.dataset.s, today());
      persist(); render();
    },
    pickSeg: el => {
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    },
    addGapRow: (el, s) => {
      document.getElementById('gapRows').insertAdjacentHTML('beforeend', gapRow(s));
      const rows = document.querySelectorAll('.gap-name');
      rows[rows.length - 1].focus();
    },
    removeRow: el => el.closest('.gap-row').remove(),
    showParent: el => { lastLoggedId = el.dataset.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    copyParent: () => copyText(document.getElementById('parentMsg').value),
    delSession: (el, s) => {
      if (!confirm('Delete this session log? Topic statuses stay as they are now.')) return;
      s.sessions = s.sessions.filter(x => x.id !== el.dataset.id);
      persist(); render();
    },
    breakMode: el => { breakMode = el.checked; render(); },
    toggleAssign: (el, s) => {
      const a = s.assignments.find(x => x.id === el.dataset.id);
      a.done = el.checked; a.doneDate = a.done ? today() : null; a.by = a.done ? 'tutor' : null;
      persist(); render(); if (a.done) toast('Nice. Marked complete.');
    },
    delAssign: (el, s) => {
      if (!confirm('Delete this assignment?')) return;
      s.assignments = s.assignments.filter(x => x.id !== el.dataset.id); persist(); render();
    },
    delScore: (el, s) => {
      if (!confirm('Delete this score?')) return;
      s.scores = s.scores.filter(x => x.id !== el.dataset.id); persist(); render();
    },
    copyLink: (el, s) => copyText(studentLink(s)),
    shareLink: (el, s) => navigator.share({ title: s.name + '\'s practice dashboard', url: studentLink(s) }).catch(() => {}),
    exportData: () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tutor-dashboard-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    resetData: () => {
      if (!confirm('Replace everything on this device with the example data?')) return;
      state = seed(); persist(); view = 'tracker'; render(); toast('Reset to example data.');
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, cur());
  });

  document.addEventListener('change', e => {
    if (e.target.classList.contains('log-check')) {
      e.target.closest('.log-row').querySelector('.log-seg').classList.toggle('hidden', !e.target.checked);
    }
    if (e.target.id === 'importFile') {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(txt => {
        const data = JSON.parse(txt);
        if (data && data.type === 'tutor-dashboard-update') { applyUpdate(data); return; }
        if (!data || !Array.isArray(data.students)) throw new Error('bad');
        if (!confirm('Replace the data on this device with this backup (' + data.students.length + ' student' + (data.students.length === 1 ? '' : 's') + ')?')) return;
        state = migrate(data); persist(); view = 'tracker'; render(); toast('Backup imported.');
      }).catch(() => toast('That file is not a Tutor Dashboard backup.'));
    }
  });

  // Grid squares act like buttons for keyboard users.
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('td[data-act]')) { e.preventDefault(); e.target.click(); }
  });

  $picker.addEventListener('change', () => {
    state.currentId = $picker.value;
    progSel = null;
    if (['roster', 'backup'].includes(view)) view = 'tracker';
    persist(); render();
  });

  document.addEventListener('submit', e => {
    const s = cur();
    if (e.target.id === 'logForm') { e.preventDefault(); saveLog(s); }
    if (e.target.id === 'assignForm') {
      e.preventDefault();
      const title = document.getElementById('aTitle').value.trim();
      if (!title || !s.topics.length) { toast(s.topics.length ? 'Say what to practice.' : 'Add a topic first.'); return; }
      let link = document.getElementById('aLink').value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      s.assignments.push({ id: uid(), topicId: document.getElementById('aTopic').value, title, link,
        due: document.getElementById('aDue').value || null, done: false, doneDate: null, created: today() });
      persist(); render(); toast('Assigned. Send a fresh student link so it shows up.');
    }
    if (e.target.id === 'scoreForm') {
      e.preventDefault();
      const score = parseFloat(document.getElementById('sScore').value);
      const max = parseFloat(document.getElementById('sMax').value);
      if (isNaN(score) || !(max > 0)) { toast('Enter a score and what it was out of.'); return; }
      const subj = document.getElementById('sSubject');
      s.scores.push({ id: uid(), subjectId: subj ? subj.value : (s.subjects[0] || {}).id, date: document.getElementById('sDate').value || today(), type: document.getElementById('sType').value,
        label: document.getElementById('sLabel').value.trim(), score, max });
      persist(); render(); toast('Score added.');
    }
    if (e.target.id === 'checkinForm') { e.preventDefault(); importCheckin(document.getElementById('checkinCode').value); }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (view === 'scores') drawScoreChart(cur()); if (view === 'progress') drawMastery(cur()); }, 150);
  });

  persist();
  render();
})();
