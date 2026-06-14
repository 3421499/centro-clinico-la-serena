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
  return `<svg width="14" height="58" viewBox="0 0 14 58" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 1 C9.5 4 10.5 8 9 12 C7.5 16 5.5 17 7 21 C8.5 25 10.5 27 9 31.5 C7.5 36 5.5 38 7 42 C8.5 46 10.5 48 9 52 C8 54.5 7 57 7 57" stroke="#CC0000" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="7" cy="5"  rx="3.8" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="13" rx="4.1" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="21" rx="4.1" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="29" rx="4.1" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="37" rx="4.1" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="44" rx="3.8" ry="2.5" fill="#CC0000"/>
    <ellipse cx="7" cy="51" rx="3.2" ry="2.2" fill="#CC0000"/>
  </svg>`;
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
