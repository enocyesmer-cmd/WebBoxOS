// fileSystem.js – almacenamiento local para WebBox OS.
// Usa File System Access API cuando el usuario elige una carpeta del equipo.
// Si no está disponible, usa OPFS y, como último recurso, IndexedDB.

const DB_NAME = 'webbox-fs';
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const NODE_STORE = 'nodes';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(NODE_STORE)) {
        db.createObjectStore(NODE_STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => reject(new Error('Cierra otras pestañas de WebBox OS para actualizar el almacenamiento.'));
  });
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('La operación de almacenamiento fue cancelada.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda un manejador o una referencia interna bajo una clave persistente. */
export async function saveHandle(path, handle) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).put({ path, handle });
  await transactionDone(tx);
}

/** Recupera un manejador o una referencia interna previamente guardada. */
export async function getHandle(path) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readonly');
  const record = await requestResult(tx.objectStore(HANDLE_STORE).get(path));
  return record?.handle;
}

/** Elimina una referencia persistida, sin borrar el archivo de origen. */
export async function removeHandle(path) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).delete(path);
  await transactionDone(tx);
}

export function supportsFileSystemAccess() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Permite elegir una carpeta real del equipo. */
export async function requestRootDirectory() {
  if (!supportsFileSystemAccess()) {
    throw new Error('Este navegador no permite abrir carpetas del equipo. Usa el almacenamiento interno.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const root = { backend: 'native', handle, name: handle.name || 'Carpeta', path: '/', kind: 'directory' };
  await saveHandle('root', handle);
  return root;
}

/** Abre el almacenamiento privado de WebBox OS (OPFS o IndexedDB). */
export async function requestInternalDirectory() {
  try {
    if (navigator.storage?.getDirectory) {
      const storageRoot = await navigator.storage.getDirectory();
      const handle = await storageRoot.getDirectoryHandle('WebBox OS', { create: true });
      return { backend: 'opfs', handle, name: 'Almacenamiento interno', path: '/', kind: 'directory' };
    }
  } catch (error) {
    console.warn('[WebBox OS] OPFS no disponible; se usará IndexedDB.', error);
  }
  await openDb();
  return { backend: 'idb', handle: null, name: 'Almacenamiento interno', path: '/', kind: 'directory' };
}

/** Obtiene una raíz local previamente guardada, cuando el navegador lo permite. */
export async function getRootDirectory() {
  const handle = await getHandle('root');
  return handle
    ? { backend: 'native', handle, name: handle.name || 'Carpeta', path: '/', kind: 'directory' }
    : null;
}

function directoryHandle(directory) {
  if (!directory || !['native', 'opfs'].includes(directory.backend) || !directory.handle) {
    throw new Error('La carpeta seleccionada no está disponible.');
  }
  return directory.handle;
}

function joinPath(parentPath, name, kind) {
  const base = parentPath === '/' ? '/' : `${parentPath.replace(/\/$/, '')}/`;
  return `${base}${name}${kind === 'directory' ? '/' : ''}`;
}

function validateName(name) {
  const value = String(name ?? '').trim();
  if (!value) throw new Error('Escribe un nombre.');
  if (value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error('El nombre no puede contener / ni \\ y no puede ser . o ...');
  }
  return value;
}

async function idbNodes() {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readonly');
  return requestResult(tx.objectStore(NODE_STORE).getAll());
}

async function idbGetNode(path) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readonly');
  return requestResult(tx.objectStore(NODE_STORE).get(path));
}

async function idbPutNode(node) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readwrite');
  tx.objectStore(NODE_STORE).put(node);
  await transactionDone(tx);
}

async function idbDeletePath(path, recursive = false) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readwrite');
  const store = tx.objectStore(NODE_STORE);
  const done = transactionDone(tx);
  if (recursive) {
    const request = store.getAll();
    request.onsuccess = () => {
      for (const node of request.result) {
        if (node.path === path || node.path.startsWith(path)) store.delete(node.path);
      }
    };
  } else {
    store.delete(path);
  }
  await done;
}

/** Lista los elementos de una carpeta en cualquiera de los tres almacenamientos. */
export async function listEntries(directory) {
  if (directory.backend === 'idb') {
    const nodes = await idbNodes();
    return nodes
      .filter((node) => node.parentPath === directory.path)
      .map((node) => ({ ...node, backend: 'idb', parent: directory, handle: null }));
  }

  const entries = [];
  const handle = directoryHandle(directory);
  for await (const [name, child] of handle.entries()) {
    const kind = child.kind;
    entries.push({
      name,
      handle: child,
      kind,
      backend: directory.backend,
      parent: directory,
      path: joinPath(directory.path, name, kind),
    });
  }
  return entries;
}

/** Comprueba que el nombre no exista en el destino. */
async function ensureNameAvailable(directory, name) {
  const entries = await listEntries(directory);
  if (entries.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error(`Ya existe un elemento llamado "${name}".`);
  }
}

/** Crea una subcarpeta. */
export async function createFolder(parent, name) {
  const safeName = validateName(name);
  await ensureNameAvailable(parent, safeName);
  if (parent.backend === 'idb') {
    const path = joinPath(parent.path, safeName, 'directory');
    await idbPutNode({ path, parentPath: parent.path, name: safeName, kind: 'directory' });
    return { backend: 'idb', path, name: safeName, kind: 'directory', parent, handle: null };
  }
  const handle = await directoryHandle(parent).getDirectoryHandle(safeName, { create: true });
  return {
    backend: parent.backend,
    handle,
    path: joinPath(parent.path, safeName, 'directory'),
    name: safeName,
    kind: 'directory',
    parent,
  };
}

