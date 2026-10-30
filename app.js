'use strict';

/* SCU — séances, exercices, séries, charges.
   Tout est stocké sur l'appareil (localStorage). Aucune dépendance.

   Une séance se refait d'une fois sur l'autre : chaque série garde la charge
   et les répétitions de la dernière fois. Valider une série l'inscrit au
   journal (historique, record) ; la coche s'efface d'elle-même le lendemain. */

const KEY = 'scu.v1';
const TIMER_KEY = 'scu.timer';
const STEP = 15;                 // pas du minuteur, en secondes
const REST_MAX = 600;
const OVERTIME = 10 * 60 * 1000; // le dépassement s'affiche 10 min au plus
const LATE = 4 * 3600 * 1000;    // une séance commencée tard reste cochée après minuit


const I = {
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a.7.7 0 0 0 1.05.6l10.4-6.5a.7.7 0 0 0 0-1.2L9.05 4.9A.7.7 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

/* ---------- Utilitaires ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clean = s => cap(s.trim().replace(/\s+/g, ' '));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const fmt = n => (n == null ? '–' : String(n).replace('.', ','));
const fmtIn = n => (n == null ? '' : String(n).replace('.', ','));
const parseNum = str => { const t = str.trim().replace(',', '.'); return t ? num(parseFloat(t)) : null; };
const clampRest = v => (Number(v) > 0 ? clamp(Math.round(v / STEP) * STEP, STEP, REST_MAX) : 90);

const fmtSet = st => (st.w ? `${fmt(st.w)}×${st.r}` : `${st.r} rép`);
const fmtRecord = st => (st.w ? `${fmt(st.w)} kg × ${st.r}` : `${st.r} rép`);
const fmtTarget = t => `${t.sets} × ${t.min == null ? 'max' : t.min === t.max ? t.min : `${t.min}–${t.max}`}`;
const heavier = (a, b) => (a.w ?? 0) > (b.w ?? 0) || ((a.w ?? 0) === (b.w ?? 0) && a.r > b.r);
const topSet = sets => sets.reduce((best, st) => (heavier(st, best) ? st : best));

// Faite aujourd'hui (ou il y a moins de 4 h) : la coche s'efface la fois suivante.
const isDone = st => st.at != null && (dayKey(st.at) === dayKey(Date.now()) || Date.now() - st.at < LATE);

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
  return { version: 2, exercises: [], sessions: [], log: [], settings: { rest: 90 }, imports: [] };
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

function normalizeTarget(t) {
  if (!t || !(t.sets >= 1)) return null;
  const min = num(t.min);
  return { sets: Math.round(t.sets), min, max: min == null ? null : Math.max(min, num(t.max) ?? min) };
}

// Lit les données des deux formats : v1 (une séance par entraînement, datée) et v2.
function normalize(d) {
  if (!d || !Array.isArray(d.exercises) || !Array.isArray(d.sessions)) throw new Error('Format inconnu');
  const v1 = !(d.version >= 2);
  const exercises = d.exercises
    .filter(e => e && e.id != null && typeof e.name === 'string')
    .map(e => ({ id: String(e.id), name: e.name }));
  const ids = new Set(exercises.map(e => e.id));
  const log = (Array.isArray(d.log) ? d.log : [])
    .filter(e => e && ids.has(String(e.ex)) && num(e.r) != null && Number(e.at) > 0)
    .map(e => ({ ex: String(e.ex), w: num(e.w), r: num(e.r), at: Number(e.at) }));
  const today = dayKey(Date.now());

  const sessions = d.sessions.filter(s => s && s.id != null).map(s => {
    const day = v1 && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today;
    const base = new Date(`${day}T12:00`).getTime() + (Number(s.createdAt) % 1000 || 0);
    return {
      id: String(s.id),
      name: typeof s.name === 'string' ? s.name : '',
      entries: (Array.isArray(s.entries) ? s.entries : [])
        .filter(en => en && ids.has(String(en.exerciseId)))
        .map(en => ({
          id: String(en.id ?? uid()),
          exerciseId: String(en.exerciseId),
          target: normalizeTarget(en.target),
          sets: (Array.isArray(en.sets) ? en.sets : []).map((st, i) => {
            const w = num(st && st.w);
            const r = num(st && st.r);
            if (!v1) return { w, r, at: Number(st && st.at) > 0 ? Number(st.at) : null };
            // v1 : les séries faites passent au journal, et restent cochées si c'était aujourd'hui.
            if (!(st && st.done) || r == null) return { w, r, at: null };
            const at = day === today ? Date.now() - 1000 + i : base + i;
            log.push({ ex: String(en.exerciseId), w, r, at });
            return { w, r, at: day === today ? at : null };
          }),
        })),
    };
  });

  return {
    version: 2,
    exercises,
    sessions,
    log: log.sort((a, b) => a.at - b.at),
    settings: { rest: clampRest(d.settings && d.settings.rest) },
    imports: Array.isArray(d.imports) ? d.imports.filter(x => typeof x === 'string') : [],
  };
}

function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (err) { console.error(err); }
}

const exById = id => db.exercises.find(e => e.id === id);
const exName = id => (exById(id) || { name: '?' }).name;
const blankSets = n => Array.from({ length: n }, () => ({ w: null, r: null, at: null }));

// Un exercice existe tant qu'une séance ou le journal s'en sert.
function pruneExercises() {
  const used = new Set([...db.sessions.flatMap(s => s.entries.map(en => en.exerciseId)), ...db.log.map(e => e.ex)]);
  const n = db.exercises.length;
  db.exercises = db.exercises.filter(e => used.has(e.id));
  if (db.exercises.length !== n) save();
}

function createExercise(name) {
  name = clean(name);
  const found = db.exercises.find(e => fold(e.name) === fold(name));
  if (found) return found;
  const ex = { id: uid(), name };
  db.exercises.push(ex);
  return ex;
}

/* ---------- Journal ---------- */

const logIndex = (exId, st) => db.log.findIndex(e => e.ex === exId && e.at === st.at);

function logAdd(exId, st) {
  st.at = Date.now();
  db.log.push({ ex: exId, w: st.w, r: st.r, at: st.at });
}

function logRemove(exId, st) {
  const i = logIndex(exId, st);
  st.at = null;
  return i >= 0 ? db.log.splice(i, 1)[0] : null;
}

function logUpdate(exId, st) {
  const i = logIndex(exId, st);
  if (i >= 0) Object.assign(db.log[i], { w: st.w, r: st.r });
}

// Séries validées d'un exercice, regroupées par jour, la plus récente d'abord.
function workouts(exId) {
  const days = new Map();
  for (const e of db.log) {
    if (e.ex !== exId) continue;
    const k = dayKey(e.at);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  return [...days.entries()].sort((a, b) => cmp(b[0], a[0])).map(([, sets]) => sets.sort((a, b) => a.at - b.at));
}

// La règle du programme : haut de la fourchette sur toutes les séries → monter la charge.
// L'indication disparaît dès qu'une charge plus lourde est prévue.
function goUp(en) {
  const t = en.target;
  if (!t || t.max == null) return false;
  const last = workouts(en.exerciseId)[0];
  if (!last || last.length < t.sets || !last.every(e => e.r >= t.max)) return false;
  const lastW = Math.max(...last.map(e => e.w ?? 0));
  return !en.sets.some(st => st.w != null && st.w > lastW);
}

function addEntry(session, exId) {
  const last = workouts(exId)[0] || [];
  const twin = db.sessions.flatMap(s => s.entries).find(e => e.exerciseId === exId && e.target);
  const en = {
    id: uid(),
    exerciseId: exId,
    target: twin ? { ...twin.target } : null,
    sets: last.length ? last.map(e => ({ w: e.w, r: e.r, at: null })) : blankSets(twin ? twin.target.sets : 1),
  };
  session.entries.push(en);
  return en;
}

// Exercices dont le nom contient la saisie : ceux qui commencent pareil, puis les plus récents.
function matchExercises(q) {
  const fq = fold(q);
  if (!fq) return [];
  const recent = new Map(db.log.map(e => [e.ex, e.at]));
  return db.exercises
    .filter(e => fold(e.name).includes(fq))
    .sort((a, b) => (fold(b.name).startsWith(fq) - fold(a.name).startsWith(fq)) || ((recent.get(b.id) || 0) - (recent.get(a.id) || 0)))
    .slice(0, 5)
    .map(e => e.name);
}

// Ajoute le programme une seule fois, sans toucher à ce qui existe.
function importProgramme() {
  if (typeof PROGRAMME === 'undefined' || db.imports.includes(PROGRAMME.id)) return;
  let at = Date.now() - 24 * 3600 * 1000;
  for (const seance of PROGRAMME.seances) {
    const s = { id: uid(), name: seance.name, entries: [] };
    for (const [name, [n, min, max], given = []] of seance.exercices) {
      const ex = createExercise(name);
      const sets = given.length ? given : Array.from({ length: n }, () => [null, null]);
      s.entries.push({
        id: uid(),
        exerciseId: ex.id,
        target: { sets: n, min, max },
        sets: sets.map(([w, r]) => ({ w, r, at: null })),
      });
      for (const [w, r] of sets) if (r != null) db.log.push({ ex: ex.id, w, r, at: at++ });
    }
    db.sessions.push(s);
  }
  db.imports.push(PROGRAMME.id);
  save();
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
  hideToast();
  route();
  scrollTo(0, restore ? scrollMem[h] || 0 : 0);
});

let renderedDay = '';

function route() {
  renderedDay = dayKey(Date.now());
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
  pruneExercises();
  cur = { view: 'sessions' };
  const rows = db.sessions.map(s => `
    <a class="srow" href="#/s/${s.id}">
      <span>${esc(s.name || 'Sans titre')}</span>
      ${s.entries.some(en => en.sets.some(isDone)) ? '<i class="live" aria-label="en cours"></i>' : ''}
    </a>`).join('');
  app.innerHTML = `
    <header class="top"><span></span><button class="icon" data-act="app-menu" aria-label="Sauvegarde">${I.dots}</button></header>
    <h1>Séances</h1>
    <nav class="slist">${rows || '<p class="empty">Aucune séance.</p>'}</nav>
    <button class="fab" data-act="new-session" aria-label="Nouvelle séance">${I.plus}</button>`;
}

function renderSession(s) {
  cur = { view: 'session', session: s };
  app.innerHTML = `
    <header class="top">${backBtn('/')}<button class="icon" data-act="session-menu" aria-label="Options de la séance">${I.dots}</button></header>
    <h1>${esc(s.name || 'Sans titre')}</h1>
    ${s.entries.map(entryHTML).join('')}
    <button class="addex" data-act="add-exercise">${I.plus}<span>exercice</span></button>`;
}

const targetHTML = en => `${fmtTarget(en.target)}${goUp(en) ? '<span class="up">↑ monter</span>' : ''}`;

function entryHTML(en) {
  const ex = exById(en.exerciseId) || { id: en.exerciseId, name: '?' };
  const target = en.target ? `<p class="target">${targetHTML(en)}</p>` : '';
  const rows = en.sets.map((st, i) => `
    <div class="set${isDone(st) ? ' done' : ''}" data-i="${i}">
      <div class="set-under" aria-hidden="true"><i>${I.minus}</i></div>
      <div class="set-face">
        <div class="vals">
          <input class="num w" data-field="w" inputmode="decimal" autocomplete="off" value="${fmtIn(st.w)}" placeholder="–" aria-label="Charge en kilos, série ${i + 1}">
          <span class="u">kg</span><span class="x">×</span>
          <input class="num r" data-field="r" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${fmtIn(st.r)}" placeholder="–" aria-label="Répétitions, série ${i + 1}">
        </div>
        <button class="dot" data-act="toggle-set" role="switch" aria-checked="${isDone(st)}" aria-label="Série ${i + 1} faite"><i></i></button>
      </div>
    </div>`).join('');
  return `<section class="entry" data-entry="${en.id}">
    <div class="ehead">
      <div><a class="ename" href="#/e/${ex.id}" draggable="false">${esc(ex.name)}</a>${target}</div>
      <button class="icon" data-act="entry-menu" aria-label="Options de l'exercice">${I.dots}</button>
    </div>
    ${rows}
    <button class="addset" data-act="add-set">${I.plus}<span>série</span></button>
  </section>`;
}

function repaintEntry(en) {
  const el = $(`[data-entry="${en.id}"]`);
  if (el) el.outerHTML = entryHTML(en);
}

const entryOf = el => cur.session.entries.find(x => x.id === el.closest('.entry').dataset.entry);
const setIndex = el => Number(el.closest('.set').dataset.i);

function renderExercise(ex) {
  cur = { view: 'exercise', exercise: ex };
  const all = workouts(ex.id);
  const best = all.length ? topSet(all.flat()) : null;
  app.innerHTML = `
    <header class="top">${backBtn('/')}<button class="icon" data-act="exercise-menu" aria-label="Options de l'exercice">${I.dots}</button></header>
    <h1>${esc(ex.name)}</h1>
    <p class="record">${best ? `record<b>${esc(fmtRecord(best))}</b>` : 'aucune série validée'}</p>
    ${all.map(sets => `<div class="hrow">${sets.map(st => `<span>${esc(fmtSet(st))}</span>`).join('')}</div>`).join('')}`;
}

/* ---------- Feuilles ---------- */

let sheetState = null;

// opts : { title, message, body, mount, read, input: { value, placeholder, suggest }, submit: { label, run }, actions }
function sheet(opts) {
  sheetState = opts;
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-wrap">
    <div class="backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      ${opts.title ? `<p class="sheet-title">${esc(opts.title)}</p>` : ''}
      ${opts.message ? `<p class="sheet-msg">${esc(opts.message)}</p>` : ''}
      ${opts.body || ''}
      ${opts.input ? `<div class="sheet-field"><input class="sheet-input" value="${esc(opts.input.value || '')}" placeholder="${esc(opts.input.placeholder || '')}" autocomplete="off" autocorrect="off" autocapitalize="sentences" enterkeyhint="done"></div><div class="sugg" id="sugg"></div>` : ''}
      ${(opts.actions || []).map((a, i) => `<button class="sheet-row${a.danger ? ' danger' : ''}" data-act="sheet-do" data-i="${i}">${esc(a.label)}</button>`).join('')}
      ${opts.submit ? `<button class="go" data-act="sheet-submit">${esc(opts.submit.label)}</button>` : ''}
      <button class="sheet-row cancel" data-act="sheet-close">${esc(opts.cancel || 'annuler')}</button>
    </div>
  </div>`;
  const wrap = root.firstElementChild;
  const focusEl = opts.input ? $('.sheet-input', root) : opts.focus ? $(opts.focus, root) : null;
  if (focusEl) {
    // Ouverte d'emblée : le clavier ne s'affiche que si le focus est pris pendant le geste.
    wrap.classList.add('open');
    focusEl.focus();
    focusEl.setSelectionRange?.(focusEl.value.length, focusEl.value.length);
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
  let v = value;
  if (input) {
    v = (value ?? input.value).trim();
    if (!v) { input.focus(); return; }
  } else if (st.read) {
    v = st.read();
  }
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

/* ---------- Objectif ---------- */

// Séries × fourchette de répétitions, au clavier numérique.
function editTarget(en) {
  const t = en.target || {};
  const field = (k, v) => `<input data-t="${k}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${v ?? ''}" placeholder="–">`;
  sheet({
    title: `${exName(en.exerciseId)} · objectif`,
    body: `<div class="tgt">${field('sets', t.sets)}<span>×</span>${field('min', t.min)}<span>–</span>${field('max', t.max)}<span>rép</span></div>`,
    focus: '.tgt input',
    read: () => {
      const [n, a, b] = [...document.querySelectorAll('#sheet .tgt input')].map(i => Math.round(parseNum(i.value) ?? 0));
      if (!(n >= 1) || !(a >= 1 || b >= 1)) return null;
      const lo = Math.min(a || b, b || a);
      return { sets: n, min: lo, max: Math.max(a, b, lo) };
    },
    actions: en.target ? [{ label: 'sans objectif', run: () => { en.target = null; save(); repaintEntry(en); } }] : [],
    submit: { label: 'ok', run: v => { if (v) { en.target = v; save(); repaintEntry(en); } } },
  });
}

/* ---------- Gestes : glisser pour supprimer, appui long pour réordonner ---------- */

// Événements tactiles plutôt que pointeur : sur iOS, un appui long sur un lien
// ou un début de défilement interrompt les événements pointeur en plein geste.
const HOLD = 400;                // durée de l'appui long, en ms
let g = null;
let swallowUntil = 0;
let lastTouch = 0;
let toastUndo = null;
let toastTimer = 0;

const pt = e => (e.changedTouches ? e.changedTouches[0] : e);

function gestureStart(e) {
  if (e.type === 'mousedown' && (e.button > 0 || Date.now() - lastTouch < 800)) return;
  if (e.touches) {
    lastTouch = Date.now();
    if (e.touches.length > 1) { cancelGesture(); return; }
  }
  if (g || e.target.closest('.sheet-wrap, .dot, .icon')) return;
  const face = e.target.closest('.set-face');
  const head = !face && e.target.closest('.ehead');
  if (!face && !head) return;
  const p = pt(e);
  g = {
    kind: face ? 'set' : 'entry',
    face,
    item: face ? face.closest('.set') : head.closest('.entry'),
    x: p.clientX,
    y: p.clientY,
    mode: 'wait',
  };
  g.timer = setTimeout(startSort, HOLD);
}

function gestureMove(e) {
  if (!g) return;
  const p = pt(e);
  const dx = p.clientX - g.x;
  const dy = p.clientY - g.y;
  if (g.mode === 'wait') {
    if (Math.hypot(dx, dy) < 10) return;
    clearTimeout(g.timer);
    if (g.kind !== 'set' || dx > 0 || Math.abs(dx) < Math.abs(dy)) { g = null; return; }
    g.mode = 'swipe';
    document.activeElement?.blur();
    g.item.classList.add('swiping');
  }
  if (e.cancelable) e.preventDefault();          // la page ne défile pas pendant le geste
  if (g.mode === 'sort') { moveSort(p.clientY); return; }
  const x = Math.min(0, dx);
  g.face.style.transform = `translateX(${x}px)`;
  const armed = -x > Math.min(140, g.item.offsetWidth * 0.4);
  if (armed !== g.item.classList.contains('armed')) {
    g.item.classList.toggle('armed', armed);
    if (armed) navigator.vibrate?.(8);
  }
}

function gestureEnd(e) {
  if (!g) return;
  const s = g;
  g = null;
  clearTimeout(s.timer);
  if (s.mode === 'wait') return;
  // Ni clic ni clavier après un geste.
  if (e.cancelable) e.preventDefault();
  swallowUntil = Date.now() + 400;
  if (s.mode === 'sort') { finishSort(s); return; }
  s.item.classList.remove('swiping');
  if (e.type !== 'touchcancel' && s.item.classList.contains('armed')) {
    deleteSet(s.item);
  } else {
    s.face.style.transform = '';
    s.item.classList.remove('armed');
  }
}

function cancelGesture() {
  if (!g) return;
  gestureEnd({ type: 'touchcancel' });
}

document.addEventListener('touchstart', gestureStart, { passive: true });
document.addEventListener('touchmove', gestureMove, { passive: false });
document.addEventListener('touchend', gestureEnd, { passive: false });
document.addEventListener('touchcancel', gestureEnd, { passive: false });
document.addEventListener('mousedown', gestureStart);
document.addEventListener('mousemove', e => { if (g) gestureMove(e); });
document.addEventListener('mouseup', gestureEnd);
// Pas de menu ni de glisser-déposer natif sur les liens pendant l'appui long.
document.addEventListener('contextmenu', e => { if (g || e.target.closest('.ehead, .set')) e.preventDefault(); });
document.addEventListener('dragstart', e => e.preventDefault());

// Dans une feuille ouverte, la page derrière ne défile pas.
document.addEventListener('touchmove', e => {
  if (e.cancelable && e.target.closest?.('.sheet-wrap') && !e.target.closest('.sugg')) e.preventDefault();
}, { passive: false });

// Appui long : la série, ou l'exercice (la liste se replie sur les noms), suit le doigt.
function startSort() {
  const s = g;
  if (!s || s.mode !== 'wait') return;
  s.mode = 'sort';
  document.activeElement?.blur();
  navigator.vibrate?.(15);
  if (s.kind === 'entry') {
    app.classList.add('sorting');
    // Après repli, l'exercice revient sous le doigt.
    const r = s.item.getBoundingClientRect();
    scrollBy(0, r.top + r.height / 2 - s.y);
  }
  s.list = [...s.item.parentElement.querySelectorAll(s.kind === 'set' ? ':scope > .set' : ':scope > .entry')];
  s.from = s.to = s.list.indexOf(s.item);
  s.rects = s.list.map(el => { const r = el.getBoundingClientRect(); return { mid: r.top + scrollY + r.height / 2, h: r.height }; });
  // Une série garde sa prise ; un exercice replié se place sous le doigt.
  s.grab = s.kind === 'set' ? s.y + scrollY - s.rects[s.from].mid : 0;
  s.item.classList.add('lifted');
  moveSort(s.y);
  s.raf = requestAnimationFrame(autoScroll);
}

function moveSort(y) {
  const s = g;
  s.lastY = y;
  const center = y + scrollY - s.grab;
  s.item.style.transform = `translate3d(0, ${center - s.rects[s.from].mid}px, 0)`;
  let to = 0;
  s.rects.forEach((q, j) => { if (j !== s.from && q.mid < center) to++; });
  if (to === s.to) return;
  s.to = to;
  // Les voisins s'écartent exactement de la hauteur de l'élément porté.
  const h = s.rects[s.from].h;
  s.list.forEach((el, j) => {
    if (j === s.from) return;
    const shift = s.from < to && j > s.from && j <= to ? -h : s.from > to && j >= to && j < s.from ? h : 0;
    el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
  });
  navigator.vibrate?.(5);
}

// Près des bords, la page défile pour atteindre le reste de la liste.
function autoScroll() {
  const s = g;
  if (!s || s.mode !== 'sort') return;
  const edge = 90;
  const bottom = innerHeight - (timerEl.hidden ? 0 : timerEl.offsetHeight) - edge;
  const v = s.lastY < edge ? (s.lastY - edge) / 5 : s.lastY > bottom ? (s.lastY - bottom) / 5 : 0;
  if (v) { scrollBy(0, v); moveSort(s.lastY); }
  s.raf = requestAnimationFrame(autoScroll);
}

function finishSort(s) {
  cancelAnimationFrame(s.raf);
  const en = s.kind === 'set' ? entryOf(s.item) : null;
  const list = en ? en.sets : cur.session.entries;
  const moved = list[s.from];
  if (s.to !== s.from) {
    list.splice(s.from, 1);
    list.splice(s.to, 0, moved);
    save();
  }
  if (en) { repaintEntry(en); return; }
  app.classList.remove('sorting');
  renderSession(cur.session);
  $(`[data-entry="${moved.id}"]`)?.scrollIntoView({ block: 'center' });
}

function deleteSet(row) {
  const en = entryOf(row);
  const i = setIndex(row);
  row.querySelector('.set-face').style.transform = 'translateX(-100%)';
  row.style.height = `${row.offsetHeight}px`;
  requestAnimationFrame(() => { row.style.height = '0px'; });
  setTimeout(() => {
    const [set] = en.sets.splice(i, 1);
    const at = set.at;
    const entry = isDone(set) ? logRemove(en.exerciseId, set) : null;
    save();
    repaintEntry(en);
    toast('Série supprimée', () => {
      if (entry) { set.at = at; db.log.push(entry); }
      en.sets.splice(i, 0, set);
      save();
      repaintEntry(en);
    });
  }, 220);
}

function toast(text, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span><button data-act="undo">annuler</button>`;
  toastUndo = undo;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  const el = $('#toast');
  toastUndo = null;
  clearTimeout(toastTimer);
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 200);
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
      db.settings.rest = clamp(db.settings.rest + delta, STEP, REST_MAX);
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
  const name = `scu-${dayKey(Date.now())}.json`;
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
    sheet({ message: 'Fichier illisible.', cancel: 'ok' });
    return;
  }
  const n = data.sessions.length;
  sheet({
    message: `Remplacer toutes les données par ce fichier (${n} séance${n > 1 ? 's' : ''}) ?`,
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

  'new-session': () => sheet({
    input: { placeholder: 'nom de la séance' },
    submit: {
      label: 'créer',
      run: name => {
        const s = { id: uid(), name: clean(name), entries: [] };
        db.sessions.push(s);
        save();
        go('/s/' + s.id);
      },
    },
  }),

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
    const last = en.sets[en.sets.length - 1];
    en.sets.push({ w: last?.w ?? null, r: last?.r ?? null, at: null });
    save();
    repaintEntry(en);
  },

  'toggle-set': el => {
    const en = entryOf(el);
    const i = setIndex(el);
    const st = en.sets[i];
    if (isDone(st)) {
      logRemove(en.exerciseId, st);
    } else if (st.r == null) {
      // Rien à valider : on tape d'abord les valeurs.
      el.closest('.set').querySelector(`[data-field="${st.w == null ? 'w' : 'r'}"]`).focus();
      return;
    } else {
      logAdd(en.exerciseId, st);
      timer.start(db.settings.rest);
    }
    haptic();
    save();
    repaintEntry(en);
  },

  'entry-menu': el => {
    const s = cur.session;
    const en = entryOf(el);
    const list = [{ label: 'objectif', run: () => editTarget(en) }];
    list.push({
      label: "retirer l'exercice",
      danger: true,
      confirm: `Retirer ${exName(en.exerciseId)} de cette séance ? Son historique est conservé.`,
      confirmLabel: 'retirer',
      run: () => { s.entries.splice(s.entries.indexOf(en), 1); save(); renderSession(s); },
    });
    sheet({ title: exName(en.exerciseId), actions: list });
  },

  'session-menu': () => {
    const s = cur.session;
    sheet({
      title: s.name || 'Sans titre',
      actions: [
        {
          label: 'renommer',
          run: () => sheet({
            input: { value: s.name, placeholder: 'nom de la séance' },
            submit: { label: 'enregistrer', run: v => { s.name = clean(v); save(); route(); } },
          }),
        },
        {
          label: 'supprimer la séance',
          danger: true,
          confirm: 'Supprimer cette séance ? L’historique des exercices est conservé.',
          confirmLabel: 'supprimer',
          run: () => { db.sessions = db.sessions.filter(x => x !== s); save(); back('/'); },
        },
      ],
    });
  },

  'exercise-menu': () => {
    const ex = cur.exercise;
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
          confirm: `Supprimer ${ex.name} de toutes les séances, avec son historique ?`,
          confirmLabel: 'supprimer',
          run: () => {
            db.exercises = db.exercises.filter(x => x !== ex);
            for (const s of db.sessions) s.entries = s.entries.filter(en => en.exerciseId !== ex.id);
            db.log = db.log.filter(e => e.ex !== ex.id);
            save();
            back('/');
          },
        },
      ],
    });
  },

  'app-menu': () => sheet({
    title: 'Sauvegarde',
    message: 'Les données restent sur ce téléphone.',
    actions: [
      { label: 'exporter', run: exportData },
      { label: 'importer', run: () => $('#file').click() },
    ],
  }),

  undo: () => { const u = toastUndo; hideToast(); u?.(); },

  'sheet-do': el => runSheetAction(Number(el.dataset.i)),
  'sheet-submit': () => submitSheet(),
  'sheet-pick': el => submitSheet(el.dataset.name),
  'sheet-close': closeSheet,

  't-toggle': () => { haptic(); timer.running() ? timer.stop() : timer.start(db.settings.rest); },
  't-minus': () => timer.adjust(-STEP),
  't-plus': () => timer.adjust(STEP),
};

