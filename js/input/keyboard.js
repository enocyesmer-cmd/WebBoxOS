/**
 * Entrada de teclado. También cubre los controles remotos Bluetooth que se
 * comportan como teclado (flechas, Enter, Atrás/Escape, Inicio).
 * Traduce teclas a acciones y las publica en el bus.
 */
import { bus } from '../core/events.js';
import { config } from '../core/config.js';

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

export class KeyboardInput {
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
