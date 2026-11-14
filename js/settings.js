/**
 * Pantalla de Configuración.
 * Pestañas: Dispositivo · Mando · Prueba de botones · Navegación · Fondo · Pantalla.
 *
 * Todo es navegable con el foco central: las pestañas (zona "settings-tabs")
 * cambian de panel al recibir el foco; los controles del panel pertenecen a la
 * zona "settings-panel". Los ajustes numéricos usan botones − / + en lugar de
 * deslizadores, porque son mucho más cómodos con un mando.
 */
import { config, ACTIONS, REPEAT_INTERVALS } from './core/config.js';
import { storage } from './core/storage.js';
import { bus } from './core/events.js';
import { icon } from './icons.js';
import { BACKGROUNDS } from './data/apps.js';
import { esc, toast } from './ui.js';

const TABS = [
  { id: 'device', label: 'Dispositivo', icon: 'tv' },
  { id: 'gamepad', label: 'Mando', icon: 'gamepad' },
  { id: 'test', label: 'Prueba de botones', icon: 'check' },
  { id: 'navigation', label: 'Navegación', icon: 'compass' },
  { id: 'background', label: 'Fondo', icon: 'photo' },
  { id: 'display', label: 'Pantalla', icon: 'sun' },
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

export class SettingsScreen {
  /**
   * @param {{root:HTMLElement, focus:import('./core/focus.js').FocusManager,
   *          gamepad:import('./input/gamepad.js').GamepadManager}} opts
   */
  constructor({ root, focus, gamepad }) {
    this.root = root;
    this.focus = focus;
    this.gamepad = gamepad;
    this.active = 'device';
    this.capturing = null; // acción que se está remapeando
    this.confirmReset = false;
    this.live = new Map(); // index -> { cells, bars }

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
    }[this.active];
    this.panelEl.innerHTML = render();
    this.gamepad.setWatching(this.active === 'test');
    if (this.active === 'test') this.#cacheLive();
    this.panelEl.scrollTop = 0;
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
    return `<h2 class="panel-title">Fondo de pantalla</h2><div class="bg-grid">${tiles}</div>`;
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
        config.set('background', el.dataset.id);
        this.rerender(true);
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
