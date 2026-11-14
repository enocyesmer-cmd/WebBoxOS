/**
 * Pantalla Archivos: explorador local de solo lectura para mando, teclado y mouse.
 * Usa File System Access API en Chromium (Chrome / Edge) y conserva la carpeta
 * seleccionada en IndexedDB mediante los helpers de js/fileSystem.js.
 */
import { requestRootDirectory, listEntries } from './fileSystem.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus', 'wma']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg']);

function extension(name) {
  return String(name).split('.').pop().toLowerCase();
}

function fileType(name) {
  const ext = extension(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (['pdf'].includes(ext)) return 'pdf';
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

export class FilesScreen {
  /**
   * @param {{root:HTMLElement, focus:object, onOpenMedia:(file:File)=>void,
   *   onAddMovie:(handle:FileSystemFileHandle,name:string)=>Promise<void>}} opts
   */
  constructor({ root, focus, onOpenMedia, onAddMovie }) {
    this.root = root;
    this.focus = focus;
    this.onOpenMedia = onOpenMedia;
    this.onAddMovie = onAddMovie;
    this.stack = [];
    this.entries = [];
    this.view = 'grid';
    this.loading = false;
    this.viewerOpen = false;
    this.viewerUrl = null;
    this.viewerReturnFid = null;
    this.viewer = document.getElementById('file-viewer');

    this.root.addEventListener('click', (e) => this.#onClick(e));
    this.viewer?.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="file-viewer-close"]')) this.closeViewer();
    });
  }

  render() {
    this.root.innerHTML = `
      <h1 class="screen-title">Archivos</h1>
      <p class="files-sub">Explora carpetas y reproduce tus archivos multimedia con el mando.</p>
      <div class="files-toolbar">
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:pick" data-act="files-pick">${icon('folder')}Elegir carpeta</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:up" data-act="files-up" aria-disabled="true">${icon('back')}Atrás</div>
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:list" data-act="files-list">${icon('book')}Lista</div>
        <div class="btn is-selected" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="files:grid" data-act="files-grid">${icon('apps')}Cuadrícula</div>
      </div>
      <div class="files-location">
        <span class="files-location-label">Ubicación</span>
        <strong data-files-path>Sin carpeta seleccionada</strong>
        <span class="files-count" data-files-count></span>
      </div>
      <div class="files-content" data-files-content>
        <div class="files-empty">
          <span class="files-empty-icon">${icon('folder')}</span>
          <h2>Selecciona una carpeta</h2>
          <p>Elige una carpeta del equipo para ver sus archivos y subcarpetas.</p>
          <p class="files-api-note">La lectura local está disponible en Chrome y Edge. No se modifica ningún archivo.</p>
        </div>
      </div>`;
    this.#updateToolbar();
    this.#updatePath();
  }

  focusEntry() {
    this.focus.focusFirst('[data-zone="main"]');
  }

  async handleBack() {
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
      const handle = await requestRootDirectory();
      this.stack = [{ handle, name: handle.name || 'Carpeta' }];
      await this.#readCurrent();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      const message = err?.message || 'No se pudo abrir la carpeta.';
      this.#setMessage(message, true);
      toast(message, 4500);
    }
  }

  async goUp() {
    if (this.stack.length <= 1 || this.loading) return;
    this.stack.pop();
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
      this.entries = await listEntries(current.handle);
      this.entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true });
      });
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
      content.innerHTML = '<div class="files-empty"><h2>Esta carpeta está vacía</h2><p>No se encontraron archivos ni subcarpetas.</p></div>';
      return;
    }

    const cards = this.entries.map((entry, index) => {
      const kind = entry.kind === 'directory' ? 'directory' : fileType(entry.name);
      const isVideo = kind === 'video';
      const fid = `files:item:${index}`;
      const meta = entry.kind === 'directory' ? 'Carpeta' : this.#metaLabel(kind, entry.name);
      return `
        <article class="file-card${isVideo ? ' file-card--video' : ''}">
          <div class="file-entry" role="button" tabindex="-1" data-focusable data-zone="main"
               data-fid="${fid}" data-act="file-open" data-index="${index}"
               aria-label="${esc(entry.name)}">
            <span class="file-entry-icon file-entry-icon--${kind}">${icon(typeIcon(kind))}</span>
            <span class="file-entry-name">${esc(entry.name)}</span>
            <span class="file-entry-meta">${esc(meta)}</span>
          </div>
          ${isVideo ? `<div class="file-card-actions">
            <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="main"
                 data-fid="files:add:${index}" data-act="file-add-movie" data-index="${index}">
              ${icon('plus')}Agregar a Películas
            </div>
          </div>` : ''}
        </article>`;
    }).join('');

    content.innerHTML = `<div class="files-${this.view}">${cards}</div>`;
  }

  #metaLabel(kind, name) {
    const labels = { video: 'Video', audio: 'Audio', image: 'Imagen', pdf: 'PDF', document: 'Documento', archive: 'Archivo comprimido', file: 'Archivo' };
    return `${labels[kind] || 'Archivo'} · ${extension(name).toUpperCase()}`;
  }

  #updateToolbar() {
    const up = this.root.querySelector('[data-act="files-up"]');
    if (up) up.setAttribute('aria-disabled', String(this.stack.length <= 1 || this.loading));
    const list = this.root.querySelector('[data-act="files-list"]');
    const grid = this.root.querySelector('[data-act="files-grid"]');
    list?.classList.toggle('is-selected', this.view === 'list');
    grid?.classList.toggle('is-selected', this.view === 'grid');
  }

  #updatePath() {
    const path = this.root.querySelector('[data-files-path]');
    if (path) path.textContent = this.stack.length
      ? this.stack.map((part) => part.name).join('  /  ')
      : 'Sin carpeta seleccionada';
  }

  #setMessage(message, isError = false) {
    const content = this.root.querySelector('[data-files-content]');
    if (content) {
      content.innerHTML = `<div class="files-empty${isError ? ' files-empty--error' : ''}"><h2>${isError ? 'No se pudo abrir' : 'Archivos'}</h2><p>${esc(message)}</p></div>`;
    }
  }

  async #onClick(e) {
    const action = e.target.closest('[data-act]');
    if (!action) return;
    switch (action.dataset.act) {
      case 'files-pick':
        await this.chooseFolder();
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

  async #openEntry(index) {
    const entry = this.entries[index];
    if (!entry || this.loading) return;
    if (entry.kind === 'directory') {
      this.stack.push({ handle: entry.handle, name: entry.name });
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
      const file = await entry.handle.getFile();
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
      await this.onAddMovie?.(entry.handle, entry.name);
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
