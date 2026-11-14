/**
 * Consolas disponibles en la pantalla Emuladores.
 * `core` es el identificador de sistema de EmulatorJS (se descarga desde su CDN).
 */

export const CONSOLES = [
  {
    id: 'snes',
    name: 'Super Nintendo',
    short: 'SNES',
    maker: 'Nintendo · 1990',
    core: 'snes',
    engine: 'Snes9x',
    extensions: ['sfc', 'smc', 'fig', 'gd3', 'gd7', 'dx2', 'bsx', 'swc'],
    c1: '#6d28d9',
    c2: '#a78bfa',
    note: '',
  },
  {
    id: 'nes',
    name: 'Nintendo (NES)',
    short: 'NES',
    maker: 'Nintendo · 1983',
    core: 'nes',
    engine: 'FCEUmm',
    extensions: ['nes', 'unf', 'unif'],
    c1: '#b91c1c',
    c2: '#f87171',
    note: '',
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    short: 'N64',
    maker: 'Nintendo · 1996',
    core: 'n64',
    engine: 'Mupen64Plus-Next',
    extensions: ['z64', 'n64', 'v64'],
    c1: '#047857',
    c2: '#34d399',
    note: 'Nintendo 64 exige más rendimiento: funciona mejor en un equipo potente.',
  },
  {
    id: 'gb',
    name: 'Game Boy / Color',
    short: 'GB',
    maker: 'Nintendo · 1989',
    core: 'gb',
    engine: 'Gambatte',
    extensions: ['gb', 'gbc', 'sgb'],
    c1: '#4d7c0f',
    c2: '#bef264',
    note: 'Incluye juegos de Game Boy y Game Boy Color.',
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    short: 'GBA',
    maker: 'Nintendo · 2001',
    core: 'gba',
    engine: 'mGBA',
    extensions: ['gba'],
    c1: '#4338ca',
    c2: '#818cf8',
    note: '',
  },
];

export function getConsole(id) {
  return CONSOLES.find((item) => item.id === id) ?? null;
}

export function fileExtension(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/** ¿El nombre de archivo corresponde a una ROM de esta consola? */
export function isRomName(name, consoleId) {
  const info = getConsole(consoleId);
  return Boolean(info && info.extensions.includes(fileExtension(name)));
}
