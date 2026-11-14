/**
 * Gestor de archivos de WebBox OS para mando, teclado y mouse.
 * Trabaja con carpetas del equipo (File System Access API) o con almacenamiento
 * privado OPFS/IndexedDB en navegadores que no permiten elegir carpetas.
 */
import { supportsFileSystemAccess, requestRootDirectory, requestInternalDirectory, listEntries, createFolder, uploadFiles, getEntryFile, copyEntry, moveEntry, renameEntry, deleteEntry } from './fileSystem.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

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

export class FilesScreen {
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

  /** Abre una carpeta concreta (por ejemplo, la de música) como raíz del gestor. */
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
