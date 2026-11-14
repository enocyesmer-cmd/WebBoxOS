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
const { isSnesRomName } = await import(`${ROOT}/games.js`);
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
const { parseMediaUrl, parseTimeParam, formatTime, youtubeThumb } = await import(`${ROOT}/core/media.js`);

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
await test('Juegos se abre como pantalla real desde el launcher', () => {
  assert.equal(APPS.find((app) => app.id === 'games')?.screen, 'games');
});

console.log(`\n${passed} pruebas correctas`);
