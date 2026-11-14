-- WebBox OS: esquema SQLite (se abre con "DB Browser for SQLite").
-- El servidor lo aplica solo al arrancar; este archivo es para consulta.
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('youtube','music','movies')),
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  artist     TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, url)
);
CREATE INDEX IF NOT EXISTS idx_items_kind_order ON items (kind, sort_order, id);