/** Escribe un archivo en un directorio, conservando su contenido. */
export async function writeFile(parent, name, file) {
  const safeName = validateName(name);
  await ensureNameAvailable(parent, safeName);
  if (parent.backend === 'idb') {
    const path = joinPath(parent.path, safeName, 'file');
    const blob = file instanceof Blob ? file : new Blob([file]);
    await idbPutNode({
      path,
      parentPath: parent.path,
      name: safeName,
      kind: 'file',
      blob,
      size: blob.size,
      type: blob.type || file.type || '',
      lastModified: file.lastModified || Date.now(),
    });
    return { backend: 'idb', path, name: safeName, kind: 'file', parent, handle: null };
  }
  const handle = await directoryHandle(parent).getFileHandle(safeName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return {
    backend: parent.backend,
    handle,
    path: joinPath(parent.path, safeName, 'file'),
    name: safeName,
    kind: 'file',
    parent,
  };
}

/** Devuelve un objeto File desde una entrada del explorador. */
export async function getEntryFile(entry) {
  if (entry.backend === 'idb') {
    const node = await idbGetNode(entry.path);
    if (!node?.blob) throw new Error('El archivo ya no existe en el almacenamiento interno.');
    return new File([node.blob], node.name, {
      type: node.type || node.blob.type || '',
      lastModified: node.lastModified || Date.now(),
    });
  }
  return entry.handle.getFile();
}

/** Recupera un archivo guardado en Películas. */
export async function getStoredFile(reference) {
  if (reference?.backend === 'idb') {
    return getEntryFile(reference);
  }
  if (reference?.getFile) return reference.getFile();
  throw new Error('No se encontró el archivo guardado. Vuelve a agregarlo desde Archivos.');
}

/** Sube archivos al almacenamiento interno; acepta rutas relativas de carpetas. */
export async function uploadFiles(root, files) {
  let uploaded = 0;
  for (const file of files) {
    const relative = String(file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const parts = relative.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let directory = root;
    for (const folderName of parts) {
      const existing = (await listEntries(directory)).find(
        (entry) => entry.kind === 'directory' && entry.name === folderName,
      );
      directory = existing
        ? { backend: existing.backend, handle: existing.handle, path: existing.path, name: existing.name, kind: 'directory' }
        : await createFolder(directory, folderName);
    }
    await writeFile(directory, fileName, file);
    uploaded += 1;
  }
  return uploaded;
}

async function copyNode(entry, targetDirectory, targetName = entry.name) {
  if (entry.kind === 'file') {
    const file = await getEntryFile(entry);
    await writeFile(targetDirectory, targetName, file);
    return;
  }
  const newDirectory = await createFolder(targetDirectory, targetName);
  const children = await listEntries({
    backend: entry.backend,
    handle: entry.handle,
    path: entry.path,
    name: entry.name,
    kind: 'directory',
  });
  for (const child of children) await copyNode(child, newDirectory);
}

/** Copia un archivo o carpeta completa al directorio de destino. */
export async function copyEntry(entry, targetDirectory, targetName = entry.name, autoRename = false) {
  if (entry.kind === 'directory'
      && entry.backend === targetDirectory.backend
      && targetDirectory.path.startsWith(entry.path)) {
    throw new Error('No puedes copiar una carpeta dentro de sí misma.');
  }
  let safeName = validateName(targetName);
  if (autoRename) {
    const names = new Set((await listEntries(targetDirectory)).map((item) => item.name.toLocaleLowerCase()));
    if (names.has(safeName.toLocaleLowerCase())) {
      const dot = entry.kind === 'file' ? safeName.lastIndexOf('.') : -1;
      const base = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : '';
      let number = 1;
      while (names.has(`${base} (copia${number > 1 ? ` ${number}` : ''})${ext}`.toLocaleLowerCase())) number += 1;
      safeName = `${base} (copia${number > 1 ? ` ${number}` : ''})${ext}`;
    }
  } else {
    await ensureNameAvailable(targetDirectory, safeName);
  }
  await copyNode(entry, targetDirectory, safeName);
}

/** Elimina una entrada del directorio indicado. */
export async function deleteEntry(parent, entry) {
  if (parent.backend === 'idb') {
    await idbDeletePath(entry.path, entry.kind === 'directory');
    return;
  }
  await directoryHandle(parent).removeEntry(entry.name, { recursive: entry.kind === 'directory' });
}

/** Renombra mediante copia + borrado para mantener compatibilidad entre backends. */
export async function renameEntry(entry, parent, newName) {
  const safeName = validateName(newName);
  if (safeName === entry.name) return;
  await copyEntry(entry, parent, safeName);
  await deleteEntry(parent, entry);
}

/** Mueve una entrada entre carpetas, incluso entre almacenamiento interno y equipo. */
export async function moveEntry(entry, sourceParent, targetDirectory) {
  if (sourceParent.backend === targetDirectory.backend && sourceParent.path === targetDirectory.path) {
    throw new Error('El destino ya es la carpeta actual.');
  }
  if (entry.kind === 'directory'
      && entry.backend === targetDirectory.backend
      && targetDirectory.path.startsWith(entry.path)) {
    throw new Error('No puedes mover una carpeta dentro de sí misma.');
  }
  await copyEntry(entry, targetDirectory);
  await deleteEntry(sourceParent, entry);
}
