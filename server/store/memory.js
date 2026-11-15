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

  // Cuentas (misma interfaz que en SQLite y MySQL)
  const accounts = new Map();
  let nextUserId = 1;
  const toUser = (u) => ({ ...u });
  const users = {
    async count() {
      return accounts.size;
    },
    async getByName(username) {
      for (const u of accounts.values()) if (u.username === username) return toUser(u);
      return null;
    },
    async getById(id) {
      const u = accounts.get(id);
      return u ? toUser(u) : null;
    },
    async list() {
      return [...accounts.values()].map(toUser);
    },
    async create({ username, hash, role }) {
      for (const u of accounts.values()) if (u.username === username) throw new DuplicateError('Ese usuario ya existe.');
      const user = { id: nextUserId, username, hash, role, createdAt: new Date().toISOString() };
      nextUserId += 1;
      accounts.set(user.id, user);
      return toUser(user);
    },
    async setPassword(id, hash) {
      const u = accounts.get(id);
      if (!u) return false;
      u.hash = hash;
      return true;
    },
    async remove(id) {
      return accounts.delete(id);
    },
  };

  return {
    name: 'memory',
    users,

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
