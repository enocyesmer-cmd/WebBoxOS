-- ============================================================================
-- Usuario de MySQL EXCLUSIVO para WebBox OS, con los permisos mínimos.
-- Así, si alguien descubriera la contraseña, solo podría leer, agregar y
-- borrar filas de la tabla "items" (no tocar nada más del servidor).
--
-- 1) Cambia CAMBIA_ESTA_CLAVE por una contraseña propia y larga.
-- 2) Ejecútalo con root, DESPUÉS de schema.sql.
-- 3) Pon el mismo usuario y contraseña en .env (DB_USER / DB_PASSWORD).
-- ============================================================================

CREATE USER IF NOT EXISTS 'webbox'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_CLAVE';
GRANT SELECT, INSERT, DELETE ON webbox.items TO 'webbox'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON webbox.usuarios TO 'webbox'@'localhost';
FLUSH PRIVILEGES;
