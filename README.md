# WebBox OS — Launcher + control remoto + YouTube + Películas

Launcher estilo Android TV / Google TV que corre en el navegador, sin frameworks ni dependencias.

## Ejecutar

Necesita un servidor HTTP local (los módulos ES no cargan con `file://`). Desde esta carpeta:

    python3 -m http.server 8080      # o: npx serve .

Abre http://localhost:8080 (localhost cuenta como contexto seguro). Para usarlo en una
Smart TV o en otro equipo, abre `http://IP-DEL-PC:8080` en su navegador; algunos navegadores
exigen HTTPS para ciertas funciones fuera de localhost.

## Conectar un mando Bluetooth

1. Pon el mando en modo emparejamiento y vincúlalo en los ajustes Bluetooth del sistema.
2. Con WebBox OS abierto y en primer plano, **pulsa cualquier botón del mando**
   (el navegador no lo expone hasta esa primera pulsación; ese botón no activa nada).
3. Arriba a la derecha aparece su nombre y un aviso "Mando conectado".
4. Si los botones no hacen lo esperado: Configuración > Prueba de botones para ver qué
   números envía, y Configuración > Mando para reasignar cada acción.

## Controles

| Acción   | Teclado               | Mando (layout estándar)  |
|----------|-----------------------|--------------------------|
| Mover    | Flechas               | Cruceta o palanca izq.   |
| OK       | Enter / Espacio       | A (botón 0)              |
| Atrás    | Esc / Retroceso       | B (botón 1)              |
| Inicio   | H / Inicio            | Start (9) o Guía (16)    |

El mouse también funciona (pasar el puntero enfoca, clic selecciona).
Los controles remotos que se comportan como teclado funcionan por la columna de teclado.

## Estructura

    index.html            estructura y pantallas
    css/                  main · launcher · navigation · settings
    js/main.js            arranque, router, overlay, reloj
    js/core/              events (bus) · storage · config · focus (foco central)
    js/input/             keyboard · gamepad (Gamepad API, mapeo, anti-rebote)
    js/launcher.js        filas y tarjetas
    js/settings.js        configuración y prueba de botones
    js/data/apps.js       datos de ejemplo y fondos
    assets/               icono y fondos SVG
    tests/                pruebas de lógica (node tests/logica.test.mjs)

## Pruebas

    node tests/logica.test.mjs

Cubre foco espacial, mapeo, repetición, zona muerta, captura de botón, conexión y
desconexión y teclado con un DOM/Gamepad simulados. La parte visual hay que revisarla
en un navegador real.

## YouTube y Películas

Dos pantallas nuevas en el menú lateral (y en "Aplicaciones favoritas"). Cada una es una
biblioteca de tarjetas por categoría con un botón **+ Agregar** (se navega con mando/teclado;
OK sobre un campo abre el teclado del sistema).

- **YouTube**: reproduce videos y listas dentro de WebBox OS con el reproductor oficial
  incrustado y controles propios (pausa, ±10 s, sonido, pantalla completa, siguiente/anterior
  en listas). YouTube no permite incrustar su sitio completo, así que no hay buscador interno:
  se agregan enlaces. Algunos videos tienen la reproducción incrustada desactivada por su dueño.
  Necesita internet.
- **Películas**: acepta enlaces de YouTube **o archivos propios** (.mp4 / .webm). Copia el
  video a `assets/movies/` y agrégalo con la ruta `assets/movies/mi-pelicula.mp4`
  (póster opcional).
- Lo agregado desde la interfaz queda guardado en el navegador. Para dejar contenido fijo en
  el código, edita `js/data/library.js`. "Eliminar" está dentro del reproductor.

Archivos nuevos: `js/library.js`, `js/player.js`, `js/dialog.js`, `js/core/media.js`,
`js/data/library.js`, `css/media.css`.
