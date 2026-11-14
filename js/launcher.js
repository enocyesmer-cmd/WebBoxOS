/**
 * Launcher: pantalla de inicio (filas de tarjetas) y pantalla de aplicaciones.
 * No maneja entradas directamente: las tarjetas son elementos `data-focusable`
 * y el administrador de foco hace `click()` al pulsar OK.
 */
import { APPS, FAVORITES, RECOMMENDED, DEFAULT_RECENTS } from './data/apps.js';
import { icon } from './icons.js';
import { storage } from './core/storage.js';
import { esc } from './ui.js';

const APP_BY_ID = new Map(APPS.map((a) => [a.id, a]));
const REC_BY_ID = new Map(RECOMMENDED.map((r) => [r.id, r]));
const MAX_RECENTS = 8;

export class Launcher {
  /**
   * @param {{homeEl:HTMLElement, appsEl:HTMLElement, onOpen:(item:object)=>void}} opts
   */
  constructor({ homeEl, appsEl, onOpen }) {
    this.homeEl = homeEl;
    this.appsEl = appsEl;
    this.onOpen = onOpen;
    this.recents = this.#loadRecents();

    const handler = (e) => {
      const card = e.target.closest('[data-kind]');
      if (!card) return;
      const item =
        card.dataset.kind === 'app'
          ? APP_BY_ID.get(card.dataset.id)
          : REC_BY_ID.get(card.dataset.id);
      if (item) this.onOpen({ ...item, kind: card.dataset.kind });
    };
    homeEl.addEventListener('click', handler);
    appsEl.addEventListener('click', handler);
  }

  render() {
    this.homeEl.innerHTML = `
      ${this.#row('favorites', 'Aplicaciones favoritas', 'star', FAVORITES.map((id) => this.#appCard(APP_BY_ID.get(id), 'fav')).join(''))}
      ${this.#row('recents', 'Recientes', 'clock', this.#recentsHTML())}
      ${this.#row('recommended', 'Recomendado para ti', 'film', RECOMMENDED.map((r) => this.#recCard(r)).join(''))}
    `;

    this.appsEl.innerHTML = `
      <h1 class="screen-title">Aplicaciones</h1>
      <div class="grid">${APPS.map((a) => this.#appCard(a, 'all')).join('')}</div>
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

  // ---------------------------------------------------------------- interno

  #loadRecents() {
    const saved = storage.get('recents', null);
    const list = Array.isArray(saved)
      ? saved.filter((id) => APP_BY_ID.has(id))
      : DEFAULT_RECENTS.slice();
    return list.slice(0, MAX_RECENTS);
  }

  #recentsHTML() {
    if (!this.recents.length) return '<p class="row-empty">Aún no has abierto aplicaciones.</p>';
    return this.recents.map((id) => this.#appCard(APP_BY_ID.get(id), 'recent')).join('');
  }

  #row(id, title, iconName, cards) {
    return `
      <section class="row" data-row="${id}">
        <h2 class="row-title"><span class="row-icon">${icon(iconName)}</span>${esc(title)}</h2>
        <div class="row-track" data-track="${id}">${cards}</div>
      </section>`;
  }

  #appCard(app, prefix) {
    return `
      <div class="card" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="app" data-id="${app.id}" data-fid="${prefix}:${app.id}"
           style="--c1:${app.c1};--c2:${app.c2}" aria-label="${esc(app.name)}">
        <span class="card-art">${icon(app.icon)}</span>
        <span class="card-label">${esc(app.name)}</span>
      </div>`;
  }

  #recCard(item) {
    return `
      <div class="card card--wide" role="button" tabindex="-1" data-focusable data-zone="main"
           data-kind="rec" data-id="${item.id}" data-fid="rec:${item.id}"
           style="--c1:${item.c1};--c2:${item.c2}" aria-label="${esc(item.name)}">
        <span class="card-art">${icon(item.icon)}</span>
        <span class="card-label">${esc(item.name)}</span>
        <span class="card-sub">${esc(item.subtitle)}</span>
      </div>`;
  }
}
