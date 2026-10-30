'use strict';

/* SCU — séances, exercices, séries, charges.
   Tout est stocké sur l'appareil (localStorage). Aucune dépendance. */

const KEY = 'scu.v1';
const TIMER_KEY = 'scu.timer';
const STEP = 15;                 // pas du minuteur, en secondes
const REST_MAX = 600;
const OVERTIME = 10 * 60 * 1000; // le dépassement s'affiche 10 min au plus

const SEED = [
  'Squat', 'Soulevé de terre', 'Développé couché', 'Développé incliné', 'Développé militaire',
  'Rowing barre', 'Tractions', 'Tirage vertical', 'Dips', 'Presse à cuisses', 'Fentes',
  'Hip thrust', 'Leg curl', 'Leg extension', 'Élévations latérales', 'Curl biceps',
  'Extension triceps', 'Mollets',
];

const I = {
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L9.7 5.5a.8.8 0 0 0-1.2.7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

/* ---------- Utilitaires ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const fmt = n => (n == null ? '' : String(n).replace('.', ','));
const parseNum = str => { const t = str.trim().replace(',', '.'); return t ? num(parseFloat(t)) : null; };
const logged = st => st.r != null; // une série compte dès qu'elle a des répétitions
const clampRest = v => (Number(v) > 0 ? Math.min(REST_MAX, Math.max(STEP, Math.round(v / STEP) * STEP)) : 90);

const thisYear = () => new Date().getFullYear();
const dfMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const dfWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const dfLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dfLongY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dfShortY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = s => { const d = parseISO(s); return cap((d.getFullYear() === thisYear() ? dfLong : dfLongY).format(d)); };
const shortDate = s => { const d = parseISO(s); return (d.getFullYear() === thisYear() ? dfShort : dfShortY).format(d); };

function fmtSet(st) {
  if (!st.w) return st.r == null ? '–' : `${st.r} rép.`;
  return `${fmt(st.w)}×${st.r ?? '–'}`;
}
function fmtRecord(st) {
  if (!st.w) return `${st.r ?? 0} rép.`;
  return `${fmt(st.w)} kg × ${st.r ?? '–'}`;
}
const heavier = (a, b) => (a.w ?? 0) > (b.w ?? 0) || ((a.w ?? 0) === (b.w ?? 0) && (a.r ?? 0) > (b.r ?? 0));
const topSet = sets => sets.reduce((best, st) => (heavier(st, best) ? st : best));

/* ---------- Données ---------- */

let db = load();
let saveTimer = 0;

function blank() {
  return { version: 1, exercises: SEED.map(name => ({ id: uid(), name })), sessions: [], settings: { rest: 90 } };
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return blank(); }
  if (!raw) return blank();
  try {
    return normalize(JSON.parse(raw));
  } catch (err) {
    // Ne jamais écraser des données illisibles : on les met de côté.
    try { localStorage.setItem(`${KEY}.illisible.${Date.now()}`, raw); } catch {}
    console.error(err);
    return blank();
  }
}

function normalize(d) {
  if (!d || !Array.isArray(d.exercises) || !Array.isArray(d.sessions)) throw new Error('Format inconnu');
  const exercises = d.exercises
    .filter(e => e && e.id != null && typeof e.name === 'string')
    .map(e => ({ id: String(e.id), name: e.name }));
  const ids = new Set(exercises.map(e => e.id));
  const sessions = d.sessions.filter(s => s && s.id != null).map(s => ({
    id: String(s.id),
    date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today(),
    createdAt: Number(s.createdAt) || 0,
    name: typeof s.name === 'string' ? s.name : '',
    entries: (Array.isArray(s.entries) ? s.entries : [])
      .filter(en => en && ids.has(String(en.exerciseId)))
      .map(en => ({
        id: String(en.id ?? uid()),
        exerciseId: String(en.exerciseId),
        sets: (Array.isArray(en.sets) ? en.sets : []).map(st => ({
          w: num(st && st.w),
          r: num(st && st.r),
          done: !!(st && st.done),
        })),
      })),
  }));
  return { version: 1, exercises, sessions, settings: { rest: clampRest(d.settings && d.settings.rest) } };
}

function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (err) { console.error(err); }
}

