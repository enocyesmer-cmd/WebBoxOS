/**
 * Lector mínimo de .env (sin dependencias). Las variables reales del sistema
 * tienen prioridad sobre las del archivo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnv(root, base = process.env) {
  const fromFile = {};
  try {
    const content = readFileSync(join(root, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      fromFile[m[1]] = value;
    }
  } catch {
    /* no hay .env: se usan las variables del sistema */
  }
  return { ...fromFile, ...base };
}
