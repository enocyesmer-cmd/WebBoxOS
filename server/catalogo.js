/** Lectura/escritura de database/catalogo.json y mezcla con un almacén. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateItem } from './validate.js';
import { DuplicateError } from './store/errors.js';

const order = { youtube: 0, music: 1, movies: 2 };

export async function exportarCatalogo(store, file) {
  const items = (await store.list())
    .map(({ id, ...rest }) => rest)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'es') || a.url.localeCompare(b.url));
  writeFileSync(file, `${JSON.stringify({ items }, null, 2)}\n`, 'utf8');
  return items.length;
}

/** Agrega lo que falte. Nunca borra. Devuelve null si el archivo no existe. */
export async function importarCatalogo(store, file) {
  if (!existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('database/catalogo.json no es un JSON válido (¿quedó un conflicto de git sin resolver?).');
  }
  const result = { added: 0, existing: 0, invalid: 0 };
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const checked = validateItem(raw);
    if (!checked.ok) {
      result.invalid += 1;
      continue;
    }
    try {
      await store.create(checked.value);
      result.added += 1;
    } catch (err) {
      if (err instanceof DuplicateError) result.existing += 1;
      else throw err;
    }
  }
  return result;
}
