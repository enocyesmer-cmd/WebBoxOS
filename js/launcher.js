/**
 * Launcher: pantalla de inicio (filas de tarjetas) y pantalla de aplicaciones.
 * No maneja entradas directamente: las tarjetas son elementos `data-focusable`
 * y el administrador de foco hace `click()` al pulsar OK.
 *
 * Doble pulsación (dos clics, o OK dos veces seguidas) sobre una tarjeta abre el
 * menú de edición (cambiar icono, eliminar). Una sola pulsación abre la aplicación
 * tras una pequeña espera para poder distinguirla de la doble.
 */
import { APPS, FAVORITES, RECOMMENDED, DEFAULT_RECENTS, MEDIA_LOCATIONS } from './data/apps.js';
import { logo } from './data/logos.js';
import { icon } from './icons.js';
import { storage } from './core/storage.js';
import { esc } from './ui.js';

const APP_BY_ID = new Map(APPS.map((a) => [a.id, a]));
const REC_BY_ID = new Map(RECOMMENDED.map((r) => [r.id, r]));
const MAX_RECENTS = 8;
export const DOUBLE_PRESS_MS = 350;

export class Launcher {
  /**
   * @param {{homeEl:HTMLElement, appsEl:HTMLElement, onOpen:(item:object)=>void,
   *   onMenu:(item:object)=>void, onChooseLocation:(key:string)=>void,
   *   getLocations:()=>Record<string,{name:string}>}} opts
   */
  constructor({ homeEl, appsEl, onOpen, onMenu, onChooseLocation, getLocations }) {
    this.homeEl = homeEl;
    this.appsEl = appsEl;
    this.onOpen = onOpen;
    this.onMenu = onMenu;
    this.onChooseLocation = onChooseLocation;
    this.getLocations = getLocations ?? (() => ({}));
    this.recents = this.#loadRecents();
    this.hidden = new Set(storage.get('hiddenCards', []));
    this.icons = this.#loadIcons();
    this.pending = null;

    const handler = (e) => {
      const loc = e.target.closest('[data-act="loc-choose"]');
      if (loc) {
        this.onChooseLocation?.(loc.dataset.loc);
        return;
      }
      if (e.target.closest('[data-act="restore-hidden"]')) {
        this.restoreAll();
        return;
      }
      const card = e.target.closest('[data-kind]');
      if (!card) return;
      const item =
        card.dataset.kind === 'app'
          ? APP_BY_ID.get(card.dataset.id)
          : REC_BY_ID.get(card.dataset.id);
      if (!item) return;
      this.#press(card.dataset.kind, item);
    };
    homeEl.addEventListener('click', handler);
    appsEl.addEventListener('click', handler);
  }

