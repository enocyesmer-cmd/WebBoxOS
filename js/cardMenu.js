/**
 * Menú de acciones que aparece al pulsar dos veces una tarjeta (o un fondo).
 * Cada acción puede pedir un archivo: se abre el selector del sistema y el
 * archivo elegido se entrega a `onSelect(file)`.
 * Es un ámbito de foco propio, así que se maneja con mando, teclado y mouse.
 */
import { icon } from './icons.js';
import { esc } from './ui.js';

export class CardMenu {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.spec = null;
    this.returnFid = null;
    this.pendingAction = null;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('change', (e) => this.#onFile(e));
  }

  /**
   * @param {{title:string, subtitle?:string, fallbackFid?:string,
   *   actions:{id:string,label:string,icon?:string,danger?:boolean,file?:boolean,
   *   onSelect:(file?:File)=>Promise<void>|void}[]}} spec
   */
  open(spec) {
    if (this.isOpen) return;
    this.spec = spec;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    const buttons = spec.actions
      .map(
        (a) => `
        <div class="btn menu-btn${a.danger ? ' btn--danger' : ''}" role="button" tabindex="-1" data-focusable
             data-zone="cardmenu" data-fid="cm:${esc(a.id)}" data-act="cm-action" data-id="${esc(a.id)}">
          ${icon(a.icon ?? 'star')}${esc(a.label)}
        </div>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="dialog-card menu-card">
        <h2>${esc(spec.title)}</h2>
        ${spec.subtitle ? `<p class="dialog-hint">${esc(spec.subtitle)}</p>` : ''}
        <div class="menu-actions">
          ${buttons}
          <div class="btn menu-btn btn--ghost" role="button" tabindex="-1" data-focusable
               data-zone="cardmenu" data-fid="cm:cancel" data-act="cm-cancel">${icon('back')}Cancelar</div>
        </div>
        <input type="file" accept="image/*" data-cm-file hidden>
      </div>`;
    this.el.hidden = false;
    this.isOpen = true;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusFirst('[data-focusable]');
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    if (!restore) return false;
    return this.#restoreFocus();
  }

  #restoreFocus() {
    return (
      this.focus.focusByFid(this.returnFid) ||
      (this.spec?.fallbackFid && this.focus.focusByFid(this.spec.fallbackFid)) ||
      this.focus.focusFirst('[data-zone="main"]')
    );
  }

  #find(id) {
    return this.spec?.actions.find((a) => a.id === id);
  }

  async #run(action, file) {
    // Se cierra primero para que la acción pueda volver a dibujar la pantalla.
    this.close({ restore: false });
    try {
      await action.onSelect(file);
    } finally {
      this.#restoreFocus();
    }
  }

  #onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'cm-cancel') {
      this.close();
      return;
    }
    if (el.dataset.act !== 'cm-action') return;
    const action = this.#find(el.dataset.id);
    if (!action) return;
    if (action.file) {
      this.pendingAction = action;
      this.el.querySelector('[data-cm-file]')?.click();
    } else {
      this.#run(action);
    }
  }

  #onFile(e) {
    if (!e.target.matches?.('[data-cm-file]')) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    const action = this.pendingAction;
    this.pendingAction = null;
    if (file && action) this.#run(action, file);
  }
}
