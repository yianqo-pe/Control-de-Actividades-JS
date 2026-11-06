/* =====================================================================
   JESSDAY STYLE · Control de tiempo
   ---------------------------------------------------------------------
   - Datos en Firebase (Auth con Google + Firestore), compartidos entre
     las personas autorizadas en firestore.rules
   - Cronómetro activo guardado en localStorage (sobrevive a recargas)
   - Zona horaria fija: America/Lima · Semana inicia el lunes
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ============ 1. CONFIGURACIÓN (pega aquí los datos de tu proyecto Firebase) ============ */
const firebaseConfig = {
  apiKey: "AIzaSyAU-jsjwd5Mq7AKIefBrbOIGRq5nJSVB5w",
  authDomain: "control-de-trabajo-jd-5df64.firebaseapp.com",
  projectId: "control-de-trabajo-jd-5df64",
  storageBucket: "control-de-trabajo-jd-5df64.firebasestorage.app",
  messagingSenderId: "985506577074",
  appId: "1:985506577074:web:8023990d171cfbc36be7ab"
};

const TZ = "America/Lima";
const FB_READY = !String(firebaseConfig.apiKey).startsWith("PEGA");

const DEFAULT_CATS = [
  { id: "live",        name: "Emisión LIVE (TikTok)",                          emoji: "📡", color: "#d9667a" },
  { id: "contenido",   name: "Elaboración de contenido y videos",              emoji: "🎬", color: "#b983c6" },
  { id: "registro",    name: "Registro de actividades generales",              emoji: "📋", color: "#c9a66b" },
  { id: "empaquetado", name: "Empaquetado y envíos",                           emoji: "📦", color: "#7fa6c9" },
  { id: "compras",     name: "Compras a proveedores",                          emoji: "🛍️", color: "#7fb89a" },
  { id: "inventario",  name: "Gestión de inventario",                          emoji: "🗂️", color: "#e0a36b" },
  { id: "stock",       name: "Gestión de stock (prendas liberadas / devueltas)", emoji: "📊", color: "#8c8f9c" }
];
const PALETTE = ["#d9667a", "#e9a0a8", "#b983c6", "#7fa6c9", "#7fb89a", "#c9a66b", "#e0a36b", "#8c8f9c", "#a8505e", "#1c1917"];
const EMOJIS = ["📡", "🎬", "📋", "📦", "🛍️", "🗂️", "📊", "✂️", "👗", "📸", "💬", "🧾"];

/* ============ 2. FIREBASE ============ */
let auth, db;
if (FB_READY) {
  const fbApp = initializeApp(firebaseConfig);
  auth = getAuth(fbApp);
  try {
    // Caché local: la app sigue funcionando sin señal y sincroniza al volver
    db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = getFirestore(fbApp);
  }
}

/* ============ 3. UTILIDADES ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = n => String(n || "").trim().split(/\s+/)[0] || "—";

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fecha y hora actuales en Lima: { date: 'YYYY-MM-DD', time: 'HH:MM' } */
function limaParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const todayStr = () => limaParts().date;

// Aritmética de fechas en UTC sobre cadenas 'YYYY-MM-DD' (sin problemas de zona horaria)
const toDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); };
const dayIndex = s => Math.round(toDate(s).getTime() / 86400000);
const weekStart = s => addDays(s, -((toDate(s).getUTCDay() + 6) % 7)); // lunes
const monthStart = s => s.slice(0, 8) + "01";
const monthEnd = s => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return fromDate(d); };
const addMonths = (s, n) => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return fromDate(d); };

const fmtHistDate = s => { const [y, m, d] = s.split("-"); return `${DOW[toDate(s).getUTCDay()]}. ${d}/${m}/${y.slice(2)}`; };
const fmtShort = s => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
const fmtDur = min => `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
const fmtHours = min => `${(min / 60).toFixed(1).replace(/\.0$/, "")} h`;
const fmtClock = ms => { const t = Math.floor(ms / 1000); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`; };

const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const minToTime = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
/** Duración en minutos; si fin < inicio se asume que cruza la medianoche (22:00 → 01:30 = 3h 30m) */
function calcDuration(start, end) {
  const s = toMin(start), e = toMin(end);
  if (e === s) return 0;
  return e < s ? e + 1440 - s : e - s;
}

/* ============ 4. ESTADO ============ */
const state = {
  user: null, users: [], categories: [], entries: [], goal: 0,
  tab: "panel", range: "hoy", weekAnchor: weekStart(todayStr()), monthAnchor: monthStart(todayStr()),
  person: "all", regMode: "cron", filters: { cat: "", from: "", to: "" }, limit: 60,
  unsubs: []
};

const catInfo = e => {
  const c = state.categories.find(x => x.id === e.categoryId);
  if (c) return { name: c.name, emoji: c.emoji, color: c.color };
  return { name: e.catName || "Sin categoría", emoji: e.catEmoji || "🏷️", color: e.catColor || "#b8a99a" };
};

function entriesIn(from, to, person = state.person) {
  return state.entries.filter(e => e.date >= from && e.date <= to && (person === "all" || e.uid === person));
}
function summarize(list) {
  const map = new Map();
  let total = 0;
  list.forEach(e => {
    total += e.durationMin;
    const cur = map.get(e.categoryId) || { key: e.categoryId, info: catInfo(e), min: 0 };
    cur.min += e.durationMin;
    map.set(e.categoryId, cur);
  });
  return { total, count: list.length, byCat: [...map.values()].sort((a, b) => b.min - a.min) };
}
function streaks(uid) {
  const set = new Set(state.entries.filter(e => e.uid === uid).map(e => e.date));
  const today = todayStr();
  let cur = 0, d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  [...set].sort().forEach(s => { run = prev && addDays(prev, 1) === s ? run + 1 : 1; best = Math.max(best, run); prev = s; });
  return { cur, best, todayDone: set.has(today) };
}

/* ============ 5. AVISOS Y MODALES ============ */
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), type === "error" ? 5000 : 2800);
}

