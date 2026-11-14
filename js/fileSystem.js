// fileSystem.js – Helpers for File System Access API with fallback to OPFS/IndexedDB
// Sólo lectura para la versión base; las operaciones CRUD se implementan más abajo.
// Documentación: https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API

// IndexedDB wrapper para almacenar manejadores (FileSystemDirectoryHandle/FileSystemFileHandle)
const DB_NAME = 'webbox-fs';
const STORE_NAME = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda un manejador serializable bajo una clave de ruta */
export async function saveHandle(path, handle) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({ path, handle });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Recupera un manejador previamente guardado */
export async function getHandle(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(path);
    req.onsuccess = () => resolve(req.result?.handle);
    req.onerror = () => reject(req.error);
  });
}

/** Elimina un manejador guardado (no elimina el archivo del equipo). */
export async function removeHandle(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Solicita al usuario una carpeta y la persiste */
export async function requestRootDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API no está disponible en este navegador.');
  }
  const handle = await window.showDirectoryPicker();
  // guardamos bajo la clave "root" para poder volver a abrirla sin preguntar
  await saveHandle('root', handle);
  return handle;
}

/** Obtiene la carpeta raíz persistida o pide una nueva */
export async function getRootDirectory() {
  let handle = await getHandle('root');
  if (handle) return handle;
  // si no está guardada, solicitar al usuario
  return await requestRootDirectory();
}

/** Lista entradas (archivos + carpetas) del directorio dado */
export async function listEntries(dirHandle) {
  const entries = [];
  for await (const [name, child] of dirHandle.entries()) {
    entries.push({ name, handle: child, kind: child.kind });
  }
  return entries;
}

/** Crea una subcarpeta */
export async function createFolder(parentHandle, name) {
  return await parentHandle.getDirectoryHandle(name, { create: true });
}

/** Renombra una entrada (solo posible mediante copiar‑borrar) */
export async function renameEntry(entryHandle, parentHandle, newName) {
  // Copiar el contenido (si es carpeta) o el archivo y luego eliminar el original
  if (entryHandle.kind === 'file') {
    const file = await entryHandle.getFile();
    const newHandle = await parentHandle.getFileHandle(newName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
  } else {
    // carpeta: crear nueva y copiar recursivamente
    const newDir = await parentHandle.getDirectoryHandle(newName, { create: true });
    await copyFolderRecursive(entryHandle, newDir);
  }
  // eliminar original
  await parentHandle.removeEntry(entryHandle.name);
}

/** Copia recursivamente el contenido de una carpeta */
async function copyFolderRecursive(srcHandle, dstHandle) {
  for await (const [name, child] of srcHandle.entries()) {
    if (child.kind === 'file') {
      const file = await child.getFile();
      const newFile = await dstHandle.getFileHandle(name, { create: true });
      const writable = await newFile.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } else {
      const newSub = await dstHandle.getDirectoryHandle(name, { create: true });
      await copyFolderRecursive(child, newSub);
    }
  }
}

/** Copia una entrada a otro directorio */
export async function copyEntry(entryHandle, targetDirHandle) {
  if (entryHandle.kind === 'file') {
    const file = await entryHandle.getFile();
    const newHandle = await targetDirHandle.getFileHandle(entryHandle.name, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
  } else {
    const newDir = await targetDirHandle.getDirectoryHandle(entryHandle.name, { create: true });
    await copyFolderRecursive(entryHandle, newDir);
  }
}

/** Mueve una entrada a otro directorio (copia + elimina) */
export async function moveEntry(entryHandle, srcParentHandle, targetDirHandle) {
  await copyEntry(entryHandle, targetDirHandle);
  await srcParentHandle.removeEntry(entryHandle.name, { recursive: entryHandle.kind === 'directory' });
}

/** Elimina una entrada (con confirmación externa) */
export async function deleteEntry(parentHandle, name, isDirectory) {
  await parentHandle.removeEntry(name, { recursive: isDirectory });
}

// Fallback simple para navegadores sin File System Access API: usar OPFS bajo "webbox-fallback"
export async function getFallbackRoot() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('webbox-fallback', { create: true });
}

export async function fallbackUploadFiles(files) {
  const dir = await getFallbackRoot();
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(await f.arrayBuffer());
    await writable.close();
  }
}
