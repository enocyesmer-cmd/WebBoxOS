// appRuntime.js – Gestión de aplicaciones web instaladas
// Requiere que `js/lib/jszip.min.js` (JSZip) esté cargado antes de usar esta API.
// Esta implementación usa IndexedDB para guardar metadatos y OPFS (Origin Private File System)
// para almacenar los archivos de cada app en un espacio aislado.

const APP_DB_NAME = 'webbox-apps';
const APP_STORE = 'apps';

/** Abre (o crea) la base de datos IndexedDB para apps */
function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(APP_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(APP_STORE)) {
        db.createObjectStore(APP_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda/actualiza los metadatos de una app */
export async function saveAppMeta(meta) {
  const db = await openAppDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_STORE, 'readwrite');
    tx.objectStore(APP_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Obtiene los metadatos de una app por id */
export async function getAppMeta(id) {
  const db = await openAppDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(APP_STORE).objectStore(APP_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Lista todas las apps instaladas */
export async function listApps() {
  const db = await openAppDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(APP_STORE).objectStore(APP_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** Elimina una app (metadatos + archivos OPFS) */
export async function uninstallApp(id) {
  // borrar del IndexedDB
  const db = await openAppDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(APP_STORE, 'readwrite');
    tx.objectStore(APP_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // borrar carpeta OPFS
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(id, { recursive: true });
  } catch (e) {
    console.warn('No se pudo borrar la carpeta OPFS de la app', id, e);
  }
}

/** Instala una app a partir de un archivo ZIP */
export async function installAppFromZip(file) {
  if (!window.JSZip) {
    throw new Error('JSZip library not loaded. Include js/lib/jszip.min.js before using installAppFromZip.');
  }
  const zip = await JSZip.loadAsync(file);
  // buscar app.json en la raíz del ZIP
  const appJsonFile = zip.file('app.json');
  if (!appJsonFile) {
    throw new Error('app.json no encontrado en el ZIP. El paquete debe contener un app.json en la raíz.');
  }
  const metaText = await appJsonFile.async('string');
  let meta;
  try {
    meta = JSON.parse(metaText);
  } catch (e) {
    throw new Error('app.json no es un JSON válido.');
  }
  // validar campos obligatorios
  const required = ['id', 'name', 'version', 'icon', 'color', 'entry'];
  for (const key of required) {
    if (!meta[key]) {
      throw new Error(`Campo obligatorio faltante en app.json: ${key}`);
    }
  }
  // preparar carpeta OPFS
  const root = await navigator.storage.getDirectory();
  const appDir = await root.getDirectoryHandle(meta.id, { create: true });
  // extraer archivos al OPFS (excluyendo app.json que ya está en meta)
  const entries = Object.keys(zip.files);
  for (const entryName of entries) {
    if (entryName.endsWith('/') || entryName === 'app.json') continue;
    const fileObj = zip.file(entryName);
    if (!fileObj) continue;
    const data = await fileObj.async('uint8array');
    // crear sub‑carpetas según sea necesario
    const parts = entryName.split('/');
    let dirHandle = appDir;
    for (let i = 0; i < parts.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }
  // guardar metadatos (marcamos como no favorito por defecto)
  const storedMeta = {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    icon: meta.icon,
    color: meta.color,
    entry: meta.entry,
    permissions: meta.permissions || [],
    favorite: false,
    installedAt: Date.now(),
  };
  await saveAppMeta(storedMeta);
  return storedMeta;
}

/** Lanza una app en un iframe aislado */
export async function launchApp(id) {
  const meta = await getAppMeta(id);
  if (!meta) throw new Error('App no encontrada: ' + id);
  // obtener handle del archivo de entrada
  const root = await navigator.storage.getDirectory();
  const appDir = await root.getDirectoryHandle(id);
  const entryHandle = await appDir.getFileHandle(meta.entry);
  const file = await entryHandle.getFile();
  const blob = new Blob([await file.arrayBuffer()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  // crear iframe overlay (el código del overlay está en ui.js, reutilizamos la API "overlay")
  // aquí solo devolvemos la URL; el caller será responsable de insertarlo.
  return url;
}

/** Cambia el estado de favorito */
export async function toggleFavorite(id) {
  const meta = await getAppMeta(id);
  if (!meta) return;
  meta.favorite = !meta.favorite;
  await saveAppMeta(meta);
  return meta.favorite;
}