let modalPrevFocus = null;
function showModal(html) {
  modalPrevFocus = document.activeElement;
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-backdrop><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</div></div>`;
  $("#modal-root .modal").querySelector("input:not([type=hidden]),select,textarea,button")?.focus();
}
function closeModal() {
  $("#modal-root").innerHTML = "";
  modalPrevFocus?.focus?.();
}
function modalHead(title) {
  return `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button></div>`;
}
function confirmModal(message, { okText = "Aceptar", danger = false } = {}) {
  return new Promise(resolve => {
    const root = $("#confirm-root");
    const prev = document.activeElement;
    root.innerHTML = `<div class="modal-backdrop" data-cb><div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
      <p id="confirm-msg" class="confirm-msg">${esc(message)}</p>
      <div class="btn-row"><button class="btn btn-ghost" data-c="no">Cancelar</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-c="yes">${esc(okText)}</button></div></div></div>`;
    const done = v => { root.innerHTML = ""; document.removeEventListener("keydown", onKey, true); prev?.focus?.(); resolve(v); };
    const onKey = e => { if (e.key === "Escape") { e.stopImmediatePropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    $('[data-c="yes"]', root).addEventListener("click", () => done(true));
    $('[data-c="no"]', root).addEventListener("click", () => done(false));
    $("[data-cb]", root).addEventListener("click", e => { if (e.target === e.currentTarget) done(false); });
    $('[data-c="no"]', root).focus();
  });
}

/* ============ 6. CRONÓMETRO (localStorage) ============ */
const timerKey = () => `jessday.timer.${state.user.uid}`;
function loadTimer() {
  if (!state.user) return null;
  try { return JSON.parse(localStorage.getItem(timerKey())); } catch { return null; }
}
function saveTimer(t) {
  try { t ? localStorage.setItem(timerKey(), JSON.stringify(t)) : localStorage.removeItem(timerKey()); } catch { /* almacenamiento bloqueado */ }
}
const elapsed = t => t.accumMs + (t.running ? Date.now() - t.startedAt : 0);
function lastCat() {
  let id = null;
  try { id = localStorage.getItem("jessday.lastcat"); } catch { /* nada */ }
  return state.categories.some(c => c.id === id) ? id : state.categories[0]?.id;
}
setInterval(() => {
  const t = loadTimer();
  $$("[data-clock]").forEach(el => { el.textContent = t ? fmtClock(elapsed(t)) : "00:00:00"; });
}, 1000);

/* ============ 7. VISTAS ============ */
const bar = (pct, color) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%;background:${color}"></span></div>`;

function catBars(s) {
  if (!s.total) return "";
  return `<div class="cats">${s.byCat.map(c => {
    const pct = Math.round(c.min / s.total * 100);
    return `<div class="catrow"><div class="catrow-top"><span>${esc(c.info.emoji)} ${esc(c.info.name)}</span><span>${fmtDur(c.min)} · ${pct}%</span></div>${bar(pct, c.info.color)}</div>`;
  }).join("")}</div>`;
}

function personChips() {
  if (state.users.length < 2) return "";
  const me = state.user.uid;
  const users = [...state.users].sort((a, b) => (b.id === me) - (a.id === me));
  const opts = [["all", "Ambas"], ...users.map(u => [u.id, u.id === me ? "Yo" : first(u.name)])];
  return `<div class="chips-row" role="group" aria-label="Persona">${opts.map(([v, l]) =>
    `<button class="pill" data-action="person" data-value="${esc(v)}" aria-pressed="${state.person === v}">${esc(l)}</button>`).join("")}</div>`;
}

function timerBanner() {
  const t = loadTimer();
  if (!t) return "";
  const c = catInfo(t);
  return `<div class="banner" style="--c:${c.color}"><div><p class="muted" style="color:#e5d9cf">${t.running ? "Cronómetro en curso" : "Cronómetro en pausa"}</p><p>${esc(c.emoji)} ${esc(c.name)}</p></div>
    <div style="text-align:right"><p class="clock-s" data-clock>${fmtClock(elapsed(t))}</p><button class="btn btn-gold btn-sm" data-action="goto-register">Abrir</button></div></div>`;
}

function streakCard() {
  const s = streaks(state.user.uid);
  const msg = s.cur === 0 ? "Registra una actividad hoy para empezar tu racha."
    : s.todayDone ? "¡Hoy ya cuenta! Sigue así." : "Registra algo hoy para no perder tu racha.";
  return `<article class="card"><div class="card-head"><h2>🔥 Mi racha</h2><strong style="font-family:var(--serif);font-size:1.6rem">${s.cur} ${s.cur === 1 ? "día" : "días"}</strong></div>
    <p class="muted">${msg} · Mejor racha: ${s.best} ${s.best === 1 ? "día" : "días"}</p></article>`;
}

function goalCard(ws) {
  if (!state.goal) {
    return `<article class="card"><h2>🎯 Meta semanal</h2><p class="muted">Define cuántas horas quieres dedicar por semana y verás tu avance aquí.</p><button class="btn btn-ghost" data-action="tab" data-value="ajustes">Configurar meta</button></article>`;
  }
  const mine = entriesIn(ws, addDays(ws, 6), state.user.uid).reduce((a, e) => a + e.durationMin, 0);
  const goalMin = Math.round(state.goal * 60);
  const pct = Math.min(100, Math.round(mine / goalMin * 100));
  const left = goalMin - mine;
  return `<article class="card"><div class="card-head"><h2>🎯 Mi meta semanal</h2><strong>${pct}%</strong></div>${bar(pct, "var(--gold)")}
    <p class="muted">${fmtDur(mine)} de ${fmtHours(goalMin)} ${left > 0 ? `· te faltan ${fmtDur(left)}` : "· ¡meta cumplida! 🎉"}</p></article>`;
}

function emptyState(text, withBtn = true) {
  return `<article class="card empty"><span class="em" aria-hidden="true">🌸</span><p>${text}</p>${withBtn ? `<button class="btn btn-primary" data-action="goto-register">Registrar actividad</button>` : ""}</article>`;
}

function viewPanel() {
  const today = todayStr();
  const r = state.range;
  let html = `<div class="stack">${timerBanner()}
    <div class="seg" role="group" aria-label="Periodo">${[["hoy", "Hoy"], ["semana", "Semana"], ["mes", "Mes"]].map(([v, l]) =>
      `<button class="seg-btn" data-action="range" data-value="${v}" aria-pressed="${r === v}">${l}</button>`).join("")}</div>${personChips()}`;

  if (r === "hoy") {
    const s = summarize(entriesIn(today, today));
    html += s.count ? `<article class="card hero"><p class="eyebrow">Hoy · ${fmtHistDate(today)}</p>
        <p class="big">${fmtDur(s.total)}</p><p class="muted">${s.count} ${s.count === 1 ? "actividad" : "actividades"} registradas</p>${catBars(s)}</article>`
      : emptyState("Aún no registras actividades hoy. ¡Empieza con el cronómetro!");
    html += streakCard() + goalCard(weekStart(today));
  }

  if (r === "semana") {
    const ws = state.weekAnchor, we = addDays(ws, 6);
    const list = entriesIn(ws, we);
    const s = summarize(list);
    const days = [...Array(7)].map((_, i) => {
      const d = addDays(ws, i);
      return { d, min: list.filter(e => e.date === d).reduce((a, e) => a + e.durationMin, 0), name: DOW[(i + 1) % 7] };
    });
    const max = Math.max(1, ...days.map(x => x.min));
    html += `<div class="nav-row"><button class="icon-btn" data-action="prev" aria-label="Semana anterior">‹</button>
      <strong>${fmtShort(ws)} – ${fmtShort(we)}${ws === weekStart(today) ? " (esta semana)" : ""}</strong>
      <button class="icon-btn" data-action="next" aria-label="Semana siguiente">›</button></div>
      <article class="card hero"><p class="eyebrow">Total de la semana</p><p class="big">${fmtDur(s.total)}</p>
      <div class="stats"><div class="stat"><strong>${s.count}</strong><span>actividades</span></div>
        <div class="stat"><strong>${days.filter(x => x.min).length}</strong><span>días activos</span></div>
        <div class="stat"><strong>${fmtHours(Math.round(s.total / 7))}</strong><span>prom. diario</span></div></div>
      <div class="days" role="img" aria-label="Horas por día de la semana">${days.map(x =>
        `<div class="day${x.d === today ? " today" : ""}"><span class="day-val">${x.min ? (x.min / 60).toFixed(1) : ""}</span><span class="day-bar" style="height:${x.min ? Math.max(8, Math.round(x.min / max * 100)) : 3}%"></span><span class="day-name">${x.name}</span></div>`).join("")}</div>
      ${catBars(s) || '<p class="muted">Sin registros esta semana.</p>'}</article>
      ${goalCard(ws)}${streakCard()}
      <button class="btn btn-wa btn-block" data-action="share-week">📲 Compartir resumen por WhatsApp</button>`;
  }

  if (r === "mes") {
    const ms = state.monthAnchor, me = monthEnd(ms);
    const s = summarize(entriesIn(ms, me));
    const active = new Set(entriesIn(ms, me).map(e => e.date)).size;
    const [y, m] = ms.split("-").map(Number);
    html += `<div class="nav-row"><button class="icon-btn" data-action="prev" aria-label="Mes anterior">‹</button>
      <strong>${MONTHS[m - 1]} ${y}</strong><button class="icon-btn" data-action="next" aria-label="Mes siguiente">›</button></div>
      <article class="card hero"><p class="eyebrow">Total del mes</p><p class="big">${fmtDur(s.total)}</p>
      <div class="stats"><div class="stat"><strong>${s.count}</strong><span>actividades</span></div>
        <div class="stat"><strong>${active}</strong><span>días activos</span></div>
        <div class="stat"><strong>${active ? fmtHours(Math.round(s.total / active)) : "0 h"}</strong><span>prom. por día activo</span></div></div>
      ${catBars(s) || '<p class="muted">Sin registros este mes.</p>'}</article>`;
  }
  return html + "</div>";
}

/* --- Formulario de registro (manual y edición) --- */
function catOptions(selectedId, entry) {
  let opts = state.categories.map(c => `<option value="${esc(c.id)}"${c.id === selectedId ? " selected" : ""}>${esc(c.emoji)} ${esc(c.name)}</option>`);
  if (entry && selectedId && !state.categories.some(c => c.id === selectedId)) {
    opts.unshift(`<option value="${esc(selectedId)}" selected>${esc(entry.catEmoji || "🏷️")} ${esc(entry.catName || "Categoría")} (eliminada)</option>`);
  }
  return opts.join("");
}
function entryFormHTML(p, v, submitText) {
  return `<form data-form="entry" data-prefix="${p}" class="form" novalidate>
    <input type="hidden" name="id" value="${esc(v.id || "")}">
    <label for="${p}date">Fecha</label><input id="${p}date" name="date" type="date" required value="${esc(v.date)}">
    <div class="row2">
      <div><label for="${p}start">Hora de inicio</label><input id="${p}start" name="start" type="time" required value="${esc(v.start || "")}"></div>
      <div><label for="${p}end">Hora de fin</label><input id="${p}end" name="end" type="time" required value="${esc(v.end || "")}"></div>
    </div>
    <p class="preview" id="${p}preview" aria-live="polite"></p>
    <label for="${p}cat">Categoría</label><select id="${p}cat" name="categoryId" required>${catOptions(v.categoryId, v)}</select>
    <label for="${p}note">Nota (opcional)</label><textarea id="${p}note" name="note" rows="2" maxlength="300" placeholder="Ej. Live de vestidos de temporada">${esc(v.note || "")}</textarea>
    <button class="btn btn-primary btn-block" type="submit">${submitText}</button></form>`;
}
function updatePreview(f) {
  const p = f.dataset.prefix, el = $("#" + p + "preview");
  const s = f.elements.start.value, e = f.elements.end.value;
  if (!el) return;
  el.classList.remove("err");
  if (!s || !e) { el.textContent = ""; return; }
  const d = calcDuration(s, e);
  if (!d) { el.textContent = "La hora de inicio y la de fin no pueden ser iguales."; el.classList.add("err"); return; }
  el.textContent = `Duración: ${fmtDur(d)}${toMin(e) < toMin(s) ? " · cruza la medianoche 🌙" : ""}`;
}
const refreshPreviews = () => $$('form[data-form="entry"]').forEach(updatePreview);

function timerStartCard() {
  if (!state.categories.length) return emptyState("Primero crea una categoría en Ajustes.", false);
  return `<article class="card"><h2>Nuevo cronómetro</h2><p class="muted">Elige la actividad y presiona Iniciar. Si cierras la página, el cronómetro se recupera.</p>
    <fieldset class="chips"><legend class="sr">Categoría</legend>${state.categories.map(c =>
      `<label class="chip" style="--c:${c.color}"><input type="radio" name="tcat" value="${esc(c.id)}"${c.id === lastCat() ? " checked" : ""}><span>${esc(c.emoji)} ${esc(c.name)}</span></label>`).join("")}</fieldset>
    <div class="form"><label for="t-note">Nota (opcional)</label><input id="t-note" type="text" maxlength="300" placeholder="Ej. Live de blusas nuevas"></div>
    <button class="btn btn-primary btn-block btn-lg" data-action="timer-start">▶ Iniciar</button></article>`;
}
function timerRunningCard(t) {
  const c = catInfo(t);
  return `<article class="card timer-card" style="--c:${c.color}"><p class="eyebrow">${t.running ? "En curso" : "En pausa"}</p>
    <h2>${esc(c.emoji)} ${esc(c.name)}</h2><p class="clock" data-clock>${fmtClock(elapsed(t))}</p>
    <div class="form"><label for="t-note-live">Nota</label><input id="t-note-live" data-timer-note type="text" maxlength="300" value="${esc(t.note || "")}"></div>
    <div class="btn-row"><button class="btn btn-gold" data-action="timer-toggle">${t.running ? "⏸ Pausar" : "▶ Reanudar"}</button><button class="btn btn-primary" data-action="timer-finish">⏹ Finalizar</button></div>
    <button class="btn btn-ghost btn-block" data-action="timer-discard">Descartar</button></article>`;
}
function viewRegister() {
  const t = loadTimer();
  const seg = `<div class="seg" role="group" aria-label="Modo de registro">
    <button class="seg-btn" data-action="reg-mode" data-value="cron" aria-pressed="${state.regMode === "cron"}">⏱️ Cronómetro</button>
    <button class="seg-btn" data-action="reg-mode" data-value="manual" aria-pressed="${state.regMode === "manual"}">✍️ Manual</button></div>`;
  const body = state.regMode === "cron"
    ? (t ? timerRunningCard(t) : timerStartCard())
    : `<article class="card"><h2>Registro manual</h2><p class="muted">Anota una actividad que ya hiciste. Si termina antes de que empiece (ej. 22:00 a 01:30), se cuenta como que cruza la medianoche.</p>
       ${entryFormHTML("man-", { date: todayStr(), start: "", end: "", categoryId: lastCat(), note: "" }, "Guardar registro")}</article>`;
  return `<div class="stack">${seg}${body}</div>`;
}

/* --- Historial --- */
function entryCard(e) {
  const c = catInfo(e), mine = e.uid === state.user.uid;
  return `<article class="entry" style="--c:${c.color}"><div class="entry-main"><span class="entry-emoji" aria-hidden="true">${esc(c.emoji)}</span>
    <div><h4>${esc(c.name)}</h4><p class="muted">${esc(e.start)} – ${esc(e.end)}${e.crossesMidnight ? " (+1 día)" : ""} · <strong>${fmtDur(e.durationMin)}</strong></p>
    ${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}${state.users.length > 1 ? `<span class="tag">${esc(first(e.userName))}</span>` : ""}</div></div>
    ${mine ? `<div class="entry-actions"><button class="icon-btn" data-action="edit-entry" data-id="${esc(e.id)}" aria-label="Editar registro">✏️</button><button class="icon-btn" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Eliminar registro">🗑️</button></div>` : ""}</article>`;
}
function filteredEntries() {
  const f = state.filters;
  return state.entries
    .filter(e => (state.person === "all" || e.uid === state.person) && (!f.cat || e.categoryId === f.cat) && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to))
    .sort((a, b) => (a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date)));
}
function viewHistory() {
  const f = state.filters;
  const list = filteredEntries();
  const total = list.reduce((a, e) => a + e.durationMin, 0);
  const shown = list.slice(0, state.limit);
  const groups = new Map();
  shown.forEach(e => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
  const catSel = `<option value="">Todas</option>` + state.categories.map(c => `<option value="${esc(c.id)}"${f.cat === c.id ? " selected" : ""}>${esc(c.emoji)} ${esc(c.name)}</option>`).join("");
  return `<div class="stack">${personChips()}
    <article class="card"><div class="filters">
      <div class="full"><label for="f-cat">Categoría</label><select id="f-cat" data-filter="cat">${catSel}</select></div>
      <div><label for="f-from">Desde</label><input id="f-from" type="date" data-filter="from" value="${esc(f.from)}"></div>
      <div><label for="f-to">Hasta</label><input id="f-to" type="date" data-filter="to" value="${esc(f.to)}"></div></div>
      <div class="card-head"><p class="muted"><strong>${list.length}</strong> registros · <strong>${fmtDur(total)}</strong></p>
      <button class="btn btn-ghost btn-sm" data-action="clear-filters">Limpiar filtros</button></div></article>
    ${list.length ? [...groups].map(([d, items]) => `<div class="day-head"><h3>${fmtHistDate(d)}</h3><span class="muted">${fmtDur(items.reduce((a, e) => a + e.durationMin, 0))}</span></div>${items.map(entryCard).join("")}`).join("")
      : emptyState("No hay registros con estos filtros.", false)}
    ${list.length > state.limit ? `<button class="btn btn-ghost btn-block" data-action="more">Mostrar más</button>` : ""}</div>`;
}

/* --- Ajustes --- */
function viewSettings() {
  const u = state.user;
  return `<div class="stack">
    <article class="card"><h2>Mi cuenta</h2><p>${esc(u.displayName || "")}<br><span class="muted">${esc(u.email || "")}</span></p><button class="btn btn-ghost" data-action="logout">Cerrar sesión</button></article>
    <article class="card"><h2>Meta semanal</h2><p class="muted">Horas que quieres dedicar por semana (0 = sin meta). Es personal para cada persona.</p>
      <form data-form="goal" class="form row-inline"><label class="sr" for="goal-input">Horas por semana</label>
      <input id="goal-input" name="goal" type="number" inputmode="decimal" min="0" max="168" step="0.5" placeholder="Ej. 20" value="${state.goal || ""}"><button class="btn btn-primary" type="submit">Guardar</button></form></article>
    <article class="card"><div class="card-head"><h2>Categorías</h2><button class="btn btn-gold btn-sm" data-action="add-cat">＋ Nueva</button></div>
      <ul class="cat-list">${state.categories.map(c => `<li class="cat-item" style="--c:${c.color}"><span aria-hidden="true">${esc(c.emoji)}</span><span class="grow">${esc(c.name)}</span>
        <button class="icon-btn" data-action="edit-cat" data-id="${esc(c.id)}" aria-label="Editar ${esc(c.name)}">✏️</button>
        <button class="icon-btn" data-action="delete-cat" data-id="${esc(c.id)}" aria-label="Eliminar ${esc(c.name)}">🗑️</button></li>`).join("") || '<li class="muted">Aún no hay categorías.</li>'}</ul></article>
    <article class="card"><h2>Respaldo y exportación</h2><p class="muted">Tus datos viven en la nube (Firebase). Descarga copias cuando quieras.</p>
      <div class="stack-btns"><button class="btn btn-ghost" data-action="export-csv">⬇️ Exportar historial (CSV)</button>
      <button class="btn btn-ghost" data-action="export-json">💾 Exportar respaldo completo (JSON)</button>
      <button class="btn btn-ghost" data-action="import-json">📂 Importar respaldo (JSON)</button>
      <input type="file" id="import-file" accept=".json,application/json" hidden></div></article></div>`;
}

/* ============ 8. RENDER ============ */
function captureForm(root) {
  const m = {};
  $$("input[id],select[id],textarea[id]", root).forEach(el => { if (el.type !== "file") m[el.id] = el.type === "checkbox" ? el.checked : el.value; });
  $$("input[type=radio]:checked", root).forEach(el => { m["radio:" + el.name] = el.value; });
  return m;
}
function restoreForm(root, m) {
  Object.entries(m).forEach(([k, v]) => {
    if (k.startsWith("radio:")) { const r = $(`input[type=radio][name="${k.slice(6)}"][value="${CSS.escape(v)}"]`, root); if (r) r.checked = true; return; }
    const el = document.getElementById(k);
    if (el && root.contains(el)) { if (el.type === "checkbox") el.checked = v; else el.value = v; }
  });
}
function render(keepForm = false) {
  if (!state.user) return;
  const view = $("#view");
  const saved = keepForm ? captureForm(view) : null;
  const focusId = keepForm ? document.activeElement?.id : null;
  view.innerHTML = ({ panel: viewPanel, registrar: viewRegister, historial: viewHistory, ajustes: viewSettings })[state.tab]();
  if (saved) restoreForm(view, saved);
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  $$(".tabbar button").forEach(b => b.dataset.value === state.tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  refreshPreviews();
}
/** Re-render por cambios de datos en vivo, cuidando no borrar lo que se está escribiendo */
function refresh(kind) {
  if (state.tab === "registrar" && kind !== "categories") return;
  render(true);
}

/* ============ 9. GUARDADO DE REGISTROS ============ */
function findOverlap(uid, date, start, end, ignoreId) {
  const a0 = dayIndex(date) * 1440 + toMin(start), a1 = a0 + calcDuration(start, end);
  return state.entries.find(e => {
    if (e.uid !== uid || e.id === ignoreId) return false;
    const b0 = dayIndex(e.date) * 1440 + toMin(e.start), b1 = b0 + calcDuration(e.start, e.end);
    return a0 < b1 && b0 < a1;
  });
}

async function saveEntry(d, source, opts = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) { toast("Elige una fecha válida", "error"); return false; }
  if (!d.start || !d.end) { toast("Completa la hora de inicio y de fin", "error"); return false; }
  const cat = state.categories.find(c => c.id === d.categoryId) || (d.id && state.entries.find(e => e.id === d.id));
  if (!d.categoryId || !cat) { toast("Elige una categoría", "error"); return false; }
  let duration = opts.durationMin ?? calcDuration(d.start, d.end);
  const orig = d.id ? state.entries.find(e => e.id === d.id) : null;
  if (orig && orig.start === d.start && orig.end === d.end) duration = orig.durationMin; // conserva el tiempo activo si no cambió el horario
  if (!duration) { toast("La hora de inicio y la de fin no pueden ser iguales", "error"); return false; }

  const clash = findOverlap(state.user.uid, d.date, d.start, d.end, d.id);
  if (clash) {
    const c = catInfo(clash);
    const ok = await confirmModal(`⚠️ Este horario se superpone con otro registro:\n${c.emoji} ${c.name}\n${fmtHistDate(clash.date)} · ${clash.start} – ${clash.end}\n\n¿Guardar de todas formas?`, { okText: "Guardar igual" });
    if (!ok) return false;
  }
  const info = catInfo({ categoryId: d.categoryId, ...(orig || {}) });
  const data = {
    categoryId: d.categoryId, catName: info.name, catEmoji: info.emoji, catColor: info.color,
    date: d.date, start: d.start, end: d.end, durationMin: duration,
    crossesMidnight: toMin(d.end) < toMin(d.start), note: d.note || "", updatedAt: Date.now()
  };
  try {
    if (d.id) await setDoc(doc(db, "entries", d.id), data, { merge: true });
    else await addDoc(collection(db, "entries"), { ...data, uid: state.user.uid, userName: state.user.displayName || state.user.email, source, createdAt: Date.now() });
    try { localStorage.setItem("jessday.lastcat", d.categoryId); } catch { /* nada */ }
    toast(d.id ? "Registro actualizado ✓" : `Guardado: ${fmtDur(duration)} ✓`);
    return true;
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.", "error");
    return false;
  }
}

/* ============ 10. EXPORTAR / IMPORTAR ============ */
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = v => {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas al abrir en Excel
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function exportCSV() {
  const rows = [["Fecha", "Día", "Inicio", "Fin", "Duración", "Minutos", "Categoría", "Persona", "Nota"]];
  [...state.entries].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).forEach(e => {
    const [y, m, d] = e.date.split("-");
    rows.push([`${d}/${m}/${y}`, DOW[toDate(e.date).getUTCDay()], e.start, e.end, fmtDur(e.durationMin), e.durationMin, catInfo(e).name, e.userName || "", e.note || ""]);
  });
  download(`jessday-historial-${todayStr()}.csv`, "\ufeff" + rows.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  toast("CSV descargado ✓");
}
function exportJSON() {
  const data = {
    app: "jessday-time", version: 1, exportedAt: new Date().toISOString(),
    categories: state.categories.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, order: c.order ?? 0 })),
    entries: state.entries.map(e => ({
      id: e.id, uid: e.uid, userName: e.userName || "", categoryId: e.categoryId, catName: e.catName || "", catEmoji: e.catEmoji || "", catColor: e.catColor || "",
      date: e.date, start: e.start, end: e.end, durationMin: e.durationMin, crossesMidnight: !!e.crossesMidnight, note: e.note || "", source: e.source || "manual", createdAt: e.createdAt || null
    }))
  };
  download(`jessday-respaldo-${todayStr()}.json`, JSON.stringify(data, null, 2), "application/json");
  toast("Respaldo descargado ✓");
}
async function importBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast("El archivo no es un JSON válido", "error"); return; }
  const idOk = s => typeof s === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  if (data?.app !== "jessday-time" || !Array.isArray(data.entries) || !Array.isArray(data.categories)) { toast("Este archivo no parece un respaldo de JESSDAY STYLE", "error"); return; }
  const cats = data.categories.filter(c => idOk(c.id) && c.name);
  const entries = data.entries.filter(x => idOk(x.id) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && /^\d{2}:\d{2}$/.test(x.start) && /^\d{2}:\d{2}$/.test(x.end) && Number.isFinite(x.durationMin) && typeof x.categoryId === "string");
  const ok = await confirmModal(`Se importarán ${entries.length} registros y ${cats.length} categorías.\nLo que ya exista se actualizará; no se borra nada.`, { okText: "Importar" });
  if (!ok) return;
  try {
    const ops = [
      ...cats.map(c => [doc(db, "categories", c.id), { name: String(c.name).slice(0, 60), emoji: String(c.emoji || "🏷️").slice(0, 8), color: String(c.color || "#c9a66b"), order: Number(c.order) || 0 }]),
      ...entries.map(x => [doc(db, "entries", x.id), {
        uid: String(x.uid || state.user.uid), userName: String(x.userName || ""), categoryId: x.categoryId, catName: String(x.catName || ""), catEmoji: String(x.catEmoji || ""), catColor: String(x.catColor || ""),
        date: x.date, start: x.start, end: x.end, durationMin: Math.round(x.durationMin), crossesMidnight: !!x.crossesMidnight, note: String(x.note || "").slice(0, 300), source: String(x.source || "import"), createdAt: Number(x.createdAt) || Date.now(), updatedAt: Date.now()
      }])
    ];
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      ops.slice(i, i + 400).forEach(([ref, val]) => b.set(ref, val, { merge: true }));
      await b.commit();
    }
    toast("Respaldo importado ✓");
  } catch (err) { console.error(err); toast("No se pudo importar el respaldo", "error"); }
}

