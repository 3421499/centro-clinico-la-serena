// =============================================
// CENTRO CLÍNICO LA SERENA — APP.JS
// Firebase Firestore + Lógica principal
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, addDoc, setDoc,
  updateDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── CONFIGURACIÓN FIREBASE ──────────────────
// ⚠️ REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO FIREBASE
const firebaseConfig = {
  apiKey:            "AIzaSyDV-xElkYINZ3E4o1ik_bhr-Gm_q9X4mp8",
  authDomain:        "centro-clinico-la-serena.firebaseapp.com",
  projectId:         "centro-clinico-la-serena",
  storageBucket:     "centro-clinico-la-serena.firebasestorage.app",
  messagingSenderId: "995240406113",
  appId:             "1:995240406113:web:78a46d5935399c5b5f0e20"
};
// ────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── CONSTANTES ──────────────────────────────
const MONTHS   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const WDAYS    = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const PROGRAMAS = {
  Regenerativo: 'Regenerativo',
  Columna:      'Columna Vertebral',
  Hiperbarica:  'Cámara Hiperbárica',
  KineClasica:  'Kine Clásica',
  PisoPelvico:  'Piso Pélvico',
  Otros:        'Otros'
};
const PIN = '173400';

// ── ESTADO ──────────────────────────────────
const today    = new Date();
const todayKey = fmtDate(today);
let curYear    = today.getFullYear();
let curMonth   = today.getMonth();
let selectedDate  = null;
let editingId     = null;   // Firestore doc ID del paciente en edición
let role          = 'evaluador';
let tipoInforme   = null;

// Cache local (espejo de Firestore)
let patients = {};  // { id: { ...datos } }
let agenda   = {};  // { 'YYYY-MM-DD': [patientId, ...] }

