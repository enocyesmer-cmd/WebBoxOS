/**
 * Datos de ejemplo del Launcher (Fase 1: sin aplicaciones reales todavía).
 */

export const APPS = [
  { id: 'youtube', name: 'YouTube', icon: 'youtube', c1: '#b91c1c', c2: '#f87171', screen: 'youtube' },
  { id: 'movies', name: 'Películas', icon: 'film', c1: '#7c2d12', c2: '#f59e0b', screen: 'movies' },
  { id: 'videos', name: 'Videos', icon: 'play', c1: '#ff5f6d', c2: '#ffa751' },
  { id: 'music', name: 'Música', icon: 'music', c1: '#7f5af0', c2: '#2cb1ff' },
  { id: 'photos', name: 'Fotos', icon: 'photo', c1: '#11998e', c2: '#7ee08f' },
  { id: 'browser', name: 'Navegador', icon: 'globe', c1: '#2563eb', c2: '#22d3ee' },
  { id: 'games', name: 'Juegos', icon: 'gamepad', c1: '#e11d74', c2: '#9333ea' },
  { id: 'tv', name: 'TV en vivo', icon: 'tv', c1: '#f59e0b', c2: '#ef4444' },
  { id: 'files', name: 'Archivos', icon: 'folder', c1: '#475569', c2: '#94a3b8' },
  { id: 'news', name: 'Noticias', icon: 'book', c1: '#0ea5e9', c2: '#6366f1' },
];

/** Orden de la fila "Aplicaciones favoritas" */
export const FAVORITES = ['youtube', 'movies', 'videos', 'music', 'photos', 'browser', 'games', 'tv', 'files'];

/** Recientes iniciales (después se actualizan al abrir aplicaciones) */
export const DEFAULT_RECENTS = ['browser', 'photos', 'music'];

/** Contenido de ejemplo para "Recomendado para ti" */
export const RECOMMENDED = [
  { id: 'rec-1', name: 'Noches de ciencia', subtitle: 'Documental · ejemplo', icon: 'rocket', c1: '#1e3a8a', c2: '#7c3aed' },
  { id: 'rec-2', name: 'Rutas de montaña', subtitle: 'Naturaleza · ejemplo', icon: 'mountain', c1: '#065f46', c2: '#34d399' },
  { id: 'rec-3', name: 'Cine clásico', subtitle: 'Película · ejemplo', icon: 'film', c1: '#7c2d12', c2: '#f59e0b' },
  { id: 'rec-4', name: 'Lista para concentrarse', subtitle: 'Música · ejemplo', icon: 'music', c1: '#312e81', c2: '#ec4899' },
  { id: 'rec-5', name: 'Torneo de la semana', subtitle: 'Juegos · ejemplo', icon: 'gamepad', c1: '#831843', c2: '#fb7185' },
  { id: 'rec-6', name: 'Recuerdos del verano', subtitle: 'Fotos · ejemplo', icon: 'photo', c1: '#0c4a6e', c2: '#38bdf8' },
];

/** Fondos disponibles (archivos en assets/backgrounds) */
export const BACKGROUNDS = [
  { id: 'aurora', name: 'Aurora', file: 'assets/backgrounds/aurora.svg' },
  { id: 'ocean', name: 'Océano', file: 'assets/backgrounds/ocean.svg' },
  { id: 'sunset', name: 'Atardecer', file: 'assets/backgrounds/sunset.svg' },
  { id: 'graphite', name: 'Grafito', file: 'assets/backgrounds/graphite.svg' },
];