/* ============ 11. COMPARTIR POR WHATSAPP ============ */
function weekSummaryText() {
  const ws = state.weekAnchor, we = addDays(ws, 6);
  const s = summarize(entriesIn(ws, we));
  const who = state.person === "all" ? "Ambas" : (state.person === state.user.uid ? "Yo" : first(state.users.find(u => u.id === state.person)?.name));
  const [y] = we.split("-");
  const lines = [`*JESSDAY STYLE* · Resumen semanal`, `📅 ${fmtShort(ws)} – ${fmtShort(we)}/${y.slice(2)} (${who})`, `⏱️ Total: ${fmtDur(s.total)} · ${s.count} actividades`];
  s.byCat.forEach(c => lines.push(`• ${c.info.emoji} ${c.info.name}: ${fmtDur(c.min)} (${Math.round(c.min / s.total * 100)}%)`));
  if (state.goal) {
    const mine = entriesIn(ws, we, state.user.uid).reduce((a, e) => a + e.durationMin, 0);
    lines.push(`🎯 Mi meta: ${fmtHours(state.goal * 60)} → ${Math.min(100, Math.round(mine / (state.goal * 60) * 100))}%`);
  }
  lines.push(`🔥 Racha: ${streaks(state.user.uid).cur} días`);
  return lines.join("\n");
}

