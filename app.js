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
const ROW = 44;                  // hauteur d'un cran de molette, en px

const KG = Array.from({ length: 401 }, (_, i) => i);
const KG_DEC = [0, 0.25, 0.5, 0.75];
const KG_DEC_LABELS = [',0', ',25', ',5', ',75'];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

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

function entryHTML(en) {
  const ex = exById(en.exerciseId) || { id: en.exerciseId, name: '?' };
  const target = en.target
    ? `<p class="target">${fmtTarget(en.target)}${goUp(en) ? '<span class="up">↑ monter</span>' : ''}</p>`
    : '';
  const rows = en.sets.map((st, i) => `
    <div class="set${isDone(st) ? ' done' : ''}" data-i="${i}">
      <div class="set-under" aria-hidden="true"><i>${I.minus}</i></div>
      <div class="set-face">
        <button class="vals" data-act="edit-set" aria-label="Série ${i + 1} : ${st.w ?? '?'} kilos, ${st.r ?? '?'} répétitions">
          <span class="w${st.w == null ? ' nil' : ''}">${fmt(st.w)}</span><span class="u">kg</span><span class="x">×</span><span class="r${st.r == null ? ' nil' : ''}">${fmt(st.r)}</span>
        </button>
        <button class="dot" data-act="toggle-set" role="switch" aria-checked="${isDone(st)}" aria-label="Série ${i + 1} faite"><i></i></button>
      </div>
    </div>`).join('');
  return `<section class="entry" data-entry="${en.id}">
    <div class="ehead">
      <div><a class="ename" href="#/e/${ex.id}">${esc(ex.name)}</a>${target}</div>
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
  opts.mount?.(wrap);
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

/* ---------- Molettes ---------- */

const wheelHTML = (name, labels, sel) => `<div class="wheel ${name}" data-sel="${sel}">
  <div class="wpad"></div>${labels.map((l, i) => `<div class="witem${i === sel ? ' on' : ''}">${l}</div>`).join('')}<div class="wpad"></div>
</div>`;
const wheelIndex = w => clamp(Math.round(w.scrollTop / ROW), 0, w.children.length - 3);
const mountWheels = wrap => wrap.querySelectorAll('.wheel').forEach(el => { el.scrollTop = Number(el.dataset.sel) * ROW; });
const readWheels = () => [...document.querySelectorAll('#sheet .wheel')].map(wheelIndex);

// Charge et répétitions d'une série ; « then » s'exécute après validation.
function editSet(en, i, then) {
  const st = en.sets[i];
  const prev = en.sets[i - 1] || {};
  const w = clamp(Math.round((st.w ?? prev.w ?? 20) * 4) / 4, 0, 400.75);
  const r = clamp(st.r ?? prev.r ?? en.target?.min ?? 10, 1, 100);
  sheet({
    title: `${exName(en.exerciseId)} · série ${i + 1}`,
    body: `<div class="picker">
      <div class="band"></div>
      ${wheelHTML('kg', KG.map(String), Math.floor(w))}
      ${wheelHTML('dec', KG_DEC_LABELS, KG_DEC.indexOf(w - Math.floor(w)))}
      <span class="plabel">kg</span>
      <span class="plabel x">×</span>
      ${wheelHTML('reps', range(1, 100).map(String), r - 1)}
      <span class="plabel">rép</span>
    </div>`,
    mount: mountWheels,
    read: () => { const [k, d, n] = readWheels(); return { w: KG[k] + KG_DEC[d], r: n + 1 }; },
    submit: {
      label: 'ok',
      run: v => {
        const old = { w: st.w, r: st.r };
        Object.assign(st, v);
        // Les séries suivantes suivent le changement de charge.
        for (const o of en.sets.slice(i + 1)) {
          if (isDone(o)) continue;
          if (o.w == null && o.r == null) Object.assign(o, v);
          else if (o.w === old.w) o.w = v.w;
        }
        if (isDone(st)) logUpdate(en.exerciseId, st);
        then?.();
        save();
        repaintEntry(en);
      },
    },
  });
}

// Objectif d'un exercice : séries × fourchette de répétitions.
function editTarget(en) {
  const t = en.target || { sets: en.sets.length || 3, min: 8, max: 12 };
  const reps = range(1, 50).map(String);
  sheet({
    title: `${exName(en.exerciseId)} · objectif`,
    body: `<div class="picker">
      <div class="band"></div>
      ${wheelHTML('n', range(1, 10).map(String), clamp(t.sets, 1, 10) - 1)}
      <span class="plabel x">×</span>
      ${wheelHTML('n', reps, clamp(t.min ?? 8, 1, 50) - 1)}
      <span class="plabel x">–</span>
      ${wheelHTML('n', reps, clamp(t.max ?? 12, 1, 50) - 1)}
      <span class="plabel">rép</span>
    </div>`,
    mount: mountWheels,
    read: () => { const [n, a, b] = readWheels(); return { sets: n + 1, min: Math.min(a, b) + 1, max: Math.max(a, b) + 1 }; },
    actions: en.target ? [{ label: 'sans objectif', run: () => { en.target = null; save(); repaintEntry(en); } }] : [],
    submit: { label: 'ok', run: v => { en.target = v; save(); repaintEntry(en); } },
  });
}

// La valeur au centre de la molette s'affiche en noir.
document.addEventListener('scroll', e => {
  const w = e.target;
  if (!w.classList?.contains('wheel')) return;
  const i = wheelIndex(w);
  if (w._sel === i) return;
  w._sel = i;
  w.querySelector('.witem.on')?.classList.remove('on');
  w.children[i + 1].classList.add('on');
}, true);

/* ---------- Glisser pour supprimer une série ---------- */

let drag = null;
let swallowClick = false;
let toastUndo = null;
let toastTimer = 0;

document.addEventListener('pointerdown', e => {
  const face = e.target.closest('.set-face');
  if (!face || drag || e.button > 0) return;
  drag = { face, row: face.closest('.set'), x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
});

document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
    if (dx > -10 || Math.abs(dx) < Math.abs(dy)) return;
    drag.on = true;
    drag.face.setPointerCapture?.(e.pointerId);
    drag.row.classList.add('swiping');
  }
  const x = Math.min(0, dx);
  drag.face.style.transform = `translateX(${x}px)`;
  const armed = -x > Math.min(140, drag.row.offsetWidth * 0.4);
  if (armed !== drag.row.classList.contains('armed')) {
    drag.row.classList.toggle('armed', armed);
    if (armed) navigator.vibrate?.(8);
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { face, row, on } = drag;
  drag = null;
  if (!on) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
  row.classList.remove('swiping');
  if (e.type === 'pointerup' && row.classList.contains('armed')) {
    deleteSet(row);
  } else {
    face.style.transform = '';
    row.classList.remove('armed');
  }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

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

  'edit-set': el => editSet(entryOf(el), setIndex(el)),

  'toggle-set': el => {
    const en = entryOf(el);
    const i = setIndex(el);
    const st = en.sets[i];
    const done = () => { logAdd(en.exerciseId, st); timer.start(db.settings.rest); };
    if (isDone(st)) {
      logRemove(en.exerciseId, st);
    } else if (st.r == null) {
      // Rien à valider : on choisit d'abord les valeurs.
      editSet(en, i, done);
      return;
    } else {
      done();
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
    const list = [{ label: 'objectif', run: () => editTarget(en) }];
    if (i > 0) list.push({ label: 'monter', run: move(-1) });
    if (i < s.entries.length - 1) list.push({ label: 'descendre', run: move(1) });
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
  if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
  const item = e.target.closest('.witem');
  if (item) {
    const w = item.parentElement;
    w.scrollTo({ top: ([...w.children].indexOf(item) - 1) * ROW, behavior: 'smooth' });
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});

document.addEventListener('input', e => {
  if (e.target.matches('.sheet-input') && sheetState?.input?.suggest) paintSuggestions(e.target.value);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetState) closeSheet();
  if (e.key === 'Enter' && e.target.matches('.sheet-input')) { e.preventDefault(); submitSheet(); }
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
