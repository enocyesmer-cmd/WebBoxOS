/**
 * Construye el documento (srcdoc) con el que se ejecuta una app instalada.
 *
 * La app corre en un iframe SIN "allow-same-origin" (origen opaco): no puede leer el
 * localStorage, IndexedDB, cookies ni la sesión de WebBox OS. Ese iframe tampoco puede pedir
 * archivos "relativos" a un servidor ni cargar URL blob: de la página principal, así que el
 * HTML se reescribe: los CSS se incrustan, y scripts, imágenes, audio y video apuntan a URL
 * data: creadas a partir de los archivos del paquete. También se inyecta un pequeño script
 * (shim) que:
 *   - hace que fetch/XMLHttpRequest/Image con rutas relativas encuentren los archivos del paquete
 *     (los grandes se piden a WebBox OS por mensajes, sin cargarlos todos en memoria),
 *   - ofrece localStorage/sessionStorage (guardado por app) y la API window.WebBox.
 *
 * Límites conocidos: los módulos ES (<script type="module"> con import relativos) y las páginas
 * HTML enlazadas entre sí no funcionan (la app debe ser una sola página; se puede empaquetar con
 * Vite, esbuild o similar); un archivo de más de 8 MB enlazado directamente desde el HTML
 * (por ejemplo un video) no se carga: hay que pedirlo con fetch().
 */

/** Tope por archivo y total para convertir a URL data: */
export const INLINE_LIMITS = { file: 8 * 1024 * 1024, total: 48 * 1024 * 1024, dynamic: 512 * 1024 };

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Ruta dentro del paquete a la que apunta `ref` (relativa a `fromDir`), o null si es externa/inválida. */
export function resolveRef(ref, fromDir = '') {
  const raw = String(ref ?? '').trim();
  if (!raw || raw.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;
  let path = raw.split('#')[0].split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* se usa tal cual */
  }
  const joined = path.startsWith('/') ? path.slice(1) : fromDir ? `${fromDir}/${path}` : path;
  const out = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}

