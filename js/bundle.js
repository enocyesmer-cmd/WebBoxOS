/* WebBox OS — bundle generado por tools/build.py. No editar a mano. */
(function () {
  'use strict';
  const __modules = Object.create(null);
  __modules["js/core/events.js"] = function (module, exports, __require) {
/**
 * Bus de eventos mínimo. Desacopla las entradas (teclado, mando, mouse)
 * de la lógica de navegación y de la interfaz.
 *
 * Eventos usados en WebBox OS:
 *  - 'action'             { action, source }   acción de navegación unificada
 *  - 'gamepad:connect'    { index, id, name }
 *  - 'gamepad:disconnect' { index, id, name }
 *  - 'gamepad:button'     { index, button, pressed, id }   (crudo, para pruebas)
 *  - 'gamepad:frame'      [ { index, buttons, axes } ]     (solo si hay observadores)
 *  - 'config:change'      { key, value }
 *  - 'focus:change'       { el, prev }
 */
class EventBus {
  #listeners = new Map();

  on(type, fn) {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.#listeners.get(type)?.delete(fn);
  }

  emit(type, detail) {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (err) {
        console.error(`[bus] error en listener de "${type}":`, err);
      }
    }
  }
}

const bus = new EventBus();
    Object.assign(exports, { EventBus, bus });
  };
  __modules["js/core/storage.js"] = function (module, exports, __require) {
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

const storage = {
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
    Object.assign(exports, { storage });
  };
  __modules["js/core/config.js"] = function (module, exports, __require) {
/**
 * Configuración persistente de WebBox OS.
 * Valida lo leído de localStorage, expone get/set y avisa por el bus.
 */
const { bus } = __require("js/core/events.js");
const { storage } = __require("js/core/storage.js");

const ACTIONS = ['up', 'down', 'left', 'right', 'ok', 'back', 'home'];

/**
 * Mapeo por defecto (layout "standard" de la Gamepad API).
 * Otros mandos pueden numerar distinto: por eso cada mando (identificado por
 * su `id`) puede tener su propio mapeo, editable desde Configuración.
 */
const DEFAULT_MAPPING = Object.freeze({
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  ok: [0],
  back: [1],
  home: [9, 16],
});

/** Milisegundos entre repeticiones para sensibilidad 1..5 */
const REPEAT_INTERVALS = [260, 200, 150, 110, 80];

const DEFAULTS = {
  sensitivity: 3,
  stickDeadzone: 0.5,
  stickNav: true,
  keyboardThrottle: true,
  background: 'aurora',
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

const config = {
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
    Object.assign(exports, { ACTIONS, DEFAULT_MAPPING, REPEAT_INTERVALS, config });
  };
  __modules["js/core/focus.js"] = function (module, exports, __require) {
/**
 * Administrador centralizado del foco.
 *
 * - Solo UN elemento tiene el foco a la vez (clase `is-focused`).
 * - Navegación espacial: busca el elemento más cercano en la dirección pedida
 *   usando la geometría real en pantalla (getBoundingClientRect).
 * - "Zonas" (data-zone): movimientos verticales se quedan dentro de la zona;
 *   los horizontales pueden saltar a otra zona (p. ej. de las tarjetas al menú
 *   lateral) y recuerdan el último elemento enfocado de esa zona.
 * - "Ámbitos" (scopes): un overlay puede bloquear el foco dentro de sí mismo.
 *
 * Los elementos navegables se marcan con el atributo `data-focusable`.
 */
const { bus } = __require("js/core/events.js");

const HORIZONTAL = new Set(['left', 'right']);

function isUsable(el) {
  return el.getClientRects().length > 0 && el.getAttribute('aria-disabled') !== 'true';
}

class FocusManager {
  constructor(defaultRoot) {
    this.defaultRoot = defaultRoot;
    this.scopes = [];
    this.current = null;
    this.zoneMemory = new Map();
    /** 'smooth' o 'auto' (sin animación) */
    this.scrollBehavior = 'smooth';
  }

  get scope() {
    return this.scopes.length ? this.scopes[this.scopes.length - 1] : this.defaultRoot;
  }

  /** Elementos enfocables y visibles dentro del ámbito activo */
  candidates() {
    return Array.from(this.scope.querySelectorAll('[data-focusable]')).filter(isUsable);
  }

  isInScope(el) {
    return Boolean(el) && this.scope.contains(el) && isUsable(el);
  }

  byFid(fid) {
    if (!fid) return null;
    return this.candidates().find((el) => el.dataset.fid === fid) ?? null;
  }

  /** Da el foco a un elemento (y quita el anterior). */
  set(el, { scroll = true } = {}) {
    if (!el) return;
    if (this.current === el) {
      if (scroll) this.reveal(el);
      return;
    }
    const prev = this.current;
    if (prev) prev.classList.remove('is-focused');

    this.current = el;
    el.classList.add('is-focused');
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* elemento no enfocable por el navegador: no es grave */
    }

    const zone = el.dataset.zone;
    if (zone) this.zoneMemory.set(zone, el);

    if (scroll) this.reveal(el);
    el.dispatchEvent(new CustomEvent('tvfocus', { bubbles: true }));
    bus.emit('focus:change', { el, prev });
  }

  clear() {
    if (this.current) this.current.classList.remove('is-focused');
    this.current = null;
  }

  /** Desplaza los contenedores para que el elemento quede centrado. */
  reveal(el) {
    if (el.hasAttribute('data-noreveal')) return;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: this.scrollBehavior });
  }

  /** Enfoca el primer candidato que cumpla el selector (o el primero en general). */
  focusFirst(selector = null, opts) {
    let list = this.candidates();
    if (selector) {
      const filtered = list.filter((el) => el.matches(selector));
      if (filtered.length) list = filtered;
    }
    if (!list.length) return false;
    this.set(list[0], opts);
    return true;
  }

  focusByFid(fid, opts) {
    const el = this.byFid(fid);
    if (el) this.set(el, opts);
    return Boolean(el);
  }

  pushScope(root) {
    this.scopes.push(root);
  }

  popScope() {
    this.scopes.pop();
    this.clear();
  }

  activate() {
    if (this.current && this.current.isConnected) this.current.click();
  }

  #pickDefault(cands) {
    return cands.find((c) => c.dataset.zone === 'main') ?? cands[0];
  }

  /** Al cambiar de zona, vuelve al último elemento recordado de esa zona. */
  #zoneTarget(zone, cands) {
    const remembered = this.zoneMemory.get(zone);
    const rememberedOk = remembered && cands.includes(remembered) ? remembered : null;
    const marked = cands.find((c) => c.dataset.zone === zone && c.classList.contains('is-current'));
    return zone === 'nav' ? marked || rememberedOk : rememberedOk || marked;
  }

  /**
   * Mueve el foco en una dirección: 'up' | 'down' | 'left' | 'right'.
   * Devuelve true si el foco cambió.
   */
  move(dir) {
    const cands = this.candidates();
    if (!cands.length) return false;

    const cur = this.current;
    if (!cur || !cands.includes(cur)) {
      this.set(this.#pickDefault(cands));
      return true;
    }

    const a = cur.getBoundingClientRect();
    const acx = a.left + a.width / 2;
    const acy = a.top + a.height / 2;
    const zone = cur.dataset.zone;
    const horizontal = HORIZONTAL.has(dir);

    let best = null;

    // Pasada 1: misma zona. Movimiento horizontal exige solapamiento vertical
    // (para no saltar de una fila a otra al llegar al final).
    // Pasada 2 (solo horizontal): otras zonas, con tolerancia vertical.
    for (let pass = 1; pass <= (horizontal ? 2 : 1); pass += 1) {
      const found = [];
      for (const el of cands) {
        if (el === cur) continue;
        const sameZone = el.dataset.zone === zone;
        if ((pass === 1) !== sameZone) continue;

        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - acx;
        const dy = b.top + b.height / 2 - acy;

        let primary;
        let cross;
        let ok;
        switch (dir) {
          case 'left':
            ok = dx < -Math.min(a.width, b.width) * 0.25;
            primary = -dx;
            cross = Math.abs(dy);
            break;
          case 'right':
            ok = dx > Math.min(a.width, b.width) * 0.25;
            primary = dx;
            cross = Math.abs(dy);
            break;
          case 'up':
            ok = dy < -Math.min(a.height, b.height) * 0.25;
            primary = -dy;
            cross = Math.abs(dx);
            break;
          case 'down':
            ok = dy > Math.min(a.height, b.height) * 0.25;
            primary = dy;
            cross = Math.abs(dx);
            break;
          default:
            return false;
        }
        if (!ok) continue;
        if (horizontal && pass === 1 && cross > Math.max(a.height, b.height) * 0.6) continue;
        found.push({ el, primary, cross });
      }
      if (!found.length) continue;

      if (horizontal) {
        // Horizontal: el más cercano ponderando la desalineación vertical.
        let bestScore = Infinity;
        for (const f of found) {
          const score = f.primary + f.cross * 4;
          if (score < bestScore) {
            bestScore = score;
            best = f.el;
          }
        }
      } else {
        // Vertical: primero la fila (o columna) más cercana; dentro de ella,
        // el elemento más alineado con el actual. Así nunca se salta una fila.
        const nearest = Math.min(...found.map((f) => f.primary));
        const band = nearest + a.height * 0.5;
        let bestCross = Infinity;
        for (const f of found) {
          if (f.primary > band) continue;
          if (f.cross < bestCross) {
            bestCross = f.cross;
            best = f.el;
          }
        }
      }
      if (best) break;
    }

    if (!best) {
      this.bump(cur, dir);
      return false;
    }

    if (best.dataset.zone !== zone) {
      const target = this.#zoneTarget(best.dataset.zone, cands);
      if (target) best = target;
    }
    this.set(best);
    return true;
  }

  /** Pequeño "rebote" cuando no hay nada más en esa dirección. */
  bump(el, dir) {
    const cls = `bump-${dir}`;
    el.classList.remove(cls);
    // Fuerza reflow para poder reiniciar la animación.
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}
    Object.assign(exports, { FocusManager });
  };
  __modules["js/input/gamepad.js"] = function (module, exports, __require) {
/**
 * Administrador de mandos con la Gamepad API.
 *
 * - Eventos `gamepadconnected` / `gamepaddisconnected` + escaneo por polling
 *   (algunos navegadores no avisan hasta que se pulsa un botón).
 * - Polling con requestAnimationFrame: navigator.getGamepads() devuelve una
 *   "foto" nueva en cada llamada, por eso se consulta en cada fotograma.
 * - Mapeo configurable por mando (config.getMapping(pad.id)).
 * - Palancas (ejes 0 y 1) con zona muerta configurable.
 * - Anti-rebote: primer disparo inmediato, retardo inicial y luego repetición
 *   a un intervalo que depende de la sensibilidad.
 * - Modo captura: permite asignar el siguiente botón pulsado a una acción.
 *
 * Publica en el bus: 'action', 'gamepad:connect', 'gamepad:disconnect',
 * 'gamepad:button' y 'gamepad:frame' (este último solo si `watching`).
 */
const { bus } = __require("js/core/events.js");
const { config } = __require("js/core/config.js");

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
/** Acciones que, mantenidas, sacan de la pantalla de prueba */
const EXIT_ACTIONS = ['back', 'home'];
const EXIT_HOLD_MS = 1000;

/** "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e ...)" -> "Xbox 360 Controller" */
function cleanPadName(id = '') {
  const name = id.replace(/\s*\(.*\)\s*$/, '').trim();
  return name || id || 'Mando desconocido';
}

class GamepadManager {
  constructor() {
    this.pads = new Map();
    this.running = false;
    this.watching = false;
    this.rafId = 0;
    this.captureCb = null;
    this.captureTimer = 0;
    /** Función que devuelve true mientras la pantalla de prueba está activa */
    this.testModeProvider = null;
    this.tick = this.tick.bind(this);
  }

  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  start() {
    if (this.running || !this.supported) return;
    this.running = true;
    window.addEventListener('gamepadconnected', (e) => this.#connect(e.gamepad));
    window.addEventListener('gamepaddisconnected', (e) => this.#disconnect(e.gamepad.index));
    this.#scan();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Activa/desactiva el envío de 'gamepad:frame' (pantalla de prueba). */
  setWatching(value) {
    this.watching = Boolean(value);
  }

  /** Información de los mandos conectados. */
  getPads() {
    return [...this.pads.values()].map((st) => ({
      index: st.index,
      id: st.id,
      name: cleanPadName(st.id),
      mapping: st.mapping,
      buttonCount: st.buttonCount,
      axisCount: st.axisCount,
    }));
  }

  /**
   * Espera el próximo botón pulsado en cualquier mando.
   * @param {(button:number, pad:{index:number,id:string})=>void} onButton
   * @param {number} timeoutMs
   * @param {()=>void} [onTimeout]
   */
  captureNext(onButton, timeoutMs = 8000, onTimeout) {
    this.cancelCapture();
    this.captureCb = onButton;
    this.captureTimer = setTimeout(() => {
      if (!this.captureCb) return;
      this.captureCb = null;
      onTimeout?.();
    }, timeoutMs);
  }

  cancelCapture() {
    this.captureCb = null;
    clearTimeout(this.captureTimer);
  }

  get capturing() {
    return this.captureCb !== null;
  }

  // ---------------------------------------------------------------- interno

  #scan() {
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.connected) this.#connect(pad);
    }
  }

  #connect(pad) {
    if (!pad || this.pads.has(pad.index)) return;
    const st = {
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      buttonCount: pad.buttons.length,
      axisCount: pad.axes.length,
      prev: [],
      held: new Map(),
      exitHold: new Map(),
      // Ignora todo hasta que se suelten los botones: el primer botón que
      // "despierta" al mando no debe activar nada en la interfaz.
      suppress: true,
    };
    this.pads.set(pad.index, st);
    bus.emit('gamepad:connect', { index: pad.index, id: pad.id, name: cleanPadName(pad.id) });
  }

  #disconnect(index) {
    const st = this.pads.get(index);
    if (!st) return;
    this.pads.delete(index);
    bus.emit('gamepad:disconnect', { index, id: st.id, name: cleanPadName(st.id) });
  }

  /**
   * En la pantalla de prueba los botones NO navegan (si no, no se podría
   * probar la cruceta ni B). Se sale manteniendo Atrás o Inicio 1 segundo.
   */
  #testModeExit(st, active, now) {
    st.held.clear();
    for (const action of EXIT_ACTIONS) {
      if (!active.has(action)) {
        st.exitHold.delete(action);
        continue;
      }
      const since = st.exitHold.get(action);
      if (since === undefined) {
        st.exitHold.set(action, now);
      } else if (now - since >= EXIT_HOLD_MS) {
        st.exitHold.clear();
        st.suppress = true; // espera a que suelte el botón
        bus.emit('action', { action, source: 'gamepad', padIndex: st.index });
        return;
      }
    }
  }

  tick(now) {
    if (!this.running) return;
    this.poll(now);
    this.rafId = requestAnimationFrame(this.tick);
  }

  poll(now) {
    const list = navigator.getGamepads();
    const seen = new Set();
    const frame = this.watching ? [] : null;

    for (const pad of list) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      if (!this.pads.has(pad.index)) this.#connect(pad);
      this.#process(pad, this.pads.get(pad.index), now, frame);
    }

    // Desconexión detectada por polling (por si el navegador no emitió el evento)
    for (const index of [...this.pads.keys()]) {
      if (!seen.has(index)) this.#disconnect(index);
    }

    if (frame) bus.emit('gamepad:frame', frame);
  }

  #process(pad, st, now, frame) {
    st.buttonCount = pad.buttons.length;
    st.axisCount = pad.axes.length;

    const down = pad.buttons.map((b) => b.pressed || b.value > 0.5);

    // Eventos crudos de botones (pantalla de prueba y captura de mapeo)
    for (let i = 0; i < down.length; i += 1) {
      const was = Boolean(st.prev[i]);
      if (down[i] === was) continue;
      bus.emit('gamepad:button', { index: pad.index, button: i, pressed: down[i], id: pad.id });
      if (down[i] && this.captureCb) {
        const cb = this.captureCb;
        this.cancelCapture();
        st.suppress = true;
        cb(i, { index: pad.index, id: pad.id });
      }
    }
    st.prev = down;

    if (frame) {
      frame.push({
        index: pad.index,
        buttons: pad.buttons.map((b) => ({ pressed: b.pressed || b.value > 0.5, value: b.value })),
        axes: Array.from(pad.axes),
      });
    }

    // Acciones activas ahora mismo
    const mapping = config.getMapping(pad.id);
    const active = new Set();
    for (const [action, buttons] of Object.entries(mapping)) {
      if (buttons.some((b) => down[b])) active.add(action);
    }
    if (config.get('stickNav')) {
      const dz = config.get('stickDeadzone');
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.abs(x) >= Math.abs(y)) {
        if (x <= -dz) active.add('left');
        else if (x >= dz) active.add('right');
      } else if (y <= -dz) active.add('up');
      else if (y >= dz) active.add('down');
    }

    if (st.suppress) {
      st.held.clear();
      if (active.size === 0 && !down.some(Boolean)) st.suppress = false;
      return;
    }
    if (this.captureCb) {
      st.held.clear();
      return;
    }
    if (this.testModeProvider?.() === true) {
      this.#testModeExit(st, active, now);
      return;
    }
    st.exitHold.clear();

    for (const action of active) {
      const rec = st.held.get(action);
      if (!rec) {
        bus.emit('action', { action, source: 'gamepad', padIndex: pad.index });
        st.held.set(action, { next: now + config.repeatDelay() });
      } else if (DIRECTIONS.has(action) && now >= rec.next) {
        bus.emit('action', { action, source: 'gamepad', padIndex: pad.index });
        rec.next = now + config.repeatInterval();
      }
    }
    for (const action of [...st.held.keys()]) {
      if (!active.has(action)) st.held.delete(action);
    }
  }
}
    Object.assign(exports, { cleanPadName, GamepadManager });
  };
  __modules["js/input/keyboard.js"] = function (module, exports, __require) {
/**
 * Entrada de teclado. También cubre los controles remotos Bluetooth que se
 * comportan como teclado (flechas, Enter, Atrás/Escape, Inicio).
 * Traduce teclas a acciones y las publica en el bus.
 */
const { bus } = __require("js/core/events.js");
const { config } = __require("js/core/config.js");

const KEY_MAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'ok',
  ' ': 'ok',
  Escape: 'back',
  Backspace: 'back',
  BrowserBack: 'back',
  GoBack: 'back',
  Home: 'home',
  BrowserHome: 'home',
  h: 'home',
};

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

class KeyboardInput {
  constructor() {
    this.lastMove = 0;
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = KEY_MAP[key];
    if (!action) return;
    e.preventDefault();

    const now = performance.now();
    if (e.repeat) {
      // Solo las direcciones se repiten, y respetando la sensibilidad.
      if (!DIRECTIONS.has(action)) return;
      if (config.get('keyboardThrottle') && now - this.lastMove < config.repeatInterval()) return;
    }
    if (DIRECTIONS.has(action)) this.lastMove = now;

    bus.emit('action', { action, source: 'keyboard' });
  }
}
    Object.assign(exports, { KeyboardInput });
  };
  __modules["js/data/apps.js"] = function (module, exports, __require) {
/**
 * Datos de ejemplo del Launcher (Fase 1: sin aplicaciones reales todavía).
 */

const APPS = [
  { id: 'youtube', name: 'YouTube', icon: 'youtube', c1: '#b91c1c', c2: '#f87171', screen: 'youtube' },
  { id: 'movies', name: 'Películas', icon: 'film', c1: '#7c2d12', c2: '#f59e0b', screen: 'movies' },
  { id: 'videos', name: 'Videos', icon: 'play', c1: '#ff5f6d', c2: '#ffa751', screen: 'files', location: 'videos' },
  { id: 'music', name: 'Música', icon: 'music', c1: '#7f5af0', c2: '#2cb1ff', screen: 'music' },
  { id: 'photos', name: 'Fotos', icon: 'photo', c1: '#11998e', c2: '#7ee08f', screen: 'files', location: 'photos' },
  { id: 'browser', name: 'Navegador', icon: 'globe', c1: '#2563eb', c2: '#22d3ee' },
  { id: 'games', name: 'Juegos', icon: 'gamepad', c1: '#e11d74', c2: '#9333ea', screen: 'games' },
  { id: 'tv', name: 'TV en vivo', icon: 'tv', c1: '#f59e0b', c2: '#ef4444' },
  { id: 'files', name: 'Archivos', icon: 'folder', c1: '#475569', c2: '#94a3b8', screen: 'files' },
  { id: 'news', name: 'Noticias', icon: 'book', c1: '#0ea5e9', c2: '#6366f1' },
];

/** Orden de la fila "Aplicaciones favoritas" */
const FAVORITES = ['youtube', 'movies', 'videos', 'music', 'photos', 'browser', 'games', 'tv', 'files'];

/** Recientes iniciales (después se actualizan al abrir aplicaciones) */
const DEFAULT_RECENTS = ['browser', 'photos', 'music'];

/** Contenido de ejemplo para "Recomendado para ti" */
const RECOMMENDED = [
  { id: 'rec-1', name: 'Noches de ciencia', subtitle: 'Documental · ejemplo', icon: 'rocket', c1: '#1e3a8a', c2: '#7c3aed' },
  { id: 'rec-2', name: 'Rutas de montaña', subtitle: 'Naturaleza · ejemplo', icon: 'mountain', c1: '#065f46', c2: '#34d399' },
  { id: 'rec-3', name: 'Cine clásico', subtitle: 'Película · ejemplo', icon: 'film', c1: '#7c2d12', c2: '#f59e0b' },
  { id: 'rec-4', name: 'Lista para concentrarse', subtitle: 'Música · ejemplo', icon: 'music', c1: '#312e81', c2: '#ec4899' },
  { id: 'rec-5', name: 'Torneo de la semana', subtitle: 'Juegos · ejemplo', icon: 'gamepad', c1: '#831843', c2: '#fb7185' },
  { id: 'rec-6', name: 'Recuerdos del verano', subtitle: 'Fotos · ejemplo', icon: 'photo', c1: '#0c4a6e', c2: '#38bdf8' },
];

/** Fondos disponibles (archivos en assets/backgrounds) */
const BACKGROUNDS = [
  { id: 'aurora', name: 'Aurora', file: 'assets/backgrounds/aurora.svg' },
  { id: 'ocean', name: 'Océano', file: 'assets/backgrounds/ocean.svg' },
  { id: 'sunset', name: 'Atardecer', file: 'assets/backgrounds/sunset.svg' },
  { id: 'graphite', name: 'Grafito', file: 'assets/backgrounds/graphite.svg' },
];

/** Carpetas de contenido que el usuario puede indicar en Aplicaciones. */
const MEDIA_LOCATIONS = [
  { key: 'photos', label: 'Fotos', icon: 'photo' },
  { key: 'videos', label: 'Videos', icon: 'film' },
];
    Object.assign(exports, { APPS, FAVORITES, DEFAULT_RECENTS, RECOMMENDED, BACKGROUNDS, MEDIA_LOCATIONS });
  };
  __modules["js/data/logos.js"] = function (module, exports, __require) {
/**
 * Logotipos a color de las aplicaciones (SVG propio, viewBox 48x48).
 * YouTube usa su forma reconocible (rectángulo rojo con triángulo blanco).
 * Cualquier aplicación sin logo aquí usa el icono de trazo por defecto.
 */
const LOGOS = {
  youtube:
    '<rect x="3" y="10" width="42" height="28" rx="9" fill="#ff0000"/><path d="M20 17.5v13l11-6.5z" fill="#fff"/>',
  movies:
    '<rect x="5" y="7" width="38" height="34" rx="6" fill="#f59e0b"/><g fill="#fff"><rect x="8" y="10" width="4" height="4" rx="1"/><rect x="8" y="18" width="4" height="4" rx="1"/><rect x="8" y="26" width="4" height="4" rx="1"/><rect x="8" y="34" width="4" height="4" rx="1"/><rect x="36" y="10" width="4" height="4" rx="1"/><rect x="36" y="18" width="4" height="4" rx="1"/><rect x="36" y="26" width="4" height="4" rx="1"/><rect x="36" y="34" width="4" height="4" rx="1"/></g><path d="M20 17v14l11-7z" fill="#7c2d12"/>',
  videos:
    '<circle cx="24" cy="24" r="20" fill="#ff5f6d"/><circle cx="24" cy="24" r="20" fill="url(#g-videos)"/><path d="M19.500 15.500v17l14-8.500z" fill="#fff"/><defs><linearGradient id="g-videos" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f6d"/><stop offset="1" stop-color="#ffa751"/></linearGradient></defs>',
  music:
    '<circle cx="24" cy="24" r="20" fill="url(#g-music)"/><path d="M20 31.500V16.500l11-2.500v14" fill="none" stroke="#fff" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="32" r="3.600" fill="#fff"/><circle cx="28" cy="29" r="3.600" fill="#fff"/><defs><linearGradient id="g-music" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7f5af0"/><stop offset="1" stop-color="#2cb1ff"/></linearGradient></defs>',
  photos:
    '<g opacity=".92"><ellipse cx="24" cy="13" rx="7" ry="11" fill="#ea4335"/><ellipse cx="35" cy="24" rx="11" ry="7" fill="#fbbc04"/><ellipse cx="24" cy="35" rx="7" ry="11" fill="#34a853"/><ellipse cx="13" cy="24" rx="11" ry="7" fill="#4285f4"/></g>',
  browser:
    '<circle cx="24" cy="24" r="20" fill="#2563eb"/><g fill="none" stroke="#fff" stroke-width="2.200" stroke-linecap="round"><circle cx="24" cy="24" r="13"/><path d="M11 24h26M24 11c5 5 5 21 0 26M24 11c-5 5-5 21 0 26"/></g>',
  games:
    '<path d="M14 15h20a9 9 0 0 1 8.700 11.300l-1.500 6a4.800 4.800 0 0 1-8.400 1.700L30 29H18l-2.800 5a4.800 4.800 0 0 1-8.400-1.700l-1.500-6A9 9 0 0 1 14 15z" fill="url(#g-games)"/><path d="M16 20v8M12 24h8" stroke="#fff" stroke-width="2.600" stroke-linecap="round"/><circle cx="31" cy="22" r="2" fill="#fff"/><circle cx="36" cy="26" r="2" fill="#fff"/><defs><linearGradient id="g-games" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e11d74"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs>',
  tv:
    '<rect x="4" y="9" width="40" height="26" rx="5" fill="#ef4444"/><rect x="8" y="13" width="32" height="18" rx="2.500" fill="#fde68a"/><path d="M15 41h18M24 35v6" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>',
  files:
    '<path d="M4 13a4 4 0 0 1 4-4h11l4 5h17a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#fbbf24"/><path d="M4 20h40v15a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#f59e0b"/>',
  news:
    '<rect x="6" y="6" width="36" height="36" rx="7" fill="#0ea5e9"/><rect x="11" y="12" width="14" height="10" rx="2" fill="#fff"/><path d="M29 13h8M29 18h8M11 28h26M11 34h19" stroke="#fff" stroke-width="2.600" stroke-linecap="round"/>',
};

/** Marcado SVG del logo de una aplicación, o '' si no tiene. */
function logo(id, cls = '') {
  const body = LOGOS[id];
  if (!body) return '';
  return `<svg class="logo ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>`;
}
    Object.assign(exports, { LOGOS, logo });
  };
  __modules["js/icons.js"] = function (module, exports, __require) {
/**
 * Iconos SVG propios (trazo de 24x24, sin dependencias externas).
 */
const PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  gamepad: '<path d="M7 8h10a4 4 0 0 1 3.9 4.9l-.8 3.6a2.4 2.4 0 0 1-4.2.9L14.5 15h-5l-1.4 2.4a2.4 2.4 0 0 1-4.2-.9l-.8-3.6A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11" r=".6"/><circle cx="17.5" cy="13" r=".6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3L16 12l4 4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  film: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  back: '<path d="M9 6 3 12l6 6"/><path d="M3 12h11a6 6 0 0 1 6 6"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/>',
  rocket: '<path d="M12 3c3 2 5 5.500 5 9l-2 3H9l-2-3c0-3.500 2-7 5-9z"/><circle cx="12" cy="10" r="1.6"/><path d="M9 15l-2 4M15 15l2 4"/>',
  book: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  youtube: '<rect x="3" y="5.5" width="18" height="13" rx="4"/><path d="m10.2 9.2 4.6 2.8-4.6 2.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  move: '<path d="M5 12h14M13 6l6 6-6 6"/><path d="M5 5v14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  playsolid: '<path d="M8 5.5v13l11-6.5z"/>',
  back10: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/><path d="M10 9.5v5M13 9.5h2.2v5H13z"/>',
  fwd10: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/><path d="M10 9.5v5M13 9.5h2.2v5H13z"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 3.5v-12L7.500 9.500z"/><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5l4.5 3.5v-12L7.500 9.500z"/><path d="m16 9.500 5 5M21 9.500l-5 5"/>',
  prev: '<path d="M6 5v14M18 5.500v13L9 12z"/>',
  next: '<path d="M18 5v14M6 5.500v13L15 12z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.500a1.500 1.500 0 0 1-1.500 1.500h-10A1.500 1.500 0 0 1 5 18.500v-10A1.500 1.500 0 0 1 6.500 7H11"/>',
  mountain: '<path d="m3 19 6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6.5" r="1.5"/>',
};

