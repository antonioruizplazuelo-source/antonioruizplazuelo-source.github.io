// FaR-Rmacia v4.1 — Firebase Authentication
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
const FIREBASE_AUTH_BASE = `https://identitytoolkit.googleapis.com/v1/accounts`;

// ── AUTH — Token de sesión ──
let authToken = null;      // ID token de Firebase Auth
let authEmail = null;      // Email del usuario logueado
let tokenExpiry = 0;       // Timestamp de expiración del token

// Guardar/recuperar sesión entre recargas
function guardarSesion(token, email, expiresIn) {
  authToken = token;
  authEmail = email;
  tokenExpiry = Date.now() + (parseInt(expiresIn) - 60) * 1000;
  localStorage.setItem('farrmacia_auth_token', token);
  localStorage.setItem('farrmacia_auth_email', email);
  localStorage.setItem('farrmacia_auth_expiry', String(tokenExpiry));
}
function cargarSesionGuardada() {
  const token   = localStorage.getItem('farrmacia_auth_token');
  const email   = localStorage.getItem('farrmacia_auth_email');
  const expiry  = parseInt(localStorage.getItem('farrmacia_auth_expiry') || '0');
  if (token && email && Date.now() < expiry) {
    authToken  = token;
    authEmail  = email;
    tokenExpiry = expiry;
    return true;
  }
  return false;
}
function cerrarSesion() {
  authToken = null; authEmail = null; tokenExpiry = 0;
  localStorage.removeItem('farrmacia_auth_token');
  localStorage.removeItem('farrmacia_auth_email');
  localStorage.removeItem('farrmacia_auth_expiry');
}
function estaLogueado() {
  return authToken && Date.now() < tokenExpiry;
}

// Login con email + contraseña contra Firebase Auth REST API
async function loginFirebase(email, password) {
  const url = `${FIREBASE_AUTH_BASE}:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const j = await r.json();
  if (!r.ok) {
    // Traducir errores al español
    const errores = {
      'EMAIL_NOT_FOUND':      'Email no encontrado. Comprueba que esté bien escrito.',
      'INVALID_PASSWORD':     'Contraseña incorrecta.',
      'USER_DISABLED':        'Esta cuenta está desactivada.',
      'INVALID_EMAIL':        'El email no tiene un formato válido.',
      'TOO_MANY_ATTEMPTS_TRY_LATER': 'Demasiados intentos fallidos. Espera unos minutos.',
      'INVALID_LOGIN_CREDENTIALS': 'Email o contraseña incorrectos.',
    };
    const code = j.error?.message || 'ERROR_DESCONOCIDO';
    throw new Error(errores[code] || 'Error al iniciar sesión: ' + code);
  }
  guardarSesion(j.idToken, j.email, j.expiresIn);
  return j;
}

// Obtener cabecera Authorization para las peticiones a Firestore
function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  if (authToken) base['Authorization'] = 'Bearer ' + authToken;
  return base;
}

// ── Pantalla de LOGIN ──
function mostrarPantallaLogin(mensajeError = '') {
  // Ocultar la app mientras no esté logueado
  document.getElementById('app').style.display = 'none';

  let loginEl = document.getElementById('login-screen');
  if (!loginEl) {
    loginEl = document.createElement('div');
    loginEl.id = 'login-screen';
    loginEl.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      background: linear-gradient(160deg, #1E7A47 0%, #3DAA6E 45%, #5CC98A 80%, #8DE8B5 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:'Nunito',sans-serif; padding:24px;
    `;
    loginEl.innerHTML = `
      <div style="background:white;border-radius:28px;padding:32px 24px;width:100%;max-width:380px;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:52px;margin-bottom:8px">💊</div>
          <div style="font-size:28px;font-weight:900;color:#1B5E20">FaR-<span style="color:#CCFF00;-webkit-text-stroke:1px #888">Rmacia</span></div>
          <div style="font-size:13px;color:#888;margin-top:4px;font-weight:600">Tu farmacia personal</div>
        </div>
        <div id="login-error" style="display:none;background:#fde8e8;border-radius:12px;padding:10px 14px;font-size:13px;color:#c62828;font-weight:700;margin-bottom:16px;text-align:center"></div>
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:800;color:#666;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Email</label>
          <input id="login-email" type="email" autocomplete="email"
            style="width:100%;padding:13px 14px;border:2px solid #d5eee2;border-radius:12px;font-size:16px;font-family:'Nunito',sans-serif;outline:none;box-sizing:border-box"
            placeholder="tu@email.com"
            onfocus="this.style.borderColor='#3DAA6E'"
            onblur="this.style.borderColor='#d5eee2'"/>
        </div>
        <div style="margin-bottom:22px">
          <label style="font-size:11px;font-weight:800;color:#666;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Contraseña</label>
          <input id="login-pass" type="password" autocomplete="current-password"
            style="width:100%;padding:13px 14px;border:2px solid #d5eee2;border-radius:12px;font-size:16px;font-family:'Nunito',sans-serif;outline:none;box-sizing:border-box"
            placeholder="••••••••"
            onfocus="this.style.borderColor='#3DAA6E'"
            onblur="this.style.borderColor='#d5eee2'"
            onkeydown="if(event.key==='Enter')hacerLogin()"/>
        </div>
        <button onclick="hacerLogin()"
          style="width:100%;padding:15px;background:linear-gradient(135deg,#3DAA6E,#5CC98A);color:white;border:none;border-radius:16px;font-size:17px;font-weight:900;font-family:'Nunito',sans-serif;cursor:pointer;letter-spacing:.3px"
          id="login-btn">
          🔐 Entrar
        </button>
        <div style="text-align:center;margin:14px 0 4px;color:#bbb;font-size:12px">— o —</div>
        <button onclick="usarSinLogin()"
          style="width:100%;padding:12px;background:white;border:2px solid #d5eee2;border-radius:16px;font-size:14px;font-weight:800;font-family:'Nunito',sans-serif;cursor:pointer;color:#555">
          💾 Usar sin sincronización (solo local)
        </button>
        <div style="text-align:center;margin-top:14px;font-size:12px;color:#aaa">
          ¿Sin acceso? Contacta con el administrador de la app
        </div>
      </div>
    `;
    document.body.appendChild(loginEl);
  }

  loginEl.style.display = 'flex';

  if (mensajeError) {
    const err = document.getElementById('login-error');
    if (err) { err.textContent = mensajeError; err.style.display = 'block'; }
  }

  // Foco automático en el email
  setTimeout(() => document.getElementById('login-email')?.focus(), 100);
}