const exById = id => db.exercises.find(e => e.id === id);
const exName = id => (exById(id) || { name: '?' }).name;
const order = s => `${s.date}|${String(s.createdAt).padStart(15, '0')}`;
const sortedSessions = () => [...db.sessions].sort((a, b) => cmp(order(b), order(a)));
const blankSets = n => Array.from({ length: n }, () => ({ w: null, r: null, done: false }));

function newSession() {
  return { id: uid(), date: today(), createdAt: Date.now(), name: '', entries: [] };
}

// Les séances ouvertes puis laissées vides disparaissent d'elles-mêmes.
function prune() {
  const n = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.entries.length || s.name.trim());
  if (db.sessions.length !== n) save();
}

// Séries enregistrées la dernière fois pour cet exercice, avant la séance donnée.
function previousSets(exId, session) {
  const limit = order(session);
  let best = null;
  let bestKey = '';
  for (const s of db.sessions) {
    const k = order(s);
    if (s === session || k >= limit || k <= bestKey) continue;
    const sets = s.entries.filter(en => en.exerciseId === exId).flatMap(en => en.sets.filter(logged));
    if (sets.length) { best = sets; bestKey = k; }
  }
  return best || [];
}

// Valeurs proposées pour chaque série : celles de la dernière fois,
// ou celles de la série précédente dès qu'on s'en écarte.
function suggestions(session, entry) {
  const hist = previousSets(entry.exerciseId, session);
  const out = [];
  let prev = null;
  let prevHist = null;
  entry.sets.forEach((st, i) => {
    const h = hist[i] || null;
    const sug = { w: null, r: null };
    for (const f of ['w', 'r']) {
      if (h && h[f] != null && (!prev || (prevHist && prev[f] === prevHist[f]))) sug[f] = h[f];
      else if (prev) sug[f] = prev[f];
    }
    out.push(sug);
    prev = { w: st.w ?? sug.w, r: st.r ?? sug.r };
    prevHist = h;
  });
  return out;
}

function addEntry(session, exId) {
  const n = Math.max(1, previousSets(exId, session).length);
  const en = { id: uid(), exerciseId: exId, sets: blankSets(n) };
  session.entries.push(en);
  return en;
}

function createExercise(name) {
  name = cap(name.trim().replace(/\s+/g, ' '));
  const found = db.exercises.find(e => fold(e.name) === fold(name));
  if (found) return found;
  const ex = { id: uid(), name };
  db.exercises.push(ex);
  return ex;
}

/* ---------- Navigation ---------- */

let cur = { view: 'sessions' };
let navStack = [];
let replacing = false;
let pendingScroll = null;
const scrollMem = {};

const go = path => { location.hash = '#' + path; };
const replace = path => { replacing = true; location.replace('#' + path); };
const back = parent => (navStack.length > 1 ? history.back() : replace(parent));

window.addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  scrollMem[navStack[navStack.length - 1]] = scrollY;
  let restore = false;
  if (replacing) { navStack[navStack.length - 1] = h; replacing = false; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === h) { navStack.pop(); restore = true; }
  else navStack.push(h);
  closeSheet();
  route();
  scrollTo(0, restore ? scrollMem[h] || 0 : 0);
  if (pendingScroll) {
    const el = $(`[data-entry="${pendingScroll}"]`);
    pendingScroll = null;
    if (el) el.scrollIntoView({ block: 'center' });
  }
});

function route() {
  const [a, b, c] = location.hash.slice(2).split('/');
  let s, ex;
  if (a === 's' && (s = db.sessions.find(x => x.id === b))) c === 'ajout' ? renderPicker(s) : renderSession(s);
  else if (a === 'e' && (ex = exById(b))) renderExercise(ex);
  else if (a === 'exercices') renderExercises();
  else renderSessions();
  paintTimer();
}

function backBtn(parent) {
  const prev = navStack.length > 1 ? navStack[navStack.length - 2] : '#' + parent;
  const label = prev.startsWith('#/s/') ? 'Séance'
    : prev === '#/exercices' ? 'Exercices'
    : prev.startsWith('#/e/') ? 'Exercice'
    : 'Séances';
  return `<button class="back" data-act="back" data-parent="${esc(parent)}">${I.back}<span>${label}</span></button>`;
}