document.addEventListener('click', e => {
  if (Date.now() < swallowUntil) { e.preventDefault(); return; }
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});

document.addEventListener('input', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (f === 'w' || f === 'r') {
    const en = entryOf(el);
    const st = en.sets[setIndex(el)];
    let n = parseNum(el.value);
    if (f === 'r' && n != null) n = Math.round(n);
    st[f] = n;
    if (isDone(st)) logUpdate(en.exerciseId, st);
    save();
  } else if (el.matches('.sheet-input') && sheetState?.input?.suggest) {
    paintSuggestions(el.value);
  }
});

// En quittant un champ : valeur remise au propre, séries suivantes mises à jour.
document.addEventListener('change', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (f !== 'w' && f !== 'r') return;
  const sec = el.closest('.entry');
  const en = entryOf(el);
  const i = setIndex(el);
  const v = en.sets[i][f];
  el.value = fmtIn(v);
  const old = el.dataset.old === '' ? null : Number(el.dataset.old);
  en.sets.slice(i + 1).forEach((o, k) => {
    if (isDone(o) || v == null) return;
    // La charge suit si elle était identique ; les cases vides se remplissent.
    if (o[f] == null || (f === 'w' && o.w === old)) {
      o[f] = v;
      sec.querySelector(`.set[data-i="${i + 1 + k}"] [data-field="${f}"]`).value = fmtIn(v);
    }
  });
  save();
  const t = sec.querySelector('.target');
  if (t && en.target) t.innerHTML = targetHTML(en);
});

document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches('.num, .tgt input')) return;
  if (el.matches('.num')) {
    const st = entryOf(el).sets[setIndex(el)];
    el.dataset.old = st[el.dataset.field] ?? '';
  }
  el._focusedAt = Date.now();
  selectAll(el);
});

// Toucher un champ sélectionne sa valeur : taper la remplace. Refait après le toucher,
// qui place sinon le curseur à l'endroit touché.
const selectAll = el => setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch {} }, 0);
document.addEventListener('mouseup', e => {
  const el = e.target;
  if (el.matches?.('.num, .tgt input') && Date.now() - (el._focusedAt || 0) < 500) selectAll(el);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetState) closeSheet();
  if (e.key !== 'Enter') return;
  if (e.target.matches('#sheet input')) { e.preventDefault(); submitSheet(); }
  else if (e.target.matches('.num')) e.target.blur();
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
  // Le lendemain, les coches de la veille s'effacent.
  if (dayKey(Date.now()) !== renderedDay && !sheetState) route();
  swReg?.update().catch(() => {});
});
window.addEventListener('pagehide', flush);

/* ---------- Démarrage ---------- */

let swReg = null;

importProgramme();
pruneExercises();
flush();
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
