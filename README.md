# WebBox OS — Launcher + control remoto + multimedia + Archivos + SNES + fondos personalizados

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

## Gestor de archivos

El **Gestor de archivos** aparece directamente en el panel izquierdo. Permite abrir una
carpeta del equipo con File System Access API (Chrome / Edge compatibles) o trabajar con
el almacenamiento privado de WebBox OS cuando el navegador no ofrece esa API.

- **Almacenamiento interno:** usa OPFS cuando está disponible y IndexedDB como alternativa.
  El contenido se conserva en el perfil del navegador y no se escribe en una carpeta del PC.
- **Subir archivos / Subir carpeta:** importa archivos al directorio actual. Al subir una
  carpeta se conserva la estructura relativa cuando el navegador proporciona esa información.
- **Organización:** selecciona un elemento y utiliza Nueva carpeta, Renombrar, Copiar, Mover
  o Eliminar. El borrado se confirma desde un cuadro de WebBox OS; mover también pregunta
  antes de ejecutar la operación. Copiar en la misma carpeta crea una copia con sufijo.
- **Destino:** Copiar y Mover abren un selector de carpetas navegable con mando, teclado o mouse.
- **Lista / Cuadrícula:** cambia la presentación. Atrás sube una carpeta o cierra un visor.
- **Video y audio:** se reproducen en el reproductor existente de WebBox OS. Los formatos
  compatibles dependen del navegador y del sistema operativo.
- **Imágenes:** se abren en un visor a pantalla completa.
- **Agregar a Películas:** disponible en los archivos de video. En carpetas del equipo y OPFS
  se guarda el manejador persistente; en la alternativa IndexedDB se guarda una referencia
  interna. No se copia el archivo al añadirlo a la biblioteca.

Las operaciones de crear, renombrar, copiar, mover y eliminar en una carpeta del equipo
requieren permisos de escritura concedidos por el navegador. En almacenamiento interno esas
operaciones solo afectan a los datos de WebBox OS. Los archivos importados pueden ocupar
espacio del almacenamiento web y están sujetos a la cuota del navegador; para contenido muy
grande se recomienda utilizar una carpeta del equipo cuando sea compatible.

## Juegos · Super Nintendo (SNES)

La sección **Juegos** integra EmulatorJS con el núcleo SNES (Snes9x). La interfaz del
emulador se solicita en español latinoamericano (`es-419`). El reproductor se abre dentro
de un `iframe` para aislar el motor del resto del launcher.

1. Abre **Gestor de archivos** y selecciona la carpeta del PC donde guardas tus ROMs, o
   abre el almacenamiento interno y sube tus archivos.
2. Entra en **Juegos** y pulsa **Buscar ROMs en Archivos**. La búsqueda recorre también
   subcarpetas de la ubicación abierta.
3. Selecciona **Jugar** en la ROM deseada. Puedes usar teclado, mando compatible o los
   controles en pantalla que ofrece EmulatorJS.
4. Para salir, usa **Salir del juego**, Escape o mantén pulsado GUIDE durante 1,5 segundos.

Se reconocen los formatos `.sfc`, `.smc`, `.fig`, `.gd3`, `.gd7`, `.dx2`, `.bsx` y `.swc`.
No se incluyen ROMs en el proyecto. El archivo seleccionado se lee desde el Gestor de archivos
y se entrega al emulador mediante una URL temporal `blob:`; WebBox OS no mueve ni modifica
la ROM.

**Conexión necesaria:** esta integración descarga `loader.js`, el núcleo WebAssembly y los
recursos de EmulatorJS desde `https://cdn.emulatorjs.org/stable/data/`. Por eso el juego
requiere Internet y el núcleo no está incluido dentro del ZIP. La lectura de ROMs sí permanece
en el almacenamiento local del navegador/equipo. La disponibilidad de ROMs y el uso de copias
deben respetar los derechos de autor aplicables.

**Emuladores** abre directamente el emulador de Super Nintendo (SNES): la misma biblioteca de ROMs de **Juegos**, con el título "Emuladores · Super Nintendo".

## Fondos personalizados

En **Configuración > Fondo**, **Importar fondo** permite elegir imágenes propias (JPG, PNG, WEBP,
GIF, AVIF o BMP, hasta 20 MB, máximo 30). Cada una se guarda como Blob en IndexedDB y aparece
como **Mi fondo 1, 2…** junto a los fondos incluidos. **Pulsa dos veces** un fondo propio para
eliminarlo.

## Aplicaciones: ubicaciones, iconos y eliminar casillas

- **Dónde están tus archivos** (pantalla Aplicaciones): elige la carpeta de tu **Música**, **Fotos**
  y **Videos** (selector de carpetas en Chrome/Edge; en otros navegadores se usa el almacenamiento
  interno). Al abrir esas aplicaciones, el Gestor de archivos entra directo en esa carpeta.
  El navegador solo comparte el nombre de la carpeta, no la ruta completa.
- **Doble pulsación** (dos clics, o OK dos veces seguidas con teclado/mando) sobre cualquier casilla
  abre un menú: **Cambiar foto del icono**, **Restaurar icono original** y **Eliminar casilla**.
  Una sola pulsación abre la aplicación tras una espera de 350 ms.
- Las casillas eliminadas se recuperan con **Restaurar** al final de la pantalla Aplicaciones.
- Cada aplicación trae un logo a color propio (YouTube con su forma reconocible). Son dibujos SVG
  del proyecto, no los archivos oficiales de las marcas; para usar el oficial, cámbialo con la foto del icono.
- Los iconos propios se recortan a cuadrado, se reducen a 256 px y se guardan en el navegador.

## Estructura

    index.html            estructura y pantallas
    css/                  main · launcher · navigation · settings · media · files · games · emulators
    js/main.js            arranque, router, overlay, reloj e integración de pantallas
    js/files.js           gestor de archivos, operaciones y selectores de destino
    js/games.js           biblioteca de ROM y emulador SNES (EmulatorJS / Snes9x)
    js/fileSystem.js      adaptadores de File System Access, OPFS e IndexedDB
    js/player.js          reproductor de YouTube, video y audio
    js/core/              events · storage · config · focus · media
    js/input/             keyboard · gamepad
    js/launcher.js        filas y tarjetas
    js/library.js         bibliotecas YouTube / Películas
    js/settings.js        configuración, fondos personalizados y prueba de botones
    js/backgroundStore.js almacenamiento de varios fondos propios en IndexedDB
    js/cardMenu.js        menú de doble pulsación (icono / eliminar)
    js/core/images.js     recorte y reducción de fotos de icono
    js/data/logos.js      logos a color de las aplicaciones
    js/data/              datos de aplicaciones, fondos y bibliotecas
    tools/build.py        empaquetador sin dependencias para `file://`
    js/bundle.js          bundle generado para doble clic
    assets/               icono, fondos SVG y medios de ejemplo
    tests/                pruebas de lógica

## Pruebas

    node tests/logica.test.mjs
    python3 tools/build.py

Las pruebas de lógica cubren foco espacial, mapeo y repetición de mando, conexión/desconexión,
teclado, análisis de enlaces multimedia y detección de extensiones SNES. La navegación entre
Emuladores y Juegos y la carga de un fondo personalizado se verificaron en Chromium con un
documento de prueba y almacenamiento IndexedDB simulado. También se deben
comprobar en un navegador local las operaciones de archivo con permisos reales y la descarga
del núcleo EmulatorJS desde su CDN.
El entorno de desarrollo puede bloquear el selector nativo del sistema; en ese caso, usa el
almacenamiento interno para probar importación y organización de archivos.

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
