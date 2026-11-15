-- ============================================================================
-- WebBox OS · base de datos MySQL / MariaDB
-- Ejecuta este archivo UNA vez (con un usuario administrador, p. ej. root):
--     mysql -u root -p < database/schema.sql
-- o pégalo en MySQL Workbench / phpMyAdmin (pestaña SQL).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS webbox
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE webbox;

-- Catálogo compartido: lo que ven todos los usuarios en YouTube, Música y Películas.
-- Solo se guardan DATOS (títulos y enlaces). Nunca archivos de video, audio ni juegos.
CREATE TABLE IF NOT EXISTS items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind        ENUM('youtube', 'music', 'movies', 'series') NOT NULL
              COMMENT 'youtube = videos y listas, music = canciones, movies = películas, series = capítulos (la categoría es el nombre de la serie)',
  title       VARCHAR(120)  NOT NULL,
  url         VARCHAR(2048) NOT NULL
              COMMENT 'Enlace http(s), ID de YouTube o ruta relativa (assets/movies/x.mp4)',
  url_hash    BINARY(32)    NOT NULL
              COMMENT 'SHA-256 de tipo + enlace: evita duplicados',
  category    VARCHAR(40)   NOT NULL DEFAULT ''
              COMMENT 'Fila donde aparece; vacío = la categoría por defecto de esa pantalla',
  image       VARCHAR(2048) NOT NULL DEFAULT ''
              COMMENT 'Póster o miniatura (opcional)',
  artist      VARCHAR(80)   NOT NULL DEFAULT ''
              COMMENT 'Artista (solo música)',
  sort_order  INT           NOT NULL DEFAULT 0
              COMMENT 'Orden manual; a igualdad, por antigüedad',
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_kind_hash (kind, url_hash),
  KEY idx_items_kind_order (kind, sort_order, id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Si ya tenías la tabla creada antes de existir las Series, ejecuta una sola vez:
--   ALTER TABLE items MODIFY kind ENUM('youtube', 'music', 'movies', 'series') NOT NULL;

-- Cuentas de usuario. Guarda solo el hash (scrypt) de la contraseña, nunca la contraseña.
-- rol: admin (agrega/elimina contenido y gestiona usuarios) o user (solo ve y reproduce).
-- Si ya tenías la base creada, ejecuta este bloque una vez y vuelve a ejecutar crear_usuario.sql.
CREATE TABLE IF NOT EXISTS usuarios (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario    VARCHAR(32)  NOT NULL,
  clave_hash VARCHAR(255) NOT NULL,
  rol        ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  creado_en  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_usuario (usuario)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;
