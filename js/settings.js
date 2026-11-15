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
import { listBackgrounds, addBackground, deleteBackground, customValue } from './backgroundStore.js';
import { DOUBLE_PRESS_MS } from './launcher.js';
import { api } from './api.js';
import { roleLabel } from './accounts.js';
import { FONTS, FONT_GROUPS, fontById, loadFonts } from './data/fonts.js';
import { esc, toast } from './ui.js';

const TABS = [
  { id: 'device', label: 'Dispositivo', icon: 'tv' },
  { id: 'gamepad', label: 'Mando', icon: 'gamepad' },
  { id: 'test', label: 'Prueba de botones', icon: 'check' },
  { id: 'navigation', label: 'Navegación', icon: 'compass' },
  { id: 'background', label: 'Fondo', icon: 'photo' },
  { id: 'display', label: 'Pantalla', icon: 'sun' },
  { id: 'fonts', label: 'Fuente', icon: 'book' },
  { id: 'account', label: 'Cuenta', icon: 'star', when: () => api.online },
  { id: 'users', label: 'Usuarios', icon: 'gamepad', when: () => api.isAdmin },
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

export class SettingsScreen {
  /**
   * @param {{root:HTMLElement, focus:import('./core/focus.js').FocusManager,
   *          gamepad:import('./input/gamepad.js').GamepadManager}} opts
   */
  constructor({ root, focus, gamepad, onBackgroundMenu, server, accounts }) {
    this.root = root;
    this.focus = focus;
    this.gamepad = gamepad;
    this.onBackgroundMenu = onBackgroundMenu;
    this.server = server; // { onRetry, onUpload }
    this.accounts = accounts; // js/accounts.js
    this.users = null; // lista cargada (pestaña Usuarios)
    this.usersError = '';
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
    this.tabsEl.innerHTML = TABS.filter((t) => !t.when || t.when()).map(
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

  /** Tras iniciar/cerrar sesión: recalcula qué pestañas existen y redibuja. */
  refreshTabs() {
    const visible = TABS.filter((t) => !t.when || t.when()).map((t) => t.id);
    if (!visible.includes(this.active)) this.active = 'device';
    this.users = null;
    this.#renderTabs();
    this.#renderPanel();
  }

  /** Lista de usuarios (pestaña Usuarios), cargada del servidor. */
  async loadUsers() {
    this.usersError = '';
    const r = await api.listUsers();
    if (r.ok) this.users = r.users;
    else {
      this.users = [];
      this.usersError = r.error;
    }
    if (this.active === 'users') this.rerender(true);
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
      fonts: () => this.#fontsHTML(),
      account: () => this.#accountHTML(),
      users: () => this.#usersHTML(),
      server: () => this.#serverHTML(),
    }[this.active];
    this.panelEl.innerHTML = render();
    this.gamepad.setWatching(this.active === 'test');
    if (this.active === 'test') this.#cacheLive();
    this.panelEl.scrollTop = 0;
    if (this.active === 'background') this.#loadCustomBackgroundPreview();
    if (this.active === 'fonts') loadFonts(FONTS); // para ver cada fuente en su propio estilo
    if (this.active === 'users' && this.users === null) this.loadUsers();
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

  // ---------------------------------------------------------------- Fuente

  #fontsHTML() {
    const current = config.get('font');
    const titleCurrent = config.get('titleFont');
    const tile = (f, kind, selected) => `
      <div class="font-tile${selected ? ' selected' : ''}" role="button" tabindex="-1" data-focusable
           data-zone="settings-panel" data-fid="font:${kind}:${f.id}" data-act="font" data-kind="${kind}" data-id="${f.id}"
           aria-label="${esc(f.name)}" style="--tile-font:${f.stack.replace(/"/g, "'")}">
        <span class="font-sample">Aa</span>
        <span class="font-name">${esc(f.name)}</span>
        <span class="font-text">Películas, música y más</span>
        ${selected ? `<span class="tick">${icon('check')}</span>` : ''}
      </div>`;
    const groups = (kind, selectedId) =>
      FONT_GROUPS.map((g) => {
        const list = FONTS.filter((f) => f.group === g.id);
        return `
          <h3 class="font-group">${esc(g.label)}</h3>
          <div class="font-grid">${list.map((f) => tile(f, kind, f.id === selectedId)).join('')}</div>`;
      }).join('');
    const sameTitle = titleCurrent === 'same';
    return `
      <h2 class="panel-title">Fuente del texto</h2>
      <p class="panel-note">Se aplica a todo WebBox OS. Las fuentes de letra de carta se descargan al elegirlas (necesitan Internet la primera vez); sin conexión se usa una parecida del sistema. Para leer cómodo desde el sofá, combina una letra de carta en los títulos con una fuente clara para el resto.</p>
      ${groups('text', current)}
      <h2 class="panel-title" style="margin-top:1.6rem">Fuente de los títulos</h2>
      <div class="font-grid">
        <div class="font-tile${sameTitle ? ' selected' : ''}" role="button" tabindex="-1" data-focusable
             data-zone="settings-panel" data-fid="font:title:same" data-act="font" data-kind="title" data-id="same">
          <span class="font-sample">=</span><span class="font-name">La misma del texto</span>
          <span class="font-text">Títulos como el resto</span>
          ${sameTitle ? `<span class="tick">${icon('check')}</span>` : ''}
        </div>
      </div>
      ${groups('title', titleCurrent)}
      ${this.#action('font-reset', 'font:reset', 'Restablecer fuentes', 'Vuelve a la fuente predeterminada', 'reset')}`;
  }

  // ---------------------------------------------------------------- Cuenta

  #accountHTML() {
    const user = api.user;
    const rows = [
      ['Servidor', api.online ? 'Conectado' : 'Sin conexión'],
      ['Sesión', user ? `${user.username} · ${roleLabel(user.role)}` : 'Sin iniciar'],
      ['Permisos', user ? (user.role === 'admin' ? 'Agrega y elimina contenido, gestiona usuarios' : 'Ve y reproduce el contenido') : '—'],
    ];
    if (!api.online) {
      return '<h2 class="panel-title">Cuenta</h2><p class="panel-note">No hay conexión con el servidor. Abre WebBox OS desde el servidor (npm start) para usar cuentas.</p>';
    }
    return `
      <h2 class="panel-title">Cuenta</h2>
      <dl class="info-list" style="margin-bottom:1.2rem">
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      </dl>
      ${user
        ? `${this.#action('account-password', 'account:password', 'Cambiar contraseña', 'Necesitas tu contraseña actual', 'plus')}
           ${this.#action('account-logout', 'account:logout', 'Cerrar sesión', 'Salir de esta cuenta en este navegador', 'back')}`
        : this.#action('account-login', 'account:login', 'Iniciar sesión', 'Entra con tu usuario y contraseña', 'plus')}`;
  }

  // -------------------------------------------------------------- Usuarios

  #usersHTML() {
    const create = this.#action('user-create', 'user:create', 'Crear usuario', 'Usuario normal o administrador', 'plus');
    if (this.users === null) return `<h2 class="panel-title">Usuarios</h2>${create}<p class="panel-note">Cargando…</p>`;
    const rows = this.users
      .map((u) => this.#action(
        'user-manage', `user:${u.id}`,
        `${u.username}${api.user?.id === u.id ? ' (tú)' : ''}`,
        `${roleLabel(u.role)} · pulsa para restablecer su contraseña o eliminarlo`,
        u.role === 'admin' ? 'star' : 'gamepad',
        `data-uid="${u.id}"`,
      )).join('');
    return `
      <h2 class="panel-title">Usuarios</h2>
      <p class="panel-note">El administrador agrega y elimina películas, música y videos, y gestiona cuentas. Los usuarios solo ven y reproducen.</p>
      ${this.usersError ? `<p class="panel-note">${esc(this.usersError)}</p>` : ''}
      ${create}${rows}`;
  }

  // ------------------------------------------------------------- Servidor

  #serverHTML() {
    const online = api.online;
    const counts = api.counts();
    const storeName = { mysql: 'MySQL', memory: 'Memoria (pruebas: se pierde al apagar)' }[api.store] ?? api.store ?? '—';
    const rows = [
      ['Servidor', online ? 'Conectado' : 'Sin conexión (modo local)'],
      ['Base de datos', online ? storeName : '—'],
      ['En el catálogo', online ? `${counts.youtube} videos · ${counts.music} canciones · ${counts.movies} películas · ${counts.series} capítulos de series` : '—'],
      ['Sesión', api.user ? `${api.user.username} · ${roleLabel(api.user.role)}` : (api.loginRequired ? 'Sin iniciar' : 'Acceso abierto')],
    ];
    return `
      <h2 class="panel-title">Servidor y base de datos</h2>
      <div class="status-card ${online ? 'on' : 'off'}">
        <span class="dot"></span>
        <div><h3>${online ? 'Conectado al catálogo compartido' : 'Sin conexión con el servidor'}</h3>
        <p>${online
          ? 'YouTube, Música y Películas muestran lo que hay en la base de datos. Todos ven lo mismo; solo el administrador agrega o elimina.'
          : 'Se usa solo el almacenamiento de este navegador. Abre WebBox OS desde el servidor (npm start) para usar la base de datos.'}</p></div>
      </div>
      <dl class="info-list" style="margin-bottom:1.2rem">
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      </dl>
      ${this.#action('server-retry', 'server:retry', 'Reintentar conexión', 'Vuelve a consultar el servidor', 'reset')}
      ${online && api.isAdmin ? this.#action('server-upload', 'server:upload', 'Subir lo guardado en este navegador', 'Envía al servidor lo que agregaste antes solo aquí (solo administrador)', 'plus') : ''}`;
  }

  async #serverRetry() {
    toast('Consultando el servidor…');
    await this.server?.onRetry?.();
    toast(api.online ? 'Conectado al servidor' : 'Sigue sin conexión con el servidor');
    this.rerender(true);
  }

  async #serverUpload() {
    if (!api.isAdmin) {
      toast('Solo el administrador puede subir contenido al servidor');
      return;
    }
    toast('Subiendo…');
    const r = await this.server?.onUpload?.();
    if (!r) return;
    const parts = [`Subidos: ${r.sent}`];
    if (r.existing) parts.push(`${r.existing} ya estaban`);
    if (r.skipped) parts.push(`${r.skipped} son archivos del equipo (no se suben)`);
    if (r.failed) parts.push(`${r.failed} con error`);
    if (r.stopped) parts.push('se detuvo: sin permiso de administrador');
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
      case 'font': {
        config.set(el.dataset.kind === 'title' ? 'titleFont' : 'font', el.dataset.id);
        this.rerender(true);
        break;
      }
      case 'font-reset':
        config.set('font', 'inter');
        config.set('titleFont', 'same');
        toast('Fuentes restablecidas');
        this.rerender(true);
        break;
      case 'account-login':
        this.accounts?.showLogin();
        break;
      case 'account-logout':
        this.accounts?.logout();
        break;
      case 'account-password':
        this.accounts?.changePassword();
        break;
      case 'user-create':
        this.accounts?.createUser();
        break;
      case 'user-manage': {
        const user = this.users?.find((u) => String(u.id) === el.dataset.uid);
        if (user) this.accounts?.manageUser(user);
        break;
      }
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