const tabs = active => `<header class="top">
  <nav class="tabs">
    <button data-act="tab" data-to="/"${active === 's' ? ' class="on" aria-current="page"' : ''}>Séances</button>
    <button data-act="tab" data-to="/exercices"${active === 'e' ? ' class="on" aria-current="page"' : ''}>Exercices</button>
  </nav>
  <button class="icon" data-act="app-menu" aria-label="Données">${I.more}</button>
</header>`;

/* ---------- Écrans ---------- */

function renderSessions() {
  prune();
  cur = { view: 'sessions' };
  let html = tabs('s') + `<button class="btn solid" data-act="new-session">${I.plus}<span>Nouvelle séance</span></button>`;
  const list = sortedSessions();
  if (!list.length) html += '<p class="empty">Aucune séance.</p>';
  let month = '';
  for (const s of list) {
    const d = parseISO(s.date);
    const m = dfMonth.format(d);
    if (m !== month) { html += `<h2 class="label month">${esc(m)}</h2>`; month = m; }
    const names = s.entries.map(en => exName(en.exerciseId)).join(' · ');
    html += `<a class="srow" href="#/s/${s.id}">
      <div class="sdate"><span class="dnum">${d.getDate()}</span><span class="dwd">${esc(dfWeekday.format(d).replace('.', ''))}</span></div>
      <div class="sbody"><div class="sname">${esc(s.name.trim() || 'Séance')}</div><div class="ssub">${esc(names || '—')}</div></div>
    </a>`;
  }
  app.innerHTML = html;
}

function renderSession(s) {
  cur = { view: 'session', session: s };
  app.innerHTML = `
    <header class="top">${backBtn('/')}<button class="icon" data-act="session-menu" aria-label="Options de la séance">${I.more}</button></header>
    <div class="head">
      <input class="title" data-field="name" value="${esc(s.name)}" placeholder="Séance" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="Nom de la séance">
      <label class="date"><span class="date-text">${esc(longDate(s.date))}</span><input type="date" data-field="date" value="${s.date}" aria-label="Date de la séance"></label>
    </div>
    <div class="entries">${s.entries.map(en => entryHTML(s, en)).join('')}</div>
    <button class="btn line add-ex" data-act="add-exercise">${I.plus}<span>Exercice</span></button>`;
}

function entryHTML(s, en) {
  const ex = exById(en.exerciseId) || { id: en.exerciseId, name: '?' };
  const sug = suggestions(s, en);
  const rows = en.sets.map((st, i) => `
    <div class="grid set${st.done ? ' done' : ''}" data-i="${i}">
      <span class="idx">${i + 1}</span>
      <input class="num" data-field="w" inputmode="decimal" autocomplete="off" value="${fmt(st.w)}" placeholder="${fmt(sug[i].w)}" aria-label="Charge, série ${i + 1}">
      <input class="num" data-field="r" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${fmt(st.r)}" placeholder="${fmt(sug[i].r)}" aria-label="Répétitions, série ${i + 1}">
      <button class="check" data-act="toggle-set" aria-label="Série ${i + 1} faite" aria-pressed="${st.done}">${I.check}</button>
    </div>`).join('');
  return `<section class="entry" data-entry="${en.id}">
    <div class="ehead">
      <a class="ename" href="#/e/${ex.id}">${esc(ex.name)}</a>
      <button class="icon" data-act="entry-menu" aria-label="Options de l'exercice">${I.more}</button>
    </div>
    ${en.sets.length ? '<div class="grid sethead label"><span>#</span><span>kg</span><span>rép.</span><span></span></div>' : ''}
    ${rows}
    <button class="addset" data-act="add-set">${I.plus}<span>Série</span></button>
  </section>`;
}

function repaintEntry(en) {
  const el = $(`[data-entry="${en.id}"]`);
  if (el) el.outerHTML = entryHTML(cur.session, en);
}

function refreshPlaceholders(el, en) {
  const sug = suggestions(cur.session, en);
  el.querySelectorAll('.set').forEach((row, i) => {
    row.querySelector('[data-field="w"]').placeholder = fmt(sug[i].w);
    row.querySelector('[data-field="r"]').placeholder = fmt(sug[i].r);
  });
}

