/**
 * Herramientas de la base de datos SQLite.
 *   node tools/db.mjs crear      crea database/webbox.sqlite (con tablas) si no existe
 *   node tools/db.mjs exportar   guarda el catálogo en database/catalogo.json (sí va a git)
 *   node tools/db.mjs importar   agrega a la base lo que falte de catalogo.json
 *   node tools/db.mjs sincronizar   importar + exportar (úsalo después de "git pull")
 * Nunca borra nada: sincronizar solo suma elementos nuevos.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.js';
import { createSqliteStore } from '../server/store/sqlite.js';
import { exportarCatalogo, importarCatalogo } from '../server/catalogo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(ROOT);
const DB_FILE = resolve(ROOT, env.SQLITE_FILE || 'database/webbox.sqlite');
const JSON_FILE = resolve(ROOT, 'database/catalogo.json');
const store = await createSqliteStore(DB_FILE);

async function exportar() {
  const n = await exportarCatalogo(store, JSON_FILE);
  console.log(`✔ Exportados ${n} elementos a database/catalogo.json`);
}

async function importar() {
  const r = await importarCatalogo(store, JSON_FILE);
  if (!r) return console.log('· No hay database/catalogo.json todavía; nada que importar.');
  return console.log(`✔ Importados: ${r.added} nuevos, ${r.existing} ya existían${r.invalid ? `, ${r.invalid} inválidos omitidos` : ''}.`);
}

const command = process.argv[2];
try {
  if (command === 'crear') console.log(`✔ Base de datos lista: ${DB_FILE}`);
  else if (command === 'exportar') await exportar();
  else if (command === 'importar') await importar();
  else if (command === 'sincronizar') {
    await importar();
    await exportar();
  } else {
    console.log('Uso: node tools/db.mjs crear | exportar | importar | sincronizar');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await store.close();
}