/** Devuelve el marcado SVG de un icono. */
function icon(name, cls = '') {
  const body = PATHS[name] ?? PATHS.star;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Rellena todos los elementos con data-icon="nombre" dentro de root. */
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon);
  }
}
    Object.assign(exports, { icon, hydrateIcons });
  };
  __modules["js/ui.js"] = function (module, exports, __require) {
/** Utilidades de interfaz compartidas. */

/** Escapa texto para insertarlo con seguridad en innerHTML. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Muestra un aviso breve en pantalla (máximo 3 a la vez). */
function toast(message, ms = 2800) {
  const host = document.getElementById('toasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();

  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 700);
  }, ms);
}
    Object.assign(exports, { esc, toast });
  };
  __modules["js/launcher.js"] = function (module, exports, __require) {
/**
 * Launcher: pantalla de inicio (filas de tarjetas) y pantalla de aplicaciones.
 * No maneja entradas directamente: las tarjetas son elementos `data-focusable`
 * y el administrador de foco hace `click()` al pulsar OK.
 *
 * Doble pulsación (dos clics, o OK dos veces seguidas) sobre una tarjeta abre el
 * menú de edición (cambiar icono, eliminar). Una sola pulsación abre la aplicación
 * tras una pequeña espera para poder distinguirla de la doble.
 */
const { APPS, FAVORITES, RECOMMENDED, DEFAULT_RECENTS, MEDIA_LOCATIONS } = __require("js/data/apps.js");
const { logo } = __require("js/data/logos.js");
const { icon } = __require("js/icons.js");
const { storage } = __require("js/core/storage.js");
const { esc } = __require("js/ui.js");

const APP_BY_ID = new Map(APPS.map((a) => [a.id, a]));
const REC_BY_ID = new Map(RECOMMENDED.map((r) => [r.id, r]));
const MAX_RECENTS = 8;
const DOUBLE_PRESS_MS = 350;

class Launcher {
  /**
   * @param {{homeEl:HTMLElement, appsEl:HTMLElement, onOpen:(item:object)=>void,
   *   onMenu:(item:object)=>void, onChooseLocation:(key:string)=>void,
   *   getLocations:()=>Record<string,{name:string}>}} opts
   */
  constructor({ homeEl, appsEl, onOpen, onMenu, onChooseLocation, getLocations }) {
    this.homeEl = homeEl;
    this.appsEl = appsEl;
    this.onOpen = onOpen;
    this.onMenu = onMenu;
    this.onChooseLocation = onChooseLocation;
    this.getLocations = getLocations ?? (() => ({}));
    this.recents = this.#loadRecents();
    this.hidden = new Set(storage.get('hiddenCards', []));
    this.icons = this.#loadIcons();
    this.pending = null;

    const handler = (e) => {
      const loc = e.target.closest('[data-act="loc-choose"]');
      if (loc) {
        this.onChooseLocation?.(loc.dataset.loc);
        return;
      }
      if (e.target.closest('[data-act="restore-hidden"]')) {
        this.restoreAll();
        return;
      }
      const card = e.target.closest('[data-kind]');
      if (!card) return;
      const item =
        card.dataset.kind === 'app'
          ? APP_BY_ID.get(card.dataset.id)
          : REC_BY_ID.get(card.dataset.id);
      if (!item) return;
      this.#press(card.dataset.kind, item);
    };
    homeEl.addEventListener('click', handler);
    appsEl.addEventListener('click', handler);
  }

  /** Una pulsación espera; una segunda dentro del plazo abre el menú en lugar de la aplicación. */
  #press(kind, item) {
    const key = `${kind}:${item.id}`;
    const payload = { ...item, kind };
    if (this.pending?.key === key) {
      clearTimeout(this.pending.timer);
      this.pending = null;
      this.onMenu?.(payload);
      return;
    }
    clearTimeout(this.pending?.timer);
    const timer = setTimeout(() => {
      this.pending = null;
      this.onOpen(payload);
    }, DOUBLE_PRESS_MS);
    this.pending = { key, timer };
  }

  render() {
    const favorites = FAVORITES.filter((id) => !this.hidden.has(id));
    const recs = RECOMMENDED.filter((r) => !this.hidden.has(r.id));
    const apps = APPS.filter((a) => !this.hidden.has(a.id));

    this.homeEl.innerHTML = `
      ${this.#row('favorites', 'Aplicaciones favoritas', 'star', favorites.map((id) => this.#appCard(APP_BY_ID.get(id), 'fav')).join('') || this.#emptyRow())}
      ${this.#row('recents', 'Recientes', 'clock', this.#recentsHTML())}
      ${this.#row('recommended', 'Recomendado para ti', 'film', recs.map((r) => this.#recCard(r)).join('') || this.#emptyRow())}
    `;

    this.appsEl.innerHTML = `
      <h1 class="screen-title">Aplicaciones</h1>
      ${this.#locationsHTML()}
      <p class="apps-tip">Pulsa dos veces una aplicación para cambiar su icono o eliminarla.</p>
      <div class="grid">${apps.map((a) => this.#appCard(a, 'all')).join('')}</div>
      ${this.#restoreHTML()}
    `;
  }

  /** Registra una aplicación abierta y refresca la fila de recientes. */
  recordRecent(appId) {
    if (!APP_BY_ID.has(appId)) return;
    this.recents = [appId, ...this.recents.filter((id) => id !== appId)].slice(0, MAX_RECENTS);
    storage.set('recents', this.recents);
    const track = this.homeEl.querySelector('[data-track="recents"]');
    if (track) track.innerHTML = this.#recentsHTML();
  }

  // ------------------------------------------------- edición de tarjetas

  hasCustomIcon(id) {
    return Boolean(this.icons[id]);
  }

  setIcon(id, dataUrl) {
    this.icons[id] = dataUrl;
    storage.set('cardIcons', this.icons);
    this.render();
  }

  resetIcon(id) {
    delete this.icons[id];
    storage.set('cardIcons', this.icons);
    this.render();
  }

  hide(id) {
    this.hidden.add(id);
    storage.set('hiddenCards', [...this.hidden]);
    this.render();
  }

  restoreAll() {
    if (!this.hidden.size) return;
    this.hidden.clear();
    storage.set('hiddenCards', []);
    this.render();
    this.onRestored?.();
  }

  hiddenCount() {
    return this.hidden.size;
  }

  // ---------------------------------------------------------------- interno

  #loadIcons() {
    const saved = storage.get('cardIcons', {});
    const out = {};
    if (saved && typeof saved === 'object') {
      for (const [id, url] of Object.entries(saved)) {
        if (typeof url === 'string' && url.startsWith('data:image/')) out[id] = url;
      }
    }
    return out;
  }

  #loadRecents() {
    const saved = storage.get('recents', null);
    const list = Array.isArray(saved)
      ? saved.filter((id) => APP_BY_ID.has(id))
      : DEFAULT_RECENTS.slice();
    return list.slice(0, MAX_RECENTS);
  }

  #recentsHTML() {
    const list = this.recents.filter((id) => !this.hidden.has(id));
    if (!list.length) return '<p class="row-empty">Aún no has abierto aplicaciones.</p>';
    return list.map((id) => this.#appCard(APP_BY_ID.get(id), 'recent')).join('');
  }

  #emptyRow() {
    return '<p class="row-empty">Nada por aquí. Puedes restaurar lo eliminado desde Aplicaciones.</p>';
  }

  #locationsHTML() {
    const saved = this.getLocations();
    const rows = MEDIA_LOCATIONS.map((loc) => {
      const info = saved[loc.key];
      const where = info ? esc(info.name) : 'Sin elegir';
      return `
        <div class="loc-row${info ? ' is-set' : ''}" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="loc:${loc.key}" data-act="loc-choose" data-loc="${loc.key}">
          <span class="loc-ico">${icon(loc.icon)}</span>
          <span class="loc-text"><b>${esc(loc.label)}</b><small>${where}</small></span>
          <span class="loc-action">${info ? 'Cambiar' : 'Elegir carpeta'}</span>
        </div>`;
    }).join('');
    return `
      <section class="locations" aria-label="Dónde están tus archivos">
        <h2 class="locations-title"><span class="row-icon">${icon('folder')}</span>Dónde están tus archivos</h2>
        <p class="locations-sub">Indica la carpeta de tus fotos y videos. Al abrir esas aplicaciones, el Gestor de archivos entra directo ahí.</p>
        <div class="locations-list">${rows}</div>
      </section>`;
  }

  #restoreHTML() {
    if (!this.hidden.size) return '';
    const n = this.hidden.size;
    return `
      <div class="apps-restore">
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="apps:restore" data-act="restore-hidden">${icon('reset')}Restaurar ${n === 1 ? 'el elemento eliminado' : `los ${n} elementos eliminados`}</div>
      </div>`;
  }

  #row(id, title, iconName, cards) {
    return `
      <section class="row" data-row="${id}">
        <h2 class="row-title"><span class="row-icon">${icon(iconName)}</span>${esc(title)}</h2>
        <div class="row-track" data-track="${id}">${cards}</div>
      </section>`;
  }

  /** Arte de la tarjeta: foto propia > logo a color > icono de trazo. */
  #art(item) {
    const custom = this.icons[item.id];
    if (custom) return `<span class="card-art card-art--plate"><img class="card-img" src="${custom}" alt=""></span>`;
    const svg = logo(item.id);
    if (svg) return `<span class="card-art card-art--plate">${svg}</span>`;
    return `<span class="card-art">${icon(item.icon)}</span>`;
  }

  #appCard(app, prefix) {
    return `
      <div class="card" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="app" data-id="${app.id}" data-fid="${prefix}:${app.id}"
           style="--c1:${app.c1};--c2:${app.c2}" aria-label="${esc(app.name)}">
        ${this.#art(app)}
        <span class="card-label">${esc(app.name)}</span>
      </div>`;
  }

  #recCard(item) {
    return `
      <div class="card card--wide" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="rec" data-id="${item.id}" data-fid="rec:${item.id}"
           style="--c1:${item.c1};--c2:${item.c2}" aria-label="${esc(item.name)}">
        ${this.#art(item)}
        <span class="card-label">${esc(item.name)}</span>
        <span class="card-sub">${esc(item.subtitle)}</span>
      </div>`;
  }
}
    Object.assign(exports, { DOUBLE_PRESS_MS, Launcher });
  };
  __modules["js/backgroundStore.js"] = function (module, exports, __require) {
/**
 * Almacenamiento persistente de los fondos personalizados de WebBox OS.
 * Cada imagen se guarda como Blob en IndexedDB (nunca como base64 en ajustes),
 * así que se pueden importar varios y siguen disponibles al reabrir el navegador.
 */
const DB_NAME = 'webbox-backgrounds';
const DB_VERSION = 1;
const STORE_NAME = 'wallpapers';
const LEGACY_KEY = 'custom'; // el único fondo que guardaba la versión anterior
const MAX_BACKGROUND_SIZE = 20 * 1024 * 1024;
const MAX_BACKGROUNDS = 30;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador no permite guardar fondos personalizados.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('No se pudo abrir el almacenamiento de fondos.'));
    };
    request.onblocked = () => reject(new Error('Cierra otras pestañas de WebBox OS e inténtalo de nuevo.'));
  });
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el fondo.'));
    tx.onabort = () => reject(tx.error || new Error('El guardado del fondo fue cancelado.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo leer el fondo.'));
  });
}

/** Valor de configuración que representa un fondo propio: "custom:<id>". */
const customValue = (id) => `custom:${id}`;

/** Id de almacenamiento a partir del valor de configuración ("custom" antiguo o "custom:<id>"). */
function customIdFromValue(value) {
  if (value === 'custom') return LEGACY_KEY;
  if (typeof value === 'string' && value.startsWith('custom:')) return value.slice(7);
  return null;
}

