/** El mismo enlace ya existe en esa categoría de catálogo. */
export class DuplicateError extends Error {
  constructor() {
    super('Ese enlace ya está en el catálogo.');
    this.name = 'DuplicateError';
  }
}
