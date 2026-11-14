/** Utilidades de imagen: convierte una foto elegida por el usuario en un icono cuadrado y ligero. */

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

/** Recorta al centro (cover) y reduce a `size`×`size`. Devuelve una URL de datos (WebP o PNG). */
export async function toIconDataUrl(file, size = 256) {
  if (!(file instanceof Blob) || !String(file.type).startsWith('image/')) {
    throw new Error('Elige un archivo de imagen (JPG, PNG, WEBP, GIF, SVG…).');
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen supera el límite de 12 MB.');

  const img = await loadImage(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('La imagen no tiene dimensiones válidas.');

  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);

  const webp = canvas.toDataURL('image/webp', 0.88);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
