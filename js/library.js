/**
 * Biblioteca de contenido (YouTube y Películas comparten este módulo).
 * Muestra filas por categoría, un botón "+ Agregar" y abre el reproductor.
 * Lo agregado desde la interfaz se guarda en localStorage; lo de
 * js/data/library.js se mezcla con ello (y se puede ocultar con "Eliminar").
 */
import { storage } from './core/storage.js';
import { parseMediaUrl, youtubeThumb } from './core/media.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { esc, toast } from './ui.js';

const PALETTE = [
  ['#7c2d12', '#f59e0b'], ['#1e3a8a', '#7c3aed'], ['#065f46', '#34d399'],
  ['#831843', '#fb7185'], ['#0c4a6e', '#38bdf8'], ['#312e81', '#ec4899'],
  ['#7f1d1d', '#f97316'], ['#134e4a', '#2dd4bf'],
];

/** Mensaje cuando el servidor no aceptó lo agregado (queda guardado en el navegador). */
function serverProblem(status) {
  if (status === 401) {
    return 'Guardado solo en este navegador. Para la base de datos compartida hace falta la clave (Configuración > Servidor).';
  }
  if (status === 429) return 'Demasiados intentos con clave incorrecta. Guardado solo en este navegador.';
  if (status === 503) return 'El servidor no tiene clave de administrador. Guardado solo en este navegador.';
  if (status === 422) return 'El servidor no aceptó este elemento. Guardado solo en este navegador.';
  return 'Sin conexión con el servidor. Guardado solo en este navegador.';
}

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
    this.remoteItems = []; // catálogo compartido (base de datos)

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

    this.sync(); // trae el catálogo de la base de datos (si hay servidor)
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

  /** Predeterminados (no ocultos) + catálogo compartido + agregados en este navegador. */
  items() {
    const defaults = this.defaults
      .map((d, i) => ({ ...d, id: d.id ?? `def:${i}`, builtin: true }))
      .filter((d) => d.title && d.url && !this.hidden.has(d.id));
    // Si una copia local ya está enlazada con su fila del servidor, se muestra solo la local.
    const linked = new Set(this.userItems.filter((i) => i.serverId).map((i) => i.serverId));
    const remote = this.remoteItems.filter((r) => !linked.has(r.serverId));
    return [...defaults, ...remote, ...this.userItems].map((i) => ({
      ...i,
      category: (i.category || this.defaultCategory).trim() || this.defaultCategory,
    }));
  }

  /** Devuelve el elemento creado, o un string con el error. */
  add({ title, url, category, image, artist }) {
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
      artist: String(artist || '').trim().slice(0, 80),
    };
    this.userItems.push(item);
    this.#save();
    this.render();
    this.#pushToServer(item); // en segundo plano; si falla, queda en este navegador
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
    const item = this.items().find((i) => i.id === id);
    const serverId = item?.serverId;

    // Un elemento de la base de datos solo lo puede borrar quien tenga la clave.
    if (serverId) {
      if (!api.online) {
        toast('Sin conexión con el servidor: no se puede eliminar de la base de datos.');
        return;
      }
      if (!api.hasKey()) {
        toast('Para eliminar de la base de datos compartida hace falta la clave (Configuración > Servidor).');
        return;
      }
    }

    const before = this.userItems.length;
    const wasRemote = this.remoteItems.some((r) => r.id === id);
    this.userItems = this.userItems.filter((i) => i.id !== id);
    this.remoteItems = this.remoteItems.filter((r) => r.id !== id && (!serverId || r.serverId !== serverId));
    if (this.userItems.length === before && !wasRemote && !serverId) this.hidden.add(id); // era predeterminado
    this.#save();
    this.render();
    if (serverId) this.#deleteOnServer(item);
  }

  // ------------------------------------------- base de datos (servidor)

  /**
   * Descarga el catálogo compartido del servidor. Sin servidor se queda con lo
   * local, como antes.
   */
  async sync({ render = true } = {}) {
    const all = await api.loadAll();
    const had = this.remoteItems.length;
    this.remoteItems = all
      ? all
          .filter((i) => i.kind === this.id)
          .map((i) => ({ ...i, id: `db:${i.id}`, serverId: i.id, remote: true }))
      : [];

    // Lo agregado antes desde este navegador que ya existe en el servidor se
    // enlaza con su copia, para que no aparezca dos veces.
    let linked = false;
    for (const mine of this.userItems) {
      if (mine.serverId) continue;
      const twin = this.remoteItems.find((r) => r.url === mine.url);
      if (twin) {
        mine.serverId = twin.serverId;
        linked = true;
      }
    }
    if (linked) this.#save();
    if (render && (all || had)) this.render();
  }

  /** Envía a la base de datos, en segundo plano, lo que se acaba de agregar. */
  async #pushToServer(item) {
    if (!api.online) return;
    const result = await api.create({
      kind: this.id,
      title: item.title,
      url: item.url,
      category: item.category,
      image: item.image,
      artist: item.artist,
    });
    if (result.ok) {
      item.serverId = result.item.id;
      this.#save();
      toast('Guardado también en la base de datos');
    } else if (result.status === 409) {
      await api.loadAll(true); // ya existía: se enlaza con la copia del servidor
      await this.sync({ render: false });
    } else {
      toast(serverProblem(result.status));
    }
  }

  async #deleteOnServer(item) {
    const result = await api.remove(item.serverId);
    if (result.ok || result.status === 404) return;
    // No se pudo borrar en el servidor: se restaura para no mentirle al usuario.
    if (item.remote) this.remoteItems.push(item);
    else this.userItems.push(item);
    this.#save();
    this.render();
    toast(
      result.status === 401
        ? 'Clave de administrador incorrecta: no se eliminó de la base de datos.'
        : 'No se pudo eliminar de la base de datos. Se restauró el elemento.',
    );
  }

  /**
   * Sube al servidor lo que solo existía en este navegador.
   * Los archivos locales (webbox-file://) no se suben: son del equipo del usuario.
   */
  async uploadLocal() {
    const result = { sent: 0, existing: 0, skipped: 0, failed: 0, stopped: null };
    for (const item of this.userItems) {
      if (item.serverId) continue;
      if (item.fileHandleKey || !item.url) {
        result.skipped += 1;
        continue;
      }
      const r = await api.create({
        kind: this.id,
        title: item.title,
        url: item.url,
        category: item.category,
        image: item.image,
        artist: item.artist,
      });
      if (r.ok) {
        item.serverId = r.item.id;
        result.sent += 1;
      } else if (r.status === 409) {
        result.existing += 1;
      } else if (r.status === 401 || r.status === 429 || r.status === 503) {
        result.stopped = r.status;
        break;
      } else {
        result.failed += 1;
      }
    }
    this.#save();
    return result;
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
    this.onChange?.();
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
