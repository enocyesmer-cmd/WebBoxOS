/**
 * Lector de ZIP sin dependencias (usa DecompressionStream del navegador).
 * Soporta archivos almacenados (método 0) y comprimidos con deflate (método 8).
 * No soporta ZIP64 ni cifrado: se rechazan con un mensaje claro.
 *
 * Seguridad: los nombres se normalizan (sin "..", sin rutas absolutas) y la descompresión
 * se corta si un archivo crece más de lo que declara su cabecera (bombas de compresión).
 */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export const ZIP_LIMITS = {
  entries: 3000,
  fileBytes: 60 * 1024 * 1024, // por archivo
  totalBytes: 250 * 1024 * 1024, // todo el paquete descomprimido
};

/** Ruta limpia dentro del paquete, o null si no es segura. */
export function safePath(name) {
  const text = String(name ?? '').replace(/\\/g, '/');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(text) || /^[a-zA-Z]:/.test(text) || text.startsWith('/')) return null;
  const parts = [];
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const toBytes = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

/**
 * Lista los archivos del ZIP (sin descomprimir nada todavía).
 * @returns {{name:string, path:string|null, size:number, packed:number, method:number, crc:number, offset:number, isDir:boolean}[]}
 */
export function readZipDirectory(buffer) {
  const bytes = toBytes(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('El archivo no es un ZIP válido.');

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido (o está dañado).');

  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  let pos = view.getUint32(eocd + 16, true);
  if (count === 0xffff || pos === 0xffffffff || dirSize === 0xffffffff) {
    throw new Error('Este ZIP usa ZIP64 (demasiado grande); no es compatible.');
  }
  if (count > ZIP_LIMITS.entries) throw new Error(`El paquete tiene demasiados archivos (máximo ${ZIP_LIMITS.entries}).`);

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== SIG_CENTRAL) throw new Error('El índice del ZIP está dañado.');
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const packed = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (flags & 1) throw new Error('El ZIP está cifrado con contraseña; no es compatible.');
    const isDir = name.endsWith('/');
    entries.push({ name, path: isDir ? null : safePath(name), size, packed, method, crc, offset, isDir });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data, expected) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir ZIP (actualízalo).');
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected) {
      await reader.cancel();
      throw new Error('Un archivo del ZIP es más grande de lo que declara (paquete sospechoso).');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Descomprime un archivo del ZIP y comprueba su CRC. */
export async function extractEntry(buffer, entry) {
  const bytes = toBytes(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.size > ZIP_LIMITS.fileBytes) throw new Error(`"${entry.name}" es demasiado grande (máximo ${Math.round(ZIP_LIMITS.fileBytes / 1048576)} MB).`);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== SIG_LOCAL) throw new Error('El ZIP está dañado.');
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.packed);
  let out;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) out = await inflateRaw(data, entry.size);
  else throw new Error(`Método de compresión no compatible (${entry.method}) en "${entry.name}".`);
  if (out.length !== entry.size) throw new Error(`"${entry.name}" no tiene el tamaño esperado (ZIP dañado).`);
  if (crc32(out) !== entry.crc) throw new Error(`"${entry.name}" no pasa la verificación (ZIP dañado).`);
  return out;
}
