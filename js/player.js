/**
 * Reproductor a pantalla completa para YouTube (IFrame API oficial, con controles
 * propios para mando/teclado) y para archivos de video (<video>).
 *
 * El iframe de YouTube no recibe clics ni teclas (pointer-events:none y disablekb):
 * así el foco nunca se queda "atrapado" dentro y Atrás/Inicio siempre funcionan.
 */
import { parseMediaUrl, formatTime } from './core/media.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const IDLE_MS = 4000;
const YT_ERRORS = {
  2: 'El enlace del video no es válido.',
  5: 'El reproductor de YouTube tuvo un error.',
  100: 'El video no existe o es privado.',
  101: 'El dueño del video no permite verlo fuera de YouTube.',
  150: 'El dueño del video no permite verlo fuera de YouTube.',
};

let ytPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('sin conexión'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('tiempo agotado')), 15000);
  }).catch((err) => {
    ytPromise = null;
    throw err;
  });
  return ytPromise;
}

// ---------------------------------------------------------------- adaptadores

class YouTubeAdapter {
  constructor(host, media, { onState, onError }) {
    this.host = host;
    this.media = media;
    this.onState = onState;
    this.onError = onError;
    this.p = null;
  }

  async init() {
    await loadYouTubeApi();
    const vars = {
      autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1,
      playsinline: 1, fs: 0, iv_load_policy: 3,
    };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    if (this.media.start) vars.start = this.media.start;
    if (this.media.listId) {
      vars.listType = 'playlist';
      vars.list = this.media.listId;
    }
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('tiempo agotado')), 15000);
      this.p = new window.YT.Player(this.host, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        videoId: this.media.videoId || undefined,
        playerVars: vars,
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => this.onError(YT_ERRORS[e.data] ?? 'No se pudo reproducir el video.'),
        },
      });
    });
  }

  get isList() { return Boolean(this.media.listId); }
  isPlaying() { return [1, 3].includes(this.p?.getPlayerState?.()); }
  toggle() { if (this.isPlaying()) this.p.pauseVideo(); else this.p.playVideo(); }
  seek(delta) { this.p.seekTo(Math.max(0, this.p.getCurrentTime() + delta), true); }
  time() { return [this.p?.getCurrentTime?.() ?? 0, this.p?.getDuration?.() ?? 0]; }
  isMuted() { return Boolean(this.p?.isMuted?.()); }
  toggleMute() { if (this.isMuted()) this.p.unMute(); else this.p.mute(); }
  next() { this.p.nextVideo(); }
  prev() { this.p.previousVideo(); }
  destroy() { try { this.p?.destroy(); } catch { /* ya no existe */ } }
}

class VideoAdapter {
  constructor(host, media, { onState, onError }) {
    this.host = host;
    this.media = media;
    this.onState = onState;
    this.onError = onError;
    this.v = null;
  }

  async init() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.src = this.media.src;
    v.addEventListener('playing', () => this.onState(1));
    v.addEventListener('waiting', () => this.onState(3));
    v.addEventListener('pause', () => this.onState(2));
    v.addEventListener('ended', () => this.onState(0));
    v.addEventListener('error', () =>
      this.onError('No se pudo abrir el archivo. Revisa la ruta y que el formato sea compatible (.mp4 / .webm).'));
    this.host.replaceWith(v);
    this.v = v;
    v.play().catch(() => { /* si el navegador bloquea el autoplay, queda en pausa */ });
  }

  get isList() { return false; }
  isPlaying() { return !this.v.paused && !this.v.ended; }
  toggle() { if (this.v.paused) this.v.play().catch(() => {}); else this.v.pause(); }
  seek(delta) { this.v.currentTime = Math.max(0, this.v.currentTime + delta); }
  time() { return [this.v.currentTime, Number.isFinite(this.v.duration) ? this.v.duration : 0]; }
  isMuted() { return this.v.muted; }
  toggleMute() { this.v.muted = !this.v.muted; }
  next() {}
  prev() {}
  destroy() { this.v?.pause(); this.v?.removeAttribute('src'); this.v?.load(); }
}

// ----------------------------------------------------------------- reproductor

export class Player {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.adapter = null;
    this.returnFid = null;
    this.item = null;
    this.onDelete = null;
    this.confirmDelete = false;
    this.poll = 0;
    this.idleTimer = 0;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('mousemove', () => this.#show());
  }

