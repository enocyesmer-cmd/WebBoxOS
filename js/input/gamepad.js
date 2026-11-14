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
import { bus } from '../core/events.js';
import { config } from '../core/config.js';

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
/** Acciones que, mantenidas, sacan de la pantalla de prueba */
const EXIT_ACTIONS = ['back', 'home'];
const EXIT_HOLD_MS = 1000;

/** "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e ...)" -> "Xbox 360 Controller" */
export function cleanPadName(id = '') {
  const name = id.replace(/\s*\(.*\)\s*$/, '').trim();
  return name || id || 'Mando desconocido';
}

export class GamepadManager {
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
