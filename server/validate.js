/**
 * Validación de los elementos del catálogo (función pura, fácil de probar).
 * El servidor NO confía en el navegador: vuelve a comprobar todo.
 */
export const KINDS = ['youtube', 'music', 'movies', 'series'];

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const YOUTUBE_ID = /^[\w-]{11}$/;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv)$/i;

const LIMITS = { title: 120, url: 2048, category: 40, image: 2048, artist: 80 };

/** http(s) sin usuario ni contraseña incrustados. */
export function isHttpUrl(text) {
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Ruta relativa dentro del proyecto (assets/movies/x.mp4). Sin esquema, sin "..". */
export function isRelativePath(text) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false; // javascript:, data:, file:...
  if (text.startsWith('/') || text.includes('\\')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    return false;
  }
  if (CONTROL_CHARS.test(decoded)) return false;
  return !decoded.split('/').some((part) => part === '..' || part === '.');
}

function text(value, field, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return { error: `El campo "${field}" debe ser texto.` };
  const clean = value.trim();
  if (required && !clean) return { error: `Falta el campo "${field}".` };
  if (clean.length > LIMITS[field]) {
    return { error: `El campo "${field}" admite como máximo ${LIMITS[field]} caracteres.` };
  }
  if (CONTROL_CHARS.test(clean)) return { error: `El campo "${field}" tiene caracteres no permitidos.` };
  return { value: clean };
}

/**
 * @param {unknown} body
 * @returns {{ok:true, value:{kind:string,title:string,url:string,category:string,image:string,artist:string}}
 *          |{ok:false, error:string}}
 */
export function validateItem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'El cuerpo debe ser un objeto JSON.' };
  }
  if (!KINDS.includes(body.kind)) {
    return { ok: false, error: `"kind" debe ser uno de: ${KINDS.join(', ')}.` };
  }

  const out = { kind: body.kind };
  for (const field of ['title', 'url', 'category', 'image', 'artist']) {
    const r = text(body[field], field, { required: field === 'title' || field === 'url' });
    if (r.error) return { ok: false, error: r.error };
    out[field] = r.value;
  }

  const { url, image } = out;
  const urlOk =
    isHttpUrl(url) ||
    YOUTUBE_ID.test(url) ||
    ((out.kind === 'movies' || out.kind === 'series') && isRelativePath(url) && VIDEO_EXT.test(url.split(/[?#]/)[0]));
  if (!urlOk) {
    return {
      ok: false,
      error: 'El enlace debe ser http(s), un ID de YouTube o (en películas y series) una ruta relativa a un video.',
    };
  }
  if (image && !isHttpUrl(image) && !isRelativePath(image)) {
    return { ok: false, error: 'La imagen debe ser un enlace http(s) o una ruta relativa.' };
  }
  return { ok: true, value: out };
}
