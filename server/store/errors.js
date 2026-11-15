/** El mismo enlace ya existe en esa categoría de catálogo. */
export class DuplicateError extends Error {
  constructor(message = 'Ese enlace ya está en el catálogo.') {
    super(message);
    this.name = 'DuplicateError';
  }
}
