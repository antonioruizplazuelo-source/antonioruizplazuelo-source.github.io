// FaR-Rmacia v4.0
// MEJORAS:
// 1) PDF en móvil: genera imagen/texto compartible en vez de window.print
// 2) Archivos historial: se suben a Firebase como base64 (en chunks si son grandes)
// 3) Toast sync visible en CUALQUIER pantalla (sync-toast-global)
// 4) Firebase polling cada 30s para detectar cambios desde otro dispositivo
// 5) Botón borrar en historial de pedidos
// 6) Diseño más alegre (verdes claros, lazo mejorado en index.html)

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

// ── IndexedDB (archivos binarios locales) ──
let idbDb = null;
const IDB_NAME = 'farrmacia_files', IDB_STORE = 'archivos';
function idbOpen() {
  return new Promise((res,rej) => {
    if (idbDb) return res(idbDb);
    const r = indexedDB.open(IDB_NAME,1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE,{keyPath:'id'});
    r.onsuccess = e => { idbDb = e.target.result; res(idbDb); };
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(id,base64,tipo,nombre) {
  const db = await idbOpen();
  return new Promise((res,rej) => { const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put({id,base64,tipo,nombre}); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}
async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((res,rej) => { const tx=db.transaction(IDB_STORE,'readonly'); const r=tx.objectStore(IDB_STORE).get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((res,rej) => { const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).delete(id); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}

// ── DB localStorage ──
const DB = {
  get(key,def=[]) { try { return JSON.parse(localStorage.getItem('farrmacia_'+key))??def; } catch { return def; } },
  set(key,val) { localStorage.setItem('farrmacia_'+key,JSON.stringify(val)); localStorage.setItem('farrmacia_localModified',new Date().toISOString()); scheduleAutoSync(); },
  setRaw(key,val) { localStorage.setItem('farrmacia_'+key,JSON.stringify(val)); }
};
function estaVacioLocal() { return localStorage.getItem('farrmacia_meds')===null; }

// ── Firestore helpers ──
function fsVal(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number')  return {doubleValue:v};
  if (typeof v==='string')  return {stringValue:v};
  if (Array.isArray(v))     return {arrayValue:{values:v.map(fsVal)}};
  if (typeof v==='object')  { const f={}; for(const k in v) f[k]=fsVal(v[k]); return {mapValue:{fields:f}}; }
  return {stringValue:String(v)};
}
function parseFsVal(v) {
  if (!v) return null;
  if ('nullValue'    in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('doubleValue'  in v) return v.doubleValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('stringValue'  in v) return v.stringValue;
  if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(parseFsVal);
  if ('mapValue'     in v) { const o={}; for(const k in v.mapValue.fields) o[k]=parseFsVal(v.mapValue.fields[k]); return o; }
  return null;
}

// ── Sync vars ──
let syncInProgress=false, syncTimer=null, pollTimer=null;

async function getFirebaseTimestamp() {
  try {
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}?mask.fieldPaths=ultimaSincro`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.fields?.ultimaSincro ? parseFsVal(j.fields.ultimaSincro) : null;
  } catch { return null; }
}

// ── Subir a Firebase ──
// Los archivos del historial se incluyen como base64 en Firebase
// (solo los que caben — máx ~800KB por archivo para no superar límite Firestore 1MB/doc)
async function syncToFirebase(silencioso=false) {
  if (syncInProgress) return false;
  syncInProgress=true;
  document.getElementById('btn-sync')?.classList.add('syncing');
  try {
    // Docs: metadatos + base64 si el archivo es pequeño (<600KB base64)
    const docsRaw = DB.get('docs',[]);
    const docsParaFirebase = [];
    for (const doc of docsRaw) {
      if (doc.es_archivo) {
        let b64 = doc.base64 || null;
        if (!b64) { const entry = await idbGet(doc.id).catch(()=>null); b64 = entry?.base64||null; }
        // Solo incluir si es razonablemente pequeño para no superar límite Firestore
        const tamB64 = b64 ? b64.length : 0;
        docsParaFirebase.push({ ...doc, base64: tamB64 < 700000 ? b64 : null });
      } else {
        docsParaFirebase.push({ ...doc, base64: null });
      }
    }

    const data = {
      meds: DB.get('meds',[]),
      citas: DB.get('citas',[]),
      historial_pedidos: DB.get('historial_pedidos',[]),
      notas: DB.get('notas',''),
      nextId: DB.get('nextId',100),
      nextPedidoId: DB.get('nextPedidoId',1),
      docs: docsParaFirebase,
      ultimaSincro: new Date().toISOString()
    };
    const fields={};
    for (const k in data) fields[k]=fsVal(data[k]);
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) throw new Error('HTTP '+r.status);
    localStorage.setItem('farrmacia_lastSync',data.ultimaSincro);
    localStorage.removeItem('farrmacia_pendingSync');
    if (!silencioso) showToast('☁️ Sincronizado','success');
    showSyncToastGlobal('☁️ Guardado en la nube · '+new Date().toLocaleTimeString('es-ES'));
    actualizarIndicadorSync(true);
    return true;
  } catch(err) {
    console.error('syncToFirebase:',err);
    localStorage.setItem('farrmacia_pendingSync','true');
    if (!silencioso) showToast('⚠️ Error al sincronizar','error');
    actualizarIndicadorSync(false);
    return false;
  } finally {
    syncInProgress=false;
    document.getElementById('btn-sync')?.classList.remove('syncing');
  }
}

// ── Descargar de Firebase ──
async function syncFromFirebase(silencioso=false) {
  if (syncInProgress) return false;
  syncInProgress=true;
  document.getElementById('btn-sync')?.classList.add('syncing');
  try {
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${USER_ID}`);
    if (!r.ok) throw new Error('HTTP '+r.status);
    const j = await r.json();
    if (!j.fields) throw new Error('Sin datos');
    const data={};
    for (const k in j.fields) data[k]=parseFsVal(j.fields[k]);

    if (data.meds!==undefined)              DB.setRaw('meds',data.meds);
    if (data.citas!==undefined)             DB.setRaw('citas',data.citas);
    if (data.historial_pedidos!==undefined) DB.setRaw('historial_pedidos',data.historial_pedidos);
    if (data.notas!==undefined)             DB.setRaw('notas',data.notas);
    if (data.nextId!==undefined)            DB.setRaw('nextId',data.nextId);
    if (data.nextPedidoId!==undefined)      DB.setRaw('nextPedidoId',data.nextPedidoId);

    // Docs: restaurar metadatos y guardar base64 en IndexedDB si viene
    if (data.docs!==undefined) {
      const docsSinB64 = data.docs.map(d => { const {base64,...m}=d; return m; });
      DB.setRaw('docs', docsSinB64);
      for (const doc of data.docs) {
        if (doc.es_archivo && doc.base64) {
          await idbSet(doc.id, doc.base64, doc.tipo, doc.nombre).catch(()=>{});
        }
      }
    }

    if (data.ultimaSincro) {
      localStorage.setItem('farrmacia_lastSync',data.ultimaSincro);
      localStorage.setItem('farrmacia_localModified',data.ultimaSincro);
    }
    localStorage.removeItem('farrmacia_pendingSync');
    if (!silencioso) showToast('✅ Datos restaurados','success');
    actualizarIndicadorSync(true);
    navigate(currentScreen); cargarCitasMini();
    return true;
  } catch(err) {
    console.error('syncFromFirebase:',err);
    if (!silencioso) showToast('⚠️ Error al cargar','error');
    return false;
  } finally {
    syncInProgress=false;
    document.getElementById('btn-sync')?.classList.remove('syncing');
  }
}

// ── Auto-sync 5s tras cambio ──
function scheduleAutoSync() {
  localStorage.setItem('farrmacia_pendingSync','true');
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(()=>syncToFirebase(true), 5000);
}

// ── Polling Firebase cada 30s (para detectar cambios desde otro dispositivo) ──
function iniciarPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (syncInProgress) return;
    const tsFirebase = await getFirebaseTimestamp().catch(()=>null);
    if (!tsFirebase) return;
    const tsLocal = localStorage.getItem('farrmacia_localModified');
    if (tsLocal && tsFirebase > tsLocal) {
      // Otro dispositivo subió datos más nuevos → descargar silenciosamente
      await syncFromFirebase(true);
      showToast('☁️ Datos actualizados desde otro dispositivo','info');
    }
  }, 30000);
}

// ── Sync inteligente al arrancar ──
async function syncInteligente() {
  mostrarSpinnerInicio(true);
  try {
    if (estaVacioLocal()) {
      const ok = await syncFromFirebase(true);
      if (!ok) initDBLocal();
      return;
    }
    const tsFirebase = await getFirebaseTimestamp();
    const tsLocal    = localStorage.getItem('farrmacia_localModified');
    if (!tsFirebase) {
      if (DB.get('meds',[]).length>0) await syncToFirebase(true);
      return;
    }
    if (tsLocal && tsFirebase > tsLocal) {
      await syncFromFirebase(true);
      showToast('☁️ Datos actualizados desde Firebase','info');
    } else if (localStorage.getItem('farrmacia_pendingSync')==='true') {
      await syncToFirebase(true);
    }
  } catch(err) { console.error('syncInteligente:',err); }
  finally { mostrarSpinnerInicio(false); }
}

// ── Toast sync global (visible en cualquier pantalla) ──
function showSyncToastGlobal(msg, isError=false) {
  const el = document.getElementById('sync-toast-global');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  setTimeout(() => el.className = '', 3000);
}

function mostrarSpinnerInicio(mostrar) {
  let el = document.getElementById('sync-spinner-inicio');
  if (!el && mostrar) {
    el = document.createElement('div');
    el.id = 'sync-spinner-inicio';
    el.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg,#2E8B57,#5CC98A);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;font-family:Nunito,sans-serif;gap:16px;';
    el.innerHTML = `<div style="font-size:52px">💊</div><div style="font-size:24px;font-weight:900">FaR-Rmacia</div><div style="font-size:14px;opacity:.85">Sincronizando datos...</div><div style="width:48px;height:48px;border:4px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .8s linear infinite"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  if (el) el.style.display = mostrar ? 'flex' : 'none';
}

function actualizarIndicadorSync(ok) {
  const bar = document.getElementById('sync-status-bar');
  if (!bar) return;
  bar.style.display = ok ? 'none' : 'flex';
}

function abrirSyncPanel() {
  const hasPending = localStorage.getItem('farrmacia_pendingSync')==='true';
  const lastSync   = localStorage.getItem('farrmacia_lastSync');
  const modal = document.createElement('div'); modal.className='modal-overlay';
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">☁️ Firebase & Backup</div>
      <div style="background:#f0faf5;border-radius:12px;padding:14px;margin-bottom:12px;font-size:13px;color:#333;line-height:1.9">
        <div><strong>Estado:</strong> ${hasPending?'⚠️ Cambios pendientes':'✅ Todo sincronizado'}</div>
        <div><strong>Última sync:</strong> ${lastSync?new Date(lastSync).toLocaleString('es-ES'):'Nunca'}</div>
        <div><strong>Medicamentos:</strong> ${DB.get('meds',[]).length}</div>
        <div><strong>Polling:</strong> activo cada 30s (detecta cambios desde otro dispositivo)</div>
      </div>
      <div style="font-size:12px;background:#fffde7;border-radius:10px;padding:10px;margin-bottom:12px;color:#666;line-height:1.6">
        💡 Los archivos subidos al historial se sincronizan si son menores de ~500KB. Los más grandes solo existen en este dispositivo — usa el Backup para transferirlos.
      </div>
      <button class="btn-primary" onclick="syncToFirebase();this.closest('.modal-overlay').remove()">☁️ Subir a Firebase ahora</button>
      <button class="btn-primary" style="background:var(--azul);margin-top:8px" onclick="syncFromFirebase();this.closest('.modal-overlay').remove()">📥 Descargar de Firebase ahora</button>
      <hr style="margin:14px 0;border:none;border-top:1px solid #eee"/>
      <div style="font-size:13px;font-weight:900;color:var(--azul-oscuro);margin-bottom:6px">💾 Backup local (JSON)</div>
      <button class="btn-secondary" style="margin-top:0" onclick="exportarBackup();this.closest('.modal-overlay').remove()">📤 Exportar Backup completo</button>
      <button class="btn-secondary" style="margin-top:8px" onclick="importarBackup()">📥 Importar Backup</button>
      <input type="file" id="import-backup-input" accept=".json" style="display:none" onchange="procesarImportBackup(event)"/>
      <button class="btn-secondary" style="margin-top:16px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}

async function exportarBackup() {
  showToast('⏳ Preparando backup...','info');
  try {
    const docs = DB.get('docs',[]);
    const docsConB64 = [];
    for (const doc of docs) {
      if (doc.es_archivo) { const e=await idbGet(doc.id).catch(()=>null); docsConB64.push({...doc,base64:e?.base64||null}); }
      else docsConB64.push({...doc,base64:null});
    }
    const backup = { version:4, fecha:new Date().toISOString(), meds:DB.get('meds',[]), citas:DB.get('citas',[]), historial_pedidos:DB.get('historial_pedidos',[]), notas:DB.get('notas',''), docs:docsConB64, nextId:DB.get('nextId',100), nextPedidoId:DB.get('nextPedidoId',1) };
    const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const fname = `farrmacia_backup_${new Date().toISOString().slice(0,10)}.json`;
    if (navigator.share&&navigator.canShare?.({files:[new File([blob],fname)]})) {
      await navigator.share({files:[new File([blob],fname,{type:'application/json'})],title:'Backup FaR-Rmacia'});
    } else {
      const url=URL.createObjectURL(blob);
      Object.assign(document.createElement('a'),{href:url,download:fname}).click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    }
    showToast('✅ Backup exportado');
  } catch(err) { showToast('⚠️ Error: '+err.message,'error'); }
}

function importarBackup() { document.getElementById('import-backup-input')?.click(); }
async function procesarImportBackup(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      const data=JSON.parse(e.target.result);
      showConfirm('📥 Importar Backup','¿Sobrescribir todos los datos actuales?',async()=>{
        if(data.meds)              DB.setRaw('meds',data.meds);
        if(data.citas)             DB.setRaw('citas',data.citas);
        if(data.historial_pedidos) DB.setRaw('historial_pedidos',data.historial_pedidos);
        if(data.notas!==undefined) DB.setRaw('notas',data.notas);
        if(data.nextId)            DB.setRaw('nextId',data.nextId);
        if(data.nextPedidoId)      DB.setRaw('nextPedidoId',data.nextPedidoId);
        if(data.docs) {
          DB.setRaw('docs',data.docs.map(({base64,...m})=>m));
          for(const doc of data.docs) if(doc.es_archivo&&doc.base64) await idbSet(doc.id,doc.base64,doc.tipo,doc.nombre).catch(()=>{});
        }
        localStorage.setItem('farrmacia_localModified',new Date().toISOString());
        showToast('✅ Backup importado','success');
        await syncToFirebase(true);
        navigate(currentScreen); cargarCitasMini();
      });
    } catch { showToast('❌ Error al leer el backup','error'); }
  };
  reader.readAsText(file); event.target.value='';
}

function initDBLocal() {
  if (!estaVacioLocal()) return;
  localStorage.setItem('farrmacia_meds',JSON.stringify([{id:1,nombre:'Ejemplo - Omeprazol 20mg',cantidad_bote:28,dosis_dia:1,stock_real:2,observaciones:'En ayunas',foto:'',fecha_inicio:'',incluir_pedido:1}]));
  localStorage.setItem('farrmacia_nextId',JSON.stringify(100));
  localStorage.setItem('farrmacia_nextPedidoId',JSON.stringify(1));
  localStorage.setItem('farrmacia_notas',JSON.stringify(''));
  localStorage.setItem('farrmacia_citas',JSON.stringify([]));
  localStorage.setItem('farrmacia_historial_pedidos',JSON.stringify([]));
  localStorage.setItem('farrmacia_docs',JSON.stringify([]));
  localStorage.setItem('farrmacia_localModified',new Date().toISOString());
}
function nextId() { const n=DB.get('nextId',100)+1; localStorage.setItem('farrmacia_nextId',JSON.stringify(n)); return n; }

// =============================================
// ===== PDF PEDIDO — MÓVIL COMPATIBLE =========
// =============================================
// En móvil window.open/print no funciona bien.
// Detectamos si es móvil y en ese caso usamos
// el sistema de compartir nativo con texto
// formateado. En PC abrimos la ventana de impresión.
// =============================================
function esMobile() { return /Android|iPhone|iPad/i.test(navigator.userAgent); }

function generarPDFPedido(numPedido, fecha, filas) {
  if (esMobile()) {
    // Móvil: compartir como texto formateado
    const txt = `═══════════════════════════\n` +
      `💊 FaR-Rmacia — PEDIDO\n` +
      `Nº: ${numPedido}\n` +
      `Fecha: ${fecha}\n` +
      `═══════════════════════════\n\n` +
      `Medicamento           Pedir  Stock  Total  Meses\n` +
      `${'─'.repeat(52)}\n` +
      filas.map(f =>
        `${f.nombre.substring(0,20).padEnd(20)}  ${String(f.qty).padStart(5)}  ${String(f.stockActual).padStart(5)}  ${String(f.stockTras).padStart(5)}  ${f.mesesTras} mes.`
      ).join('\n') +
      `\n\n${'─'.repeat(52)}\n` +
      filas.map(f => `• ${f.nombre}: pedir ${f.qty} → ${f.diasTras} días (${f.mesesTras} mes.)`).join('\n');

    if (navigator.share) {
      navigator.share({ title: 'Pedido Farmacia ' + numPedido, text: txt });
    } else {
      navigator.clipboard.writeText(txt).then(() => showToast('📋 Informe copiado'));
    }
    return;
  }

  // PC/portátil: abrir ventana con HTML para imprimir/guardar PDF
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/>
<title>Pedido ${numPedido}</title>
<style>
@page{size:A4 portrait;margin:18mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#222;background:#fff}
.cabecera{border-bottom:3px solid #3DAA6E;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end}
.titulo{font-size:24px;font-weight:900;color:#1A5276}
.num{font-size:15px;font-weight:700;color:#3DAA6E;margin-top:4px}
.sub{font-size:12px;color:#777;margin-top:2px}
.cab-right{text-align:right;font-size:12px;color:#777}
table{width:100%;border-collapse:collapse;margin-top:4px}
thead tr{background:#1A5276;color:#fff}
thead th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase}
thead th.c{text-align:center}
tbody tr:nth-child(even) td{background:#f0faf5}
tbody td{padding:9px 12px;border-bottom:1px solid #d5eee2;font-size:13px}
.qty{background:#fffde7!important;font-weight:900;color:#555;text-align:center;font-size:14px}
.tot{font-weight:900;text-align:center}
.dias{color:#3DAA6E;font-weight:700;font-size:12px}
.stk{text-align:center}
.resumen{margin-top:22px;background:#f0faf5;border-radius:8px;padding:12px 16px}
.resumen h3{font-size:11px;font-weight:900;color:#1A5276;text-transform:uppercase;margin-bottom:8px}
.rrow{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px dotted #ccc}
.rrow:last-child{border-bottom:none}
.pie{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#aaa;display:flex;justify-content:space-between}
</style></head><body>
<div class="cabecera">
  <div><div class="titulo">💊 FaR-Rmacia</div><div class="num">Nº Pedido: ${numPedido}</div><div class="sub">Resumen de Pedido a Farmacia</div></div>
  <div class="cab-right">Fecha: ${fecha}<br>Impreso: ${new Date().toLocaleString('es-ES')}</div>
</div>
<table>
  <thead><tr><th>Medicamento</th><th class="c">A pedir</th><th class="c">Stock actual</th><th class="c">Total</th><th>Meses / Días</th></tr></thead>
  <tbody>${filas.map(f=>`<tr><td>${f.nombre}</td><td class="qty">${f.qty}</td><td class="stk">${f.stockActual}</td><td class="tot">${f.stockTras}</td><td class="dias">${f.diasTras} días | ${f.mesesTras} mes.</td></tr>`).join('')}</tbody>
</table>
<div class="resumen"><h3>📋 Resumen</h3>${filas.map(f=>`<div class="rrow"><span>${f.nombre}</span><span>Pedir <strong>${f.qty}</strong> → <strong>${f.diasTras}</strong> días (${f.mesesTras} mes.)</span></div>`).join('')}</div>
<div class="pie"><span>FaR-Rmacia · Gestión de medicamentos personales</span><span>${numPedido}</span></div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
</body></html>`;
  const blob = new Blob([html],{type:'text/html;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url,'_blank','width=860,height=960');
  if (!w) { Object.assign(document.createElement('a'),{href:url,download:numPedido+'_resumen.html'}).click(); showToast('📄 Descargado — ábrelo para imprimir','info'); }
  setTimeout(()=>URL.revokeObjectURL(url),20000);
}

// ── Swipe ──
const NAV_ORDER=['menu','inventario','pedidos','citas','historial'];
let swipeStartX=0,swipeStartY=0;
function initSwipeGestures() {
  const c=document.getElementById('content');
  c.addEventListener('touchstart',e=>{swipeStartX=e.touches[0].clientX;swipeStartY=e.touches[0].clientY;},{passive:true});
  c.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-swipeStartX,dy=e.changedTouches[0].clientY-swipeStartY;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5) return;
    const idx=NAV_ORDER.indexOf(currentScreen); if(idx<0) return;
    if(dx<0&&idx<NAV_ORDER.length-1) navigate(NAV_ORDER[idx+1]);
    else if(dx>0&&idx>0) navigate(NAV_ORDER[idx-1]);
  },{passive:true});
}

// ── Fotos ──
let fotoTemporal={f:null,m:null};
function seleccionarFoto(p){document.getElementById(p+'-foto-input')?.click();}
function procesarFoto(ev,p){
  const f=ev.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=e=>{fotoTemporal[p]=e.target.result;const pr=document.getElementById(p+'-foto-prev');if(pr){pr.className='foto-preview';pr.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>`;}const b=document.getElementById(p+'-foto-del-btn');if(b)b.style.display='block';};
  r.readAsDataURL(f);ev.target.value='';
}
function borrarFoto(p){fotoTemporal[p]='';const pr=document.getElementById(p+'-foto-prev');if(pr){pr.className='foto-preview empty';pr.innerHTML='📷';}const b=document.getElementById(p+'-foto-del-btn');if(b)b.style.display='none';}
function mostrarFotoPrev(p,b64){const pr=document.getElementById(p+'-foto-prev'),b=document.getElementById(p+'-foto-del-btn');if(!pr)return;if(b64){pr.className='foto-preview';pr.innerHTML=`<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>`;if(b)b.style.display='block';}else{pr.className='foto-preview empty';pr.innerHTML='📷';if(b)b.style.display='none';}}

// ── Navegación ──
let currentScreen='menu',navHistory=[],editingCitaId=null,pedidoItems=[];
function navigate(screen) {
  if(currentScreen!==screen) navHistory.push(currentScreen);
  currentScreen=screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+screen)?.classList.add('active');
  const T={'menu':{t:'💊 FaR-Rmacia',s:'Tu farmacia personal',b:false},'inventario':{t:'📦 Stock e Inventario',s:'',b:true},'medicamentos':{t:'💊 Nuevo Medicamento',s:'',b:true},'pedidos':{t:'🛒 Pedido Farmacia',s:'',b:true},'citas':{t:'📅 Citas Médicas',s:'',b:true},'historial':{t:'📁 Historial Médico',s:'',b:true},'modificar':{t:'✏️ Modificar',s:'',b:true},'historial-pedidos':{t:'📜 Historial Pedidos',s:'',b:true}};
  const t=T[screen]||{t:'FaR-Rmacia',s:'',b:true};
  document.getElementById('header-title').textContent=t.t;
  document.getElementById('header-sub').textContent=t.s;
  document.getElementById('btn-back').classList.toggle('visible',t.b);
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===screen));
  const fab=document.getElementById('fab');
  if(['inventario','medicamentos','citas'].includes(screen)){fab.textContent='+';fab.classList.add('visible');}else fab.classList.remove('visible');
  switch(screen){
    case'menu':cargarCitasMini();break;case'inventario':renderInventario();break;case'pedidos':renderPedidos();break;
    case'citas':renderCitas();break;case'historial':cargarHistorial();break;case'historial-pedidos':renderHistorialPedidos();break;
    case'medicamentos':fotoTemporal['f']=null;mostrarFotoPrev('f',null);break;
  }
  document.getElementById('content').scrollTop=0;
}
function goBack(){if(navHistory.length>0){const p=navHistory.pop();navHistory.pop();navigate(p);}else navigate('menu');}
function fabAction(){if(['inventario','medicamentos'].includes(currentScreen)){navigate('medicamentos');limpiarFormulario();}else if(currentScreen==='citas')document.getElementById('c-prof').focus();}
function actualizarReloj(){const a=new Date();document.getElementById('header-clock').innerHTML=`${String(a.getDate()).padStart(2,'0')} ${a.toLocaleString('es-ES',{month:'short'})} ${a.getFullYear()}<br>${String(a.getHours()).padStart(2,'0')}:${String(a.getMinutes()).padStart(2,'0')}`;}
function showToast(msg,type='success'){const t=document.getElementById('toast');t.textContent=msg;t.className='show '+type;setTimeout(()=>t.className='',2800);}
function showConfirm(title,text,onOk){const o=document.createElement('div');o.className='confirm-overlay';o.innerHTML=`<div class="confirm-box"><div class="confirm-title">${title}</div><div class="confirm-text">${text}</div><div class="confirm-btns"><button class="confirm-cancel" onclick="this.closest('.confirm-overlay').remove()">Cancelar</button><button class="confirm-ok" id="conf-ok">Sí, confirmar</button></div></div>`;document.body.appendChild(o);document.getElementById('conf-ok').onclick=()=>{o.remove();onOk()};}

// ── Calcular stock ──
function calcularStock(med){const u=parseFloat(med.cantidad_bote||0),t=parseFloat(med.dosis_dia||0),dt=parseFloat(med.stock_real||0)*u;if(med.fecha_inicio&&t>0){const dp=Math.max(0,Math.floor((new Date()-new Date(med.fecha_inicio))/86400000)),da=Math.max(0,dt-dp*t),bc=u>0?Math.round(da/u*100)/100:0;return{dosisActuales:da,botesCalc:bc,diasRestantes:t>0?Math.floor(da/t):0,unidBote:u,tomaDia:t,iniciado:true};}return{dosisActuales:dt,botesCalc:parseFloat(med.stock_real||0),diasRestantes:t>0?Math.floor(dt/t):0,unidBote:u,tomaDia:t,iniciado:false};}
function formatTiempo(d){return d<=0?'⚠️ Sin stock':`${d} días | ${(d/7).toFixed(1)} sem. | ${(d/30).toFixed(1)} mes.`;}
function colorDias(d){return d<=7?'danger':d<=30?'warn':'';}

// ── Inventario ──
function renderInventario(){
  const meds=DB.get('meds'),c=document.getElementById('inventario-list');
  if(!meds.length){c.innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">No hay medicamentos.<br>Pulsa + para añadir.</div></div>`;return;}
  c.innerHTML=meds.map(med=>{
    const s=calcularStock(med),pct=s.iniciado?Math.min(100,Math.round(s.diasRestantes/90*100)):100;
    const fh=med.foto?`<img src="${med.foto}" class="med-thumb" onclick="event.stopPropagation();verFotoMed(${med.id})" alt="foto"/>`:'';
    return `<div class="med-card" onclick="abrirModificar(${med.id})">${fh}
      <div class="med-card-name">💊 ${med.nombre.toUpperCase()}</div>
      <div style="display:flex;gap:8px;margin:4px 0;flex-wrap:wrap">
        <span class="badge badge-azul">${s.botesCalc} botes</span>
        <span class="badge badge-naranja">${s.unidBote} uds/bote</span>
        <span class="badge badge-verde">${s.tomaDia}/día</span>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar ${colorDias(s.diasRestantes)}" style="width:${pct}%"></div></div>
      <div class="med-card-info">⏳ ${s.iniciado?formatTiempo(s.diasRestantes):"▶️ Pulsa 'Iniciar'"}</div>
      <div class="med-card-pedido ${med.incluir_pedido?'incluido':'excluido'}">${med.incluir_pedido?'✅ Incluido en pedidos':'❌ Excluido de pedidos'}</div>
      ${med.observaciones?`<div class="med-card-obs">📝 ${med.observaciones}</div>`:''}
      <div class="med-card-actions">
        <button class="btn-icon btn-verde" onclick="event.stopPropagation();iniciarTratamiento(${med.id})">▶️ Iniciar</button>
        <button class="btn-icon btn-azul"  onclick="event.stopPropagation();abrirModificar(${med.id})">✏️ Editar</button>
        <button class="btn-icon btn-rojo"  onclick="event.stopPropagation();borrarMed(${med.id})">🗑️</button>
      </div></div>`;
  }).join('');
}
function verFotoMed(id){const med=DB.get('meds').find(m=>m.id==id);if(!med?.foto)return;const mo=document.createElement('div');mo.className='modal-overlay';mo.innerHTML=`<div class="modal-sheet" style="text-align:center"><div class="modal-handle"></div><div class="modal-title">📷 ${med.nombre}</div><img src="${med.foto}" style="max-width:100%;border-radius:12px;margin-bottom:12px"/><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;document.body.appendChild(mo);mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});}
function limpiarFormulario(){['f-nombre','f-bote','f-dosis','f-stock','f-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const inc=document.getElementById('f-incluir');if(inc)inc.checked=true;fotoTemporal['f']=null;mostrarFotoPrev('f',null);}
function guardarMedicamento(){const nom=document.getElementById('f-nombre').value.trim();if(!nom){showToast('⚠️ Escribe el nombre','error');return;}const meds=DB.get('meds');meds.push({id:nextId(),nombre:nom,cantidad_bote:parseFloat(document.getElementById('f-bote').value)||0,dosis_dia:parseFloat(document.getElementById('f-dosis').value)||0,stock_real:parseFloat(document.getElementById('f-stock').value)||0,observaciones:document.getElementById('f-obs').value.trim(),foto:fotoTemporal['f']||'',fecha_inicio:'',incluir_pedido:document.getElementById('f-incluir').checked?1:0});DB.set('meds',meds);limpiarFormulario();showToast('✅ Medicamento guardado');navigate('inventario');}
function iniciarTratamiento(id){const mo=document.createElement('div');mo.className='modal-overlay';mo.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📅 Fecha de inicio</div><div class="form-group"><label class="form-label">Selecciona la fecha</label><input type="date" class="form-input" id="modal-fecha" value="${new Date().toISOString().split('T')[0]}" style="padding:12px"/></div><button class="btn-primary" onclick="guardarFechaInicio(${id})">💾 Guardar Fecha</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button></div>`;document.body.appendChild(mo);mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});}
function guardarFechaInicio(id){const f=document.getElementById('modal-fecha').value,meds=DB.get('meds'),i=meds.findIndex(m=>m.id===id);if(i>=0){meds[i].fecha_inicio=f;DB.set('meds',meds);showToast('✅ Tratamiento iniciado');document.querySelector('.modal-overlay')?.remove();renderInventario();}}
function abrirModificar(id){const med=DB.get('meds').find(m=>m.id===id);if(!med)return;const s=calcularStock(med);document.getElementById('m-nombre').value=med.nombre;document.getElementById('m-bote').value=med.cantidad_bote;document.getElementById('m-dosis').value=med.dosis_dia;document.getElementById('m-stock').value=s.botesCalc;document.getElementById('m-obs').value=med.observaciones||'';document.getElementById('m-fecha').value=med.fecha_inicio||'';document.getElementById('m-incluir').checked=med.incluir_pedido===1;fotoTemporal['m']=null;mostrarFotoPrev('m',med.foto||null);document.getElementById('m-guardar').onclick=()=>actualizarMed(id);document.getElementById('m-borrar').onclick=()=>borrarMed(id);navigate('modificar');}
function actualizarMed(id){const meds=DB.get('meds'),i=meds.findIndex(m=>m.id===id);if(i<0)return;const ff=fotoTemporal['m']===null?meds[i].foto:(fotoTemporal['m']||'');meds[i]={...meds[i],nombre:document.getElementById('m-nombre').value.trim(),cantidad_bote:parseFloat(document.getElementById('m-bote').value)||0,dosis_dia:parseFloat(document.getElementById('m-dosis').value)||0,stock_real:parseFloat(document.getElementById('m-stock').value)||0,observaciones:document.getElementById('m-obs').value.trim(),fecha_inicio:document.getElementById('m-fecha').value||'',incluir_pedido:document.getElementById('m-incluir').checked?1:0,foto:ff};DB.set('meds',meds);showToast('✅ Actualizado');navigate('inventario');}
function borrarMed(id){showConfirm('🗑️ Eliminar','¿Eliminar este medicamento?',()=>{DB.set('meds',DB.get('meds').filter(m=>m.id!==id));showToast('Eliminado','error');navigate('inventario');});}

// ── Pedidos ──
function renderPedidos(){const meds=DB.get('meds').sort((a,b)=>b.incluir_pedido-a.incluir_pedido||a.nombre.localeCompare(b.nombre));pedidoItems=meds.map(med=>({...med,...calcularStock(med),qty:0}));const c=document.getElementById('pedidos-list');if(!meds.length){c.innerHTML=`<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-text">No hay medicamentos.</div></div>`;return;}c.innerHTML=`<div class="card">`+pedidoItems.map((it,i)=>`<div class="pedido-row" id="pedido-row-${i}" style="${!it.incluir_pedido?'opacity:.5;background:#fff5f5':''}"><div><input type="checkbox" style="width:20px;height:20px;accent-color:var(--verde)" ${it.incluir_pedido?'checked':''} onchange="togglePI(${i},this.checked)"/></div><input type="number" class="pedido-qty" id="qty-${i}" value="0" min="0" onchange="actualizarFuturo(${i})" oninput="actualizarFuturo(${i})"/><div class="pedido-info"><div class="pedido-nombre">${it.nombre}</div><div class="pedido-stock">📦 ${it.botesCalc} botes | ${formatTiempo(it.diasRestantes)}</div><div class="pedido-futuro" id="futuro-${i}">--</div></div></div>`).join('')+`</div>`;}
function togglePI(i,c){pedidoItems[i].incluir_pedido=c?1:0;const r=document.getElementById('pedido-row-'+i);r.style.opacity=c?'1':'.5';r.style.background=c?'':'#fff5f5';}
function actualizarFuturo(i){const qty=parseFloat(document.getElementById('qty-'+i).value)||0;pedidoItems[i].qty=qty;const it=pedidoItems[i];document.getElementById('futuro-'+i).textContent=qty>0&&it.tomaDia>0&&it.unidBote>0?'✅ Tras pedir: '+formatTiempo(Math.floor((it.dosisActuales+qty*it.unidBote)/it.tomaDia)):'--';}
function calcularPedidoDias(){const d=parseFloat(document.getElementById('p-dias').value);if(!d||d<=0){showToast('Introduce los días','error');return;}_calc(d);}
function calcularPedidoMeses(){const m=parseFloat(document.getElementById('p-meses').value);if(!m||m<=0){showToast('Introduce los meses','error');return;}_calc(Math.round(m*30));}
function _calc(dias){pedidoItems.forEach((it,i)=>{if(!it.incluir_pedido){document.getElementById('qty-'+i).value=0;document.getElementById('futuro-'+i).textContent='EXCLUIDO';return;}const falta=Math.max(0,it.tomaDia*dias-it.botesCalc*it.unidBote),botes=it.unidBote>0?Math.ceil(falta/it.unidBote):0;document.getElementById('qty-'+i).value=botes;pedidoItems[i].qty=botes;actualizarFuturo(i);});showToast(`✅ Calculado para ${dias} días`);}
function confirmarPedido(){
  const con=pedidoItems.filter(it=>it.qty>0&&it.incluir_pedido);if(!con.length){showToast('No hay cantidades a pedir','error');return;}
  showConfirm('✅ Confirmar Pedido',`¿Actualizar stock con ${con.length} medicamento(s)?`,()=>{
    const meds=DB.get('meds'),hist=DB.get('historial_pedidos',[]);
    const numPedido='PED-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(DB.get('nextPedidoId',1)).padStart(3,'0');
    localStorage.setItem('farrmacia_nextPedidoId',JSON.stringify(DB.get('nextPedidoId',1)+1));
    const fecha=new Date().toLocaleString('es-ES');
    pedidoItems.forEach(it=>{if(it.qty<=0||!it.incluir_pedido)return;const i=meds.findIndex(m=>m.id===it.id);if(i<0)return;const ns=it.botesCalc+it.qty;meds[i].stock_real=ns;hist.push({id:nextId(),fecha,num_pedido:numPedido,medicamento:it.nombre,botes_pedidos:it.qty,botes_total:ns,dias_restantes_tras_pedido:it.tomaDia>0&&it.unidBote>0?Math.floor((it.dosisActuales+it.qty*it.unidBote)/it.tomaDia):0});});
    DB.set('meds',meds);DB.set('historial_pedidos',hist);
    showToast(`✅ Pedido ${numPedido} confirmado`);
    mostrarResumenPedido(numPedido,fecha,con);navigate('inventario');
  });
}
function mostrarResumenPedido(numPedido,fecha,items){
  const filas=items.map(it=>{const dt=it.tomaDia>0&&it.unidBote>0?Math.floor((it.dosisActuales+it.qty*it.unidBote)/it.tomaDia):0;return{nombre:it.nombre,qty:it.qty,stockActual:Math.round(it.botesCalc*10)/10,stockTras:Math.round((it.botesCalc+it.qty)*10)/10,diasTras:dt,mesesTras:(dt/30).toFixed(1)};});
  const tabla=`<table class="resumen-table"><thead><tr><th>Medicamento</th><th style="text-align:center">Pedir</th><th style="text-align:center">Stock</th><th style="text-align:center">Total</th><th>Meses/Días</th></tr></thead><tbody>${filas.map(f=>`<tr><td>${f.nombre}</td><td class="qty-cell">${f.qty}</td><td style="text-align:center">${f.stockActual}</td><td style="text-align:center;font-weight:900">${f.stockTras}</td><td class="dias-cell">${f.diasTras} días | ${f.mesesTras} mes.</td></tr>`).join('')}</tbody></table>`;
  const mo=document.createElement('div');mo.className='modal-overlay';
  mo.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div class="modal-title" style="margin-bottom:0">📋 ${numPedido}</div><span style="font-size:11px;color:#999">${fecha}</span></div><p style="font-size:12px;color:#999;margin-bottom:10px">Resumen de Pedido a Farmacia</p>${tabla}<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px"><button class="btn-primary" style="margin-top:0;font-size:13px" id="btn-pdf-mo">📄 ${esMobile()?'Compartir informe':'Generar PDF'}</button><button class="btn-primary" style="margin-top:0;background:var(--azul);font-size:13px" id="btn-comp-mo">📤 Compartir texto</button></div><button class="btn-secondary" style="margin-top:8px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
  mo._filas=filas;document.body.appendChild(mo);
  document.getElementById('btn-pdf-mo').onclick=()=>generarPDFPedido(numPedido,fecha,filas);
  document.getElementById('btn-comp-mo').onclick=()=>{const txt=`PEDIDO ${numPedido}\n${fecha}\n\n`+filas.map(f=>`${f.nombre}: pedir ${f.qty} → total ${f.stockTras} (${f.diasTras} días / ${f.mesesTras} mes.)`).join('\n');if(navigator.share)navigator.share({title:'Pedido '+numPedido,text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));};
  mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});
}

