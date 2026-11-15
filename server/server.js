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
import { normalizeUsername, passwordProblem, hashPassword } from './auth.js';

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

const REQUIRE_LOGIN = env.REQUIRE_LOGIN !== '0'; // por defecto hay que iniciar sesión
const ALLOW_REGISTER = env.ALLOW_REGISTER === '1';
const SESSION_SECRET = env.SESSION_SECRET || '';
const SESSION_DAYS = Number(env.SESSION_DAYS) > 0 ? Number(env.SESSION_DAYS) : 30;

if (ADMIN_KEY && (ADMIN_KEY.length < 8 || /cambia/i.test(ADMIN_KEY))) {
  console.warn('⚠ ADMIN_KEY es débil o es la de ejemplo. Cámbiala en .env por una clave larga y propia.');
}
if (SESSION_SECRET.length < 16) {
  console.warn('⚠ SESSION_SECRET no está definida (o es corta): las sesiones se cerrarán cada vez que reinicies el servidor.');
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

// Cuentas: si todavía no hay ninguna, se crea el administrador inicial con ADMIN_USER y
// ADMIN_PASSWORD (o, si no existe, con ADMIN_KEY como contraseña). Después, se cambia desde la app.
try {
  if ((await store.users.count()) === 0) {
    const username = normalizeUsername(env.ADMIN_USER || 'admin');
    const password = env.ADMIN_PASSWORD || ADMIN_KEY;
    if (!username) {
      console.warn('⚠ ADMIN_USER no es válido (3 a 32 caracteres: letras, números, . _ -): no se creó el administrador.');
    } else if (!password || passwordProblem(password)) {
      console.warn(
        '⚠ No hay ninguna cuenta y falta ADMIN_PASSWORD (mínimo 6 caracteres) en .env: nadie podrá iniciar sesión.\n' +
          '  Escríbela en .env y reinicia: se creará el administrador automáticamente.',
      );
    } else {
      await store.users.create({ username, hash: await hashPassword(password), role: 'admin' });
      log(`Administrador inicial creado: usuario "${username}". Cambia su contraseña desde Configuración > Cuenta.`);
    }
  }
} catch (err) {
  fail(
    `No se pudieron leer las cuentas de usuario: ${err.message}\n` +
      '  Con MySQL ejecuta de nuevo database/schema.sql y database/crear_usuario.sql (tabla "usuarios").',
  );
}

const server = createServer(
  createApp({
    store,
    adminKey: ADMIN_KEY,
    root: ROOT,
    log,
    sessionSecret: SESSION_SECRET,
    requireLogin: REQUIRE_LOGIN,
    allowRegister: ALLOW_REGISTER,
    sessionDays: SESSION_DAYS,
  }),
);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') fail(`El puerto ${PORT} ya está en uso. Cambia PORT en .env.`);
  fail(`No se pudo iniciar el servidor: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`\nWebBox OS listo (base de datos: ${store.name}, inicio de sesión: ${REQUIRE_LOGIN ? 'obligatorio' : 'opcional'})`);
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