function setOf(el) {
  const sec = el.closest('.entry');
  const en = cur.session.entries.find(x => x.id === sec.dataset.entry);
  return { sec, en, i: Number(el.closest('.set').dataset.i) };
}

function renderPicker(s) {
  cur = { view: 'picker', session: s };
  app.innerHTML = `
    <header class="top col">
      <div>${backBtn('/s/' + s.id)}</div>
      <input class="search" type="search" data-field="q" placeholder="Rechercher ou créer" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="Exercice">
    </header>
    <div class="list" id="pick"></div>`;
  paintPicker('');
}

function lastUsed() {
  const m = new Map();
  for (const s of db.sessions) {
    const k = order(s);
    for (const en of s.entries) if (k > (m.get(en.exerciseId) || '')) m.set(en.exerciseId, k);
  }
  return m;
}

function paintPicker(q) {
  const used = lastUsed();
  const inSession = new Set(cur.session.entries.map(en => en.exerciseId));
  const fq = fold(q);
  const list = db.exercises
    .filter(ex => !fq || fold(ex.name).includes(fq))
    .sort((a, b) => cmp(used.get(b.id) || '', used.get(a.id) || '') || a.name.localeCompare(b.name, 'fr'));
  let html = '';
  if (fq && !db.exercises.some(ex => fold(ex.name) === fq)) {
    html += `<button class="row create" data-act="pick-new">${I.plus}<span>Créer « ${esc(q.trim())} »</span></button>`;
  }
  html += list.map(ex => `<button class="row" data-act="pick" data-id="${ex.id}">
    <span class="row-name">${esc(ex.name)}</span>${inSession.has(ex.id) ? '<span class="meta">Dans la séance</span>' : ''}
  </button>`).join('');
  $('#pick').innerHTML = html || '<p class="empty">Aucun exercice.</p>';
}

function pickExercise(ex) {
  const en = addEntry(cur.session, ex.id);
  save();
  pendingScroll = en.id;
  back('/s/' + cur.session.id);
}

function renderExercises() {
  prune();
  cur = { view: 'exercises' };
  const last = new Map();
  for (const s of [...db.sessions].sort((a, b) => cmp(order(a), order(b)))) {
    for (const en of s.entries) {
      const sets = en.sets.filter(logged);
      if (sets.length) last.set(en.exerciseId, topSet(sets));
    }
  }
  const list = [...db.exercises].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  app.innerHTML = tabs('e')
    + `<button class="btn line" data-act="new-exercise">${I.plus}<span>Nouvel exercice</span></button>`
    + '<div class="list">'
    + list.map(ex => `<a class="row" href="#/e/${ex.id}">
        <span class="row-name">${esc(ex.name)}</span>
        <span class="meta">${last.has(ex.id) ? esc(fmtSet(last.get(ex.id))) : ''}</span>
      </a>`).join('')
    + '</div>'
    + (list.length ? '' : '<p class="empty">Aucun exercice.</p>');
}

function renderExercise(ex) {
  cur = { view: 'exercise', exercise: ex };
  let best = null;
  const rows = [];
  for (const s of sortedSessions()) {
    const sets = s.entries.filter(en => en.exerciseId === ex.id).flatMap(en => en.sets.filter(logged));
    if (!sets.length) continue;
    const t = topSet(sets);
    if (!best || heavier(t, best)) best = t;
    rows.push(`<a class="hrow" href="#/s/${s.id}">
      <span class="hdate">${esc(shortDate(s.date))}</span>
      <span class="hsets">${sets.map(st => `<span>${esc(fmtSet(st))}</span>`).join('')}</span>
    </a>`);
  }
  app.innerHTML = `
    <header class="top">${backBtn('/exercices')}<button class="icon" data-act="exercise-menu" aria-label="Options de l'exercice">${I.more}</button></header>
    <h1 class="title">${esc(ex.name)}</h1>
    ${rows.length ? `<div class="stats">
      <div><div class="label">Record</div><div class="stat">${esc(fmtRecord(best))}</div></div>
      <div><div class="label">Séances</div><div class="stat">${rows.length}</div></div>
    </div>${rows.join('')}` : '<p class="empty">Pas encore de séries.</p>'}`;
}

/* ---------- Feuilles d'action ---------- */

