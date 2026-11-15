-- WebBox OS: esquema SQLite con tablas en español (se abre con "DB Browser for SQLite").
-- El servidor lo aplica solo al arrancar; este archivo es para consulta.
-- Un mismo enlace no puede repetirse dentro de la misma tabla.

CREATE TABLE IF NOT EXISTS videos_youtube (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT NOT NULL,
  enlace    TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT '',
  imagen    TEXT NOT NULL DEFAULT '',
  artista   TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS musica (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT NOT NULL,
  enlace    TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT '',
  imagen    TEXT NOT NULL DEFAULT '',
  artista   TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS peliculas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT NOT NULL,
  enlace    TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT '',
  imagen    TEXT NOT NULL DEFAULT '',
  artista   TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Capítulos de series: la columna "categoria" es el nombre de la serie (cada serie es una fila en la web).
CREATE TABLE IF NOT EXISTS series (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT NOT NULL,
  enlace    TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT '',
  imagen    TEXT NOT NULL DEFAULT '',
  artista   TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cuentas de usuario. "clave_hash" guarda solo el hash (scrypt): la contraseña no se puede recuperar.
-- rol: admin (agrega y elimina contenido, gestiona usuarios) o user (solo ve y reproduce).
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  clave_hash TEXT NOT NULL,
  rol        TEXT NOT NULL DEFAULT 'user' CHECK (rol IN ('admin', 'user')),
  creado_en  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
