// Pruebas del servidor (API del catálogo + archivos estáticos) con el almacén en memoria.
//   node tests/api.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createMemoryStore } from '../server/store/memory.js';
import { validateItem } from '../server/validate.js';
import { loadEnv } from '../server/env.js';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`  FALLO  ${name}\n        ${e.message}`);
  }
};

// ---- sitio de prueba con las mismas carpetas que el proyecto real
const root = mkdtempSync(join(tmpdir(), 'webbox-'));
for (const dir of ['css', 'js', 'assets/icons', 'JUEGOS', 'server', 'database', 'tests']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, 'index.html'), '<!doctype html><title>WebBox</title>');
writeFileSync(join(root, 'css/main.css'), 'body{}');
writeFileSync(join(root, 'assets/icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
writeFileSync(join(root, 'assets/video.mp4'), Buffer.from('0123456789abcdefghij')); // 20 bytes
writeFileSync(join(root, 'JUEGOS/Juego.smc'), 'ROM');
writeFileSync(join(root, 'server/secreto.js'), 'SECRETO');
writeFileSync(join(root, '.env'), 'ADMIN_KEY=hola');
writeFileSync(join(root, 'package.json'), '{}');

const KEY = 'clave-de-prueba-123';
const store = createMemoryStore();
const server = createServer(createApp({ store, adminKey: KEY, root }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

/** Petición cruda: no normaliza la ruta (así se prueban "../" y similares). */
const raw = (path, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
const api = async (path, { method = 'GET', key, body, type = 'application/json' } = {}) => {
  const headers = {};
  if (key !== undefined) headers['X-Admin-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = type;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* sin cuerpo */ }
  return { status: res.status, data, headers: res.headers };
};
const song = { kind: 'music', title: 'Mi canción', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', category: 'Rock', artist: 'Alguien' };

console.log('API: lectura pública');
await test('health informa el almacén', async () => {
  const r = await api('/api/health');
  assert.deepEqual(r.data, { ok: true, store: 'memory' });
});
await test('catálogo vacío y filtro por tipo', async () => {
  assert.deepEqual((await api('/api/items')).data, { items: [] });
  assert.equal((await api('/api/items?kind=music')).status, 200);
  assert.equal((await api('/api/items?kind=juegos')).status, 422);
});

console.log('API: escritura protegida');
await test('sin clave: 401; con clave incorrecta: 401', async () => {
  assert.equal((await api('/api/items', { method: 'POST', body: song })).status, 401);
  assert.equal((await api('/api/items', { method: 'POST', body: song, key: 'mala' })).status, 401);
  assert.equal((await api('/api/items/1', { method: 'DELETE' })).status, 401);
  assert.equal((await api('/api/items')).data.items.length, 0);
});
await test('con la clave correcta se crea (201) y aparece en el catálogo', async () => {
  const r = await api('/api/items', { method: 'POST', body: song, key: KEY });
  assert.equal(r.status, 201);
  assert.equal(r.data.item.id, 1);
  assert.equal(r.data.item.title, 'Mi canción');
  const list = (await api('/api/items?kind=music')).data.items;
  assert.equal(list.length, 1);
  assert.equal((await api('/api/items?kind=movies')).data.items.length, 0);
});
await test('el mismo enlace dos veces: 409; en otro tipo sí se permite', async () => {
  assert.equal((await api('/api/items', { method: 'POST', body: song, key: KEY })).status, 409);
  const asVideo = { ...song, kind: 'youtube' };
  assert.equal((await api('/api/items', { method: 'POST', body: asVideo, key: KEY })).status, 201);
});
await test('GET /api/auth valida la clave', async () => {
  assert.equal((await api('/api/auth', { key: KEY })).status, 200);
  assert.equal((await api('/api/auth', { key: 'x' })).status, 401);
});
await test('borrar: 204, luego 404', async () => {
  assert.equal((await api('/api/items/1', { method: 'DELETE', key: KEY })).status, 204);
  assert.equal((await api('/api/items/1', { method: 'DELETE', key: KEY })).status, 404);
  assert.equal((await api('/api/items/abc', { method: 'DELETE', key: KEY })).status, 404);
});

console.log('API: validación');
const post = (body, type) => api('/api/items', { method: 'POST', key: KEY, body, type });
await test('rechaza datos inválidos con 422', async () => {
  assert.equal((await post({ ...song, kind: 'juegos' })).status, 422);
  assert.equal((await post({ ...song, title: '   ' })).status, 422);
  assert.equal((await post({ ...song, title: 'x'.repeat(121) })).status, 422);
  assert.equal((await post({ ...song, url: 'javascript:alert(1)' })).status, 422);
  assert.equal((await post({ ...song, url: 'data:text/html,hola' })).status, 422);
  assert.equal((await post({ ...song, url: 'https://user:pass@sitio.com/x' })).status, 422);
  assert.equal((await post({ ...song, url: 'assets/movies/x.mp4' })).status, 422); // ruta local solo en películas
  assert.equal((await post({ ...song, url: 'https://a.com/x', image: 'javascript:1' })).status, 422);
  assert.equal((await post({ ...song, url: 'https://a.com/y', title: 'con\u0000nulo' })).status, 422);
  assert.equal((await post({ ...song, url: 'https://a.com/z', category: 5 })).status, 422);
  assert.equal((await post([1, 2])).status, 422);
});
await test('acepta rutas relativas de película y IDs de YouTube; rechaza ".." y absolutas', async () => {
  const movie = { kind: 'movies', title: 'Peli', category: 'Acción' };
  assert.equal((await post({ ...movie, url: 'assets/movies/peli.mp4', image: 'assets/movies/peli.jpg' })).status, 201);
  assert.equal((await post({ ...movie, url: '../secreto.mp4' })).status, 422);
  assert.equal((await post({ ...movie, url: 'assets/../../x.mp4' })).status, 422);
  assert.equal((await post({ ...movie, url: 'assets/%2e%2e/x.mp4' })).status, 422);
  assert.equal((await post({ ...movie, url: '/etc/passwd.mp4' })).status, 422);
  assert.equal((await post({ ...movie, url: 'C:\\peli.mp4' })).status, 422);
  assert.equal((await post({ kind: 'youtube', title: 'Por ID', url: 'dQw4w9WgXcQ' })).status, 201);
});
await test('cuerpo no JSON: 400; tipo incorrecto: 415; demasiado grande: 413', async () => {
  assert.equal((await post('{no es json', 'application/json')).status, 400);
  assert.equal((await post(JSON.stringify(song), 'text/plain')).status, 415);
  const big = await post({ ...song, url: 'https://a.com/' + 'x'.repeat(20000) });
  assert.equal(big.status, 413);
  assert.equal((await api('/api/health')).status, 200); // el servidor sigue vivo
});
await test('el texto se guarda sin espacios sobrantes', async () => {
  const r = await post({ kind: 'youtube', title: '  Con espacios  ', url: '  https://youtu.be/abcdefghijk  ' });
  assert.equal(r.status, 201);
  assert.equal(r.data.item.title, 'Con espacios');
  assert.equal(r.data.item.url, 'https://youtu.be/abcdefghijk');
});
await test('validateItem (unitaria)', () => {
  assert.equal(validateItem(null).ok, false);
  assert.equal(validateItem({ kind: 'music', title: 'a', url: 'https://a.com' }).ok, true);
});

console.log('Archivos estáticos y seguridad');
await test('sirve la web y sus recursos', async () => {
  const home = await raw('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.equal((await raw('/css/main.css')).status, 200);
  const svg = await raw('/assets/icons/icon.svg');
  assert.equal(svg.headers['content-type'], 'image/svg+xml');
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
});
await test('NO sirve JUEGOS, server, .env, package.json ni carpetas internas', async () => {
  for (const p of ['/JUEGOS/Juego.smc', '/juegos/Juego.smc', '/JUEGOS./Juego.smc', '/server/secreto.js', '/.env', '/package.json',
    '/database/schema.sql', '/tests/api.test.mjs', '/server', '/JUEGOS/']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p} → ${r.status}`);
    assert.ok(!r.text.includes('SECRETO') && !r.text.includes('ROM') && !r.text.includes('ADMIN_KEY'), `${p} filtró contenido`);
  }
});
await test('bloquea recorridos de ruta (../, %2e%2e, \\, ":")', async () => {
  for (const p of ['/assets/../server/secreto.js', '/assets/%2e%2e/server/secreto.js', '/%2e%2e/.env', '/assets/..%2fserver/secreto.js',
    '/assets/..\\server\\secreto.js', '/js/%5c..%5c.env', '/index.html::$DATA', '/assets/%00.png', '/assets/%zz']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p} → ${r.status}`);
    assert.ok(!r.text.includes('SECRETO') && !r.text.includes('ADMIN_KEY'), `${p} filtró contenido`);
  }
});
await test('rangos de video: 206, sufijo, 416 y HEAD', async () => {
  const full = await raw('/assets/video.mp4');
  assert.equal(full.status, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(full.text, '0123456789abcdefghij');
  const part = await raw('/assets/video.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.text, '2345');
  assert.equal(part.headers['content-range'], 'bytes 2-5/20');
  assert.equal((await raw('/assets/video.mp4', { headers: { Range: 'bytes=15-' } })).text, 'fghij');
  assert.equal((await raw('/assets/video.mp4', { headers: { Range: 'bytes=-3' } })).text, 'hij');
  assert.equal((await raw('/assets/video.mp4', { headers: { Range: 'bytes=99-120' } })).status, 416);
  const head = await raw('/assets/video.mp4', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], '20');
  assert.equal(head.text, '');
});
await test('métodos no permitidos y rutas de API desconocidas', async () => {
  assert.equal((await raw('/index.html', { method: 'POST' })).status, 405);
  assert.equal((await api('/api/nada')).status, 404);
  assert.equal((await api('/api/health', { method: 'POST', body: {} })).status, 405);
});

console.log('Protección contra adivinar la clave');
await test('5 claves incorrectas bloquean un minuto (incluso la correcta)', async () => {
  for (let i = 0; i < 5; i += 1) await api('/api/auth', { key: `mala-${i}` });
  const locked = await api('/api/auth', { key: KEY });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await api('/api/items')).status, 200); // la lectura sigue funcionando
});

console.log('Sin ADMIN_KEY configurada');
await test('las escrituras se desactivan (503) y la lectura sigue', async () => {
  const s2 = createServer(createApp({ store: createMemoryStore(), adminKey: '', root }));
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const p2 = s2.address().port;
  const w = await fetch(`http://127.0.0.1:${p2}/api/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': '' }, body: JSON.stringify(song) });
  assert.equal(w.status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${p2}/api/items`)).status, 200);
  s2.close();
});

console.log('Lector de .env');
await test('lee comillas, comentarios y da prioridad al entorno', () => {
  writeFileSync(join(root, '.env'), '# comentario\nPORT=9000\nADMIN_KEY="con espacios y # raro"\nDB_USER = webbox \n');
  const env = loadEnv(root, { PORT: '1234' });
  assert.equal(env.PORT, '1234');
  assert.equal(env.ADMIN_KEY, 'con espacios y # raro');
  assert.equal(env.DB_USER, 'webbox');
});

server.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} pruebas correctas`);
