/**
 * Administrador centralizado del foco.
 *
 * - Solo UN elemento tiene el foco a la vez (clase `is-focused`).
 * - Navegación espacial: busca el elemento más cercano en la dirección pedida
 *   usando la geometría real en pantalla (getBoundingClientRect).
 * - "Zonas" (data-zone): movimientos verticales se quedan dentro de la zona;
 *   los horizontales pueden saltar a otra zona (p. ej. de las tarjetas al menú
 *   lateral) y recuerdan el último elemento enfocado de esa zona.
 * - "Ámbitos" (scopes): un overlay puede bloquear el foco dentro de sí mismo.
 *
 * Los elementos navegables se marcan con el atributo `data-focusable`.
 */
import { bus } from './events.js';

const HORIZONTAL = new Set(['left', 'right']);

function isUsable(el) {
  return el.getClientRects().length > 0 && el.getAttribute('aria-disabled') !== 'true';
}

export class FocusManager {
  constructor(defaultRoot) {
    this.defaultRoot = defaultRoot;
    this.scopes = [];
    this.current = null;
    this.zoneMemory = new Map();
    /** 'smooth' o 'auto' (sin animación) */
    this.scrollBehavior = 'smooth';
  }

  get scope() {
    return this.scopes.length ? this.scopes[this.scopes.length - 1] : this.defaultRoot;
  }

  /** Elementos enfocables y visibles dentro del ámbito activo */
  candidates() {
    return Array.from(this.scope.querySelectorAll('[data-focusable]')).filter(isUsable);
  }

  isInScope(el) {
    return Boolean(el) && this.scope.contains(el) && isUsable(el);
  }

  byFid(fid) {
    if (!fid) return null;
    return this.candidates().find((el) => el.dataset.fid === fid) ?? null;
  }

  /** Da el foco a un elemento (y quita el anterior). */
  set(el, { scroll = true } = {}) {
    if (!el) return;
    if (this.current === el) {
      if (scroll) this.reveal(el);
      return;
    }
    const prev = this.current;
    if (prev) prev.classList.remove('is-focused');

    this.current = el;
    el.classList.add('is-focused');
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* elemento no enfocable por el navegador: no es grave */
    }

    const zone = el.dataset.zone;
    if (zone) this.zoneMemory.set(zone, el);

    if (scroll) this.reveal(el);
    el.dispatchEvent(new CustomEvent('tvfocus', { bubbles: true }));
    bus.emit('focus:change', { el, prev });
  }

  clear() {
    if (this.current) this.current.classList.remove('is-focused');
    this.current = null;
  }

  /** Desplaza los contenedores para que el elemento quede centrado. */
  reveal(el) {
    if (el.hasAttribute('data-noreveal')) return;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: this.scrollBehavior });
  }

  /** Enfoca el primer candidato que cumpla el selector (o el primero en general). */
  focusFirst(selector = null, opts) {
    let list = this.candidates();
    if (selector) {
      const filtered = list.filter((el) => el.matches(selector));
      if (filtered.length) list = filtered;
    }
    if (!list.length) return false;
    this.set(list[0], opts);
    return true;
  }

  focusByFid(fid, opts) {
    const el = this.byFid(fid);
    if (el) this.set(el, opts);
    return Boolean(el);
  }

  pushScope(root) {
    this.scopes.push(root);
  }

  popScope() {
    this.scopes.pop();
    this.clear();
  }

  activate() {
    if (this.current && this.current.isConnected) this.current.click();
  }

  #pickDefault(cands) {
    return cands.find((c) => c.dataset.zone === 'main') ?? cands[0];
  }

  /** Al cambiar de zona, vuelve al último elemento recordado de esa zona. */
  #zoneTarget(zone, cands) {
    const remembered = this.zoneMemory.get(zone);
    const rememberedOk = remembered && cands.includes(remembered) ? remembered : null;
    const marked = cands.find((c) => c.dataset.zone === zone && c.classList.contains('is-current'));
    return zone === 'nav' ? marked || rememberedOk : rememberedOk || marked;
  }

  /**
   * Mueve el foco en una dirección: 'up' | 'down' | 'left' | 'right'.
   * Devuelve true si el foco cambió.
   */
  move(dir) {
    const cands = this.candidates();
    if (!cands.length) return false;

    const cur = this.current;
    if (!cur || !cands.includes(cur)) {
      this.set(this.#pickDefault(cands));
      return true;
    }

    const a = cur.getBoundingClientRect();
    const acx = a.left + a.width / 2;
    const acy = a.top + a.height / 2;
    const zone = cur.dataset.zone;
    const horizontal = HORIZONTAL.has(dir);

    let best = null;

    // Pasada 1: misma zona. Movimiento horizontal exige solapamiento vertical
    // (para no saltar de una fila a otra al llegar al final).
    // Pasada 2 (solo horizontal): otras zonas, con tolerancia vertical.
    for (let pass = 1; pass <= (horizontal ? 2 : 1); pass += 1) {
      const found = [];
      for (const el of cands) {
        if (el === cur) continue;
        const sameZone = el.dataset.zone === zone;
        if ((pass === 1) !== sameZone) continue;

        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - acx;
        const dy = b.top + b.height / 2 - acy;

        let primary;
        let cross;
        let ok;
        switch (dir) {
          case 'left':
            ok = dx < -Math.min(a.width, b.width) * 0.25;
            primary = -dx;
            cross = Math.abs(dy);
            break;
          case 'right':
            ok = dx > Math.min(a.width, b.width) * 0.25;
            primary = dx;
            cross = Math.abs(dy);
            break;
          case 'up':
            ok = dy < -Math.min(a.height, b.height) * 0.25;
            primary = -dy;
            cross = Math.abs(dx);
            break;
          case 'down':
            ok = dy > Math.min(a.height, b.height) * 0.25;
            primary = dy;
            cross = Math.abs(dx);
            break;
          default:
            return false;
        }
        if (!ok) continue;
        if (horizontal && pass === 1 && cross > Math.max(a.height, b.height) * 0.6) continue;
        found.push({ el, primary, cross });
      }
      if (!found.length) continue;

      if (horizontal) {
        // Horizontal: el más cercano ponderando la desalineación vertical.
        let bestScore = Infinity;
        for (const f of found) {
          const score = f.primary + f.cross * 4;
          if (score < bestScore) {
            bestScore = score;
            best = f.el;
          }
        }
      } else {
        // Vertical: primero la fila (o columna) más cercana; dentro de ella,
        // el elemento más alineado con el actual. Así nunca se salta una fila.
        const nearest = Math.min(...found.map((f) => f.primary));
        const band = nearest + a.height * 0.5;
        let bestCross = Infinity;
        for (const f of found) {
          if (f.primary > band) continue;
          if (f.cross < bestCross) {
            bestCross = f.cross;
            best = f.el;
          }
        }
      }
      if (best) break;
    }

    if (!best) {
      this.bump(cur, dir);
      return false;
    }

    if (best.dataset.zone !== zone) {
      const target = this.#zoneTarget(best.dataset.zone, cands);
      if (target) best = target;
    }
    this.set(best);
    return true;
  }

  /** Pequeño "rebote" cuando no hay nada más en esa dirección. */
  bump(el, dir) {
    const cls = `bump-${dir}`;
    el.classList.remove(cls);
    // Fuerza reflow para poder reiniciar la animación.
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}
