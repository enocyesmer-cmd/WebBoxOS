/**
 * Emuladores: selector de consolas (SNES, NES, N64, Game Boy, Game Boy Advance)
 * y biblioteca de ROMs integrada con el Gestor de archivos.
 * EmulatorJS ejecuta cada núcleo dentro de un iframe aislado del launcher.
 */
import { bus } from './core/events.js';
import { CONSOLES, getConsole, isRomName } from './data/consoles.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const EMULATOR_DATA = 'https://cdn.emulatorjs.org/stable/data/';
const GUIDE_BUTTON = 16;
const EXIT_HOLD_MS = 1500;

/** Compatibilidad con las pruebas existentes. */
export function isSnesRomName(name) {
  return isRomName(name, 'snes');
}

function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Tamaño desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatList(extensions) {
  return extensions.map((ext) => `.${ext}`).join(', ');
}

export class EmulatorsScreen {
  constructor({ root, focus, files, onOpenFiles }) {
    this.root = root;
    this.focus = focus;
    this.files = files;
    this.onOpenFiles = onOpenFiles;
    /** Consola abierta (null = catálogo de consolas). */
    this.console = null;
    /** Resultado de búsqueda por consola: { roms, hasScanned, location }. */
    this.library = new Map();
    this.scanning = false;
    this.isPlaying = false;
    this.currentRom = null;
    this.romUrl = null;
    this.iframe = null;
    this.exitHoldTimer = 0;

    this.root.addEventListener('click', (event) => this.#onClick(event));
    window.addEventListener('message', (event) => {
      if (event.source !== this.iframe?.contentWindow) return;
      if (event.data?.source === 'webbox-emulator' && event.data?.action === 'exit') this.stop();
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

  // ------------------------------------------------------------ render

  render() {
    if (this.console) this.#renderConsole();
    else this.#renderCatalog();
  }

  #renderCatalog() {
    this.root.innerHTML = `
      <h1 class="screen-title">Emuladores</h1>
      <p class="emu-sub">Elige una consola y juega con las ROMs que tengas guardadas en el Gestor de archivos.</p>
      <section class="emu-grid" aria-label="Consolas">
        ${CONSOLES.map((item) => `
          <div class="emu-card" role="button" tabindex="-1" data-focusable data-zone="main"
               data-fid="emu:console:${item.id}" data-act="emu-open" data-console="${item.id}"
               style="--c1:${item.c1};--c2:${item.c2}">
            <div class="emu-card-art">
              <span class="emu-card-short">${esc(item.short)}</span>
              ${icon('gamepad')}
            </div>
            <div class="emu-card-info">
              <strong>${esc(item.name)}</strong>
              <span>${esc(item.maker)}</span>
              <small>${esc(this.#summary(item.id))}</small>
            </div>
          </div>`).join('')}
      </section>
      <p class="emu-help">Los emuladores funcionan con EmulatorJS y necesitan conexión a Internet para descargar el núcleo de cada consola. WebBox OS no incluye juegos: usa copias que tengas derecho a usar.</p>`;
  }

  #summary(id) {
    const entry = this.library.get(id);
    if (!entry?.hasScanned) return 'Abrir biblioteca';
    const n = entry.roms.length;
    return `${n} juego${n === 1 ? '' : 's'}`;
  }

  #renderConsole() {
    const info = this.console;
    this.root.innerHTML = `
      <h1 class="screen-title">Emuladores · ${esc(info.name)}</h1>
      <div class="emu-topbar">
        <div class="btn btn--sm btn--secondary" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="emu:back" data-act="emu-back">${icon('back')}Todas las consolas</div>
      </div>
      <section class="games-console-card emu-console-card" style="--c1:${info.c1};--c2:${info.c2}">
        <div class="games-console-art emu-console-art"><span>${esc(info.short)}</span></div>
        <div class="games-console-info">
          <span class="games-kicker">${esc(info.maker.toUpperCase())}</span>
          <h2>${esc(info.name)}</h2>
          <p>EmulatorJS · Núcleo ${esc(info.engine)} · Compatible con mando, teclado y controles en pantalla.${info.note ? ` ${esc(info.note)}` : ''}</p>
          <div class="games-actions">
            <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="emu:scan" data-act="emu-scan">${icon('search')}Buscar ROMs en Archivos</div>
            <div class="btn btn--secondary" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="emu:files" data-act="emu-files">${icon('folder')}Abrir Gestor de archivos</div>
          </div>
        </div>
      </section>
      <section class="games-library" data-emu-library>
        <div class="games-library-head">
          <div>
            <h2>Biblioteca · ${esc(info.short)}</h2>
            <p data-emu-location>Busca ROMs dentro de la ubicación abierta en el Gestor de archivos.</p>
          </div>
          <span class="games-count" data-emu-count>0 juegos</span>
        </div>
        <div class="games-rom-list" data-emu-rom-list></div>
      </section>
      <section class="games-player" data-emu-player hidden>
        <div class="games-player-head">
          <div class="games-now-playing">
            <span class="games-kicker">REPRODUCIENDO · ${esc(info.short)}</span>
            <strong data-emu-current-name></strong>
          </div>
          <div class="games-player-actions">
            <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="emu:fullscreen" data-act="emu-fullscreen">${icon('fullscreen')}Pantalla completa</div>
            <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="emu:stop" data-act="emu-stop">${icon('close')}Salir del juego</div>
          </div>
        </div>
        <div class="games-frame-wrap" data-emu-frame></div>
        <p class="games-controls-hint">Mando: cruceta + botones · Teclado: flechas y teclas configuradas por EmulatorJS · Mantén GUIDE 1,5 s para salir.</p>
      </section>`;
    this.#renderRomList();
    const entry = this.library.get(info.id);
    if (entry?.location) this.#setLocation(entry.location);
  }

  #setLocation(text) {
    const el = this.root.querySelector('[data-emu-location]');
    if (el) el.textContent = text;
  }

  #renderRomList(message = '') {
    const list = this.root.querySelector('[data-emu-rom-list]');
    const count = this.root.querySelector('[data-emu-count]');
    if (!list || !this.console) return;
    const entry = this.library.get(this.console.id);
    const roms = entry?.roms ?? [];
    const scanned = Boolean(entry?.hasScanned);
    if (count) count.textContent = `${roms.length} juego${roms.length === 1 ? '' : 's'}`;

    if (this.scanning) {
      list.innerHTML = '<div class="games-empty"><span class="games-spinner"></span><h3>Buscando ROMs…</h3><p>Revisando las carpetas del Gestor de archivos.</p></div>';
      return;
    }
    if (!roms.length) {
      const text = message || (scanned
        ? `No encontramos ROMs de ${this.console.short}. Aceptamos archivos ${formatList(this.console.extensions)}.`
        : 'Busca ROMs dentro de la ubicación abierta en el Gestor de archivos.');
      list.innerHTML = `
        <div class="games-empty">
          <span>${icon('gamepad')}</span>
          <h3>${scanned ? 'No se encontraron juegos' : 'Aún no hay ROMs cargadas'}</h3>
          <p>${esc(text)}</p>
        </div>`;
      return;
    }
    list.innerHTML = roms.map((rom, index) => `
      <article class="games-rom-card">
        <div class="games-rom-icon">${icon('gamepad')}</div>
        <div class="games-rom-info">
          <strong>${esc(rom.name)}</strong>
          <span>${esc(rom.path)} · ${readableSize(rom.size)}</span>
        </div>
        <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="emu:rom:${index}" data-act="emu-play" data-index="${index}">
          ${icon('play')}Jugar
        </div>
      </article>`).join('');
  }

  // ------------------------------------------------------------ navegación

  focusEntry() {
    if (!this.console) {
      this.focus.focusFirst('#screen-emulators [data-zone="main"]');
      return;
    }
    this.focus.focusFirst('#screen-emulators [data-zone="main"]');
    if (!this.library.get(this.console.id)?.hasScanned && this.files.rootDirectory) this.scan();
  }

  /** Vuelve al catálogo al salir de la pantalla (p. ej. al ir a Inicio). */
  reset() {
    this.stop({ restore: false });
    if (this.console) {
      this.console = null;
      this.render();
    }
  }

  openConsole(id, { focus = true } = {}) {
    const info = getConsole(id);
    if (!info) return;
    this.stop({ restore: false });
    this.console = info;
    this.render();
    if (focus) this.focusEntry();
  }

  closeConsole() {
    const previous = this.console?.id;
    this.stop({ restore: false });
    this.console = null;
    this.render();
    this.focus.focusByFid(previous ? `emu:console:${previous}` : '')
      || this.focus.focusFirst('#screen-emulators [data-zone="main"]');
  }

  async handleBack() {
    if (this.isPlaying) {
      this.stop();
      return true;
    }
    if (this.console) {
      this.closeConsole();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ ROMs

  async scan() {
    if (this.scanning || !this.console) return;
    const info = this.console;
    this.scanning = true;
    this.#renderRomList();
    try {
      const result = await this.files.findRoms(info.extensions);
      const backendNames = { native: 'carpeta del equipo', opfs: 'almacenamiento OPFS', idb: 'almacenamiento IndexedDB' };
      const location = `${result.rootName} · ${backendNames[result.backend] || 'almacenamiento interno'}`;
      this.library.set(info.id, { roms: result.roms, hasScanned: true, location });
      if (result.truncated) toast('La búsqueda alcanzó el límite de seguridad. Se muestran los primeros resultados.', 4200);
      const n = result.roms.length;
      toast(`${n} ROM${n === 1 ? '' : 's'} de ${info.short} encontrada${n === 1 ? '' : 's'}.`);
      this.scanning = false;
      if (this.console === info) {
        this.#setLocation(location);
        this.#renderRomList();
      }
    } catch (error) {
      this.library.set(info.id, { roms: [], hasScanned: false, location: '' });
      this.scanning = false;
      if (this.console === info) this.#renderRomList(error?.message || 'No se pudieron buscar las ROMs.');
      toast(error?.message || 'No se pudieron buscar las ROMs.', 4200);
    } finally {
      this.scanning = false;
      if (this.console === info) this.focus.focusByFid('emu:scan');
    }
  }

  async #onClick(event) {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    switch (action.dataset.act) {
      case 'emu-open':
        this.openConsole(action.dataset.console);
        break;
      case 'emu-back':
        this.closeConsole();
        break;
      case 'emu-scan':
        await this.scan();
        break;
      case 'emu-files':
        this.onOpenFiles?.();
        break;
      case 'emu-play':
        await this.play(Number(action.dataset.index));
        break;
      case 'emu-stop':
        this.stop();
        break;
      case 'emu-fullscreen':
        this.#fullscreen();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ emulador

  async play(index) {
    const info = this.console;
    const rom = this.library.get(info?.id)?.roms[index];
    if (!info || !rom || this.isPlaying) return;
    this.stop({ restore: false });
    this.currentRom = rom;
    this.romUrl = URL.createObjectURL(rom.file);
    this.isPlaying = true;
    const library = this.root.querySelector('[data-emu-library]');
    const player = this.root.querySelector('[data-emu-player]');
    const frameHost = this.root.querySelector('[data-emu-frame]');
    const title = this.root.querySelector('[data-emu-current-name]');
    if (library) library.hidden = true;
    if (player) player.hidden = false;
    if (title) title.textContent = rom.name;

    const iframe = document.createElement('iframe');
    iframe.className = 'games-emulator-frame';
    iframe.title = `Emulador ${info.short}: ${rom.name}`;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-forms');
    iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('tabindex', '0');
    iframe.srcdoc = this.#emulatorDocument(info, rom, this.romUrl);
    this.iframe = iframe;
    frameHost?.replaceChildren(iframe);
    iframe.addEventListener('load', () => iframe.focus(), { once: true });
    iframe.focus();
    toast(`Iniciando ${rom.name}…`);
  }

  #emulatorDocument(info, rom, romUrl) {
    const scriptOpen = '<scr' + 'ipt>';
    const scriptClose = '</scr' + 'ipt>';
    const gameName = rom.name.replace(/\.[^.]+$/, '');
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Emulador ${info.short} · WebBox OS</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font:14px system-ui,sans-serif}
  #game{width:100%;height:100%;min-height:260px}#load-error{display:none;position:absolute;inset:0;z-index:50;padding:28px;background:#111827;color:#fecaca;line-height:1.6}
</style>
</head>
<body>
  <div id="game"></div>
  <div id="load-error">No se pudo descargar el emulador de ${info.short}. Comprueba tu conexión a Internet y vuelve a cargar el juego.</div>
  ${scriptOpen}
    window.EJS_player = '#game';
    window.EJS_core = ${JSON.stringify(info.core)};
    window.EJS_gameName = ${JSON.stringify(gameName)};
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
        window.parent.postMessage({ source: 'webbox-emulator', action: 'exit' }, '*');
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
    const library = this.root.querySelector('[data-emu-library]');
    const player = this.root.querySelector('[data-emu-player]');
    const frameHost = this.root.querySelector('[data-emu-frame]');
    if (frameHost) frameHost.replaceChildren();
    if (library) library.hidden = false;
    if (player) player.hidden = true;
    if (restore) this.focus.focusByFid('emu:scan');
  }
}