let sheetState = null;

function sheet(opts) {
  sheetState = opts;
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-wrap">
    <div class="backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      ${opts.title ? `<p class="sheet-title">${esc(opts.title)}</p>` : ''}
      ${opts.input ? `<input class="sheet-input" value="${esc(opts.input.value || '')}" placeholder="${esc(opts.input.placeholder || '')}" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">` : ''}
      ${(opts.actions || []).map((a, i) => `<button class="sheet-btn${a.danger ? ' danger' : ''}" data-act="sheet-do" data-i="${i}">${esc(a.label)}</button>`).join('')}
      <button class="sheet-btn cancel" data-act="sheet-close">${esc(opts.cancel || 'Annuler')}</button>
    </div>
  </div>`;
  const wrap = root.firstElementChild;
  if (opts.input) {
    wrap.classList.add('open');
    const input = $('.sheet-input', root);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  }
}

function closeSheet() {
  const wrap = $('#sheet .sheet-wrap');
  sheetState = null;
  if (!wrap) return;
  document.activeElement?.blur();
  wrap.classList.remove('open');
  setTimeout(() => wrap.remove(), 260);
}

function runSheetAction(i) {
  const st = sheetState;
  if (!st) return;
  const a = st.actions[i];
  const value = $('#sheet .sheet-input')?.value ?? '';
  if (a.confirm) {
    sheet({ title: a.confirm, actions: [{ label: a.confirmLabel || a.label, danger: true, run: a.run }] });
    return;
  }
  closeSheet();
  a.run(value);
}

/* ---------- Minuteur ---------- */

const timerEl = $('#timer');
const tTime = $('#ttime');
const tGo = $('#tgo');
const tProg = $('.tprog');
let actx = null;
let wakeLock = null;

const timer = {
  endAt: 0,
  dur: 0,
  alerted: false,
  iv: 0,
  running() { return this.endAt > 0; },
  remaining() { return this.endAt - Date.now(); },
  start(sec) {
    unlockAudio();
    this.dur = sec;
    this.endAt = Date.now() + sec * 1000;
    this.alerted = false;
    this.persist();
    keepAwake(true);
    this.loop();
  },
  stop() {
    this.endAt = 0;
    clearInterval(this.iv);
    this.iv = 0;
    this.persist();
    keepAwake(false);
    paintTimer();
  },
  loop() {
    if (!this.iv) this.iv = setInterval(() => this.tick(), 250);
    this.tick();
  },
  tick() {
    if (!this.running()) return;
    const rem = this.remaining();
    if (rem <= 0 && !this.alerted) {
      this.alerted = true;
      if (rem > -5000) alarm();
      keepAwake(false);
    }
    if (rem < -OVERTIME) return this.stop();
    paintTimer();
  },
  adjust(delta) {
    if (this.running() && this.remaining() > 0) {
      this.endAt += delta * 1000;
      this.dur = Math.max(1, this.dur + delta);
      if (this.remaining() <= 0) return this.stop();
      this.persist();
      paintTimer();
    } else {
      if (this.running()) this.stop();
      db.settings.rest = Math.min(REST_MAX, Math.max(STEP, db.settings.rest + delta));
      save();
      paintTimer();
    }
  },
  persist() {
    try { localStorage.setItem(TIMER_KEY, JSON.stringify({ endAt: this.endAt, dur: this.dur })); } catch {}
  },
  restore() {
    try {
      const t = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
      if (t && t.endAt && Date.now() - t.endAt < OVERTIME) {
        this.endAt = t.endAt;
        this.dur = t.dur || 1;
        this.alerted = t.endAt <= Date.now();
        if (!this.alerted) keepAwake(true);
        this.loop();
      }
    } catch {}
  },
};

function clock(ms, up) {
  const s = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function paintTimer() {
  const run = timer.running();
  const rem = run ? timer.remaining() : db.settings.rest * 1000;
  const over = run && rem <= 0;
  timerEl.classList.toggle('run', run);
  timerEl.classList.toggle('over', over);
  const text = over ? '+' + clock(-rem) : clock(rem, true);
  if (tTime.textContent !== text) tTime.textContent = text;
  tProg.style.transform = `scaleX(${run && !over ? Math.min(1, rem / (timer.dur * 1000)) : 0})`;
  const state = run ? 'stop' : 'play';
  if (tGo.dataset.state !== state) {
    tGo.dataset.state = state;
    tGo.innerHTML = I[state];
    tGo.setAttribute('aria-label', run ? 'Arrêter le repos' : 'Démarrer le repos');
  }
  const show = cur.view === 'session' || run;
  timerEl.hidden = !show;
  document.body.classList.toggle('has-timer', show);
}

function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}

function alarm() {
  navigator.vibrate?.([300, 120, 300, 120, 500]);
  if (!actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime + 0.05;
    [0, 0.28, 0.56].forEach((d, i) => {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(g).connect(actx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.25);
    });
  } catch {}
}

// L'écran reste allumé pendant le repos.
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      const wl = wakeLock;
      wakeLock = null;
      await wl.release();
    }
  } catch { wakeLock = null; }
}

/* ---------- Export / import ---------- */

async function exportData() {
  flush();
  const name = `scu-${today()}.json`;
  const file = new File([JSON.stringify(db, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try { data = normalize(JSON.parse(await f.text())); } catch {
    sheet({ title: 'Fichier illisible.', cancel: 'OK' });
    return;
  }
  const n = data.sessions.length;
  sheet({
    title: `Remplacer toutes les données par ce fichier (${n} séance${n > 1 ? 's' : ''}) ?`,
    actions: [{ label: 'Remplacer', danger: true, run: () => { db = data; flush(); timer.stop(); replace('/'); route(); } }],
  });
});

/* ---------- Actions ---------- */

const actions = {
  back: el => back(el.dataset.parent),
  tab: el => { if (location.hash !== '#' + el.dataset.to) replace(el.dataset.to); },

  'new-session': () => {
    const s = newSession();
    db.sessions.push(s);
    save();
    go('/s/' + s.id);
  },
  'add-exercise': () => go(`/s/${cur.session.id}/ajout`),
  pick: el => pickExercise(exById(el.dataset.id)),
  'pick-new': () => pickExercise(createExercise($('.search').value)),

  'add-set': el => {
    const en = cur.session.entries.find(x => x.id === el.closest('.entry').dataset.entry);
    en.sets.push({ w: null, r: null, done: false });
    save();
    repaintEntry(en);
  },

  'toggle-set': el => {
    const { sec, en, i } = setOf(el);
    const st = en.sets[i];
    if (st.done) {
      st.done = false;
    } else {
      const sug = suggestions(cur.session, en)[i];
      const w = st.w ?? sug.w;
      const r = st.r ?? sug.r;
      if (r == null) {
        sec.querySelector(`.set[data-i="${i}"] [data-field="${w == null ? 'w' : 'r'}"]`).focus();
        return;
      }
      Object.assign(st, { w, r, done: true });
      timer.start(db.settings.rest);
      navigator.vibrate?.(10);
    }
    save();
    repaintEntry(en);
  },

  'entry-menu': el => {
    const s = cur.session;
    const en = s.entries.find(x => x.id === el.closest('.entry').dataset.entry);
    const i = s.entries.indexOf(en);
    const move = d => () => { s.entries.splice(i, 1); s.entries.splice(i + d, 0, en); save(); renderSession(s); };
    const list = [];
    if (en.sets.length) list.push({ label: 'Supprimer la dernière série', run: () => { en.sets.pop(); save(); repaintEntry(en); } });
    if (i > 0) list.push({ label: 'Monter', run: move(-1) });
    if (i < s.entries.length - 1) list.push({ label: 'Descendre', run: move(1) });
    list.push({
      label: "Retirer l'exercice",
      danger: true,
      confirm: en.sets.some(logged) ? `Retirer ${exName(en.exerciseId)} et ses séries de cette séance ?` : null,
      confirmLabel: 'Retirer',
      run: () => { s.entries.splice(s.entries.indexOf(en), 1); save(); renderSession(s); },
    });
    sheet({ title: exName(en.exerciseId), actions: list });
  },

  'session-menu': () => {
    const s = cur.session;
    sheet({
      actions: [
        {
          label: 'Refaire cette séance',
          run: () => {
            const n = newSession();
            n.name = s.name;
            n.entries = s.entries.map(en => ({ id: uid(), exerciseId: en.exerciseId, sets: blankSets(Math.max(1, en.sets.filter(logged).length)) }));
            db.sessions.push(n);
            save();
            replace('/s/' + n.id);
          },
        },
        {
          label: 'Supprimer la séance',
          danger: true,
          confirm: 'Supprimer cette séance et toutes ses séries ?',
          confirmLabel: 'Supprimer',
          run: () => { db.sessions = db.sessions.filter(x => x !== s); save(); back('/'); },
        },
      ],
    });
  },

  'new-exercise': () => sheet({
    input: { placeholder: "Nom de l'exercice" },
    actions: [{ label: 'Ajouter', run: v => { if (v.trim()) { createExercise(v); save(); route(); } } }],
  }),

  'exercise-menu': () => {
    const ex = cur.exercise;
    const used = db.sessions.filter(s => s.entries.some(en => en.exerciseId === ex.id)).length;
    sheet({
      title: ex.name,
      actions: [
        {
          label: 'Renommer',
          run: () => sheet({
            input: { value: ex.name, placeholder: "Nom de l'exercice" },
            actions: [{ label: 'Renommer', run: v => { if (v.trim()) { ex.name = cap(v.trim().replace(/\s+/g, ' ')); save(); route(); } } }],
          }),
        },
        {
          label: "Supprimer l'exercice",
          danger: true,
          confirm: used ? `Supprimer ${ex.name} et son historique (${used} séance${used > 1 ? 's' : ''}) ?` : `Supprimer ${ex.name} ?`,
          confirmLabel: 'Supprimer',
          run: () => {
            db.exercises = db.exercises.filter(x => x !== ex);
            for (const s of db.sessions) s.entries = s.entries.filter(en => en.exerciseId !== ex.id);
            save();
            back('/exercices');
          },
        },
      ],
    });
  },

  'app-menu': () => sheet({
    title: 'Les données restent sur ce téléphone.',
    actions: [
      { label: 'Exporter une sauvegarde', run: exportData },
      { label: 'Importer une sauvegarde', run: () => $('#file').click() },
    ],
  }),

  'sheet-do': el => runSheetAction(Number(el.dataset.i)),
  'sheet-close': closeSheet,

  't-toggle': () => (timer.running() ? timer.stop() : timer.start(db.settings.rest)),
  't-minus': () => timer.adjust(-STEP),
  't-plus': () => timer.adjust(STEP),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
  else if (e.target.matches('input[type="date"]')) { try { e.target.showPicker(); } catch {} }
});

document.addEventListener('input', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (f === 'w' || f === 'r') {
    const { sec, en, i } = setOf(el);
    let n = parseNum(el.value);
    if (f === 'r' && n != null) n = Math.round(n);
    en.sets[i][f] = n;
    save();
    refreshPlaceholders(sec, en);
  } else if (f === 'name') {
    cur.session.name = el.value;
    save();
  } else if (f === 'date' && el.value) {
    cur.session.date = el.value;
    save();
    $('.date-text').textContent = longDate(el.value);
  } else if (f === 'q') {
    paintPicker(el.value);
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (f === 'w' || f === 'r') {
    const { en, i } = setOf(el);
    el.value = fmt(en.sets[i][f]);
  } else if (f === 'name') {
    cur.session.name = el.value.trim();
    el.value = cur.session.name;
    save();
  }
});

document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.matches('.num')) setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch {} }, 0);
});

document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key === 'Escape' && sheetState) closeSheet();
  if (e.key !== 'Enter') return;
  if (el.matches('.sheet-input') && sheetState?.actions?.length) { e.preventDefault(); runSheetAction(0); }
  else if (el.matches('.title, .num')) el.blur();
  else if (el.matches('.search')) {
    const first = $('#pick [data-act]');
    if (first && el.value.trim()) first.click();
  }
});

// Garde les feuilles d'action au-dessus du clavier.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); return; }
  if (timer.running()) {
    timer.tick();
    if (timer.remaining() > 0) keepAwake(true);
  }
});
window.addEventListener('pagehide', flush);

/* ---------- Démarrage ---------- */

if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
navStack = [location.hash];
route();
timer.restore();
paintTimer();
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