/* ============ 12. CATEGORÍAS (modal) ============ */
function catModal(c) {
  const v = c || { name: "", emoji: "🏷️", color: PALETTE[0] };
  const palette = PALETTE.includes(v.color) ? PALETTE : [v.color, ...PALETTE];
  showModal(`${modalHead(c ? "Editar categoría" : "Nueva categoría")}
    <form data-form="cat" class="form"><input type="hidden" name="id" value="${esc(c?.id || "")}">
    <label for="c-name">Nombre</label><input id="c-name" name="name" type="text" required maxlength="60" value="${esc(v.name)}">
    <label for="c-emoji">Emoji</label><input id="c-emoji" name="emoji" type="text" maxlength="8" value="${esc(v.emoji)}">
    <div class="emoji-row">${EMOJIS.map(e => `<button type="button" class="emoji-pick" data-action="pick-emoji" data-value="${e}" aria-label="Usar ${e}">${e}</button>`).join("")}</div>
    <fieldset class="swatches"><legend>Color</legend>${palette.map(col => `<label class="swatch" style="--c:${col}"><input type="radio" name="color" value="${col}"${col === v.color ? " checked" : ""}><span></span><span class="sr">${col}</span></label>`).join("")}</fieldset>
    <button class="btn btn-primary btn-block" type="submit">Guardar categoría</button></form>`);
}

