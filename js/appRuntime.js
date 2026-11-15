/**
 * Runtime de aplicaciones web instaladas (Parte 3).
 *
 * Un paquete es un ZIP con un app.json y los archivos de la app (HTML, CSS, JS, imágenes...).
 * Se guarda en IndexedDB, con un espacio de datos separado por aplicación, y se ejecuta en un
 * iframe aislado (ver appHost.js). También acepta:
 *   - un ZIP sin app.json pero con index.html (se deduce nombre e id del nombre del archivo),
 *   - un APK que en realidad es una web (Cordova/Capacitor): se extrae la carpeta web.
 *
 * Las funciones de la primera mitad son puras (sin DOM ni IndexedDB) y están probadas en Node.
 */
import { readZipDirectory, extractEntry, ZIP_LIMITS, safePath } from './core/zip.js';

export const PERMISSIONS = ['storage', 'input'];
export const APP_LIMITS = { name: 40, description: 120, version: 20 };
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_EXT = /\.(png|jpe?g|webp|svg|gif)$/i;
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', txt: 'text/plain',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', xml: 'application/xml',
};

export function mimeFor(path) {
  const ext = String(path).toLowerCase().split('.').pop();
  return MIME[ext] ?? 'application/octet-stream';
}

export function slugify(text) {
  const slug = String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug.length >= 2 ? slug : `app-${slug || 'x'}`.slice(0, 40);
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseName = (fileName) => String(fileName ?? 'app').replace(/\.[^.]+$/, '');

/**
 * Elige la carpeta raíz de la app dentro del paquete.
 * @param {string[]} paths rutas ya normalizadas
 * @returns {{ok:true, root:string, kind:'manifest'|'apk-web'|'index'}|{ok:false, error:string}}
 */
export function findPackageRoot(paths, fileName = '') {
  const clean = paths.filter((p) => !JUNK.test(p));
  const depth = (p) => p.split('/').length;
  const shallowest = (name) => clean.filter((p) => p.split('/').pop() === name && depth(p) <= 2).sort((a, b) => depth(a) - depth(b))[0];

  const manifest = shallowest('app.json');
  if (manifest) return { ok: true, root: dirOf(manifest), kind: 'manifest' };

  if (/\.apk$/i.test(fileName)) {
    for (const web of ['assets/www/index.html', 'assets/public/index.html']) {
      if (clean.includes(web)) return { ok: true, root: dirOf(web), kind: 'apk-web' };
    }
    return {
      ok: false,
      error: 'Este APK es una app de Android nativa (con código Android), no una web empaquetada: un navegador no puede ejecutarla. Solo se importan APK hechos con Cordova o Capacitor.',
    };
  }

  const index = shallowest('index.html');
  if (index) return { ok: true, root: dirOf(index), kind: 'index' };
  return { ok: false, error: 'El paquete no tiene app.json ni index.html en su carpeta principal.' };
}

/**
 * Valida y completa el manifiesto.
 * @param {unknown} raw contenido de app.json (o {} si se deduce)
 * @param {Set<string>} files rutas disponibles (relativas a la raíz)
 * @returns {{ok:true, manifest:object}|{ok:false, error:string}}
 */
export function validateManifest(raw, files, fallbackName = 'app') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'app.json debe ser un objeto JSON.' };
  const text = (value, max, label) => {
    if (value === undefined || value === null) return { value: '' };
    // eslint-disable-next-line no-control-regex
    if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return { error: `"${label}" debe ser texto sin caracteres de control.` };
    if (value.trim().length > max) return { error: `"${label}" admite como máximo ${max} caracteres.` };
    return { value: value.trim() };
  };

  const name = text(raw.name || fallbackName, APP_LIMITS.name, 'name');
  if (name.error) return { ok: false, error: name.error };
  if (!name.value) return { ok: false, error: 'Falta el nombre de la app ("name").' };
  const version = text(raw.version ?? '1.0', APP_LIMITS.version, 'version');
  if (version.error) return { ok: false, error: version.error };
  const description = text(raw.description, APP_LIMITS.description, 'description');
  if (description.error) return { ok: false, error: description.error };

  const id = raw.id === undefined ? slugify(name.value) : raw.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return { ok: false, error: '"id" debe tener 2 a 40 caracteres: minúsculas, números y guiones (por ejemplo "mi-juego").' };
  }

  const entry = safePath(raw.entry ?? 'index.html');
  if (!entry || !/\.html?$/i.test(entry)) return { ok: false, error: '"entry" debe ser un archivo .html dentro del paquete.' };
  if (!files.has(entry)) return { ok: false, error: `No se encuentra el archivo de entrada "${entry}" en el paquete.` };

  let icon = null;
  if (raw.icon !== undefined && raw.icon !== null && raw.icon !== '') {
    icon = safePath(raw.icon);
    if (!icon || !ICON_EXT.test(icon) || !files.has(icon)) return { ok: false, error: '"icon" debe ser una imagen (png, jpg, svg, webp) incluida en el paquete.' };
  }

  const color = raw.color === undefined ? '#334155' : raw.color;
  if (typeof color !== 'string' || !COLOR_RE.test(color)) return { ok: false, error: '"color" debe ser un color como #1e3a8a.' };

  const permissions = raw.permissions === undefined ? ['storage'] : raw.permissions;
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSIONS.includes(p))) {
    return { ok: false, error: `"permissions" solo admite: ${PERMISSIONS.join(', ')}.` };
  }

  const input = raw.input === undefined ? 'launcher' : raw.input;
  if (!['launcher', 'app'].includes(input)) return { ok: false, error: '"input" debe ser "launcher" o "app".' };

  return {
    ok: true,
    manifest: { id, name: name.value, version: version.value, description: description.value, entry, icon, color, permissions: [...new Set(permissions)], input },
  };
}

