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
export class EventBus {
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

export const bus = new EventBus();