/** Guarda una imagen nueva y devuelve su id. */
async function addBackground(file) {
  if (!(file instanceof Blob)) throw new Error('Selecciona una imagen válida.');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Formato no compatible. Usa JPG, PNG, WEBP, GIF, AVIF o BMP.');
  }
  if (file.size <= 0) throw new Error('La imagen está vacía.');
  if (file.size > MAX_BACKGROUND_SIZE) throw new Error('La imagen supera el límite de 20 MB.');

  const db = await openDb();
  const count = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count());
  if (count >= MAX_BACKGROUNDS) throw new Error(`Ya tienes ${MAX_BACKGROUNDS} fondos. Elimina alguno para agregar otro.`);

  const id = `bg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({
    id,
    blob: file,
    name: String(file.name || 'Fondo personalizado').slice(0, 180),
    type: file.type,
    updatedAt: Date.now(),
  });
  await transactionDone(tx);
  return id;
}

/** Todos los fondos propios, del más antiguo al más nuevo: [{ id, name, blob }]. */
async function listBackgrounds() {
  const db = await openDb();
  const records = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  return records
    .filter((r) => r?.blob instanceof Blob)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .map(({ id, name, blob }) => ({ id, name, blob }));
}

/** Blob de un fondo propio, o null si ya no existe. */
async function getBackground(id) {
  const db = await openDb();
  const record = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id));
  return record?.blob instanceof Blob ? record.blob : null;
}

/** Elimina un fondo propio. */
async function deleteBackground(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}
    Object.assign(exports, { customValue, customIdFromValue, addBackground, listBackgrounds, getBackground, deleteBackground });
  };
  __modules["js/api.js"] = function (module, exports, __require) {
/**
 * Cliente de la API del catálogo (servidor Node + MySQL, ver server/).
 *
 * Si no hay servidor (python -m http.server, doble clic con file://, sin red),
 * `api.online` es false y WebBox OS sigue funcionando con el almacenamiento
 * local del navegador, igual que antes. Nada se rompe.
 *
 * Leer el catálogo es público. Agregar o eliminar exige la clave de
 * administrador (ADMIN_KEY del .env), que se guarda solo en este navegador.
 */
const { storage } = __require("js/core/storage.js");

const KEY_NAME = 'serverAdminKey';
const TIMEOUT_MS = 5000;

class ApiClient {
  constructor() {
    this.state = 'unknown'; // 'unknown' | 'online' | 'offline'
    this.store = null; // 'mysql' | 'memory'
    this.items = [];
    this.loadPromise = null;
  }

  get online() {
    return this.state === 'online';
  }

  getKey() {
    return storage.get(KEY_NAME, '') || '';
  }

  hasKey() {
    return this.getKey() !== '';
  }

  setKey(key) {
    const clean = String(key ?? '').trim();
    if (clean) storage.set(KEY_NAME, clean);
    else storage.remove(KEY_NAME);
  }

  clearKey() {
    storage.remove(KEY_NAME);
  }

  /** Nunca lanza: devuelve { ok, status, data }. status 0 = sin conexión. */
  async #request(method, path, { body, auth = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) headers['X-Admin-Key'] = this.getKey();
      const res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      let data = null;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** ¿Hay un servidor de WebBox OS respondiendo? */
  async check() {
    const r = await this.#request('GET', 'api/health');
    if (r.ok && r.data && r.data.ok === true) {
      this.state = 'online';
      this.store = r.data.store || null;
    } else {
      this.state = 'offline';
      this.store = null;
    }
    return this.online;
  }

  /**
   * Descarga todo el catálogo en UNA petición compartida por las tres
   * pantallas. Devuelve la lista, o null si no hay servidor.
   */
  loadAll(force = false) {
    if (!this.loadPromise || force) {
      this.loadPromise = (async () => {
        if (!(await this.check())) {
          this.items = [];
          return null;
        }
        const r = await this.#request('GET', 'api/items');
        if (!r.ok || !r.data || !Array.isArray(r.data.items)) {
          this.state = 'offline';
          this.items = [];
          return null;
        }
        this.items = r.data.items;
        return this.items;
      })();
    }
    return this.loadPromise;
  }

  /** Cantidad de elementos por tipo (según la última descarga). */
  counts() {
    const out = { youtube: 0, music: 0, movies: 0 };
    for (const item of this.items) {
      if (item.kind in out) out[item.kind] += 1;
    }
    return out;
  }

  /** @returns {Promise<{ok:true,item:object}|{ok:false,status:number,error?:string}>} */
  async create(item) {
    if (!this.hasKey()) return { ok: false, status: 401, error: 'Falta la clave de administrador.' };
    const r = await this.#request('POST', 'api/items', { body: item, auth: true });
    if (r.ok && r.data && r.data.item) return { ok: true, item: r.data.item };
    return { ok: false, status: r.status, error: r.data && r.data.error };
  }

  async remove(serverId) {
    if (!this.hasKey()) return { ok: false, status: 401, error: 'Falta la clave de administrador.' };
    const r = await this.#request('DELETE', `api/items/${encodeURIComponent(serverId)}`, { auth: true });
    return { ok: r.ok, status: r.status, error: r.data && r.data.error };
  }

  /** ¿La clave guardada es la correcta? */
  async checkKey() {
    if (!this.hasKey()) return false;
    const r = await this.#request('GET', 'api/auth', { auth: true });
    return r.ok;
  }
}

const api = new ApiClient();
    Object.assign(exports, { api });
  };
  __modules["js/settings.js"] = function (module, exports, __require) {
/**
 * Pantalla de Configuración.
 * Pestañas: Dispositivo · Mando · Prueba de botones · Navegación · Fondo · Pantalla.
 *
 * Todo es navegable con el foco central: las pestañas (zona "settings-tabs")
 * cambian de panel al recibir el foco; los controles del panel pertenecen a la
 * zona "settings-panel". Los ajustes numéricos usan botones − / + en lugar de
 * deslizadores, porque son mucho más cómodos con un mando.
 */
const { config, ACTIONS, REPEAT_INTERVALS } = __require("js/core/config.js");
const { storage } = __require("js/core/storage.js");
const { bus } = __require("js/core/events.js");
const { icon } = __require("js/icons.js");
const { BACKGROUNDS } = __require("js/data/apps.js");
const { listBackgrounds, addBackground, deleteBackground, customValue } = __require("js/backgroundStore.js");
const { DOUBLE_PRESS_MS } = __require("js/launcher.js");
const { api } = __require("js/api.js");
const { esc, toast } = __require("js/ui.js");

const TABS = [
  { id: 'device', label: 'Dispositivo', icon: 'tv' },
  { id: 'gamepad', label: 'Mando', icon: 'gamepad' },
  { id: 'test', label: 'Prueba de botones', icon: 'check' },
  { id: 'navigation', label: 'Navegación', icon: 'compass' },
  { id: 'background', label: 'Fondo', icon: 'photo' },
  { id: 'display', label: 'Pantalla', icon: 'sun' },
  { id: 'server', label: 'Servidor', icon: 'globe' },
];

const ACTION_LABELS = {
  up: 'Arriba',
  down: 'Abajo',
  left: 'Izquierda',
  right: 'Derecha',
  ok: 'OK / Seleccionar',
  back: 'Atrás',
  home: 'Inicio',
};

/** Nombres de botones del layout "standard" de la Gamepad API */
const STANDARD_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3',
  12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →', 16: 'Guía',
};

const SENSITIVITY_LABELS = ['Muy lenta', 'Lenta', 'Media', 'Rápida', 'Muy rápida'];

const STEPS = {
  sensitivity: { min: 1, max: 5, step: 1 },
  stickDeadzone: { min: 0.2, max: 0.8, step: 0.1 },
  uiScale: { min: 70, max: 140, step: 5 },
  overscan: { min: 0, max: 8, step: 1 },
};

const round2 = (n) => Math.round(n * 100) / 100;

function buttonLabel(index, standard) {
  return standard && STANDARD_NAMES[index] ? `${index} · ${STANDARD_NAMES[index]}` : `Botón ${index}`;
}

class SettingsScreen {
  /**
   * @param {{root:HTMLElement, focus:import('./core/focus.js').FocusManager,
   *          gamepad:import('./input/gamepad.js').GamepadManager}} opts
   */
  constructor({ root, focus, gamepad, onBackgroundMenu, server }) {
    this.root = root;
    this.focus = focus;
    this.gamepad = gamepad;
    this.onBackgroundMenu = onBackgroundMenu;
    this.server = server; // { onSetKey, onRetry, onUpload }
    this.pendingBg = null;
    this.active = 'device';
    this.capturing = null; // acción que se está remapeando
    this.confirmReset = false;
    this.live = new Map(); // index -> { cells, bars }
    this.customBackgrounds = new Map(); // id -> { url, name }
    this.customBackgroundsLoaded = false;
    this.customBackgroundLoading = false;

    root.innerHTML = `
      <div class="settings">
        <h1 class="screen-title">Configuración</h1>
        <div class="settings-body">
          <nav class="settings-tabs" aria-label="Secciones"></nav>
          <section class="settings-panel" aria-live="polite"></section>
        </div>
      </div>`;
    this.tabsEl = root.querySelector('.settings-tabs');
    this.panelEl = root.querySelector('.settings-panel');

    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('change', (e) => {
      if (e.target.matches?.('[data-bg-upload]')) this.#onBackgroundUpload(e.target);
    });
    // Las pestañas cambian el panel en cuanto reciben el foco.
    root.addEventListener('tvfocus', (e) => {
      const tab = e.target.closest?.('[data-tab]');
      if (tab) this.#setTab(tab.dataset.tab);
    });

    bus.on('gamepad:connect', () => this.#liveRefresh());
    bus.on('gamepad:disconnect', () => this.#liveRefresh());
    bus.on('gamepad:frame', (frame) => this.#onFrame(frame));
    bus.on('gamepad:button', (ev) => this.#onRawButton(ev));
    bus.on('config:change', ({ key }) => {
      if (key === '*') this.rerender(true);
    });
    window.addEventListener('resize', () => {
      if (this.active === 'device' && !this.root.hidden) this.rerender(false);
    });
  }

  render() {
    this.#renderTabs();
    this.#renderPanel();
  }

  /** Se llama al entrar en la pantalla para refrescar datos. */
  refresh() {
    this.rerender(false);
  }

  /** true mientras la prueba de botones está a la vista (el mando no navega). */
  isTestActive() {
    return this.active === 'test' && !this.root.hidden;
  }

  /** Foco inicial al entrar desde el menú: la pestaña activa. */
  focusEntry() {
    this.focus.focusByFid(`tab:${this.active}`) || this.focus.focusFirst('[data-zone="settings-tabs"]');
  }

  /** Atrás: si se estaba remapeando un botón, cancela. Devuelve true si lo consumió. */
  handleBack() {
    if (!this.capturing) return false;
    this.cancelCapture();
    toast('Asignación cancelada');
    return true;
  }

  cancelCapture() {
    if (!this.capturing) return;
    this.gamepad.cancelCapture();
    this.capturing = null;
    this.rerender(true);
  }

  /** Re-dibuja el panel conservando el foco cuando estaba dentro del panel. */
  rerender(keepFocus = true) {
    const cur = this.focus.current;
    const fid = keepFocus && cur && cur.closest('.settings-panel') ? cur.dataset.fid : null;
    this.#renderPanel();
    if (fid) {
      if (!this.focus.focusByFid(fid, { scroll: false })) {
        this.focus.focusByFid(`tab:${this.active}`, { scroll: false });
      }
    }
  }

  // ------------------------------------------------------------- pestañas

  #renderTabs() {
    this.tabsEl.innerHTML = TABS.map(
      (t) => `
      <div class="tab${t.id === this.active ? ' active' : ''}" role="button" tabindex="-1"
           data-focusable data-zone="settings-tabs" data-fid="tab:${t.id}" data-tab="${t.id}">
        ${icon(t.icon)}<span>${esc(t.label)}</span>
      </div>`,
    ).join('');
  }

  #setTab(id) {
    if (id === this.active) return;
    if (this.capturing) this.cancelCapture();
    this.active = id;
    for (const el of this.tabsEl.children) el.classList.toggle('active', el.dataset.tab === id);
    this.gamepad.setWatching(id === 'test');
    this.#renderPanel();
  }

  #renderPanel() {
    this.live.clear();
    const render = {
      device: () => this.#deviceHTML(),
      gamepad: () => this.#gamepadHTML(),
      test: () => this.#testHTML(),
      navigation: () => this.#navigationHTML(),
      background: () => this.#backgroundHTML(),
      display: () => this.#displayHTML(),
      server: () => this.#serverHTML(),
    }[this.active];
    this.panelEl.innerHTML = render();
    this.gamepad.setWatching(this.active === 'test');
    if (this.active === 'test') this.#cacheLive();
    this.panelEl.scrollTop = 0;
    if (this.active === 'background') this.#loadCustomBackgroundPreview();
  }

  // ----------------------------------------------------------- bloques UI

  #stepper(key, title, desc, valueText) {
    return `
      <div class="setting">
        <div class="setting-info"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>
        <div class="stepper">
          <div class="step" role="button" tabindex="-1" data-focusable data-zone="settings-panel"
               data-fid="step:${key}:-" data-act="step" data-key="${key}" data-delta="-1" aria-label="Disminuir">−</div>
          <span class="value">${esc(valueText)}</span>
          <div class="step" role="button" tabindex="-1" data-focusable data-zone="settings-panel"
               data-fid="step:${key}:+" data-act="step" data-key="${key}" data-delta="1" aria-label="Aumentar">+</div>
        </div>
      </div>`;
  }

  #toggle(key, title, desc) {
    const on = config.get(key);
    return `
      <div class="setting" role="switch" aria-checked="${on}" tabindex="-1" data-focusable
           data-zone="settings-panel" data-fid="toggle:${key}" data-act="toggle" data-key="${key}">
        <div class="setting-info"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>
        <div class="switch${on ? ' on' : ''}"><i></i></div>
      </div>`;
  }

  #action(act, fid, title, desc, iconName, extra = '') {
    return `
      <div class="setting" role="button" tabindex="-1" data-focusable data-zone="settings-panel"
           data-fid="${fid}" data-act="${act}" ${extra}>
        <div class="setting-info"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>
        <span class="setting-icon">${icon(iconName)}</span>
      </div>`;
  }

  // ----------------------------------------------------------- Dispositivo

  #deviceHTML() {
    const rows = [
      ['Sistema', 'WebBox OS 0.1.0 (Fase 1)'],
      ['Modelo simulado', 'WebBox Box — Android TV simulado'],
      ['Ventana', `${window.innerWidth} × ${window.innerHeight} px (×${window.devicePixelRatio})`],
      ['Pantalla del equipo', `${screen.width} × ${screen.height} px`],
      ['Idioma', navigator.language || 'es'],
      ['Contexto seguro (HTTPS/localhost)', window.isSecureContext ? 'Sí' : 'No'],
      ['Gamepad API', this.gamepad.supported ? 'Disponible' : 'No disponible'],
      ['Preferencias', storage.available ? 'Guardadas en localStorage' : 'Solo en memoria (sesión)'],
      ['Navegador', navigator.userAgent],
    ];
    return `
      <h2 class="panel-title">Información del dispositivo</h2>
      <dl class="info-list">
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      </dl>`;
  }

  // ----------------------------------------------------------------- Mando

  #gamepadHTML() {
    const pads = this.gamepad.getPads();
    if (!this.gamepad.supported) {
      return `<h2 class="panel-title">Estado del control remoto</h2>
        <p class="notice">Este navegador no ofrece la Gamepad API.</p>`;
    }
    if (!pads.length) {
      return `
        <h2 class="panel-title">Estado del control remoto</h2>
        <div class="status-card off">
          <span class="dot"></span>
          <div><h3>Sin mando conectado</h3>
          <p>Conecta el mando desde los ajustes Bluetooth del equipo y pulsa cualquier botón.
          El navegador solo lo muestra después de esa primera pulsación.</p></div>
        </div>`;
    }

    const pad = pads[0];
    const mapping = config.getMapping(pad.id);
    const standard = pad.mapping === 'standard';
    const list = pads
      .map(
        (p) => `
        <div class="status-card on">
          <span class="dot"></span>
          <div><h3>${esc(p.name)}</h3>
          <p>${p.buttonCount} botones · ${p.axisCount} ejes · mapeo del navegador: ${p.mapping || 'no estándar'}</p></div>
        </div>`,
      )
      .join('');

    const rows = ACTIONS.map((action) => {
      const listening = this.capturing === action;
      const text = listening
        ? 'Pulsa un botón del mando… (Atrás/Esc cancela)'
        : mapping[action].map((b) => buttonLabel(b, standard)).join(' o ');
      return `
        <div class="setting${listening ? ' listening' : ''}" role="button" tabindex="-1" data-focusable
             data-zone="settings-panel" data-fid="map:${action}" data-act="remap" data-action="${action}">
          <div class="setting-info"><h3>${esc(ACTION_LABELS[action])}</h3>
          <p>Pulsa OK para cambiar el botón asignado</p></div>
          <span class="pill${listening ? ' pulse' : ''}">${esc(text)}</span>
        </div>`;
    }).join('');

    return `
      <h2 class="panel-title">Estado del control remoto</h2>
      ${list}
      <h2 class="panel-title sub">Asignación de botones — ${esc(pad.name)}</h2>
      ${rows}
      ${this.#action('reset-mapping', 'map:reset', 'Restablecer asignación', 'Vuelve al mapeo por defecto de este mando', 'reset')}`;
  }

  // ----------------------------------------------------------------- Prueba

  #testHTML() {
    const pads = this.gamepad.getPads();
    if (!pads.length) {
      return `
        <h2 class="panel-title">Prueba de botones</h2>
        <div class="status-card off">
          <span class="dot"></span>
          <div><h3>No se detecta ningún mando</h3>
          <p>Conéctalo por Bluetooth y pulsa un botón. Aquí verás cada botón y cada eje en vivo.</p></div>
        </div>`;
    }
    const notice = `
      <p class="notice test-notice">En esta pantalla el mando <b>no navega</b>, para que puedas probar todos sus botones.
      Para salir con el mando, <b>mantén Atrás (o Inicio) durante 1 segundo</b>. El teclado y el mouse siguen funcionando.</p>`;
    const cards = pads
      .map((p) => {
        const standard = p.mapping === 'standard';
        const cells = Array.from({ length: p.buttonCount }, (_, i) =>
          `<div class="btn-cell" data-b="${i}"><span>${esc(buttonLabel(i, standard))}</span></div>`).join('');
        const axes = Array.from({ length: p.axisCount }, (_, i) =>
          `<div class="axis" data-a="${i}"><label>Eje ${i}</label>
             <div class="axis-bar"><i></i></div><output>0.00</output></div>`).join('');
        return `
        <section class="pad-card" data-pad="${p.index}">
          <header><h3>${esc(p.name)}</h3>
          <p>${esc(p.id)}</p>
          <p>${p.buttonCount} botones · ${p.axisCount} ejes · mapeo: ${p.mapping || 'no estándar'}</p></header>
          <div class="btn-grid">${cells}</div>
          <div class="axes">${axes}</div>
          <p class="last-btn">Último botón pulsado: <b data-last>—</b></p>
        </section>`;
      })
      .join('');
    return `<h2 class="panel-title">Prueba de botones</h2>${notice}${cards}`;
  }

  #cacheLive() {
    for (const card of this.panelEl.querySelectorAll('[data-pad]')) {
      this.live.set(Number(card.dataset.pad), {
        cells: [...card.querySelectorAll('[data-b]')],
        axes: [...card.querySelectorAll('[data-a]')].map((el) => ({
          dot: el.querySelector('i'),
          out: el.querySelector('output'),
        })),
        last: card.querySelector('[data-last]'),
      });
    }
  }

  #onFrame(frame) {
    if (this.active !== 'test' || this.root.hidden) return;
    for (const pad of frame) {
      const view = this.live.get(pad.index);
      if (!view) {
        this.rerender(true);
        return;
      }
      pad.buttons.forEach((b, i) => {
        const cell = view.cells[i];
        if (cell) cell.classList.toggle('down', b.pressed);
      });
      pad.axes.forEach((v, i) => {
        const axis = view.axes[i];
        if (!axis) return;
        axis.dot.style.left = `${50 + v * 50}%`;
        axis.out.textContent = v.toFixed(2);
      });
    }
  }

  #onRawButton({ index, button, pressed }) {
    if (!pressed || this.active !== 'test') return;
    const view = this.live.get(index);
    if (view?.last) view.last.textContent = `Botón ${button}`;
  }

  /** Conexión/desconexión: refresca paneles que dependen del estado del mando. */
  #liveRefresh() {
    if (this.active === 'gamepad' || this.active === 'test') this.rerender(true);
  }

  // ------------------------------------------------------------ Navegación

  #navigationHTML() {
    const s = config.get('sensitivity');
    return `
      <h2 class="panel-title">Navegación</h2>
      ${this.#stepper('sensitivity', 'Sensibilidad de navegación',
        'Velocidad de repetición al mantener pulsada una dirección',
        `${SENSITIVITY_LABELS[s - 1]} · ${REPEAT_INTERVALS[s - 1]} ms`)}
      ${this.#toggle('stickNav', 'Navegar con la palanca izquierda', 'Usa los ejes 0 y 1 como flechas')}
      ${this.#stepper('stickDeadzone', 'Zona muerta de la palanca',
        'Cuánto hay que inclinarla antes de moverse (evita derivas)',
        `${Math.round(config.get('stickDeadzone') * 100)} %`)}
      ${this.#toggle('keyboardThrottle', 'Limitar repetición del teclado',
        'Aplica la misma sensibilidad al mantener una flecha pulsada')}
      <p class="notice">Las asignaciones de botones se cambian en la sección <b>Mando</b>.</p>`;
  }

  // ----------------------------------------------------------------- Fondo

  #backgroundHTML() {
    const current = config.get('background');
    const tiles = BACKGROUNDS.map(
      (b) => `
      <div class="bg-tile${b.id === current ? ' selected' : ''}" role="button" tabindex="-1" data-focusable
           data-zone="settings-panel" data-fid="bg:${b.id}" data-act="bg" data-id="${b.id}"
           style="background-image:url('${b.file}')">
        <span>${esc(b.name)}</span>
        <span class="tick">${icon('check')}</span>
      </div>`,
    ).join('');
    return `
      <h2 class="panel-title">Fondo de pantalla</h2>
      <p class="background-description">Elige uno de los fondos incluidos o importa tus propias imágenes. Pulsa dos veces un fondo tuyo para eliminarlo.</p>
      ${this.#action('bg-add', 'bg:add', 'Importar fondo', 'Selecciona una imagen JPG, PNG, WEBP, GIF, AVIF o BMP (máximo 20 MB). Puedes importar varias.', 'plus')}
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" data-bg-upload hidden>
      <div class="bg-grid" data-bg-grid>${tiles}</div>`;
  }

  async #loadCustomBackgroundPreview() {
    if (this.customBackgroundsLoaded) {
      this.#syncCustomBackgroundTiles();
      return;
    }
    if (this.customBackgroundLoading) return;
    this.customBackgroundLoading = true;
    try {
      const list = await listBackgrounds();
      for (const { id, name, blob } of list) {
        if (!this.customBackgrounds.has(id)) {
          this.customBackgrounds.set(id, { url: URL.createObjectURL(blob), name });
        }
      }
      this.customBackgroundsLoaded = true;
      this.#syncCustomBackgroundTiles();
    } catch (error) {
      console.warn('[WebBox OS] No se pudieron cargar los fondos personalizados.', error);
    } finally {
      this.customBackgroundLoading = false;
    }
  }

  /** Dibuja una casilla por cada fondo importado, al final de la cuadrícula. */
  #syncCustomBackgroundTiles() {
    const grid = this.panelEl.querySelector('[data-bg-grid]');
    if (!grid || this.active !== 'background') return;
    for (const old of grid.querySelectorAll('[data-custom]')) old.remove();
    const current = config.get('background');
    let number = 0;
    for (const [id, { url }] of this.customBackgrounds) {
      number += 1;
      const value = customValue(id);
      const tile = document.createElement('div');
      tile.className = `bg-tile bg-tile--custom${current === value ? ' selected' : ''}`;
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '-1');
      tile.setAttribute('data-focusable', '');
      tile.setAttribute('data-custom', '');
      tile.dataset.zone = 'settings-panel';
      tile.dataset.fid = `bg:${value}`;
      tile.dataset.act = 'bg';
      tile.dataset.id = value;
      tile.style.backgroundImage = `url("${url}")`;
      tile.innerHTML = `<span>Mi fondo ${number}</span><span class="tick">${icon('check')}</span>`;
      grid.append(tile);
    }
  }

  async #onBackgroundUpload(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const id = await addBackground(file);
      this.customBackgrounds.set(id, { url: URL.createObjectURL(file), name: file.name });
      this.customBackgroundsLoaded = true;
      config.set('background', customValue(id));
      this.rerender(true);
      toast(`Fondo importado: ${file.name}`);
    } catch (error) {
      toast(error?.message || 'No se pudo importar el fondo.', 4200);
    }
  }

  /** Doble pulsación sobre un fondo propio: ofrece eliminarlo. */
  #openBackgroundMenu(value) {
    this.onBackgroundMenu?.({
      title: 'Fondo importado',
      subtitle: 'Elige qué hacer con este fondo.',
      fallbackFid: 'bg:add',
      actions: [
        {
          id: 'delete-bg',
          label: 'Eliminar fondo',
          icon: 'trash',
          danger: true,
          onSelect: () => this.#deleteCustomBackground(value),
        },
      ],
    });
  }

  async #deleteCustomBackground(value) {
    const id = value.slice('custom:'.length);
    try {
      await deleteBackground(id);
    } catch (error) {
      toast(error?.message || 'No se pudo eliminar el fondo.', 4200);
      return;
    }
    const entry = this.customBackgrounds.get(id);
    if (entry) URL.revokeObjectURL(entry.url);
    this.customBackgrounds.delete(id);
    if (config.get('background') === value) config.set('background', 'aurora');
    this.rerender(false);
    toast('Fondo eliminado');
  }

  // ---------------------------------------------------------------- Pantalla

  #displayHTML() {
    return `
      <h2 class="panel-title">Opciones de pantalla</h2>
      ${this.#stepper('uiScale', 'Tamaño de la interfaz', 'Escala todo el sistema (útil según la distancia al televisor)',
        `${config.get('uiScale')} %`)}
      ${this.#stepper('overscan', 'Margen de seguridad (overscan)', 'Aleja los bordes si tu TV recorta la imagen',
        `${config.get('overscan')} %`)}
      ${this.#toggle('reduceMotion', 'Reducir animaciones', 'Desactiva transiciones y desplazamientos animados')}
      ${this.#toggle('clock24', 'Reloj de 24 horas', 'Desactívalo para ver AM/PM')}
      ${this.#toggle('showHints', 'Mostrar ayudas de control', 'Barra inferior con los botones de navegación')}
      ${this.#action('fullscreen', 'act:fullscreen', 'Pantalla completa', 'Alterna pantalla completa (con teclado o mouse; también F11)', 'fullscreen')}
      ${this.#action('reset-all', 'act:reset',
        this.confirmReset ? 'Pulsa de nuevo para confirmar' : 'Restablecer todos los ajustes',
        'Vuelve a los valores de fábrica (no borra los recientes)', 'reset')}`;
  }

  // ------------------------------------------------------------- Servidor

  #serverHTML() {
    const online = api.online;
    const counts = api.counts();
    const storeName = { mysql: 'MySQL', memory: 'Memoria (pruebas: se pierde al apagar)' }[api.store] ?? api.store ?? '—';
    const rows = [
      ['Servidor', online ? 'Conectado' : 'Sin conexión (modo local)'],
      ['Base de datos', online ? storeName : '—'],
      ['En el catálogo', online ? `${counts.youtube} videos · ${counts.music} canciones · ${counts.movies} películas` : '—'],
      ['Clave de administrador', api.hasKey() ? 'Guardada en este navegador' : 'No guardada (solo lectura)'],
    ];
    return `
      <h2 class="panel-title">Servidor y base de datos</h2>
      <div class="status-card ${online ? 'on' : 'off'}">
        <span class="dot"></span>
        <div><h3>${online ? 'Conectado al catálogo compartido' : 'Sin conexión con el servidor'}</h3>
        <p>${online
          ? 'YouTube, Música y Películas muestran lo que hay en la base de datos. Todos ven lo mismo; solo quien tiene la clave agrega o elimina.'
          : 'Se usa solo el almacenamiento de este navegador. Abre WebBox OS desde el servidor (npm start) para usar la base de datos.'}</p></div>
      </div>
      <dl class="info-list" style="margin-bottom:1.2rem">
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      </dl>
      ${this.#action('server-key', 'server:key', 'Clave de administrador', 'Necesaria para agregar o eliminar elementos del catálogo compartido', 'plus')}
      ${api.hasKey() ? this.#action('server-forget', 'server:forget', 'Quitar la clave de este navegador', 'Volverás a ser solo lector', 'trash') : ''}
      ${this.#action('server-retry', 'server:retry', 'Reintentar conexión', 'Vuelve a consultar el servidor', 'reset')}
      ${online ? this.#action('server-upload', 'server:upload', 'Subir lo guardado en este navegador', 'Envía al servidor lo que agregaste antes solo aquí (requiere la clave)', 'plus') : ''}`;
  }

  async #serverRetry() {
    toast('Consultando el servidor…');
    await this.server?.onRetry?.();
    toast(api.online ? 'Conectado al servidor' : 'Sigue sin conexión con el servidor');
    this.rerender(true);
  }

  async #serverUpload() {
    if (!api.hasKey()) {
      toast('Primero escribe la clave de administrador');
      return;
    }
    toast('Subiendo…');
    const r = await this.server?.onUpload?.();
    if (!r) return;
    const parts = [`Subidos: ${r.sent}`];
    if (r.existing) parts.push(`${r.existing} ya estaban`);
    if (r.skipped) parts.push(`${r.skipped} son archivos del equipo (no se suben)`);
    if (r.failed) parts.push(`${r.failed} con error`);
    if (r.stopped) parts.push('se detuvo: clave incorrecta o servidor sin clave');
    toast(parts.join(' · '), 5000);
    this.rerender(true);
  }

  // ---------------------------------------------------------------- eventos

  #onClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      this.#setTab(tab.dataset.tab);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;

    switch (el.dataset.act) {
      case 'step': {
        const { key } = el.dataset;
        const spec = STEPS[key];
        if (!spec) break;
        const next = round2(
          Math.min(spec.max, Math.max(spec.min, config.get(key) + Number(el.dataset.delta) * spec.step)),
        );
        config.set(key, next);
        this.rerender(true);
        break;
      }
      case 'toggle':
        config.set(el.dataset.key, !config.get(el.dataset.key));
        this.rerender(true);
        break;
      case 'bg':
        if (el.dataset.id.startsWith('custom:')) {
          this.#pressCustomBackground(el.dataset.id);
          break;
        }
        config.set('background', el.dataset.id);
        this.rerender(true);
        break;
      case 'bg-add':
        this.panelEl.querySelector('[data-bg-upload]')?.click();
        break;
      case 'remap':
        this.#startCapture(el.dataset.action);
        break;
      case 'reset-mapping': {
        const pad = this.gamepad.getPads()[0];
        if (pad) {
          config.resetMapping(pad.id);
          toast('Asignación restablecida');
          this.rerender(true);
        }
        break;
      }
      case 'server-key':
        this.server?.onSetKey?.();
        break;
      case 'server-forget':
        api.clearKey();
        toast('Clave quitada de este navegador');
        this.rerender(true);
        break;
      case 'server-retry':
        this.#serverRetry();
        break;
      case 'server-upload':
        this.#serverUpload();
        break;
      case 'fullscreen':
        this.#toggleFullscreen();
        break;
      case 'reset-all':
        if (!this.confirmReset) {
          this.confirmReset = true;
          this.rerender(true);
          setTimeout(() => {
            if (!this.confirmReset) return;
            this.confirmReset = false;
            if (this.active === 'display') this.rerender(true);
          }, 3500);
        } else {
          this.confirmReset = false;
          config.reset();
          toast('Ajustes restablecidos');
        }
        break;
      default:
        break;
    }
  }

  /** Una pulsación aplica el fondo; dos seguidas abren el menú para eliminarlo. */
  #pressCustomBackground(value) {
    if (this.pendingBg?.value === value) {
      clearTimeout(this.pendingBg.timer);
      this.pendingBg = null;
      this.#openBackgroundMenu(value);
      return;
    }
    clearTimeout(this.pendingBg?.timer);
    const timer = setTimeout(() => {
      this.pendingBg = null;
      config.set('background', value);
      this.rerender(true);
    }, DOUBLE_PRESS_MS);
    this.pendingBg = { value, timer };
  }

  #startCapture(action) {
    const pads = this.gamepad.getPads();
    if (!pads.length) {
      toast('Conecta un mando para cambiar su asignación');
      return;
    }
    this.capturing = action;
    this.gamepad.captureNext(
      (button, pad) => {
        config.setMapping(pad.id, action, [button]);
        this.capturing = null;
        toast(`${ACTION_LABELS[action]}: botón ${button}`);
        this.rerender(true);
      },
      8000,
      () => {
        this.capturing = null;
        toast('Tiempo agotado, asignación sin cambios');
        this.rerender(true);
      },
    );
    this.rerender(true);
  }

  async #toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast('El navegador no permitió pantalla completa desde aquí. Prueba con F11.');
    }
  }
}
    Object.assign(exports, { SettingsScreen });
  };
  __modules["js/core/media.js"] = function (module, exports, __require) {
/**
 * Utilidades puras para enlaces de video (sin DOM, fáciles de probar).
 * Reconoce enlaces de YouTube (video, lista, shorts, embed, youtu.be, con tiempo)
 * y archivos de video directos (.mp4, .webm...), locales o remotos.
 */
const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
]);
const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{10,64}$/;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv)$/i;
const RELATIVE = 'relative.invalid';

