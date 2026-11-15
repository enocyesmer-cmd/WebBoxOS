/**
 * Almacén MySQL / MariaDB (paquete "mysql2").
 * Todas las consultas usan parámetros (?), nunca se concatena texto del usuario.
 */
import { createHash } from 'node:crypto';
import { DuplicateError } from './errors.js';

const COLUMNS = 'id, kind, title, url, category, image, artist';

const toItem = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  title: r.title,
  url: r.url,
  category: r.category,
  image: r.image,
  artist: r.artist,
});

/** SHA-256 de "tipo + enlace": clave única que evita duplicados sin indexar 2048 caracteres. */
export function urlHash(kind, url) {
  return createHash('sha256').update(`${kind}\0${url}`).digest();
}

/**
 * @param {{host:string, port:number, user:string, password:string, database:string}} cfg
 */
export async function createMysqlStore(cfg) {
  let mysql;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    throw new Error('Falta el paquete "mysql2". Ejecuta:  npm install');
  }

  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
  });

  // Falla rápido y con un mensaje claro si los datos de conexión están mal.
  await pool.query('SELECT 1');

  // Cuentas de usuario (tabla "usuarios": ver database/schema.sql y crear_usuario.sql)
  const toUser = (r) =>
    r ? { id: Number(r.id), username: r.usuario, hash: r.clave_hash, role: r.rol, createdAt: r.creado_en } : null;
  const users = {
    async count() {
      const [rows] = await pool.execute('SELECT COUNT(*) AS n FROM usuarios');
      return Number(rows[0].n);
    },
    async getByName(username) {
      const [rows] = await pool.execute('SELECT * FROM usuarios WHERE usuario = ?', [username]);
      return toUser(rows[0]);
    },
    async getById(id) {
      const [rows] = await pool.execute('SELECT * FROM usuarios WHERE id = ?', [id]);
      return toUser(rows[0]);
    },
    async list() {
      const [rows] = await pool.execute('SELECT * FROM usuarios ORDER BY id');
      return rows.map(toUser);
    },
    async create({ username, hash, role }) {
      try {
        const [result] = await pool.execute('INSERT INTO usuarios (usuario, clave_hash, rol) VALUES (?, ?, ?)', [username, hash, role]);
        return toUser({ id: result.insertId, usuario: username, clave_hash: hash, rol: role, creado_en: new Date().toISOString() });
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') throw new DuplicateError('Ese usuario ya existe.');
        throw err;
      }
    },
    async setPassword(id, hash) {
      const [result] = await pool.execute('UPDATE usuarios SET clave_hash = ? WHERE id = ?', [hash, id]);
      return result.affectedRows > 0;
    },
    async remove(id) {
      const [result] = await pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
      return result.affectedRows > 0;
    },
  };

  return {
    name: 'mysql',
    users,

    async list(kind = null) {
      const [rows] = kind
        ? await pool.execute(
            `SELECT ${COLUMNS} FROM items WHERE kind = ? ORDER BY sort_order, id`,
            [kind],
          )
        : await pool.execute(`SELECT ${COLUMNS} FROM items ORDER BY kind, sort_order, id`);
      return rows.map(toItem);
    },

    async create(item) {
      try {
        const [result] = await pool.execute(
          'INSERT INTO items (kind, title, url, url_hash, category, image, artist) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [item.kind, item.title, item.url, urlHash(item.kind, item.url), item.category, item.image, item.artist],
        );
        return toItem({ id: result.insertId, ...item });
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') throw new DuplicateError();
        throw err;
      }
    },

    async remove(id) {
      const [result] = await pool.execute('DELETE FROM items WHERE id = ?', [id]);
      return result.affectedRows > 0;
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async close() {
      await pool.end();
    },
  };
}
