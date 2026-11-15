/**
 * Fuentes de letra disponibles en Configuración > Fuente.
 *
 * Las que traen `google` se descargan de Google Fonts solo cuando se eligen (o al abrir la
 * pestaña Fuente para verlas). Sin Internet se usa la alternativa de `stack` y todo sigue
 * funcionando. "Predeterminada" y "Sistema" no descargan nada.
 */
export const FONT_GROUPS = [
  { id: 'base', label: 'Lectura cómoda' },
  { id: 'carta', label: 'Letra de carta (caligráficas y manuscritas)' },
  { id: 'elegante', label: 'Elegantes con serifa' },
  { id: 'otras', label: 'Otras' },
];

const sans = 'system-ui, "Segoe UI", Roboto, sans-serif';
const serif = 'Georgia, "Times New Roman", serif';
const script = '"Segoe Script", "Brush Script MT", cursive';

export const FONTS = [
  { id: 'inter', group: 'base', name: 'Predeterminada', stack: `Inter, "Segoe UI", Roboto, "Helvetica Neue", ${sans}` },
  { id: 'system', group: 'base', name: 'Sistema', stack: sans },
  { id: 'poppins', group: 'base', name: 'Poppins', google: 'Poppins:wght@400;600;700', stack: `Poppins, ${sans}` },
  { id: 'nunito', group: 'base', name: 'Nunito (redondeada)', google: 'Nunito:wght@400;600;800', stack: `Nunito, ${sans}` },
  { id: 'montserrat', group: 'base', name: 'Montserrat', google: 'Montserrat:wght@400;600;700', stack: `Montserrat, ${sans}` },
  { id: 'atkinson', group: 'base', name: 'Atkinson (muy legible)', google: 'Atkinson+Hyperlegible:wght@400;700', stack: `"Atkinson Hyperlegible", ${sans}` },

  { id: 'dancing', group: 'carta', name: 'Dancing Script', google: 'Dancing+Script:wght@400;700', stack: `"Dancing Script", ${script}` },
  { id: 'greatvibes', group: 'carta', name: 'Great Vibes', google: 'Great+Vibes', stack: `"Great Vibes", ${script}` },
  { id: 'parisienne', group: 'carta', name: 'Parisienne', google: 'Parisienne', stack: `Parisienne, ${script}` },
  { id: 'allura', group: 'carta', name: 'Allura', google: 'Allura', stack: `Allura, ${script}` },
  { id: 'alexbrush', group: 'carta', name: 'Alex Brush', google: 'Alex+Brush', stack: `"Alex Brush", ${script}` },
  { id: 'sacramento', group: 'carta', name: 'Sacramento', google: 'Sacramento', stack: `Sacramento, ${script}` },
  { id: 'satisfy', group: 'carta', name: 'Satisfy', google: 'Satisfy', stack: `Satisfy, ${script}` },
  { id: 'pacifico', group: 'carta', name: 'Pacifico', google: 'Pacifico', stack: `Pacifico, ${script}` },
  { id: 'caveat', group: 'carta', name: 'Caveat (a mano)', google: 'Caveat:wght@400;700', stack: `Caveat, ${script}` },
  { id: 'homemade', group: 'carta', name: 'Homemade Apple (pluma)', google: 'Homemade+Apple', stack: `"Homemade Apple", ${script}` },

  { id: 'playfair', group: 'elegante', name: 'Playfair Display', google: 'Playfair+Display:wght@400;700', stack: `"Playfair Display", ${serif}` },
  { id: 'cormorant', group: 'elegante', name: 'Cormorant Garamond', google: 'Cormorant+Garamond:wght@400;600;700', stack: `"Cormorant Garamond", ${serif}` },
  { id: 'cinzel', group: 'elegante', name: 'Cinzel (romana)', google: 'Cinzel:wght@400;700', stack: `Cinzel, ${serif}` },
  { id: 'lora', group: 'elegante', name: 'Lora', google: 'Lora:wght@400;600;700', stack: `Lora, ${serif}` },
  { id: 'georgia', group: 'elegante', name: 'Georgia (sistema)', stack: serif },

  { id: 'lobster', group: 'otras', name: 'Lobster', google: 'Lobster', stack: `Lobster, ${script}` },
  { id: 'bebas', group: 'otras', name: 'Bebas Neue (cine)', google: 'Bebas+Neue', stack: `"Bebas Neue", Impact, ${sans}` },
  { id: 'jetbrains', group: 'otras', name: 'JetBrains Mono', google: 'JetBrains+Mono:wght@400;700', stack: `"JetBrains Mono", Consolas, monospace` },
];

export const FONT_BY_ID = new Map(FONTS.map((f) => [f.id, f]));
export const DEFAULT_FONT = 'inter';

/** Fuente por id; si no existe, la predeterminada. */
export const fontById = (id) => FONT_BY_ID.get(id) ?? FONT_BY_ID.get(DEFAULT_FONT);

/** URL de Google Fonts para un conjunto de fuentes (null si ninguna la necesita). */
export function googleFontsUrl(fonts) {
  const families = [...new Set(fonts.map((f) => f?.google).filter(Boolean))];
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
}

const loaded = new Set();

/** Inserta (una sola vez por URL) la hoja de estilos de Google Fonts. Sin red no pasa nada. */
export function loadFonts(fonts) {
  const url = googleFontsUrl(fonts);
  if (!url || loaded.has(url) || typeof document === 'undefined') return;
  loaded.add(url);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.webboxFont = '1';
  document.head.appendChild(link);
}
