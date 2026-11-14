/**
 * Almacenamiento persistente de los fondos personalizados de WebBox OS.
 * Cada imagen se guarda como Blob en IndexedDB (nunca como base64 en ajustes),
 * así que se pueden importar varios y siguen disponibles al reabrir el navegador.
 */
const DB_NAME = 'webbox-backgrounds';
const DB_VERSION = 1;
const STORE_NAME = 'wallpapers';
const LEGACY_KEY = 'custom'; // el único fondo que guardaba la versión anterior
const MAX_BACKGROUND_SIZE = 20 * 1024 * 1024;
const MAX_BACKGROUNDS = 30;
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

/** Valor de configuración que representa un fondo propio: "custom:<id>". */
export const customValue = (id) => `custom:${id}`;

/** Id de almacenamiento a partir del valor de configuración ("custom" antiguo o "custom:<id>"). */
export function customIdFromValue(value) {
  if (value === 'custom') return LEGACY_KEY;
  if (typeof value === 'string' && value.startsWith('custom:')) return value.slice(7);
  return null;
}

/** Guarda una imagen nueva y devuelve su id. */
export async function addBackground(file) {
  if (!(file instanceof Blob)) throw new Error('Selecciona una imagen válida.');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Formato no compatible. Usa JPG, PNG, WEBP, GIF, AVIF o BMP.');
  }
  if (file.size <= 0) throw new Error('La imagen está vacía.');
  if (file.size > MAX_BACKGROUND_SIZE) throw new Error('La imagen supera el límite de 20 MB.');

  const db = await openDb();
  const count = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count());
  if (count >= MAX_BACKGROUNDS) throw new Error(`Ya tienes ${MAX_BACKGROUNDS} fondos. Elimina alguno para agregar otro.`);

  const id = `bg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({
    id,
    blob: file,
    name: String(file.name || 'Fondo personalizado').slice(0, 180),
    type: file.type,
    updatedAt: Date.now(),
  });
  await transactionDone(tx);
  return id;
}

/** Todos los fondos propios, del más antiguo al más nuevo: [{ id, name, blob }]. */
export async function listBackgrounds() {
  const db = await openDb();
  const records = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  return records
    .filter((r) => r?.blob instanceof Blob)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .map(({ id, name, blob }) => ({ id, name, blob }));
}

/** Blob de un fondo propio, o null si ya no existe. */
export async function getBackground(id) {
  const db = await openDb();
  const record = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id));
  return record?.blob instanceof Blob ? record.blob : null;
}

/** Elimina un fondo propio. */
export async function deleteBackground(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}
