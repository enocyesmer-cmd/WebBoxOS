/**
 * Almacén SQLite (archivo database/webbox.sqlite). No necesita instalar nada:
 * usa el módulo integrado "node:sqlite" (Node.js 22.5 o superior).
 * El archivo se puede abrir con "DB Browser for SQLite".
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DuplicateError } from './errors.js';

const COLUMNS = 'id, kind, title, url, category, image, artist';
const SCHEMA = new URL('../../database/schema_sqlite.sql', import.meta.url);

const toItem = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  title: r.title,
  url: r.url,
  category: r.category,
  image: r.image,
  artist: r.artist,
});

export async function createSqliteStore(file) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error(`Tu Node.js (${process.version}) es muy antiguo para SQLite. Instala Node.js 22.5 o superior desde nodejs.org.`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(readFileSync(SCHEMA, 'utf8'));

  const listAll = db.prepare(`SELECT ${COLUMNS} FROM items ORDER BY kind, sort_order, id`);
  const listKind = db.prepare(`SELECT ${COLUMNS} FROM items WHERE kind = ? ORDER BY sort_order, id`);
  const insert = db.prepare('INSERT INTO items (kind, title, url, category, image, artist) VALUES (?, ?, ?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM items WHERE id = ?');

  return {
    name: 'sqlite',

    async list(kind = null) {
      return (kind ? listKind.all(kind) : listAll.all()).map(toItem);
    },

    async create(item) {
      try {
        const r = insert.run(item.kind, item.title, item.url, item.category, item.image, item.artist);
        return toItem({ id: r.lastInsertRowid, ...item });
      } catch (err) {
        if (/UNIQUE/i.test(String(err && err.message))) throw new DuplicateError();
        throw err;
      }
    },

    async remove(id) {
      return del.run(id).changes > 0;
    },

    async ping() {
      db.prepare('SELECT 1').get();
    },

    async close() {
      db.close();
    },
  };
}
