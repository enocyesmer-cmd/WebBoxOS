/**
 * Configuración persistente de WebBox OS.
 * Valida lo leído de localStorage, expone get/set y avisa por el bus.
 */
import { bus } from './events.js';
import { storage } from './storage.js';

export const ACTIONS = ['up', 'down', 'left', 'right', 'ok', 'back', 'home'];

/**
 * Mapeo por defecto (layout "standard" de la Gamepad API).
 * Otros mandos pueden numerar distinto: por eso cada mando (identificado por
 * su `id`) puede tener su propio mapeo, editable desde Configuración.
 */
export const DEFAULT_MAPPING = Object.freeze({
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  ok: [0],
  back: [1],
  home: [9, 16],
});

/** Milisegundos entre repeticiones para sensibilidad 1..5 */
export const REPEAT_INTERVALS = [260, 200, 150, 110, 80];

const DEFAULTS = {
  sensitivity: 3,
  stickDeadzone: 0.5,
  stickNav: true,
  keyboardThrottle: true,
  background: 'aurora',
  font: 'inter', // fuente del texto (js/data/fonts.js)
  titleFont: 'same', // fuente de los títulos: 'same' = la misma del texto
  uiScale: 100,
  overscan: 0,
  reduceMotion: false,
  clock24: true,
  showHints: true,
  mappings: {},
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function sanitize(raw) {
  const out = { ...DEFAULTS, mappings: {} };
  if (!raw || typeof raw !== 'object') return out;

  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'mappings') continue;
    if (typeof raw[key] === typeof DEFAULTS[key]) out[key] = raw[key];
  }
  out.font = String(out.font).slice(0, 40);
  out.titleFont = String(out.titleFont).slice(0, 40);
  out.sensitivity = clamp(Math.round(out.sensitivity), 1, 5);
  out.stickDeadzone = clamp(out.stickDeadzone, 0.2, 0.9);
  out.uiScale = clamp(Math.round(out.uiScale), 70, 140);
  out.overscan = clamp(Math.round(out.overscan), 0, 8);

  if (raw.mappings && typeof raw.mappings === 'object') {
    for (const [padId, mapping] of Object.entries(raw.mappings)) {
      if (!mapping || typeof mapping !== 'object') continue;
      const clean = {};
      for (const action of ACTIONS) {
        const list = mapping[action];
        if (
          Array.isArray(list) &&
          list.length > 0 &&
          list.every((n) => Number.isInteger(n) && n >= 0 && n < 64)
        ) {
          clean[action] = list.slice(0, 4);
        }
      }
      out.mappings[padId] = clean;
    }
  }
  return out;
}

let state = sanitize(storage.get('config', null));

function persist() {
  storage.set('config', state);
}

export const config = {
  get(key) {
    return state[key];
  },

  set(key, value) {
    if (!(key in DEFAULTS) || key === 'mappings') return;
    state[key] = value;
    persist();
    bus.emit('config:change', { key, value });
  },

  /** Intervalo de repetición (ms) según la sensibilidad actual */
  repeatInterval() {
    return REPEAT_INTERVALS[state.sensitivity - 1];
  },

  /** Retardo antes de empezar a repetir al mantener pulsado */
  repeatDelay() {
    return Math.round(this.repeatInterval() * 1.6 + 120);
  },

  /** Mapeo efectivo de un mando (por defecto + cambios del usuario) */
  getMapping(padId) {
    return { ...DEFAULT_MAPPING, ...(state.mappings[padId] || {}) };
  },

  setMapping(padId, action, buttons) {
    if (!ACTIONS.includes(action)) return;
    state.mappings[padId] = { ...(state.mappings[padId] || {}), [action]: buttons };
    persist();
    bus.emit('config:change', { key: 'mappings', value: padId });
  },

  resetMapping(padId) {
    delete state.mappings[padId];
    persist();
    bus.emit('config:change', { key: 'mappings', value: padId });
  },

  /** Restablece todos los ajustes de fábrica */
  reset() {
    state = sanitize(null);
    persist();
    bus.emit('config:change', { key: '*', value: null });
  },
};