/* ============ 13. ACCIONES (delegación de eventos) ============ */
const actions = {
  login: async () => {
    if (!FB_READY) return;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try { await signInWithPopup(auth, provider); }
    catch (err) {
      if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(err.code)) return;
      const map = {
        "auth/unauthorized-domain": "Este dominio no está autorizado. En Firebase → Authentication → Configuración → Dominios autorizados, agrega tu dominio de GitHub Pages.",
        "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo otra vez.",
        "auth/operation-not-allowed": "Falta activar el ingreso con Google en Firebase → Authentication → Método de acceso."
      };
      showLoginError(map[err.code] || `No se pudo iniciar sesión (${err.code || "error"}).`);
    }
  },
  logout: async () => { await signOut(auth); },
  tab: el => { state.tab = el.dataset.value; window.scrollTo(0, 0); render(); },
  range: el => { state.range = el.dataset.value; render(); },
  prev: () => { if (state.range === "semana") state.weekAnchor = addDays(state.weekAnchor, -7); else state.monthAnchor = addMonths(state.monthAnchor, -1); render(); },
  next: () => { if (state.range === "semana") state.weekAnchor = addDays(state.weekAnchor, 7); else state.monthAnchor = addMonths(state.monthAnchor, 1); render(); },
  person: el => { state.person = el.dataset.value; state.limit = 60; render(); },
  "goto-register": () => { state.tab = "registrar"; state.regMode = "cron"; window.scrollTo(0, 0); render(); },
  "reg-mode": el => { state.regMode = el.dataset.value; render(); },
  "clear-filters": () => { state.filters = { cat: "", from: "", to: "" }; state.limit = 60; render(); },
  more: () => { state.limit += 60; render(); },
  "close-modal": closeModal,
  "pick-emoji": el => { const i = $("#c-emoji"); if (i) { i.value = el.dataset.value; i.focus(); } },

  "timer-start": () => {
    const id = $('input[name="tcat"]:checked')?.value;
    if (!id) { toast("Elige una categoría", "error"); return; }
    const c = state.categories.find(x => x.id === id);
    const now = Date.now();
    saveTimer({ categoryId: id, catName: c.name, catEmoji: c.emoji, catColor: c.color, note: $("#t-note")?.value.trim() || "", firstStart: now, startedAt: now, accumMs: 0, running: true });
    try { localStorage.setItem("jessday.lastcat", id); } catch { /* nada */ }
    render(); toast("Cronómetro iniciado ▶");
  },
  "timer-toggle": () => {
    const t = loadTimer(); if (!t) return;
    if (t.running) { t.accumMs += Date.now() - t.startedAt; t.startedAt = null; t.running = false; }
    else { t.startedAt = Date.now(); t.running = true; }
    saveTimer(t); render();
  },
  "timer-discard": async () => {
    if (!await confirmModal("¿Descartar este cronómetro? No se guardará ningún registro.", { okText: "Descartar", danger: true })) return;
    saveTimer(null); render(); toast("Cronómetro descartado");
  },
  "timer-finish": async () => {
    const t = loadTimer(); if (!t) return;
    const ms = elapsed(t), minutes = Math.round(ms / 60000), endMs = Date.now();
    if (minutes < 1) { saveTimer(null); render(); toast("Duró menos de 1 minuto: no se guardó", "error"); return; }
    const a = limaParts(t.firstStart), b = limaParts(endMs);
    const end = a.time === b.time ? minToTime(toMin(a.time) + 1) : b.time;
    const ok = await saveEntry({ date: a.date, start: a.time, end, categoryId: t.categoryId, note: ($("#t-note-live")?.value ?? t.note ?? "").trim() }, "cronometro", { durationMin: minutes });
    if (ok) { saveTimer(null); render(); }
  },

  "edit-entry": el => {
    const e = state.entries.find(x => x.id === el.dataset.id); if (!e) return;
    showModal(`${modalHead("Editar registro")}${entryFormHTML("ed-", e, "Guardar cambios")}`);
    refreshPreviews();
  },
  "delete-entry": async el => {
    const e = state.entries.find(x => x.id === el.dataset.id); if (!e) return;
    if (!await confirmModal(`¿Eliminar este registro?\n${catInfo(e).emoji} ${catInfo(e).name}\n${fmtHistDate(e.date)} · ${fmtDur(e.durationMin)}\n\nEsta acción no se puede deshacer.`, { okText: "Eliminar", danger: true })) return;
    try { await deleteDoc(doc(db, "entries", e.id)); toast("Registro eliminado"); } catch { toast("No se pudo eliminar", "error"); }
  },

  "add-cat": () => catModal(null),
  "edit-cat": el => catModal(state.categories.find(c => c.id === el.dataset.id)),
  "delete-cat": async el => {
    const c = state.categories.find(x => x.id === el.dataset.id); if (!c) return;
    const n = state.entries.filter(e => e.categoryId === c.id).length;
    const extra = n ? `\n\nTiene ${n} registros: se conservarán en el historial con su nombre original.` : "";
    if (!await confirmModal(`¿Eliminar la categoría "${c.name}"?${extra}`, { okText: "Eliminar", danger: true })) return;
    try { await deleteDoc(doc(db, "categories", c.id)); toast("Categoría eliminada"); } catch { toast("No se pudo eliminar", "error"); }
  },

  "export-csv": exportCSV,
  "export-json": exportJSON,
  "import-json": () => $("#import-file")?.click(),
  "share-week": () => window.open(`https://wa.me/?text=${encodeURIComponent(weekSummaryText())}`, "_blank", "noopener")
};