/** "1m30s", "90" -> segundos */
function parseTimeParam(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

/**
 * @returns {{type:'youtube',videoId:string|null,listId:string|null,start:number}
 *          |{type:'video',src:string}|null}
 */
function parseMediaUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return { type: 'youtube', videoId: raw, listId: null, start: 0 };

  let url;
  try {
    url = new URL(raw, `http://${RELATIVE}/`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    let videoId = null;
    if (host === 'youtu.be') videoId = parts[0];
    else if (parts[0] === 'watch') videoId = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) videoId = parts[1];
    if (videoId && !VIDEO_ID.test(videoId)) videoId = null;

    const list = url.searchParams.get('list');
    const listId = list && LIST_ID.test(list) ? list : null;
    if (!videoId && !listId) return null;

    const start = parseTimeParam(url.searchParams.get('t') || url.searchParams.get('start'));
    return { type: 'youtube', videoId, listId, start };
  }

  if (!/^https?:$/.test(url.protocol) || !VIDEO_EXT.test(url.pathname)) return null;
  const src = host === RELATIVE ? (raw.includes('%') ? raw : encodeURI(raw)) : url.href;
  return { type: 'video', src };
}

/** Miniatura automática de YouTube (null si solo hay lista). */
function youtubeThumb(media) {
  return media?.type === 'youtube' && media.videoId
    ? `https://i.ytimg.com/vi/${media.videoId}/hqdefault.jpg`
    : null;
}

