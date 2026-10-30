'use strict';

/* SCU — séances, exercices, séries, charges.
   Tout est stocké sur l'appareil (localStorage). Aucune dépendance. */

const KEY = 'scu.v1';
const TIMER_KEY = 'scu.timer';
const STEP = 15;                 // pas du minuteur, en secondes
const REST_MAX = 600;
const OVERTIME = 10 * 60 * 1000; // le dépassement s'affiche 10 min au plus
const BARS = 48;                 // segments du vumètre

const I = {
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="10.25" width="3.5" height="3.5"/><rect x="10.25" y="10.25" width="3.5" height="3.5"/><rect x="17.5" y="10.25" width="3.5" height="3.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12"/></svg>',
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

const dfWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
function dayMonth(s) {
  const d = parseISO(s);
  const y = d.getFullYear() === new Date().getFullYear() ? '' : '.' + String(d.getFullYear()).slice(2);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${y}`;
}
const stamp = s => `${dfWeekday.format(parseISO(s)).replace('.', '')} ${dayMonth(s)}`;

const fmtSet = st => (st.w ? `${fmt(st.w)}×${st.r}` : `${st.r} rép`);
const recordHTML = st => (st.w ? `${fmt(st.w)}<small>kg</small> × ${st.r}` : `${st.r}<small>rép</small>`);
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

// Numéro de chaque séance, dans l'ordre chronologique.
function numbers() {
  const m = new Map();
  [...db.sessions].sort((a, b) => cmp(order(a), order(b))).forEach((s, i) => m.set(s.id, i + 1));
  return m;
}

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

function backBtn(parent) {
  const prev = navStack.length > 1 ? navStack[navStack.length - 2] : '#' + parent;
  const label = prev.startsWith('#/s/') ? 'Séance' : prev.startsWith('#/e/') ? 'Exercice' : 'Séances';
  return `<button class="back" data-act="back" data-parent="${esc(parent)}">${I.back}<span class="label">${label}</span></button>`;
}

/* ---------- Écrans ---------- */

function renderSessions() {
  prune();
  cur = { view: 'sessions' };
  const list = sortedSessions();
  const nums = numbers();
  const rows = list.map(s => `
    <a class="srow" href="#/s/${s.id}">
      <span class="srow-top"><span class="snum">${pad(nums.get(s.id))}</span><span class="micro">${esc(stamp(s.date))}</span></span>
      <span class="sname">${esc(s.name.trim() || 'Sans titre')}</span>
      <span class="ssub">${esc(s.entries.map(en => exName(en.exerciseId)).join(' · ') || '—')}</span>
    </a>`).join('');
  app.innerHTML = `
    <header class="bar">
      <span class="label">SCU</span>
      <button class="icon" data-act="app-menu" aria-label="Sauvegarde">${I.dots}</button>
    </header>
    <section class="panel list">
      <div class="phead"><span class="label">Séances</span><span class="micro">${pad(list.length)}</span></div>
      ${rows || '<div class="void"><span class="void-num">00</span><span class="micro">Aucune séance</span></div>'}
    </section>
    <div class="dock"><button class="block" data-act="new-session"><span>Nouvelle séance</span>${I.plus}</button></div>`;
}

function renderSession(s) {
  cur = { view: 'session', session: s };
  app.innerHTML = `
    <header class="bar">${backBtn('/')}<button class="icon" data-act="session-menu" aria-label="Options de la séance">${I.dots}</button></header>
    <section class="panel">
      <div class="phead">
        <span class="label">Séance ${pad(numbers().get(s.id))}</span>
        <label class="micro date"><span class="date-text">${esc(stamp(s.date))}</span><input type="date" data-field="date" value="${s.date}" aria-label="Date de la séance"></label>
      </div>
      <input class="title" data-field="name" value="${esc(s.name)}" placeholder="Sans titre" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="Nom de la séance">
    </section>
    ${s.entries.map(en => entryHTML(s, en)).join('')}
    <button class="panel addrow" data-act="add-exercise"><span class="label">Ajouter un exercice</span>${I.plus}</button>`;
}

function entryHTML(s, en) {
  const ex = exById(en.exerciseId) || { id: en.exerciseId, name: '?' };
  const sug = suggestions(s, en);
  const rows = en.sets.map((st, i) => `
    <div class="sgrid set${st.done ? ' done' : ''}" data-i="${i}">
      <span class="idx">${pad(i + 1)}</span>
      <input class="num" data-field="w" inputmode="decimal" autocomplete="off" value="${fmt(st.w)}" placeholder="${fmt(sug[i].w)}" aria-label="Charge en kilos, série ${i + 1}">
      <input class="num" data-field="r" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${fmt(st.r)}" placeholder="${fmt(sug[i].r)}" aria-label="Répétitions, série ${i + 1}">
      <button class="switch" data-act="toggle-set" role="switch" aria-checked="${st.done}" aria-label="Série ${i + 1} faite"><i></i></button>
    </div>`).join('');
  return `<section class="panel entry" data-entry="${en.id}">
    <div class="phead">
      <span class="label">Exercice ${pad(s.entries.indexOf(en) + 1)}</span>
      <button class="icon" data-act="entry-menu" aria-label="Options de l'exercice">${I.dots}</button>
    </div>
    <a class="ename" href="#/e/${ex.id}">${esc(ex.name)}</a>
    ${en.sets.length ? '<div class="sgrid shead"><span class="micro">Série</span><span class="micro">Kg</span><span class="micro">Rép</span><span></span></div>' : ''}
    ${rows}
    <button class="addset" data-act="add-set">${I.plus}<span class="label">Série</span></button>
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
  let last = null;
  const rows = [];
  for (const s of sortedSessions()) {
    const sets = s.entries.filter(en => en.exerciseId === ex.id).flatMap(en => en.sets.filter(logged));
    if (!sets.length) continue;
    last = last || s;
    const t = topSet(sets);
    if (!best || heavier(t, best)) best = t;
    rows.push(`<a class="hrow" href="#/s/${s.id}">
      <span class="micro">${esc(dayMonth(s.date))}</span>
      <span class="hsets">${sets.map(st => `<span>${esc(fmtSet(st))}</span>`).join('')}</span>
    </a>`);
  }
  app.innerHTML = `
    <header class="bar">${backBtn('/')}<button class="icon" data-act="exercise-menu" aria-label="Options de l'exercice">${I.dots}</button></header>
    <section class="panel">
      <div class="phead"><span class="label">Exercice</span><span class="micro">${pad(rows.length)} séance${rows.length > 1 ? 's' : ''}</span></div>
      <h1 class="title">${esc(ex.name)}</h1>
    </section>
    ${rows.length ? `
    <section class="panel split">
      <div><span class="micro">Record</span><span class="stat">${recordHTML(best)}</span></div>
      <div><span class="micro">Dernière fois</span><span class="stat">${esc(dayMonth(last.date))}</span></div>
    </section>
    <section class="panel list">
      <div class="phead"><span class="label">Historique</span></div>
      ${rows.join('')}
    </section>` : '<section class="panel"><span class="micro">Aucune série enregistrée</span></section>'}`;
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
      ${opts.title ? `<div class="sheet-head"><span class="label">${esc(opts.title)}</span></div>` : ''}
      ${opts.message ? `<p class="sheet-msg">${esc(opts.message)}</p>` : ''}
      ${opts.input ? `<div class="sheet-field"><input class="sheet-input" value="${esc(opts.input.value || '')}" placeholder="${esc(opts.input.placeholder || '')}" autocomplete="off" autocorrect="off" autocapitalize="sentences" enterkeyhint="done"></div><div class="sugg" id="sugg"></div>` : ''}
      ${(opts.actions || []).map((a, i) => `<button class="sheet-row${a.danger ? ' danger' : ''}" data-act="sheet-do" data-i="${i}">${esc(a.label)}</button>`).join('')}
      ${opts.submit ? `<button class="block" data-act="sheet-submit"><span>${esc(opts.submit.label)}</span>${I.plus}</button>` : ''}
      <button class="sheet-row cancel" data-act="sheet-close">${esc(opts.cancel || 'Annuler')}</button>
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
    sheet({ title: a.label, message: a.confirm, actions: [{ label: a.confirmLabel || a.label, danger: true, run: a.run }] });
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
const tMin = $('#tmin');
const tSec = $('#tsec');
const tSign = $('#tsign');
const tState = $('#tstate');
const tGo = $('#tgo');
const meter = $('#meter');
meter.innerHTML = '<i></i>'.repeat(BARS);
const bars = [...meter.children];
let litBars = -1;
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
  const m = pad(Math.floor(secs / 60));
  const s = pad(secs % 60);
  if (tMin.textContent !== m) tMin.textContent = m;
  if (tSec.textContent !== s) tSec.textContent = s;
  tSign.hidden = !over;
  tState.textContent = over ? 'Terminé' : run ? 'Restant' : 'Prêt';
  timerEl.classList.toggle('run', run);
  timerEl.classList.toggle('over', over);

  const lit = over ? BARS : run ? Math.round((1 - rem / (timer.dur * 1000)) * BARS) : 0;
  if (lit !== litBars) {
    bars.forEach((b, i) => b.classList.toggle('on', i < lit));
    litBars = lit;
  }

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
    sheet({ title: 'Importer', message: 'Ce fichier est illisible.', cancel: 'OK' });
    return;
  }
  const n = data.sessions.length;
  sheet({
    title: 'Importer',
    message: `Remplacer toutes les données par ce fichier (${n} séance${n > 1 ? 's' : ''}) ?`,
    actions: [{
      label: 'Remplacer',
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
    title: 'Exercice',
    input: { placeholder: "Nom de l'exercice", suggest: matchExercises },
    submit: {
      label: 'Ajouter',
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
      title: 'Séance',
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

  'exercise-menu': () => {
    const ex = cur.exercise;
    const used = db.sessions.filter(s => s.entries.some(en => en.exerciseId === ex.id)).length;
    sheet({
      title: ex.name,
      actions: [
        {
          label: 'Renommer',
          run: () => sheet({
            title: 'Renommer',
            input: { value: ex.name, placeholder: "Nom de l'exercice" },
            submit: { label: 'Enregistrer', run: v => { ex.name = clean(v); save(); route(); } },
          }),
        },
        {
          label: "Supprimer l'exercice",
          danger: true,
          confirm: `Supprimer ${ex.name} de ${used > 1 ? `ses ${used} séances` : 'sa séance'}, avec toutes ses séries ?`,
          confirmLabel: 'Supprimer',
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
    title: 'Sauvegarde',
    message: 'Les données restent sur ce téléphone. Exportez-les de temps en temps.',
    actions: [
      { label: 'Exporter', run: exportData },
      { label: 'Importer', run: () => $('#file').click() },
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
