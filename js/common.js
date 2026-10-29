/* Shared helpers for the tutor and student pages. */
(function () {
  'use strict';

  const STATUSES = [
    { key: 'none', label: 'Not started', word: 'not started', value: 0 },
    { key: 'shaky', label: 'Shaky', word: 'shaky', value: 1 },
    { key: 'solid', label: 'Solid', word: 'solid', value: 2 }
  ];
  const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s]));

  const GROUP_KINDS = {
    school: 'Pairs with school now',
    fluency: 'Quick fluency (5-10 min)',
    break: 'Bigger blocks for school breaks',
    other: 'Other'
  };

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const DRILLS = {
    fractions: { name: 'Fractions', blurb: 'Add, subtract, multiply, divide', words: ['fraction'] },
    negatives: { name: 'Negative numbers', blurb: 'Adding and subtracting negatives', words: ['negative'] },
    exponents: { name: 'Exponents', blurb: 'Powers and exponent rules', words: ['exponent', 'power'] },
    integers: { name: 'Integer operations', blurb: 'Multiply, divide, order of operations', words: ['integer'] }
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Dates are stored as local "YYYY-MM-DD" strings.
  function today() { return toISO(new Date()); }
  function toISO(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function daysSince(iso) {
    if (!iso) return null;
    return Math.round((parseISO(today()) - parseISO(iso)) / 86400000);
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    return parseISO(iso).toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
  }
  function fmtTime(hhmm) {
    if (!hhmm) return '';
    let [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ap;
  }
  function weekStart(iso) {
    const d = parseISO(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return toISO(d);
  }

  function sessionText(st) {
    if (!st || st.day == null || st.day === '') return 'No weekly time set';
    let t = DAYS[st.day] + 's';
    if (st.start) t += ', ' + fmtTime(st.start) + (st.end ? '-' + fmtTime(st.end) : '');
    return t;
  }

  // Next occurrence of the weekly session, as { iso, label }.
  function nextSession(st) {
    if (!st || st.day == null || st.day === '') return null;
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let add = (Number(st.day) - d.getDay() + 7) % 7;
    if (add === 0 && st.end) {
      const [h, m] = st.end.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) add = 7;
    }
    d.setDate(d.getDate() + add);
    const iso = toISO(d);
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) +
      (st.start ? ' at ' + fmtTime(st.start) : '');
    return { iso, label };
  }

  function guessDrills(name) {
    const n = (name || '').toLowerCase();
    return Object.keys(DRILLS).filter(k => DRILLS[k].words.some(w => n.includes(w)));
  }

  /* Planner: rank topics by shakiness, time since last worked, and school match. */
  function planTopics(student, opts) {
    opts = opts || {};
    const kindOf = {};
    student.groups.forEach(g => { kindOf[g.id] = g.kind; });
    const latestConf = {};
    (student.checkins || []).forEach(c => {
      if (!c.topicId || !c.confidence) return;
      if (!latestConf[c.topicId] || latestConf[c.topicId].date <= c.date) latestConf[c.topicId] = c;
    });

    return student.topics.map(t => {
      const reasons = [];
      let score = 0;
      if (t.status === 'shaky') { score += 3; reasons.push('Shaky'); }
      else if (t.status === 'none') { score += 2; reasons.push('Not started'); }
      else { score += 0.5; }

      const ds = daysSince(t.lastWorked);
      if (ds == null) { score += 3; reasons.push('Never worked on'); }
      else {
        score += Math.min(ds / 7, 4);
        if (ds >= 14) reasons.push('Not touched in ' + Math.round(ds / 7) + ' weeks');
        else if (ds >= 7) reasons.push('Not touched in a week');
      }

      const kind = kindOf[t.groupId];
      if (kind === 'school') { score += 2; reasons.push('Matches school now'); }
      if (kind === 'fluency') { score += 0.5; }
      if (kind === 'break') {
        if (opts.breakMode) { score += 2; reasons.push('Good for the break'); }
        else score -= 2.5;
      }
      const c = latestConf[t.id];
      if (c && c.confidence <= 2) { score += 1; reasons.push('Low confidence (' + c.confidence + '/5)'); }

      return { topic: t, kind, score, reasons };
    }).sort((a, b) => b.score - a.score);
  }

  // Short plan: a main block, plus a fluency warm-up.
  function suggestPlan(student, opts) {
    const ranked = planTopics(student, opts);
    const main = ranked.find(r => r.kind !== 'fluency' && r.topic.status !== 'solid') ||
      ranked.find(r => r.kind !== 'fluency') || ranked[0];
    const warm = ranked.find(r => r.kind === 'fluency' && r !== main);
    return { ranked, main, warm };
  }

  /* URL-safe base64 for UTF-8 JSON. */
  function encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(str) {
    str = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function load(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('Could not save. Your browser may be blocking storage.'); return false; }
  }

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); return; }
    catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed. Select the text and copy it.'); }
    ta.remove();
  }

  function statusPill(key) {
    const s = STATUS[key] || STATUS.none;
    return '<span class="pill ' + s.key + '"><span class="dot"></span>' + s.label + '</span>';
  }

  // Practice streak from a list of ISO dates: current run (ending today or yesterday) and best run.
  function streak(dates) {
    const days = Array.from(new Set(dates)).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(d => {
      run = prev && Math.round((parseISO(d) - parseISO(prev)) / 86400000) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    });
    const last = days[days.length - 1];
    const current = last && daysSince(last) <= 1 ? run : 0;
    return { current, best, days: days.length };
  }

  window.TD = {
    STATUSES, STATUS, GROUP_KINDS, DAYS, DRILLS, streak,
    uid, esc, today, toISO, parseISO, daysSince, fmtDate, fmtTime, weekStart,
    sessionText, nextSession, guessDrills, planTopics, suggestPlan,
    encode, decode, load, save, toast, copyText, statusPill
  };
})();