/** 83 -> "1:23", 3700 -> "1:01:40" */
function formatTime(total) {
  const s = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
    Object.assign(exports, { parseTimeParam, parseMediaUrl, youtubeThumb, formatTime });
  };
  __modules["js/library.js"] = function (module, exports, __require) {
/**
 * Biblioteca de contenido (YouTube y Películas comparten este módulo).
 * Muestra filas por categoría, un botón "+ Agregar" y abre el reproductor.
 * Lo agregado desde la interfaz se guarda en localStorage; lo de
 * js/data/library.js se mezcla con ello (y se puede ocultar con "Eliminar").
 */
const { storage } = __require("js/core/storage.js");
const { parseMediaUrl, youtubeThumb } = __require("js/core/media.js");
const { icon } = __require("js/icons.js");
const { api } = __require("js/api.js");
const { esc, toast } = __require("js/ui.js");

const PALETTE = [
  ['#7c2d12', '#f59e0b'], ['#1e3a8a', '#7c3aed'], ['#065f46', '#34d399'],
  ['#831843', '#fb7185'], ['#0c4a6e', '#38bdf8'], ['#312e81', '#ec4899'],
  ['#7f1d1d', '#f97316'], ['#134e4a', '#2dd4bf'],
];

/** Mensaje cuando el servidor no aceptó lo agregado (queda guardado en el navegador). */
function serverProblem(status) {
  if (status === 401) {
    return 'Guardado solo en este navegador. Para la base de datos compartida hace falta la clave (Configuración > Servidor).';
  }
  if (status === 429) return 'Demasiados intentos con clave incorrecta. Guardado solo en este navegador.';
  if (status === 503) return 'El servidor no tiene clave de administrador. Guardado solo en este navegador.';
  if (status === 422) return 'El servidor no aceptó este elemento. Guardado solo en este navegador.';
  return 'Sin conexión con el servidor. Guardado solo en este navegador.';
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

class LibraryScreen {
  /**
   * @param {{id:string, root:HTMLElement, defaults:object[], title:string, subtitle:string,
   *   defaultCategory:string, cardStyle:'wide'|'poster', accept:string[], emptyText:string,
   *   cardIcon:string, extraButtons?:{act:string,label:string,icon:string}[],
   *   onPlay:(item:object, lib:LibraryScreen)=>void, onAdd:(lib:LibraryScreen)=>void,
   *   onExtra?:(act:string)=>void}} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.userItems = this.#loadUser();
    this.hidden = new Set(storage.get(`lib:${this.id}:hidden`, []));
    this.remoteItems = []; // catálogo compartido (base de datos)

    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'lib-add') return this.onAdd(this);
      if (act?.dataset.act === 'lib-ext') return this.onExtra?.(act.dataset.extra);
      const card = e.target.closest('[data-kind="lib"]');
      const item = card && this.items().find((i) => i.id === card.dataset.id);
      if (item) this.onPlay(item, this);
      return undefined;
    });
    // 'error' no burbujea: en captura quitamos las imágenes rotas y queda el degradado.
    this.root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.remove();
    }, true);

    this.sync(); // trae el catálogo de la base de datos (si hay servidor)
  }

  // ------------------------------------------------------------------ datos

  #loadUser() {
    const saved = storage.get(`lib:${this.id}:items`, []);
    return Array.isArray(saved) ? saved.filter((i) => i && i.id && i.title && (i.url || i.fileHandleKey)) : [];
  }

  #save() {
    storage.set(`lib:${this.id}:items`, this.userItems);
    storage.set(`lib:${this.id}:hidden`, [...this.hidden]);
  }

  /** Predeterminados (no ocultos) + catálogo compartido + agregados en este navegador. */
  items() {
    const defaults = this.defaults
      .map((d, i) => ({ ...d, id: d.id ?? `def:${i}`, builtin: true }))
      .filter((d) => d.title && d.url && !this.hidden.has(d.id));
    // Si una copia local ya está enlazada con su fila del servidor, se muestra solo la local.
    const linked = new Set(this.userItems.filter((i) => i.serverId).map((i) => i.serverId));
    const remote = this.remoteItems.filter((r) => !linked.has(r.serverId));
    return [...defaults, ...remote, ...this.userItems].map((i) => ({
      ...i,
      category: (i.category || this.defaultCategory).trim() || this.defaultCategory,
    }));
  }

  /** Devuelve el elemento creado, o un string con el error. */
  add({ title, url, category, image, artist }) {
    const media = parseMediaUrl(url);
    if (!media) return 'Enlace no válido. Usa un enlace de YouTube o un archivo .mp4 / .webm.';
    if (!this.accept.includes(media.type)) {
      return this.accept.includes('video')
        ? 'Este enlace no es de video.'
        : 'Aquí solo se aceptan enlaces de YouTube.';
    }
    const item = {
      id: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      title: String(title).trim().slice(0, 120),
      url: String(url).trim(),
      category: String(category || '').trim().slice(0, 40),
      image: String(image || '').trim(),
      artist: String(artist || '').trim().slice(0, 80),
    };
    this.userItems.push(item);
    this.#save();
    this.render();
    this.#pushToServer(item); // en segundo plano; si falla, queda en este navegador
    return item;
  }

  /** Agrega un archivo local a Películas sin copiarlo ni modificarlo. */
  addFileHandle({ title, fileHandleKey, category = this.defaultCategory }) {
    if (this.id !== 'movies') return 'Los archivos locales solo se pueden agregar a Películas.';
    if (!title || !fileHandleKey) return 'No se pudo identificar el archivo local.';
    const item = {
      id: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      title: String(title).replace(/\.[^.]+$/, '').trim().slice(0, 120),
      url: `webbox-file://${encodeURIComponent(fileHandleKey)}`,
      fileHandleKey,
      category: String(category || '').trim().slice(0, 40),
      image: '',
    };
    this.userItems.push(item);
    this.#save();
    this.render();
    return item;
  }

  remove(id) {
    const item = this.items().find((i) => i.id === id);
    const serverId = item?.serverId;

    // Un elemento de la base de datos solo lo puede borrar quien tenga la clave.
    if (serverId) {
      if (!api.online) {
        toast('Sin conexión con el servidor: no se puede eliminar de la base de datos.');
        return;
      }
      if (!api.hasKey()) {
        toast('Para eliminar de la base de datos compartida hace falta la clave (Configuración > Servidor).');
        return;
      }
    }

    const before = this.userItems.length;
    const wasRemote = this.remoteItems.some((r) => r.id === id);
    this.userItems = this.userItems.filter((i) => i.id !== id);
    this.remoteItems = this.remoteItems.filter((r) => r.id !== id && (!serverId || r.serverId !== serverId));
    if (this.userItems.length === before && !wasRemote && !serverId) this.hidden.add(id); // era predeterminado
    this.#save();
    this.render();
    if (serverId) this.#deleteOnServer(item);
  }

  // ------------------------------------------- base de datos (servidor)

  /**
   * Descarga el catálogo compartido del servidor. Sin servidor se queda con lo
   * local, como antes.
   */
  async sync({ render = true } = {}) {
    const all = await api.loadAll();
    const had = this.remoteItems.length;
    this.remoteItems = all
      ? all
          .filter((i) => i.kind === this.id)
          .map((i) => ({ ...i, id: `db:${i.id}`, serverId: i.id, remote: true }))
      : [];

    // Lo agregado antes desde este navegador que ya existe en el servidor se
    // enlaza con su copia, para que no aparezca dos veces.
    let linked = false;
    for (const mine of this.userItems) {
      if (mine.serverId) continue;
      const twin = this.remoteItems.find((r) => r.url === mine.url);
      if (twin) {
        mine.serverId = twin.serverId;
        linked = true;
      }
    }
    if (linked) this.#save();
    if (render && (all || had)) this.render();
  }

  /** Envía a la base de datos, en segundo plano, lo que se acaba de agregar. */
  async #pushToServer(item) {
    if (!api.online) return;
    const result = await api.create({
      kind: this.id,
      title: item.title,
      url: item.url,
      category: item.category,
      image: item.image,
      artist: item.artist,
    });
    if (result.ok) {
      item.serverId = result.item.id;
      this.#save();
      toast('Guardado también en la base de datos');
    } else if (result.status === 409) {
      await api.loadAll(true); // ya existía: se enlaza con la copia del servidor
      await this.sync({ render: false });
    } else {
      toast(serverProblem(result.status));
    }
  }

  async #deleteOnServer(item) {
    const result = await api.remove(item.serverId);
    if (result.ok || result.status === 404) return;
    // No se pudo borrar en el servidor: se restaura para no mentirle al usuario.
    if (item.remote) this.remoteItems.push(item);
    else this.userItems.push(item);
    this.#save();
    this.render();
    toast(
      result.status === 401
        ? 'Clave de administrador incorrecta: no se eliminó de la base de datos.'
        : 'No se pudo eliminar de la base de datos. Se restauró el elemento.',
    );
  }

  /**
   * Sube al servidor lo que solo existía en este navegador.
   * Los archivos locales (webbox-file://) no se suben: son del equipo del usuario.
   */
  async uploadLocal() {
    const result = { sent: 0, existing: 0, skipped: 0, failed: 0, stopped: null };
    for (const item of this.userItems) {
      if (item.serverId) continue;
      if (item.fileHandleKey || !item.url) {
        result.skipped += 1;
        continue;
      }
      const r = await api.create({
        kind: this.id,
        title: item.title,
        url: item.url,
        category: item.category,
        image: item.image,
        artist: item.artist,
      });
      if (r.ok) {
        item.serverId = r.item.id;
        result.sent += 1;
      } else if (r.status === 409) {
        result.existing += 1;
      } else if (r.status === 401 || r.status === 429 || r.status === 503) {
        result.stopped = r.status;
        break;
      } else {
        result.failed += 1;
      }
    }
    this.#save();
    return result;
  }

  fid(id) {
    return `lib:${this.id}:${id}`;
  }

  categories() {
    return [...new Set(this.items().map((i) => i.category))];
  }

  // ----------------------------------------------------------------- vista

  render() {
    const items = this.items();
    const buttons = [
      { act: 'lib-add', label: 'Agregar', icon: 'plus' },
      ...(this.extraButtons ?? []).map((b) => ({ ...b, act: 'lib-ext' })),
    ];
    const actions = buttons
      .map(
        (b, i) => `
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="lib:${this.id}:btn${i}" data-act="${b.act}" data-extra="${esc(b.extra ?? '')}">
          ${icon(b.icon)}${esc(b.label)}
        </div>`,
      )
      .join('');

    const rows = this.categories()
      .map((cat) => {
        const cards = items.filter((i) => i.category === cat).map((i) => this.#card(i)).join('');
        return `
          <section class="row" data-row="${esc(cat)}">
            <h2 class="row-title"><span class="row-icon">${icon(this.cardIcon)}</span>${esc(cat)}</h2>
            <div class="row-track">${cards}</div>
          </section>`;
      })
      .join('');

    this.root.innerHTML = `
      <h1 class="screen-title">${esc(this.title)}</h1>
      <p class="lib-sub">${esc(this.subtitle)}</p>
      <div class="lib-actions">${actions}</div>
      ${items.length ? rows : `<div class="lib-empty">${this.emptyText}</div>`}
    `;
    this.onChange?.();
  }

  #card(item) {
    const media = parseMediaUrl(item.url);
    const img = item.image || youtubeThumb(media);
    const [c1, c2] = PALETTE[hash(item.title) % PALETTE.length];
    const kind = item.fileHandleKey ? 'Archivo local' : (media?.type === 'youtube' ? (media.videoId ? 'YouTube' : 'Lista de YouTube') : 'Archivo de video');
    const poster = this.cardStyle === 'poster';
    return `
      <div class="card ${poster ? 'card--poster' : 'card--wide'}${img ? ' card--media' : ''}"
           role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="lib" data-id="${esc(item.id)}" data-fid="${esc(this.fid(item.id))}"
           style="--c1:${c1};--c2:${c2}" aria-label="${esc(item.title)}">
        ${img ? `<img class="card-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="card-art">${icon(this.cardIcon)}</span>
        <span class="card-label">${esc(item.title)}</span>
        <span class="card-sub">${esc(kind)}</span>
      </div>`;
  }
}
    Object.assign(exports, { LibraryScreen });
  };
  __modules["js/player.js"] = function (module, exports, __require) {
/**
 * Reproductor a pantalla completa para YouTube (IFrame API oficial, con controles
 * propios para mando/teclado) y para archivos de video (<video>).
 *
 * El iframe de YouTube no recibe clics ni teclas (pointer-events:none y disablekb):
 * así el foco nunca se queda "atrapado" dentro y Atrás/Inicio siempre funcionan.
 */
const { parseMediaUrl, formatTime } = __require("js/core/media.js");
const { icon } = __require("js/icons.js");
const { esc, toast } = __require("js/ui.js");

const IDLE_MS = 4000;
const YT_ERRORS = {
  2: 'El enlace del video no es válido.',
  5: 'El reproductor de YouTube tuvo un error.',
  100: 'El video no existe o es privado.',
  101: 'El dueño del video no permite verlo fuera de YouTube.',
  150: 'El dueño del video no permite verlo fuera de YouTube.',
};

let ytPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('sin conexión'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('tiempo agotado')), 15000);
  }).catch((err) => {
    ytPromise = null;
    throw err;
  });
  return ytPromise;
}

// ---------------------------------------------------------------- adaptadores

class YouTubeAdapter {
  constructor(host, media, { onState, onError }) {
    this.host = host;
    this.media = media;
    this.onState = onState;
    this.onError = onError;
    this.p = null;
  }

  async init() {
    await loadYouTubeApi();
    const vars = {
      autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1,
      playsinline: 1, fs: 0, iv_load_policy: 3,
    };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    if (this.media.start) vars.start = this.media.start;
    if (this.media.listId) {
      vars.listType = 'playlist';
      vars.list = this.media.listId;
    }
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('tiempo agotado')), 15000);
      this.p = new window.YT.Player(this.host, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        videoId: this.media.videoId || undefined,
        playerVars: vars,
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => this.onError(YT_ERRORS[e.data] ?? 'No se pudo reproducir el video.'),
        },
      });
    });
  }

  get isList() { return Boolean(this.media.listId); }
  isPlaying() { return [1, 3].includes(this.p?.getPlayerState?.()); }
  toggle() { if (this.isPlaying()) this.p.pauseVideo(); else this.p.playVideo(); }
  seek(delta) { this.p.seekTo(Math.max(0, this.p.getCurrentTime() + delta), true); }
  time() { return [this.p?.getCurrentTime?.() ?? 0, this.p?.getDuration?.() ?? 0]; }
  isMuted() { return Boolean(this.p?.isMuted?.()); }
  toggleMute() { if (this.isMuted()) this.p.unMute(); else this.p.mute(); }
  next() { this.p.nextVideo(); }
  prev() { this.p.previousVideo(); }
  destroy() { try { this.p?.destroy(); } catch { /* ya no existe */ } }
}

class VideoAdapter {
  constructor(host, media, { onState, onError }) {
    this.host = host;
    this.media = media;
    this.onState = onState;
    this.onError = onError;
    this.v = null;
  }

  async init() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.src = this.media.src;
    v.addEventListener('playing', () => this.onState(1));
    v.addEventListener('waiting', () => this.onState(3));
    v.addEventListener('pause', () => this.onState(2));
    v.addEventListener('ended', () => this.onState(0));
    v.addEventListener('error', () =>
      this.onError('No se pudo abrir el archivo. Revisa la ruta y que el formato sea compatible (.mp4 / .webm).'));
    this.host.replaceWith(v);
    this.v = v;
    v.play().catch(() => { /* si el navegador bloquea el autoplay, queda en pausa */ });
  }

  get isList() { return false; }
  isPlaying() { return !this.v.paused && !this.v.ended; }
  toggle() { if (this.v.paused) this.v.play().catch(() => {}); else this.v.pause(); }
  seek(delta) { this.v.currentTime = Math.max(0, this.v.currentTime + delta); }
  time() { return [this.v.currentTime, Number.isFinite(this.v.duration) ? this.v.duration : 0]; }
  isMuted() { return this.v.muted; }
  toggleMute() { this.v.muted = !this.v.muted; }
  next() {}
  prev() {}
  destroy() { this.v?.pause(); this.v?.removeAttribute('src'); this.v?.load(); }
}

class AudioAdapter {
  constructor(host, media, { onState, onError }) {
    this.host = host;
    this.media = media;
    this.onState = onState;
    this.onError = onError;
    this.a = null;
  }

  async init() {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.src = this.media.src;
    a.addEventListener('playing', () => this.onState(1));
    a.addEventListener('waiting', () => this.onState(3));
    a.addEventListener('pause', () => this.onState(2));
    a.addEventListener('ended', () => this.onState(0));
    a.addEventListener('error', () => this.onError('No se pudo reproducir el archivo de audio. Revisa su formato.'));
    this.host.replaceWith(a);
    this.a = a;
    a.play().catch(() => { /* si el navegador bloquea el autoplay, queda en pausa */ });
  }

  isPlaying() { return Boolean(this.a && !this.a.paused && !this.a.ended); }
  toggle() { if (this.a?.paused) this.a.play().catch(() => {}); else this.a?.pause(); }
  seek(delta) {
    if (this.a) this.a.currentTime = Math.max(0, this.a.currentTime + delta);
  }
  time() {
    return [this.a?.currentTime ?? 0, Number.isFinite(this.a?.duration) ? this.a.duration : 0];
  }
  isMuted() { return Boolean(this.a?.muted); }
  toggleMute() { if (this.a) this.a.muted = !this.a.muted; }
  destroy() {
    this.a?.pause();
    this.a?.removeAttribute('src');
    this.a?.load();
  }
}

// ----------------------------------------------------------------- reproductor

class Player {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.adapter = null;
    this.returnFid = null;
    this.item = null;
    this.onDelete = null;
    this.confirmDelete = false;
    this.poll = 0;
    this.idleTimer = 0;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('mousemove', () => this.#show());
  }

  async open(item, { onDelete } = {}) {
    const media = parseMediaUrl(item.url);
    if (!media) {
      toast('Ese enlace no es válido. Elimínalo y vuelve a agregarlo.');
      return;
    }
    return this.#open(item, media, { onDelete });
  }

  /** Abre un archivo local seleccionado desde Archivos o guardado en Películas. */
  async openFile(file, { onDelete, title = file.name } = {}) {
    const audio = file.type?.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|wma)$/i.test(file.name || '');
    const objectUrl = URL.createObjectURL(file);
    return this.#open(
      { title: title || file.name || 'Archivo local', url: objectUrl },
      { type: audio ? 'audio' : 'video', src: objectUrl },
      { onDelete, objectUrl },
    );
  }

  async #open(item, media, { onDelete, objectUrl } = {}) {
    if (this.isOpen) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return;
    }
    this.item = item;
    this.onDelete = onDelete ?? null;
    this.objectUrl = objectUrl ?? null;
    this.confirmDelete = false;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    this.isOpen = true;
    document.body.classList.add('player-open');

    this.el.innerHTML = `
      <div class="player-stage" data-stage><div data-host></div></div>
      ${media.type === 'audio' ? `<div class="player-audio-label">${icon('music')}<span>Reproduciendo audio</span></div>` : ''}
      <div class="player-msg" data-msg>Cargando…</div>
      <div class="player-top"><span class="player-title">${esc(item.title)}</span></div>
      <div class="player-controls">
        <div class="player-bar">
          <span data-cur>0:00</span>
          <div class="player-track"><i data-fill></i></div>
          <span data-dur>0:00</span>
        </div>
        <div class="player-buttons">
          ${this.#btn('toggle', 'playsolid', 'Reproducir')}
          ${this.#btn('back', 'back10', '10 s')}
          ${this.#btn('fwd', 'fwd10', '10 s')}
          ${media.listId ? this.#btn('prev', 'prev', 'Anterior') + this.#btn('next', 'next', 'Siguiente') : ''}
          ${this.#btn('mute', 'volume', 'Sonido')}
          ${media.type !== 'audio' ? this.#btn('full', 'fullscreen', 'Pantalla completa') : ''}
          ${onDelete ? this.#btn('del', 'trash', 'Eliminar') : ''}
          ${this.#btn('close', 'close', 'Cerrar')}
        </div>
      </div>`;
    this.el.classList.toggle('is-audio', media.type === 'audio');
    this.el.classList.remove('is-idle');
    this.el.hidden = false;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusByFid('pl:toggle');
    this.#show();

    const Adapter = media.type === 'youtube' ? YouTubeAdapter : media.type === 'audio' ? AudioAdapter : VideoAdapter;
    const adapter = new Adapter(this.el.querySelector('[data-host]'), media, {
      onState: (state) => this.#onState(state),
      onError: (message) => this.#fail(message),
    });
    this.adapter = adapter;
    try {
      await adapter.init();
    } catch (err) {
      if (this.adapter === adapter) {
        this.#fail(media.type === 'youtube'
          ? `No se pudo cargar YouTube (${err.message}). Revisa tu conexión a internet.`
          : media.type === 'audio' ? 'No se pudo abrir el audio.' : 'No se pudo abrir el video.');
      }
      return;
    }
    if (this.adapter !== adapter) { adapter.destroy(); return; } // se cerró mientras cargaba
    this.el.querySelector('[data-msg]')?.setAttribute('hidden', '');
    this.poll = setInterval(() => this.#tick(), 500);
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    clearInterval(this.poll);
    clearTimeout(this.idleTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.adapter?.destroy();
    this.adapter = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.isOpen = false;
    document.body.classList.remove('player-open');
    this.el.classList.remove('is-audio');
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    if (restore) this.focus.focusByFid(this.returnFid);
  }

  /**
   * Llamar antes de procesar una acción de navegación.
   * Devuelve true si la acción solo sirvió para mostrar los controles ocultos.
   */
  handleAction(action) {
    if (!this.isOpen || action === 'back' || action === 'home') return false;
    const wasIdle = this.el.classList.contains('is-idle');
    this.#show();
    return wasIdle;
  }

  // ---------------------------------------------------------------- interno

  #btn(act, ico, label) {
    return `
      <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="player"
           data-fid="pl:${act}" data-act="pl-${act}" data-label>
        <span data-ico>${icon(ico)}</span><span data-text>${esc(label)}</span>
      </div>`;
  }

  #setBtn(act, ico, label) {
    const b = this.el.querySelector(`[data-act="pl-${act}"]`);
    if (!b) return;
    b.querySelector('[data-ico]').innerHTML = icon(ico);
    b.querySelector('[data-text]').textContent = label;
  }

  #show() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.adapter?.isPlaying()) this.el.classList.add('is-idle');
    }, IDLE_MS);
  }

  #onState(state) {
    const playing = state === 1 || state === 3;
    this.#setBtn('toggle', playing ? 'pause' : 'playsolid', playing ? 'Pausa' : 'Reproducir');
    if (!playing) this.#show();
  }

  #fail(message) {
    const msg = this.el.querySelector('[data-msg]');
    if (msg) {
      msg.textContent = message;
      msg.removeAttribute('hidden');
    }
    this.#show();
    toast(message, 5000);
  }

  #tick() {
    if (!this.adapter) return;
    const [cur, dur] = this.adapter.time();
    this.el.querySelector('[data-cur]').textContent = formatTime(cur);
    this.el.querySelector('[data-dur]').textContent = dur ? formatTime(dur) : '--:--';
    this.el.querySelector('[data-fill]').style.width = dur ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';
    this.#setBtn('mute', this.adapter.isMuted() ? 'mute' : 'volume', this.adapter.isMuted() ? 'Con sonido' : 'Silenciar');
  }

  #onClick(e) {
    const a = this.adapter;
    // Clic sobre el video = pausa/reproduce
    if (e.target.closest('[data-stage]')) return a?.toggle();
    const el = e.target.closest('[data-act]');
    if (!el) return undefined;
    this.#show();
    switch (el.dataset.act) {
      case 'pl-toggle': return a?.toggle();
      case 'pl-back': return a?.seek(-10);
      case 'pl-fwd': return a?.seek(10);
      case 'pl-prev': return a?.prev();
      case 'pl-next': return a?.next();
      case 'pl-mute': return a?.toggleMute();
      case 'pl-full': return this.#toggleFullscreen();
      case 'pl-close': return this.close();
      case 'pl-del':
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          this.#setBtn('del', 'trash', '¿Seguro? OK de nuevo');
          return undefined;
        }
        this.onDelete?.(this.item);
        return this.close({ restore: false });
      default: return undefined;
    }
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (this.el.requestFullscreen ?? this.el.webkitRequestFullscreen)?.call(this.el);
  }
}
    Object.assign(exports, { loadYouTubeApi, Player });
  };
  __modules["js/dialog.js"] = function (module, exports, __require) {
/**
 * Formulario modal para agregar contenido. Los campos son elementos enfocables
 * (se navegan con mando/flechas); OK sobre un campo abre el teclado del sistema.
 */
const { esc } = __require("js/ui.js");

class Dialog {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.returnFid = null;
    this.busy = false;
    this.spec = null;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('keydown', (e) => {
      if (e.target.tagName !== 'INPUT') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
        this.focus.move('down');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.blur();
      }
    });
  }

  /**
   * @param {{title:string, hint?:string, fields:{key:string,label:string,type?:'text'|'password',placeholder?:string,value?:string}[],
   *   submitLabel?:string, onSubmit:(values:object)=>Promise<string|null>|string|null}} spec
   */
  open(spec) {
    if (this.isOpen) return;
    this.spec = spec;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    const fields = spec.fields
      .map(
        (f) => `
        <div class="field" role="button" tabindex="-1" data-focusable data-zone="dialog"
             data-fid="dlg:${f.key}" data-act="dlg-field">
          <label>${esc(f.label)}</label>
          <input type="${f.type === 'password' ? 'password' : 'text'}" name="${esc(f.key)}" value="${esc(f.value ?? '')}"
                 placeholder="${esc(f.placeholder ?? '')}" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="dialog-card">
        <h2>${esc(spec.title)}</h2>
        ${spec.hint ? `<p class="dialog-hint">${esc(spec.hint)}</p>` : ''}
        ${fields}
        <p class="dialog-error" data-error hidden></p>
        <div class="dialog-actions">
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="dialog" data-fid="dlg:save" data-act="dlg-save">${esc(spec.submitLabel ?? 'Guardar')}</div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="dialog" data-fid="dlg:cancel" data-act="dlg-cancel">Cancelar</div>
        </div>
      </div>`;
    this.el.hidden = false;
    this.isOpen = true;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusFirst('[data-focusable]');
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    document.activeElement?.blur?.();
    this.isOpen = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    return restore ? this.focus.focusByFid(this.returnFid) : false;
  }

  values() {
    const out = {};
    for (const input of this.el.querySelectorAll('input')) out[input.name] = input.value.trim();
    return out;
  }

  #showError(message) {
    const el = this.el.querySelector('[data-error]');
    if (!el) return;
    el.textContent = message ?? '';
    el.hidden = !message;
  }

  async #onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'dlg-field') {
      el.querySelector('input')?.focus();
    } else if (el.dataset.act === 'dlg-cancel') {
      this.close();
    } else if (el.dataset.act === 'dlg-save') {
      if (this.busy) return;
      this.busy = true;
      this.#showError('');
      el.textContent = 'Guardando…';
      try {
        const error = await this.spec.onSubmit(this.values());
        if (error) {
          this.#showError(error);
          el.textContent = this.spec.submitLabel ?? 'Guardar';
        } else {
          // El foco vuelve a la tarjeta nueva (returnFid); si no existe, al primer elemento.
          if (!this.close()) this.focus.focusFirst('[data-zone="main"]');
        }
      } finally {
        this.busy = false;
      }
    }
  }
}
    Object.assign(exports, { Dialog });
  };
  __modules["js/fileSystem.js"] = function (module, exports, __require) {
// fileSystem.js – almacenamiento local para WebBox OS.
// Usa File System Access API cuando el usuario elige una carpeta del equipo.
// Si no está disponible, usa OPFS y, como último recurso, IndexedDB.

const DB_NAME = 'webbox-fs';
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const NODE_STORE = 'nodes';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(NODE_STORE)) {
        db.createObjectStore(NODE_STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => reject(new Error('Cierra otras pestañas de WebBox OS para actualizar el almacenamiento.'));
  });
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('La operación de almacenamiento fue cancelada.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda un manejador o una referencia interna bajo una clave persistente. */
async function saveHandle(path, handle) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).put({ path, handle });
  await transactionDone(tx);
}

/** Recupera un manejador o una referencia interna previamente guardada. */
async function getHandle(path) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readonly');
  const record = await requestResult(tx.objectStore(HANDLE_STORE).get(path));
  return record?.handle;
}

/** Elimina una referencia persistida, sin borrar el archivo de origen. */
async function removeHandle(path) {
  const db = await openDb();
  const tx = db.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).delete(path);
  await transactionDone(tx);
}

function supportsFileSystemAccess() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Permite elegir una carpeta real del equipo. */
async function requestRootDirectory() {
  if (!supportsFileSystemAccess()) {
    throw new Error('Este navegador no permite abrir carpetas del equipo. Usa el almacenamiento interno.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const root = { backend: 'native', handle, name: handle.name || 'Carpeta', path: '/', kind: 'directory' };
  await saveHandle('root', handle);
  return root;
}

/** Abre el almacenamiento privado de WebBox OS (OPFS o IndexedDB). */
async function requestInternalDirectory() {
  try {
    if (navigator.storage?.getDirectory) {
      const storageRoot = await navigator.storage.getDirectory();
      const handle = await storageRoot.getDirectoryHandle('WebBox OS', { create: true });
      return { backend: 'opfs', handle, name: 'Almacenamiento interno', path: '/', kind: 'directory' };
    }
  } catch (error) {
    console.warn('[WebBox OS] OPFS no disponible; se usará IndexedDB.', error);
  }
  await openDb();
  return { backend: 'idb', handle: null, name: 'Almacenamiento interno', path: '/', kind: 'directory' };
}

/** Obtiene una raíz local previamente guardada, cuando el navegador lo permite. */
async function getRootDirectory() {
  const handle = await getHandle('root');
  return handle
    ? { backend: 'native', handle, name: handle.name || 'Carpeta', path: '/', kind: 'directory' }
    : null;
}

function directoryHandle(directory) {
  if (!directory || !['native', 'opfs'].includes(directory.backend) || !directory.handle) {
    throw new Error('La carpeta seleccionada no está disponible.');
  }
  return directory.handle;
}

function joinPath(parentPath, name, kind) {
  const base = parentPath === '/' ? '/' : `${parentPath.replace(/\/$/, '')}/`;
  return `${base}${name}${kind === 'directory' ? '/' : ''}`;
}

function validateName(name) {
  const value = String(name ?? '').trim();
  if (!value) throw new Error('Escribe un nombre.');
  if (value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error('El nombre no puede contener / ni \\ y no puede ser . o ...');
  }
  return value;
}

async function idbNodes() {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readonly');
  return requestResult(tx.objectStore(NODE_STORE).getAll());
}

async function idbGetNode(path) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readonly');
  return requestResult(tx.objectStore(NODE_STORE).get(path));
}

async function idbPutNode(node) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readwrite');
  tx.objectStore(NODE_STORE).put(node);
  await transactionDone(tx);
}

async function idbDeletePath(path, recursive = false) {
  const db = await openDb();
  const tx = db.transaction(NODE_STORE, 'readwrite');
  const store = tx.objectStore(NODE_STORE);
  const done = transactionDone(tx);
  if (recursive) {
    const request = store.getAll();
    request.onsuccess = () => {
      for (const node of request.result) {
        if (node.path === path || node.path.startsWith(path)) store.delete(node.path);
      }
    };
  } else {
    store.delete(path);
  }
  await done;
}

/** Lista los elementos de una carpeta en cualquiera de los tres almacenamientos. */
async function listEntries(directory) {
  if (directory.backend === 'idb') {
    const nodes = await idbNodes();
    return nodes
      .filter((node) => node.parentPath === directory.path)
      .map((node) => ({ ...node, backend: 'idb', parent: directory, handle: null }));
  }

  const entries = [];
  const handle = directoryHandle(directory);
  for await (const [name, child] of handle.entries()) {
    const kind = child.kind;
    entries.push({
      name,
      handle: child,
      kind,
      backend: directory.backend,
      parent: directory,
      path: joinPath(directory.path, name, kind),
    });
  }
  return entries;
}

/** Comprueba que el nombre no exista en el destino. */
async function ensureNameAvailable(directory, name) {
  const entries = await listEntries(directory);
  if (entries.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error(`Ya existe un elemento llamado "${name}".`);
  }
}

/** Crea una subcarpeta. */
async function createFolder(parent, name) {
  const safeName = validateName(name);
  await ensureNameAvailable(parent, safeName);
  if (parent.backend === 'idb') {
    const path = joinPath(parent.path, safeName, 'directory');
    await idbPutNode({ path, parentPath: parent.path, name: safeName, kind: 'directory' });
    return { backend: 'idb', path, name: safeName, kind: 'directory', parent, handle: null };
  }
  const handle = await directoryHandle(parent).getDirectoryHandle(safeName, { create: true });
  return {
    backend: parent.backend,
    handle,
    path: joinPath(parent.path, safeName, 'directory'),
    name: safeName,
    kind: 'directory',
    parent,
  };
}

/** Escribe un archivo en un directorio, conservando su contenido. */
async function writeFile(parent, name, file) {
  const safeName = validateName(name);
  await ensureNameAvailable(parent, safeName);
  if (parent.backend === 'idb') {
    const path = joinPath(parent.path, safeName, 'file');
    const blob = file instanceof Blob ? file : new Blob([file]);
    await idbPutNode({
      path,
      parentPath: parent.path,
      name: safeName,
      kind: 'file',
      blob,
      size: blob.size,
      type: blob.type || file.type || '',
      lastModified: file.lastModified || Date.now(),
    });
    return { backend: 'idb', path, name: safeName, kind: 'file', parent, handle: null };
  }
  const handle = await directoryHandle(parent).getFileHandle(safeName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return {
    backend: parent.backend,
    handle,
    path: joinPath(parent.path, safeName, 'file'),
    name: safeName,
    kind: 'file',
    parent,
  };
}

/** Devuelve un objeto File desde una entrada del explorador. */
async function getEntryFile(entry) {
  if (entry.backend === 'idb') {
    const node = await idbGetNode(entry.path);
    if (!node?.blob) throw new Error('El archivo ya no existe en el almacenamiento interno.');
    return new File([node.blob], node.name, {
      type: node.type || node.blob.type || '',
      lastModified: node.lastModified || Date.now(),
    });
  }
  return entry.handle.getFile();
}

/** Recupera un archivo guardado en Películas. */
async function getStoredFile(reference) {
  if (reference?.backend === 'idb') {
    return getEntryFile(reference);
  }
  if (reference?.getFile) return reference.getFile();
  throw new Error('No se encontró el archivo guardado. Vuelve a agregarlo desde Archivos.');
}

/** Sube archivos al almacenamiento interno; acepta rutas relativas de carpetas. */
async function uploadFiles(root, files) {
  let uploaded = 0;
  for (const file of files) {
    const relative = String(file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const parts = relative.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let directory = root;
    for (const folderName of parts) {
      const existing = (await listEntries(directory)).find(
        (entry) => entry.kind === 'directory' && entry.name === folderName,
      );
      directory = existing
        ? { backend: existing.backend, handle: existing.handle, path: existing.path, name: existing.name, kind: 'directory' }
        : await createFolder(directory, folderName);
    }
    await writeFile(directory, fileName, file);
    uploaded += 1;
  }
  return uploaded;
}

async function copyNode(entry, targetDirectory, targetName = entry.name) {
  if (entry.kind === 'file') {
    const file = await getEntryFile(entry);
    await writeFile(targetDirectory, targetName, file);
    return;
  }
  const newDirectory = await createFolder(targetDirectory, targetName);
  const children = await listEntries({
    backend: entry.backend,
    handle: entry.handle,
    path: entry.path,
    name: entry.name,
    kind: 'directory',
  });
  for (const child of children) await copyNode(child, newDirectory);
}

/** Copia un archivo o carpeta completa al directorio de destino. */
async function copyEntry(entry, targetDirectory, targetName = entry.name, autoRename = false) {
  if (entry.kind === 'directory'
      && entry.backend === targetDirectory.backend
      && targetDirectory.path.startsWith(entry.path)) {
    throw new Error('No puedes copiar una carpeta dentro de sí misma.');
  }
  let safeName = validateName(targetName);
  if (autoRename) {
    const names = new Set((await listEntries(targetDirectory)).map((item) => item.name.toLocaleLowerCase()));
    if (names.has(safeName.toLocaleLowerCase())) {
      const dot = entry.kind === 'file' ? safeName.lastIndexOf('.') : -1;
      const base = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : '';
      let number = 1;
      while (names.has(`${base} (copia${number > 1 ? ` ${number}` : ''})${ext}`.toLocaleLowerCase())) number += 1;
      safeName = `${base} (copia${number > 1 ? ` ${number}` : ''})${ext}`;
    }
  } else {
    await ensureNameAvailable(targetDirectory, safeName);
  }
  await copyNode(entry, targetDirectory, safeName);
}

/** Elimina una entrada del directorio indicado. */
async function deleteEntry(parent, entry) {
  if (parent.backend === 'idb') {
    await idbDeletePath(entry.path, entry.kind === 'directory');
    return;
  }
  await directoryHandle(parent).removeEntry(entry.name, { recursive: entry.kind === 'directory' });
}

/** Renombra mediante copia + borrado para mantener compatibilidad entre backends. */
async function renameEntry(entry, parent, newName) {
  const safeName = validateName(newName);
  if (safeName === entry.name) return;
  await copyEntry(entry, parent, safeName);
  await deleteEntry(parent, entry);
}

/** Mueve una entrada entre carpetas, incluso entre almacenamiento interno y equipo. */
async function moveEntry(entry, sourceParent, targetDirectory) {
  if (sourceParent.backend === targetDirectory.backend && sourceParent.path === targetDirectory.path) {
    throw new Error('El destino ya es la carpeta actual.');
  }
  if (entry.kind === 'directory'
      && entry.backend === targetDirectory.backend
      && targetDirectory.path.startsWith(entry.path)) {
    throw new Error('No puedes mover una carpeta dentro de sí misma.');
  }
  await copyEntry(entry, targetDirectory);
  await deleteEntry(sourceParent, entry);
}
    Object.assign(exports, { saveHandle, getHandle, removeHandle, supportsFileSystemAccess, requestRootDirectory, requestInternalDirectory, getRootDirectory, listEntries, createFolder, writeFile, getEntryFile, getStoredFile, uploadFiles, copyEntry, deleteEntry, renameEntry, moveEntry });
  };
  __modules["js/files.js"] = function (module, exports, __require) {
/**
 * Gestor de archivos de WebBox OS para mando, teclado y mouse.
 * Trabaja con carpetas del equipo (File System Access API) o con almacenamiento
 * privado OPFS/IndexedDB en navegadores que no permiten elegir carpetas.
 */
const { supportsFileSystemAccess, requestRootDirectory, requestInternalDirectory, listEntries, createFolder, uploadFiles, getEntryFile, copyEntry, moveEntry, renameEntry, deleteEntry } = __require("js/fileSystem.js");
const { icon } = __require("js/icons.js");
const { esc, toast } = __require("js/ui.js");

const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus', 'wma']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg']);

function extension(name) {
  return String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : '';
}

function fileType(name) {
  const ext = extension(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['txt', 'md', 'doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'document';
  return 'file';
}

function typeIcon(kind) {
  return ({
    directory: 'folder', video: 'film', audio: 'music', image: 'photo',
    pdf: 'book', document: 'book', archive: 'book', file: 'book',
  })[kind] ?? 'book';
}

function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

class FilesScreen {
  /**
   * @param {{root:HTMLElement, focus:object, dialog:object, onOpenMedia:(file:File,name:string)=>void,
   *   onAddMovie:(entry:object,name:string)=>Promise<void>}} opts
   */
  constructor({ root, focus, dialog, onOpenMedia, onAddMovie }) {
    this.root = root;
    this.focus = focus;
    this.dialog = dialog;
    this.onOpenMedia = onOpenMedia;
    this.onAddMovie = onAddMovie;
    this.stack = [];
    this.rootDirectory = null;
    this.entries = [];
    this.view = 'grid';
    this.loading = false;
    this.selectedPath = null;
    this.viewerOpen = false;
    this.viewerUrl = null;
    this.viewerReturnFid = null;
    this.viewer = document.getElementById('file-viewer');
    this.targetPicker = null;
    this.targetOpen = false;
    this.targetMode = null;
    this.targetStack = [];

    this.root.addEventListener('click', (e) => this.#onClick(e));
    this.root.addEventListener('change', (e) => this.#onChange(e));
    this.viewer?.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="file-viewer-close"]')) this.closeViewer();
    });
  }

  render() {
    const canPick = supportsFileSystemAccess();
    this.root.innerHTML = `
      <h1 class="screen-title">Gestor de archivos</h1>
      <p class="files-sub">Administra tus carpetas, organiza archivos y reproduce tu contenido con el mando.</p>
      <div class="files-toolbar files-toolbar--primary">
        ${canPick ? `<div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:pick" data-act="files-pick">${icon('folder')}Carpeta del equipo</div>` : ''}
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:internal" data-act="files-internal">${icon('folder')}Almacenamiento interno</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:upload" data-act="files-upload">${icon('plus')}Subir archivos</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:upload-folder" data-act="files-upload-folder">${icon('folder')}Subir carpeta</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:new-folder" data-act="files-new-folder" aria-disabled="true">${icon('plus')}Nueva carpeta</div>
      </div>
      <div class="files-toolbar files-toolbar--manage">
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:rename" data-act="files-rename" aria-disabled="true">Renombrar</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:copy" data-act="files-copy" aria-disabled="true">${icon('copy')}Copiar</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:move" data-act="files-move" aria-disabled="true">${icon('move')}Mover</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:delete" data-act="files-delete" aria-disabled="true">${icon('trash')}Eliminar</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:up" data-act="files-up" aria-disabled="true">${icon('back')}Atrás</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:list" data-act="files-list">Lista</div>
        <div class="btn is-selected" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:grid" data-act="files-grid">Cuadrícula</div>
      </div>
      <div class="files-location">
        <span class="files-location-label">Ubicación</span>
        <strong data-files-path>Sin carpeta seleccionada</strong>
        <span class="files-count" data-files-count></span>
      </div>
      <div class="files-selection" data-files-selection>Selecciona un elemento para organizarlo.</div>
      <div class="files-content" data-files-content>
        <div class="files-empty">
          <span class="files-empty-icon">${icon('folder')}</span>
          <h2>Abre una ubicación</h2>
          <p>${canPick
            ? 'Elige una carpeta de tu equipo o abre el almacenamiento interno de WebBox OS.'
            : 'Este navegador no permite elegir carpetas del equipo. Usa el almacenamiento interno y sube tus archivos.'}</p>
          <p class="files-api-note">Las operaciones sobre el equipo requieren permiso del navegador. El almacenamiento interno es privado de WebBox OS.</p>
        </div>
      </div>
      <input data-files-input type="file" multiple hidden>
      <input data-files-folder-input type="file" multiple webkitdirectory hidden>`;
    this.#updateToolbar();
    this.#updatePath();
  }

  focusEntry() {
    this.focus.focusFirst('[data-zone="main"]');
  }

  closeTargetPicker() {
    this.#closeTargetPicker();
  }

  async handleBack() {
    if (this.targetOpen) {
      this.#closeTargetPicker();
      return true;
    }
    if (this.viewerOpen) {
      this.closeViewer();
      return true;
    }
    if (this.stack.length > 1) {
      await this.goUp();
      return true;
    }
    return false;
  }

  async chooseFolder() {
    if (this.loading) return;
    try {
      const root = await requestRootDirectory();
      this.#setRoot(root);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      const message = err?.message || 'No se pudo abrir la carpeta.';
      this.#setMessage(message, true);
      toast(message, 4500);
    }
  }

  /** Abre una carpeta concreta (por ejemplo, la de fotos) como raíz del gestor. */
  async openLocation(root) {
    if (this.loading) return;
    await this.#setRoot(root);
  }

  async openInternal() {
    if (this.loading) return;
    try {
      const root = await requestInternalDirectory();
      this.#setRoot(root);
      toast(root.backend === 'opfs'
        ? 'Almacenamiento interno OPFS listo.'
        : 'Almacenamiento interno IndexedDB listo.');
    } catch (err) {
      toast(`No se pudo abrir el almacenamiento interno: ${err?.message || 'error'}`, 4500);
    }
  }

  /** Busca ROMs SNES en todas las subcarpetas de la raíz activa del gestor. */
  async findSnesRoms({ maxDepth = 12, maxDirectories = 1500, maxFiles = 3000 } = {}) {
    if (!this.rootDirectory) {
      throw new Error('Primero abre una carpeta o el almacenamiento interno desde el Gestor de archivos.');
    }

    const extensions = new Set(['sfc', 'smc', 'fig', 'gd3', 'gd7', 'dx2', 'bsx', 'swc']);
    const roms = [];
    let directoriesVisited = 0;

    const visit = async (directory, relativePath, depth) => {
      if (depth > maxDepth || directoriesVisited >= maxDirectories || roms.length >= maxFiles) return;
      directoriesVisited += 1;
      const entries = await listEntries(directory);

      for (const entry of entries) {
        if (roms.length >= maxFiles) break;
        if (entry.kind === 'directory') {
          const child = {
            backend: entry.backend,
            handle: entry.handle,
            name: entry.name,
            path: entry.path,
            kind: 'directory',
          };
          await visit(child, relativePath ? `${relativePath}/${entry.name}` : entry.name, depth + 1);
          continue;
        }

        const ext = extension(entry.name);
        if (!extensions.has(ext)) continue;
        try {
          const file = await getEntryFile(entry);
          roms.push({
            name: entry.name,
            path: relativePath ? `${relativePath}/${entry.name}` : entry.name,
            size: file.size,
            file,
            entry,
          });
        } catch (error) {
          console.warn(`[WebBox OS] No se pudo leer la ROM ${entry.name}.`, error);
        }
      }
    };

    await visit(this.rootDirectory, '', 0);
    roms.sort((a, b) => a.path.localeCompare(b.path, 'es', { sensitivity: 'base', numeric: true }));
    return {
      roms,
      rootName: this.rootDirectory.name,
      backend: this.rootDirectory.backend,
      truncated: directoriesVisited >= maxDirectories || roms.length >= maxFiles,
    };
  }

  async #setRoot(root) {
    this.rootDirectory = root;
    this.stack = [root];
    this.selectedPath = null;
    await this.#readCurrent();
  }

  async goUp() {
    if (this.stack.length <= 1 || this.loading) return;
    this.stack.pop();
    this.selectedPath = null;
    await this.#readCurrent();
  }

  async #readCurrent() {
    const current = this.stack.at(-1);
    if (!current) return;
    this.loading = true;
    this.#updateToolbar();
    this.#updatePath();
    const content = this.root.querySelector('[data-files-content]');
    if (content) content.innerHTML = '<div class="files-empty"><h2>Abriendo carpeta…</h2><p>Obteniendo el contenido.</p></div>';

    try {
      this.entries = await listEntries(current);
      this.entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true });
      });
      if (this.selectedPath && !this.entries.some((entry) => entry.path === this.selectedPath)) {
        this.selectedPath = null;
      }
      this.#renderEntries();
    } catch (err) {
      this.entries = [];
      this.#setMessage(err?.name === 'NotAllowedError'
        ? 'El navegador necesita permiso para leer esta carpeta. Vuelve a elegirla.'
        : `No se pudo leer la carpeta: ${err?.message || 'error desconocido'}`, true);
    } finally {
      this.loading = false;
      this.#updateToolbar();
      this.#updatePath();
    }
  }

  #renderEntries() {
    const content = this.root.querySelector('[data-files-content]');
    const count = this.root.querySelector('[data-files-count]');
    if (!content) return;

    if (count) count.textContent = `${this.entries.length} elemento${this.entries.length === 1 ? '' : 's'}`;
    if (!this.entries.length) {
      content.innerHTML = '<div class="files-empty"><h2>Esta carpeta está vacía</h2><p>Sube archivos o crea una carpeta para comenzar.</p></div>';
      return;
    }

    const cards = this.entries.map((entry, index) => {
      const kind = entry.kind === 'directory' ? 'directory' : fileType(entry.name);
      const isVideo = kind === 'video';
      const fid = `files:item:${index}`;
      const selected = entry.path === this.selectedPath;
      const meta = entry.kind === 'directory'
        ? 'Carpeta'
        : `${this.#metaLabel(kind, entry.name)}${Number.isFinite(entry.size) ? ` · ${readableSize(entry.size)}` : ''}`;
      return `
        <article class="file-card${isVideo ? ' file-card--video' : ''}${selected ? ' is-selected' : ''}">
          <div class="file-entry" role="button" tabindex="-1" data-focusable data-zone="main"
               data-fid="${fid}" data-act="file-open" data-index="${index}"
               aria-label="${esc(entry.name)}">
            <span class="file-entry-icon file-entry-icon--${kind}">${icon(typeIcon(kind))}</span>
            <span class="file-entry-name">${esc(entry.name)}</span>
            <span class="file-entry-meta">${esc(meta)}</span>
          </div>
          <div class="file-card-actions">
            <div class="btn btn--sm${selected ? ' is-selected' : ''}" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="files:select:${index}" data-act="file-select" data-index="${index}">
              ${selected ? icon('check') : icon('apps')}${selected ? 'Seleccionado' : 'Seleccionar'}
            </div>
            ${isVideo ? `<div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="files:add:${index}" data-act="file-add-movie" data-index="${index}">
              ${icon('plus')}Agregar a Películas
            </div>` : ''}
          </div>
        </article>`;
    }).join('');

    content.innerHTML = `<div class="files-${this.view}">${cards}</div>`;
    this.#updateSelectionLabel();
  }

  #metaLabel(kind, name) {
    const labels = { video: 'Video', audio: 'Audio', image: 'Imagen', pdf: 'PDF', document: 'Documento', archive: 'Archivo comprimido', file: 'Archivo' };
    return `${labels[kind] || 'Archivo'}${extension(name) ? ` · ${extension(name).toUpperCase()}` : ''}`;
  }

  #selectedEntry() {
    return this.entries.find((entry) => entry.path === this.selectedPath) ?? null;
  }

  #updateSelectionLabel() {
    const label = this.root.querySelector('[data-files-selection]');
    const entry = this.#selectedEntry();
    if (label) label.textContent = entry
      ? `Seleccionado: ${entry.name} · ${entry.kind === 'directory' ? 'Carpeta' : 'Archivo'}`
      : 'Selecciona un elemento para organizarlo.';
  }

  #updateToolbar() {
    const selected = Boolean(this.#selectedEntry());
    const current = Boolean(this.stack.length) && !this.loading;
    const controls = {
      'files-new-folder': current,
      'files-rename': selected && current,
      'files-copy': selected && current,
      'files-move': selected && current,
      'files-delete': selected && current,
      'files-upload': current,
      'files-upload-folder': current,
      'files-up': this.stack.length > 1 && !this.loading,
    };
    for (const [action, enabled] of Object.entries(controls)) {
      this.root.querySelector(`[data-act="${action}"]`)?.setAttribute('aria-disabled', String(!enabled));
    }
    const list = this.root.querySelector('[data-act="files-list"]');
    const grid = this.root.querySelector('[data-act="files-grid"]');
    list?.classList.toggle('is-selected', this.view === 'list');
    grid?.classList.toggle('is-selected', this.view === 'grid');
  }

  #updatePath() {
    const path = this.root.querySelector('[data-files-path]');
    if (!path) return;
    path.textContent = this.stack.length
      ? this.stack.map((part) => part.name).join('  /  ')
      : 'Sin carpeta seleccionada';
  }

  #setMessage(message, isError = false) {
    const content = this.root.querySelector('[data-files-content]');
    if (content) {
      content.innerHTML = `<div class="files-empty${isError ? ' files-empty--error' : ''}"><h2>${isError ? 'No se pudo abrir' : 'Archivos'}</h2><p>${esc(message)}</p></div>`;
    }
  }

  async #onChange(e) {
    const input = e.target;
    if (!input.matches('[data-files-input], [data-files-folder-input]')) return;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (!this.stack.length) await this.openInternal();
    const current = this.stack.at(-1);
    if (!current) return;
    try {
      const count = await uploadFiles(current, files);
      this.selectedPath = null;
      await this.#readCurrent();
      toast(`${count} archivo${count === 1 ? '' : 's'} agregado${count === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(`No se pudieron subir todos los archivos: ${err?.message || 'error'}`, 5000);
      await this.#readCurrent();
    }
  }

  async #onClick(e) {
    const action = e.target.closest('[data-act]');
    if (!action || action.getAttribute('aria-disabled') === 'true') return;
    if (action.dataset.act.startsWith('target-')) {
      await this.#targetAction(action.dataset.act, Number(action.dataset.index));
      return;
    }
    switch (action.dataset.act) {
      case 'files-pick':
        await this.chooseFolder();
        break;
      case 'files-internal':
        await this.openInternal();
        break;
      case 'files-upload':
        this.root.querySelector('[data-files-input]')?.click();
        break;
      case 'files-upload-folder':
        this.root.querySelector('[data-files-folder-input]')?.click();
        break;
      case 'files-new-folder':
        this.#newFolder();
        break;
      case 'files-rename':
        this.#renameSelected();
        break;
      case 'files-copy':
        this.#openTargetPicker('copy');
        break;
      case 'files-move':
        this.#openTargetPicker('move');
        break;
      case 'files-delete':
        this.#confirmDelete();
        break;
      case 'files-up':
        await this.goUp();
        break;
      case 'files-list':
        this.#setView('list');
        break;
      case 'files-grid':
        this.#setView('grid');
        break;
      case 'file-open':
        await this.#openEntry(Number(action.dataset.index));
        break;
      case 'file-select':
        this.#selectEntry(Number(action.dataset.index));
        break;
      case 'file-add-movie':
        await this.#addMovie(Number(action.dataset.index));
        break;
      default:
        break;
    }
  }

  #setView(view) {
    if (this.view === view) return;
    const fid = this.focus.current?.dataset.fid;
    this.view = view;
    this.#renderEntries();
    this.#updateToolbar();
    if (!this.focus.focusByFid(fid)) this.focus.focusFirst('[data-zone="main"]');
  }

  #selectEntry(index) {
    const entry = this.entries[index];
    if (!entry) return;
    this.selectedPath = this.selectedPath === entry.path ? null : entry.path;
    this.#renderEntries();
    this.#updateToolbar();
    this.#updateSelectionLabel();
    this.focus.focusByFid(`files:select:${index}`);
  }

  #newFolder() {
    if (!this.stack.length || this.dialog.isOpen) return;
    const parent = this.stack.at(-1);
    this.dialog.open({
      title: 'Crear carpeta',
      hint: 'Escribe un nombre para la nueva carpeta.',
      fields: [{ key: 'name', label: 'Nombre de la carpeta', placeholder: 'Nueva carpeta' }],
      submitLabel: 'Crear',
      onSubmit: async ({ name }) => {
        try {
          const folder = await createFolder(parent, name);
          await this.#readCurrent();
          this.dialog.returnFid = null;
          this.focus.focusByFid(`files:item:${this.entries.findIndex((entry) => entry.path === folder.path)}`);
          toast(`Carpeta creada: ${folder.name}`);
          return null;
        } catch (err) {
          return err?.message || 'No se pudo crear la carpeta.';
        }
      },
    });
  }

  #renameSelected() {
    const entry = this.#selectedEntry();
    if (!entry || this.dialog.isOpen) return;
    const parent = this.stack.at(-1);
    this.dialog.open({
      title: 'Renombrar elemento',
      hint: `Nuevo nombre para "${entry.name}".`,
      fields: [{ key: 'name', label: 'Nuevo nombre', value: entry.name }],
      submitLabel: 'Renombrar',
      onSubmit: async ({ name }) => {
        try {
          await renameEntry(entry, parent, name);
          this.selectedPath = null;
          await this.#readCurrent();
          toast(`Elemento renombrado: ${name}`);
          return null;
        } catch (err) {
          return err?.message || 'No se pudo renombrar el elemento.';
        }
      },
    });
  }

  #confirmDelete() {
    const entry = this.#selectedEntry();
    if (!entry || this.dialog.isOpen) return;
    const parent = this.stack.at(-1);
    this.dialog.open({
      title: 'Confirmar eliminación',
      hint: `¿Seguro que deseas eliminar "${entry.name}"?${entry.kind === 'directory' ? ' También se eliminará todo su contenido.' : ''} Esta acción no se puede deshacer.`,
      fields: [],
      submitLabel: 'Eliminar',
      onSubmit: async () => {
        try {
          await deleteEntry(parent, entry);
          this.selectedPath = null;
          await this.#readCurrent();
          toast(`Eliminado: ${entry.name}`);
          return null;
        } catch (err) {
          return err?.message || 'No se pudo eliminar el elemento.';
        }
      },
    });
  }

  #openTargetPicker(mode) {
    const entry = this.#selectedEntry();
    if (!entry || this.targetOpen || this.dialog.isOpen || !this.rootDirectory) return;
    this.targetMode = mode;
    this.targetStack = [this.rootDirectory];
    this.targetPicker = document.createElement('div');
    this.targetPicker.className = 'files-target-picker';
    this.targetPicker.hidden = false;
    this.root.appendChild(this.targetPicker);
    this.targetOpen = true;
    this.#renderTargetPicker();
    this.focus.clear();
    this.focus.pushScope(this.targetPicker);
    this.focus.focusFirst('[data-focusable]');
  }

  async #renderTargetPicker() {
    if (!this.targetPicker) return;
    const current = this.targetStack.at(-1);
    let folders = [];
    try {
      folders = (await listEntries(current)).filter((entry) => entry.kind === 'directory');
      folders.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    } catch (err) {
      toast(`No se pudo leer el destino: ${err?.message || 'error'}`);
    }
    const operation = this.targetMode === 'copy' ? 'Copiar' : 'Mover';
    this.targetPicker.innerHTML = `
      <div class="files-target-card">
        <div class="files-target-heading">
          <div><h2>${operation} elemento</h2><p>Elige la carpeta de destino.</p></div>
          <span>${icon('folder')}</span>
        </div>
        <div class="files-target-path">${esc(this.targetStack.map((part) => part.name).join(' / '))}</div>
        <div class="files-target-actions">
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="target" data-fid="target:up" data-act="target-up" aria-disabled="${this.targetStack.length <= 1}">${icon('back')}Atrás</div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="target" data-fid="target:use" data-act="target-use">${icon('check')}Usar esta carpeta</div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="target" data-fid="target:cancel" data-act="target-cancel">Cancelar</div>
        </div>
        <div class="files-target-folders">
          ${folders.length ? folders.map((folder, index) => `
            <div class="files-target-folder" role="button" tabindex="-1" data-focusable data-zone="target"
                 data-fid="target:folder:${index}" data-act="target-enter" data-index="${index}">
              ${icon('folder')}<span>${esc(folder.name)}</span>${icon('back', 'files-target-arrow')}
            </div>`).join('') : '<p class="files-target-empty">No hay subcarpetas en esta ubicación.</p>'}
        </div>
      </div>`;
    this.targetFolders = folders;
    this.focus.focusFirst('[data-focusable]');
  }

  async #targetAction(action, index) {
    if (action === 'target-cancel') {
      this.#closeTargetPicker();
      return;
    }
    if (action === 'target-up') {
      if (this.targetStack.length > 1) this.targetStack.pop();
      await this.#renderTargetPicker();
      return;
    }
    if (action === 'target-enter') {
      const folder = this.targetFolders?.[index];
      if (folder) this.targetStack.push({
        backend: folder.backend, handle: folder.handle, path: folder.path,
        name: folder.name, kind: 'directory',
      });
      await this.#renderTargetPicker();
      return;
    }
    if (action === 'target-use') await this.#applyTargetOperation();
  }

  async #applyTargetOperation() {
    const entry = this.#selectedEntry();
    const target = this.targetStack.at(-1);
    if (!entry || !target) return;
    const mode = this.targetMode;
    if (mode === 'move' && entry.parent?.path === target.path && entry.parent?.backend === target.backend) {
      toast('El elemento ya está en esa carpeta.');
      return;
    }
    try {
      if (mode === 'copy') {
        await copyEntry(entry, target, entry.name, true);
        toast(`Copiado: ${entry.name}`);
      } else {
        const accepted = window.confirm(`¿Mover "${entry.name}" a "${target.name}"?`);
        if (!accepted) return;
        await moveEntry(entry, this.stack.at(-1), target);
        this.selectedPath = null;
        toast(`Movido: ${entry.name}`);
      }
      this.#closeTargetPicker();
      await this.#readCurrent();
    } catch (err) {
      toast(`No se pudo ${mode === 'copy' ? 'copiar' : 'mover'}: ${err?.message || 'error'}`, 5000);
    }
  }

  #closeTargetPicker() {
    if (!this.targetOpen) return;
    this.targetOpen = false;
    this.targetPicker?.remove();
    this.targetPicker = null;
    this.targetStack = [];
    this.targetFolders = [];
    this.targetMode = null;
    this.focus.popScope();
    const index = this.entries.findIndex((entry) => entry.path === this.selectedPath);
    if (!this.focus.focusByFid(index >= 0 ? `files:select:${index}` : 'files:rename')) {
      this.focus.focusFirst('[data-zone="main"]');
    }
  }

  async #openEntry(index) {
    const entry = this.entries[index];
    if (!entry || this.loading) return;
    if (entry.kind === 'directory') {
      this.stack.push({
        backend: entry.backend, handle: entry.handle, path: entry.path,
        name: entry.name, kind: 'directory',
      });
      this.selectedPath = null;
      await this.#readCurrent();
      this.focus.focusFirst('[data-zone="main"]');
      return;
    }

    const kind = fileType(entry.name);
    if (!['video', 'audio', 'image'].includes(kind)) {
      toast('Este tipo de archivo no tiene un visor integrado.');
      return;
    }

    try {
      const file = await getEntryFile(entry);
      if (kind === 'image') this.openImage(file, entry.name);
      else this.onOpenMedia?.(file, entry.name);
    } catch (err) {
      toast(`No se pudo abrir el archivo: ${err?.message || 'permiso denegado'}`, 4000);
    }
  }

  async #addMovie(index) {
    const entry = this.entries[index];
    if (!entry || entry.kind !== 'file' || fileType(entry.name) !== 'video') return;
    try {
      await this.onAddMovie?.(entry, entry.name);
    } catch (err) {
      toast(`No se pudo agregar a Películas: ${err?.message || 'error desconocido'}`, 4000);
    }
  }

  openImage(file, name) {
    if (!this.viewer) return;
    this.closeViewer({ restore: false });
    this.viewerReturnFid = this.focus.current?.dataset.fid ?? null;
    this.viewerUrl = URL.createObjectURL(file);
    this.viewer.innerHTML = `
      <div class="file-viewer-top"><span>${esc(name)}</span>
        <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:image-close" data-act="file-viewer-close">${icon('close')}Cerrar</div>
      </div>
      <div class="file-viewer-stage"><img src="${this.viewerUrl}" alt="${esc(name)}"></div>`;
    this.viewer.hidden = false;
    this.viewerOpen = true;
    this.focus.clear();
    this.focus.pushScope(this.viewer);
    this.focus.focusFirst('[data-focusable]');
  }

  closeViewer({ restore = true } = {}) {
    if (!this.viewerOpen) return;
    this.viewerOpen = false;
    this.viewer.hidden = true;
    this.viewer.innerHTML = '';
    this.focus.popScope();
    if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
    this.viewerUrl = null;
    if (restore && this.viewerReturnFid) this.focus.focusByFid(this.viewerReturnFid);
    this.viewerReturnFid = null;
  }
}
    Object.assign(exports, { FilesScreen });
  };
  __modules["js/games.js"] = function (module, exports, __require) {
/**
 * Juegos: biblioteca SNES integrada con el Gestor de archivos.
 * EmulatorJS ejecuta el núcleo Snes9x dentro de un iframe aislado del launcher.
 */
const { bus } = __require("js/core/events.js");
const { icon } = __require("js/icons.js");
const { esc, toast } = __require("js/ui.js");

const EMULATOR_DATA = 'https://cdn.emulatorjs.org/stable/data/';
const GUIDE_BUTTON = 16;
const EXIT_HOLD_MS = 1500;

const ROM_EXTENSIONS = new Set(['sfc', 'smc', 'fig', 'gd3', 'gd7', 'dx2', 'bsx', 'swc']);

function isSnesRomName(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return Boolean(match && ROM_EXTENSIONS.has(match[1]));
}

function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Tamaño desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

class GamesScreen {
  constructor({ root, focus, files, onOpenFiles }) {
    this.root = root;
    this.focus = focus;
    this.files = files;
    this.onOpenFiles = onOpenFiles;
    this.roms = [];
    this.hasScanned = false;
    this.scanning = false;
    this.isPlaying = false;
    this.currentRom = null;
    this.romUrl = null;
    this.iframe = null;
    this.exitHoldTimer = 0;

    this.root.addEventListener('click', (event) => this.#onClick(event));
    window.addEventListener('message', (event) => {
      if (event.source !== this.iframe?.contentWindow) return;
      if (event.data?.source === 'webbox-snes' && event.data?.action === 'exit') this.stop();
    });
    bus.on('gamepad:button', ({ button, pressed }) => {
      if (!this.isPlaying || button !== GUIDE_BUTTON) return;
      if (pressed) {
        clearTimeout(this.exitHoldTimer);
        this.exitHoldTimer = setTimeout(() => {
          if (!this.isPlaying) return;
          this.stop();
          toast('Juego cerrado desde el mando.');
        }, EXIT_HOLD_MS);
      } else {
        clearTimeout(this.exitHoldTimer);
        this.exitHoldTimer = 0;
      }
    });
  }

  render() {
    this.root.innerHTML = `
      <h1 class="screen-title">Juegos</h1>
      <p class="games-sub">Juega títulos de Super Nintendo con tus ROMs guardadas en el Gestor de archivos.</p>
      <section class="games-console-card">
        <div class="games-console-art">${icon('gamepad')}</div>
        <div class="games-console-info">
          <span class="games-kicker">CONSOLA DISPONIBLE</span>
          <h2>Super Nintendo (SNES)</h2>
          <p>EmulatorJS · Núcleo Snes9x · Compatible con mando, teclado y controles en pantalla.</p>
          <div class="games-actions">
            <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="games:scan" data-act="games-scan">${icon('search')}Buscar ROMs en Archivos</div>
            <div class="btn btn--secondary" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="games:files" data-act="games-files">${icon('folder')}Abrir Gestor de archivos</div>
          </div>
        </div>
      </section>
      <section class="games-library" data-games-library>
        <div class="games-library-head">
          <div>
            <h2>Biblioteca de juegos</h2>
            <p data-games-location>Busca ROMs dentro de la ubicación abierta en el Gestor de archivos.</p>
          </div>
          <span class="games-count" data-games-count>0 juegos</span>
        </div>
        <div class="games-rom-list" data-games-rom-list>
          <div class="games-empty">
            <span>${icon('folder')}</span>
            <h3>Aún no hay ROMs cargadas</h3>
            <p>Abre el Gestor de archivos, selecciona la carpeta donde guardas tus ROMs o abre el almacenamiento interno y vuelve aquí para buscarlas.</p>
          </div>
        </div>
      </section>
      <section class="games-player" data-games-player hidden>
        <div class="games-player-head">
          <div class="games-now-playing">
            <span class="games-kicker">REPRODUCIENDO</span>
            <strong data-games-current-name></strong>
          </div>
          <div class="games-player-actions">
            <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="games:fullscreen" data-act="games-fullscreen">${icon('fullscreen')}Pantalla completa</div>
            <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="games:stop" data-act="games-stop">${icon('close')}Salir del juego</div>
          </div>
        </div>
        <div class="games-frame-wrap" data-games-frame></div>
        <p class="games-controls-hint">Mando: cruceta + botones · Teclado: flechas y teclas configuradas por EmulatorJS · Mantén GUIDE 1,5 s para salir.</p>
      </section>`;
    this.#renderRomList();
  }

  focusEntry() {
    this.focus.focusFirst('#screen-games [data-zone="main"]');
    if (!this.hasScanned && this.files.rootDirectory) this.scan();
  }

  async handleBack() {
    if (!this.isPlaying) return false;
    this.stop();
    return true;
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    const list = this.root.querySelector('[data-games-rom-list]');
    if (list) list.innerHTML = '<div class="games-empty"><span class="games-spinner"></span><h3>Buscando ROMs…</h3><p>Revisando las carpetas del Gestor de archivos.</p></div>';
    try {
      const result = await this.files.findSnesRoms();
      this.roms = result.roms;
      this.hasScanned = true;
      const backendNames = { native: 'carpeta del equipo', opfs: 'almacenamiento OPFS', idb: 'almacenamiento IndexedDB' };
      const location = this.root.querySelector('[data-games-location]');
      if (location) location.textContent = `${result.rootName} · ${backendNames[result.backend] || 'almacenamiento interno'}`;
      if (result.truncated) toast('La búsqueda alcanzó el límite de seguridad. Se muestran los primeros resultados.', 4200);
      this.#renderRomList();
      toast(`${this.roms.length} ROM${this.roms.length === 1 ? '' : 's'} SNES encontrada${this.roms.length === 1 ? '' : 's'}.`);
    } catch (error) {
      this.roms = [];
      this.hasScanned = false;
      this.#renderRomList(error?.message || 'No se pudieron buscar las ROMs.');
      toast(error?.message || 'No se pudieron buscar las ROMs.', 4200);
    } finally {
      this.scanning = false;
      this.focus.focusByFid('games:scan');
    }
  }

  #renderRomList(message = '') {
    const list = this.root.querySelector('[data-games-rom-list]');
    const count = this.root.querySelector('[data-games-count]');
    if (!list) return;
    if (count) count.textContent = `${this.roms.length} juego${this.roms.length === 1 ? '' : 's'}`;
    if (!this.roms.length) {
      const text = message || (this.hasScanned
        ? 'No encontramos ROMs SNES. Aceptamos archivos .sfc, .smc, .fig, .gd3, .gd7, .dx2, .bsx y .swc.'
        : 'Busca ROMs dentro de la ubicación abierta en el Gestor de archivos.');
      list.innerHTML = `
        <div class="games-empty">
          <span>${icon('gamepad')}</span>
          <h3>${this.hasScanned ? 'No se encontraron juegos' : 'Aún no hay ROMs cargadas'}</h3>
          <p>${esc(text)}</p>
        </div>`;
      return;
    }
    list.innerHTML = this.roms.map((rom, index) => `
      <article class="games-rom-card">
        <div class="games-rom-icon">${icon('gamepad')}</div>
        <div class="games-rom-info">
          <strong>${esc(rom.name)}</strong>
          <span>${esc(rom.path)} · ${readableSize(rom.size)}</span>
        </div>
        <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="games:rom:${index}" data-act="games-play" data-index="${index}">
          ${icon('play')}Jugar
        </div>
      </article>`).join('');
  }

  async #onClick(event) {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    switch (action.dataset.act) {
      case 'games-scan':
        await this.scan();
        break;
      case 'games-files':
        this.onOpenFiles?.();
        break;
      case 'games-play':
        await this.play(Number(action.dataset.index));
        break;
      case 'games-stop':
        this.stop();
        break;
      case 'games-fullscreen':
        this.#fullscreen();
        break;
      default:
        break;
    }
  }

  async play(index) {
    const rom = this.roms[index];
    if (!rom || this.isPlaying) return;
    this.stop({ restore: false });
    this.currentRom = rom;
    this.romUrl = URL.createObjectURL(rom.file);
    this.isPlaying = true;
    const library = this.root.querySelector('[data-games-library]');
    const player = this.root.querySelector('[data-games-player]');
    const frameHost = this.root.querySelector('[data-games-frame]');
    const title = this.root.querySelector('[data-games-current-name]');
    if (library) library.hidden = true;
    if (player) player.hidden = false;
    if (title) title.textContent = rom.name;

    const iframe = document.createElement('iframe');
    iframe.className = 'games-emulator-frame';
    iframe.title = `Emulador SNES: ${rom.name}`;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-forms');
    iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('tabindex', '0');
    iframe.srcdoc = this.#emulatorDocument(this.romUrl);
    this.iframe = iframe;
    frameHost?.replaceChildren(iframe);
    iframe.addEventListener('load', () => iframe.focus(), { once: true });
    iframe.focus();
    toast(`Iniciando ${rom.name}…`);
  }

  #emulatorDocument(romUrl) {
    const scriptOpen = '<scr' + 'ipt>';
    const scriptClose = '</scr' + 'ipt>';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Emulador SNES · WebBox OS</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font:14px system-ui,sans-serif}
  #game{width:100%;height:100%;min-height:260px}#load-error{display:none;position:absolute;inset:0;z-index:50;padding:28px;background:#111827;color:#fecaca;line-height:1.6}
</style>
</head>
<body>
  <div id="game"></div>
  <div id="load-error">No se pudo descargar el emulador SNES. Comprueba tu conexión a Internet y vuelve a cargar el juego.</div>
  ${scriptOpen}
    window.EJS_player = '#game';
    window.EJS_core = 'snes';
    window.EJS_language = 'es-419';
    window.EJS_gameUrl = ${JSON.stringify(romUrl)};
    window.EJS_pathtodata = ${JSON.stringify(EMULATOR_DATA)};
    window.EJS_biosUrl = '';
    window.EJS_mouse = false;
    window.EJS_multitap = false;
    window.EJS_threads = false;
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.key === 'BrowserBack') {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.parent.postMessage({ source: 'webbox-snes', action: 'exit' }, '*');
      }
    }, true);
    var loader = document.createElement('script');
    loader.src = ${JSON.stringify(`${EMULATOR_DATA}loader.js`)};
    loader.onerror = function () { document.getElementById('load-error').style.display = 'block'; };
    document.body.appendChild(loader);
  ${scriptClose}
</body>
</html>`;
  }

  #fullscreen() {
    const target = this.iframe;
    if (!target) return;
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!request) return;
    Promise.resolve(request.call(target)).catch(() => toast('No se pudo activar pantalla completa.'));
  }

  stop({ restore = true } = {}) {
    if (!this.isPlaying && !this.iframe && !this.romUrl) return;
    clearTimeout(this.exitHoldTimer);
    this.exitHoldTimer = 0;
    this.isPlaying = false;
    this.iframe?.remove();
    this.iframe = null;
    if (this.romUrl) URL.revokeObjectURL(this.romUrl);
    this.romUrl = null;
    this.currentRom = null;
    const library = this.root.querySelector('[data-games-library]');
    const player = this.root.querySelector('[data-games-player]');
    const frameHost = this.root.querySelector('[data-games-frame]');
    if (frameHost) frameHost.replaceChildren();
    if (library) library.hidden = false;
    if (player) player.hidden = true;
    if (restore) this.focus.focusByFid('games:scan');
  }
}
    Object.assign(exports, { isSnesRomName, GamesScreen });
  };
  __modules["js/music.js"] = function (module, exports, __require) {
/**
 * Música: canciones de YouTube pegadas por el usuario, mostradas como un carrusel
 * de portadas (la central, grande) con una barra de reproducción de cristal.
 * El audio lo reproduce el reproductor oficial de YouTube en un contenedor
 * invisible, así que la música sigue sonando aunque cambies de pantalla.
 */
const { parseMediaUrl, youtubeThumb, formatTime } = __require("js/core/media.js");
const { loadYouTubeApi } = __require("js/player.js");
const { icon } = __require("js/icons.js");
const { esc, toast } = __require("js/ui.js");

const PALETTE = [
  ['#7c2d12', '#f59e0b'], ['#1e3a8a', '#7c3aed'], ['#065f46', '#34d399'],
  ['#831843', '#fb7185'], ['#0c4a6e', '#38bdf8'], ['#312e81', '#ec4899'],
  ['#7f1d1d', '#f97316'], ['#134e4a', '#2dd4bf'],
];
const ERRORS = {
  2: 'El enlace no es válido.',
  5: 'El reproductor de YouTube tuvo un error.',
  100: 'La canción no existe o es privada.',
  101: 'El dueño de este video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
  150: 'El dueño de este video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
};
const VISIBLE_SIDE = 2; // portadas visibles a cada lado de la central

const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

class MusicScreen {
  /**
   * @param {{root:HTMLElement, focus:object, lib:object, onAdd:()=>void, onDelete:(item:object)=>void}} opts
   */
  constructor({ root, focus, lib, onAdd, onDelete }) {
    this.root = root;
    this.focus = focus;
    this.lib = lib;
    this.onAdd = onAdd;
    this.onDelete = onDelete;
    this.items = [];
    this.index = 0;
    this.selectedId = null;
    this.nowId = null;
    this.lastCount = null;
    this.yt = null;
    this.ytReady = null;
    this.loadToken = 0;
    this.playing = false;
    this.timer = 0;

    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('tvfocus', (e) => {
      const card = e.target.closest?.('.mcard');
      if (card) this.#select(card.dataset.id);
    });
    // Las portadas rotas se quitan y queda el degradado.
    root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.remove();
    }, true);
  }

  // ------------------------------------------------------------------ vista

  render() {
    this.items = this.lib.items();
    if (this.lastCount !== null && this.items.length > this.lastCount) this.selectedId = this.items.at(-1).id;
    this.lastCount = this.items.length;
    const found = this.items.findIndex((i) => i.id === this.selectedId);
    this.index = found >= 0 ? found : 0;
    this.selectedId = this.items[this.index]?.id ?? null;
    if (this.nowId && !this.items.some((i) => i.id === this.nowId)) this.#stop();

    const has = this.items.length > 0;
    this.root.innerHTML = `
      <div class="music">
        <div class="music-bg" data-bg></div>
        <header class="music-head">
          <div>
            <h1 class="screen-title">Música</h1>
            <p class="lib-sub">Busca la canción en YouTube Music, copia su enlace y pégalo con Agregar.</p>
          </div>
          <div class="music-head-actions">
            <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main" data-mz="add"
                 data-fid="mus:add" data-act="mus-add">${icon('plus')}Agregar</div>
            <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main" data-mz="add"
                 data-fid="mus:site" data-act="mus-site">${icon('external')}Buscar en YouTube Music</div>
          </div>
        </header>
        ${has ? `<div class="music-stage" data-stage>${this.items.map((it, i) => this.#card(it, i)).join('')}</div>` : `
        <div class="lib-empty music-empty"><b>Aún no hay canciones.</b><br>Pulsa <b>Agregar</b> y pega un enlace de YouTube
        (una canción o una lista). El título y el artista se completan solos.</div>`}
        <div class="music-bar" data-bar>
          ${this.#barBtn('prev', 'prev', 'Anterior')}
          ${this.#barBtn('play', 'playsolid', 'Reproducir')}
          ${this.#barBtn('next', 'next', 'Siguiente')}
          <div class="mnow" data-now>
            <span class="mnow-art" data-now-art></span>
            <span class="mnow-text"><b data-now-title>—</b><small data-now-artist>Nada en reproducción</small></span>
            <span class="mnow-time" data-now-time></span>
            <span class="mnow-progress"><i data-progress></i></span>
          </div>
          ${this.#barBtn('mute', 'volume', 'Sonido')}
          ${this.#barBtn('delete', 'trash', 'Eliminar canción')}
        </div>
      </div>`;
    this.#applyPositions();
    this.#updateBar();
  }

  #barBtn(name, ico, label) {
    return `
      <div class="mbtn" role="button" tabindex="-1" data-focusable data-zone="main" data-mz="bar"
           data-fid="mus:${name}" data-act="mus-${name}" aria-label="${esc(label)}" data-btn="${name}">${icon(ico)}</div>`;
  }

  #artist(item) {
    if (item.artist) return item.artist;
    return parseMediaUrl(item.url)?.videoId ? 'YouTube' : 'Lista de YouTube';
  }

  #thumb(item) {
    return item.image || youtubeThumb(parseMediaUrl(item.url));
  }

  #card(item, i) {
    const [c1, c2] = PALETTE[hash(item.title) % PALETTE.length];
    const img = this.#thumb(item);
    return `
      <div class="mcard" role="button" tabindex="-1" data-focusable data-noreveal data-zone="main" data-mz="card"
           data-kind="mus" data-id="${esc(item.id)}" data-fid="${esc(this.lib.fid(item.id))}"
           style="--c1:${c1};--c2:${c2};--d:${i};--ad:${Math.abs(i)}" aria-label="${esc(item.title)}">
        <span class="mcard-art">
          <span class="mcard-ico">${icon('music')}</span>
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="mcard-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
        <span class="mcard-info"><b>${esc(item.title)}</b><small>${esc(this.#artist(item))}</small></span>
      </div>`;
  }

  /** Coloca cada portada según su distancia a la seleccionada (animado por CSS). */
  #applyPositions() {
    const cards = this.root.querySelectorAll('.mcard');
    cards.forEach((card, i) => {
      const d = i - this.index;
      card.style.setProperty('--d', d);
      card.style.setProperty('--ad', Math.abs(d));
      card.classList.toggle('is-far', Math.abs(d) > VISIBLE_SIDE);
      card.classList.toggle('is-playing', card.dataset.id === this.nowId);
    });
    const item = this.items[this.index];
    const bg = this.root.querySelector('[data-bg]');
    if (!bg) return;
    const img = item && this.#thumb(item);
    const [c1, c2] = PALETTE[hash(item?.title ?? 'webbox') % PALETTE.length];
    bg.style.setProperty('--c1', c1);
    bg.style.setProperty('--c2', c2);
    bg.style.backgroundImage = img ? `url("${img}")` : '';
  }

  #select(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0 || i === this.index) return;
    this.index = i;
    this.selectedId = id;
    this.#applyPositions();
    this.#updateBar();
  }

  // -------------------------------------------------------------- barra

  #updateBar() {
    const shown = this.items.find((i) => i.id === this.nowId) ?? this.items[this.index];
    const q = (s) => this.root.querySelector(s);
    if (!q('[data-bar]')) return;
    q('[data-now-title]').textContent = shown ? shown.title : '—';
    q('[data-now-artist]').textContent = shown ? this.#artist(shown) : 'Nada en reproducción';
    const art = q('[data-now-art]');
    const img = shown && this.#thumb(shown);
    art.innerHTML = img ? `<img src="${esc(img)}" alt="">` : icon('music');

    const play = q('[data-btn="play"]');
    play.innerHTML = icon(this.playing ? 'pause' : 'playsolid');
    play.setAttribute('aria-label', this.playing ? 'Pausar' : 'Reproducir');
    const muted = Boolean(this.yt?.isMuted?.());
    q('[data-btn="mute"]').innerHTML = icon(muted ? 'mute' : 'volume');
    for (const name of ['prev', 'play', 'next', 'delete']) {
      q(`[data-btn="${name}"]`).setAttribute('aria-disabled', String(!this.items.length));
    }
    this.root.querySelector('.music-bar')?.classList.toggle('is-playing', this.playing);
    for (const card of this.root.querySelectorAll('.mcard')) {
      card.classList.toggle('is-playing', card.dataset.id === this.nowId && this.playing);
    }
  }

  #tick() {
    if (!this.yt?.getCurrentTime) return;
    const cur = this.yt.getCurrentTime() || 0;
    const dur = this.yt.getDuration() || 0;
    const bar = this.root.querySelector('[data-progress]');
    const time = this.root.querySelector('[data-now-time]');
    if (bar) bar.style.width = dur ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';
    if (time) time.textContent = dur ? `${formatTime(cur)} / ${formatTime(dur)}` : '';
  }

  // ------------------------------------------------------------ reproducción

  async play(id) {
    const item = this.items.find((i) => i.id === id);
    const media = item && parseMediaUrl(item.url);
    if (!item || media?.type !== 'youtube') return;
    this.nowId = id;
    this.#select(id);
    this.#applyPositions();
    const token = ++this.loadToken;
    try {
      await loadYouTubeApi();
    } catch {
      toast('Necesitas conexión a Internet para reproducir música de YouTube.', 4500);
      this.nowId = null;
      this.#updateBar();
      return;
    }
    if (token !== this.loadToken) return;
    try {
      if (!this.yt) await this.#createPlayer(media);
      else if (media.videoId) this.yt.loadVideoById({ videoId: media.videoId, startSeconds: media.start || 0 });
      else this.yt.loadPlaylist({ listType: 'playlist', list: media.listId });
    } catch (err) {
      toast(`No se pudo iniciar la música (${err?.message || 'error'}).`, 4500);
      this.nowId = null;
    }
    this.#updateBar();
  }

  async #createPlayer(media) {
    let host = document.getElementById('music-engine');
    if (!host) {
      host = document.createElement('div');
      host.id = 'music-engine';
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '<div></div>';
      document.body.appendChild(host);
    }
    const vars = { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, fs: 0, modestbranding: 1 };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    if (media.start) vars.start = media.start;
    if (media.listId) {
      vars.listType = 'playlist';
      vars.list = media.listId;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tiempo agotado')), 15000);
      this.yt = new window.YT.Player(host.firstElementChild, {
        host: 'https://www.youtube-nocookie.com',
        width: '200',
        height: '200',
        videoId: media.videoId || undefined,
        playerVars: vars,
        events: {
          onReady: () => { clearTimeout(timer); resolve(); },
          onStateChange: (e) => this.#onState(e.data),
          onError: (e) => this.#onError(e.data),
        },
      });
    });
  }

  #onState(state) {
    this.playing = state === 1 || state === 3;
    clearInterval(this.timer);
    if (this.playing) this.timer = setInterval(() => this.#tick(), 500);
    if (state === 0) {
      // Terminó la canción: pasa a la siguiente de la lista, si hay.
      const i = this.items.findIndex((it) => it.id === this.nowId);
      if (i >= 0 && i < this.items.length - 1) this.play(this.items[i + 1].id);
    }
    this.#tick();
    this.#updateBar();
  }

  #onError(code) {
    toast(ERRORS[code] ?? 'No se pudo reproducir esta canción.', 5000);
    this.playing = false;
    this.#updateBar();
  }

  toggle() {
    if (!this.items.length) return;
    if (!this.nowId || !this.yt) {
      this.play(this.items[this.index].id);
      return;
    }
    if (this.playing) this.yt.pauseVideo();
    else this.yt.playVideo();
  }

  /** Pausa sin perder el lugar (por ejemplo, al abrir un video). */
  pause() {
    if (this.playing) this.yt?.pauseVideo?.();
  }

  #stop() {
    this.loadToken += 1;
    try { this.yt?.stopVideo?.(); } catch { /* ya no existe */ }
    this.nowId = null;
    this.playing = false;
    clearInterval(this.timer);
  }

  #skip(delta) {
    if (!this.items.length) return;
    const base = this.items.findIndex((i) => i.id === this.nowId);
    const from = base >= 0 ? base : this.index;
    const next = from + delta;
    if (next < 0 || next >= this.items.length) {
      toast(delta > 0 ? 'Es la última canción.' : 'Es la primera canción.');
      return;
    }
    this.play(this.items[next].id);
    this.focus.focusByFid(this.lib.fid(this.items[next].id), { scroll: false });
  }

  // ------------------------------------------------------------- entradas

  focusEntry() {
    if (!(this.selectedId && this.focus.focusByFid(this.lib.fid(this.selectedId)))) {
      this.focus.focusFirst('#screen-music [data-zone="main"]');
    }
  }

  /** Navegación propia del carrusel. Devuelve true si consumió la acción. */
  handleAction(action) {
    const cur = this.focus.current;
    const mz = cur?.dataset.mz;
    if (!mz || !this.root.contains(cur)) return false;
    const card = () => this.focus.focusByFid(this.lib.fid(this.selectedId));

    if (mz === 'card' && (action === 'left' || action === 'right')) {
      const next = this.index + (action === 'right' ? 1 : -1);
      if (next < 0 || next >= this.items.length) {
        this.focus.bump(cur, action);
      } else {
        this.focus.focusByFid(this.lib.fid(this.items[next].id), { scroll: false });
      }
      return true;
    }
    if (action === 'up') {
      if (mz === 'bar') return card() || true;
      if (mz === 'card') return this.focus.focusByFid('mus:add') || true;
    }
    if (action === 'down') {
      if (mz === 'add' && this.items.length) return card() || true;
      if (mz === 'card') return this.focus.focusByFid('mus:play') || true;
    }
    return false;
  }

  #onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      switch (btn.dataset.act) {
        case 'mus-add': this.onAdd(); break;
        case 'mus-site': window.open('https://music.youtube.com/', '_blank', 'noopener'); break;
        case 'mus-play': this.toggle(); break;
        case 'mus-prev': this.#skip(-1); break;
        case 'mus-next': this.#skip(1); break;
        case 'mus-mute':
          if (this.yt?.isMuted?.()) this.yt.unMute(); else this.yt?.mute?.();
          this.#updateBar();
          break;
        case 'mus-delete': {
          const item = this.items[this.index];
          if (item) this.onDelete(item);
          break;
        }
        default: break;
      }
      return;
    }
    const card = e.target.closest('.mcard');
    if (card) this.play(card.dataset.id);
  }
}
    Object.assign(exports, { MusicScreen });
  };
  __modules["js/data/library.js"] = function (module, exports, __require) {
/**
 * Contenido inicial de las bibliotecas. Aquí puedes agregar cosas editando el
 * archivo, o directamente desde la interfaz con el botón "+ Agregar"
 * (lo agregado desde la interfaz se guarda en el navegador).
 *
 * Campos:  title (obligatorio) · url (obligatorio) · category (fila donde aparece)
 *          image (opcional: póster/miniatura; en YouTube se usa la miniatura sola)
 *
 * url acepta:
 *   - YouTube: https://www.youtube.com/watch?v=XXXXXXXXXXX  (también listas y youtu.be)
 *   - Archivo de video: assets/movies/mi-pelicula.mp4  (.mp4 .webm .ogv .mov .mkv)
 */

const YOUTUBE_DEFAULTS = [
  // { title: 'Mi video', url: 'https://www.youtube.com/watch?v=XXXXXXXXXXX', category: 'Favoritos' },
];

const MOVIES_DEFAULTS = [
  // { title: 'Mi película', url: 'assets/movies/mi-pelicula.mp4', category: 'Acción', image: 'assets/movies/mi-pelicula.jpg' },
];
    Object.assign(exports, { YOUTUBE_DEFAULTS, MOVIES_DEFAULTS });
  };
  __modules["js/cardMenu.js"] = function (module, exports, __require) {
/**
 * Menú de acciones que aparece al pulsar dos veces una tarjeta (o un fondo).
 * Cada acción puede pedir un archivo: se abre el selector del sistema y el
 * archivo elegido se entrega a `onSelect(file)`.
 * Es un ámbito de foco propio, así que se maneja con mando, teclado y mouse.
 */
const { icon } = __require("js/icons.js");
const { esc } = __require("js/ui.js");

class CardMenu {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.spec = null;
    this.returnFid = null;
    this.pendingAction = null;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('change', (e) => this.#onFile(e));
  }

  /**
   * @param {{title:string, subtitle?:string, fallbackFid?:string,
   *   actions:{id:string,label:string,icon?:string,danger?:boolean,file?:boolean,
   *   onSelect:(file?:File)=>Promise<void>|void}[]}} spec
   */
  open(spec) {
    if (this.isOpen) return;
    this.spec = spec;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    const buttons = spec.actions
      .map(
        (a) => `
        <div class="btn menu-btn${a.danger ? ' btn--danger' : ''}" role="button" tabindex="-1" data-focusable
             data-zone="cardmenu" data-fid="cm:${esc(a.id)}" data-act="cm-action" data-id="${esc(a.id)}">
          ${icon(a.icon ?? 'star')}${esc(a.label)}
        </div>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="dialog-card menu-card">
        <h2>${esc(spec.title)}</h2>
        ${spec.subtitle ? `<p class="dialog-hint">${esc(spec.subtitle)}</p>` : ''}
        <div class="menu-actions">
          ${buttons}
          <div class="btn menu-btn btn--ghost" role="button" tabindex="-1" data-focusable
               data-zone="cardmenu" data-fid="cm:cancel" data-act="cm-cancel">${icon('back')}Cancelar</div>
        </div>
        <input type="file" accept="image/*" data-cm-file hidden>
      </div>`;
    this.el.hidden = false;
    this.isOpen = true;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusFirst('[data-focusable]');
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    if (!restore) return false;
    return this.#restoreFocus();
  }

  #restoreFocus() {
    return (
      this.focus.focusByFid(this.returnFid) ||
      (this.spec?.fallbackFid && this.focus.focusByFid(this.spec.fallbackFid)) ||
      this.focus.focusFirst('[data-zone="main"]')
    );
  }

  #find(id) {
    return this.spec?.actions.find((a) => a.id === id);
  }

  async #run(action, file) {
    // Se cierra primero para que la acción pueda volver a dibujar la pantalla.
    this.close({ restore: false });
    try {
      await action.onSelect(file);
    } finally {
      this.#restoreFocus();
    }
  }

  #onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'cm-cancel') {
      this.close();
      return;
    }
    if (el.dataset.act !== 'cm-action') return;
    const action = this.#find(el.dataset.id);
    if (!action) return;
    if (action.file) {
      this.pendingAction = action;
      this.el.querySelector('[data-cm-file]')?.click();
    } else {
      this.#run(action);
    }
  }

  #onFile(e) {
    if (!e.target.matches?.('[data-cm-file]')) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    const action = this.pendingAction;
    this.pendingAction = null;
    if (file && action) this.#run(action, file);
  }
}
    Object.assign(exports, { CardMenu });
  };
  __modules["js/core/images.js"] = function (module, exports, __require) {
/** Utilidades de imagen: convierte una foto elegida por el usuario en un icono cuadrado y ligero. */

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

/** Recorta al centro (cover) y reduce a `size`×`size`. Devuelve una URL de datos (WebP o PNG). */
async function toIconDataUrl(file, size = 256) {
  if (!(file instanceof Blob) || !String(file.type).startsWith('image/')) {
    throw new Error('Elige un archivo de imagen (JPG, PNG, WEBP, GIF, SVG…).');
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen supera el límite de 12 MB.');

  const img = await loadImage(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('La imagen no tiene dimensiones válidas.');

  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);

  const webp = canvas.toDataURL('image/webp', 0.88);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
    Object.assign(exports, { toIconDataUrl });
  };
  __modules["js/main.js"] = function (module, exports, __require) {
/**
 * WebBox OS — punto de entrada.
 * Une entradas (teclado, mando, mouse), foco, router de pantallas y ajustes.
 *
 * Flujo: teclado/mando -> bus 'action' -> onAction() -> FocusManager / router.
 */
const { bus } = __require("js/core/events.js");
const { config } = __require("js/core/config.js");
const { FocusManager } = __require("js/core/focus.js");
const { GamepadManager } = __require("js/input/gamepad.js");
const { KeyboardInput } = __require("js/input/keyboard.js");
const { Launcher } = __require("js/launcher.js");
const { SettingsScreen } = __require("js/settings.js");
const { LibraryScreen } = __require("js/library.js");
const { api } = __require("js/api.js");
const { Player } = __require("js/player.js");
const { Dialog } = __require("js/dialog.js");
const { FilesScreen } = __require("js/files.js");
const { GamesScreen } = __require("js/games.js");
const { MusicScreen } = __require("js/music.js");
const { getHandle, saveHandle, removeHandle, getStoredFile, supportsFileSystemAccess } = __require("js/fileSystem.js");
const { YOUTUBE_DEFAULTS, MOVIES_DEFAULTS } = __require("js/data/library.js");
const { parseMediaUrl } = __require("js/core/media.js");
const { BACKGROUNDS } = __require("js/data/apps.js");
const { getBackground, customIdFromValue } = __require("js/backgroundStore.js");
const { CardMenu } = __require("js/cardMenu.js");
const { toIconDataUrl } = __require("js/core/images.js");
const { storage } = __require("js/core/storage.js");
const { MEDIA_LOCATIONS } = __require("js/data/apps.js");
const { hydrateIcons, icon } = __require("js/icons.js");
const { esc, toast } = __require("js/ui.js");

const $ = (selector, root = document) => root.querySelector(selector);

const INPUT_LABELS = { keyboard: 'Teclado', gamepad: 'Mando', mouse: 'Mouse' };

class WebBoxOS {
  constructor() {
    this.shell = $('#shell');
    this.overlay = $('#overlay');
    this.sidebar = $('#sidebar');
    this.screens = {
      home: $('#screen-home'),
      apps: $('#screen-apps'),
      youtube: $('#screen-youtube'),
      movies: $('#screen-movies'),
      music: $('#screen-music'),
      files: $('#screen-files'),
      games: $('#screen-games'),
      settings: $('#screen-settings'),
    };
    this.current = 'home';
    this.navName = '';
    this.mediaFolders = this.#loadMediaFolders();
    this.overlayOpen = false;
    this.overlayReturnFid = null;
    this.lastPointerMove = 0;
    this.cursorTimer = 0;
    this.backgroundRequest = 0;
    this.backgroundObjectUrl = null;

    this.focus = new FocusManager(this.shell);
    this.gamepad = new GamepadManager();
    this.keyboard = new KeyboardInput();
    this.launcher = new Launcher({
      homeEl: this.screens.home,
      appsEl: this.screens.apps,
      onOpen: (item) => this.openItem(item),
      onMenu: (item) => this.#openCardMenu(item),
      onChooseLocation: (key) => this.#chooseLocation(key),
      getLocations: () => this.mediaFolders,
    });
    this.launcher.onRestored = () => this.#enterScreen(this.current);
    this.player = new Player({ el: $('#player'), focus: this.focus });
    this.dialog = new Dialog({ el: $('#dialog'), focus: this.focus });
    this.cardMenu = new CardMenu({ el: $('#cardmenu'), focus: this.focus });
    const common = {
      onPlay: (item, lib) => this.#playLibraryItem(item, lib),
      onAdd: (lib) => this.#openAddDialog(lib),
      onExtra: (extra) => {
        if (extra === 'youtube-site') window.open('https://www.youtube.com/', '_blank', 'noopener');
      },
    };
    this.libraries = {
      youtube: new LibraryScreen({
        ...common,
        id: 'youtube',
        root: this.screens.youtube,
        defaults: YOUTUBE_DEFAULTS,
        title: 'YouTube',
        subtitle:
          'YouTube dentro de WebBox OS, con controles para mando. Agrega enlaces de videos o listas y reprodúcelos aquí.',
        defaultCategory: 'Mis videos',
        cardStyle: 'wide',
        cardIcon: 'youtube',
        accept: ['youtube'],
        extraButtons: [{ label: 'Abrir youtube.com', icon: 'external', extra: 'youtube-site' }],
        emptyText:
          '<b>Aún no hay videos.</b><br>Pulsa <b>Agregar</b>, pega un enlace de YouTube (video o lista) y listo. ' +
          'También puedes dejarlos fijos en <b>js/data/library.js</b>.',
      }),
      movies: new LibraryScreen({
        ...common,
        id: 'movies',
        root: this.screens.movies,
        defaults: MOVIES_DEFAULTS,
        title: 'Películas',
        subtitle: 'Tu biblioteca. Agrega enlaces de YouTube, archivos del equipo desde Archivos o rutas de video locales.',
        defaultCategory: 'Mis películas',
        cardStyle: 'poster',
        cardIcon: 'film',
        accept: ['youtube', 'video'],
        emptyText:
          '<b>Aquí irán tus películas.</b><br>Pulsa <b>Agregar</b> para guardar un enlace o abre <b>Archivos</b> ' +
          'y usa <b>Agregar a Películas</b> sobre cualquier video del equipo.',
      }),
    };
    this.files = new FilesScreen({
      root: this.screens.files,
      focus: this.focus,
      dialog: this.dialog,
      onOpenMedia: (file) => {
        this.music.pause();
        this.player.openFile(file);
      },
      onAddMovie: (entry, name) => this.#addMovieFromFiles(entry, name),
    });
    // Música: misma biblioteca de enlaces de YouTube, mostrada como carrusel de portadas.
    this.musicLib = new LibraryScreen({
      ...common,
      id: 'music',
      root: document.createElement('div'), // solo almacena datos; la vista es MusicScreen
      defaults: [],
      title: 'Música',
      subtitle: '',
      defaultCategory: 'Mi música',
      cardStyle: 'wide',
      cardIcon: 'music',
      accept: ['youtube'],
      emptyText: '',
    });
    this.music = new MusicScreen({
      root: this.screens.music,
      focus: this.focus,
      lib: this.musicLib,
      onAdd: () => this.#openAddDialog(this.musicLib),
      onDelete: (item) => this.#confirmDeleteSong(item),
    });
    this.musicLib.onChange = () => this.music.render();
    this.games = new GamesScreen({
      root: this.screens.games,
      focus: this.focus,
      files: this.files,
      onOpenFiles: () => this.navigate('files', { enter: true }),
    });
    this.settings = new SettingsScreen({
      root: this.screens.settings,
      focus: this.focus,
      gamepad: this.gamepad,
      onBackgroundMenu: (spec) => this.cardMenu.open(spec),
      server: {
        onSetKey: () => this.#openServerKeyDialog(),
        onRetry: () => this.#refreshServer(),
        onUpload: () => this.#uploadLocalItems(),
      },
    });
  }

  start() {
    hydrateIcons();
    this.launcher.render();
    for (const lib of Object.values(this.libraries)) lib.render();
    this.files.render();
    this.music.render();
    this.games.render();
    this.settings.render();
    this.#applyDisplay();
    this.#bindEvents();
    this.#startClock();
    this.#updatePadChip();

    // En la prueba de botones el mando no navega (se sale manteniendo Atrás 1 s).
    this.gamepad.testModeProvider = () => this.settings.isTestActive() && !this.overlayOpen;
    this.gamepad.start();
    this.keyboard.start();

    this.navigate('home', { enter: true });
    console.info('[WebBox OS] Launcher listo. Gamepad API:', this.gamepad.supported ? 'sí' : 'no');
  }

  // ------------------------------------------------------------- eventos

  #bindEvents() {
    bus.on('action', ({ action, source }) => this.onAction(action, source));

    bus.on('gamepad:connect', ({ name }) => {
      this.#updatePadChip();
      toast(`Mando conectado: ${name}`);
    });
    bus.on('gamepad:disconnect', ({ name }) => {
      this.#updatePadChip();
      toast(`Mando desconectado: ${name}`);
    });
    bus.on('config:change', () => {
      this.#applyDisplay();
    });

    // Menú lateral: cambia de pantalla al recibir el foco; OK entra al contenido.
    this.sidebar.addEventListener('tvfocus', (e) => {
      const item = e.target.closest('[data-screen]');
      if (item) this.navigate(item.dataset.screen);
    });
    this.sidebar.addEventListener('click', (e) => {
      const item = e.target.closest('[data-screen]');
      if (item) this.navigate(item.dataset.screen, { enter: true });
    });
    bus.on('focus:change', () => this.#syncSidebar());

    // Overlay de aplicación abierta
    this.overlay.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'ov-back') this.back();
      if (el.dataset.act === 'ov-home') this.home();
    });

    // Mouse: el puntero mueve el foco; el clic activa el elemento.
    document.addEventListener('mousemove', () => {
      this.lastPointerMove = performance.now();
      document.body.classList.remove('cursor-hidden');
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 3000);
    });
    document.addEventListener('mouseover', (e) => {
      // Solo si el mouse realmente se movió (no por desplazamientos animados).
      if (performance.now() - this.lastPointerMove > 120) return;
      const el = e.target.closest?.('[data-focusable]');
      if (el && this.focus.isInScope(el)) this.focus.set(el, { scroll: false });
    });
    document.addEventListener(
      'click',
      (e) => {
        const el = e.target.closest?.('[data-focusable]');
        if (!el || !this.focus.isInScope(el)) return;
        if (e.isTrusted) this.#setLastInput('mouse');
        this.focus.set(el, { scroll: false });
      },
      true,
    );
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Acción unificada de navegación, venga de donde venga. */
  onAction(action, source) {
    this.#setLastInput(source);
    document.body.classList.add('cursor-hidden');

    // Con el reproductor abierto, la primera pulsación solo muestra los controles ocultos.
    if (this.player.handleAction(action)) return;
    // Mientras se juega, el propio emulador recibe las entradas del mando.
    if (this.games?.isPlaying) return;
    if (
      this.current === 'music' && !this.dialog.isOpen && !this.cardMenu.isOpen &&
      !this.player.isOpen && !this.overlayOpen && this.music.handleAction(action)
    ) return;

    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.focus.move(action);
        break;
      case 'ok':
        this.focus.activate();
        break;
      case 'back':
        this.back();
        break;
      case 'home':
        this.home();
        break;
      default:
        break;
    }
  }

  // --------------------------------------------------------------- router

  /**
   * Cambia de pantalla. `enter` además mueve el foco al contenido.
   */
  navigate(name, { enter = false } = {}) {
    if (!this.screens[name] && name !== 'emulators') return;
    // "Emuladores" abre directamente el emulador de SNES (la pantalla de juegos).
    const view = name === 'emulators' ? 'games' : name;
    if (this.current === 'games' && view !== 'games') this.games?.stop({ restore: false });

    if (view !== this.current) {
      for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== view;
      const el = this.screens[view];
      el.classList.remove('is-entering');
      void el.offsetWidth; // reinicia la animación
      el.classList.add('is-entering');
      this.current = view;
      if (view === 'settings') this.settings.refresh();
    }
    if (name !== this.navName) {
      this.navName = name;
      for (const item of this.sidebar.querySelectorAll('[data-screen]')) {
        item.classList.toggle('is-current', item.dataset.screen === name);
      }
      const title = this.screens.games.querySelector('.screen-title');
      if (title) title.textContent = name === 'emulators' ? 'Emuladores · Super Nintendo' : 'Juegos';
    }
    if (enter) this.#enterScreen(view);
  }

  #enterScreen(name) {
    if (name === 'settings') {
      this.settings.focusEntry();
    } else if (name === 'files') {
      this.files.focusEntry();
    } else if (name === 'games') {
      this.games.focusEntry();
    } else if (name === 'music') {
      this.music.focusEntry();
    } else {
      this.focus.focusFirst('[data-zone="main"]');
    }
  }

  async back() {
    if (this.cardMenu.isOpen) {
      this.cardMenu.close();
      return;
    }
    if (this.dialog.isOpen) {
      this.dialog.close();
      return;
    }
    if (this.player.isOpen) {
      this.player.close();
      return;
    }
    if (this.overlayOpen) {
      this.closeOverlay();
      return;
    }
    if (this.current === 'files' && await this.files.handleBack()) return;
    if (this.current === 'games' && await this.games.handleBack()) return;
    if (this.settings.handleBack()) return;
    if (this.current !== 'home') {
      this.navigate('home', { enter: true });
      return;
    }
    // Ya en inicio: Atrás vuelve a la primera tarjeta.
    if (this.focus.current?.dataset.zone !== 'main') {
      this.focus.focusFirst('[data-zone="main"]');
    } else {
      toast('Estás en el inicio');
    }
  }

  home() {
    if (this.cardMenu.isOpen) this.cardMenu.close({ restore: false });
    if (this.dialog.isOpen) this.dialog.close({ restore: false });
    if (this.player.isOpen) this.player.close({ restore: false });
    if (this.files?.viewerOpen) this.files.closeViewer({ restore: false });
    this.games?.stop({ restore: false });
    if (this.files?.targetOpen) this.files.closeTargetPicker();
    if (this.overlayOpen) this.closeOverlay({ restore: false });
    if (this.settings.capturing) this.settings.cancelCapture();
    this.navigate('home');
    this.screens.home.scrollTo({ top: 0 });
    this.#enterScreen('home');
  }

  // -------------------------------------------------------------- overlay

  openItem(item) {
    if (this.overlayOpen) return;
    // Aplicaciones reales: abren su propia pantalla en vez de la simulación.
    if (item.screen) {
      if (item.kind === 'app') this.launcher.recordRecent(item.id);
      if (item.location) {
        this.#openMediaLocation(item.location).catch((err) =>
          toast(err?.message || 'No se pudo abrir esa carpeta.', 4500));
      }
      this.navigate(item.screen, { enter: true });
      return;
    }
    this.overlayReturnFid = this.focus.current?.dataset.fid ?? null;

    this.overlay.style.setProperty('--c1', item.c1);
    this.overlay.style.setProperty('--c2', item.c2);
    this.overlay.innerHTML = `
      <div class="overlay-card">
        <div class="overlay-icon">${icon(item.icon)}</div>
        <h1>${esc(item.name)}</h1>
        <p class="overlay-sub">${esc(item.subtitle ?? 'Aplicación de ejemplo')}</p>
        <p class="overlay-note">Esta pantalla es una simulación. Las aplicaciones reales llegarán en fases futuras de WebBox OS.</p>
        <div class="overlay-actions">
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="overlay" data-fid="ov:back" data-act="ov-back">${icon('back')}Volver</div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="overlay" data-fid="ov:home" data-act="ov-home">${icon('home')}Inicio</div>
        </div>
      </div>`;
    this.overlay.hidden = false;
    this.overlay.classList.remove('is-entering');
    void this.overlay.offsetWidth;
    this.overlay.classList.add('is-entering');
    this.overlayOpen = true;

    if (item.kind === 'app') this.launcher.recordRecent(item.id);

    this.focus.clear();
    this.focus.pushScope(this.overlay);
    this.focus.focusFirst('[data-focusable]');
  }

  closeOverlay({ restore = true } = {}) {
    if (!this.overlayOpen) return;
    this.overlayOpen = false;
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    this.focus.popScope();

    if (restore) {
      const ok = this.focus.focusByFid(this.overlayReturnFid);
      if (!ok) this.#enterScreen(this.current);
    }
  }

  // ------------------------------------------------ menú de tarjetas

  /** Doble pulsación sobre una tarjeta: cambiar la foto del icono o eliminarla. */
  #openCardMenu(item) {
    if (this.overlayOpen || this.cardMenu.isOpen || this.dialog.isOpen || this.player.isOpen) return;
    const actions = [
      {
        id: 'icon',
        label: 'Cambiar foto del icono',
        icon: 'photo',
        file: true,
        onSelect: async (file) => {
          try {
            this.launcher.setIcon(item.id, await toIconDataUrl(file));
            toast(`Icono actualizado: ${item.name}`);
          } catch (err) {
            toast(err?.message || 'No se pudo usar esa imagen.', 4200);
          }
        },
      },
    ];
    if (this.launcher.hasCustomIcon(item.id)) {
      actions.push({
        id: 'reset',
        label: 'Restaurar icono original',
        icon: 'reset',
        onSelect: () => {
          this.launcher.resetIcon(item.id);
          toast(`Icono original: ${item.name}`);
        },
      });
    }
    actions.push({
      id: 'delete',
      label: 'Eliminar casilla',
      icon: 'trash',
      danger: true,
      onSelect: () => {
        this.launcher.hide(item.id);
        toast(`Eliminado: ${item.name}. Se restaura desde Aplicaciones.`, 3800);
      },
    });
    this.cardMenu.open({
      title: item.name,
      subtitle: 'Elige qué hacer con esta casilla.',
      actions,
    });
  }

  // ------------------------------------------ ubicaciones de contenido

  #loadMediaFolders() {
    const saved = storage.get('mediaFolders', {});
    const out = {};
    for (const { key } of MEDIA_LOCATIONS) {
      const info = saved?.[key];
      if (info && typeof info.name === 'string') out[key] = { name: info.name, internal: Boolean(info.internal) };
    }
    return out;
  }

  #saveMediaFolder(key, info) {
    this.mediaFolders[key] = info;
    storage.set('mediaFolders', this.mediaFolders);
    this.launcher.render();
    this.focus.focusByFid(`loc:${key}`, { scroll: false });
  }

  async #chooseLocation(key) {
    const label = MEDIA_LOCATIONS.find((l) => l.key === key)?.label ?? key;
    if (!supportsFileSystemAccess()) {
      this.#saveMediaFolder(key, { name: 'Almacenamiento interno', internal: true });
      toast(`${label}: este navegador no permite elegir carpetas del equipo; se usará el almacenamiento interno.`, 4800);
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: `webbox-${key}`, mode: 'read' });
      await saveHandle(`media:${key}`, handle);
      this.#saveMediaFolder(key, { name: handle.name || 'Carpeta', internal: false });
      toast(`${label}: ${handle.name || 'carpeta'} guardada.`);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      toast(err?.message || 'No se pudo elegir la carpeta.', 4500);
    }
  }

  /** Abre en el Gestor de archivos la carpeta elegida para fotos o videos. */
  async #openMediaLocation(key) {
    const label = MEDIA_LOCATIONS.find((l) => l.key === key)?.label ?? key;
    const info = this.mediaFolders[key];
    if (!info) {
      toast(`Aún no elegiste la carpeta de ${label}. Hazlo en Aplicaciones > Dónde están tus archivos.`, 5000);
      return;
    }
    if (info.internal) {
      await this.files.openInternal();
      return;
    }
    const handle = await getHandle(`media:${key}`);
    if (!handle) throw new Error(`No se encontró la carpeta de ${label}. Vuelve a elegirla en Aplicaciones.`);
    let permission = await handle.queryPermission?.({ mode: 'read' });
    if (permission !== 'granted' && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: 'read' });
    }
    if (permission && permission !== 'granted') {
      throw new Error(`El navegador no concedió permiso para la carpeta de ${label}. Vuelve a elegirla en Aplicaciones.`);
    }
    await this.files.openLocation({ backend: 'native', handle, name: handle.name || info.name, path: '/', kind: 'directory' });
  }

  // ------------------------------------------------------- bibliotecas

  #openAddDialog(lib) {
    const isMovies = lib.id === 'movies';
    const isMusic = lib.id === 'music';
    this.dialog.open({
      title: isMovies ? 'Agregar película' : isMusic ? 'Agregar música' : 'Agregar a YouTube',
      hint: isMovies
        ? 'Enlace de YouTube o ruta de un archivo (assets/movies/mi-pelicula.mp4). Pulsa OK en un campo para escribir.'
        : isMusic
          ? 'Pega el enlace de YouTube de la canción (o de una lista). Si dejas el título o el artista vacíos se intentan obtener solos.'
          : 'Pega un enlace de video o lista de YouTube. Si dejas el título vacío se intenta obtener solo.',
      fields: isMusic
        ? [
            { key: 'url', label: 'Enlace de YouTube', placeholder: 'https://www.youtube.com/watch?v=…' },
            { key: 'title', label: 'Título de la canción (opcional)', placeholder: 'Se completa solo' },
            { key: 'artist', label: 'Artista (opcional)', placeholder: 'Se completa solo' },
          ]
        : [
            { key: 'url', label: 'Enlace o ruta', placeholder: isMovies ? 'https://… o assets/movies/…mp4' : 'https://www.youtube.com/watch?v=…' },
            { key: 'title', label: isMovies ? 'Título' : 'Título (opcional)', placeholder: isMovies ? 'Nombre de la película' : 'Se completa solo' },
            { key: 'category', label: 'Categoría (fila donde aparece)', value: '', placeholder: lib.defaultCategory },
            ...(isMovies ? [{ key: 'image', label: 'Póster (opcional)', placeholder: 'assets/movies/mi-pelicula.jpg' }] : []),
          ],
      onSubmit: (values) => this.#submitItem(lib, values),
    });
  }

  async #submitItem(lib, values) {
    const media = parseMediaUrl(values.url);
    if (!media) return 'Enlace no válido. Usa un enlace de YouTube o un archivo .mp4 / .webm.';
    const isMusic = lib.id === 'music';
    let title = values.title;
    let artist = values.artist || '';
    if ((!title || (isMusic && !artist)) && media.type === 'youtube' && media.videoId) {
      const info = await fetchYouTubeInfo(values.url);
      title = title || info.title;
      if (isMusic) artist = artist || info.author.replace(/\s*-\s*Topic$/i, '');
    }
    if (!title) return 'Escribe un título para este elemento.';

    const result = lib.add({ ...values, title, artist });
    if (typeof result === 'string') return result;
    toast(`Agregado: ${result.title}`);
    // El foco vuelve a la tarjeta nueva cuando el formulario se cierre.
    this.dialog.returnFid = lib.fid(result.id);
    return null;
  }

  // ---------------------------------------------------- servidor / base de datos

  /** Pide la clave de administrador y la comprueba contra el servidor. */
  #openServerKeyDialog() {
    this.dialog.open({
      title: 'Clave de administrador',
      hint: 'La que escribiste en ADMIN_KEY (archivo .env del servidor). Se guarda solo en este navegador.',
      fields: [{ key: 'key', label: 'Clave', type: 'password', placeholder: 'ADMIN_KEY' }],
      submitLabel: 'Guardar',
      onSubmit: async (values) => {
        if (!values.key) return 'Escribe la clave.';
        if (!api.online) return 'No hay conexión con el servidor.';
        const previous = api.getKey();
        api.setKey(values.key);
        if (!(await api.checkKey())) {
          api.setKey(previous);
          return 'Clave incorrecta (o demasiados intentos: espera un minuto).';
        }
        toast('Clave correcta. Ya puedes agregar y eliminar.');
        this.settings.rerender(true);
        return null;
      },
    });
  }

  /** Vuelve a consultar el servidor y refresca YouTube, Música y Películas. */
  async #refreshServer() {
    await api.loadAll(true);
    await Promise.all([...Object.values(this.libraries), this.musicLib].map((lib) => lib.sync()));
  }

  /** Sube al servidor lo que estaba guardado solo en este navegador. */
  async #uploadLocalItems() {
    const total = { sent: 0, existing: 0, skipped: 0, failed: 0, stopped: null };
    for (const lib of [...Object.values(this.libraries), this.musicLib]) {
      const r = await lib.uploadLocal();
      for (const key of ['sent', 'existing', 'skipped', 'failed']) total[key] += r[key];
      if (r.stopped) {
        total.stopped = r.stopped;
        break;
      }
    }
    await this.#refreshServer();
    return total;
  }

  #confirmDeleteSong(item) {
    this.cardMenu.open({
      title: item.title,
      subtitle: '¿Quitar esta canción de tu música?',
      actions: [
        {
          id: 'delete-song',
          label: 'Eliminar canción',
          icon: 'trash',
          danger: true,
          onSelect: () => {
            this.musicLib.remove(item.id);
            toast(`Eliminada: ${item.title}`);
          },
        },
      ],
    });
  }

  async #playLibraryItem(item, lib) {
    this.music.pause();
    const onDelete = (it) => this.#deleteItem(lib, it);
    if (!item.fileHandleKey) {
      this.player.open(item, { onDelete });
      return;
    }
    try {
      const handle = await getHandle(item.fileHandleKey);
      if (!handle) throw new Error('No se encontró el archivo guardado. Vuelve a agregarlo desde Archivos.');
      let file;
      if (handle?.getFile) {
        let permission = await handle.queryPermission?.({ mode: 'read' });
        if (permission !== 'granted' && handle.requestPermission) {
          permission = await handle.requestPermission({ mode: 'read' });
        }
        if (permission && permission !== 'granted') {
          throw new Error('El navegador no concedió permiso de lectura. Vuelve a elegir la carpeta en Archivos.');
        }
        file = await handle.getFile();
      } else {
        file = await getStoredFile(handle);
      }
      this.player.openFile(file, { onDelete, title: item.title });
    } catch (err) {
      toast(err?.message || 'No se pudo abrir el archivo local.', 4500);
    }
  }

  async #addMovieFromFiles(entry, name) {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const key = `movie:${token}`;
    // En IndexedDB guardamos una referencia simple; OPFS y carpetas del equipo
    // conservan su manejador nativo para poder abrir el archivo más adelante.
    const reference = entry.backend === 'idb'
      ? { backend: 'idb', path: entry.path, name: entry.name }
      : entry.handle;
    await saveHandle(key, reference);
    const result = this.libraries.movies.addFileHandle({ title: name, fileHandleKey: key });
    if (typeof result === 'string') throw new Error(result);
    toast(`Agregado a Películas: ${result.title}`);
  }

  #deleteItem(lib, item) {
    if (item.fileHandleKey) removeHandle(item.fileHandleKey).catch(() => {});
    lib.remove(item.id);
    toast(`Eliminado: ${item.title}`);
    this.#enterScreen(this.current);
  }

  // ------------------------------------------------------------ interfaz

  /** Marca el menú lateral como expandido mientras tenga el foco. */
  #syncSidebar() {
    const inNav = this.focus.current?.dataset.zone === 'nav';
    this.sidebar.classList.toggle('expanded', Boolean(inNav));
  }

  #setLastInput(source) {
    const el = $('#last-input');
    if (el && INPUT_LABELS[source]) el.textContent = INPUT_LABELS[source];
  }

  #updatePadChip() {
    const chip = $('#pad-chip');
    const label = $('#pad-label');
    const pads = this.gamepad.getPads();
    chip.classList.toggle('on', pads.length > 0);
    if (!this.gamepad.supported) {
      label.textContent = 'Gamepad no disponible';
      chip.title = 'Este navegador no soporta la Gamepad API';
    } else if (pads.length) {
      label.textContent = pads.length > 1 ? `${pads[0].name} (+${pads.length - 1})` : pads[0].name;
      chip.title = pads.map((p) => p.id).join('\n');
    } else {
      label.textContent = 'Sin mando';
      chip.title = 'Conecta un mando por Bluetooth y pulsa un botón';
    }
  }

  #applyDisplay() {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(config.get('uiScale') / 100));
    root.style.setProperty('--overscan-x', `${config.get('overscan')}vw`);
    root.style.setProperty('--overscan-y', `${config.get('overscan')}vh`);

    const reduced = config.get('reduceMotion');
    document.body.dataset.motion = reduced ? 'reduced' : 'full';
    this.focus.scrollBehavior = reduced ? 'auto' : 'smooth';

    $('#hints').hidden = !config.get('showHints');

    this.#applyBackground();
    this.#tickClock();
  }

  async #applyBackground() {
    const request = ++this.backgroundRequest;
    const selected = config.get('background');
    let imageUrl = '';
    let isTemporaryUrl = false;

    const customId = customIdFromValue(selected);
    if (customId) {
      try {
        const blob = await getBackground(customId);
        if (request !== this.backgroundRequest) return;
        if (blob) {
          imageUrl = URL.createObjectURL(blob);
          isTemporaryUrl = true;
        }
      } catch (error) {
        console.warn('[WebBox OS] No se pudo recuperar el fondo personalizado.', error);
      }
      if (!imageUrl) {
        if (request !== this.backgroundRequest) return;
        config.set('background', 'aurora');
        return;
      }
    } else {
      const bg = BACKGROUNDS.find((b) => b.id === selected) ?? BACKGROUNDS[0];
      imageUrl = bg.file;
    }

    if (request !== this.backgroundRequest) {
      if (isTemporaryUrl) URL.revokeObjectURL(imageUrl);
      return;
    }
    if (this.backgroundObjectUrl) URL.revokeObjectURL(this.backgroundObjectUrl);
    this.backgroundObjectUrl = isTemporaryUrl ? imageUrl : null;
    $('#bg').style.backgroundImage = `url("${imageUrl}")`;
  }

  #startClock() {
    this.#tickClock();
    setInterval(() => this.#tickClock(), 1000);
  }

  #tickClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !config.get('clock24'),
    });
    const date = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    const timeEl = $('#clock-time');
    const dateEl = $('#clock-date');
    if (timeEl.textContent !== time) timeEl.textContent = time;
    if (dateEl.textContent !== date) dateEl.textContent = date;
  }
}

/** Título y canal de un video de YouTube (oEmbed). Devuelve textos vacíos si no hay conexión o falla. */
async function fetchYouTubeInfo(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { title: '', author: '' };
    const data = await res.json();
    return {
      title: typeof data.title === 'string' ? data.title : '',
      author: typeof data.author_name === 'string' ? data.author_name : '',
    };
  } catch {
    return { title: '', author: '' };
  }
}

window.webbox = new WebBoxOS();
window.webbox.start();
  };
  const __cache = Object.create(null);
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const factory = __modules[id];
    if (!factory) throw new Error('Módulo no encontrado: ' + id);
    const module = { exports: {} };
    __cache[id] = module;
    factory(module, module.exports, __require);
    return module.exports;
  }
  __require("js/main.js");
})();
