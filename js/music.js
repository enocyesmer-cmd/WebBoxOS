/**
 * Música: canciones de YouTube pegadas por el usuario, mostradas como un carrusel
 * de portadas (la central, grande) con una barra de reproducción de cristal.
 * El audio lo reproduce el reproductor oficial de YouTube en un contenedor
 * invisible, así que la música sigue sonando aunque cambies de pantalla.
 */
import { parseMediaUrl, youtubeThumb, formatTime } from './core/media.js';
import { loadYouTubeApi } from './player.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const PALETTE = [
  ['#7c2d12', '#f59e0b'], ['#1e3a8a', '#7c3aed'], ['#065f46', '#34d399'],
  ['#831843', '#fb7185'], ['#0c4a6e', '#38bdf8'], ['#312e81', '#ec4899'],
  ['#7f1d1d', '#f97316'], ['#134e4a', '#2dd4bf'],
];
const ERRORS = {
  2: 'El enlace no es válido.',
  5: 'El reproductor de YouTube tuvo un error.',
  100: 'La canción no existe o es privada.',
  101: 'El dueño de este video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
  150: 'El dueño de este video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
};
const VISIBLE_SIDE = 2; // portadas visibles a cada lado de la central

const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

export class MusicScreen {
  /**
   * @param {{root:HTMLElement, focus:object, lib:object, onAdd:()=>void, onDelete:(item:object)=>void}} opts
   */
  constructor({ root, focus, lib, onAdd, onDelete }) {
    this.root = root;
    this.focus = focus;
    this.lib = lib;
    this.onAdd = onAdd;
    this.onDelete = onDelete;
    this.items = [];
    this.index = 0;
    this.selectedId = null;
    this.nowId = null;
    this.lastCount = null;
    this.yt = null;
    this.ytReady = null;
    this.loadToken = 0;
    this.playing = false;
    this.timer = 0;

    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('tvfocus', (e) => {
      const card = e.target.closest?.('.mcard');
      if (card) this.#select(card.dataset.id);
    });
    // Las portadas rotas se quitan y queda el degradado.
    root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.remove();
    }, true);
  }

  // ------------------------------------------------------------------ vista

  render() {
    this.items = this.lib.items();
    if (this.lastCount !== null && this.items.length > this.lastCount) this.selectedId = this.items.at(-1).id;
    this.lastCount = this.items.length;
    const found = this.items.findIndex((i) => i.id === this.selectedId);
    this.index = found >= 0 ? found : 0;
    this.selectedId = this.items[this.index]?.id ?? null;
    if (this.nowId && !this.items.some((i) => i.id === this.nowId)) this.#stop();

    const has = this.items.length > 0;
    this.root.innerHTML = `
      <div class="music">
        <div class="music-bg" data-bg></div>
        <header class="music-head">
          <div>
            <h1 class="screen-title">Música</h1>
            <p class="lib-sub">Pega el enlace de YouTube de una canción y escúchala aquí.</p>
          </div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="main" data-mz="add"
               data-fid="mus:add" data-act="mus-add">${icon('plus')}Agregar</div>
        </header>
        ${has ? `<div class="music-stage" data-stage>${this.items.map((it, i) => this.#card(it, i)).join('')}</div>` : `
        <div class="lib-empty music-empty"><b>Aún no hay canciones.</b><br>Pulsa <b>Agregar</b> y pega un enlace de YouTube
        (una canción o una lista). El título y el artista se completan solos.</div>`}
        <div class="music-bar" data-bar>
          ${this.#barBtn('prev', 'prev', 'Anterior')}
          ${this.#barBtn('play', 'playsolid', 'Reproducir')}
          ${this.#barBtn('next', 'next', 'Siguiente')}
          <div class="mnow" data-now>
            <span class="mnow-art" data-now-art></span>
            <span class="mnow-text"><b data-now-title>—</b><small data-now-artist>Nada en reproducción</small></span>
            <span class="mnow-time" data-now-time></span>
            <span class="mnow-progress"><i data-progress></i></span>
          </div>
          ${this.#barBtn('mute', 'volume', 'Sonido')}
          ${this.#barBtn('delete', 'trash', 'Eliminar canción')}
        </div>
      </div>`;
    this.#applyPositions();
    this.#updateBar();
  }

  #barBtn(name, ico, label) {
    return `
      <div class="mbtn" role="button" tabindex="-1" data-focusable data-zone="main" data-mz="bar"
           data-fid="mus:${name}" data-act="mus-${name}" aria-label="${esc(label)}" data-btn="${name}">${icon(ico)}</div>`;
  }

  #artist(item) {
    if (item.artist) return item.artist;
    return parseMediaUrl(item.url)?.videoId ? 'YouTube' : 'Lista de YouTube';
  }

  #thumb(item) {
    return item.image || youtubeThumb(parseMediaUrl(item.url));
  }

  #card(item, i) {
    const [c1, c2] = PALETTE[hash(item.title) % PALETTE.length];
    const img = this.#thumb(item);
    return `
      <div class="mcard" role="button" tabindex="-1" data-focusable data-noreveal data-zone="main" data-mz="card"
           data-kind="mus" data-id="${esc(item.id)}" data-fid="${esc(this.lib.fid(item.id))}"
           style="--c1:${c1};--c2:${c2};--d:${i};--ad:${Math.abs(i)}" aria-label="${esc(item.title)}">
        <span class="mcard-art">
          <span class="mcard-ico">${icon('music')}</span>
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="mcard-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
        <span class="mcard-info"><b>${esc(item.title)}</b><small>${esc(this.#artist(item))}</small></span>
      </div>`;
  }

  /** Coloca cada portada según su distancia a la seleccionada (animado por CSS). */
  #applyPositions() {
    const cards = this.root.querySelectorAll('.mcard');
    cards.forEach((card, i) => {
      const d = i - this.index;
      card.style.setProperty('--d', d);
      card.style.setProperty('--ad', Math.abs(d));
      card.classList.toggle('is-far', Math.abs(d) > VISIBLE_SIDE);
      card.classList.toggle('is-playing', card.dataset.id === this.nowId);
    });
    const item = this.items[this.index];
    const bg = this.root.querySelector('[data-bg]');
    if (!bg) return;
    const img = item && this.#thumb(item);
    const [c1, c2] = PALETTE[hash(item?.title ?? 'webbox') % PALETTE.length];
    bg.style.setProperty('--c1', c1);
    bg.style.setProperty('--c2', c2);
    bg.style.backgroundImage = img ? `url("${img}")` : '';
  }

  #select(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0 || i === this.index) return;
    this.index = i;
    this.selectedId = id;
    this.#applyPositions();
    this.#updateBar();
  }

  // -------------------------------------------------------------- barra

  #updateBar() {
    const shown = this.items.find((i) => i.id === this.nowId) ?? this.items[this.index];
    const q = (s) => this.root.querySelector(s);
    if (!q('[data-bar]')) return;
    q('[data-now-title]').textContent = shown ? shown.title : '—';
    q('[data-now-artist]').textContent = shown ? this.#artist(shown) : 'Nada en reproducción';
    const art = q('[data-now-art]');
    const img = shown && this.#thumb(shown);
    art.innerHTML = img ? `<img src="${esc(img)}" alt="">` : icon('music');

    const play = q('[data-btn="play"]');
    play.innerHTML = icon(this.playing ? 'pause' : 'playsolid');
    play.setAttribute('aria-label', this.playing ? 'Pausar' : 'Reproducir');
    const muted = Boolean(this.yt?.isMuted?.());
    q('[data-btn="mute"]').innerHTML = icon(muted ? 'mute' : 'volume');
    for (const name of ['prev', 'play', 'next', 'delete']) {
      q(`[data-btn="${name}"]`).setAttribute('aria-disabled', String(!this.items.length));
    }
    this.root.querySelector('.music-bar')?.classList.toggle('is-playing', this.playing);
    for (const card of this.root.querySelectorAll('.mcard')) {
      card.classList.toggle('is-playing', card.dataset.id === this.nowId && this.playing);
    }
  }

  #tick() {
    if (!this.yt?.getCurrentTime) return;
    const cur = this.yt.getCurrentTime() || 0;
    const dur = this.yt.getDuration() || 0;
    const bar = this.root.querySelector('[data-progress]');
    const time = this.root.querySelector('[data-now-time]');
    if (bar) bar.style.width = dur ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';
    if (time) time.textContent = dur ? `${formatTime(cur)} / ${formatTime(dur)}` : '';
  }

  // ------------------------------------------------------------ reproducción

  async play(id) {
    const item = this.items.find((i) => i.id === id);
    const media = item && parseMediaUrl(item.url);
    if (!item || media?.type !== 'youtube') return;
    this.nowId = id;
    this.#select(id);
    this.#applyPositions();
    const token = ++this.loadToken;
    try {
      await loadYouTubeApi();
    } catch {
      toast('Necesitas conexión a Internet para reproducir música de YouTube.', 4500);
      this.nowId = null;
      this.#updateBar();
      return;
    }
    if (token !== this.loadToken) return;
    try {
      if (!this.yt) await this.#createPlayer(media);
      else if (media.videoId) this.yt.loadVideoById({ videoId: media.videoId, startSeconds: media.start || 0 });
      else this.yt.loadPlaylist({ listType: 'playlist', list: media.listId });
    } catch (err) {
      toast(`No se pudo iniciar la música (${err?.message || 'error'}).`, 4500);
      this.nowId = null;
    }
    this.#updateBar();
  }

  async #createPlayer(media) {
    let host = document.getElementById('music-engine');
    if (!host) {
      host = document.createElement('div');
      host.id = 'music-engine';
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '<div></div>';
      document.body.appendChild(host);
    }
    const vars = { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, fs: 0, modestbranding: 1 };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    if (media.start) vars.start = media.start;
    if (media.listId) {
      vars.listType = 'playlist';
      vars.list = media.listId;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tiempo agotado')), 15000);
      this.yt = new window.YT.Player(host.firstElementChild, {
        host: 'https://www.youtube-nocookie.com',
        width: '200',
        height: '200',
        videoId: media.videoId || undefined,
        playerVars: vars,
        events: {
          onReady: () => { clearTimeout(timer); resolve(); },
          onStateChange: (e) => this.#onState(e.data),
          onError: (e) => this.#onError(e.data),
        },
      });
    });
  }

  #onState(state) {
    this.playing = state === 1 || state === 3;
    clearInterval(this.timer);
    if (this.playing) this.timer = setInterval(() => this.#tick(), 500);
    if (state === 0) {
      // Terminó la canción: pasa a la siguiente de la lista, si hay.
      const i = this.items.findIndex((it) => it.id === this.nowId);
      if (i >= 0 && i < this.items.length - 1) this.play(this.items[i + 1].id);
    }
    this.#tick();
    this.#updateBar();
  }

  #onError(code) {
    toast(ERRORS[code] ?? 'No se pudo reproducir esta canción.', 5000);
    this.playing = false;
    this.#updateBar();
  }

  toggle() {
    if (!this.items.length) return;
    if (!this.nowId || !this.yt) {
      this.play(this.items[this.index].id);
      return;
    }
    if (this.playing) this.yt.pauseVideo();
    else this.yt.playVideo();
  }

  /** Pausa sin perder el lugar (por ejemplo, al abrir un video). */
  pause() {
    if (this.playing) this.yt?.pauseVideo?.();
  }

  #stop() {
    this.loadToken += 1;
    try { this.yt?.stopVideo?.(); } catch { /* ya no existe */ }
    this.nowId = null;
    this.playing = false;
    clearInterval(this.timer);
  }

  #skip(delta) {
    if (!this.items.length) return;
    const base = this.items.findIndex((i) => i.id === this.nowId);
    const from = base >= 0 ? base : this.index;
    const next = from + delta;
    if (next < 0 || next >= this.items.length) {
      toast(delta > 0 ? 'Es la última canción.' : 'Es la primera canción.');
      return;
    }
    this.play(this.items[next].id);
    this.focus.focusByFid(this.lib.fid(this.items[next].id), { scroll: false });
  }

  // ------------------------------------------------------------- entradas

  focusEntry() {
    if (!(this.selectedId && this.focus.focusByFid(this.lib.fid(this.selectedId)))) {
      this.focus.focusFirst('#screen-music [data-zone="main"]');
    }
  }

  /** Navegación propia del carrusel. Devuelve true si consumió la acción. */
  handleAction(action) {
    const cur = this.focus.current;
    const mz = cur?.dataset.mz;
    if (!mz || !this.root.contains(cur)) return false;
    const card = () => this.focus.focusByFid(this.lib.fid(this.selectedId));

    if (mz === 'card' && (action === 'left' || action === 'right')) {
      const next = this.index + (action === 'right' ? 1 : -1);
      if (next < 0 || next >= this.items.length) {
        this.focus.bump(cur, action);
      } else {
        this.focus.focusByFid(this.lib.fid(this.items[next].id), { scroll: false });
      }
      return true;
    }
    if (action === 'up') {
      if (mz === 'bar') return card() || true;
      if (mz === 'card') return this.focus.focusByFid('mus:add') || true;
    }
    if (action === 'down') {
      if (mz === 'add' && this.items.length) return card() || true;
      if (mz === 'card') return this.focus.focusByFid('mus:play') || true;
    }
    return false;
  }

  #onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      switch (btn.dataset.act) {
        case 'mus-add': this.onAdd(); break;
        case 'mus-play': this.toggle(); break;
        case 'mus-prev': this.#skip(-1); break;
        case 'mus-next': this.#skip(1); break;
        case 'mus-mute':
          if (this.yt?.isMuted?.()) this.yt.unMute(); else this.yt?.mute?.();
          this.#updateBar();
          break;
        case 'mus-delete': {
          const item = this.items[this.index];
          if (item) this.onDelete(item);
          break;
        }
        default: break;
      }
      return;
    }
    const card = e.target.closest('.mcard');
    if (card) this.play(card.dataset.id);
  }
}
