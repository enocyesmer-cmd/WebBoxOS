# WebBox OS — Launcher + control remoto + YouTube + Películas + Archivos

Launcher estilo Android TV / Google TV que corre en el navegador, sin frameworks ni dependencias.
Incluye navegación por foco, teclado, mouse y mandos compatibles con la Gamepad API.

## Ejecutar

**Por HTTP (recomendado para desarrollo):** desde esta carpeta:

    python3 -m http.server 8080      # o: py -m http.server 8080 en Windows

Abre http://localhost:8080. En HTTP se cargan directamente los módulos ES de `js/main.js`.
Para abrirlo desde otro equipo, usa `http://IP-DEL-PC:8080`; para funciones que requieren
contexto seguro, el navegador puede exigir HTTPS fuera de localhost.

**Con doble clic:** ejecuta primero el empaquetador (no necesita instalar dependencias):

    python3 tools/build.py            # Windows: py tools/build.py

Después abre `index.html`. En `file://` se carga `js/bundle.js`, generado a partir de los
módulos de `js/`. Si modificas JavaScript, vuelve a generar el bundle antes de abrirlo con
doble clic. El ZIP incluye el bundle ya generado.

## Conectar un mando Bluetooth

1. Pon el mando en modo emparejamiento y vincúlalo en los ajustes Bluetooth del sistema.
2. Con WebBox OS abierto y en primer plano, **pulsa cualquier botón del mando** (el navegador
   no lo expone hasta esa primera pulsación; ese botón no activa nada).
3. Arriba a la derecha aparece su nombre y un aviso "Mando conectado".
4. Si los botones no hacen lo esperado: Configuración > Prueba de botones para ver qué
   números envía, y Configuración > Mando para reasignar cada acción.

## Controles

| Acción | Teclado | Mando (layout estándar) |
|---|---|---|
| Mover | Flechas | Cruceta o palanca izq. |
| OK | Enter / Espacio | A (botón 0) |
| Atrás | Esc / Retroceso | B (botón 1) |
| Inicio | H / Inicio | Start (9) o Guía (16) |

El mouse también funciona (pasar el puntero enfoca, clic selecciona). Los controles remotos
que se comportan como teclado funcionan por la columna de teclado.

## Aplicación Archivos

La aplicación **Archivos** permite elegir una carpeta del equipo (File System Access API en
Chrome y Edge), explorar sus subcarpetas y abrir medios locales. La pantalla presenta la ruta
actual, cuenta los elementos y permite alternar entre **Cuadrícula** y **Lista**. Las carpetas
aparecen antes que los archivos y cada tipo tiene un icono propio.

- **Mando / teclado:** flechas para moverse, OK para entrar en carpetas o abrir archivos y
  Atrás para subir un nivel. Al llegar a la carpeta raíz, Atrás vuelve al Inicio.
- **Video y audio:** se reproducen en el reproductor existente de WebBox OS, con controles
  navegables para el mando. Los formatos que puede decodificar dependen de Chromium y del
  sistema operativo.
- **Imágenes:** se abren en un visor a pantalla completa; Atrás o Cerrar vuelve a la lista.
- **Agregar a Películas:** cada video muestra este botón. Guarda el manejador de archivo en
  IndexedDB y una referencia en la biblioteca; no copia, renombra, elimina ni modifica el
  archivo original. Al abrir esa entrada desde Películas, WebBox OS vuelve a solicitar permiso
  de lectura cuando el navegador lo necesita.

La exploración es **solo lectura**. No hay acciones para crear, borrar, renombrar o mover archivos.
El selector de carpetas requiere un navegador compatible y un contexto seguro admitido por él
(HTTPS o localhost). Al abrir mediante doble clic, el selector depende de que esa versión del
navegador trate `file://` como contexto local confiable; si no aparece, ejecuta WebBox OS por
HTTP en `localhost`. El permiso lo concede el usuario desde el selector del navegador.

## Estructura

    index.html            estructura y pantallas
    css/                  main · launcher · navigation · settings · media · files
    js/main.js            arranque, router, overlay, reloj e integración de pantallas
    js/files.js           explorador de carpetas y visor de imágenes
    js/fileSystem.js      persistencia de manejadores y helpers de File System Access API
    js/player.js          reproductor de YouTube, video y audio
    js/core/              events · storage · config · focus · media
    js/input/             keyboard · gamepad
    js/launcher.js        filas y tarjetas
    js/library.js         bibliotecas YouTube / Películas
    js/settings.js        configuración y prueba de botones
    js/data/              datos de aplicaciones, fondos y bibliotecas
    tools/build.py        empaquetador sin dependencias para `file://`
    js/bundle.js          bundle generado para doble clic
    assets/               icono, fondos SVG y medios de ejemplo
    tests/                pruebas de lógica

## Pruebas

    node tests/logica.test.mjs
    python3 tools/build.py

Las pruebas de lógica cubren foco espacial, mapeo y repetición de mando, conexión/desconexión,
teclado y análisis de enlaces multimedia. También se probó en Chromium la pantalla Archivos
con manejadores simulados: selección de carpeta, navegación, lista/cuadrícula, visor de imagen,
reproductor de audio y alta / apertura de un video desde Películas.

## YouTube y Películas

Dos pantallas del menú lateral (y de "Aplicaciones favoritas"). Cada una es una biblioteca de
tarjetas por categoría con un botón **+ Agregar** (se navega con mando/teclado; OK sobre un
campo abre el teclado del sistema).

- **YouTube:** reproduce videos y listas dentro de WebBox OS con el reproductor oficial
  incrustado y controles propios (pausa, ±10 s, sonido, pantalla completa, siguiente/anterior
  en listas). YouTube no permite incrustar su sitio completo, así que no hay buscador interno:
  se agregan enlaces. Algunos videos tienen la reproducción incrustada desactivada por su dueño.
  Necesita internet.
- **Películas:** acepta enlaces de YouTube, rutas de archivos dentro del proyecto (por ejemplo
  `assets/movies/mi-pelicula.mp4`) y referencias locales agregadas desde Archivos.
- Lo agregado desde la interfaz queda guardado en el navegador. Para dejar contenido fijo en el
  código, edita `js/data/library.js`. "Eliminar" está dentro del reproductor.

