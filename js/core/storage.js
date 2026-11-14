/**
 * Envoltorio de localStorage con respaldo en memoria.
 * Algunos navegadores de Smart TV o modos privados lanzan excepciones al
 * escribir; en ese caso las preferencias viven solo durante la sesión.
 */
const PREFIX = 'webboxos:';
const memory = new Map();

let ls = null;
try {
  ls = window.localStorage;
  const probe = `${PREFIX}__probe`;
  ls.setItem(probe, '1');
  ls.removeItem(probe);
} catch {
  ls = null;
}

export const storage = {
  /** true si las preferencias se guardan de forma persistente */
  available: Boolean(ls),

  get(key, fallback = null) {
    try {
      const raw = ls ? ls.getItem(PREFIX + key) : memory.get(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (ls) ls.setItem(PREFIX + key, raw);
      else memory.set(key, raw);
    } catch {
      memory.set(key, raw);
    }
  },

  remove(key) {
    try {
      if (ls) ls.removeItem(PREFIX + key);
    } catch {
      /* sin acción */
    }
    memory.delete(key);
  },
};