/** Mezcla un color con blanco para el segundo tono del degradado de la casilla. */
export function lighten(hex, amount = 0.35) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Lee un paquete, lo valida y devuelve sus archivos listos para guardar.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} fileName nombre del .zip/.apk (para deducir id y nombre si no hay app.json)
 * @returns {Promise<{manifest:object, source:string, files:Map<string,Uint8Array>, bytes:number}>}
 */
export async function readPackage(buffer, fileName = 'app.zip') {
  const entries = readZipDirectory(buffer).filter((e) => !e.isDir && e.path && !JUNK.test(e.path));
  const found = findPackageRoot(entries.map((e) => e.path), fileName);
  if (!found.ok) throw new Error(found.error);

  const prefix = found.root ? `${found.root}/` : '';
  const inRoot = entries.filter((e) => e.path.startsWith(prefix));
  const total = inRoot.reduce((sum, e) => sum + e.size, 0);
  if (total > ZIP_LIMITS.totalBytes) throw new Error(`El paquete es demasiado grande (máximo ${Math.round(ZIP_LIMITS.totalBytes / 1048576)} MB descomprimido).`);

  const files = new Map();
  for (const e of inRoot) files.set(e.path.slice(prefix.length), await extractEntry(buffer, e));

  let raw = {};
  if (found.kind === 'manifest') {
    try {
      raw = JSON.parse(new TextDecoder('utf-8').decode(files.get('app.json')));
    } catch {
      throw new Error('app.json no es un JSON válido.');
    }
  }
  const pretty = baseName(fileName).replace(/[-_]+/g, ' ').trim();
  const checked = validateManifest(raw, new Set(files.keys()), pretty || 'Mi app');
  if (!checked.ok) throw new Error(checked.error);
  return { manifest: checked.manifest, source: found.kind, files, bytes: total };
}

// ===========================================================================
// Almacenamiento (IndexedDB). Solo en el navegador.
// ===========================================================================

const DB_NAME = 'webbox-apps';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('apps')) db.createObjectStore('apps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Se canceló la operación.'));
});
const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const fileKey = (id, path) => `${id}\u0000${path}`;
const range = (id) => IDBKeyRange.bound(`${id}\u0000`, `${id}\u0001`, false, true);

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function listApps() {
  const db = await openDb();
  const apps = await result(db.transaction('apps').objectStore('apps').getAll());
  db.close();
  return apps.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function getApp(id) {
  const db = await openDb();
  const app = await result(db.transaction('apps').objectStore('apps').get(id));
  db.close();
  return app ?? null;
}

/**
 * Instala (o actualiza) un paquete.
 * @returns {Promise<{app:object, updated:boolean}>}
 */
export async function installPackage(buffer, fileName) {
  const pkg = await readPackage(buffer, fileName);
  const { manifest } = pkg;

  let icon = null;
  if (manifest.icon) {
    const blob = new Blob([pkg.files.get(manifest.icon)], { type: mimeFor(manifest.icon) });
    if (blob.size <= 400 * 1024) icon = await blobToDataUrl(blob);
  }

  const db = await openDb();
  try {
    const previous = await result(db.transaction('apps').objectStore('apps').get(manifest.id));
    const tx = db.transaction(['apps', 'files'], 'readwrite');
    const files = tx.objectStore('files');
    files.delete(range(manifest.id)); // al actualizar se reemplazan todos los archivos
    for (const [path, bytes] of pkg.files) {
      files.put({ key: fileKey(manifest.id, path), id: manifest.id, path, blob: new Blob([bytes], { type: mimeFor(path) }) });
    }
    const now = Date.now();
    const app = {
      ...manifest,
      icon,
      source: pkg.source,
      size: pkg.bytes,
      fileCount: pkg.files.size,
      favorite: previous?.favorite ?? false,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
    };
    tx.objectStore('apps').put(app);
    await done(tx);
    return { app, updated: Boolean(previous) };
  } finally {
    db.close();
  }
}

export async function uninstallApp(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(['apps', 'files', 'data'], 'readwrite');
    tx.objectStore('apps').delete(id);
    tx.objectStore('files').delete(range(id));
    tx.objectStore('data').delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function setFavorite(id, favorite) {
  const db = await openDb();
  try {
    const tx = db.transaction('apps', 'readwrite');
    const store = tx.objectStore('apps');
    const app = await result(store.get(id));
    if (app) store.put({ ...app, favorite: Boolean(favorite) });
    await done(tx);
  } finally {
    db.close();
  }
}

/** @returns {Promise<Map<string, Blob>>} ruta -> contenido */
export async function readAppFiles(id) {
  const db = await openDb();
  const rows = await result(db.transaction('files').objectStore('files').getAll(range(id)));
  db.close();
  return new Map(rows.map((r) => [r.path, r.blob]));
}

export async function loadAppData(id) {
  const db = await openDb();
  const row = await result(db.transaction('data').objectStore('data').get(id));
  db.close();
  return row?.values && typeof row.values === 'object' ? row.values : {};
}

const MAX_DATA_BYTES = 2 * 1024 * 1024;

/** Guarda los datos de la app (clave -> texto). Límite de 2 MB por app. */
export async function saveAppData(id, values) {
  const clean = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value !== 'string') continue;
    bytes += key.length + value.length;
    clean[String(key).slice(0, 200)] = value;
  }
  if (bytes > MAX_DATA_BYTES) throw new Error('La app superó el límite de datos guardados (2 MB).');
  const db = await openDb();
  try {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put({ id, values: clean });
    await done(tx);
  } finally {
    db.close();
  }
}
