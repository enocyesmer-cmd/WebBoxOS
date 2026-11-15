/**
 * Almacén SQLite (archivo database/webbox.sqlite, o la ruta de SQLITE_FILE).
 * Usa el módulo integrado "node:sqlite" (Node.js 22.5 o superior): no instala nada.
 * Tablas en español: videos_youtube, musica, peliculas, series.
 *
 * La API identifica cada elemento con un solo número: id_publico = id_fila * 10 + código
 * del tipo (1 youtube, 2 music, 3 movies, 4 series). Así /api/items/:id sigue funcionando igual.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DuplicateError } from './errors.js';

const SCHEMA = new URL('../../database/schema_sqlite.sql', import.meta.url);
const TABLES = { youtube: 'videos_youtube', music: 'musica', movies: 'peliculas', series: 'series' };
const CODES = { youtube: 1, music: 2, movies: 3, series: 4 };
const KIND_BY_CODE = { 1: 'youtube', 2: 'music', 3: 'movies', 4: 'series' };
const COLS = 'id, titulo, enlace, categoria, imagen, artista';

const toItem = (kind, r) => ({
  id: Number(r.id) * 10 + CODES[kind],
  kind,
  title: r.titulo,
  url: r.enlace,
  category: r.categoria,
  image: r.imagen,
  artist: r.artista,
});

export async function createSqliteStore(file) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error(`Tu Node.js (${process.version}) es muy antiguo para SQLite. Necesitas Node.js 22.5 o superior (en Render: variable NODE_VERSION=22).`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(readFileSync(SCHEMA, 'utf8'));

  // Migración de la versión anterior (tabla única "items" en inglés), si existe.
  const old = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'").get();
  if (old) {
    db.exec('BEGIN');
    try {
      for (const [kind, table] of Object.entries(TABLES)) {
        db.prepare(
          `INSERT OR IGNORE INTO ${table} (titulo, enlace, categoria, imagen, artista)
           SELECT title, url, category, image, artist FROM items WHERE kind = ? ORDER BY sort_order, id`,
        ).run(kind);
      }
      db.exec('DROP TABLE items');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const select = {};
  const insert = {};
  const del = {};
  for (const [kind, table] of Object.entries(TABLES)) {
    select[kind] = db.prepare(`SELECT ${COLS} FROM ${table} ORDER BY id`);
    insert[kind] = db.prepare(`INSERT INTO ${table} (titulo, enlace, categoria, imagen, artista) VALUES (?, ?, ?, ?, ?)`);
    del[kind] = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  }

  // Cuentas de usuario (tabla "usuarios")
  const toUser = (r) =>
    r ? { id: Number(r.id), username: r.usuario, hash: r.clave_hash, role: r.rol, createdAt: r.creado_en } : null;
  const userSql = {
    count: db.prepare('SELECT COUNT(*) AS n FROM usuarios'),
    byName: db.prepare('SELECT * FROM usuarios WHERE usuario = ?'),
    byId: db.prepare('SELECT * FROM usuarios WHERE id = ?'),
    all: db.prepare('SELECT * FROM usuarios ORDER BY id'),
    insert: db.prepare('INSERT INTO usuarios (usuario, clave_hash, rol) VALUES (?, ?, ?)'),
    setHash: db.prepare('UPDATE usuarios SET clave_hash = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM usuarios WHERE id = ?'),
  };
  const users = {
    async count() {
      return Number(userSql.count.get().n);
    },
    async getByName(username) {
      return toUser(userSql.byName.get(username));
    },
    async getById(id) {
      return toUser(userSql.byId.get(id));
    },
    async list() {
      return userSql.all.all().map(toUser);
    },
    async create({ username, hash, role }) {
      try {
        const r = userSql.insert.run(username, hash, role);
        return toUser(userSql.byId.get(Number(r.lastInsertRowid)));
      } catch (err) {
        if (/UNIQUE/i.test(String(err && err.message))) throw new DuplicateError('Ese usuario ya existe.');
        throw err;
      }
    },
    async setPassword(id, hash) {
      return userSql.setHash.run(hash, id).changes > 0;
    },
    async remove(id) {
      return userSql.del.run(id).changes > 0;
    },
  };

  return {
    name: 'sqlite',
    users,

    async list(kind = null) {
      const kinds = kind ? [kind] : Object.keys(TABLES);
      return kinds.flatMap((k) => select[k].all().map((r) => toItem(k, r)));
    },

    async create(item) {
      try {
        const r = insert[item.kind].run(item.title, item.url, item.category, item.image, item.artist);
        return toItem(item.kind, {
          id: r.lastInsertRowid,
          titulo: item.title,
          enlace: item.url,
          categoria: item.category,
          imagen: item.image,
          artista: item.artist,
        });
      } catch (err) {
        if (/UNIQUE/i.test(String(err && err.message))) throw new DuplicateError();
        throw err;
      }
    },

    async remove(publicId) {
      const kind = KIND_BY_CODE[publicId % 10];
      const rowId = Math.floor(publicId / 10);
      if (!kind || rowId < 1) return false;
      return del[kind].run(rowId).changes > 0;
    },

    async ping() {
      db.prepare('SELECT 1').get();
    },

    async close() {
      db.close();
    },
  };
}