// ── HELPERS ─────────────────────────────────
function fmtDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function fmtLabel(k) {
  const d = new Date(k + 'T12:00:00');
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function ini(nombre) {
  return nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function setSyncing(state) {
  const el  = document.getElementById('sync-indicator');
  const txt = document.getElementById('sync-text');
  el.className = 'sync-indicator ' + state;
  if (state === 'syncing') { el.innerHTML = '<i class="ti ti-refresh"></i> Guardando...'; }
  if (state === 'ok')      { el.innerHTML = '<i class="ti ti-cloud-check"></i> Sincronizado'; }
  if (state === 'error')   { el.innerHTML = '<i class="ti ti-cloud-off"></i> Sin conexión'; }
}

// ── FIRESTORE: ESCUCHA EN TIEMPO REAL ───────
function initRealtimeListeners() {
  // Pacientes
  onSnapshot(collection(db, 'pacientes'), snapshot => {
    patients = {};
    snapshot.forEach(docSnap => {
      patients[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });
    renderBase();
    if (selectedDate) renderDayList(selectedDate);
    setSyncing('ok');
  }, err => {
    console.error(err);
    setSyncing('error');
  });

  // Agenda
  onSnapshot(collection(db, 'agenda'), snapshot => {
    agenda = {};
    snapshot.forEach(docSnap => {
      agenda[docSnap.id] = docSnap.data().ids || [];
    });
    renderCalendar();
    if (selectedDate) renderDayList(selectedDate);
    setSyncing('ok');
  }, err => {
    console.error(err);
    setSyncing('error');
  });
}

// ── ROLES ────────────────────────────────────
window.setRole = function(r) {
  role = r;
  ['eval', 'tera', 'stats'].forEach(x => {
    document.getElementById('rol-' + x).style.display = 'none';
  });
  document.getElementById('view-ficha').style.display = 'none';
  document.getElementById('rbtn-eval').classList.toggle('active', r === 'evaluador');
  document.getElementById('rbtn-tera').classList.toggle('active', r === 'terapeuta');
  if (r === 'evaluador') { document.getElementById('rol-eval').style.display = ''; renderBase(); }
  if (r === 'terapeuta') { document.getElementById('rol-tera').style.display = ''; renderCalendar(); selectDay(todayKey); }
  if (r === 'stats')     {
    document.getElementById('rol-stats').style.display = '';
    document.getElementById('stats-lock').style.display = '';
    document.getElementById('stats-content').style.display = 'none';
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-error').style.display = 'none';
  }
};

// ── TABS ─────────────────────────────────────
window.evalTab = function(t) {
  document.getElementById('eval-base').style.display  = t === 'base'  ? '' : 'none';
  document.getElementById('eval-nueva').style.display = t === 'nueva' ? '' : 'none';
  document.getElementById('etab-base').classList.toggle('active', t === 'base');
  document.getElementById('etab-nueva').classList.toggle('active', t === 'nueva');
  if (t === 'base')  renderBase();
  if (t === 'nueva') initNueva();
};
window.teraTab = function(t) {
  document.getElementById('tera-cal').style.display   = t === 'cal'  ? '' : 'none';
  document.getElementById('tera-hist').style.display  = t === 'hist' ? '' : 'none';
  document.getElementById('ttab-cal').classList.toggle('active', t === 'cal');
  document.getElementById('ttab-hist').classList.toggle('active', t === 'hist');
  if (t === 'hist') renderHistorial();
};
window.fichaTab = function(t) {
  ['datos', 'prog', 'ses'].forEach(x => {
    document.getElementById('ft-' + x).style.display = x === t ? '' : 'none';
    document.getElementById('ftab-' + x).classList.toggle('active', x === t);
  });
};

// ── BASE DE PACIENTES ─────────────────────────
function renderBase() {
  const q   = (document.getElementById('eval-search')?.value || '').toLowerCase();
  const el  = document.getElementById('eval-list');
  const all = Object.values(patients);
  const f   = all.filter(p => !q || p.nombre?.toLowerCase().includes(q) || p.diagnostico?.toLowerCase().includes(q));

  if (!f.length) {
    el.innerHTML = '<div style="color:#666;font-size:13px;padding:16px 0;text-align:center">No se encontraron pacientes.</div>';
    return;
  }
  el.innerHTML = f.map(p => {
    const prog = p.programaSel ? `<span class="prog-badge prog-${p.programaSel}">${PROGRAMAS[p.programaSel]}</span>` : '';
    return `<div class="pcard" onclick="openFicha('${p.id}')">
      <div class="avatar">${ini(p.nombre || '?')}</div>
      <div style="flex:1">
        <div class="pcard-name">${p.nombre}</div>
        <div class="pcard-meta">${p.edad} años · ${p.prevision} · ${p.diagnostico}</div>
        <div style="margin-top:4px">${prog}</div>
      </div>
      <span class="badge">${(p.sesiones || []).length} ses.</span>
    </div>`;
  }).join('');
}

function initNueva() {
  ['n-nombre','n-rut','n-edad','n-diagnostico','n-antecedentes','n-primera','n-programa','n-evaluacion']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('n-ingreso').value      = todayKey;
  document.getElementById('n-prevision').value    = '';
  document.getElementById('n-programa-sel').value = '';
}

window.createPatient = async function() {
  const nombre = document.getElementById('n-nombre').value.trim();
  if (!nombre) { showToast('Ingresa el nombre del paciente'); return; }
  setSyncing('syncing');
  try {
    await addDoc(collection(db, 'pacientes'), {
      nombre,
      rut:         document.getElementById('n-rut').value,
      ingreso:     document.getElementById('n-ingreso').value,
      edad:        document.getElementById('n-edad').value,
      prevision:   document.getElementById('n-prevision').value,
      diagnostico: document.getElementById('n-diagnostico').value,
      programaSel: document.getElementById('n-programa-sel').value,
      antecedentes:document.getElementById('n-antecedentes').value,
      primera:     document.getElementById('n-primera').value,
      programa:    document.getElementById('n-programa').value,
      evaluacion:  document.getElementById('n-evaluacion').value,
      sesiones:    [],
      creadoEn:    new Date().toISOString()
    });
    showToast('Ficha guardada en base de datos');
    evalTab('base');
  } catch(e) { setSyncing('error'); showToast('Error al guardar'); console.error(e); }
};

// ── CALENDARIO ───────────────────────────────
function renderCalendar() {
  document.getElementById('cal-month').textContent = MONTHS[curMonth] + ' ' + curYear;
  const grid  = document.getElementById('cal-grid');
  const first = new Date(curYear, curMonth, 1).getDay();
  const dim   = new Date(curYear, curMonth + 1, 0).getDate();
  const prev  = new Date(curYear, curMonth, 0).getDate();

  grid.innerHTML = WDAYS.map(d => `<div class="cal-dname">${d}</div>`).join('');
  for (let i = 0; i < first; i++)
    grid.innerHTML += `<div class="cal-cell other"><span class="cal-num">${prev - first + 1 + i}</span></div>`;
  for (let d = 1; d <= dim; d++) {
    const key  = fmtDate(new Date(curYear, curMonth, d));
    const isT  = key === todayKey;
    const isSel = key === selectedDate;
    const cnt  = (agenda[key] || []).length;
    const dots = Array(cnt).fill(null).map(() =>
      `<div class="cal-dot"${isSel ? ' style="background:white"' : ''}></div>`
    ).join('');
    grid.innerHTML += `<div class="cal-cell${isT ? ' today' : ''}${isSel ? ' selected' : ''}" onclick="selectDay('${key}')">
      <span class="cal-num">${d}</span><div class="cal-dots">${dots}</div></div>`;
  }
}

window.changeMonth = function(dir) {
  curMonth += dir;
  if (curMonth > 11) { curMonth = 0; curYear++; }
  if (curMonth < 0)  { curMonth = 11; curYear--; }
  selectedDate = null;
  document.getElementById('day-panel').style.display = 'none';
  renderCalendar();
};

window.selectDay = function(key) {
  selectedDate = key;
  renderCalendar();
  document.getElementById('day-label').textContent = fmtLabel(key);
  renderDayList(key);
  document.getElementById('day-panel').style.display = '';
  const si = document.getElementById('tera-search'); if (si) si.value = '';
  document.getElementById('results-list').innerHTML = '';
};

function renderDayList(key) {
  const ids = agenda[key] || [];
  const el  = document.getElementById('day-list');
  if (!ids.length) {
    el.innerHTML = '<div class="empty-day">No hay pacientes en este día.<br>Usa el buscador de abajo para agregar.</div>';
    return;
  }
  el.innerHTML = ids.map(pid => {
    const p = patients[pid]; if (!p) return '';
    const sesHoy = (p.sesiones || []).filter(s => s.fecha === key).length;
    const prog   = p.programaSel ? `<span class="prog-badge prog-${p.programaSel}">${PROGRAMAS[p.programaSel]}</span>` : '';
    return `<div class="prow" onclick="openFicha('${pid}')">
      <div class="avatar">${ini(p.nombre)}</div>
      <div style="flex:1">
        <div class="prow-name">${p.nombre}</div>
        <div class="prow-meta">${p.diagnostico}</div>
        <div style="margin-top:3px">${prog}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="badge">${(p.sesiones||[]).length} ses.</span>
        ${sesHoy > 0
          ? `<span class="badge badge-ok"><i class="ti ti-check" style="font-size:10px"></i> Atendido</span>`
          : `<span style="font-size:11px;color:#666">Pendiente</span>`}
      </div>
    </div>`;
  }).join('');
}

window.searchForDay = function() {
  const q   = document.getElementById('tera-search').value.trim().toLowerCase();
  const el  = document.getElementById('results-list');
  if (!q) { el.innerHTML = ''; return; }
  const existing = agenda[selectedDate] || [];
  const res = Object.values(patients).filter(p =>
    p.nombre?.toLowerCase().includes(q) && !existing.includes(p.id)
  );
  if (!res.length) {
    el.innerHTML = '<div class="results-list"><div class="res-empty">No encontrado en la base de datos.</div></div>';
    return;
  }
  el.innerHTML = `<div class="results-list">${res.map(p =>
    `<div class="res-item">
      <div class="res-avatar">${ini(p.nombre)}</div>
      <div style="flex:1"><div class="res-name">${p.nombre}</div><div class="res-dx">${p.diagnostico}</div></div>
      <button class="res-add" onclick="addToDay('${p.id}')"><i class="ti ti-plus"></i> Agregar</button>
    </div>`
  ).join('')}</div>`;
};

window.addToDay = async function(pid) {
  if (!agenda[selectedDate]) agenda[selectedDate] = [];
  if (agenda[selectedDate].includes(pid)) return;
  setSyncing('syncing');
  try {
    const ids = [...(agenda[selectedDate] || []), pid];
    await setDoc(doc(db, 'agenda', selectedDate), { ids });
    document.getElementById('tera-search').value = '';
    document.getElementById('results-list').innerHTML = '';
    showToast(`${patients[pid]?.nombre} agregado al día`);
  } catch(e) { setSyncing('error'); console.error(e); }
};

function renderHistorial() {
  const el   = document.getElementById('hist-list');
  const keys = Object.keys(agenda).filter(k => (agenda[k] || []).length > 0).sort().reverse();
  if (!keys.length) { el.innerHTML = '<div style="color:#666;font-size:13px">No hay atenciones registradas aún.</div>'; return; }
  el.innerHTML = keys.map(k => {
    const ids = agenda[k] || [];
    return `<div class="hist-day">
      <div class="hist-day-head">
        <span><i class="ti ti-calendar" style="color:var(--red)"></i> ${fmtLabel(k)}</span>
        <span class="badge">${ids.length} pac.</span>
      </div>
      ${ids.map(pid => {
        const p = patients[pid]; if (!p) return '';
        return `<div class="prow" onclick="teraTab('cal');selectDay('${k}')">
          <div class="avatar" style="width:30px;height:30px;font-size:11px">${ini(p.nombre)}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${p.nombre}</div>
            <div style="font-size:12px;color:#666">${p.diagnostico}</div>
          </div>
          ${p.programaSel ? `<span class="prog-badge prog-${p.programaSel}">${PROGRAMAS[p.programaSel]}</span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ── FICHA ────────────────────────────────────
window.openFicha = function(pid) {
  editingId = pid;
  const p   = patients[pid];
  document.getElementById('ficha-ttl').textContent = p.nombre;
  ['nombre','rut','ingreso','edad','diagnostico','antecedentes','primera','evaluacion']
    .forEach(f => { const el = document.getElementById('f-' + f); if (el) el.value = p[f] || ''; });
  // Campo Programa (textarea en pestaña Datos)
  const progTxt = document.getElementById('f-programa-txt');
  if (progTxt) progTxt.value = p.programa || '';
  document.getElementById('f-prevision').value    = p.prevision   || '';
  document.getElementById('f-programa-sel').value = p.programaSel || '';

  const pb = document.getElementById('prog-badge-display');
  pb.innerHTML = p.programaSel
    ? `<span class="prog-badge prog-${p.programaSel}" style="font-size:13px;padding:4px 14px">${PROGRAMAS[p.programaSel]}</span>`
    : '<span style="color:#666;font-size:13px">Sin programa asignado</span>';

  const isT = role === 'terapeuta';
  ['f-nombre','f-rut','f-ingreso','f-edad','f-diagnostico','f-antecedentes','f-primera','f-programa-txt','f-evaluacion']
    .forEach(id => { const el = document.getElementById(id); if (el) el.readOnly = isT; });
  document.getElementById('f-prevision').disabled    = isT;
  document.getElementById('btn-inf1').style.display  = isT ? 'inline-flex' : 'none';
  document.getElementById('btn-inf2').style.display  = isT ? 'inline-flex' : 'none';

  renderSessions(p.sesiones || []);
  fichaTab('datos');
  ['rol-eval','rol-tera','rol-stats'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('view-ficha').style.display = '';
};

window.backFromFicha = function() {
  document.getElementById('view-ficha').style.display = 'none';
  if (role === 'evaluador') { document.getElementById('rol-eval').style.display = ''; renderBase(); }
  if (role === 'terapeuta') { document.getElementById('rol-tera').style.display = ''; if (selectedDate) renderDayList(selectedDate); }
  if (role === 'stats')     { document.getElementById('rol-stats').style.display = ''; }
};

function renderSessions(s) {
  const tb = document.getElementById('ses-body');
  tb.innerHTML = !s.length
    ? `<tr><td colspan="4" style="color:#666;font-size:13px;padding:14px;text-align:center">Sin sesiones registradas aún</td></tr>`
    : s.map((x, i) => `<tr>
        <td><input type="date" value="${x.fecha}" onchange="updateSessionField(${i},'fecha',this.value)"></td>
        <td><textarea rows="2" onchange="updateSessionField(${i},'trat',this.value)">${x.trat}</textarea></td>
        <td><textarea rows="2" onchange="updateSessionField(${i},'evol',this.value)">${x.evol}</textarea></td>
        <td style="text-align:center">
          <button onclick="removeSession(${i})" style="background:none;border:none;cursor:pointer;color:#bbb;font-size:16px">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>`).join('');
}

window.updateSessionField = function(i, field, val) {
  if (!editingId) return;
  const p = patients[editingId];
  if (!p || !p.sesiones) return;
  p.sesiones[i][field] = val;
};

window.addSession = function() {
  if (!editingId) return;
  const p = patients[editingId];
  if (!p.sesiones) p.sesiones = [];
  p.sesiones.push({ fecha: selectedDate || todayKey, trat: '', evol: '' });
  renderSessions(p.sesiones);
};

window.removeSession = function(i) {
  if (!editingId) return;
  const p = patients[editingId];
  p.sesiones.splice(i, 1);
  renderSessions(p.sesiones);
};

window.savePatient = async function() {
  if (!editingId) return;
  setSyncing('syncing');
  try {
    const p = patients[editingId];
    const updates = { sesiones: p.sesiones || [] };
    if (role === 'evaluador') {
      ['nombre','rut','ingreso','edad','diagnostico','antecedentes','primera','evaluacion']
        .forEach(f => { const el = document.getElementById('f-' + f); if (el) updates[f] = el.value; });
      updates.prevision = document.getElementById('f-prevision').value;
      // Programa (textarea en pestaña Datos)
      const progTxt = document.getElementById('f-programa-txt');
      if (progTxt) updates.programa = progTxt.value;
      document.getElementById('ficha-ttl').textContent = updates.nombre;
    }
    await updateDoc(doc(db, 'pacientes', editingId), updates);
    const ok = document.getElementById('saved-ok');
    ok.classList.add('show');
    setTimeout(() => ok.classList.remove('show'), 2500);
  } catch(e) { setSyncing('error'); showToast('Error al guardar'); console.error(e); }
};

// ── ESTADÍSTICAS ─────────────────────────────
window.checkPin = function() {
  if (document.getElementById('pin-input').value === PIN) {
    document.getElementById('stats-lock').style.display    = 'none';
    document.getElementById('stats-content').style.display = '';
    renderStats();
  } else {
    document.getElementById('pin-error').style.display = 'block';
    document.getElementById('pin-input').value = '';
  }
};
window.lockStats = function() {
  document.getElementById('stats-lock').style.display    = '';
  document.getElementById('stats-content').style.display = 'none';
};

function renderStats() {
  const hoyIds = agenda[todayKey] || [];
  document.getElementById('s-hoy').textContent        = hoyIds.length;
  document.getElementById('s-fecha-hoy').textContent  = fmtLabel(todayKey);

  const allKeys = Object.keys(agenda).filter(k => (agenda[k]||[]).length > 0).sort();
  function total(days) {
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);
    const rel = allKeys.filter(k => new Date(k + 'T12:00:00') >= cutoff);
    return rel.reduce((s, k) => s + (agenda[k] || []).length, 0);
  }
  document.getElementById('s-semana').textContent = total(7);
  document.getElementById('s-mes').textContent    = total(30);

  // Programas hoy
  const progCount = {};
  hoyIds.forEach(pid => {
    const p = patients[pid];
    if (p && p.programaSel) progCount[p.programaSel] = (progCount[p.programaSel] || 0) + 1;
  });
  const tot = hoyIds.length || 1;
  const progEl = document.getElementById('s-programas-hoy');
  if (!hoyIds.length) {
    progEl.innerHTML = '<div style="color:#666;font-size:13px;padding:8px 0">No hay atenciones hoy.</div>';
  } else {
    progEl.innerHTML = Object.entries(PROGRAMAS).map(([key, label]) => {
      const cnt = progCount[key] || 0; if (!cnt) return '';
      const pct = Math.round(cnt / tot * 100);
      return `<div class="prog-bar-wrap">
        <div class="prog-bar-label">
          <span><span class="prog-badge prog-${key}">${label}</span></span>
          <span style="font-weight:500">${cnt} pac. (${pct}%)</span>
        </div>
        <div class="prog-bar-bg"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  // Tabla histórica
  const tbody = document.getElementById('s-tabla');
  if (!allKeys.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#666;font-size:13px;padding:12px;text-align:center">Sin registros aún.</td></tr>';
    return;
  }
  tbody.innerHTML = [...allKeys].reverse().map(k => {
    const ids   = agenda[k] || [];
    const progs = [...new Set(ids.map(id => patients[id]?.programaSel).filter(Boolean))]
      .map(p => `<span class="prog-badge prog-${p}">${PROGRAMAS[p] || p}</span>`).join(' ');
    return `<tr>
      <td>${fmtLabel(k)}</td>
      <td style="font-weight:500;color:var(--red)">${ids.length}</td>
      <td>${progs || '—'}</td>
    </tr>`;
  }).join('');
}

// ── INFORMES ─────────────────────────────────
function logoSVGInf() {
  return '<img src="data:image/png;base64,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0r8NLiDnozoCcu7F+9xdjNSWy982j6Ge92WVjDBOyVj5AeUcwfjH4WSCBjBHepU4Yts6/SdLXX3UluFLdqkiGnje5rnRQjqT0JwXH5cNHisNp6NtTVilqRHz5/z+zaO96tobLp191tt9a1rRGKzNJnOIjxNZmMebf55TZG0MY1jc4aABk5X6RF6FpkREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQERaZu5q+4aO0x7etFjqrxcJX8kMUUT3sjwMmSTlGQ0fJkkdnUjhqXjTrNreIdja7bU3WtXR0oza04j2YnffT1/vGmp6u1a1dp6CjgL3xF/kYpjn/vJgQWjHQDsz29vSr+4ugdQaLoLReblWsq/stG6QVFM5z2NJAIaZDjLnNdn3s9vVeTXW42r9aZjvl3kfSh3M2khAjhae7zR248XZPrWSsm8GuLdc3Vc1fFc4HQthNDXR89KGNHm4jBAaR4jBPflee3Gtpa15tiYbt6H0Xq3SNvWlbUtjMzXGMxjiO7HPOZzMe0R48ezYOz6o1XqdthtuorvarRC32xXmkq5I2hmR0AaQOZxwBn1nrjCunExscTY255WgNGTk4HrWjbIXm8ah0Wy93ew26z+2pOamjo2FgliwMSFp7MnOOvZg+/viy+w0Y09Puic5az9XdW1d/v5rekUinGImJ595mYiMz/TAiIu68sIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICj/AHS3V05oMQ01RI2uuUzwBRxSgOjbnq+Q9eQfJk9w7SPHvrRbk3O2RUGhHx09MYnvrZWTiOd5GOWNh7R39mM9BnxqS7SOpn6duGpqi2VMVBRytjqJ6gFhMj3YwA7q45Izjsz1WM3m8vpzNKRz8/4e89LemNn1Csbjd68YzEdkTzmZxETPtmfERzPzCzeo9Mbd6n01qXSOgrhYKS+VkzZZ+STmL5GSB/LnJPLnI8zIaT2dyhuybCa+rb5F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AREQEREBERBWHjJ1Baqy62nTkLHvuNuDpppMDljbKG4Z45PK13hjHb3V7UpcU1OyDee5yskDzUQU8jxnPKRE1uPV0aD8qi1eX3VptrWmfn+nD9HeldvTb9H29aeJrE/e3M/zkUlcP+iK/W2qZoIrpWW220TBNWTU0ha85JDWNPc4+d1OcAFR1S09RV1DKalglnnkOGRxMLnOPgAOpVxOGDRly0loeolvVI6kuFyqfLOheMPZG1oawOHcc8xx3c3XquWz0PxtWImOPd1fWHWP9t6beaWiNS3Ffn6zj6Rn74SnRU8VJRwUkIIihjbGwOcSeUDAyT29i+yIvSxGOIfnyZmZzIiIqgiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgpfxSWqrt28FxqqjJiuEUVRA7xaGCMj5Cwj9CwuzGgZ9wNXsthldBb6dnlq2Zv3TY84DW/vnHoPDqeuMKcuMfTxrdI23UcLMvttQYZiB/wB3Ljqfec1o/lLw8FUEIs2pKocpnfUQRu6dQ0NcR+tx/QsBbbxO87LeJnP926dD1BqafpSNzo/86RFP0mJiuf2xP6ps0npXT+lbe2isFqpqGIDDnMb58nrc4+c4+slZpEWdrWKxiIxDTWrq6mteb6lpmZ8zPMiIi5PmIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiDHaks9DqCw1tluUflKSshdFKB2gHvHgQcEHxAUQcO2lrxoHWmqtL3RpfDNHDU0VQBhk8bXPaXDwPnt5h3H1YJnBfzAznAz4r4amhF711PeGT2vVdXb7TW2fmmpjMfExMTEx+2J+Yf1ERfdjBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREH//2Q==" alt="Centro Clínico La Serena" style="height:60px;width:auto;">';
}

function buildInfHTML(tipo) {
  const p      = patients[editingId];
  const esInst = tipo === 'inst';
  const titulo = esInst ? 'Informe a Institución de Salud' : 'Informe Kinésico';
  return `<div class="inf-page">
    <div class="inf-logo-area">${logoSVGInf()}
      <div><div class="inf-clinic-name">Centro Clínico La Serena</div><div class="inf-clinic-sub">Kinesiterapia y Rehabilitación</div></div>
    </div>
    <div class="inf-title">${titulo}</div>
    <div class="inf-section"><div class="inf-stitle">Datos del Paciente</div>
      <div class="inf-row"><span class="inf-lbl">Nombre:</span><span class="inf-val">${p.nombre}</span></div>
      <div class="inf-row"><span class="inf-lbl">RUT:</span><input class="inf-input" id="i-rut" value="${p.rut || ''}"></div>
      <div class="inf-row"><span class="inf-lbl">Especialista:</span><input class="inf-input" id="i-esp" placeholder="Nombre del especialista derivante"></div>
      <div class="inf-row"><span class="inf-lbl">Diagnóstico:</span><span class="inf-val">${p.diagnostico}</span></div>
      <div class="inf-row"><span class="inf-lbl">Fecha informe:</span><input class="inf-input" id="i-fecha" type="date" value="${todayKey}"></div>
    </div>
    <div class="inf-section"><div class="inf-stitle">Evaluación Kinésica Inicial</div>
      <textarea class="inf-textarea" id="i-eval" placeholder="Hallazgos de la evaluación kinésica inicial...">${p.evaluacion || ''}</textarea>
    </div>
    <div class="inf-section"><div class="inf-stitle">Tratamiento Realizado</div>
      <textarea class="inf-textarea" id="i-trat" placeholder="Describa el tratamiento realizado..."></textarea>
    </div>
    ${esInst ? `<div class="inf-section"><div class="inf-stitle">Atenciones</div>
      <table class="inf-atenciones"><thead><tr><th>Fecha</th><th>N° Sesión</th><th>Valor</th></tr></thead>
      <tbody id="i-atenciones">${(p.sesiones || []).map((s, i) =>
        `<tr><td><input value="${s.fecha}"></td><td><input value="${i+1}" style="text-align:center"></td><td><input placeholder="$"></td></tr>`
      ).join('')}</tbody></table>
      <button class="btn-add-at" onclick="addAtencion()"><i class="ti ti-plus"></i> Agregar fila</button>
    </div>` : ''}
    <div class="inf-section"><div class="inf-stitle">Evolución</div>
      <textarea class="inf-textarea" id="i-evol" placeholder="Evolución del paciente durante el tratamiento..."></textarea>
    </div>
    <div class="inf-firma"><div class="inf-firma-box">
      <div style="height:44px"></div>
      <div class="inf-firma-line">
        <input class="inf-input" id="i-terapeuta" placeholder="Nombre del Terapeuta" style="text-align:center;font-weight:bold">
        <div style="font-size:11px;color:#888;margin-top:3px;font-family:Arial,sans-serif">Kinesiólogo/a</div>
      </div>
    </div></div>
  </div>`;
}

window.openInforme = function(tipo) {
  tipoInforme = tipo;
  document.getElementById('inf-content').innerHTML = buildInfHTML(tipo);
  const p = patients[editingId];
  if (tipo === 'inst' && !(p.sesiones || []).length) addAtencion();
  document.getElementById('modal-informe').classList.add('open');
};
window.addAtencion = function() {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="date" value="${todayKey}"></td><td><input placeholder="N°" style="text-align:center"></td><td><input placeholder="$"></td>`;
  document.getElementById('i-atenciones').appendChild(tr);
};
window.closeInforme = function() {
  document.getElementById('modal-informe').classList.remove('open');
};

window.printInforme = function() {
  const p      = patients[editingId];
  const esInst = tipoInforme === 'inst';
  const titulo = esInst ? 'Informe a Institución de Salud' : 'Informe Kinésico';
  const rut    = document.getElementById('i-rut')?.value || '';
  const esp    = document.getElementById('i-esp')?.value || '';
  const fecha  = document.getElementById('i-fecha')?.value || '';
  const evalK  = document.getElementById('i-eval')?.value || '';
  const trat   = document.getElementById('i-trat')?.value || '';
  const evol   = document.getElementById('i-evol')?.value || '';
  const tera   = document.getElementById('i-terapeuta')?.value || '';
  let filas    = '';
  if (esInst) {
    filas = Array.from(document.querySelectorAll('#i-atenciones tr')).map(tr => {
      const ins = tr.querySelectorAll('input');
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${ins[0]?.value||''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${ins[1]?.value||''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${ins[2]?.value||''}</td></tr>`;
    }).join('');
  }
  const svgStr = logoSVGInf();
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>${titulo} - ${p.nombre}</title>
  <style>
    body{font-family:Georgia,serif;color:#111;max-width:700px;margin:40px auto;padding:20px}
    .logo-area{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:2.5px solid #CC0000;margin-bottom:20px}
    .clinic-name{font-size:20px;font-weight:bold}.clinic-sub{font-size:12px;color:#666;margin-top:2px}
    h1{font-size:16px;text-align:center;color:#CC0000;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #ddd}
    .section{margin-bottom:20px}
    .section-title{font-size:11px;font-weight:bold;color:#CC0000;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:10px;font-family:Arial,sans-serif}
    .row{display:flex;gap:10px;margin-bottom:8px}
    .lbl{font-size:12px;font-weight:bold;min-width:130px;font-family:Arial,sans-serif}
    .val{font-size:13px;flex:1;border-bottom:1px solid #ccc;padding-bottom:2px}
    .texto{font-size:13px;line-height:1.7;white-space:pre-wrap;border:1px solid #ddd;padding:10px;border-radius:4px;min-height:60px}
    table{width:100%;border-collapse:collapse}
    th{background:#CC0000;color:white;padding:8px 10px;text-align:left;font-family:Arial,sans-serif;font-size:12px}
    .firma{display:flex;justify-content:flex-end;margin-top:50px}
    .firma-box{text-align:center;width:220px;border-top:1.5px solid #333;padding-top:8px;font-size:12px;font-family:Arial,sans-serif}
    @media print{body{margin:10px}}
  </style></head><body>
  <div class="logo-area">${svgStr}
    <div><div class="clinic-name">Centro Clínico La Serena</div><div class="clinic-sub">Kinesiterapia y Rehabilitación</div></div>
  </div>
  <h1>${titulo}</h1>
  <div class="section"><div class="section-title">Datos del Paciente</div>
    <div class="row"><span class="lbl">Nombre:</span><span class="val">${p.nombre}</span></div>
    <div class="row"><span class="lbl">RUT:</span><span class="val">${rut}</span></div>
    <div class="row"><span class="lbl">Especialista:</span><span class="val">${esp}</span></div>
    <div class="row"><span class="lbl">Diagnóstico:</span><span class="val">${p.diagnostico}</span></div>
    <div class="row"><span class="lbl">Fecha informe:</span><span class="val">${fecha}</span></div>
  </div>
  <div class="section"><div class="section-title">Evaluación Kinésica Inicial</div><div class="texto">${evalK}</div></div>
  <div class="section"><div class="section-title">Tratamiento Realizado</div><div class="texto">${trat}</div></div>
  ${esInst ? `<div class="section"><div class="section-title">Atenciones</div>
    <table><thead><tr><th>Fecha</th><th>N° Sesión</th><th>Valor</th></tr></thead><tbody>${filas}</tbody></table></div>` : ''}
  <div class="section"><div class="section-title">Evolución</div><div class="texto">${evol}</div></div>
  <div class="firma"><div class="firma-box"><strong>${tera}</strong><br>Kinesiólogo/a<br>
    <span style="color:#888;font-size:11px">Centro Clínico La Serena</span></div></div>
  </body></html>`);
  win.document.close();
  win.print();
};

// ── INIT ─────────────────────────────────────
initRealtimeListeners();
renderCalendar();