const forms = {
  entry: async f => {
    const fd = new FormData(f);
    const btn = $('button[type="submit"]', f); btn.disabled = true;
    const data = { id: fd.get("id") || null, date: fd.get("date"), start: fd.get("start"), end: fd.get("end"), categoryId: fd.get("categoryId"), note: String(fd.get("note") || "").trim() };
    const ok = await saveEntry(data, "manual");
    btn.disabled = false;
    if (ok) { if (data.id) closeModal(); else { f.reset(); refreshPreviews(); } }
  },
  goal: async f => {
    const v = Math.max(0, Math.min(168, Number(new FormData(f).get("goal")) || 0));
    try { await setDoc(doc(db, "settings", state.user.uid), { weeklyGoalH: v }, { merge: true }); toast(v ? "Meta guardada ✓" : "Meta quitada"); }
    catch { toast("No se pudo guardar la meta", "error"); }
  },
  cat: async f => {
    const fd = new FormData(f);
    const name = String(fd.get("name") || "").trim();
    if (!name) { toast("Escribe un nombre", "error"); return; }
    const emoji = Array.from(String(fd.get("emoji") || "").trim()).slice(0, 4).join("") || "🏷️";
    const color = fd.get("color") || PALETTE[0], id = fd.get("id");
    try {
      if (id) await setDoc(doc(db, "categories", id), { name, emoji, color }, { merge: true });
      else await addDoc(collection(db, "categories"), { name, emoji, color, order: Math.max(-1, ...state.categories.map(c => c.order ?? 0)) + 1 });
      closeModal(); toast("Categoría guardada ✓");
    } catch { toast("No se pudo guardar la categoría", "error"); }
  }
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (el) { actions[el.dataset.action]?.(el, e); return; }
  if (e.target.matches("[data-backdrop]")) closeModal();
});
document.addEventListener("submit", e => {
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault(); forms[f.dataset.form]?.(f);
});
document.addEventListener("input", e => {
  const f = e.target.closest('form[data-form="entry"]'); if (f) updatePreview(f);
  if (e.target.matches("[data-timer-note]")) { const t = loadTimer(); if (t) { t.note = e.target.value; saveTimer(t); } }
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset?.filter) { state.filters[el.dataset.filter] = el.value; state.limit = 60; render(); }
  if (el.id === "import-file") { importBackup(el.files[0]); el.value = ""; }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#modal-root").innerHTML) closeModal(); });

/* ============ 14. SESIÓN Y DATOS EN VIVO ============ */
function showLogin(msg) {
  $("#splash").hidden = true; $("#app").hidden = true; $("#login").hidden = false;
  showLoginError(msg || (FB_READY ? "" : "Falta configurar Firebase: pega tus datos en firebaseConfig (al inicio de app.js)."));
}
function showLoginError(msg) { const el = $("#login-error"); el.textContent = msg || ""; el.hidden = !msg; }
function showApp() {
  $("#splash").hidden = true; $("#login").hidden = true; $("#app").hidden = false;
  const u = state.user;
  $("#user-chip").innerHTML = `${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc((u.displayName || u.email || "?")[0].toUpperCase())}</span>`}<span class="name">${esc(first(u.displayName || u.email))}</span>`;
}
function stopListeners() { state.unsubs.forEach(f => f()); state.unsubs = []; }

async function seedIfNeeded() {
  try {
    const metaRef = doc(db, "meta", "init");
    if ((await getDoc(metaRef)).exists()) return;
    const b = writeBatch(db);
    DEFAULT_CATS.forEach((c, i) => b.set(doc(db, "categories", c.id), { name: c.name, emoji: c.emoji, color: c.color, order: i }));
    b.set(metaRef, { seededAt: Date.now(), by: state.user.uid });
    await b.commit();
  } catch (err) { if (err.code === "permission-denied") throw err; /* sin conexión: se reintenta en el próximo ingreso */ }
}

function startListeners() {
  stopListeners();
  const onErr = err => {
    console.error(err);
    if (err.code === "permission-denied") denyAccess();
  };
  const uid = state.user.uid;
  state.unsubs = [
    onSnapshot(collection(db, "users"), s => { state.users = s.docs.map(d => ({ id: d.id, ...d.data() })); refresh("users"); }, onErr),
    onSnapshot(collection(db, "categories"), s => { state.categories = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); refresh("categories"); }, onErr),
    onSnapshot(collection(db, "entries"), s => { state.entries = s.docs.map(d => ({ id: d.id, ...d.data() })); refresh("entries"); }, onErr),
    onSnapshot(doc(db, "settings", uid), s => { state.goal = s.exists() ? Number(s.data().weeklyGoalH) || 0 : 0; refresh("settings"); }, onErr)
  ];
}

async function denyAccess() {
  const mail = state.user?.email || "";
  stopListeners();
  try { await signOut(auth); } catch { /* nada */ }
  showLogin(`El correo ${mail} no tiene acceso a esta app. Pide que lo agreguen en las reglas de Firestore.`);
}

if (FB_READY) {
  onAuthStateChanged(auth, async user => {
    if (!user) { state.user = null; stopListeners(); showLogin(); return; }
    state.user = user;
    try {
      await setDoc(doc(db, "users", user.uid), { name: user.displayName || user.email, email: user.email, photo: user.photoURL || "", lastLogin: Date.now() }, { merge: true });
      await seedIfNeeded();
    } catch (err) {
      if (err.code === "permission-denied") { await denyAccess(); return; }
      console.error(err);
    }
    startListeners();
    showApp();
    render();
  });
} else {
  showLogin();
}