// ── Historial Pedidos (con botón borrar pedido completo) ──
function renderHistorialPedidos(){
  const hist=[...DB.get('historial_pedidos',[])].reverse();
  const c=document.getElementById('historial-pedidos-list');
  if(!hist.length){c.innerHTML=`<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-text">No hay pedidos.</div></div>`;return;}
  const grupos={};
  hist.forEach(h=>{if(!grupos[h.num_pedido])grupos[h.num_pedido]={fecha:h.fecha,items:[]};grupos[h.num_pedido].items.push(h);});
  c.innerHTML=Object.entries(grupos).map(([numP,g])=>`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-size:15px;font-weight:900;color:var(--azul-oscuro)">📋 ${numP}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;color:#999">${g.fecha}</span>
          <button class="btn-sm btn-sm-verde" onclick="generarPDFPedidoHistorial('${numP}')">📄 ${esMobile()?'Compartir':'PDF'}</button>
          <button class="btn-sm btn-sm-azul"  onclick="compartirPedidoHistorial('${numP}')">📤</button>
          <button class="btn-sm btn-sm-rojo"  onclick="borrarPedidoHistorial('${numP}')">🗑️</button>
        </div>
      </div>
      ${g.items.map(it=>`<div class="historial-item"><div class="historial-item-med">💊 ${it.medicamento}</div><div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap"><span class="badge badge-amarillo">Pedido: ${it.botes_pedidos}</span><span class="badge badge-verde">Total: ${Math.round(it.botes_total*100)/100}</span>${it.dias_restantes_tras_pedido?`<span class="badge badge-azul">${it.dias_restantes_tras_pedido} días</span>`:''}</div></div>`).join('')}
    </div>`).join('');
}

function borrarPedidoHistorial(numPedido) {
  showConfirm('🗑️ Borrar pedido','¿Eliminar el pedido '+numPedido+' del historial?',()=>{
    const hist=DB.get('historial_pedidos',[]).filter(h=>h.num_pedido!==numPedido);
    DB.set('historial_pedidos',hist);showToast('Pedido eliminado','error');renderHistorialPedidos();
  });
}

function generarPDFPedidoHistorial(numPedido){const items=DB.get('historial_pedidos',[]).filter(h=>h.num_pedido===numPedido);if(!items.length)return;const filas=items.map(it=>({nombre:it.medicamento,qty:it.botes_pedidos,stockActual:Math.round((it.botes_total-it.botes_pedidos)*10)/10,stockTras:Math.round(it.botes_total*10)/10,diasTras:it.dias_restantes_tras_pedido||0,mesesTras:((it.dias_restantes_tras_pedido||0)/30).toFixed(1)}));generarPDFPedido(numPedido,items[0].fecha,filas);}
function compartirPedidoHistorial(numPedido){const items=DB.get('historial_pedidos',[]).filter(h=>h.num_pedido===numPedido);if(!items.length)return;const txt=`PEDIDO ${numPedido}\n${items[0].fecha}\n\n`+items.map(it=>`${it.medicamento}: ${it.botes_pedidos} botes → ${Math.round(it.botes_total*10)/10} total (${it.dias_restantes_tras_pedido||'-'} días)`).join('\n');if(navigator.share)navigator.share({title:'Pedido '+numPedido,text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));}

// ── Citas ──
function renderCitas(){const hoy=new Date().toISOString().split('T')[0],manana=new Date(Date.now()+86400000).toISOString().split('T')[0],citas=DB.get('citas',[]).sort((a,b)=>a.fecha.localeCompare(b.fecha)),c=document.getElementById('citas-list');if(!citas.length){c.innerHTML=`<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">No hay citas.</div></div>`;return;}c.innerHTML=citas.map(ci=>{const p=ci.fecha<hoy,m=ci.fecha===manana;return`<div class="cita-card${m?' manana':''}" style="${p?'opacity:.6;border-left-color:#ccc':''}"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="cita-date">📅 ${formatFecha(ci.fecha)} · ${ci.hora}</div><div class="cita-doctor">👨‍⚕️ ${ci.profesional}</div>${ci.observaciones?`<div class="cita-obs">📝 ${ci.observaciones}</div>`:''}${m?`<div style="color:var(--rojo);font-size:12px;font-weight:900;margin-top:4px">⚠️ ¡MAÑANA!</div>`:''}</div>${p?'<span class="badge badge-rojo">Pasada</span>':m?'<span class="badge badge-rojo">¡Mañana!</span>':'<span class="badge badge-verde">Próxima</span>'}</div><div class="cita-actions"><button class="btn-sm btn-sm-azul" onclick="editarCita(${ci.id})">✏️</button><button class="btn-sm btn-sm-verde" onclick="compartirCita(${ci.id})">📤</button><button class="btn-sm btn-sm-rojo" onclick="borrarCita(${ci.id})">🗑️</button></div></div>`;}).join('');}
function formatFecha(f){if(!f)return'';const[y,m,d]=f.split('-');return`${d} ${'Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic'.split(' ')[parseInt(m)-1]} ${y}`;}
function guardarCita(){const prof=document.getElementById('c-prof').value.trim();if(!prof){showToast('⚠️ Introduce el médico','error');return;}const cita={id:editingCitaId||nextId(),profesional:prof,fecha:document.getElementById('c-fecha').value,hora:document.getElementById('c-hora').value,observaciones:document.getElementById('c-obs').value.trim()};const citas=DB.get('citas',[]);if(editingCitaId){const i=citas.findIndex(c=>c.id===editingCitaId);if(i>=0)citas[i]=cita;showToast('✅ Cita actualizada');}else{citas.push(cita);showToast('✅ Cita añadida');}DB.set('citas',citas);cancelarEditarCita();renderCitas();cargarCitasMini();}
function editarCita(id){const ci=DB.get('citas',[]).find(c=>c.id===id);if(!ci)return;editingCitaId=id;document.getElementById('c-prof').value=ci.profesional;document.getElementById('c-fecha').value=ci.fecha;document.getElementById('c-hora').value=ci.hora;document.getElementById('c-obs').value=ci.observaciones;document.getElementById('citas-form-title').textContent='✏️ Editar Cita';document.getElementById('c-btn-guardar').textContent='💾 Actualizar Cita';document.getElementById('c-btn-guardar').style.background='#f39c12';document.getElementById('c-btn-cancelar').style.display='block';document.getElementById('content').scrollTop=0;}
function cancelarEditarCita(){editingCitaId=null;['c-prof','c-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('c-fecha').value=new Date().toISOString().split('T')[0];document.getElementById('c-hora').value='10:00';document.getElementById('citas-form-title').textContent='➕ Nueva Cita';document.getElementById('c-btn-guardar').textContent='➕ Añadir Cita';document.getElementById('c-btn-guardar').style.background='';document.getElementById('c-btn-cancelar').style.display='none';}
function borrarCita(id){showConfirm('🗑️ Borrar cita','¿Eliminar esta cita?',()=>{DB.set('citas',DB.get('citas',[]).filter(c=>c.id!==id));showToast('Cita eliminada','error');renderCitas();cargarCitasMini();});}
function compartirCita(id){const ci=DB.get('citas',[]).find(c=>c.id===id);if(!ci)return;const txt=`📅 Cita médica\n${formatFecha(ci.fecha)} a las ${ci.hora}\nMédico: ${ci.profesional}${ci.observaciones?'\nNotas: '+ci.observaciones:''}`;if(navigator.share)navigator.share({title:'Cita médica',text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));}

// ── Notificaciones ──
async function solicitarPermisoNotificaciones(){if(!('Notification' in window))return false;if(Notification.permission==='granted')return true;if(Notification.permission==='denied')return false;return(await Notification.requestPermission())==='granted';}
function verificarCitasManana(){const m=new Date(Date.now()+86400000).toISOString().split('T')[0],cits=DB.get('citas',[]).filter(c=>c.fecha===m),badge=document.getElementById('notif-citas');if(cits.length){if(badge){badge.style.display='flex';badge.textContent=cits.length;}if(Notification.permission==='granted')cits.forEach(c=>new Notification('🏥 Cita mañana – FaR-Rmacia',{body:`${c.profesional} a las ${c.hora}`,icon:'icon-192.png',tag:'cita-'+c.id}));else setTimeout(()=>showToast(`📅 Tienes ${cits.length} cita(s) mañana`,'info'),2000);}else if(badge)badge.style.display='none';}
function cargarCitasMini(){const hoy=new Date().toISOString().split('T')[0],m=new Date(Date.now()+86400000).toISOString().split('T')[0],cits=DB.get('citas',[]).filter(c=>c.fecha>=hoy).sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(0,5),c=document.getElementById('citas-mini-list');if(!c)return;c.innerHTML=cits.length?cits.map(ci=>`<div class="cita-chip${ci.fecha===m?' urgente':''}" onclick="navigate('citas')">📅 ${formatFecha(ci.fecha)} – ${ci.profesional}${ci.fecha===m?' ⚠️':''}</div>`).join(''):`<span class="sin-citas">Sin citas próximas</span>`;}

// ── Historial médico ──
function cargarHistorial(){document.getElementById('h-notas').value=DB.get('notas','');renderDocs();}
function guardarNotas(){DB.set('notas',document.getElementById('h-notas').value);showToast('💾 Notas guardadas');}

function subirArchivoHistorial(event){
  const files=Array.from(event.target.files);if(!files.length)return;
  let done=0;
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=async e=>{
      const base64=e.target.result,id=nextId(),prefijo=new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
      const meta={id,nombre:prefijo+'_'+file.name,titulo:file.name,tipo:file.type||'application/octet-stream',es_archivo:true,base64:null,contenido:'',fecha:new Date().toLocaleString('es-ES'),tamano:file.size};
      try{await idbSet(id,base64,file.type,file.name);}catch(err){console.warn('IDB:',err);meta.base64=base64;}
      const docs=DB.get('docs',[]);docs.push(meta);DB.set('docs',docs);
      done++;if(done===files.length){showToast(`✅ ${files.length} archivo(s) guardado(s)`);renderDocs();}
    };reader.readAsDataURL(file);
  });event.target.value='';
}

function crearNotaDocumento(){const mo=document.createElement('div');mo.className='modal-overlay';mo.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📄 Crear Nota</div><div class="form-group"><label class="form-label">Título</label><input type="text" class="form-input" id="doc-titulo" placeholder="Ej: Analítica Junio"/></div><div class="form-group"><label class="form-label">Contenido</label><textarea class="form-textarea" id="doc-contenido" placeholder="Escribe el contenido..."></textarea></div><button class="btn-primary" onclick="guardarDocumento()">💾 Guardar</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button></div>`;document.body.appendChild(mo);mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});}
function guardarDocumento(){const titulo=document.getElementById('doc-titulo').value.trim();if(!titulo){showToast('⚠️ Escribe un título','error');return;}const docs=DB.get('docs',[]);docs.push({id:nextId(),nombre:new Date().toISOString().replace(/[:.]/g,'_').slice(0,16)+'_'+titulo,titulo,contenido:document.getElementById('doc-contenido').value.trim(),es_archivo:false,base64:null,tipo:'text/plain',fecha:new Date().toLocaleString('es-ES')});DB.set('docs',docs);document.querySelector('.modal-overlay')?.remove();showToast('✅ Documento guardado');renderDocs();}

function renderDocs(){
  const docs=DB.get('docs',[]),c=document.getElementById('docs-list');if(!c)return;
  if(!docs.length){c.innerHTML=`<div class="empty-text" style="font-size:13px;color:#aaa;text-align:center;padding:20px">No hay documentos guardados.</div>`;return;}
  const ic={'application/pdf':'📄','image/jpeg':'🖼️','image/png':'🖼️','image/webp':'🖼️','text/plain':'📝'};
  c.innerHTML=docs.map(doc=>`<div class="doc-item"><div class="doc-icon">${ic[doc.tipo]||(doc.es_archivo?'📎':'📝')}</div><div class="doc-name" onclick="verDocumento(${doc.id})" style="cursor:pointer;color:var(--azul-oscuro)">${doc.titulo}<br><span style="font-size:11px;color:#999;font-weight:400">${doc.fecha}${doc.tamano?' · '+(doc.tamano/1024).toFixed(1)+' KB':''}</span></div><button class="doc-compartir" onclick="compartirDoc(${doc.id})">📤</button><button class="doc-del" onclick="borrarDoc(${doc.id})">🗑️</button></div>`).join('');
}

// ── Ver archivo en móvil: descarga directa con nombre correcto ──
async function verDocumento(id){
  const doc=DB.get('docs',[]).find(d=>d.id===id);if(!doc)return;
  if(doc.es_archivo){
    showToast('⏳ Abriendo...','info');
    let base64=doc.base64||null;
    if(!base64){const e=await idbGet(id).catch(()=>null);base64=e?.base64||null;}
    if(!base64){showToast('❌ Archivo no encontrado en este dispositivo','error');return;}
    const tipo=doc.tipo||'application/octet-stream';
    let blob;
    try{const b64=base64.includes(',')?base64.split(',')[1]:base64,bs=atob(b64),ab=new ArrayBuffer(bs.length),ia=new Uint8Array(ab);for(let i=0;i<bs.length;i++)ia[i]=bs.charCodeAt(i);blob=new Blob([ab],{type:tipo});}catch(e){showToast('❌ Error al leer','error');return;}
    if(tipo.startsWith('image/')){
      const mo=document.createElement('div');mo.className='modal-overlay';const iu=URL.createObjectURL(blob);
      mo.innerHTML=`<div class="modal-sheet" style="text-align:center"><div class="modal-handle"></div><div class="modal-title">🖼️ ${doc.titulo}</div><img src="${iu}" style="max-width:100%;border-radius:12px;margin-bottom:12px"/><button class="btn-primary" onclick="compartirDoc(${doc.id})">📤 Compartir</button><button class="btn-secondary" onclick="URL.revokeObjectURL('${iu}');this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
      document.body.appendChild(mo);mo.addEventListener('click',e=>{if(e.target===mo){URL.revokeObjectURL(iu);mo.remove();}});return;
    }
    // PDF y otros: forzar descarga con nombre correcto (en móvil Android abre el visor nativo)
    const fu=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=fu;a.download=doc.titulo;a.target='_blank';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(fu),15000);
    return;
  }
  // Nota texto
  const mo=document.createElement('div');mo.className='modal-overlay';mo.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">📄 ${doc.titulo}</div><p style="font-size:11px;color:#999;margin-bottom:12px">${doc.fecha}</p><textarea class="nota-area" readonly style="min-height:200px;background:#f9f9f9">${doc.contenido}</textarea><button class="btn-primary" onclick="compartirDoc(${doc.id})">📤 Compartir</button><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;document.body.appendChild(mo);mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});
}

