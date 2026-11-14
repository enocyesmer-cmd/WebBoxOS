/**
 * Almacenamiento persistente del fondo personalizado de WebBox OS.
 * La imagen se guarda como Blob en IndexedDB, nunca como texto base64 en ajustes.
 */
const DB_NAME = 'webbox-backgrounds';
const DB_VERSION = 1;
const STORE_NAME = 'wallpapers';
const RECORD_KEY = 'custom';
const MAX_BACKGROUND_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador no permite guardar fondos personalizados.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('No se pudo abrir el almacenamiento de fondos.'));
    };
    request.onblocked = () => reject(new Error('Cierra otras pestañas de WebBox OS e inténtalo de nuevo.'));
  });
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el fondo.'));
    tx.onabort = () => reject(tx.error || new Error('El guardado del fondo fue cancelado.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo leer el fondo.'));
  });
}

/** Guarda una imagen raster para que siga disponible después de cerrar el navegador. */
export async function saveCustomBackground(file) {
  if (!(file instanceof Blob)) throw new Error('Selecciona una imagen válida.');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Formato no compatible. Usa JPG, PNG, WEBP, GIF, AVIF o BMP.');
  }
  if (file.size <= 0) throw new Error('La imagen está vacía.');
  if (file.size > MAX_BACKGROUND_SIZE) throw new Error('La imagen supera el límite de 20 MB.');

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({
    id: RECORD_KEY,
    blob: file,
    name: String(file.name || 'Fondo personalizado').slice(0, 180),
    type: file.type,
    updatedAt: Date.now(),
  });
  await transactionDone(tx);
}

/** Recupera el Blob del fondo personalizado, o null cuando aún no existe. */
export async function getCustomBackground() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const record = await requestResult(tx.objectStore(STORE_NAME).get(RECORD_KEY));
  return record?.blob instanceof Blob ? record.blob : null;
}
