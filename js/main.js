/**
 * WebBox OS — punto de entrada.
 * Une entradas (teclado, mando, mouse), foco, router de pantallas y ajustes.
 *
 * Flujo: teclado/mando -> bus 'action' -> onAction() -> FocusManager / router.
 */
import { bus } from './core/events.js';
import { config } from './core/config.js';
import { FocusManager } from './core/focus.js';
import { GamepadManager } from './input/gamepad.js';
import { KeyboardInput } from './input/keyboard.js';
import { Launcher } from './launcher.js';
import { SettingsScreen } from './settings.js';
import { LibraryScreen } from './library.js';
import { Player } from './player.js';
import { Dialog } from './dialog.js';
import { FilesScreen } from './files.js';
import { getHandle, saveHandle, removeHandle } from './fileSystem.js';
import { YOUTUBE_DEFAULTS, MOVIES_DEFAULTS } from './data/library.js';
import { parseMediaUrl } from './core/media.js';
import { BACKGROUNDS } from './data/apps.js';
import { hydrateIcons, icon } from './icons.js';
import { esc, toast } from './ui.js';

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
      files: $('#screen-files'),
      settings: $('#screen-settings'),
    };
    this.current = 'home';
    this.overlayOpen = false;
    this.overlayReturnFid = null;
    this.lastPointerMove = 0;
    this.cursorTimer = 0;

    this.focus = new FocusManager(this.shell);
    this.gamepad = new GamepadManager();
    this.keyboard = new KeyboardInput();
    this.launcher = new Launcher({
      homeEl: this.screens.home,
      appsEl: this.screens.apps,
      onOpen: (item) => this.openItem(item),
    });
    this.player = new Player({ el: $('#player'), focus: this.focus });
    this.dialog = new Dialog({ el: $('#dialog'), focus: this.focus });
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
      onOpenMedia: (file) => this.player.openFile(file),
      onAddMovie: (handle, name) => this.#addMovieFromFiles(handle, name),
    });
    this.settings = new SettingsScreen({
      root: this.screens.settings,
      focus: this.focus,
      gamepad: this.gamepad,
    });
  }

  start() {
    hydrateIcons();
    this.launcher.render();
    for (const lib of Object.values(this.libraries)) lib.render();
    this.files.render();
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
    if (!this.screens[name]) return;

    if (name !== this.current) {
      for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
      const el = this.screens[name];
      el.classList.remove('is-entering');
      void el.offsetWidth; // reinicia la animación
      el.classList.add('is-entering');
      this.current = name;
      if (name === 'settings') this.settings.refresh();
      for (const item of this.sidebar.querySelectorAll('[data-screen]')) {
        item.classList.toggle('is-current', item.dataset.screen === name);
      }
    }
    if (enter) this.#enterScreen(name);
  }

  #enterScreen(name) {
    if (name === 'settings') {
      this.settings.focusEntry();
    } else if (name === 'files') {
      this.files.focusEntry();
    } else {
      this.focus.focusFirst('[data-zone="main"]');
    }
  }

  async back() {
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
    if (this.dialog.isOpen) this.dialog.close({ restore: false });
    if (this.player.isOpen) this.player.close({ restore: false });
    if (this.files?.viewerOpen) this.files.closeViewer({ restore: false });
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

  // ------------------------------------------------------- bibliotecas

  #openAddDialog(lib) {
    const isMovies = lib.id === 'movies';
    this.dialog.open({
      title: isMovies ? 'Agregar película' : 'Agregar a YouTube',
      hint: isMovies
        ? 'Enlace de YouTube o ruta de un archivo (assets/movies/mi-pelicula.mp4). Pulsa OK en un campo para escribir.'
        : 'Pega un enlace de video o lista de YouTube. Si dejas el título vacío se intenta obtener solo.',
      fields: [
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
    let title = values.title;
    if (!title && media.type === 'youtube' && media.videoId) title = await fetchYouTubeTitle(values.url);
    if (!title) return 'Escribe un título para este elemento.';

    const result = lib.add({ ...values, title });
    if (typeof result === 'string') return result;
    toast(`Agregado: ${result.title}`);
    // El foco vuelve a la tarjeta nueva cuando el formulario se cierre.
    this.dialog.returnFid = lib.fid(result.id);
    return null;
  }

  async #playLibraryItem(item, lib) {
    const onDelete = (it) => this.#deleteItem(lib, it);
    if (!item.fileHandleKey) {
      this.player.open(item, { onDelete });
      return;
    }
    try {
      const handle = await getHandle(item.fileHandleKey);
      if (!handle) throw new Error('No se encontró el archivo guardado. Vuelve a agregarlo desde Archivos.');
      let permission = await handle.queryPermission?.({ mode: 'read' });
      if (permission !== 'granted' && handle.requestPermission) {
        permission = await handle.requestPermission({ mode: 'read' });
      }
      if (permission && permission !== 'granted') {
        throw new Error('El navegador no concedió permiso de lectura. Vuelve a elegir la carpeta en Archivos.');
      }
      const file = await handle.getFile();
      this.player.openFile(file, { onDelete, title: item.title });
    } catch (err) {
      toast(err?.message || 'No se pudo abrir el archivo local.', 4500);
    }
  }

  async #addMovieFromFiles(handle, name) {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const key = `movie:${token}`;
    await saveHandle(key, handle);
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

    const bg = BACKGROUNDS.find((b) => b.id === config.get('background')) ?? BACKGROUNDS[0];
    $('#bg').style.backgroundImage = `url("${bg.file}")`;

    this.#tickClock();
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

/** Título de un video de YouTube (oEmbed). Devuelve '' si no hay conexión o falla. */
async function fetchYouTubeTitle(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const data = await res.json();
    return typeof data.title === 'string' ? data.title : '';
  } catch {
    return '';
  }
}

window.webbox = new WebBoxOS();
window.webbox.start();
