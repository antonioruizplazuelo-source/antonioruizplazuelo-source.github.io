// =============================================
// FaR-Rmacia - App Logic v3.0
// CORRECCIONES:
// 1) PDF de pedidos (mismo aspecto que el móvil)
// 2) Archivos historial abribles en móvil (IndexedDB)
// 3) Sync inteligente: al arrancar SIEMPRE
//    descarga Firebase si local está vacío o
//    Firebase es más nuevo. Nunca sobreescribe
//    Firebase con datos vacíos.
// =============================================

// ===== FIREBASE CONFIG =====
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDoGBiEghMRHxYSL7l_gSXF-qBp0Lb_WTU",
  authDomain: "far-rmacia.firebaseapp.com",
  projectId: "far-rmacia",
  storageBucket: "far-rmacia.firebasestorage.app",
  messagingSenderId: "462585209909",
  appId: "1:462585209909:web:e093a33ebae8c9fe6fbd7c"
};
const FIREBASE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const USER_ID = 'antonio';

// =============================================
// ===== INDEXEDDB — almacenamiento archivos ===
// =============================================
// Los archivos binarios (base64) se guardan en
// IndexedDB que NO se borra con "Borrar caché"
// normal. Solo se pierde con "Borrar datos del
// sitio" en los ajustes del navegador/Android.
// =============================================
let idbDb = null;
const IDB_NAME  = 'farrmacia_files';
const IDB_STORE = 'archivos';

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (idbDb) return resolve(idbDb);
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    req.onsuccess  = e => { idbDb = e.target.result; resolve(idbDb); };
    req.onerror    = () => reject(req.error);
  });
}
async function idbSet(id, base64, tipo, nombre) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, base64, tipo, nombre });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

// =============================================
// ===== BASE DE DATOS (localStorage) ==========
// =============================================
const DB = {
  get(key, def = []) {
    try { return JSON.parse(localStorage.getItem('farrmacia_' + key)) ?? def; }
    catch { return def; }
  },
  set(key, val) {
    localStorage.setItem('farrmacia_' + key, JSON.stringify(val));
    localStorage.setItem('farrmacia_localModified', new Date().toISOString());
    scheduleAutoSync();
  },
  setRaw(key, val) {
    // Para restaurar desde Firebase SIN marcar como pendiente de subida
    localStorage.setItem('farrmacia_' + key, JSON.stringify(val));
  }
};

function estaVacioLocal() {
  return localStorage.getItem('farrmacia_meds') === null;
}

// =============================================
// ===== SINCRONIZACIÓN FIREBASE ===============
// =============================================
let syncInProgress = false;
let syncTimer      = null;

function firestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number')  return { doubleValue: val };
  if (typeof val === 'string')  return { stringValue: val };
  if (Array.isArray(val))       return { arrayValue: { values: val.map(firestoreValue) } };
  if (typeof val === 'object')  {
    const fields = {};
    for (const k in val) fields[k] = firestoreValue(val[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function parseFirestoreValue(v) {
  if (!v) return null;
  if ('nullValue'    in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('doubleValue'  in v) return v.doubleValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('stringValue'  in v) return v.stringValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if ('mapValue'     in v) {
    const obj = {};
    for (const k in v.mapValue.fields) obj[k] = parseFirestoreValue(v.mapValue.fields[k]);
    return obj;
  }
  return null;
}

async function getFirebaseTimestamp() {
  try {
    const resp = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}?mask.fieldPaths=ultimaSincro`);
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.fields?.ultimaSincro ? parseFirestoreValue(json.fields.ultimaSincro) : null;
  } catch { return null; }
}

async function syncToFirebase(silencioso = false) {
  if (syncInProgress) return false;
  syncInProgress = true;
  document.getElementById('btn-sync')?.classList.add('syncing');
  try {
    const data = {
      meds:              DB.get('meds', []),
      citas:             DB.get('citas', []),
      historial_pedidos: DB.get('historial_pedidos', []),
      notas:             DB.get('notas', ''),
      nextId:            DB.get('nextId', 100),
      nextPedidoId:      DB.get('nextPedidoId', 1),
      // docs: solo metadatos, sin base64
      docs: DB.get('docs', []).map(({ base64, ...meta }) => meta),
      ultimaSincro: new Date().toISOString()
    };
    const fields = {};
    for (const k in data) fields[k] = firestoreValue(data[k]);

    const resp = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    localStorage.setItem('farrmacia_lastSync', data.ultimaSincro);
    localStorage.removeItem('farrmacia_pendingSync');
    if (!silencioso) showToast('☁️ Sincronizado con Firebase', 'success');
    actualizarIndicadorSync(true);
    return true;
  } catch (err) {
    console.error('syncToFirebase:', err);
    localStorage.setItem('farrmacia_pendingSync', 'true');
    if (!silencioso) showToast('⚠️ Error al sincronizar: ' + err.message, 'error');
    actualizarIndicadorSync(false);
    return false;
  } finally {
    syncInProgress = false;
    document.getElementById('btn-sync')?.classList.remove('syncing');
  }
}

async function syncFromFirebase(silencioso = false) {
  if (syncInProgress) return false;
  syncInProgress = true;
  document.getElementById('btn-sync')?.classList.add('syncing');
  try {
    const resp = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.fields) throw new Error('Sin datos en Firebase');

    const data = {};
    for (const k in json.fields) data[k] = parseFirestoreValue(json.fields[k]);

    if (data.meds              !== undefined) DB.setRaw('meds',              data.meds);
    if (data.citas             !== undefined) DB.setRaw('citas',             data.citas);
    if (data.historial_pedidos !== undefined) DB.setRaw('historial_pedidos', data.historial_pedidos);
    if (data.notas             !== undefined) DB.setRaw('notas',             data.notas);
    if (data.nextId            !== undefined) DB.setRaw('nextId',            data.nextId);
    if (data.nextPedidoId      !== undefined) DB.setRaw('nextPedidoId',      data.nextPedidoId);
    if (data.docs              !== undefined) DB.setRaw('docs',              data.docs);

    if (data.ultimaSincro) {
      localStorage.setItem('farrmacia_lastSync',      data.ultimaSincro);
      localStorage.setItem('farrmacia_localModified', data.ultimaSincro);
    }
    localStorage.removeItem('farrmacia_pendingSync');

    if (!silencioso) showToast('✅ Datos restaurados de Firebase', 'success');
    actualizarIndicadorSync(true);
    navigate(currentScreen);
    cargarCitasMini();
    return true;
  } catch (err) {
    console.error('syncFromFirebase:', err);
    if (!silencioso) showToast('⚠️ Error al cargar: ' + err.message, 'error');
    return false;
  } finally {
    syncInProgress = false;
    document.getElementById('btn-sync')?.classList.remove('syncing');
  }
}

// ── Auto-sync: 5 segundos tras el último cambio ──
function scheduleAutoSync() {
  localStorage.setItem('farrmacia_pendingSync', 'true');
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const ok = await syncToFirebase(true);
    if (ok) {
      const bar = document.getElementById('sync-status-bar');
      if (bar) {
        bar.style.display = 'flex';
        bar.className = 'sync-bar';
        bar.innerHTML = `☁️ <span>Guardado en la nube · ${new Date().toLocaleTimeString('es-ES')}</span>`;
        setTimeout(() => bar.style.display = 'none', 3000);
      }
    }
  }, 5000);
}

// ── Sincronización inteligente al arrancar ──
async function syncInteligente() {
  mostrarSpinnerInicio(true);
  try {
    if (estaVacioLocal()) {
      // localStorage limpio → descargar Firebase siempre
      const ok = await syncFromFirebase(true);
      if (!ok) initDBLocal(); // Firebase vacío o sin conexión
      return;
    }

    const tsFirebase = await getFirebaseTimestamp();
    const tsLocal    = localStorage.getItem('farrmacia_localModified');

    if (!tsFirebase) {
      // Sin conexión o Firebase vacío → subir si tenemos datos
      if (DB.get('meds', []).length > 0) await syncToFirebase(true);
      return;
    }

    if (tsLocal && tsFirebase > tsLocal) {
      // Firebase más nuevo → descargar
      await syncFromFirebase(true);
      showToast('☁️ Datos actualizados desde Firebase', 'info');
    } else if (localStorage.getItem('farrmacia_pendingSync') === 'true') {
      // Cambios pendientes → subir
      await syncToFirebase(true);
    }
  } catch (err) {
    console.error('syncInteligente:', err);
  } finally {
    mostrarSpinnerInicio(false);
  }
}

function mostrarSpinnerInicio(mostrar) {
  let el = document.getElementById('sync-spinner-inicio');
  if (!el && mostrar) {
    el = document.createElement('div');
    el.id = 'sync-spinner-inicio';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(45,139,87,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;font-family:Nunito,sans-serif;gap:16px;';
    el.innerHTML = `<div style="font-size:48px">💊</div><div style="font-size:22px;font-weight:900">FaR-Rmacia</div><div style="font-size:14px;opacity:.85">Sincronizando datos...</div><div style="width:48px;height:48px;border:4px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .8s linear infinite"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  if (el) el.style.display = mostrar ? 'flex' : 'none';
}

function actualizarIndicadorSync(ok) {
  const bar = document.getElementById('sync-status-bar');
  if (!bar) return;
  if (ok) { bar.style.display = 'none'; }
  else {
    bar.style.display = 'flex';
    bar.className = 'sync-bar error';
    bar.innerHTML = `❌ <span>Sin conexión — cambios guardados localmente</span>`;
  }
}

function abrirSyncPanel() {
  const hasPending = localStorage.getItem('farrmacia_pendingSync') === 'true';
  const lastSync   = localStorage.getItem('farrmacia_lastSync');
  const lastSyncStr = lastSync ? new Date(lastSync).toLocaleString('es-ES') : 'Nunca';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">☁️ Firebase & Backup</div>
      <div style="background:#f0f8ff;border-radius:12px;padding:14px;margin-bottom:12px;font-size:13px;color:#333;line-height:1.9">
        <div><strong>Estado:</strong> ${hasPending ? '⚠️ Cambios pendientes de subir' : '✅ Todo sincronizado'}</div>
        <div><strong>Última sync:</strong> ${lastSyncStr}</div>
        <div><strong>Medicamentos:</strong> ${DB.get('meds',[]).length}</div>
        <div><strong>Usuario:</strong> ${USER_ID}</div>
      </div>
      <div style="font-size:12px;background:#fffde7;border-radius:10px;padding:10px;margin-bottom:12px;color:#666;line-height:1.6">
        💡 <strong>Sync automático:</strong> la app sube los cambios a Firebase automáticamente 5 segundos después de cada modificación. Al abrir la app, si detecta que Firebase tiene datos más recientes, los descarga antes de mostrarte nada.
      </div>
      <button class="btn-primary" onclick="syncToFirebase();this.closest('.modal-overlay').remove()">☁️ Subir a Firebase ahora</button>
      <button class="btn-primary" style="background:var(--azul);margin-top:8px" onclick="syncFromFirebase();this.closest('.modal-overlay').remove()">📥 Descargar de Firebase ahora</button>
      <hr style="margin:14px 0;border:none;border-top:1px solid #eee"/>
      <div style="font-size:13px;font-weight:900;color:var(--azul-oscuro);margin-bottom:6px">💾 Backup local (JSON)</div>
      <div style="font-size:12px;color:#888;margin-bottom:8px">Incluye todos los datos y archivos. Guárdalo en Google Drive como seguridad extra.</div>
      <button class="btn-secondary" style="margin-top:0" onclick="exportarBackup();this.closest('.modal-overlay').remove()">📤 Exportar Backup completo</button>
      <button class="btn-secondary" style="margin-top:8px" onclick="importarBackup()">📥 Importar Backup</button>
      <input type="file" id="import-backup-input" accept=".json" style="display:none" onchange="procesarImportBackup(event)"/>
      <button class="btn-secondary" style="margin-top:16px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function exportarBackup() {
  showToast('⏳ Preparando backup...', 'info');
  try {
    const docs = DB.get('docs', []);
    const docsConBase64 = [];
    for (const doc of docs) {
      if (doc.es_archivo) {
        const entry = await idbGet(doc.id).catch(() => null);
        docsConBase64.push({ ...doc, base64: entry?.base64 || null });
      } else { docsConBase64.push({ ...doc, base64: null }); }
    }
    const backup = {
      version: 3, fecha: new Date().toISOString(),
      meds: DB.get('meds', []), citas: DB.get('citas', []),
      historial_pedidos: DB.get('historial_pedidos', []),
      notas: DB.get('notas', ''), docs: docsConBase64,
      nextId: DB.get('nextId', 100), nextPedidoId: DB.get('nextPedidoId', 1)
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const fname = `farrmacia_backup_${new Date().toISOString().slice(0,10)}.json`;
    if (navigator.share && navigator.canShare?.({ files: [new File([blob], fname)] })) {
      await navigator.share({ files: [new File([blob], fname, { type: 'application/json' })], title: 'Backup FaR-Rmacia' });
    } else {
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: fname }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    showToast('✅ Backup exportado');
  } catch(err) { showToast('⚠️ Error: ' + err.message, 'error'); }
}

function importarBackup() { document.getElementById('import-backup-input')?.click(); }

async function procesarImportBackup(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      showConfirm('📥 Importar Backup', '¿Sobrescribir todos los datos actuales?', async () => {
        if (data.meds)              DB.setRaw('meds', data.meds);
        if (data.citas)             DB.setRaw('citas', data.citas);
        if (data.historial_pedidos) DB.setRaw('historial_pedidos', data.historial_pedidos);
        if (data.notas !== undefined) DB.setRaw('notas', data.notas);
        if (data.nextId)            DB.setRaw('nextId', data.nextId);
        if (data.nextPedidoId)      DB.setRaw('nextPedidoId', data.nextPedidoId);
        if (data.docs) {
          DB.setRaw('docs', data.docs.map(({ base64, ...m }) => m));
          for (const doc of data.docs)
            if (doc.es_archivo && doc.base64)
              await idbSet(doc.id, doc.base64, doc.tipo, doc.nombre).catch(() => {});
        }
        localStorage.setItem('farrmacia_localModified', new Date().toISOString());
        showToast('✅ Backup importado', 'success');
        await syncToFirebase(true);
        navigate(currentScreen); cargarCitasMini();
      });
    } catch { showToast('❌ Error al leer el backup', 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// =============================================
// ===== INICIALIZAR DATOS =====================
// =============================================
function initDBLocal() {
  if (!estaVacioLocal()) return;
  localStorage.setItem('farrmacia_meds', JSON.stringify([
    { id: 1, nombre: 'Ejemplo - Omeprazol 20mg', cantidad_bote: 28, dosis_dia: 1, stock_real: 2, observaciones: 'En ayunas', foto: '', fecha_inicio: '', incluir_pedido: 1 }
  ]));
  localStorage.setItem('farrmacia_nextId',      JSON.stringify(100));
  localStorage.setItem('farrmacia_nextPedidoId',JSON.stringify(1));
  localStorage.setItem('farrmacia_notas',       JSON.stringify(''));
  localStorage.setItem('farrmacia_citas',       JSON.stringify([]));
  localStorage.setItem('farrmacia_historial_pedidos', JSON.stringify([]));
  localStorage.setItem('farrmacia_docs',        JSON.stringify([]));
  localStorage.setItem('farrmacia_localModified', new Date().toISOString());
}

function nextId() {
  const n = DB.get('nextId', 100) + 1;
  localStorage.setItem('farrmacia_nextId', JSON.stringify(n));
  return n;
}

// =============================================
// ===== GENERACIÓN PDF PEDIDO =================
// =============================================
function generarPDFPedido(numPedido, fecha, filas) {
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/>
<title>Pedido ${numPedido}</title>
<style>
@page{size:A4 portrait;margin:18mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#222;background:#fff}
.cabecera{border-bottom:3px solid #2D8B57;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end}
.cab-left .titulo{font-size:24px;font-weight:900;color:#1F4E79;letter-spacing:-0.5px}
.cab-left .num{font-size:15px;font-weight:700;color:#2D8B57;margin-top:4px}
.cab-left .sub{font-size:12px;color:#777;margin-top:2px}
.cab-right{text-align:right;font-size:12px;color:#777}
table{width:100%;border-collapse:collapse;margin-top:4px}
thead tr{background:#1F4E79;color:#fff}
thead th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
thead th.c{text-align:center}
tbody tr:nth-child(even) td{background:#f4f8fc}
tbody td{padding:9px 12px;border-bottom:1px solid #e8e8e8;font-size:13px}
.qty{background:#fffde7!important;font-weight:900;color:#555;text-align:center;font-size:14px}
.tot{font-weight:900;text-align:center}
.dias{color:#2D8B57;font-weight:700;font-size:12px}
.stk{text-align:center}
.resumen{margin-top:22px;background:#f0f8ef;border-radius:8px;padding:12px 16px}
.resumen h3{font-size:11px;font-weight:900;color:#1F4E79;text-transform:uppercase;margin-bottom:8px;letter-spacing:.4px}
.rrow{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px dotted #ccc}
.rrow:last-child{border-bottom:none}
.pie{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#aaa;display:flex;justify-content:space-between}
</style></head><body>
<div class="cabecera">
  <div class="cab-left">
    <div class="titulo">💊 FaR-Rmacia</div>
    <div class="num">Nº Pedido: ${numPedido}</div>
    <div class="sub">Resumen de Pedido a Farmacia</div>
  </div>
  <div class="cab-right">Fecha: ${fecha}<br>Impreso: ${new Date().toLocaleString('es-ES')}</div>
</div>
<table>
  <thead><tr>
    <th>Medicamento</th>
    <th class="c">A pedir</th>
    <th class="c">Stock actual</th>
    <th class="c">Total tras pedido</th>
    <th>Meses / Días</th>
  </tr></thead>
  <tbody>
    ${filas.map(f => `<tr>
      <td>${f.nombre}</td>
      <td class="qty">${f.qty}</td>
      <td class="stk">${f.stockActual}</td>
      <td class="tot">${f.stockTras}</td>
      <td class="dias">${f.diasTras} días &nbsp;|&nbsp; ${f.mesesTras} mes.</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="resumen">
  <h3>📋 Resumen rápido</h3>
  ${filas.map(f => `<div class="rrow"><span>${f.nombre}</span><span>Pedir <strong>${f.qty}</strong> bote(s) → <strong>${f.diasTras}</strong> días (${f.mesesTras} mes.)</span></div>`).join('')}
</div>
<div class="pie">
  <span>FaR-Rmacia · Gestión de medicamentos personales</span>
  <span>${numPedido}</span>
</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()};}<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank', 'width=860,height=960');
  if (!w) {
    // Pop-ups bloqueados → descargar
    Object.assign(document.createElement('a'), { href: url, download: numPedido + '_resumen.html' }).click();
    showToast('📄 Guardado como HTML — ábrelo para imprimir/PDF', 'info');
  }
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

// =============================================
// ===== GESTOS SWIPE ==========================
// =============================================
const NAV_ORDER = ['menu','inventario','pedidos','citas','historial'];
let swipeStartX = 0, swipeStartY = 0;

function initSwipeGestures() {
  const content = document.getElementById('content');
  content.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; swipeStartY = e.touches[0].clientY; }, { passive: true });
  content.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = NAV_ORDER.indexOf(currentScreen);
    if (idx < 0) return;
    if (dx < 0 && idx < NAV_ORDER.length - 1) navigate(NAV_ORDER[idx + 1]);
    else if (dx > 0 && idx > 0) navigate(NAV_ORDER[idx - 1]);
  }, { passive: true });
}

// =============================================
// ===== FOTOS MEDICAMENTOS ====================
// =============================================
let fotoTemporal = { f: null, m: null };

function seleccionarFoto(prefix) { document.getElementById(prefix + '-foto-input')?.click(); }
function procesarFoto(event, prefix) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    fotoTemporal[prefix] = e.target.result;
    const prev = document.getElementById(prefix + '-foto-prev');
    if (prev) { prev.className = 'foto-preview'; prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>`; }
    const btn = document.getElementById(prefix + '-foto-del-btn'); if (btn) btn.style.display = 'block';
  };
  reader.readAsDataURL(file); event.target.value = '';
}
function borrarFoto(prefix) {
  fotoTemporal[prefix] = '';
  const prev = document.getElementById(prefix + '-foto-prev'); if (prev) { prev.className = 'foto-preview empty'; prev.innerHTML = '📷'; }
  const btn = document.getElementById(prefix + '-foto-del-btn'); if (btn) btn.style.display = 'none';
}
function mostrarFotoPrev(prefix, b64) {
  const prev = document.getElementById(prefix + '-foto-prev');
  const btn  = document.getElementById(prefix + '-foto-del-btn');
  if (!prev) return;
  if (b64) { prev.className = 'foto-preview'; prev.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>`; if (btn) btn.style.display = 'block'; }
  else { prev.className = 'foto-preview empty'; prev.innerHTML = '📷'; if (btn) btn.style.display = 'none'; }
}

// =============================================
// ===== NAVEGACIÓN ============================
// =============================================
let currentScreen  = 'menu';
let navHistory     = [];
let editingCitaId  = null;
let editingMedId   = null;
let pedidoItems    = [];

function navigate(screen) {
  if (currentScreen !== screen) navHistory.push(currentScreen);
  currentScreen = screen;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + screen)?.classList.add('active');
  const titles = {
    'menu':             { title:'💊 FaR-Rmacia',        sub:'Tu farmacia personal', back:false },
    'inventario':       { title:'📦 Stock e Inventario', sub:'',                    back:true  },
    'medicamentos':     { title:'💊 Nuevo Medicamento',  sub:'',                    back:true  },
    'pedidos':          { title:'🛒 Pedido Farmacia',    sub:'',                    back:true  },
    'citas':            { title:'📅 Citas Médicas',      sub:'',                    back:true  },
    'historial':        { title:'📁 Historial Médico',   sub:'',                    back:true  },
    'modificar':        { title:'✏️ Modificar',          sub:'',                    back:true  },
    'historial-pedidos':{ title:'📜 Historial Pedidos',  sub:'',                    back:true  },
  };
  const t = titles[screen] || { title:'FaR-Rmacia', sub:'', back:true };
  document.getElementById('header-title').textContent = t.title;
  document.getElementById('header-sub').textContent   = t.sub;
  document.getElementById('btn-back').classList.toggle('visible', t.back);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === screen));
  const fab = document.getElementById('fab');
  if (['inventario','medicamentos','citas'].includes(screen)) { fab.textContent = '+'; fab.classList.add('visible'); }
  else fab.classList.remove('visible');
  switch(screen) {
    case 'menu':               cargarCitasMini(); break;
    case 'inventario':         renderInventario(); break;
    case 'pedidos':            renderPedidos(); break;
    case 'citas':              renderCitas(); break;
    case 'historial':          cargarHistorial(); break;
    case 'historial-pedidos':  renderHistorialPedidos(); break;
    case 'medicamentos': fotoTemporal['f'] = null; mostrarFotoPrev('f', null); break;
  }
  document.getElementById('content').scrollTop = 0;
}

function goBack() {
  if (navHistory.length > 0) { const p = navHistory.pop(); navHistory.pop(); navigate(p); }
  else navigate('menu');
}
function fabAction() {
  if (['inventario','medicamentos'].includes(currentScreen)) { navigate('medicamentos'); limpiarFormulario(); }
  else if (currentScreen === 'citas') document.getElementById('c-prof').focus();
}

function actualizarReloj() {
  const a = new Date();
  document.getElementById('header-clock').innerHTML =
    `${String(a.getDate()).padStart(2,'0')} ${a.toLocaleString('es-ES',{month:'short'})} ${a.getFullYear()}<br>${String(a.getHours()).padStart(2,'0')}:${String(a.getMinutes()).padStart(2,'0')}`;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  setTimeout(() => t.className = '', 2800);
}

function showConfirm(title, text, onOk) {
  const o = document.createElement('div');
  o.className = 'confirm-overlay';
  o.innerHTML = `<div class="confirm-box"><div class="confirm-title">${title}</div><div class="confirm-text">${text}</div><div class="confirm-btns"><button class="confirm-cancel" onclick="this.closest('.confirm-overlay').remove()">Cancelar</button><button class="confirm-ok" id="confirm-ok-btn">Sí, confirmar</button></div></div>`;
  document.body.appendChild(o);
  document.getElementById('confirm-ok-btn').onclick = () => { o.remove(); onOk(); };
}

// =============================================
// ===== CALCULAR STOCK ========================
// =============================================
function calcularStock(med) {
  const unidBote  = parseFloat(med.cantidad_bote || 0);
  const tomaDia   = parseFloat(med.dosis_dia || 0);
  const dosisTotal = parseFloat(med.stock_real || 0) * unidBote;
  if (med.fecha_inicio && tomaDia > 0) {
    const diasPasados   = Math.max(0, Math.floor((new Date() - new Date(med.fecha_inicio)) / 86400000));
    const dosisActuales = Math.max(0, dosisTotal - diasPasados * tomaDia);
    const botesCalc     = unidBote > 0 ? Math.round(dosisActuales / unidBote * 100) / 100 : 0;
    return { dosisActuales, botesCalc, diasRestantes: tomaDia > 0 ? Math.floor(dosisActuales / tomaDia) : 0, unidBote, tomaDia, iniciado: true };
  }
  return { dosisActuales: dosisTotal, botesCalc: parseFloat(med.stock_real || 0), diasRestantes: tomaDia > 0 ? Math.floor(dosisTotal / tomaDia) : 0, unidBote, tomaDia, iniciado: false };
}
function formatTiempo(d) { return d <= 0 ? '⚠️ Sin stock' : `${d} días | ${(d/7).toFixed(1)} sem. | ${(d/30).toFixed(1)} mes.`; }
function colorDias(d) { return d <= 7 ? 'danger' : d <= 30 ? 'warn' : ''; }

// =============================================
// ===== INVENTARIO ============================
// =============================================
function renderInventario() {
  const meds = DB.get('meds');
  const c = document.getElementById('inventario-list');
  if (!meds.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">No hay medicamentos.<br>Pulsa + para añadir.</div></div>`; return; }
  c.innerHTML = meds.map(med => {
    const s = calcularStock(med);
    const pct = s.iniciado ? Math.min(100, Math.round(s.diasRestantes / 90 * 100)) : 100;
    const fotoHtml = med.foto ? `<img src="${med.foto}" class="med-thumb" onclick="event.stopPropagation();verFotoMed(${med.id})" alt="foto"/>` : '';
    return `<div class="med-card" onclick="abrirModificar(${med.id})">${fotoHtml}
      <div class="med-card-name">💊 ${med.nombre.toUpperCase()}</div>
      <div style="display:flex;gap:8px;margin:4px 0;flex-wrap:wrap">
        <span class="badge badge-azul">${s.botesCalc} botes</span>
        <span class="badge badge-naranja">${s.unidBote} uds/bote</span>
        <span class="badge badge-verde">${s.tomaDia}/día</span>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar ${colorDias(s.diasRestantes)}" style="width:${pct}%"></div></div>
      <div class="med-card-info">⏳ ${s.iniciado ? formatTiempo(s.diasRestantes) : "▶️ Pulsa 'Iniciar'"}</div>
      <div class="med-card-pedido ${med.incluir_pedido ? 'incluido' : 'excluido'}">${med.incluir_pedido ? '✅ Incluido en pedidos' : '❌ Excluido'}</div>
      ${med.observaciones ? `<div class="med-card-obs">📝 ${med.observaciones}</div>` : ''}
      <div class="med-card-actions">
        <button class="btn-icon btn-verde" onclick="event.stopPropagation();iniciarTratamiento(${med.id})">▶️ Iniciar</button>
        <button class="btn-icon btn-azul"  onclick="event.stopPropagation();abrirModificar(${med.id})">✏️ Editar</button>
        <button class="btn-icon btn-rojo"  onclick="event.stopPropagation();borrarMed(${med.id})">🗑️</button>
      </div></div>`;
  }).join('');
}

function verFotoMed(id) {
  const med = DB.get('meds').find(m => m.id == id); if (!med?.foto) return;
  const modal = document.createElement('div'); modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-sheet" style="text-align:center"><div class="modal-handle"></div><div class="modal-title">📷 ${med.nombre}</div><img src="${med.foto}" style="max-width:100%;border-radius:14px;margin-bottom:16px"/><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function limpiarFormulario() {
  ['f-nombre','f-bote','f-dosis','f-stock','f-obs'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  const inc = document.getElementById('f-incluir'); if (inc) inc.checked = true;
  fotoTemporal['f'] = null; mostrarFotoPrev('f', null);
}

function guardarMedicamento() {
  const nombre = document.getElementById('f-nombre').value.trim();
  if (!nombre) { showToast('⚠️ Escribe el nombre', 'error'); return; }
  const meds = DB.get('meds');
  meds.push({ id: nextId(), nombre, cantidad_bote: parseFloat(document.getElementById('f-bote').value)||0, dosis_dia: parseFloat(document.getElementById('f-dosis').value)||0, stock_real: parseFloat(document.getElementById('f-stock').value)||0, observaciones: document.getElementById('f-obs').value.trim(), foto: fotoTemporal['f']||'', fecha_inicio:'', incluir_pedido: document.getElementById('f-incluir').checked?1:0 });
  DB.set('meds', meds); limpiarFormulario(); showToast('✅ Medicamento guardado'); navigate('inventario');
}

function iniciarTratamiento(id) {
  const modal = document.createElement('div'); modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📅 Fecha de inicio</div><div class="form-group"><label class="form-label">Selecciona la fecha</label><input type="date" class="form-input" id="modal-fecha" value="${new Date().toISOString().split('T')[0]}" style="padding:12px"/></div><button class="btn-primary" onclick="guardarFechaInicio(${id})">💾 Guardar Fecha</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
function guardarFechaInicio(id) {
  const fecha = document.getElementById('modal-fecha').value;
  const meds = DB.get('meds'); const idx = meds.findIndex(m => m.id===id);
  if (idx>=0) { meds[idx].fecha_inicio = fecha; DB.set('meds', meds); showToast('✅ Tratamiento iniciado'); document.querySelector('.modal-overlay')?.remove(); renderInventario(); }
}

function abrirModificar(id) {
  const med = DB.get('meds').find(m => m.id===id); if (!med) return;
  const s = calcularStock(med);
  document.getElementById('m-nombre').value = med.nombre;
  document.getElementById('m-bote').value   = med.cantidad_bote;
  document.getElementById('m-dosis').value  = med.dosis_dia;
  document.getElementById('m-stock').value  = s.botesCalc;
  document.getElementById('m-obs').value    = med.observaciones||'';
  document.getElementById('m-fecha').value  = med.fecha_inicio||'';
  document.getElementById('m-incluir').checked = med.incluir_pedido===1;
  fotoTemporal['m'] = null; mostrarFotoPrev('m', med.foto||null);
  document.getElementById('m-guardar').onclick = () => actualizarMed(id);
  document.getElementById('m-borrar').onclick  = () => borrarMed(id);
  navigate('modificar');
}
function actualizarMed(id) {
  const meds = DB.get('meds'); const idx = meds.findIndex(m => m.id===id); if (idx<0) return;
  const fotoFinal = fotoTemporal['m']===null ? meds[idx].foto : (fotoTemporal['m']||'');
  meds[idx] = { ...meds[idx], nombre: document.getElementById('m-nombre').value.trim(), cantidad_bote: parseFloat(document.getElementById('m-bote').value)||0, dosis_dia: parseFloat(document.getElementById('m-dosis').value)||0, stock_real: parseFloat(document.getElementById('m-stock').value)||0, observaciones: document.getElementById('m-obs').value.trim(), fecha_inicio: document.getElementById('m-fecha').value||'', incluir_pedido: document.getElementById('m-incluir').checked?1:0, foto: fotoFinal };
  DB.set('meds', meds); showToast('✅ Registro actualizado'); navigate('inventario');
}
function borrarMed(id) {
  showConfirm('🗑️ Eliminar', '¿Eliminar este medicamento?', () => { DB.set('meds', DB.get('meds').filter(m => m.id!==id)); showToast('Eliminado', 'error'); navigate('inventario'); });
}

// =============================================
// ===== PEDIDOS ===============================
// =============================================
function renderPedidos() {
  const meds = DB.get('meds').sort((a,b) => b.incluir_pedido-a.incluir_pedido||a.nombre.localeCompare(b.nombre));
  pedidoItems = meds.map(med => ({ ...med, ...calcularStock(med), qty:0 }));
  const c = document.getElementById('pedidos-list');
  if (!meds.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-text">No hay medicamentos.</div></div>`; return; }
  c.innerHTML = `<div class="card">` + pedidoItems.map((item,i) => `
    <div class="pedido-row" id="pedido-row-${i}" style="${!item.incluir_pedido?'opacity:.5;background:#fff5f5':''}">
      <div><input type="checkbox" style="width:20px;height:20px;accent-color:var(--verde)" ${item.incluir_pedido?'checked':''} onchange="togglePedidoIncluir(${i},this.checked)"/></div>
      <input type="number" class="pedido-qty" id="qty-${i}" value="0" min="0" onchange="actualizarFuturo(${i})" oninput="actualizarFuturo(${i})"/>
      <div class="pedido-info">
        <div class="pedido-nombre">${item.nombre}</div>
        <div class="pedido-stock">📦 ${item.botesCalc} botes | ${formatTiempo(item.diasRestantes)}</div>
        <div class="pedido-futuro" id="futuro-${i}">--</div>
      </div></div>`).join('') + `</div>`;
}
function togglePedidoIncluir(i, checked) { pedidoItems[i].incluir_pedido=checked?1:0; const r=document.getElementById('pedido-row-'+i); r.style.opacity=checked?'1':'.5'; r.style.background=checked?'':'#fff5f5'; }
function actualizarFuturo(i) {
  const qty = parseFloat(document.getElementById('qty-'+i).value)||0; pedidoItems[i].qty=qty;
  const it = pedidoItems[i];
  document.getElementById('futuro-'+i).textContent = qty>0&&it.tomaDia>0&&it.unidBote>0 ? '✅ Tras pedir: '+formatTiempo(Math.floor((it.dosisActuales+qty*it.unidBote)/it.tomaDia)) : '--';
}
function calcularPedidoDias() { const d=parseFloat(document.getElementById('p-dias').value); if(!d||d<=0){showToast('Introduce los días','error');return;} _ejecutarCalculo(d); }
function calcularPedidoMeses() { const m=parseFloat(document.getElementById('p-meses').value); if(!m||m<=0){showToast('Introduce los meses','error');return;} _ejecutarCalculo(Math.round(m*30)); }
function _ejecutarCalculo(dias) {
  pedidoItems.forEach((item,i) => {
    if (!item.incluir_pedido) { document.getElementById('qty-'+i).value=0; document.getElementById('futuro-'+i).textContent='EXCLUIDO'; return; }
    const falta=Math.max(0,item.tomaDia*dias-item.botesCalc*item.unidBote);
    const botes=item.unidBote>0?Math.ceil(falta/item.unidBote):0;
    document.getElementById('qty-'+i).value=botes; pedidoItems[i].qty=botes; actualizarFuturo(i);
  }); showToast(`✅ Calculado para ${dias} días`);
}

function confirmarPedido() {
  const con = pedidoItems.filter(it => it.qty>0 && it.incluir_pedido);
  if (!con.length) { showToast('No hay cantidades a pedir','error'); return; }
  showConfirm('✅ Confirmar Pedido', `¿Actualizar stock con ${con.length} medicamento(s)?`, () => {
    const meds = DB.get('meds');
    const hist = DB.get('historial_pedidos', []);
    const numPedido = 'PED-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(DB.get('nextPedidoId',1)).padStart(3,'0');
    localStorage.setItem('farrmacia_nextPedidoId', JSON.stringify(DB.get('nextPedidoId',1)+1));
    const fecha = new Date().toLocaleString('es-ES');
    pedidoItems.forEach(item => {
      if (item.qty<=0||!item.incluir_pedido) return;
      const idx = meds.findIndex(m => m.id===item.id); if (idx<0) return;
      const nuevoStock = item.botesCalc+item.qty;
      meds[idx].stock_real = nuevoStock;
      hist.push({ id:nextId(), fecha, num_pedido:numPedido, medicamento:item.nombre, botes_pedidos:item.qty, botes_total:nuevoStock,
        dias_restantes_tras_pedido: item.tomaDia>0&&item.unidBote>0 ? Math.floor((item.dosisActuales+item.qty*item.unidBote)/item.tomaDia) : 0 });
    });
    DB.set('meds', meds); DB.set('historial_pedidos', hist);
    showToast(`✅ Pedido ${numPedido} confirmado`);
    mostrarResumenPedido(numPedido, fecha, con);
    navigate('inventario');
  });
}

function mostrarResumenPedido(numPedido, fecha, items) {
  const filas = items.map(it => {
    const diasTras = it.tomaDia>0&&it.unidBote>0 ? Math.floor((it.dosisActuales+it.qty*it.unidBote)/it.tomaDia) : 0;
    return { nombre:it.nombre, qty:it.qty, stockActual:Math.round(it.botesCalc*10)/10, stockTras:Math.round((it.botesCalc+it.qty)*10)/10, diasTras, mesesTras:(diasTras/30).toFixed(1) };
  });
  const tabla = `<table class="resumen-table"><thead><tr><th>Medicamento</th><th style="text-align:center">Pedir</th><th style="text-align:center">Stock</th><th style="text-align:center">Total</th><th>Meses/Días</th></tr></thead><tbody>${filas.map(f=>`<tr><td>${f.nombre}</td><td class="qty-cell">${f.qty}</td><td style="text-align:center">${f.stockActual}</td><td style="text-align:center;font-weight:900">${f.stockTras}</td><td class="dias-cell">${f.diasTras} días | ${f.mesesTras} mes.</td></tr>`).join('')}</tbody></table>`;
  const modal = document.createElement('div'); modal.className='modal-overlay';
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="modal-title" style="margin-bottom:0">📋 ${numPedido}</div>
        <span style="font-size:11px;color:#999">${fecha}</span>
      </div>
      <p style="font-size:12px;color:#999;margin-bottom:10px">Resumen de Pedido a Farmacia</p>
      ${tabla}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button class="btn-primary" style="margin-top:0;font-size:13px" id="btn-pdf-modal">📄 Generar PDF</button>
        <button class="btn-primary" style="margin-top:0;background:var(--azul);font-size:13px" id="btn-comp-modal">📤 Compartir</button>
      </div>
      <button class="btn-secondary" style="margin-top:8px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
    </div>`;
  modal._filas = filas; modal._numPedido = numPedido; modal._fecha = fecha;
  document.body.appendChild(modal);
  document.getElementById('btn-pdf-modal').onclick  = () => generarPDFPedido(numPedido, fecha, filas);
  document.getElementById('btn-comp-modal').onclick = () => {
    const txt = `PEDIDO ${numPedido}\n${fecha}\n\n` + filas.map(f=>`${f.nombre}: pedir ${f.qty} bote(s) → total ${f.stockTras} (${f.diasTras} días / ${f.mesesTras} mes.)`).join('\n');
    if (navigator.share) navigator.share({ title:'Pedido Farmacia '+numPedido, text:txt });
    else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));
  };
  modal.addEventListener('click', e => { if (e.target===modal) modal.remove(); });
}

// =============================================
// ===== HISTORIAL PEDIDOS =====================
// =============================================
function renderHistorialPedidos() {
  const hist = [...DB.get('historial_pedidos',[])].reverse();
  const c = document.getElementById('historial-pedidos-list');
  if (!hist.length) { c.innerHTML=`<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-text">No hay pedidos.</div></div>`; return; }
  const grupos = {};
  hist.forEach(h => { if (!grupos[h.num_pedido]) grupos[h.num_pedido]={fecha:h.fecha,items:[]}; grupos[h.num_pedido].items.push(h); });
  c.innerHTML = Object.entries(grupos).map(([numP,g]) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:16px;font-weight:900;color:var(--azul-oscuro)">📋 ${numP}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <div style="font-size:11px;color:#999">${g.fecha}</div>
          <button class="btn-sm btn-sm-verde" onclick="generarPDFPedidoHistorial('${numP}')">📄 PDF</button>
          <button class="btn-sm btn-sm-azul"  onclick="compartirPedidoHistorial('${numP}')">📤</button>
        </div>
      </div>
      ${g.items.map(it=>`<div class="historial-item"><div class="historial-item-med">💊 ${it.medicamento}</div><div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap"><span class="badge badge-amarillo">Pedido: ${it.botes_pedidos}</span><span class="badge badge-verde">Total: ${Math.round(it.botes_total*100)/100}</span>${it.dias_restantes_tras_pedido?`<span class="badge badge-azul">${it.dias_restantes_tras_pedido} días</span>`:''}</div></div>`).join('')}
    </div>`).join('');
}

function generarPDFPedidoHistorial(numPedido) {
  const items = DB.get('historial_pedidos',[]).filter(h=>h.num_pedido===numPedido); if (!items.length) return;
  const filas = items.map(it => ({ nombre:it.medicamento, qty:it.botes_pedidos, stockActual:Math.round((it.botes_total-it.botes_pedidos)*10)/10, stockTras:Math.round(it.botes_total*10)/10, diasTras:it.dias_restantes_tras_pedido||0, mesesTras:((it.dias_restantes_tras_pedido||0)/30).toFixed(1) }));
  generarPDFPedido(numPedido, items[0].fecha, filas);
}

function compartirPedidoHistorial(numPedido) {
  const items = DB.get('historial_pedidos',[]).filter(h=>h.num_pedido===numPedido); if (!items.length) return;
  const txt = `PEDIDO ${numPedido}\n${items[0].fecha}\n\n` + items.map(it=>`${it.medicamento}: ${it.botes_pedidos} botes → ${Math.round(it.botes_total*10)/10} total (${it.dias_restantes_tras_pedido||'-'} días)`).join('\n');
  if (navigator.share) navigator.share({ title:'Pedido '+numPedido, text:txt });
  else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));
}

// =============================================
// ===== CITAS MÉDICAS =========================
// =============================================
function renderCitas() {
  const hoy    = new Date().toISOString().split('T')[0];
  const manana = new Date(Date.now()+86400000).toISOString().split('T')[0];
  const citas  = DB.get('citas',[]).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const c = document.getElementById('citas-list');
  if (!citas.length) { c.innerHTML=`<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">No hay citas.</div></div>`; return; }
  c.innerHTML = citas.map(ci => {
    const pasada=ci.fecha<hoy, esM=ci.fecha===manana;
    return `<div class="cita-card${esM?' manana':''}" style="${pasada?'opacity:.6;border-left-color:#ccc':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="cita-date">📅 ${formatFecha(ci.fecha)} · ${ci.hora}</div>
          <div class="cita-doctor">👨‍⚕️ ${ci.profesional}</div>
          ${ci.observaciones?`<div class="cita-obs">📝 ${ci.observaciones}</div>`:''}
          ${esM?`<div style="color:var(--rojo);font-size:12px;font-weight:900;margin-top:4px">⚠️ ¡MAÑANA!</div>`:''}
        </div>
        ${pasada?'<span class="badge badge-rojo">Pasada</span>':esM?'<span class="badge badge-rojo">¡Mañana!</span>':'<span class="badge badge-verde">Próxima</span>'}
      </div>
      <div class="cita-actions">
        <button class="btn-sm btn-sm-azul"  onclick="editarCita(${ci.id})">✏️ Editar</button>
        <button class="btn-sm btn-sm-verde" onclick="compartirCita(${ci.id})">📤</button>
        <button class="btn-sm btn-sm-rojo"  onclick="borrarCita(${ci.id})">🗑️</button>
      </div></div>`;
  }).join('');
}

function formatFecha(f) { if(!f) return ''; const [y,m,d]=f.split('-'); return `${d} ${'Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic'.split(' ')[parseInt(m)-1]} ${y}`; }

function guardarCita() {
  const prof = document.getElementById('c-prof').value.trim(); if (!prof){showToast('⚠️ Introduce el médico','error');return;}
  const cita = { id:editingCitaId||nextId(), profesional:prof, fecha:document.getElementById('c-fecha').value, hora:document.getElementById('c-hora').value, observaciones:document.getElementById('c-obs').value.trim() };
  const citas = DB.get('citas',[]);
  if (editingCitaId) { const idx=citas.findIndex(c=>c.id===editingCitaId); if(idx>=0) citas[idx]=cita; showToast('✅ Cita actualizada'); }
  else { citas.push(cita); showToast('✅ Cita añadida'); }
  DB.set('citas', citas); cancelarEditarCita(); renderCitas(); cargarCitasMini();
}
function editarCita(id) {
  const ci=DB.get('citas',[]).find(c=>c.id===id); if(!ci) return;
  editingCitaId=id;
  document.getElementById('c-prof').value=ci.profesional; document.getElementById('c-fecha').value=ci.fecha;
  document.getElementById('c-hora').value=ci.hora; document.getElementById('c-obs').value=ci.observaciones;
  document.getElementById('citas-form-title').textContent='✏️ Editar Cita';
  document.getElementById('c-btn-guardar').textContent='💾 Actualizar Cita';
  document.getElementById('c-btn-guardar').style.background='#f39c12';
  document.getElementById('c-btn-cancelar').style.display='block';
  document.getElementById('content').scrollTop=0;
}
function cancelarEditarCita() {
  editingCitaId=null;
  ['c-prof','c-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('c-fecha').value=new Date().toISOString().split('T')[0];
  document.getElementById('c-hora').value='10:00';
  document.getElementById('citas-form-title').textContent='➕ Nueva Cita';
  document.getElementById('c-btn-guardar').textContent='➕ Añadir Cita';
  document.getElementById('c-btn-guardar').style.background='';
  document.getElementById('c-btn-cancelar').style.display='none';
}
function borrarCita(id) { showConfirm('🗑️ Borrar cita','¿Eliminar esta cita?',()=>{DB.set('citas',DB.get('citas',[]).filter(c=>c.id!==id));showToast('Cita eliminada','error');renderCitas();cargarCitasMini();}); }
function compartirCita(id) {
  const ci=DB.get('citas',[]).find(c=>c.id===id); if(!ci) return;
  const txt=`📅 Cita médica\n${formatFecha(ci.fecha)} a las ${ci.hora}\nMédico: ${ci.profesional}${ci.observaciones?'\nNotas: '+ci.observaciones:''}`;
  if (navigator.share) navigator.share({title:'Cita médica',text:txt}); else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));
}

// =============================================
// ===== NOTIFICACIONES ========================
// =============================================
async function solicitarPermisoNotificaciones() {
  if (!('Notification' in window)) return false;
  if (Notification.permission==='granted') return true;
  if (Notification.permission==='denied') return false;
  return (await Notification.requestPermission())==='granted';
}
function verificarCitasManana() {
  const manana=new Date(Date.now()+86400000).toISOString().split('T')[0];
  const cits=DB.get('citas',[]).filter(c=>c.fecha===manana);
  const badge=document.getElementById('notif-citas');
  if (cits.length) {
    if(badge){badge.style.display='flex';badge.textContent=cits.length;}
    if (Notification.permission==='granted') cits.forEach(c=>new Notification('🏥 Cita mañana – FaR-Rmacia',{body:`${c.profesional} a las ${c.hora}`,icon:'icon-192.png',tag:'cita-'+c.id}));
    else setTimeout(()=>showToast(`📅 Tienes ${cits.length} cita(s) mañana`,'info'),2000);
  } else if(badge) badge.style.display='none';
}
function cargarCitasMini() {
  const hoy    = new Date().toISOString().split('T')[0];
  const manana = new Date(Date.now()+86400000).toISOString().split('T')[0];
  const cits   = DB.get('citas',[]).filter(c=>c.fecha>=hoy).sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(0,5);
  const c = document.getElementById('citas-mini-list'); if(!c) return;
  c.innerHTML = cits.length ? cits.map(ci=>`<div class="cita-chip${ci.fecha===manana?' urgente':''}" onclick="navigate('citas')">📅 ${formatFecha(ci.fecha)} – ${ci.profesional}${ci.fecha===manana?' ⚠️':''}</div>`).join('') : `<span class="sin-citas">Sin citas próximas</span>`;
}

// =============================================
// ===== HISTORIAL MÉDICO ======================
// =============================================
function cargarHistorial() { document.getElementById('h-notas').value=DB.get('notas',''); renderDocs(); }
function guardarNotas() { DB.set('notas',document.getElementById('h-notas').value); showToast('💾 Notas guardadas'); }

// ── Subir archivos: binarios a IndexedDB ──
function subirArchivoHistorial(event) {
  const files = Array.from(event.target.files); if(!files.length) return;
  let done = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async e => {
      const base64 = e.target.result;
      const id = nextId();
      const prefijo = new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
      const meta = { id, nombre:prefijo+'_'+file.name, titulo:file.name, tipo:file.type||'application/octet-stream', es_archivo:true, base64:null, contenido:'', fecha:new Date().toLocaleString('es-ES'), tamano:file.size };
      try { await idbSet(id, base64, file.type, file.name); }
      catch(err) { console.warn('IDB fallback:', err); meta.base64 = base64; }
      const docs = DB.get('docs',[]); docs.push(meta); DB.set('docs',docs);
      done++;
      if (done===files.length) { showToast(`✅ ${files.length} archivo(s) guardado(s)`); renderDocs(); }
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function crearNotaDocumento() {
  const modal = document.createElement('div'); modal.className='modal-overlay';
  modal.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📄 Crear Nota</div><div class="form-group"><label class="form-label">Título</label><input type="text" class="form-input" id="doc-titulo" placeholder="Ej: Analítica Junio 2026"/></div><div class="form-group"><label class="form-label">Contenido</label><textarea class="form-textarea" id="doc-contenido" placeholder="Escribe el contenido..."></textarea></div><button class="btn-primary" onclick="guardarDocumento()">💾 Guardar</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}
function guardarDocumento() {
  const titulo=document.getElementById('doc-titulo').value.trim(); if(!titulo){showToast('⚠️ Escribe un título','error');return;}
  const docs=DB.get('docs',[]);
  docs.push({id:nextId(),nombre:new Date().toISOString().replace(/[:.]/g,'_').slice(0,16)+'_'+titulo,titulo,contenido:document.getElementById('doc-contenido').value.trim(),es_archivo:false,base64:null,tipo:'text/plain',fecha:new Date().toLocaleString('es-ES')});
  DB.set('docs',docs); document.querySelector('.modal-overlay')?.remove(); showToast('✅ Documento guardado'); renderDocs();
}

function renderDocs() {
  const docs=DB.get('docs',[]); const c=document.getElementById('docs-list'); if(!c) return;
  if(!docs.length){c.innerHTML=`<div class="empty-text" style="font-size:13px;color:#aaa;text-align:center;padding:20px">No hay documentos guardados.</div>`;return;}
  const iconos={'application/pdf':'📄','image/jpeg':'🖼️','image/png':'🖼️','image/webp':'🖼️','text/plain':'📝'};
  c.innerHTML=docs.map(doc=>`
    <div class="doc-item">
      <div class="doc-icon">${iconos[doc.tipo]||(doc.es_archivo?'📎':'📝')}</div>
      <div class="doc-name" onclick="verDocumento(${doc.id})" style="cursor:pointer;color:var(--azul-oscuro)">
        ${doc.titulo}<br><span style="font-size:11px;color:#999;font-weight:400">${doc.fecha}${doc.tamano?' · '+(doc.tamano/1024).toFixed(1)+' KB':''}</span>
      </div>
      <button class="doc-compartir" onclick="compartirDoc(${doc.id})">📤</button>
      <button class="doc-del" onclick="borrarDoc(${doc.id})">🗑️</button>
    </div>`).join('');
}

// ── Ver archivo: carga desde IndexedDB, abre en el visor del móvil ──
async function verDocumento(id) {
  const doc = DB.get('docs',[]).find(d=>d.id===id); if(!doc) return;
  if (doc.es_archivo) {
    showToast('⏳ Abriendo archivo...','info');
    let base64 = doc.base64 || null;
    if (!base64) { const entry = await idbGet(id).catch(()=>null); base64 = entry?.base64||null; }
    if (!base64) { showToast('❌ Archivo no encontrado (¿estás en otro dispositivo?)','error'); return; }
    const tipo = doc.tipo||'application/octet-stream';
    let blob;
    try {
      const b64data = base64.includes(',') ? base64.split(',')[1] : base64;
      const byteStr = atob(b64data);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for(let i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
      blob = new Blob([ab],{type:tipo});
    } catch(e) { showToast('❌ Error al leer el archivo','error'); return; }

    if (tipo.startsWith('image/')) {
      const modal=document.createElement('div'); modal.className='modal-overlay';
      const imgUrl=URL.createObjectURL(blob);
      modal.innerHTML=`<div class="modal-sheet" style="text-align:center"><div class="modal-handle"></div><div class="modal-title">🖼️ ${doc.titulo}</div><img src="${imgUrl}" style="max-width:100%;border-radius:12px;margin-bottom:12px"/><button class="btn-primary" onclick="compartirDoc(${doc.id})">📤 Compartir</button><button class="btn-secondary" onclick="URL.revokeObjectURL('${imgUrl}');this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click',e=>{if(e.target===modal){URL.revokeObjectURL(imgUrl);modal.remove();}});
      return;
    }
    // PDF y otros: crear enlace con download para forzar apertura por el SO
    const fileUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = fileUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // En Android: el atributo download con el nombre correcto hace que Chrome lo abra con el visor nativo
    a.download = doc.titulo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(fileUrl), 15000);
    return;
  }
  // Nota de texto
  const modal=document.createElement('div'); modal.className='modal-overlay';
  modal.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📄 ${doc.titulo}</div><p style="font-size:11px;color:#999;margin-bottom:12px">${doc.fecha}</p><textarea class="nota-area" readonly style="min-height:200px;background:#f9f9f9">${doc.contenido}</textarea><button class="btn-primary" onclick="compartirDoc(${doc.id})">📤 Compartir</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}

async function compartirDoc(id) {
  const doc=DB.get('docs',[]).find(d=>d.id===id); if(!doc) return;
  if (doc.es_archivo) {
    let base64=doc.base64||null;
    if(!base64){const e=await idbGet(id).catch(()=>null);base64=e?.base64||null;}
    if(base64&&navigator.share){
      try{
        const tipo=doc.tipo||'application/octet-stream';
        const b64data=base64.includes(',')?base64.split(',')[1]:base64;
        const bs=atob(b64data),ab=new ArrayBuffer(bs.length),ia=new Uint8Array(ab);
        for(let i=0;i<bs.length;i++) ia[i]=bs.charCodeAt(i);
        const file=new File([new Blob([ab],{type:tipo})],doc.titulo,{type:tipo});
        if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:doc.titulo});return;}
      }catch(e){}
    }
    if(navigator.share) navigator.share({title:doc.titulo,text:doc.titulo});
    return;
  }
  const txt=`${doc.titulo}\n${doc.fecha}\n\n${doc.contenido}`;
  if(navigator.share) navigator.share({title:doc.titulo,text:txt});
  else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));
}

function borrarDoc(id) {
  showConfirm('🗑️ Borrar documento','¿Eliminar este documento?', async()=>{
    DB.set('docs',DB.get('docs',[]).filter(d=>d.id!==id));
    await idbDelete(id).catch(()=>{});
    showToast('Documento eliminado','error'); renderDocs();
  });
}

// =============================================
// ===== ALERTAS STOCK =========================
// =============================================
function verificarAlertas() {
  const alertas=DB.get('meds').filter(med=>{const s=calcularStock(med);return s.iniciado&&s.diasRestantes<=14;});
  if(alertas.length){
    setTimeout(()=>showToast(`⚠️ Stock bajo: ${alertas.length} medicamento(s)`,'error'),1500);
    if(Notification.permission==='granted') new Notification('⚠️ Stock bajo – FaR-Rmacia',{body:alertas.map(m=>m.nombre).join(', '),icon:'icon-192.png',tag:'stock-bajo'});
  }
}

// =============================================
// ===== INIT ==================================
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  actualizarReloj();
  setInterval(actualizarReloj, 30000);

  // 1. Abrir IndexedDB
  await idbOpen().catch(err => console.warn('IDB:', err));

  // 2. Sincronización inteligente ANTES de mostrar datos
  //    Si el localStorage está vacío → siempre descarga Firebase
  //    Si Firebase es más nuevo → descarga Firebase
  //    Si hay cambios pendientes → sube a Firebase
  await syncInteligente();

  // 3. Inicializar UI
  document.getElementById('c-fecha').value = new Date().toISOString().split('T')[0];
  cargarCitasMini();
  verificarAlertas();
  verificarCitasManana();
  solicitarPermisoNotificaciones().then(ok => { if(ok) verificarCitasManana(); });
  initSwipeGestures();

  // 4. Service Worker PWA
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
});
