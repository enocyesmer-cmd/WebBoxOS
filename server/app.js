/**
 * Manejador HTTP de WebBox OS: API del catálogo (/api/...) + archivos estáticos.
 * Solo usa módulos de Node: no necesita Express.
 *
 *   GET    /api/health          estado del servidor (público)
 *   GET    /api/items[?kind=]   catálogo (público)
 *   GET    /api/auth            comprueba la clave de administrador
 *   POST   /api/items           agrega un elemento      (clave de administrador)
 *   DELETE /api/items/:id       elimina un elemento     (clave de administrador)
 *
 * La clave se envía en la cabecera X-Admin-Key.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { validateItem, KINDS } from './validate.js';
import { DuplicateError } from './store/errors.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FAILED_KEYS = 5; // intentos con clave incorrecta...
const LOCK_MS = 60_000; // ...antes de bloquear la IP durante un minuto

/**
 * Solo se sirven estas rutas de primer nivel. Todo lo demás (server/, database/,
 * tests/, tools/, .env, .git, node_modules, JUEGOS/ ...) da 404 aunque exista.
 * Es una lista blanca a propósito: es más segura que una lista de prohibidos.
 */
const PUBLIC_TOP_LEVEL = new Set(['index.html', 'manifest.json', 'css', 'js', 'assets']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.toLowerCase().includes('application/json')) {
      reject(new HttpError(415, 'El contenido debe ser application/json.'));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return; // se descarta el resto sin guardarlo en memoria
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        chunks.length = 0;
        reject(new HttpError(413, 'El cuerpo de la petición es demasiado grande.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON no válido.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{store:object, adminKey?:string, root:string, log?:(msg:string)=>void}} options
 */
export function createApp({ store, adminKey = '', root, log = () => {} }) {
  const rootDir = resolve(root);
  const failures = new Map(); // ip -> { count, windowEnd, lockedUntil }

  const digest = (value) => createHash('sha256').update(value).digest();
  const expected = digest(adminKey);

  /** Devuelve null si la clave es válida, o { status, error } si no. */
  function authenticate(req) {
    if (!adminKey) {
      return { status: 503, error: 'El servidor no tiene ADMIN_KEY configurada (archivo .env).' };
    }
    const ip = req.socket.remoteAddress ?? 'desconocida';
    const now = Date.now();
    const record = failures.get(ip);
    if (record && record.lockedUntil > now) {
      return {
        status: 429,
        error: 'Demasiados intentos con clave incorrecta. Espera un minuto.',
        retryAfter: Math.ceil((record.lockedUntil - now) / 1000),
      };
    }

    const given = req.headers['x-admin-key'];
    if (typeof given !== 'string' || given === '') {
      return { status: 401, error: 'Falta la clave de administrador.' };
    }
    if (timingSafeEqual(digest(given), expected)) {
      failures.delete(ip);
      return null;
    }

    const current = record && record.windowEnd > now ? record : { count: 0, windowEnd: now + LOCK_MS, lockedUntil: 0 };
    current.count += 1;
    if (current.count >= MAX_FAILED_KEYS) current.lockedUntil = now + LOCK_MS;
    failures.set(ip, current);
    if (failures.size > 1000) failures.clear(); // evita crecer sin límite
    return { status: 401, error: 'Clave de administrador incorrecta.' };
  }

  /** Responde y devuelve false si no hay permiso. */
  function requireAdmin(req, res) {
    const problem = authenticate(req);
    if (!problem) return true;
    const headers = problem.retryAfter ? { 'Retry-After': String(problem.retryAfter) } : {};
    sendJson(res, problem.status, { error: problem.error }, headers);
    return false;
  }

  // ------------------------------------------------------------------ API

  async function handleApi(req, res, pathname, searchParams) {
    if (pathname === '/api/health') {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      return sendJson(res, 200, { ok: true, store: store.name });
    }

    if (pathname === '/api/auth') {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      if (!requireAdmin(req, res)) return undefined;
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/items') {
      if (req.method === 'GET') {
        const kind = searchParams.get('kind');
        if (kind !== null && !KINDS.includes(kind)) {
          return sendJson(res, 422, { error: `"kind" debe ser uno de: ${KINDS.join(', ')}.` });
        }
        return sendJson(res, 200, { items: await store.list(kind) });
      }
      if (req.method === 'POST') {
        if (!requireAdmin(req, res)) return undefined;
        const checked = validateItem(await readJsonBody(req));
        if (!checked.ok) return sendJson(res, 422, { error: checked.error });
        try {
          const item = await store.create(checked.value);
          log(`+ ${item.kind}: ${item.title}`);
          return sendJson(res, 201, { item });
        } catch (err) {
          if (err instanceof DuplicateError) return sendJson(res, 409, { error: err.message });
          throw err;
        }
      }
      return methodNotAllowed(res, 'GET, POST');
    }

    const match = /^\/api\/items\/(\d{1,12})$/.exec(pathname);
    if (match) {
      if (req.method !== 'DELETE') return methodNotAllowed(res, 'DELETE');
      if (!requireAdmin(req, res)) return undefined;
      const removed = await store.remove(Number(match[1]));
      if (!removed) return sendJson(res, 404, { error: 'Ese elemento no existe.' });
      log(`- elemento ${match[1]}`);
      return sendEmpty(res, 204);
    }

    return sendJson(res, 404, { error: 'Ruta de API no encontrada.' });
  }

  function methodNotAllowed(res, allow) {
    return sendJson(res, 405, { error: 'Método no permitido.' }, { Allow: allow });
  }

  // ------------------------------------------------------------- estáticos

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('No encontrado');
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD');

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return notFound(res);
    }
    if (decoded.includes('\0')) return notFound(res);

    const parts = (decoded === '/' ? '/index.html' : decoded).split('/').filter(Boolean);
    // Rechaza "..", ".", archivos ocultos, barras invertidas y ":" (flujos alternos de Windows).
    if (!parts.length || parts.some((p) => p.startsWith('.') || p.includes('\\') || p.includes(':'))) {
      return notFound(res);
    }
    if (!PUBLIC_TOP_LEVEL.has(parts[0].toLowerCase())) return notFound(res);

    const absolute = resolve(rootDir, ...parts);
    if (!absolute.startsWith(rootDir + sep)) return notFound(res);

    let info;
    try {
      info = await stat(absolute);
    } catch {
      return notFound(res);
    }
    if (!info.isFile()) return notFound(res);

    const ext = extname(absolute).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const cache = ['.html', '.js', '.mjs', '.css', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=3600';
    const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes' };

    let start = 0;
    let end = info.size - 1;
    let status = 200;

    // Rangos: imprescindibles para poder adelantar/atrasar en videos grandes.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] !== '' || range[2] !== '')) {
      if (range[1] === '') {
        start = Math.max(0, info.size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= info.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }

    headers['Content-Length'] = end >= start ? end - start + 1 : 0;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || info.size === 0) return res.end();

    const stream = createReadStream(absolute, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return undefined;
  }

  // ---------------------------------------------------------------- entrada

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url.pathname, url.searchParams);
      } else {
        await serveStatic(req, res, url.pathname);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        // Tras un cuerpo excesivo se cierra la conexión una vez enviada la respuesta.
        const headers = err.status === 413 ? { Connection: 'close' } : {};
        if (!res.headersSent) sendJson(res, err.status, { error: err.message }, headers);
        return;
      }
      log(`ERROR ${req.method} ${req.url}: ${err?.stack ?? err}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor.' });
      else res.destroy();
    }
  };
}
