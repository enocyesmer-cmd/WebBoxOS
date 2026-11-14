/**
 * Herramientas de la base de datos SQLite.
 *   node tools/db.mjs crear      crea database/webbox.sqlite (con tablas) si no existe
 *   node tools/db.mjs exportar   guarda el catálogo en database/catalogo.json (sí va a git)
 *   node tools/db.mjs importar   agrega a la base lo que falte de catalogo.json
 *   node tools/db.mjs sincronizar   importar + exportar (úsalo después de "git pull")
 * Nunca borra nada: sincronizar solo suma elementos nuevos.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.js';
import { createSqliteStore } from '../server/store/sqlite.js';
import { validateItem } from '../server/validate.js';
import { DuplicateError } from '../server/store/errors.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(ROOT);
const DB_FILE = resolve(ROOT, env.SQLITE_FILE || 'database/webbox.sqlite');
const JSON_FILE = resolve(ROOT, 'database/catalogo.json');
const order = { youtube: 0, music: 1, movies: 2 };

const store = await createSqliteStore(DB_FILE);

async function exportar() {
  const items = (await store.list())
    .map(({ id, ...rest }) => rest)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'es') || a.url.localeCompare(b.url));
  writeFileSync(JSON_FILE, `${JSON.stringify({ items }, null, 2)}\n`, 'utf8');
  console.log(`✔ Exportados ${items.length} elementos a database/catalogo.json`);
}

async function importar() {
  if (!existsSync(JSON_FILE)) {
    console.log('· No hay database/catalogo.json todavía; nada que importar.');
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(JSON_FILE, 'utf8'));
  } catch {
    throw new Error('database/catalogo.json no es un JSON válido (¿quedó un conflicto de git sin resolver?).');
  }
  let added = 0;
  let existing = 0;
  let invalid = 0;
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const checked = validateItem(raw);
    if (!checked.ok) {
      invalid += 1;
      continue;
    }
    try {
      await store.create(checked.value);
      added += 1;
    } catch (err) {
      if (err instanceof DuplicateError) existing += 1;
      else throw err;
    }
  }
  console.log(`✔ Importados: ${added} nuevos, ${existing} ya existían${invalid ? `, ${invalid} inválidos omitidos` : ''}.`);
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