/** Script que se inyecta al principio de la app. Se escribe en ES5 a propósito. */
export function shimSource(cfg) {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  return `(function () {
  var CFG = ${json};
  var W = window, P = W.parent;
  function send(m) { m.wbx = 1; try { P.postMessage(m, '*'); } catch (e) {} }

  // ---- localStorage / sessionStorage (en un iframe aislado los nativos lanzan error)
  var data = CFG.data || {}, timer = 0;
  function persist() { if (CFG.persist && !timer) timer = setTimeout(function () { timer = 0; send({ type: 'store', values: data }); }, 400); }
  function makeStorage(shared) {
    var mem = shared ? data : {};
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[String(k)] = String(v); if (shared) persist(); },
      removeItem: function (k) { delete mem[String(k)]; if (shared) persist(); },
      clear: function () { for (var k in mem) delete mem[k]; if (shared) persist(); },
      key: function (i) { return Object.keys(mem)[i] || null; }
    };
    return new Proxy(api, {
      get: function (t, k) { if (k === 'length') return Object.keys(mem).length; return k in t ? t[k] : t.getItem(k); },
      set: function (t, k, v) { t.setItem(k, v); return true; },
      deleteProperty: function (t, k) { t.removeItem(k); return true; },
      has: function (t, k) { return k in t || t.getItem(k) !== null; },
      ownKeys: function () { return Object.keys(mem); },
      getOwnPropertyDescriptor: function (t, k) { return k in mem ? { value: mem[k], enumerable: true, configurable: true, writable: true } : undefined; }
    });
  }
  var ls = makeStorage(true), ss = makeStorage(false);
  try { Object.defineProperty(W, 'localStorage', { configurable: true, get: function () { return ls; } }); } catch (e) {}
  try { Object.defineProperty(W, 'sessionStorage', { configurable: true, get: function () { return ss; } }); } catch (e) {}

  // ---- archivos del paquete: fetch, XMLHttpRequest y src de Image/Audio/Video
  var files = CFG.files || {}, all = CFG.all || {}, base = CFG.base || '';
  function key(u) {
    u = String(u);
    if (/^([a-z][a-z0-9+.-]*:|\\/\\/)/i.test(u)) return null;
    var p = u.split('#')[0].split('?')[0];
    try { p = decodeURIComponent(p); } catch (e) {}
    var parts = (p.charAt(0) === '/' ? p.slice(1) : (base ? base + '/' : '') + p).split('/'), out = [];
    for (var i = 0; i < parts.length; i++) { if (!parts[i] || parts[i] === '.') continue; if (parts[i] === '..') out.pop(); else out.push(parts[i]); }
    return out.join('/');
  }
  function find(u) { var k = key(u); return k && files[k] ? files[k] : null; }
  var pending = {}, nextId = 1;
  function request(path) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ type: 'file', id: id, path: path });
    });
  }
  var realFetch = W.fetch;
  if (realFetch) W.fetch = function (input, init) {
    if (typeof input === 'string') {
      var k = key(input);
      if (k && files[k]) return realFetch.call(this, files[k], init);
      if (k && all[k]) return request(k).then(function (r) { return new Response(r.buffer, { status: 200, headers: { 'Content-Type': r.mime || 'application/octet-stream' } }); });
    }
    return realFetch.call(this, input, init);
  };
  var realOpen = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open;
  if (realOpen) W.XMLHttpRequest.prototype.open = function (method, url) { var m = find(url); var a = [].slice.call(arguments); if (m) a[1] = m; return realOpen.apply(this, a); };
  function patchSrc(proto) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, 'src');
    if (d && d.set) Object.defineProperty(proto, 'src', { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, find(v) || v); } });
  }
  patchSrc(W.HTMLImageElement && W.HTMLImageElement.prototype);
  patchSrc(W.HTMLMediaElement && W.HTMLMediaElement.prototype);
  patchSrc(W.HTMLScriptElement && W.HTMLScriptElement.prototype);

  // ---- API de WebBox OS para las apps
  var inputs = [];
  W.addEventListener('message', function (e) {
    if (e.source !== P) return;
    var m = e.data;
    if (m && m.wbx === 1 && m.type === 'file' && pending[m.id]) {
      var w = pending[m.id]; delete pending[m.id];
      if (m.buffer) w.resolve(m); else w.reject(new TypeError('No se encontró el archivo'));
      return;
    }
    if (!m || m.wbx !== 1 || m.type !== 'input') return;
    for (var i = 0; i < inputs.length; i++) { try { inputs[i](m.action); } catch (err) {} }
    try { W.dispatchEvent(new CustomEvent('webbox:input', { detail: { action: m.action } })); } catch (err) {}
  });
  W.WebBox = {
    version: 1,
    app: { id: CFG.id, name: CFG.name },
    exit: function () { send({ type: 'exit' }); },
    notify: function (text) { send({ type: 'notify', text: String(text).slice(0, 120) }); },
    onInput: function (fn) { if (typeof fn === 'function') inputs.push(fn); },
    storage: {
      get: function (k) { return ls.getItem(k); },
      set: function (k, v) { ls.setItem(k, v); },
      remove: function (k) { ls.removeItem(k); }
    }
  };

  // ---- Esc cierra la app (salvo que declare "input": "app" y gestione sus propias teclas)
  if (CFG.input === 'launcher') W.addEventListener('keydown', function (e) { if (e.key === 'Escape') send({ type: 'exit' }); }, true);
  W.addEventListener('load', function () { send({ type: 'ready' }); });
})();`;
}

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g;

function toDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {{app:object, files:Map<string,Blob>, data:Record<string,string>}} input
 * @returns {Promise<{html:string, revoke:()=>void}>}
 */
