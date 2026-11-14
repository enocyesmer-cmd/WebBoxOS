/**
 * Biblioteca de contenido (YouTube y Películas comparten este módulo).
 * Muestra filas por categoría, un botón "+ Agregar" y abre el reproductor.
 * Lo agregado desde la interfaz se guarda en localStorage; lo de
 * js/data/library.js se mezcla con ello (y se puede ocultar con "Eliminar").
 */
import { storage } from './core/storage.js';
import { parseMediaUrl, youtubeThumb } from './core/media.js';
import { icon } from './icons.js';
import { esc } from './ui.js';

const PALETTE = [
  ['#7c2d12', '#f59e0b'], ['#1e3a8a', '#7c3aed'], ['#065f46', '#34d399'],
  ['#831843', '#fb7185'], ['#0c4a6e', '#38bdf8'], ['#312e81', '#ec4899'],
  ['#7f1d1d', '#f97316'], ['#134e4a', '#2dd4bf'],
];

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export class LibraryScreen {
  /**
   * @param {{id:string, root:HTMLElement, defaults:object[], title:string, subtitle:string,
   *   defaultCategory:string, cardStyle:'wide'|'poster', accept:string[], emptyText:string,
   *   cardIcon:string, extraButtons?:{act:string,label:string,icon:string}[],
   *   onPlay:(item:object, lib:LibraryScreen)=>void, onAdd:(lib:LibraryScreen)=>void,
   *   onExtra?:(act:string)=>void}} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.userItems = this.#loadUser();
    this.hidden = new Set(storage.get(`lib:${this.id}:hidden`, []));

    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'lib-add') return this.onAdd(this);
      if (act?.dataset.act === 'lib-ext') return this.onExtra?.(act.dataset.extra);
      const card = e.target.closest('[data-kind="lib"]');
      const item = card && this.items().find((i) => i.id === card.dataset.id);
      if (item) this.onPlay(item, this);
      return undefined;
    });
    // 'error' no burbujea: en captura quitamos las imágenes rotas y queda el degradado.
    this.root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.remove();
    }, true);
  }

  // ------------------------------------------------------------------ datos

  #loadUser() {
    const saved = storage.get(`lib:${this.id}:items`, []);
    return Array.isArray(saved) ? saved.filter((i) => i && i.id && i.title && (i.url || i.fileHandleKey)) : [];
  }

  #save() {
    storage.set(`lib:${this.id}:items`, this.userItems);
    storage.set(`lib:${this.id}:hidden`, [...this.hidden]);
  }

  /** Predeterminados (no ocultos) + agregados por el usuario. */
  items() {
    const defaults = this.defaults
      .map((d, i) => ({ ...d, id: d.id ?? `def:${i}`, builtin: true }))
      .filter((d) => d.title && d.url && !this.hidden.has(d.id));
    return [...defaults, ...this.userItems].map((i) => ({
      ...i,
      category: (i.category || this.defaultCategory).trim() || this.defaultCategory,
    }));
  }

  /** Devuelve el elemento creado, o un string con el error. */
  add({ title, url, category, image }) {
    const media = parseMediaUrl(url);
    if (!media) return 'Enlace no válido. Usa un enlace de YouTube o un archivo .mp4 / .webm.';
    if (!this.accept.includes(media.type)) {
      return this.accept.includes('video')
        ? 'Este enlace no es de video.'
        : 'Aquí solo se aceptan enlaces de YouTube.';
    }
    const item = {
      id: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      title: String(title).trim().slice(0, 120),
      url: String(url).trim(),
      category: String(category || '').trim().slice(0, 40),
      image: String(image || '').trim(),
    };
    this.userItems.push(item);
    this.#save();
    this.render();
    return item;
  }

  /** Agrega un archivo local a Películas sin copiarlo ni modificarlo. */
  addFileHandle({ title, fileHandleKey, category = this.defaultCategory }) {
    if (this.id !== 'movies') return 'Los archivos locales solo se pueden agregar a Películas.';
    if (!title || !fileHandleKey) return 'No se pudo identificar el archivo local.';
    const item = {
      id: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      title: String(title).replace(/\.[^.]+$/, '').trim().slice(0, 120),
      url: `webbox-file://${encodeURIComponent(fileHandleKey)}`,
      fileHandleKey,
      category: String(category || '').trim().slice(0, 40),
      image: '',
    };
    this.userItems.push(item);
    this.#save();
    this.render();
    return item;
  }

  remove(id) {
    const before = this.userItems.length;
    this.userItems = this.userItems.filter((i) => i.id !== id);
    if (this.userItems.length === before) this.hidden.add(id); // era predeterminado
    this.#save();
    this.render();
  }

  fid(id) {
    return `lib:${this.id}:${id}`;
  }

  categories() {
    return [...new Set(this.items().map((i) => i.category))];
  }

  // ----------------------------------------------------------------- vista

  render() {
    const items = this.items();
    const buttons = [
      { act: 'lib-add', label: 'Agregar', icon: 'plus' },
      ...(this.extraButtons ?? []).map((b) => ({ ...b, act: 'lib-ext' })),
    ];
    const actions = buttons
      .map(
        (b, i) => `
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="lib:${this.id}:btn${i}" data-act="${b.act}" data-extra="${esc(b.extra ?? '')}">
          ${icon(b.icon)}${esc(b.label)}
        </div>`,
      )
      .join('');

    const rows = this.categories()
      .map((cat) => {
        const cards = items.filter((i) => i.category === cat).map((i) => this.#card(i)).join('');
        return `
          <section class="row" data-row="${esc(cat)}">
            <h2 class="row-title"><span class="row-icon">${icon(this.cardIcon)}</span>${esc(cat)}</h2>
            <div class="row-track">${cards}</div>
          </section>`;
      })
      .join('');

    this.root.innerHTML = `
      <h1 class="screen-title">${esc(this.title)}</h1>
      <p class="lib-sub">${esc(this.subtitle)}</p>
      <div class="lib-actions">${actions}</div>
      ${items.length ? rows : `<div class="lib-empty">${this.emptyText}</div>`}
    `;
  }

  #card(item) {
    const media = parseMediaUrl(item.url);
    const img = item.image || youtubeThumb(media);
    const [c1, c2] = PALETTE[hash(item.title) % PALETTE.length];
    const kind = item.fileHandleKey ? 'Archivo local' : (media?.type === 'youtube' ? (media.videoId ? 'YouTube' : 'Lista de YouTube') : 'Archivo de video');
    const poster = this.cardStyle === 'poster';
    return `
      <div class="card ${poster ? 'card--poster' : 'card--wide'}${img ? ' card--media' : ''}"
           role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="lib" data-id="${esc(item.id)}" data-fid="${esc(this.fid(item.id))}"
           style="--c1:${c1};--c2:${c2}" aria-label="${esc(item.title)}">
        ${img ? `<img class="card-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="card-art">${icon(this.cardIcon)}</span>
        <span class="card-label">${esc(item.title)}</span>
        <span class="card-sub">${esc(kind)}</span>
      </div>`;
  }
}
