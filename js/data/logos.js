/**
 * Logotipos a color de las aplicaciones (SVG propio, viewBox 48x48).
 * YouTube usa su forma reconocible (rectángulo rojo con triángulo blanco).
 * Cualquier aplicación sin logo aquí usa el icono de trazo por defecto.
 */
export const LOGOS = {
  youtube:
    '<rect x="3" y="10" width="42" height="28" rx="9" fill="#ff0000"/><path d="M20 17.5v13l11-6.5z" fill="#fff"/>',
  movies:
    '<rect x="5" y="7" width="38" height="34" rx="6" fill="#f59e0b"/><g fill="#fff"><rect x="8" y="10" width="4" height="4" rx="1"/><rect x="8" y="18" width="4" height="4" rx="1"/><rect x="8" y="26" width="4" height="4" rx="1"/><rect x="8" y="34" width="4" height="4" rx="1"/><rect x="36" y="10" width="4" height="4" rx="1"/><rect x="36" y="18" width="4" height="4" rx="1"/><rect x="36" y="26" width="4" height="4" rx="1"/><rect x="36" y="34" width="4" height="4" rx="1"/></g><path d="M20 17v14l11-7z" fill="#7c2d12"/>',
  videos:
    '<circle cx="24" cy="24" r="20" fill="#ff5f6d"/><circle cx="24" cy="24" r="20" fill="url(#g-videos)"/><path d="M19.500 15.500v17l14-8.500z" fill="#fff"/><defs><linearGradient id="g-videos" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f6d"/><stop offset="1" stop-color="#ffa751"/></linearGradient></defs>',
  music:
    '<circle cx="24" cy="24" r="20" fill="url(#g-music)"/><path d="M20 31.500V16.500l11-2.500v14" fill="none" stroke="#fff" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="32" r="3.600" fill="#fff"/><circle cx="28" cy="29" r="3.600" fill="#fff"/><defs><linearGradient id="g-music" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7f5af0"/><stop offset="1" stop-color="#2cb1ff"/></linearGradient></defs>',
  photos:
    '<g opacity=".92"><ellipse cx="24" cy="13" rx="7" ry="11" fill="#ea4335"/><ellipse cx="35" cy="24" rx="11" ry="7" fill="#fbbc04"/><ellipse cx="24" cy="35" rx="7" ry="11" fill="#34a853"/><ellipse cx="13" cy="24" rx="11" ry="7" fill="#4285f4"/></g>',
  browser:
    '<circle cx="24" cy="24" r="20" fill="#2563eb"/><g fill="none" stroke="#fff" stroke-width="2.200" stroke-linecap="round"><circle cx="24" cy="24" r="13"/><path d="M11 24h26M24 11c5 5 5 21 0 26M24 11c-5 5-5 21 0 26"/></g>',
  games:
    '<path d="M14 15h20a9 9 0 0 1 8.700 11.300l-1.500 6a4.800 4.800 0 0 1-8.400 1.700L30 29H18l-2.800 5a4.800 4.800 0 0 1-8.400-1.700l-1.500-6A9 9 0 0 1 14 15z" fill="url(#g-games)"/><path d="M16 20v8M12 24h8" stroke="#fff" stroke-width="2.600" stroke-linecap="round"/><circle cx="31" cy="22" r="2" fill="#fff"/><circle cx="36" cy="26" r="2" fill="#fff"/><defs><linearGradient id="g-games" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e11d74"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs>',
  tv:
    '<rect x="4" y="9" width="40" height="26" rx="5" fill="#ef4444"/><rect x="8" y="13" width="32" height="18" rx="2.500" fill="#fde68a"/><path d="M15 41h18M24 35v6" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>',
  files:
    '<path d="M4 13a4 4 0 0 1 4-4h11l4 5h17a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#fbbf24"/><path d="M4 20h40v15a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#f59e0b"/>',
  news:
    '<rect x="6" y="6" width="36" height="36" rx="7" fill="#0ea5e9"/><rect x="11" y="12" width="14" height="10" rx="2" fill="#fff"/><path d="M29 13h8M29 18h8M11 28h26M11 34h19" stroke="#fff" stroke-width="2.600" stroke-linecap="round"/>',
};

/** Marcado SVG del logo de una aplicación, o '' si no tiene. */
export function logo(id, cls = '') {
  const body = LOGOS[id];
  if (!body) return '';
  return `<svg class="logo ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>`;
}