  async open(item, { onDelete } = {}) {
    if (this.isOpen) return;
    const media = parseMediaUrl(item.url);
    if (!media) {
      toast('Ese enlace no es válido. Elimínalo y vuelve a agregarlo.');
      return;
    }
    this.item = item;
    this.onDelete = onDelete ?? null;
    this.confirmDelete = false;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    this.isOpen = true;
    document.body.classList.add('player-open');

    this.el.innerHTML = `
      <div class="player-stage" data-stage><div data-host></div></div>
      <div class="player-msg" data-msg>Cargando…</div>
      <div class="player-top"><span class="player-title">${esc(item.title)}</span></div>
      <div class="player-controls">
        <div class="player-bar">
          <span data-cur>0:00</span>
          <div class="player-track"><i data-fill></i></div>
          <span data-dur>0:00</span>
        </div>
        <div class="player-buttons">
          ${this.#btn('toggle', 'playsolid', 'Reproducir')}
          ${this.#btn('back', 'back10', '10 s')}
          ${this.#btn('fwd', 'fwd10', '10 s')}
          ${media.listId ? this.#btn('prev', 'prev', 'Anterior') + this.#btn('next', 'next', 'Siguiente') : ''}
          ${this.#btn('mute', 'volume', 'Sonido')}
          ${this.#btn('full', 'fullscreen', 'Pantalla completa')}
          ${onDelete ? this.#btn('del', 'trash', 'Eliminar') : ''}
          ${this.#btn('close', 'close', 'Cerrar')}
        </div>
      </div>`;
    this.el.classList.remove('is-idle');
    this.el.hidden = false;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusByFid('pl:toggle');
    this.#show();

    const Adapter = media.type === 'youtube' ? YouTubeAdapter : VideoAdapter;
    const adapter = new Adapter(this.el.querySelector('[data-host]'), media, {
      onState: (s) => this.#onState(s),
      onError: (msg) => this.#fail(msg),
    });
    this.adapter = adapter;
    try {
      await adapter.init();
    } catch (err) {
      if (this.adapter === adapter) {
        this.#fail(media.type === 'youtube'
          ? `No se pudo cargar YouTube (${err.message}). Revisa tu conexión a internet.`
          : 'No se pudo abrir el video.');
      }
      return;
    }
    if (this.adapter !== adapter) { adapter.destroy(); return; } // se cerró mientras cargaba
    this.el.querySelector('[data-msg]')?.setAttribute('hidden', '');
    this.poll = setInterval(() => this.#tick(), 500);
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    clearInterval(this.poll);
    clearTimeout(this.idleTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.adapter?.destroy();
    this.adapter = null;
    this.isOpen = false;
    document.body.classList.remove('player-open');
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    if (restore) this.focus.focusByFid(this.returnFid);
  }

  /**
   * Llamar antes de procesar una acción de navegación.
   * Devuelve true si la acción solo sirvió para mostrar los controles ocultos.
   */
  handleAction(action) {
    if (!this.isOpen || action === 'back' || action === 'home') return false;
    const wasIdle = this.el.classList.contains('is-idle');
    this.#show();
    return wasIdle;
  }

  // ---------------------------------------------------------------- interno

  #btn(act, ico, label) {
    return `
      <div class="btn btn--sm" role="button" tabindex="-1" data-focusable data-zone="player"
           data-fid="pl:${act}" data-act="pl-${act}" data-label>
        <span data-ico>${icon(ico)}</span><span data-text>${esc(label)}</span>
      </div>`;
  }

  #setBtn(act, ico, label) {
    const b = this.el.querySelector(`[data-act="pl-${act}"]`);
    if (!b) return;
    b.querySelector('[data-ico]').innerHTML = icon(ico);
    b.querySelector('[data-text]').textContent = label;
  }

  #show() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.adapter?.isPlaying()) this.el.classList.add('is-idle');
    }, IDLE_MS);
  }

  #onState(state) {
    const playing = state === 1 || state === 3;
    this.#setBtn('toggle', playing ? 'pause' : 'playsolid', playing ? 'Pausa' : 'Reproducir');
    if (!playing) this.#show();
  }

  #fail(message) {
    const msg = this.el.querySelector('[data-msg]');
    if (msg) {
      msg.textContent = message;
      msg.removeAttribute('hidden');
    }
    this.#show();
    toast(message, 5000);
  }

  #tick() {
    if (!this.adapter) return;
    const [cur, dur] = this.adapter.time();
    this.el.querySelector('[data-cur]').textContent = formatTime(cur);
    this.el.querySelector('[data-dur]').textContent = dur ? formatTime(dur) : '--:--';
    this.el.querySelector('[data-fill]').style.width = dur ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';
    this.#setBtn('mute', this.adapter.isMuted() ? 'mute' : 'volume', this.adapter.isMuted() ? 'Con sonido' : 'Silenciar');
  }

  #onClick(e) {
    const a = this.adapter;
    // Clic sobre el video = pausa/reproduce
    if (e.target.closest('[data-stage]')) return a?.toggle();
    const el = e.target.closest('[data-act]');
    if (!el) return undefined;
    this.#show();
    switch (el.dataset.act) {
      case 'pl-toggle': return a?.toggle();
      case 'pl-back': return a?.seek(-10);
      case 'pl-fwd': return a?.seek(10);
      case 'pl-prev': return a?.prev();
      case 'pl-next': return a?.next();
      case 'pl-mute': return a?.toggleMute();
      case 'pl-full': return this.#toggleFullscreen();
      case 'pl-close': return this.close();
      case 'pl-del':
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          this.#setBtn('del', 'trash', '¿Seguro? OK de nuevo');
          return undefined;
        }
        this.onDelete?.(this.item);
        return this.close({ restore: false });
      default: return undefined;
    }
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (this.el.requestFullscreen ?? this.el.webkitRequestFullscreen)?.call(this.el);
  }
}
