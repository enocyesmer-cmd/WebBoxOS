// Pruebas de lógica de WebBox OS con un DOM simulado mínimo.
import assert from 'node:assert/strict';

const ROOT = new URL('../js', import.meta.url).pathname;
let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FALLO  ${name}\n        ${e.message}`);
    process.exitCode = 1;
  }
};

// ---------- globals simulados
const winListeners = {};
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ??= []).push(fn); },
};
let navPads = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => navPads },
  configurable: true,
});

const { bus } = await import(`${ROOT}/core/events.js`);
const { config, DEFAULT_MAPPING } = await import(`${ROOT}/core/config.js`);
const { FocusManager } = await import(`${ROOT}/core/focus.js`);
const { GamepadManager, cleanPadName } = await import(`${ROOT}/input/gamepad.js`);
const { KeyboardInput } = await import(`${ROOT}/input/keyboard.js`);
const { isSnesRomName } = await import(`${ROOT}/emulators.js`);
const { CONSOLES, isRomName } = await import(`${ROOT}/data/consoles.js`);
const { APPS } = await import(`${ROOT}/data/apps.js`);

// ---------- elemento simulado
class FakeEl {
  constructor(fid, zone, x, y, w, h, cls = []) {
    this.dataset = { fid, zone };
    this.rect = { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
    this.cls = new Set(cls);
    this.classList = {
      add: (c) => this.cls.add(c),
      remove: (c) => this.cls.delete(c),
      contains: (c) => this.cls.has(c),
    };
    this.offsetWidth = 1;
  }
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return [this.rect]; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  scrollIntoView() {}
  focus() {}
  dispatchEvent() {}
  addEventListener() {}
  click() { this.clicked = true; }
  matches(sel) { return sel === `[data-zone="${this.dataset.zone}"]`; }
}

function buildHome() {
  const els = [];
  ['home', 'apps', 'settings'].forEach((n, i) =>
    els.push(new FakeEl(`nav:${n}`, 'nav', 10, 300 + i * 70, 60, 56, n === 'home' ? ['is-current'] : [])));
  for (let i = 0; i < 5; i += 1) els.push(new FakeEl(`fav:${i}`, 'main', 100 + i * 250, 100, 220, 140));
  for (let i = 0; i < 3; i += 1) els.push(new FakeEl(`recent:${i}`, 'main', 100 + i * 250, 300, 220, 140));
  for (let i = 0; i < 6; i += 1) els.push(new FakeEl(`rec:${i}`, 'main', 100 + i * 360, 520, 340, 190));
  const scope = { querySelectorAll: () => els, contains: () => true };
  return { els, fm: new FocusManager(scope) };
}
const fid = (fm) => fm.current?.dataset.fid;

console.log('Foco espacial');
await test('foco por defecto cae en la zona principal', () => {
  const { fm } = buildHome();
  fm.move('right');
  assert.equal(fid(fm), 'fav:0');
});
await test('derecha recorre la fila y se detiene al final', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  for (let i = 0; i < 10; i += 1) fm.move('right');
  assert.equal(fid(fm), 'fav:4');
  assert.equal(fm.move('right'), false);
});
await test('abajo desde la última tarjeta busca la más cercana de la fila siguiente', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  for (let i = 0; i < 4; i += 1) fm.move('right');
  fm.move('down');
  assert.equal(fid(fm), 'recent:2');
  fm.move('down');
  assert.ok(fid(fm).startsWith('rec:'), fid(fm));
});
await test('arriba en la primera fila no se mueve', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  assert.equal(fm.move('up'), false);
  assert.equal(fid(fm), 'fav:0');
});
await test('izquierda desde la primera tarjeta salta al menú (elemento actual)', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  fm.move('left');
  assert.equal(fid(fm), 'nav:home');
});
await test('derecha desde el menú vuelve a la última tarjeta enfocada', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  fm.move('right'); fm.move('down'); // fila 2
  let lastMain = fid(fm);
  for (let i = 0; i < 6 && fm.current.dataset.zone !== 'nav'; i += 1) {
    if (fm.current.dataset.zone === 'main') lastMain = fid(fm);
    fm.move('left');
  }
  assert.equal(fm.current.dataset.zone, 'nav');
  fm.move('right');
  assert.equal(fid(fm), lastMain);
});
await test('abajo en el menú se queda en el menú', () => {
  const { fm } = buildHome();
  fm.set(fm.candidates().find((e) => e.dataset.fid === 'nav:home'));
  fm.move('down');
  assert.equal(fid(fm), 'nav:apps');
  fm.move('down'); fm.move('down');
  assert.equal(fid(fm), 'nav:settings');
});
await test('solo un elemento tiene is-focused a la vez', () => {
  const { fm, els } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  for (const d of ['right', 'down', 'left', 'left', 'right', 'down']) fm.move(d);
  assert.equal(els.filter((e) => e.cls.has('is-focused')).length, 1);
});
await test('activate() hace click sobre el elemento enfocado', () => {
  const { fm } = buildHome();
  fm.focusFirst('[data-zone="main"]');
  fm.current.isConnected = true;
  fm.activate();
  assert.equal(fm.current.clicked, true);
});

console.log('Configuración');
await test('mapeo por defecto y por mando', () => {
  assert.deepEqual(config.getMapping('padX'), { ...DEFAULT_MAPPING });
  config.setMapping('padX', 'ok', [3]);
  assert.deepEqual(config.getMapping('padX').ok, [3]);
  assert.deepEqual(config.getMapping('padY').ok, [0]);
  config.resetMapping('padX');
  assert.deepEqual(config.getMapping('padX').ok, [0]);
});
await test('sensibilidad cambia el intervalo de repetición', () => {
  config.set('sensitivity', 1);
  const slow = config.repeatInterval();
  config.set('sensitivity', 5);
  assert.ok(config.repeatInterval() < slow);
  config.set('sensitivity', 3);
});

console.log('Mando (Gamepad API simulada)');
const mkPad = (over = {}) => ({
  index: 0, id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
  mapping: 'standard', connected: true,
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  axes: [0, 0, 0, 0],
  ...over,
});
const press = (pad, ...idx) => { idx.forEach((i) => { pad.buttons[i] = { pressed: true, value: 1 }; }); return pad; };

await test('nombre limpio del mando', () => {
  assert.equal(cleanPadName('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)'), 'Xbox 360 Controller');
});

const gm = new GamepadManager();
const actions = [];
const events = [];
bus.on('action', (a) => actions.push(a.action));
bus.on('gamepad:connect', (e) => events.push(`c:${e.name}`));
bus.on('gamepad:disconnect', (e) => events.push(`d:${e.name}`));

await test('detecta conexión', () => {
  navPads = [press(mkPad(), 0)]; // el navegador lo muestra tras pulsar un botón
  gm.poll(0);
  assert.deepEqual(events, ['c:Xbox 360 Controller']);
  assert.equal(gm.getPads().length, 1);
});
await test('el botón que "despierta" al mando no dispara acciones', () => {
  gm.poll(16); // sigue pulsado
  navPads = [mkPad()];
  gm.poll(32); // soltado
  assert.deepEqual(actions, []);
});
await test('botón mapeado dispara acción una vez y repite con retardo', () => {
  config.set('sensitivity', 3); // intervalo 150, retardo 360
  navPads = [press(mkPad(), 15)];
  gm.poll(100);
  assert.deepEqual(actions, ['right']);
  gm.poll(200); gm.poll(300);
  assert.deepEqual(actions, ['right']); // aún en retardo
  gm.poll(470);
  assert.deepEqual(actions, ['right', 'right']);
  gm.poll(500);
  assert.equal(actions.length, 2); // anti-rebote
  gm.poll(630);
  assert.equal(actions.length, 3);
});
await test('OK (botón 0) no se repite al mantenerlo', () => {
  actions.length = 0;
  navPads = [mkPad()]; gm.poll(700);
  navPads = [press(mkPad(), 0)];
  gm.poll(720); gm.poll(1200); gm.poll(2000);
  assert.deepEqual(actions, ['ok']);
});
await test('palanca con zona muerta', () => {
  actions.length = 0;
  navPads = [mkPad()]; gm.poll(2100);
  navPads = [mkPad({ axes: [0.3, 0, 0, 0] })]; gm.poll(2120);
  assert.deepEqual(actions, []);
  navPads = [mkPad({ axes: [0, 0.9, 0, 0] })]; gm.poll(2140);
  assert.deepEqual(actions, ['down']);
  navPads = [mkPad({ axes: [-0.8, 0.2, 0, 0] })]; gm.poll(2160);
  assert.deepEqual(actions, ['down', 'left']);
});
await test('Inicio (Start / Guía) y Atrás (B)', () => {
  actions.length = 0;
  navPads = [mkPad()]; gm.poll(3000);
  navPads = [press(mkPad(), 9)]; gm.poll(3020);
  navPads = [mkPad()]; gm.poll(3040);
  navPads = [press(mkPad(), 1)]; gm.poll(3060);
  assert.deepEqual(actions, ['home', 'back']);
});
await test('mapeo personalizado se respeta', () => {
  actions.length = 0;
  const id = mkPad().id;
  config.setMapping(id, 'ok', [5]);
  navPads = [mkPad()]; gm.poll(4000);
  navPads = [press(mkPad(), 0)]; gm.poll(4020);
  assert.deepEqual(actions, []); // el 0 ya no es OK
  navPads = [mkPad()]; gm.poll(4040);
  navPads = [press(mkPad(), 5)]; gm.poll(4060);
  assert.deepEqual(actions, ['ok']);
  config.resetMapping(id);
});
await test('modo captura asigna el botón y no navega', () => {
  actions.length = 0;
  navPads = [mkPad()]; gm.poll(5000);
  let got = null;
  gm.captureNext((b, pad) => { got = [b, pad.index]; });
  assert.equal(gm.capturing, true);
  navPads = [press(mkPad(), 7)]; gm.poll(5020);
  assert.deepEqual(got, [7, 0]);
  assert.equal(gm.capturing, false);
  assert.deepEqual(actions, []);
});
await test('modo prueba emite el estado de botones y ejes', () => {
  gm.setWatching(true);
  const frames = [];
  const off = bus.on('gamepad:frame', (f) => frames.push(f));
  navPads = [mkPad()]; gm.poll(6000);
  navPads = [press(mkPad({ axes: [0.5, -0.25, 0, 0] }), 3)]; gm.poll(6020);
  off(); gm.setWatching(false);
  const last = frames.at(-1)[0];
  assert.equal(last.buttons[3].pressed, true);
  assert.equal(last.buttons[2].pressed, false);
  assert.equal(last.axes[1], -0.25);
});
await test('detecta desconexión por polling', () => {
  navPads = [null];
  gm.poll(7000);
  assert.deepEqual(events.slice(-1), ['d:Xbox 360 Controller']);
  assert.equal(gm.getPads().length, 0);
});
await test('conectar de nuevo tras desconectar vuelve a suprimir el primer botón', () => {
  actions.length = 0;
  navPads = [press(mkPad(), 15)]; gm.poll(8000);
  assert.deepEqual(actions, []);
});

await test('modo prueba: el mando no navega; mantener Atrás 1 s emite back', () => {
  actions.length = 0;
  gm.testModeProvider = () => true;
  navPads = [mkPad()]; gm.poll(9000); gm.poll(9020);
  navPads = [press(mkPad(), 15)]; gm.poll(9100); gm.poll(9300); gm.poll(9700);
  assert.deepEqual(actions, []);
  navPads = [mkPad()]; gm.poll(9800);
  navPads = [press(mkPad(), 1)]; gm.poll(10000); gm.poll(10500);
  assert.deepEqual(actions, []);
  gm.poll(11050);
  assert.deepEqual(actions, ['back']);
  gm.poll(11100); gm.poll(12500); // sigue pulsado: no se repite
  assert.deepEqual(actions, ['back']);
  gm.testModeProvider = null;
});

console.log('Teclado');
const kb = new KeyboardInput();
kb.start();
const onKey = winListeners.keydown[0];
const key = (k, extra = {}) => {
  let prevented = false;
  onKey({ key: k, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {}, preventDefault() { prevented = true; }, ...extra });
  return prevented;
};
await test('flechas, Enter, Escape y H', () => {
  actions.length = 0;
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'h', 'Home']) key(k);
  assert.deepEqual(actions, ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'home']);
});
await test('teclas ajenas y combinaciones no se interceptan', () => {
  actions.length = 0;
  assert.equal(key('a'), false);
  assert.equal(key('r', { ctrlKey: true }), false);
  assert.equal(key('ArrowRight', { ctrlKey: true }), false);
  assert.deepEqual(actions, []);
});
await test('repetición del teclado limitada por sensibilidad; OK no se repite', async () => {
  actions.length = 0;
  config.set('sensitivity', 1); // 260 ms
  key('ArrowRight');
  for (let i = 0; i < 5; i += 1) key('ArrowRight', { repeat: true });
  assert.equal(actions.length, 1);
  key('Enter', { repeat: true });
  assert.equal(actions.length, 1);
  await new Promise((r) => setTimeout(r, 290));
  key('ArrowRight', { repeat: true });
  assert.equal(actions.length, 2);
  config.set('sensitivity', 3);
});

// ---------- enlaces de video (YouTube / Películas)
const { parseMediaUrl, parseTimeParam, formatTime, youtubeThumb, parsePlayable, parseWebPlayer, splitLinks, extractIframeSources } = await import(`${ROOT}/core/media.js`);

await test('media: enlaces de YouTube (watch, youtu.be, shorts, embed, ID suelto)', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [
    `https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`, id,
  ]) assert.equal(parseMediaUrl(u)?.videoId, id, u);
});
await test('media: listas, tiempo de inicio y miniatura', () => {
  const l = parseMediaUrl('https://www.youtube.com/playlist?list=PL1234567890abc');
  assert.deepEqual([l.type, l.videoId, l.listId], ['youtube', null, 'PL1234567890abc']);
  assert.equal(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s').start, 90);
  assert.equal(parseTimeParam('1h2m3s'), 3723);
  assert.match(youtubeThumb(parseMediaUrl('dQw4w9WgXcQ')), /dQw4w9WgXcQ\/hqdefault/);
  assert.equal(youtubeThumb(l), null);
});
await test('media: archivos de video locales/remotos y enlaces inválidos', () => {
  assert.deepEqual(parseMediaUrl('assets/movies/mi peli.mp4'), { type: 'video', src: 'assets/movies/mi%20peli.mp4' });
  assert.equal(parseMediaUrl('https://x.com/a.webm').type, 'video');
  for (const bad of ['', 'hola', 'https://youtube.com/watch?v=corto', 'https://example.com/pagina', 'javascript:alert(1)', 'file:///a.mp4'])
    assert.equal(parseMediaUrl(bad), null, bad);
});
await test('media: reproductor web — enlaces y código <iframe> (Películas y Series)', () => {
  // Cualquier enlace http(s) que no sea YouTube ni video directo se incrusta.
  assert.deepEqual(parsePlayable('https://reproductor.example.com/embed/abc'), { type: 'embed', src: 'https://reproductor.example.com/embed/abc', host: 'reproductor.example.com' });
  // Código <iframe> pegado: se toma su src (también //host/ruta y &amp;).
  const code = '<iframe width="560" src="//player.example.net/e/xyz?a=1&amp;b=2" frameborder="0" allowfullscreen></iframe>';
  assert.deepEqual(extractIframeSources(code), ['https://player.example.net/e/xyz?a=1&b=2']);
  assert.equal(parsePlayable(code).src, 'https://player.example.net/e/xyz?a=1&b=2');
  assert.equal(parsePlayable(code).host, 'player.example.net');
  // Un iframe de YouTube se reproduce con el reproductor de YouTube, no como web.
  assert.equal(parsePlayable('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>').type, 'youtube');
  assert.equal(parsePlayable('https://x.com/a.mp4').type, 'video');
  // Servicios con versión "para incrustar".
  assert.equal(parseWebPlayer('https://vimeo.com/123456').src, 'https://player.vimeo.com/video/123456');
  assert.equal(parseWebPlayer('https://www.dailymotion.com/video/x8abc').src, 'https://www.dailymotion.com/embed/video/x8abc');
  assert.equal(parseWebPlayer('https://drive.google.com/file/d/ID123/view?usp=sharing').src, 'https://drive.google.com/file/d/ID123/preview');
  assert.equal(parseWebPlayer('https://archive.org/details/mi-pelicula').src, 'https://archive.org/embed/mi-pelicula');
  // Lo estricto sigue estricto: YouTube y Música no aceptan páginas web.
  assert.equal(parseMediaUrl('https://example.com/pagina'), null);
  for (const bad of ['', 'hola', 'javascript:alert(1)', 'file:///a.mp4', 'data:text/html,hi', 'https://user:pw@a.com/x', 'http://localhost/x', 'assets/movies/x'])
    assert.equal(parsePlayable(bad), null, bad);
});
await test('media: pegar varios capítulos (espacios, comas, líneas unidas) o varios <iframe>', () => {
  assert.deepEqual(splitLinks('https://a.com/1 https://a.com/2,https://a.com/3'), ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  assert.deepEqual(splitLinks('https://a.com/1https://a.com/2'), ['https://a.com/1', 'https://a.com/2']); // salto de línea perdido al pegar
  assert.deepEqual(splitLinks('<iframe src="https://a.com/e1"></iframe>\n<iframe src=\'https://a.com/e2\'></iframe>'), ['https://a.com/e1', 'https://a.com/e2']);
  assert.deepEqual(splitLinks('   '), []);
});
await test('media: formato de tiempo', () => {
  assert.equal(formatTime(83), '1:23');
  assert.equal(formatTime(3700), '1:01:40');
  assert.equal(formatTime(NaN), '0:00');
});

console.log('Biblioteca SNES');
await test('acepta extensiones habituales de ROM SNES sin distinguir mayúsculas', () => {
  for (const name of ['juego.sfc', 'JUEGO.SMC', 'demo.fig', 'bsx.gd3', 'cartucho.gd7', 'extra.dx2', 'sufami.bsx', 'copia.swc']) {
    assert.equal(isSnesRomName(name), true, name);
  }
});
await test('rechaza archivos que no son ROM SNES', () => {
  for (const name of ['juego.nes', 'video.mp4', 'juego.zip', 'sin-extension', '.hidden']) {
    assert.equal(isSnesRomName(name), false, name);
  }
});
await test('Emuladores ofrece SNES, NES, N64, Game Boy y GBA', () => {
  assert.deepEqual(CONSOLES.map((c) => c.id), ['snes', 'nes', 'n64', 'gb', 'gba']);
});
await test('cada consola reconoce solo sus extensiones de ROM', () => {
  const casos = { snes: 'a.sfc', nes: 'a.NES', n64: 'a.z64', gb: 'a.gbc', gba: 'a.gba' };
  for (const [id, nombre] of Object.entries(casos)) {
    for (const otra of CONSOLES) assert.equal(isRomName(nombre, otra.id), otra.id === id, `${nombre} en ${otra.id}`);
  }
});
await test('la casilla de Aplicaciones abre Emuladores', () => {
  assert.equal(APPS.find((app) => app.id === 'games')?.screen, 'emulators');
});


// ---------- Apps instaladas: ZIP, manifiesto y documento
const { deflateRawSync } = await import('node:zlib');
const { readZipDirectory, extractEntry, safePath, crc32 } = await import(`${ROOT}/core/zip.js`);
const { validateManifest, findPackageRoot, readPackage, slugify, mimeFor, lighten } = await import(`${ROOT}/appRuntime.js`);
const { resolveRef, shimSource } = await import(`${ROOT}/core/appDoc.js`);

/** Crea un ZIP en memoria: files = [{name, data, store?}] */
function makeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const raw = Buffer.from(f.data);
    const body = f.store ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(f.store ? 0 : 8, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(f.store ? 0 : 8, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}
const text = (bytes) => new TextDecoder().decode(bytes);
const goodApp = (extra = []) => [
  { name: 'app.json', data: JSON.stringify({ id: 'mi-juego', name: 'Mi juego', version: '1.2', color: '#1e3a8a', permissions: ['storage', 'input'] }) },
  { name: 'index.html', data: '<!doctype html><title>x</title>' },
  { name: 'js/main.js', data: 'console.log("hola".repeat(500))' },
  ...extra,
];

await test('zip: rutas seguras (sin "..", sin absolutas, sin unidades)', () => {
  assert.equal(safePath('a/b/../c.js'), null);
  assert.equal(safePath('../x'), null);
  assert.equal(safePath('/etc/passwd'), null);
  assert.equal(safePath('C:\\x.txt'), null);
  assert.equal(safePath('a\\b\\c.js'), 'a/b/c.js');
  assert.equal(safePath('./a//b.js'), 'a/b.js');
  assert.equal(safePath(''), null);
});
await test('zip: lee archivos almacenados y comprimidos y verifica el CRC', async () => {
  const zip = makeZip([{ name: 'a.txt', data: 'hola mundo', store: true }, { name: 'dir/b.txt', data: 'x'.repeat(2000) }]);
  const entries = readZipDirectory(zip);
  assert.deepEqual(entries.map((e) => e.path), ['a.txt', 'dir/b.txt']);
  assert.equal(text(await extractEntry(zip, entries[0])), 'hola mundo');
  assert.equal(text(await extractEntry(zip, entries[1])), 'x'.repeat(2000));
  const bad = zip.slice();
  bad[entries[0].offset + 30 + 5] ^= 0xff; // corrompe un byte del contenido
  await assert.rejects(() => extractEntry(bad, entries[0]), /verificación|dañado/);
});
await test('zip: rechaza basura, cifrados y bombas de compresión', async () => {
  assert.throws(() => readZipDirectory(new Uint8Array(100)), /ZIP/);
  const enc = makeZip([{ name: 'a.txt', data: 'x', store: true }]);
  const dv = new DataView(enc.buffer);
  const cdOff = dv.getUint32(enc.length - 22 + 16, true);
  dv.setUint16(cdOff + 8, 1, true); // bit de cifrado
  assert.throws(() => readZipDirectory(enc), /cifrado/);
  const bomb = makeZip([{ name: 'b.txt', data: 'a'.repeat(100000) }]);
  const e = readZipDirectory(bomb)[0];
  await assert.rejects(() => extractEntry(bomb, { ...e, size: 10 }), /más grande|tamaño/);
});
await test('manifiesto: acepta uno válido y completa valores por defecto', () => {
  const r = validateManifest({ name: 'Mi App' }, new Set(['index.html']));
  assert.equal(r.ok, true);
  assert.deepEqual([r.manifest.id, r.manifest.entry, r.manifest.input, r.manifest.permissions], ['mi-app', 'index.html', 'launcher', ['storage']]);
});
await test('manifiesto: rechaza id, entrada, icono, color y permisos inválidos', () => {
  const files = new Set(['index.html', 'icon.png']);
  const base = { name: 'X', id: 'ok-app' };
  for (const bad of [
    { id: 'Mayúsculas' }, { id: 'a' }, { entry: '../index.html' }, { entry: 'nada.html' }, { entry: 'main.js' },
    { icon: 'otra.png' }, { icon: 'index.html' }, { color: 'rojo' }, { permissions: ['camara'] }, { permissions: 'storage' }, { input: 'x' }, { name: 'x'.repeat(41) },
  ]) assert.equal(validateManifest({ ...base, ...bad }, files).ok, false, JSON.stringify(bad));
  assert.equal(validateManifest({ ...base, icon: 'icon.png', color: '#aabbcc' }, files).ok, true);
});
await test('paquete: busca app.json, index.html o la web de un APK (Cordova/Capacitor)', () => {
  assert.deepEqual(findPackageRoot(['app.json', 'index.html']), { ok: true, root: '', kind: 'manifest' });
  assert.deepEqual(findPackageRoot(['mi/app.json', 'mi/index.html', 'mi/x.js']), { ok: true, root: 'mi', kind: 'manifest' });
  assert.deepEqual(findPackageRoot(['carpeta/index.html']), { ok: true, root: 'carpeta', kind: 'index' });
  assert.equal(findPackageRoot(['a/b/c/index.html']).ok, false);
  assert.deepEqual(findPackageRoot(['AndroidManifest.xml', 'assets/www/index.html', 'classes.dex'], 'x.apk'), { ok: true, root: 'assets/www', kind: 'apk-web' });
  const native = findPackageRoot(['AndroidManifest.xml', 'classes.dex', 'lib/arm64/libgame.so'], 'juego.apk');
  assert.equal(native.ok, false);
  assert.match(native.error, /nativa/);
});
await test('paquete: instala un ZIP completo (con subcarpeta y basura de macOS) y devuelve sus archivos', async () => {
  const zip = makeZip([
    ...goodApp().map((f) => ({ ...f, name: `mi-juego/${f.name}` })),
    { name: '__MACOSX/mi-juego/._index.html', data: 'basura' },
    { name: 'mi-juego/.DS_Store', data: 'x' },
  ]);
  const pkg = await readPackage(zip, 'mi-juego.zip');
  assert.equal(pkg.manifest.id, 'mi-juego');
  assert.equal(pkg.manifest.name, 'Mi juego');
  assert.deepEqual([...pkg.files.keys()].sort(), ['app.json', 'index.html', 'js/main.js']);
  assert.equal(text(pkg.files.get('index.html')), '<!doctype html><title>x</title>');
});
await test('paquete: un ZIP sin app.json se instala con el nombre del archivo; los inválidos explican el error', async () => {
  const pkg = await readPackage(makeZip([{ name: 'index.html', data: '<p>hi</p>' }]), 'Calculadora Pro.zip');
  assert.deepEqual([pkg.manifest.id, pkg.manifest.name, pkg.source], ['calculadora-pro', 'Calculadora Pro', 'index']);
  await assert.rejects(() => readPackage(makeZip([{ name: 'leeme.txt', data: 'x' }]), 'a.zip'), /app\.json ni index\.html/);
  await assert.rejects(() => readPackage(makeZip([{ name: 'app.json', data: '{no json' }, { name: 'index.html', data: 'x' }]), 'a.zip'), /JSON/);
  await assert.rejects(() => readPackage(makeZip([{ name: 'app.json', data: '{"id":"x","name":"X"}' }, { name: 'index.html', data: 'x' }]), 'a.zip'), /id/);
});
await test('apps: id por nombre, mime, y mezcla de color', () => {
  assert.equal(slugify('Mi Súper Juego!'), 'mi-super-juego');
  assert.equal(mimeFor('a/b.JS'), 'text/javascript');
  assert.equal(mimeFor('x.desconocido'), 'application/octet-stream');
  assert.equal(lighten('#000000', 0.5), '#808080');
});
await test('apps: rutas del HTML se resuelven dentro del paquete y las externas se ignoran', () => {
  assert.equal(resolveRef('css/a.css', ''), 'css/a.css');
  assert.equal(resolveRef('../img/x.png', 'pages'), 'img/x.png');
  assert.equal(resolveRef('/img/x.png?v=2#a', 'pages'), 'img/x.png');
  assert.equal(resolveRef('mi%20foto.png', 'a'), 'a/mi foto.png');
  assert.equal(resolveRef('../../fuera.png', 'a'), null);
  for (const ext of ['https://x.com/a.js', '//cdn.x.com/a.js', 'data:image/png;base64,AAA', 'blob:http://x/1', '#ancla', 'javascript:alert(1)']) assert.equal(resolveRef(ext), null, ext);
});
await test('apps: el script inyectado es JavaScript válido y no puede cerrar su <script>', () => {
  const src = shimSource({ id: 'x', name: '</script><b>', data: { k: '</script>' }, files: {}, all: {}, base: '', persist: true, input: 'launcher' });
  assert.doesNotThrow(() => new Function(src));
  assert.ok(!src.includes('</script>'));
});

console.log(`\n${passed} pruebas correctas`);