export async function buildAppDocument({ app, files, data }) {
  const entryBlob = files.get(app.entry);
  if (!entryBlob) throw new Error('Falta el archivo de entrada de la app.');

  let budget = INLINE_LIMITS.total;
  const cache = new Map();
  /** URL data: del archivo (o null si no existe, es muy grande o se acabó el presupuesto). */
  const dataUrlFor = async (path, limit = INLINE_LIMITS.file) => {
    const blob = files.get(path);
    if (!blob || blob.size > limit || blob.size > budget) return null;
    if (!cache.has(path)) {
      budget -= blob.size;
      cache.set(path, toDataUrl(blob));
    }
    return cache.get(path);
  };

  const replaceAsync = async (text, regex, fn) => {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(regex)) {
      parts.push(text.slice(last, m.index), await fn(m));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return parts.join('');
  };

  const rewriteUrls = (css, dir) =>
    replaceAsync(css, URL_RE, async (m) => {
      const path = resolveRef(m[2], dir);
      const url = path && (await dataUrlFor(path));
      return url ? `url("${url}")` : m[0];
    });

  async function cssText(path, depth = 0) {
    let css = await files.get(path).text();
    const dir = dirOf(path);
    if (depth < 3) {
      css = await replaceAsync(css, IMPORT_RE, async (m) => {
        const target = resolveRef(m[2], dir);
        return target && files.has(target) ? cssText(target, depth + 1) : m[0];
      });
    }
    return rewriteUrls(css, dir);
  }

  const doc = new DOMParser().parseFromString(await entryBlob.text(), 'text/html');
  const entryDir = dirOf(app.entry);
  const local = (ref) => {
    const path = resolveRef(ref, entryDir);
    return path && files.has(path) ? path : null;
  };

  // Hojas de estilo: se incrustan (así sus url() también quedan resueltas).
  for (const link of [...doc.querySelectorAll('link[href]')]) {
    const path = local(link.getAttribute('href'));
    if (!path) continue;
    if ((link.getAttribute('rel') || '').toLowerCase().includes('stylesheet')) {
      const style = doc.createElement('style');
      if (link.getAttribute('media')) style.setAttribute('media', link.getAttribute('media'));
      style.textContent = await cssText(path);
      link.replaceWith(style);
    } else {
      const url = await dataUrlFor(path);
      if (url) link.setAttribute('href', url);
    }
  }
  for (const el of doc.querySelectorAll('[src]')) {
    if (el.tagName === 'IFRAME') continue;
    const path = local(el.getAttribute('src'));
    const url = path && (await dataUrlFor(path));
    if (url) el.setAttribute('src', url);
  }
  for (const el of doc.querySelectorAll('video[poster]')) {
    const path = local(el.getAttribute('poster'));
    const url = path && (await dataUrlFor(path));
    if (url) el.setAttribute('poster', url);
  }
  for (const el of doc.querySelectorAll('[srcset]')) {
    const list = [];
    for (const item of el.getAttribute('srcset').split(',')) {
      const [ref, ...rest] = item.trim().split(/\s+/);
      const path = local(ref);
      list.push([(path && (await dataUrlFor(path))) || ref, ...rest].join(' '));
    }
    el.setAttribute('srcset', list.join(', '));
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = await rewriteUrls(style.textContent, entryDir);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', await rewriteUrls(el.getAttribute('style'), entryDir));

  // Archivos pequeños disponibles de inmediato para fetch/Image; el resto, por mensajes.
  const fileMap = {};
  const all = {};
  for (const [path, blob] of files) {
    all[path] = 1;
    if (blob.size <= INLINE_LIMITS.dynamic) {
      const url = await dataUrlFor(path, INLINE_LIMITS.dynamic);
      if (url) fileMap[path] = url;
    }
  }
  const shim = doc.createElement('script');
  shim.textContent = shimSource({
    id: app.id,
    name: app.name,
    input: app.input,
    persist: app.permissions.includes('storage'),
    data: data ?? {},
    base: entryDir,
    files: fileMap,
    all,
  });
  doc.head.insertBefore(shim, doc.head.firstChild);

  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, revoke: () => {} };
}
