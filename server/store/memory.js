/**
 * Almacén en memoria con la misma interfaz que el de MySQL.
 * Sirve para pruebas (STORE=memory): los datos se pierden al reiniciar.
 */
import { DuplicateError } from './errors.js';

export function createMemoryStore() {
  const rows = new Map();
  let nextId = 1;

  const toItem = (r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    category: r.category,
    image: r.image,
    artist: r.artist,
  });

  return {
    name: 'memory',

    async list(kind = null) {
      return [...rows.values()].filter((r) => !kind || r.kind === kind).map(toItem);
    },

    async create(item) {
      for (const r of rows.values()) {
        if (r.kind === item.kind && r.url === item.url) throw new DuplicateError();
      }
      const row = { id: nextId, ...item };
      nextId += 1;
      rows.set(row.id, row);
      return toItem(row);
    },

    async remove(id) {
      return rows.delete(id);
    },

    async ping() {},
    async close() {},
  };
}