  /** Una pulsación espera; una segunda dentro del plazo abre el menú en lugar de la aplicación. */
  #press(kind, item) {
    const key = `${kind}:${item.id}`;
    const payload = { ...item, kind };
    if (this.pending?.key === key) {
      clearTimeout(this.pending.timer);
      this.pending = null;
      this.onMenu?.(payload);
      return;
    }
    clearTimeout(this.pending?.timer);
    const timer = setTimeout(() => {
      this.pending = null;
      this.onOpen(payload);
    }, DOUBLE_PRESS_MS);
    this.pending = { key, timer };
  }

  render() {
    const favorites = FAVORITES.filter((id) => !this.hidden.has(id));
    const recs = RECOMMENDED.filter((r) => !this.hidden.has(r.id));
    const apps = APPS.filter((a) => !this.hidden.has(a.id));

    this.homeEl.innerHTML = `
      ${this.#row('favorites', 'Aplicaciones favoritas', 'star', favorites.map((id) => this.#appCard(APP_BY_ID.get(id), 'fav')).join('') || this.#emptyRow())}
      ${this.#row('recents', 'Recientes', 'clock', this.#recentsHTML())}
      ${this.#row('recommended', 'Recomendado para ti', 'film', recs.map((r) => this.#recCard(r)).join('') || this.#emptyRow())}
    `;

    this.appsEl.innerHTML = `
      <h1 class="screen-title">Aplicaciones</h1>
      ${this.#locationsHTML()}
      <p class="apps-tip">Pulsa dos veces una aplicación para cambiar su icono o eliminarla.</p>
      <div class="grid">${apps.map((a) => this.#appCard(a, 'all')).join('')}</div>
      ${this.#restoreHTML()}
    `;
  }

  /** Registra una aplicación abierta y refresca la fila de recientes. */
  recordRecent(appId) {
    if (!APP_BY_ID.has(appId)) return;
    this.recents = [appId, ...this.recents.filter((id) => id !== appId)].slice(0, MAX_RECENTS);
    storage.set('recents', this.recents);
    const track = this.homeEl.querySelector('[data-track="recents"]');
    if (track) track.innerHTML = this.#recentsHTML();
  }

  // ------------------------------------------------- edición de tarjetas

  hasCustomIcon(id) {
    return Boolean(this.icons[id]);
  }

  setIcon(id, dataUrl) {
    this.icons[id] = dataUrl;
    storage.set('cardIcons', this.icons);
    this.render();
  }

  resetIcon(id) {
    delete this.icons[id];
    storage.set('cardIcons', this.icons);
    this.render();
  }

  hide(id) {
    this.hidden.add(id);
    storage.set('hiddenCards', [...this.hidden]);
    this.render();
  }

  restoreAll() {
    if (!this.hidden.size) return;
    this.hidden.clear();
    storage.set('hiddenCards', []);
    this.render();
    this.onRestored?.();
  }

  hiddenCount() {
    return this.hidden.size;
  }

  // ---------------------------------------------------------------- interno

  #loadIcons() {
    const saved = storage.get('cardIcons', {});
    const out = {};
    if (saved && typeof saved === 'object') {
      for (const [id, url] of Object.entries(saved)) {
        if (typeof url === 'string' && url.startsWith('data:image/')) out[id] = url;
      }
    }
    return out;
  }

  #loadRecents() {
    const saved = storage.get('recents', null);
    const list = Array.isArray(saved)
      ? saved.filter((id) => APP_BY_ID.has(id))
      : DEFAULT_RECENTS.slice();
    return list.slice(0, MAX_RECENTS);
  }

  #recentsHTML() {
    const list = this.recents.filter((id) => !this.hidden.has(id));
    if (!list.length) return '<p class="row-empty">Aún no has abierto aplicaciones.</p>';
    return list.map((id) => this.#appCard(APP_BY_ID.get(id), 'recent')).join('');
  }

  #emptyRow() {
    return '<p class="row-empty">Nada por aquí. Puedes restaurar lo eliminado desde Aplicaciones.</p>';
  }

  #locationsHTML() {
    const saved = this.getLocations();
    const rows = MEDIA_LOCATIONS.map((loc) => {
      const info = saved[loc.key];
      const where = info ? esc(info.name) : 'Sin elegir';
      return `
        <div class="loc-row${info ? ' is-set' : ''}" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="loc:${loc.key}" data-act="loc-choose" data-loc="${loc.key}">
          <span class="loc-ico">${icon(loc.icon)}</span>
          <span class="loc-text"><b>${esc(loc.label)}</b><small>${where}</small></span>
          <span class="loc-action">${info ? 'Cambiar' : 'Elegir carpeta'}</span>
        </div>`;
    }).join('');
    return `
      <section class="locations" aria-label="Dónde están tus archivos">
        <h2 class="locations-title"><span class="row-icon">${icon('folder')}</span>Dónde están tus archivos</h2>
        <p class="locations-sub">Indica la carpeta de tu música, fotos y videos. Al abrir esas aplicaciones, el Gestor de archivos entra directo ahí.</p>
        <div class="locations-list">${rows}</div>
      </section>`;
  }

  #restoreHTML() {
    if (!this.hidden.size) return '';
    const n = this.hidden.size;
    return `
      <div class="apps-restore">
        <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main"
             data-fid="apps:restore" data-act="restore-hidden">${icon('reset')}Restaurar ${n === 1 ? 'el elemento eliminado' : `los ${n} elementos eliminados`}</div>
      </div>`;
  }

  #row(id, title, iconName, cards) {
    return `
      <section class="row" data-row="${id}">
        <h2 class="row-title"><span class="row-icon">${icon(iconName)}</span>${esc(title)}</h2>
        <div class="row-track" data-track="${id}">${cards}</div>
      </section>`;
  }

  /** Arte de la tarjeta: foto propia > logo a color > icono de trazo. */
  #art(item) {
    const custom = this.icons[item.id];
    if (custom) return `<span class="card-art card-art--plate"><img class="card-img" src="${custom}" alt=""></span>`;
    const svg = logo(item.id);
    if (svg) return `<span class="card-art card-art--plate">${svg}</span>`;
    return `<span class="card-art">${icon(item.icon)}</span>`;
  }

  #appCard(app, prefix) {
    return `
      <div class="card" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="app" data-id="${app.id}" data-fid="${prefix}:${app.id}"
           style="--c1:${app.c1};--c2:${app.c2}" aria-label="${esc(app.name)}">
        ${this.#art(app)}
        <span class="card-label">${esc(app.name)}</span>
      </div>`;
  }

  #recCard(item) {
    return `
      <div class="card card--wide" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="rec" data-id="${item.id}" data-fid="rec:${item.id}"
           style="--c1:${item.c1};--c2:${item.c2}" aria-label="${esc(item.name)}">
        ${this.#art(item)}
        <span class="card-label">${esc(item.name)}</span>
        <span class="card-sub">${esc(item.subtitle)}</span>
      </div>`;
  }
}
