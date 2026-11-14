/**
 * Formulario modal para agregar contenido. Los campos son elementos enfocables
 * (se navegan con mando/flechas); OK sobre un campo abre el teclado del sistema.
 */
import { esc } from './ui.js';

export class Dialog {
  /** @param {{el:HTMLElement, focus:import('./core/focus.js').FocusManager}} opts */
  constructor({ el, focus }) {
    this.el = el;
    this.focus = focus;
    this.isOpen = false;
    this.returnFid = null;
    this.busy = false;
    this.spec = null;

    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('keydown', (e) => {
      if (e.target.tagName !== 'INPUT') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
        this.focus.move('down');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.blur();
      }
    });
  }

  /**
   * @param {{title:string, hint?:string, fields:{key:string,label:string,type?:'text'|'password',placeholder?:string,value?:string}[],
   *   submitLabel?:string, onSubmit:(values:object)=>Promise<string|null>|string|null}} spec
   */
  open(spec) {
    if (this.isOpen) return;
    this.spec = spec;
    this.returnFid = this.focus.current?.dataset.fid ?? null;
    const fields = spec.fields
      .map(
        (f) => `
        <div class="field" role="button" tabindex="-1" data-focusable data-zone="dialog"
             data-fid="dlg:${f.key}" data-act="dlg-field">
          <label>${esc(f.label)}</label>
          <input type="${f.type === 'password' ? 'password' : 'text'}" name="${esc(f.key)}" value="${esc(f.value ?? '')}"
                 placeholder="${esc(f.placeholder ?? '')}" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="dialog-card">
        <h2>${esc(spec.title)}</h2>
        ${spec.hint ? `<p class="dialog-hint">${esc(spec.hint)}</p>` : ''}
        ${fields}
        <p class="dialog-error" data-error hidden></p>
        <div class="dialog-actions">
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="dialog" data-fid="dlg:save" data-act="dlg-save">${esc(spec.submitLabel ?? 'Guardar')}</div>
          <div class="btn" role="button" tabindex="-1" data-focusable data-zone="dialog" data-fid="dlg:cancel" data-act="dlg-cancel">Cancelar</div>
        </div>
      </div>`;
    this.el.hidden = false;
    this.isOpen = true;
    this.focus.clear();
    this.focus.pushScope(this.el);
    this.focus.focusFirst('[data-focusable]');
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    document.activeElement?.blur?.();
    this.isOpen = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.focus.popScope();
    return restore ? this.focus.focusByFid(this.returnFid) : false;
  }

  values() {
    const out = {};
    for (const input of this.el.querySelectorAll('input')) out[input.name] = input.value.trim();
    return out;
  }

  #showError(message) {
    const el = this.el.querySelector('[data-error]');
    if (!el) return;
    el.textContent = message ?? '';
    el.hidden = !message;
  }

  async #onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'dlg-field') {
      el.querySelector('input')?.focus();
    } else if (el.dataset.act === 'dlg-cancel') {
      this.close();
    } else if (el.dataset.act === 'dlg-save') {
      if (this.busy) return;
      this.busy = true;
      this.#showError('');
      el.textContent = 'Guardando…';
      try {
        const error = await this.spec.onSubmit(this.values());
        if (error) {
          this.#showError(error);
          el.textContent = this.spec.submitLabel ?? 'Guardar';
        } else {
          // El foco vuelve a la tarjeta nueva (returnFid); si no existe, al primer elemento.
          if (!this.close()) this.focus.focusFirst('[data-zone="main"]');
        }
      } finally {
        this.busy = false;
      }
    }
  }
}
