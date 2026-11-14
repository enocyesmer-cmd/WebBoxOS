/**
 * Arranque del servidor de WebBox OS.
 *   npm start      (o: node server/server.js)
 * Configuración en el archivo .env (copia .env.example).
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { createApp } from './app.js';
import { createMysqlStore } from './store/mysql.js';
import { createMemoryStore } from './store/memory.js';
import { createSqliteStore } from './store/sqlite.js';
import { importarCatalogo } from './catalogo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(ROOT);

const PORT = Number(env.PORT) || 8080;
const HOST = env.HOST || '0.0.0.0';
const ADMIN_KEY = env.ADMIN_KEY || '';
const stamp = () => new Date().toLocaleTimeString('es');
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!ADMIN_KEY) {
  console.warn('⚠ ADMIN_KEY está vacía: se podrá ver el catálogo, pero NO agregar ni eliminar nada.');
} else if (ADMIN_KEY.length < 8 || /cambia/i.test(ADMIN_KEY)) {
  console.warn('⚠ ADMIN_KEY es débil o es la de ejemplo. Cámbiala en .env por una clave larga y propia.');
}

let store;
try {
  const kind = (env.STORE || 'sqlite').toLowerCase();
  if (kind === 'sqlite') {
    store = await createSqliteStore(resolve(ROOT, env.SQLITE_FILE || 'database/webbox.sqlite'));
  } else if (kind === 'memory') {
    store = createMemoryStore();
    console.warn('⚠ STORE=memory: los datos se pierden al apagar el servidor (solo para pruebas).');
  } else if (kind === 'mysql') {
    store = await createMysqlStore({
      host: env.DB_HOST || '127.0.0.1',
      port: Number(env.DB_PORT) || 3306,
      user: env.DB_USER || 'webbox',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'webbox',
    });
  } else {
    throw new Error(`STORE="${kind}" no existe. Usa sqlite, mysql o memory.`);
  }
} catch (err) {
  fail(
    `No se pudo abrir la base de datos: ${err.message}\n` +
      '  Con SQLite no hace falta configurar nada. Con STORE=mysql revisa DB_* en .env,\n' +
      '  que MySQL esté encendido y que hayas ejecutado database/schema.sql.',
  );
}

// En hostings con disco temporal (Render gratis) la base arranca vacía tras cada reinicio:
// se recarga desde database/catalogo.json (que sí está en git). Solo agrega, nunca borra.
// Para desactivarlo: SEMBRAR=0
if (store.name === 'sqlite' && env.SEMBRAR !== '0') {
  try {
    const r = await importarCatalogo(store, resolve(ROOT, 'database/catalogo.json'));
    if (r && r.added) log(`Catálogo cargado desde database/catalogo.json: ${r.added} elementos nuevos.`);
  } catch (err) {
    console.warn(`⚠ No se pudo leer database/catalogo.json: ${err.message}`);
  }
}

const server = createServer(createApp({ store, adminKey: ADMIN_KEY, root: ROOT, log }));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') fail(`El puerto ${PORT} ya está en uso. Cambia PORT en .env.`);
  fail(`No se pudo iniciar el servidor: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`\nWebBox OS listo (base de datos: ${store.name})`);
  console.log(`  Este equipo:  http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) console.log(`  En tu red:    http://${addr.address}:${PORT}`);
    }
  }
  console.log('\nCtrl+C para detenerlo.\n');
});

async function shutdown() {
  server.close();
  try {
    await store.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
