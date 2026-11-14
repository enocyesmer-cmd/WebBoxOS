/** Utilidades de interfaz compartidas. */

/** Escapa texto para insertarlo con seguridad en innerHTML. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Muestra un aviso breve en pantalla (máximo 3 a la vez). */
export function toast(message, ms = 2800) {
  const host = document.getElementById('toasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();

  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 700);
  }, ms);
}
