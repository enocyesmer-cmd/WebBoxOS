/**
 * Ejecuta una app instalada a pantalla completa dentro de WebBox OS, en un iframe aislado.
 *
 * Salir: Atrás/Esc (o Inicio) cierran la app. Si la app declara "input": "app" (juegos que usan
 * esos botones), Atrás/Esc se reenvían a la app y se sale pulsando Inicio dos veces, con
 * WebBox.exit() desde la app, o con el botón "Salir" de la esquina (mouse).
 */
import { bus } from './core/events.js';
import { readAppFiles, loadAppData, saveAppData } from './appRuntime.js';
import { buildAppDocument } from './core/appDoc.js';
import { safePath } from './core/zip.js';
import { esc, toast } from './ui.js';

const HOME_AGAIN_MS = 1500;

export class AppHost {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.app = null;
    this.revoke = null;
    this.returnFid = null;
    this.lastHome = 0;
    this.token = 0;
    this.files = null; // Map ruta -> Blob de la app abierta

    el.innerHTML = `
      <iframe class="apphost-frame" title="Aplicación"
        sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals allow-downloads"
        allow="gamepad; autoplay; fullscreen; clipboard-write" referrerpolicy="no-referrer"></iframe>
      <div class="apphost-loading" data-loading>Cargando…</div>
      <div class="apphost-exit" role="button" data-act="app-exit" title="Salir de la app">Salir</div>`;
    this.frame = el.querySelector('iframe');
    this.loading = el.querySelector('[data-loading]');

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="app-exit"]')) this.close();
    });
    this.frame.addEventListener('load', () => {
      if (!this.isOpen || !this.frame.srcdoc) return;
      this.loading.hidden = true;
      this.frame.focus();
    });

    // Mensajes de la app (solo se aceptan los de nuestro iframe)
    window.addEventListener('message', (e) => this.#onMessage(e));
    // Mando/teclado hacia la app que lo pida
    bus.on('action', ({ action }) => {
      if (!this.isOpen) return;
      if (this.app.input === 'app' || this.app.permissions.includes('input')) {
        this.frame.contentWindow?.postMessage({ wbx: 1, type: 'input', action }, '*');
      }
    });
  }

  async open(app) {
    if (this.isOpen) return;
    const token = ++this.token;
    this.app = app;
    this.isOpen = true;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    this.loading.textContent = `Abriendo ${app.name}…`;
    this.loading.hidden = false;
    this.el.hidden = false;
    this.focus.clear();
    this.focus.pushScope(this.el); // sin elementos enfocables: el mando no mueve nada detrás
    document.body.classList.add('app-open');

    try {
      const [files, data] = await Promise.all([readAppFiles(app.id), loadAppData(app.id)]);
      if (token !== this.token) return;
      this.files = files;
      const built = await buildAppDocument({ app, files, data });
      if (token !== this.token) {
        built.revoke();
        return;
      }
      this.revoke = built.revoke;
      this.frame.srcdoc = built.html;
    } catch (err) {
      if (token !== this.token) return;
      this.loading.innerHTML = `No se pudo abrir la app: ${esc(err?.message || 'error desconocido')}<br><small>Atrás para volver</small>`;
    }
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    this.token += 1;
    this.isOpen = false;
    this.frame.removeAttribute('srcdoc');
    this.frame.src = 'about:blank';
    this.revoke?.();
    this.revoke = null;
    this.app = null;
    this.files = null;
    this.el.hidden = true;
    document.body.classList.remove('app-open');
    this.focus.popScope();
    if (restore) this.focus.focusByFid(this.returnFid);
  }

  /**
   * Atrás o Inicio mientras hay una app abierta. Devuelve true si se encargó de la pulsación.
   * @param {'back'|'home'} kind
   */
  requestExit(kind) {
    if (!this.isOpen) return false;
    if (this.app.input !== 'app' || !this.frame.srcdoc) {
      this.close();
      return true;
    }
    if (kind === 'home') {
      const now = Date.now();
      if (now - this.lastHome < HOME_AGAIN_MS) this.close();
      else {
        this.lastHome = now;
        toast('Pulsa Inicio otra vez para salir de la app');
      }
    }
    return true; // "back" ya se reenvió a la app
  }

  /** La app pide un archivo de su paquete (fetch de algo grande): se le entrega por mensaje. */
  async #sendFile(msg) {
    const path = safePath(msg.path);
    const blob = path && this.files?.get(path);
    const frame = this.frame.contentWindow;
    if (!blob) {
      frame?.postMessage({ wbx: 1, type: 'file', id: msg.id, buffer: null }, '*');
      return;
    }
    const buffer = await blob.arrayBuffer();
    frame?.postMessage({ wbx: 1, type: 'file', id: msg.id, buffer, mime: blob.type }, '*', [buffer]);
  }

  #onMessage(e) {
    if (!this.isOpen || e.source !== this.frame.contentWindow) return;
    const msg = e.data;
    if (!msg || msg.wbx !== 1) return;
    if (msg.type === 'file') this.#sendFile(msg);
    else if (msg.type === 'exit') this.close();
    else if (msg.type === 'notify' && typeof msg.text === 'string') toast(msg.text.slice(0, 120));
    else if (msg.type === 'store' && this.app.permissions.includes('storage')) {
      const { id } = this.app;
      saveAppData(id, msg.values).catch((err) => toast(err?.message || 'No se pudieron guardar los datos de la app.'));
    }
  }
}