async function compartirDoc(id){
  const doc=DB.get('docs',[]).find(d=>d.id===id);if(!doc)return;
  if(doc.es_archivo){let b64=doc.base64||null;if(!b64){const e=await idbGet(id).catch(()=>null);b64=e?.base64||null;}if(b64&&navigator.share){try{const tipo=doc.tipo||'application/octet-stream',b=b64.includes(',')?b64.split(',')[1]:b64,bs=atob(b),ab=new ArrayBuffer(bs.length),ia=new Uint8Array(ab);for(let i=0;i<bs.length;i++)ia[i]=bs.charCodeAt(i);const file=new File([new Blob([ab],{type:tipo})],doc.titulo,{type:tipo});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:doc.titulo});return;}}catch(e){}}if(navigator.share)navigator.share({title:doc.titulo,text:doc.titulo});return;}
  const txt=`${doc.titulo}\n${doc.fecha}\n\n${doc.contenido}`;if(navigator.share)navigator.share({title:doc.titulo,text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));
}

function borrarDoc(id){showConfirm('🗑️ Borrar documento','¿Eliminar este documento?',async()=>{DB.set('docs',DB.get('docs',[]).filter(d=>d.id!==id));await idbDelete(id).catch(()=>{});showToast('Documento eliminado','error');renderDocs();});}

// ── Alertas stock ──
function verificarAlertas(){const alertas=DB.get('meds').filter(med=>{const s=calcularStock(med);return s.iniciado&&s.diasRestantes<=14;});if(alertas.length){setTimeout(()=>showToast(`⚠️ Stock bajo: ${alertas.length} medicamento(s)`,'error'),1500);if(Notification.permission==='granted')new Notification('⚠️ Stock bajo – FaR-Rmacia',{body:alertas.map(m=>m.nombre).join(', '),icon:'icon-192.png',tag:'stock-bajo'});}}

// ── INIT ──
document.addEventListener('DOMContentLoaded',async()=>{
  actualizarReloj();
  setInterval(actualizarReloj,30000);
  await idbOpen().catch(err=>console.warn('IDB:',err));
  await syncInteligente();
  document.getElementById('c-fecha').value=new Date().toISOString().split('T')[0];
  cargarCitasMini();
  verificarAlertas();
  verificarCitasManana();
  solicitarPermisoNotificaciones().then(ok=>{if(ok)verificarCitasManana();});
  initSwipeGestures();
  iniciarPolling(); // detectar cambios desde otro dispositivo cada 30s
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
});