function ocultarPantallaLogin() {
  const loginEl = document.getElementById('login-screen');
  if (loginEl) loginEl.style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

async function usarSinLogin() {
  // Crear o reutilizar un perfil local dedicado (no toca el perfil Firebase)
  let perfiles = getPerfiles();
  let perfilLocal = perfiles.find(p => p.modo === 'local');
  if (!perfilLocal) {
    perfilLocal = { id: 'perfil_local', nombre: 'Local (sin nube)', modo: 'local', firebaseUserId: '' };
    perfiles.push(perfilLocal);
    setPerfiles(perfiles);
  }
  setPerfilActivo(perfilLocal);
  ocultarPantallaLogin();
  await iniciarAppTrasLogin();
  showToast('💾 Modo local — sin sincronización', 'info');
}

async function hacerLogin() {
  const email = document.getElementById('login-email')?.value.trim();
  const pass  = document.getElementById('login-pass')?.value;
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');

  if (!email || !pass) {
    if (err) { err.textContent = '⚠️ Introduce email y contraseña'; err.style.display = 'block'; }
    return;
  }

  if (btn) { btn.textContent = '⏳ Conectando...'; btn.disabled = true; }
  if (err) err.style.display = 'none';

  try {
    await loginFirebase(email, pass);
    ocultarPantallaLogin();
    // Inicializar la app normalmente tras el login
    await iniciarAppTrasLogin();
  } catch(e) {
    mostrarPantallaLogin(e.message);
    if (btn) { btn.textContent = '🔐 Entrar'; btn.disabled = false; }
  }
}

async function iniciarAppTrasLogin() {
  initPerfiles();
  await idbOpen().catch(err => console.warn('IDB:', err));
  await syncInteligente();
  document.getElementById('c-fecha').value = new Date().toISOString().split('T')[0];
  cargarCitasMini();
  verificarAlertas();
  verificarCitasManana();
  solicitarPermisoNotificaciones().then(ok => { if (ok) verificarCitasManana(); });
  initSwipeGestures();
  iniciarPolling();
  const wrapper = document.getElementById('screens-wrapper');
  if (wrapper) { wrapper.style.transition = 'none'; wrapper.style.transform = 'translateX(0)'; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

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

// ── PERFILES DE USUARIO ──
// Cada perfil tiene: id, nombre, modo ('local'|'firebase'), firebaseUserId
// El perfil activo se guarda en localStorage['farrmacia_perfil_activo']

function getPerfilActivo() {
  try { return JSON.parse(localStorage.getItem('farrmacia_perfil_activo')); } catch { return null; }
}
function setPerfilActivo(p) { localStorage.setItem('farrmacia_perfil_activo',JSON.stringify(p)); }
function getPerfiles() {
  try { return JSON.parse(localStorage.getItem('farrmacia_perfiles'))||[]; } catch { return []; }
}
function setPerfiles(ps) { localStorage.setItem('farrmacia_perfiles',JSON.stringify(ps)); }

// Prefijo de claves localStorage para el perfil activo
function dbKey(key) {
  const p=getPerfilActivo();
  const prefix=p?`farrmacia_${p.id}_`:'farrmacia_';
  return prefix+key;
}

// ── DB localStorage (con soporte multi-perfil) ──
const DB = {
  get(key,def=[]) { try { return JSON.parse(localStorage.getItem(dbKey(key)))??def; } catch { return def; } },
  set(key,val) { localStorage.setItem(dbKey(key),JSON.stringify(val)); localStorage.setItem(dbKey('localModified'),new Date().toISOString()); scheduleAutoSync(); },
  setRaw(key,val) { localStorage.setItem(dbKey(key),JSON.stringify(val)); }
};
function estaVacioLocal() { return localStorage.getItem(dbKey('meds'))===null; }

// USER_ID dinámico según perfil activo
function getUserId() {
  const p=getPerfilActivo();
  return (p&&p.firebaseUserId)?p.firebaseUserId:'antonio';
}
function getModo() {
  const p=getPerfilActivo();
  return p?p.modo:'firebase';
}

// ── Gestor de perfiles ──
function abrirGestorPerfiles() {
  const perfiles=getPerfiles();
  const activo=getPerfilActivo();
  const modal=document.createElement('div');modal.className='modal-overlay';
  modal.innerHTML=`
    <div class="modal-sheet" style="max-height:90dvh">
      <div class="modal-handle"></div>
      <div class="modal-title">👤 Perfiles de Usuario</div>
      <div style="font-size:12px;background:#e8f5ff;border-radius:10px;padding:10px;margin-bottom:14px;color:#1A5276;line-height:1.6">
        💡 Cada perfil tiene sus propios datos. Puedes usar un perfil en local (sin Firebase) o sincronizado en la nube.
      </div>
      <div id="perfiles-list-modal" style="margin-bottom:14px">
        ${perfiles.length===0?'<div style="color:#aaa;text-align:center;padding:10px;font-size:13px">No hay perfiles creados</div>':perfiles.map(p=>`
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:${activo&&activo.id===p.id?'#d4f5e2':'#f5f5f5'};border-radius:12px;margin-bottom:8px">
            <div style="flex:1">
              <div style="font-weight:900;font-size:15px;color:var(--azul-oscuro)">${p.nombre}${activo&&activo.id===p.id?' <span style="color:var(--verde);font-size:11px">● Activo</span>':''}</div>
              <div style="font-size:11px;color:#888">${p.modo==='firebase'?'☁️ Firebase: '+p.firebaseUserId:'💾 Solo local'}</div>
            </div>
            ${activo&&activo.id===p.id?'':
              `<button class="btn-sm btn-sm-verde" onclick="cambiarPerfil('${p.id}');this.closest('.modal-overlay').remove()">Usar</button>`}
            <button class="btn-sm btn-sm-rojo" onclick="borrarPerfil('${p.id}');renderPerfilesModal()">🗑️</button>
          </div>`).join('')}
      </div>
      <button class="btn-primary" style="font-size:14px" onclick="crearNuevoPerfil(this.closest('.modal-overlay'))">➕ Nuevo Perfil</button>
      <button class="btn-secondary" style="margin-top:8px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}

function crearNuevoPerfil(modalPadre) {
  const mo=document.createElement('div');mo.className='modal-overlay';
  mo.style.zIndex='600';
  mo.innerHTML=`
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">➕ Nuevo Perfil</div>
      <div class="form-group">
        <label class="form-label">Nombre del perfil</label>
        <input type="text" class="form-input" id="np-nombre" placeholder="Ej: Antonio, Mi hijo, Mamá"/>
      </div>
      <div class="form-group">
        <label class="form-label">Modo</label>
        <select class="form-input" id="np-modo" onchange="toggleFirebaseFields()" style="padding:12px">
          <option value="local">💾 Solo local (sin nube)</option>
          <option value="firebase">☁️ Sincronizado con Firebase</option>
        </select>
      </div>
      <div id="np-firebase-fields" style="display:none">
        <div style="background:#e8f5ff;border-radius:10px;padding:12px;margin-bottom:12px;font-size:12px;color:#1A5276;line-height:1.7">
          <strong>Para sincronizar con Firebase necesitas:</strong><br>
          1️⃣ Ir a <a href="https://console.firebase.google.com" target="_blank" style="color:var(--azul)">console.firebase.google.com</a><br>
          2️⃣ Abrir el proyecto <strong>far-rmacia</strong><br>
          3️⃣ Ir a Firestore Database → Datos<br>
          4️⃣ Crear documento en colección <strong>usuarios</strong><br>
          5️⃣ El ID del documento es tu nombre de usuario (ej: <em>maria</em>)<br>
          6️⃣ Escribe ese mismo ID abajo 👇
        </div>
        <div class="form-group">
          <label class="form-label">ID de usuario Firebase</label>
          <input type="text" class="form-input" id="np-fbid" placeholder="Ej: maria, hijo, mama"/>
        </div>
        <div style="background:#fff9c4;border-radius:8px;padding:10px;font-size:12px;color:#555;margin-bottom:10px">
          💡 <strong>Compartir datos con otra persona:</strong> si tú y tu mujer queréis ver los mismos datos, usad el <em>mismo ID Firebase</em> (ej: ambos ponen <em>antonio</em>).
        </div>
      </div>
      <button class="btn-primary" onclick="guardarNuevoPerfil()">💾 Crear Perfil</button>
      <button class="btn-secondary" style="margin-top:8px" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
    </div>`;
  document.body.appendChild(mo);
  mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});
}

function toggleFirebaseFields(){
  const modo=document.getElementById('np-modo')?.value;
  const ff=document.getElementById('np-firebase-fields');
  if(ff)ff.style.display=modo==='firebase'?'block':'none';
}

function guardarNuevoPerfil(){
  const nombre=document.getElementById('np-nombre')?.value.trim();
  if(!nombre){showToast('⚠️ Escribe un nombre','error');return;}
  const modo=document.getElementById('np-modo')?.value||'local';
  const fbid=document.getElementById('np-fbid')?.value.trim()||'';
  if(modo==='firebase'&&!fbid){showToast('⚠️ Escribe el ID de Firebase','error');return;}
  const perfiles=getPerfiles();
  const id='perfil_'+Date.now();
  perfiles.push({id,nombre,modo,firebaseUserId:fbid});
  setPerfiles(perfiles);
  document.querySelectorAll('.modal-overlay').forEach(m=>m.remove());
  showToast(`✅ Perfil "${nombre}" creado`);
  // Preguntar si cambiar a este perfil
  showConfirm(`👤 Usar "${nombre}"`,`¿Cambiar a este perfil ahora?`,()=>cambiarPerfil(id));
}

async function cambiarPerfil(id) {
  const perfiles = getPerfiles();
  const p = perfiles.find(x => x.id === id);
  if (!p) return;
  setPerfilActivo(p);

  // Si el perfil es Firebase y no hay sesión activa → pedir login
  if (p.modo === 'firebase' && !estaLogueado()) {
    document.querySelector('.modal-overlay')?.remove();
    mostrarPantallaLogin('Introduce tus credenciales para sincronizar con este perfil');
    return;
  }

  mostrarSpinnerInicio(true);
  if (p.modo === 'firebase' && estaVacioLocal()) {
    await syncFromFirebase(true).catch(() => {});
  }
  mostrarSpinnerInicio(false);
  showToast(`👤 Perfil: ${p.nombre}`, 'info');
  document.querySelector('.modal-overlay')?.remove();
  navigate('menu');
  cargarCitasMini();
  verificarAlertas();
}

function borrarPerfil(id){
  const activo=getPerfilActivo();
  if(activo&&activo.id===id){showToast('⚠️ No puedes borrar el perfil activo','error');return;}
  showConfirm('🗑️ Borrar perfil','¿Eliminar este perfil? Los datos locales de este perfil se borrarán.',()=>{
    const perfiles=getPerfiles().filter(p=>p.id!==id);
    setPerfiles(perfiles);
    // Borrar datos locales del perfil
    const keys=Object.keys(localStorage).filter(k=>k.startsWith('farrmacia_'+id+'_'));
    keys.forEach(k=>localStorage.removeItem(k));
    showToast('Perfil eliminado','error');
    abrirGestorPerfiles();
  });
}

function renderPerfilesModal(){
  document.querySelectorAll('.modal-overlay').forEach(m=>m.remove());
  abrirGestorPerfiles();
}

// ── INIT perfiles: si no existe perfil activo, crear uno por defecto ──
function initPerfiles() {
  let perfiles=getPerfiles();
  let activo=getPerfilActivo();
  if(!activo){
    if(perfiles.length===0){
      // Crear perfil por defecto (antonio, firebase) para compatibilidad
      const defaultPerfil={id:'perfil_default',nombre:'Antonio',modo:'firebase',firebaseUserId:'antonio'};
      perfiles=[defaultPerfil];
      setPerfiles(perfiles);
      activo=defaultPerfil;
    } else {
      activo=perfiles[0];
    }
    setPerfilActivo(activo);
  }
}


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
  if(getModo()==='local') return null;
  try {
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${getUserId()}?mask.fieldPaths=ultimaSincro`, { headers: authHeaders() });
    if (!r.ok) return null;
    const j = await r.json();
    return j.fields?.ultimaSincro ? parseFsVal(j.fields.ultimaSincro) : null;
  } catch { return null; }
}

// ── Subir a Firebase ──
// Los archivos del historial se incluyen como base64 en Firebase
// (solo los que caben — máx ~800KB por archivo para no superar límite Firestore 1MB/doc)
async function syncToFirebase(silencioso=false) {
  if (getModo()==='local') return true; // modo local: no sincronizar
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
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${getUserId()}`,{method:'PATCH',headers:authHeaders(),body:JSON.stringify({fields})});
    if (!r.ok) throw new Error('HTTP '+r.status);
    localStorage.setItem(dbKey('lastSync'),data.ultimaSincro);
    localStorage.removeItem(dbKey('pendingSync'));
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
  if (getModo()==='local') return false; // modo local: no sincronizar
  if (syncInProgress) return false;
  syncInProgress=true;
  document.getElementById('btn-sync')?.classList.add('syncing');
  try {
    const r = await fetch(`${FIREBASE_BASE}/usuarios/${getUserId()}`, { headers: authHeaders() });
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
      localStorage.setItem(dbKey('lastSync'),data.ultimaSincro);
      localStorage.setItem(dbKey('localModified'),data.ultimaSincro);
    }
    localStorage.removeItem(dbKey('pendingSync'));
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
  if (getModo()==='local') return; // modo local: no sincronizar
  localStorage.setItem(dbKey('pendingSync'),'true');
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(()=>syncToFirebase(true), 5000);
}

// ── Polling Firebase cada 30s (para detectar cambios desde otro dispositivo) ──
function iniciarPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (syncInProgress||getModo()==='local') return;
    const tsFirebase = await getFirebaseTimestamp().catch(()=>null);
    if (!tsFirebase) return;
    const tsLocal = localStorage.getItem(dbKey('localModified'));
    if (tsLocal && tsFirebase > tsLocal) {
      await syncFromFirebase(true);
      showToast('☁️ Datos actualizados desde otro dispositivo','info');
    }
  }, 30000);
}

// ── Sync inteligente al arrancar ──
async function syncInteligente() {
  mostrarSpinnerInicio(true);
  try {
    if (getModo()==='local') { initDBLocal(); return; }
    if (estaVacioLocal()) {
      const ok = await syncFromFirebase(true);
      if (!ok) initDBLocal();
      return;
    }
    const tsFirebase = await getFirebaseTimestamp();
    const tsLocal    = localStorage.getItem(dbKey('localModified'));
    if (!tsFirebase) {
      if (DB.get('meds',[]).length>0) await syncToFirebase(true);
      return;
    }
    if (tsLocal && tsFirebase > tsLocal) {
      await syncFromFirebase(true);
      showToast('☁️ Datos actualizados desde Firebase','info');
    } else if (localStorage.getItem(dbKey('pendingSync'))==='true') {
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
  if(getModo()==='local'){
    bar.style.display='flex';
    bar.textContent='💾 Modo local — sin sincronización en la nube';
    bar.style.background='#e8f5ff';bar.style.borderColor='#90caf9';bar.style.color='#1565c0';
    return;
  }
  bar.style.display = ok ? 'none' : 'flex';
  bar.style.background='';bar.style.borderColor='';bar.style.color='';
  bar.textContent='❌ Sin conexión — datos guardados localmente';
}

function abrirSyncPanel() {
  const hasPending = localStorage.getItem(dbKey('pendingSync'))==='true';
  const lastSync   = localStorage.getItem(dbKey('lastSync'));
  const perfil     = getPerfilActivo();
  const modal = document.createElement('div'); modal.className='modal-overlay';
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">☁️ Firebase & Backup</div>
      <div style="background:#f0faf5;border-radius:12px;padding:14px;margin-bottom:12px;font-size:13px;color:#333;line-height:1.9">
        <div><strong>Perfil:</strong> 👤 ${perfil ? perfil.nombre : '(sin perfil)'} &nbsp;<button onclick="this.closest('.modal-overlay').remove();abrirGestorPerfiles()" style="background:none;border:1px solid var(--verde);border-radius:8px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--verde);font-weight:700">Cambiar</button></div>
        <div><strong>Usuario:</strong> ${authEmail || (getModo()==='local' ? '— modo local' : 'No identificado')}</div>
        <div><strong>Modo:</strong> ${getModo()==='local'?'💾 Solo local':'☁️ Firebase ('+getUserId()+')'}</div>
        <div><strong>Estado:</strong> ${getModo()==='local'?'🔒 Sin nube':hasPending?'⚠️ Cambios pendientes':'✅ Todo sincronizado'}</div>
        <div><strong>Última sync:</strong> ${lastSync?new Date(lastSync).toLocaleString('es-ES'):'Nunca'}</div>
        <div><strong>Medicamentos:</strong> ${DB.get('meds',[]).length}</div>
      </div>
      ${getModo()==='firebase'?`
      <button class="btn-primary" onclick="syncToFirebase();this.closest('.modal-overlay').remove()">☁️ Subir a Firebase ahora</button>
      <button class="btn-primary" style="background:var(--azul);margin-top:8px" onclick="syncFromFirebase();this.closest('.modal-overlay').remove()">📥 Descargar de Firebase ahora</button>
      <hr style="margin:14px 0;border:none;border-top:1px solid #eee"/>
      `:''}
      <div style="font-size:13px;font-weight:900;color:var(--azul-oscuro);margin-bottom:6px">💾 Backup local (JSON)</div>
      <button class="btn-secondary" style="margin-top:0" onclick="exportarBackup();this.closest('.modal-overlay').remove()">📤 Exportar Backup completo</button>
      <button class="btn-secondary" style="margin-top:8px" onclick="importarBackup()">📥 Importar Backup</button>
      <input type="file" id="import-backup-input" accept=".json" style="display:none" onchange="procesarImportBackup(event)"/>
      <button class="btn-secondary" style="margin-top:16px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
      <button onclick="confirmarCerrarSesion()" style="width:100%;margin-top:8px;padding:11px;background:none;border:2px solid #e74c3c;border-radius:16px;color:#e74c3c;font-size:14px;font-weight:800;font-family:'Nunito',sans-serif;cursor:pointer">🚪 Cerrar sesión</button>
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

    // Intentar compartir nativo (Android), con fallback a descarga directa
    let compartido = false;
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], fname, {type:'application/json'});
        if (navigator.canShare({files:[file]})) {
          await navigator.share({files:[file], title:'Backup FaR-Rmacia'});
          compartido = true;
        }
      } catch(shareErr) {
        // Si falla el share (Permission denied, cancelado, etc.) → fallback descarga
        console.warn('Share falló, usando descarga:', shareErr.message);
      }
    }

    if (!compartido) {
      // Descarga directa (funciona en PC y móvil)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
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
    localStorage.setItem(dbKey('localModified'),new Date().toISOString());
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
  localStorage.setItem(dbKey('meds'),JSON.stringify([{id:1,nombre:'Ejemplo - Omeprazol 20mg',cantidad_bote:28,dosis_dia:1,stock_real:2,observaciones:'En ayunas',foto:'',fecha_inicio:'',incluir_pedido:1}]));
  localStorage.setItem(dbKey('nextId'),JSON.stringify(100));
  localStorage.setItem(dbKey('nextPedidoId'),JSON.stringify(1));
  localStorage.setItem(dbKey('notas'),JSON.stringify(''));
  localStorage.setItem(dbKey('citas'),JSON.stringify([]));
  localStorage.setItem(dbKey('historial_pedidos'),JSON.stringify([]));
  localStorage.setItem(dbKey('docs'),JSON.stringify([]));
  localStorage.setItem(dbKey('localModified'),new Date().toISOString());
}
function nextId() { const n=DB.get('nextId',100)+1; localStorage.setItem(dbKey('nextId'),JSON.stringify(n)); return n; }

// =============================================
// ===== PDF PEDIDO — jsPDF (móvil + PC) =======
// =============================================
// Usa jsPDF para generar un PDF real en el
// navegador, funciona en Android y PC.
// El PDF se descarga/abre directamente.
// =============================================
function esMobile() { return /Android|iPhone|iPad/i.test(navigator.userAgent); }

async function cargarJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function generarPDFPedido(numPedido, fecha, filas) {
  showToast('⏳ Generando PDF...', 'info');
  try {
    const jsPDF = await cargarJsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const verde  = [61, 170, 110];
    const azulO  = [26, 82, 118];
    const gris   = [120, 120, 120];
    const negro  = [34, 34, 34];
    const amarillo = [255, 253, 176];

    // ── Cabecera ──
    doc.setFillColor(...verde);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('FaR-Rmacia', 14, 10);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Resumen de Pedido a Farmacia', 14, 16);
    doc.text(fecha, 196, 10, { align: 'right' });
    doc.text('Impreso: ' + new Date().toLocaleString('es-ES'), 196, 16, { align: 'right' });

    // ── Nº Pedido ──
    doc.setTextColor(...azulO);
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('N\u00BA Pedido: ' + numPedido, 14, 30);
    doc.setDrawColor(...verde);
    doc.setLineWidth(0.5);
    doc.line(14, 32, 196, 32);

    // ── Tabla cabecera ──
    let y = 38;
    const cols = [70, 20, 22, 22, 52]; // anchos columnas
    const headers = ['Medicamento', 'Pedir', 'Stock', 'Total', 'Meses / D\u00edas'];
    const startX = 14;

    doc.setFillColor(...azulO);
    doc.rect(startX, y, 182, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    let cx = startX + 2;
    headers.forEach((h, i) => {
      doc.text(h, cx, y + 5.5);
      cx += cols[i];
    });

    // ── Filas ──
    y += 8;
    filas.forEach((f, idx) => {
      const rowH = 10;
      // Fondo alterno
      if (idx % 2 === 0) {
        doc.setFillColor(240, 250, 245);
        doc.rect(startX, y, 182, rowH, 'F');
      }
      // Fondo amarillo en columna "Pedir"
      doc.setFillColor(...amarillo);
      doc.rect(startX + cols[0], y, cols[1], rowH, 'F');

      doc.setTextColor(...negro);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');

      // Texto nombre (puede ser largo)
      const nomCorto = f.nombre.length > 32 ? f.nombre.substring(0, 30) + '...' : f.nombre;
      doc.text(nomCorto, startX + 2, y + 6.5);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...azulO);
      doc.text(String(f.qty), startX + cols[0] + cols[1]/2, y + 6.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...negro);
      doc.text(String(f.stockActual), startX + cols[0] + cols[1] + cols[2]/2, y + 6.5, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.text(String(f.stockTras), startX + cols[0] + cols[1] + cols[2] + cols[3]/2, y + 6.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...verde);
      doc.text(f.diasTras + ' d\u00edas | ' + f.mesesTras + ' mes.', startX + cols[0] + cols[1] + cols[2] + cols[3] + 2, y + 6.5);

      // Línea separadora
      doc.setDrawColor(213, 238, 226);
      doc.line(startX, y + rowH, startX + 182, y + rowH);
      y += rowH;
    });

    // ── Resumen ──
    y += 8;
    doc.setFillColor(240, 250, 245);
    doc.rect(startX, y, 182, 8 + filas.length * 7, 'F');
    doc.setDrawColor(...verde);
    doc.rect(startX, y, 182, 8 + filas.length * 7);
    doc.setTextColor(...azulO);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN', startX + 4, y + 6);
    y += 10;
    filas.forEach(f => {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...negro);
      const nom = f.nombre.length > 28 ? f.nombre.substring(0,26)+'...' : f.nombre;
      doc.text(`\u2022 ${nom}: pedir ${f.qty} bote(s) \u2192 ${f.diasTras} d\u00edas (${f.mesesTras} mes.)`, startX + 4, y);
      y += 7;
    });

    // ── Pie ──
    doc.setTextColor(...gris);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('FaR-Rmacia \u00b7 Gesti\u00f3n de medicamentos personales', 14, 285);
    doc.text(numPedido, 196, 285, { align: 'right' });

    // ── Guardar / compartir ──
    const pdfBlob = doc.output('blob');
    const pdfNombre = numPedido + '_resumen.pdf';

    if (esMobile() && navigator.share && navigator.canShare?.({ files: [new File([pdfBlob], pdfNombre, { type: 'application/pdf' })] })) {
      // Android: compartir el PDF directamente (WhatsApp, Drive, etc.)
      const file = new File([pdfBlob], pdfNombre, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: 'Pedido ' + numPedido });
    } else {
      // PC o móvil sin share: descargar (Android lo abre con el visor de PDF)
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url; a.download = pdfNombre;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      showToast('📄 PDF generado');
    }
  } catch (err) {
    console.error('PDF error:', err);
    showToast('⚠️ Error al generar PDF: ' + err.message, 'error');
  }
}

// ── Swipe / Scroll continuo tipo launcher ──
const NAV_SWIPE_ORDER=['menu','inventario','pedidos','citas','historial'];
let swipeStartX=0,swipeStartY=0,swipeDragging=false,swipeCurrentOffset=0;

function initSwipeGestures() {
  const c=document.getElementById('content');
  const wrapper=document.getElementById('screens-wrapper');
  if(!wrapper)return;

  c.addEventListener('touchstart',e=>{
    // No iniciar swipe si hay un overlay activo
    const overlayIds=['screen-historial-pedidos','screen-modificar','screen-medicamentos'];
    for(const id of overlayIds){const el=document.getElementById(id);if(el&&el.style.display!=='none')return;}
    swipeStartX=e.touches[0].clientX;
    swipeStartY=e.touches[0].clientY;
    swipeDragging=true;
    // Desactivar transición durante el drag
    wrapper.style.transition='none';
    const idx=NAV_SWIPE_ORDER.indexOf(currentScreen);
    swipeCurrentOffset=idx>=0?idx*window.innerWidth:0;
  },{passive:true});

  c.addEventListener('touchmove',e=>{
    if(!swipeDragging)return;
    const dx=e.touches[0].clientX-swipeStartX;
    const dy=e.touches[0].clientY-swipeStartY;
    // Si el movimiento es más vertical que horizontal, no hacer swipe
    if(Math.abs(dy)>Math.abs(dx)*1.5)return;
    const idx=NAV_SWIPE_ORDER.indexOf(currentScreen);
    if(idx<0)return;
    // Límites: no pasar del primer/último panel
    const maxOffset=(NAV_SWIPE_ORDER.length-1)*window.innerWidth;
    const raw=swipeCurrentOffset-dx;
    const clamped=Math.max(0,Math.min(maxOffset,raw));
    wrapper.style.transform=`translateX(-${clamped}px)`;
  },{passive:true});

  c.addEventListener('touchend',e=>{
    if(!swipeDragging)return;
    swipeDragging=false;
    // Reactivar transición
    wrapper.style.transition='transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    const dx=e.changedTouches[0].clientX-swipeStartX;
    const dy=e.changedTouches[0].clientY-swipeStartY;
    if(Math.abs(dx)<40||Math.abs(dx)<Math.abs(dy)*1.5){
      // Snap de vuelta a la posición actual
      const idx=NAV_SWIPE_ORDER.indexOf(currentScreen);
      if(idx>=0)wrapper.style.transform=`translateX(-${idx*window.innerWidth}px)`;
      return;
    }
    const idx=NAV_SWIPE_ORDER.indexOf(currentScreen);
    if(idx<0)return;
    if(dx<-40&&idx<NAV_SWIPE_ORDER.length-1) navigate(NAV_SWIPE_ORDER[idx+1]);
    else if(dx>40&&idx>0) navigate(NAV_SWIPE_ORDER[idx-1]);
    else{
      // Snap de vuelta
      wrapper.style.transform=`translateX(-${idx*window.innerWidth}px)`;
    }
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
// NAV_ORDER: las 5 pantallas del launcher horizontal
const NAV_ORDER=['menu','inventario','pedidos','citas','historial'];
// OVERLAY_SCREENS: se muestran encima (no en el carrusel)
const OVERLAY_SCREENS=['modificar','historial-pedidos','medicamentos'];
let currentScreen='menu',navHistory=[],editingCitaId=null,pedidoItems=[];

function navigate(screen) {
  if(currentScreen!==screen) navHistory.push(currentScreen);
  currentScreen=screen;

  // Cerrar todos los overlays
  ['screen-historial-pedidos','screen-modificar','screen-medicamentos'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  });

  const OVERLAYS=['historial-pedidos','modificar','medicamentos'];

  if(OVERLAYS.includes(screen)) {
    // Mostrar overlay encima del carrusel
    const el=document.getElementById('screen-'+screen);
    if(el){ el.style.display='block'; el.scrollTop=0; }
    _updateHeader(screen);
    _updateNav(screen==='medicamentos'?'inventario':screen);
    _updateFab(screen);
    _loadScreen(screen);
    return;
  }

  // ── Pantalla del carrusel ──
  const idxTarget = NAV_ORDER.indexOf(screen);
  if(idxTarget >= 0) _scrollToSlot(idxTarget);

  _updateHeader(screen);
  _updateNav(screen);
  _updateFab(screen);
  _loadScreen(screen);
}

function _scrollToSlot(idx) {
  const wrapper = document.getElementById('screens-wrapper');
  if(wrapper) {
    wrapper.style.transition='transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    wrapper.style.transform = `translateX(-${idx * 100}vw)`;
  }
}

function _updateHeader(screen) {
  const T={
    'menu':           {t:'💊 FaR-Rmacia',         s:'Tu farmacia personal', b:false},
    'inventario':     {t:'📦 Stock e Inventario',  s:'', b:true},
    'medicamentos':   {t:'💊 Nuevo Medicamento',   s:'', b:true},
    'pedidos':        {t:'🛒 Pedido Farmacia',      s:'', b:true},
    'citas':          {t:'📅 Citas Médicas',        s:'', b:true},
    'historial':      {t:'📁 Historial Médico',     s:'', b:true},
    'modificar':      {t:'✏️ Modificar',            s:'', b:true},
    'historial-pedidos':{t:'📜 Historial Pedidos', s:'', b:true}
  };
  const t=T[screen]||{t:'FaR-Rmacia',s:'',b:true};
  document.getElementById('header-title').textContent=t.t;
  document.getElementById('header-sub').textContent=t.s;
  document.getElementById('btn-back').classList.toggle('visible',t.b);
}

function _updateNav(screen) {
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===screen));
}

function _updateFab(screen) {
  const fab=document.getElementById('fab');
  if(['inventario','medicamentos','citas'].includes(screen)){fab.textContent='+';fab.classList.add('visible');}
  else fab.classList.remove('visible');
}

function _loadScreen(screen) {
  switch(screen){
    case'menu':          cargarCitasMini(); break;
    case'inventario':    renderInventario(); break;
    case'pedidos':       renderPedidos(); break;
    case'citas':         renderCitas(); break;
    case'historial':     cargarHistorial(); break;
    case'historial-pedidos': renderHistorialPedidos(); break;
    case'medicamentos':  fotoTemporal['f']=null;mostrarFotoPrev('f',null); break;
  }
}

function goBack(){
  const OVERLAYS=['historial-pedidos','modificar','medicamentos'];
  for(const s of OVERLAYS){
    const el=document.getElementById('screen-'+s);
    if(el&&el.style.display!=='none'){
      el.style.display='none';
      currentScreen=navHistory.length>0?navHistory.pop():'menu';
      if(navHistory.length>0)navHistory.pop();
      _updateHeader(currentScreen);
      _updateNav(currentScreen);
      _updateFab(currentScreen);
      return;
    }
  }
  if(navHistory.length>0){const p=navHistory.pop();navHistory.pop();navigate(p);}else navigate('menu');
}
function fabAction(){if(['inventario','medicamentos'].includes(currentScreen)){navigate('medicamentos');limpiarFormulario();}else if(currentScreen==='citas')document.getElementById('c-prof').focus();}
function actualizarReloj(){const a=new Date();document.getElementById('header-clock').innerHTML=`${String(a.getDate()).padStart(2,'0')} ${a.toLocaleString('es-ES',{month:'short'})} ${a.getFullYear()}<br>${String(a.getHours()).padStart(2,'0')}:${String(a.getMinutes()).padStart(2,'0')}`;}
function showToast(msg,type='success'){const t=document.getElementById('toast');t.textContent=msg;t.className='show '+type;setTimeout(()=>t.className='',2800);}
function confirmarCerrarSesion() {
  document.querySelector('.modal-overlay')?.remove();
  showConfirm('🚪 Cerrar sesión', '¿Seguro que quieres cerrar sesión? Tendrás que volver a introducir tu email y contraseña.', () => {
    cerrarSesion();
    mostrarPantallaLogin();
  });
}
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
function limpiarFormulario(){['f-nombre','f-bote','f-dosis','f-stock'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const obs=document.getElementById('f-obs');if(obs)obs.value='';const inc=document.getElementById('f-incluir');if(inc)inc.checked=true;fotoTemporal['f']=null;mostrarFotoPrev('f',null);}
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
  mo.innerHTML=`<div class="modal-sheet"><div class="modal-handle"></div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div class="modal-title" style="margin-bottom:0">📋 ${numPedido}</div><span style="font-size:11px;color:#999">${fecha}</span></div><p style="font-size:12px;color:#999;margin-bottom:10px">Resumen de Pedido a Farmacia</p>${tabla}<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px"><button class="btn-primary" style="margin-top:0;font-size:13px" id="btn-pdf-mo">📄 Generar PDF</button><button class="btn-primary" style="margin-top:0;background:var(--azul);font-size:13px" id="btn-comp-mo">📤 Compartir texto</button></div><button class="btn-secondary" style="margin-top:8px" onclick="this.closest('.modal-overlay').remove()">Cerrar</button></div>`;
  mo._filas=filas;document.body.appendChild(mo);
  document.getElementById('btn-pdf-mo').onclick=()=>generarPDFPedido(numPedido,fecha,filas);
  document.getElementById('btn-comp-mo').onclick=()=>{const txt=`PEDIDO ${numPedido}\n${fecha}\n\n`+filas.map(f=>`${f.nombre}: pedir ${f.qty} → total ${f.stockTras} (${f.diasTras} días / ${f.mesesTras} mes.)`).join('\n');if(navigator.share)navigator.share({title:'Pedido '+numPedido,text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copiado'));};
  mo.addEventListener('click',e=>{if(e.target===mo)mo.remove();});
}

// ── Historial Pedidos (expandible al tocar) ──
function renderHistorialPedidos(){
  const hist=[...DB.get('historial_pedidos',[])].reverse();
  const c=document.getElementById('historial-pedidos-list');
  if(!hist.length){c.innerHTML=`<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-text">No hay pedidos.</div></div>`;return;}
  const grupos={};
  hist.forEach(h=>{if(!grupos[h.num_pedido])grupos[h.num_pedido]={fecha:h.fecha,items:[]};grupos[h.num_pedido].items.push(h);});
  c.innerHTML=Object.entries(grupos).map(([numP,g])=>{
    const filas=g.items.map(it=>({nombre:it.medicamento,qty:it.botes_pedidos,stockActual:Math.round((it.botes_total-it.botes_pedidos)*10)/10,stockTras:Math.round(it.botes_total*10)/10,diasTras:it.dias_restantes_tras_pedido||0,mesesTras:((it.dias_restantes_tras_pedido||0)/30).toFixed(1)}));
    const tabla=`<table class="resumen-table"><thead><tr><th>Medicamento</th><th style="text-align:center">Pedir</th><th style="text-align:center">Stock</th><th style="text-align:center">Total</th><th>Meses/Días</th></tr></thead><tbody>${filas.map(f=>`<tr><td>${f.nombre}</td><td class="qty-cell">${f.qty}</td><td style="text-align:center">${f.stockActual}</td><td style="text-align:center;font-weight:900">${f.stockTras}</td><td class="dias-cell">${f.diasTras} días | ${f.mesesTras} mes.</td></tr>`).join('')}</tbody></table>`;
    const safeId=numP.replace(/[^a-zA-Z0-9]/g,'_');
    return `
    <div class="card" style="cursor:pointer" onclick="toggleHistorialDetalle('${safeId}')">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="font-size:15px;font-weight:900;color:var(--azul-oscuro)">📋 ${numP}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;color:#999">${g.fecha}</span>
          <span style="font-size:12px;font-weight:700;color:var(--verde)">${g.items.length} med.</span>
          <span id="flecha-${safeId}" style="font-size:16px;color:var(--gris-texto);transition:transform 0.25s">▼</span>
        </div>
      </div>
      <!-- Resumen expandible -->
      <div id="detalle-${safeId}" style="display:none;margin-top:12px;animation:fadeIn 0.2s">
        ${tabla}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:10px">
          <button class="btn-sm btn-sm-verde" onclick="event.stopPropagation();generarPDFPedidoHistorial('${numP}')">📄 PDF</button>
          <button class="btn-sm btn-sm-azul"  onclick="event.stopPropagation();compartirPedidoHistorial('${numP}')">📤 Compartir</button>
          <button class="btn-sm btn-sm-rojo"  onclick="event.stopPropagation();borrarPedidoHistorial('${numP}')">🗑️ Borrar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistorialDetalle(safeId){
  const det=document.getElementById('detalle-'+safeId);
  const flecha=document.getElementById('flecha-'+safeId);
  if(!det)return;
  const abierto=det.style.display!=='none';
  det.style.display=abierto?'none':'block';
  if(flecha)flecha.style.transform=abierto?'':'rotate(180deg)';
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
function cancelarEditarCita(){editingCitaId=null;['c-prof'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const obs=document.getElementById('c-obs');if(obs)obs.value='';document.getElementById('c-fecha').value=new Date().toISOString().split('T')[0];document.getElementById('c-hora').value='10:00';document.getElementById('citas-form-title').textContent='➕ Nueva Cita';document.getElementById('c-btn-guardar').textContent='➕ Añadir Cita';document.getElementById('c-btn-guardar').style.background='';document.getElementById('c-btn-cancelar').style.display='none';}
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
document.addEventListener('DOMContentLoaded', async () => {
  actualizarReloj();
  setInterval(actualizarReloj, 30000);

  // ── Si el perfil activo es LOCAL, saltar el login ──
  initPerfiles();
  if (getModo() === 'local') {
    await iniciarAppTrasLogin();
    return;
  }

  // ── Modo Firebase: comprobar si hay sesión guardada válida ──
  if (cargarSesionGuardada()) {
    // Sesión válida → entrar directamente
    await iniciarAppTrasLogin();
  } else {
    // Sin sesión → mostrar pantalla de login
    mostrarPantallaLogin();
  }
});
