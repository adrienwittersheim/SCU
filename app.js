'use strict';

/* SCU — séances, exercices, séries, charges.
   Tout est stocké sur l'appareil (localStorage). Aucune dépendance. */

const KEY = 'scu.v1';
const TIMER_KEY = 'scu.timer';
const STEP = 15;                 // pas du minuteur, en secondes
const REST_MAX = 600;
const OVERTIME = 10 * 60 * 1000; // le dépassement s'affiche 10 min au plus
const I = {
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a.7.7 0 0 0 1.05.6l10.4-6.5a.7.7 0 0 0 0-1.2L9.05 4.9A.7.7 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>',
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
const clean = s => cap(s.trim().replace(/\s+/g, ' '));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const fmt = n => (n == null ? '' : String(n).replace('.', ','));
const parseNum = str => { const t = str.trim().replace(',', '.'); return t ? num(parseFloat(t)) : null; };
const logged = st => st.r != null; // une série compte dès qu'elle a des répétitions
const clampRest = v => (Number(v) > 0 ? Math.min(REST_MAX, Math.max(STEP, Math.round(v / STEP) * STEP)) : 90);

const dfLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dfLongY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const sameYear = s => parseISO(s).getFullYear() === new Date().getFullYear();
const longDate = s => (sameYear(s) ? dfLong : dfLongY).format(parseISO(s));
function shortDate(s) {
  const d = parseISO(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${sameYear(s) ? '' : '.' + String(d.getFullYear()).slice(2)}`;
}

const fmtSet = st => (st.w ? `${fmt(st.w)}×${st.r}` : `${st.r} rép`);
const fmtRecord = st => (st.w ? `${fmt(st.w)} kg × ${st.r}` : `${st.r} rép`);
const heavier = (a, b) => (a.w ?? 0) > (b.w ?? 0) || ((a.w ?? 0) === (b.w ?? 0) && a.r > b.r);
const topSet = sets => sets.reduce((best, st) => (heavier(st, best) ? st : best));

// Retour haptique : vibreur sur Android, interrupteur natif sur iPhone (iOS 18+).
const haptic = (() => {
  if (navigator.vibrate) return () => navigator.vibrate(12);
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  label.innerHTML = '<input type="checkbox" switch tabindex="-1">';
  document.body.append(label);
  return () => label.click();
})();

/* ---------- Données ---------- */

let db = load();
let saveTimer = 0;

function blank() {
  return { version: 1, exercises: [], sessions: [], settings: { rest: 90 } };
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
const newSession = () => ({ id: uid(), date: today(), createdAt: Date.now(), name: '', entries: [] });

// Un exercice n'existe que tant qu'une séance l'utilise.
function pruneExercises() {
  const used = new Set(db.sessions.flatMap(s => s.entries.map(en => en.exerciseId)));
  const n = db.exercises.length;
  db.exercises = db.exercises.filter(e => used.has(e.id));
  if (db.exercises.length !== n) save();
}

// Les séances ouvertes puis laissées vides disparaissent d'elles-mêmes.
function prune() {
  const n = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.entries.length || s.name.trim());
  if (db.sessions.length !== n) save();
  pruneExercises();
}

function lastUsed() {
  const m = new Map();
  for (const s of db.sessions) {
    const k = order(s);
    for (const en of s.entries) if (k > (m.get(en.exerciseId) || '')) m.set(en.exerciseId, k);
  }
  return m;
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
  name = clean(name);
  const found = db.exercises.find(e => fold(e.name) === fold(name));
  if (found) return found;
  const ex = { id: uid(), name };
  db.exercises.push(ex);
  return ex;
}

// Exercices déjà faits dont le nom contient la saisie, les plus récents d'abord.
function matchExercises(q) {
  const fq = fold(q);
  if (!fq) return [];
  const used = lastUsed();
  return db.exercises
    .filter(e => used.has(e.id) && fold(e.name).includes(fq))
    .sort((a, b) => (fold(b.name).startsWith(fq) - fold(a.name).startsWith(fq)) || cmp(used.get(b.id), used.get(a.id)))
    .slice(0, 5)
    .map(e => e.name);
}

/* ---------- Navigation ---------- */

let cur = { view: 'sessions' };
let navStack = [];
let replacing = false;
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
});

function route() {
  const [a, b] = location.hash.slice(2).split('/');
  let s, ex;
  if (a === 's' && (s = db.sessions.find(x => x.id === b))) renderSession(s);
  else if (a === 'e' && (ex = exById(b))) renderExercise(ex);
  else renderSessions();
  document.body.dataset.view = cur.view;
  paintTimer();
}

const backBtn = parent => `<button class="icon" data-act="back" data-parent="${esc(parent)}" aria-label="Retour">${I.back}</button>`;

/* ---------- Écrans ---------- */

function renderSessions() {
  prune();
  cur = { view: 'sessions' };
  const rows = sortedSessions().map(s => `
    <a class="srow" href="#/s/${s.id}">
      <span class="sname">${esc(s.name.trim() || 'sans titre')}</span>
      <span class="sdate">${shortDate(s.date)}</span>
      <span class="ssub">${esc(s.entries.map(en => exName(en.exerciseId)).join(', '))}</span>
    </a>`).join('');
  app.innerHTML = `
    <header class="top"><span></span><button class="icon" data-act="app-menu" aria-label="Sauvegarde">${I.dots}</button></header>
    <h1 class="home-title">séances</h1>
    ${rows || '<p class="empty">aucune séance</p>'}
    <button class="fab" data-act="new-session" aria-label="Nouvelle séance">${I.plus}</button>`;
}

function renderSession(s) {
  cur = { view: 'session', session: s };
  app.innerHTML = `
    <header class="top">${backBtn('/')}<button class="icon" data-act="session-menu" aria-label="Options de la séance">${I.dots}</button></header>
    <input class="title" data-field="name" value="${esc(s.name)}" placeholder="sans titre" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="Nom de la séance">
    <label class="date"><span class="date-text">${esc(longDate(s.date))}</span><input type="date" data-field="date" value="${s.date}" aria-label="Date de la séance"></label>
    ${s.entries.map(en => entryHTML(s, en)).join('')}
    <button class="addex" data-act="add-exercise">${I.plus}<span>exercice</span></button>`;
}

function entryHTML(s, en) {
  const ex = exById(en.exerciseId) || { id: en.exerciseId, name: '?' };
  const sug = suggestions(s, en);
  const rows = en.sets.map((st, i) => `
    <div class="set${st.done ? ' done' : ''}" data-i="${i}">
      <input class="num" data-field="w" inputmode="decimal" autocomplete="off" value="${fmt(st.w)}" placeholder="${fmt(sug[i].w)}" aria-label="Charge en kilos, série ${i + 1}">
      <span class="unit">kg</span>
      <span class="times">×</span>
      <input class="num r" data-field="r" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${fmt(st.r)}" placeholder="${fmt(sug[i].r)}" aria-label="Répétitions, série ${i + 1}">
      <button class="dot" data-act="toggle-set" role="switch" aria-checked="${st.done}" aria-label="Série ${i + 1} faite"><i></i></button>
    </div>`).join('');
  return `<section class="entry" data-entry="${en.id}">
    <div class="ehead">
      <a class="ename" href="#/e/${ex.id}">${esc(ex.name)}</a>
      <button class="icon" data-act="entry-menu" aria-label="Options de l'exercice">${I.dots}</button>
    </div>
    ${rows}
    <button class="addset" data-act="add-set">${I.plus}<span>série</span></button>
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

const entryOf = el => cur.session.entries.find(x => x.id === el.closest('.entry').dataset.entry);
function setOf(el) {
  return { sec: el.closest('.entry'), en: entryOf(el), i: Number(el.closest('.set').dataset.i) };
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
      <span class="hdate">${shortDate(s.date)}</span>
      <span class="hsets">${sets.map(st => `<span>${esc(fmtSet(st))}</span>`).join('')}</span>
    </a>`);
  }
  app.innerHTML = `
    <header class="top">${backBtn('/')}<button class="icon" data-act="exercise-menu" aria-label="Options de l'exercice">${I.dots}</button></header>
    <h1>${esc(ex.name)}</h1>
    <p class="record">${best ? `record<b>${esc(fmtRecord(best))}</b>` : 'aucune série'}</p>
    ${rows.join('')}`;
}

/* ---------- Feuilles ---------- */

let sheetState = null;

// opts : { title, message, input: { value, placeholder, suggest }, submit: { label, run }, actions: [...] }
function sheet(opts) {
  sheetState = opts;
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-wrap">
    <div class="backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      ${opts.title ? `<p class="sheet-title">${esc(opts.title)}</p>` : ''}
      ${opts.message ? `<p class="sheet-msg">${esc(opts.message)}</p>` : ''}
      ${opts.input ? `<div class="sheet-field"><input class="sheet-input" value="${esc(opts.input.value || '')}" placeholder="${esc(opts.input.placeholder || '')}" autocomplete="off" autocorrect="off" autocapitalize="sentences" enterkeyhint="done"></div><div class="sugg" id="sugg"></div>` : ''}
      ${(opts.actions || []).map((a, i) => `<button class="sheet-row${a.danger ? ' danger' : ''}" data-act="sheet-do" data-i="${i}">${esc(a.label)}</button>`).join('')}
      ${opts.submit ? `<button class="go" data-act="sheet-submit">${esc(opts.submit.label)}</button>` : ''}
      <button class="sheet-row cancel" data-act="sheet-close">${esc(opts.cancel || 'annuler')}</button>
    </div>
  </div>`;
  const wrap = root.firstElementChild;
  if (opts.input) {
    // Ouverte d'emblée : le clavier ne s'affiche que si le focus est pris pendant le geste.
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
  const a = sheetState?.actions?.[i];
  if (!a) return;
  if (a.confirm) {
    sheet({ message: a.confirm, actions: [{ label: a.confirmLabel || a.label, danger: true, run: a.run }] });
    return;
  }
  closeSheet();
  a.run();
}

function submitSheet(value) {
  const st = sheetState;
  if (!st?.submit) return;
  const input = $('#sheet .sheet-input');
  const v = (value ?? input?.value ?? '').trim();
  if (!v) { input?.focus(); return; }
  closeSheet();
  st.submit.run(v);
}

function paintSuggestions(q) {
  const box = $('#sugg');
  if (!box) return;
  box.innerHTML = sheetState.input.suggest(q)
    .map(n => `<button class="sheet-row" data-act="sheet-pick" data-name="${esc(n)}">${esc(n)}</button>`)
    .join('');
}

/* ---------- Minuteur ---------- */

const timerEl = $('#timer');
const tClock = $('#tclock');
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

function paintTimer() {
  const run = timer.running();
  const rem = run ? timer.remaining() : db.settings.rest * 1000;
  const over = run && rem <= 0;
  const secs = over ? Math.floor(-rem / 1000) : Math.ceil(rem / 1000);
  const text = `${over ? '+' : ''}${Math.floor(secs / 60)}:${pad(secs % 60)}`;
  if (tClock.textContent !== text) tClock.textContent = text;
  tProg.style.transform = `scaleX(${run && !over ? Math.min(1, rem / (timer.dur * 1000)) : 0})`;
  timerEl.classList.toggle('run', run);
  timerEl.classList.toggle('over', over);

  const state = run ? 'stop' : 'play';
  if (tGo.dataset.state !== state) {
    tGo.dataset.state = state;
    tGo.innerHTML = I[state];
    tGo.setAttribute('aria-label', run ? 'Arrêter le repos' : 'Démarrer le repos');
  }

  const show = cur.view === 'session' || (run && cur.view === 'exercise');
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

/* ---------- Sauvegarde ---------- */

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
    sheet({ message: 'fichier illisible', cancel: 'ok' });
    return;
  }
  const n = data.sessions.length;
  sheet({
    message: `remplacer toutes les données par ce fichier (${n} séance${n > 1 ? 's' : ''}) ?`,
    actions: [{
      label: 'remplacer',
      danger: true,
      run: () => { db = data; pruneExercises(); flush(); timer.stop(); replace('/'); route(); },
    }],
  });
});

/* ---------- Actions ---------- */

const actions = {
  back: el => back(el.dataset.parent),

  'new-session': () => {
    const s = newSession();
    db.sessions.push(s);
    save();
    go('/s/' + s.id);
  },

  'add-exercise': () => sheet({
    input: { placeholder: "nom de l'exercice", suggest: matchExercises },
    submit: {
      label: 'ajouter',
      run: name => {
        const en = addEntry(cur.session, createExercise(name).id);
        save();
        renderSession(cur.session);
        $(`[data-entry="${en.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    },
  }),

  'add-set': el => {
    const en = entryOf(el);
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
    }
    haptic();
    save();
    repaintEntry(en);
  },

  'entry-menu': el => {
    const s = cur.session;
    const en = entryOf(el);
    const i = s.entries.indexOf(en);
    const move = d => () => { s.entries.splice(i, 1); s.entries.splice(i + d, 0, en); save(); renderSession(s); };
    const list = [];
    if (en.sets.length) list.push({ label: 'supprimer la dernière série', run: () => { en.sets.pop(); save(); repaintEntry(en); } });
    if (i > 0) list.push({ label: 'monter', run: move(-1) });
    if (i < s.entries.length - 1) list.push({ label: 'descendre', run: move(1) });
    list.push({
      label: "retirer l'exercice",
      danger: true,
      confirm: en.sets.some(logged) ? `retirer ${exName(en.exerciseId)} et ses séries de cette séance ?` : null,
      confirmLabel: 'retirer',
      run: () => { s.entries.splice(s.entries.indexOf(en), 1); save(); renderSession(s); },
    });
    sheet({ title: exName(en.exerciseId), actions: list });
  },

  'session-menu': () => {
    const s = cur.session;
    sheet({
      actions: [
        {
          label: 'refaire cette séance',
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
          label: 'supprimer la séance',
          danger: true,
          confirm: 'supprimer cette séance et toutes ses séries ?',
          confirmLabel: 'supprimer',
          run: () => { db.sessions = db.sessions.filter(x => x !== s); save(); back('/'); },
        },
      ],
    });
  },

  'exercise-menu': () => {
    const ex = cur.exercise;
    const used = db.sessions.filter(s => s.entries.some(en => en.exerciseId === ex.id)).length;
    sheet({
      title: ex.name,
      actions: [
        {
          label: 'renommer',
          run: () => sheet({
            input: { value: ex.name, placeholder: "nom de l'exercice" },
            submit: { label: 'enregistrer', run: v => { ex.name = clean(v); save(); route(); } },
          }),
        },
        {
          label: "supprimer l'exercice",
          danger: true,
          confirm: `supprimer ${ex.name} de ${used > 1 ? `ses ${used} séances` : 'sa séance'}, avec toutes ses séries ?`,
          confirmLabel: 'supprimer',
          run: () => {
            db.exercises = db.exercises.filter(x => x !== ex);
            for (const s of db.sessions) s.entries = s.entries.filter(en => en.exerciseId !== ex.id);
            save();
            back('/');
          },
        },
      ],
    });
  },

  'app-menu': () => sheet({
    title: 'sauvegarde',
    message: 'les données restent sur ce téléphone.',
    actions: [
      { label: 'exporter', run: exportData },
      { label: 'importer', run: () => $('#file').click() },
    ],
  }),

  'sheet-do': el => runSheetAction(Number(el.dataset.i)),
  'sheet-submit': () => submitSheet(),
  'sheet-pick': el => submitSheet(el.dataset.name),
  'sheet-close': closeSheet,

  't-toggle': () => { haptic(); timer.running() ? timer.stop() : timer.start(db.settings.rest); },
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
    $('.date-text').textContent = stamp(el.value);
  } else if (el.matches('.sheet-input') && sheetState?.input?.suggest) {
    paintSuggestions(el.value);
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
  if (el.matches('.sheet-input')) { e.preventDefault(); submitSheet(); }
  else if (el.matches('.title, .num')) el.blur();
});

// Garde les feuilles au-dessus du clavier.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb}px`);
    document.documentElement.classList.toggle('kb', kb > 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); return; }
  if (timer.running()) {
    timer.tick();
    if (timer.remaining() > 0) keepAwake(true);
  }
  swReg?.update().catch(() => {});
});
window.addEventListener('pagehide', flush);

/* ---------- Démarrage ---------- */

let swReg = null;

pruneExercises();
if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
navStack = [location.hash];
route();
timer.restore();
paintTimer();
navigator.storage?.persist?.().catch(() => {});

// Nouvelle version publiée : on recharge une fois qu'elle est prête.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const updating = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating || reloaded) return;
    reloaded = true;
    flush();
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(() => {});
}
