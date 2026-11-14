/**
 * Contenido inicial de las bibliotecas. Aquí puedes agregar cosas editando el
 * archivo, o directamente desde la interfaz con el botón "+ Agregar"
 * (lo agregado desde la interfaz se guarda en el navegador).
 *
 * Campos:  title (obligatorio) · url (obligatorio) · category (fila donde aparece)
 *          image (opcional: póster/miniatura; en YouTube se usa la miniatura sola)
 *
 * url acepta:
 *   - YouTube: https://www.youtube.com/watch?v=XXXXXXXXXXX  (también listas y youtu.be)
 *   - Archivo de video: assets/movies/mi-pelicula.mp4  (.mp4 .webm .ogv .mov .mkv)
 *   - Reproductor web: la dirección del <iframe> que da el sitio en Compartir / Insertar / Embed
 *     (https://…/embed/…). También sirven enlaces de Vimeo, Dailymotion, Google Drive y Archive.org.
 *
 * En SERIES, cada serie es una fila: pon el nombre de la serie en `category` y un elemento por capítulo.
 */

export const YOUTUBE_DEFAULTS = [
  // { title: 'Mi video', url: 'https://www.youtube.com/watch?v=XXXXXXXXXXX', category: 'Favoritos' },
];

export const MOVIES_DEFAULTS = [
  // { title: 'Mi película', url: 'assets/movies/mi-pelicula.mp4', category: 'Acción', image: 'assets/movies/mi-pelicula.jpg' },
];

export const SERIES_DEFAULTS = [
  // { title: 'Capítulo 1', url: 'https://…/embed/…', category: 'Mi serie', image: 'https://…/poster.jpg' },
];
