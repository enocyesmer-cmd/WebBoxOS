/**
 * Juegos: biblioteca SNES integrada con el Gestor de archivos.
 * EmulatorJS ejecuta el núcleo Snes9x dentro de un iframe aislado del launcher.
 */
import { bus } from './core/events.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const EMULATOR_DATA = 'https://cdn.emulatorjs.org/stable/data/';
const GUIDE_BUTTON = 16;
const EXIT_HOLD_MS = 1500;

const ROM_EXTENSIONS = new Set(['sfc', 'smc', 'fig', 'gd3', 'gd7', 'dx2', 'bsx', 'swc']);

export function isSnesRomName(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return Boolean(match && ROM_EXTENSIONS.has(match[1]));
}

function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Tamaño desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export class GamesScreen {
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
