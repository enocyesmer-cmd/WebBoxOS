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
