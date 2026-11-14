# CADPreview — notas técnicas

> Versión limpia de las notas de trabajo del proyecto, con lo que se aprendió al construir la extensión: cómo marcan los adjuntos Gmail y OX App Suite, qué hace
> cada servidor con las peticiones parciales (`Range`), por qué hay una página aislada para leer DWG, etc. Habla de "fases": la **Fase A** (miniatura incrustada, solo
> Gmail) y la **Fase B** (visor completo con LibreDWG) fueron prototipos; este repositorio contiene la **Fase C**, que los une. "El autor" es quien mantiene el proyecto;
> los nombres de planos reales se han sustituido por "DWG real A/B". Los tiempos son de un equipo con WebGL por software.


## Descripción

Une la Fase A (miniatura incrustada, al instante) y la Fase B (visor completo, lento) en **una sola extensión** de Brave/Chrome. Al abrir un adjunto `.dwg` o `.dxf` en Gmail, desde el mensaje o desde la lista, el panel muestra solo la miniatura; el botón **Renderizar** carga el visor completo en el mismo panel, porque tarda mucho más. Las Fases A (`..\extension\`) y B (`..\Fase B\`) se mantienen como estaban.

**Estado (12/11/2026): versión 1.0 con barra de herramientas, soporte de Gmail y de IONOS (OX App Suite, vista de lista y de mosaico) y miniaturas automáticas en las tarjetas de adjuntos de ambos. El autor confirma que funciona en su Gmail y en su webmail de IONOS reales y que de momento no encuentra fallos; lo demás se irá comprobando sobre la marcha.**

---

## Decisiones (el autor, 11/11/2026)

| Tema | Decisión |
| --- | --- |
| Flujo | Primero solo la miniatura; el botón "Renderizar" activa el visor completo |
| Código y compilación | Código fuente en `Fase C\` (pocos KB); compilación (24 MB) en `trabajo\` |
| Aviso por tamaño | Por encima de 8 MB, "Renderizar" pide confirmación (cifra propuesta por Claude, sin más base que el caso de 18,4 MB) |
| Fuentes | **97 incluidas en la extensión (24,2 MB)**: todas las que cita el catálogo del visor salvo tres tipografías de sistema chinas/japonesas (`msyh.woff` 8,9 MB, `simfang.woff` 6,0 MB, `msgothic.woff` 4,4 MB). Si un plano pide otra, se descarga una vez del CDN y se guarda. Historial: 6 (primera decisión) → 11 (las que el visor pide siempre con la barra de herramientas: "guarda las fuentes") → 97 ("incluirlas", aprobado con una cifra de 7,2 MB que salió de un listado incompleto del servidor; el catálogo real tiene 99 fuentes y 43 MB). El autor: "caracteres no latinos no", así que las tres CJK quedan fuera |
| Convivencia | El plugin nuevo sustituye a los dos anteriores: hay que desactivar Gmail DWG Preview y CADPreview PoC al probarlo |
| Herramientas del visor | Barra del visor de la demostración con: seleccionar, mover, todo el zoom (Saved, Extents, Smart, Window), buscar texto, capas, layout, medir, **exportar (HTML, PDF y SVG)** y ajustes. Sin dibujar ni modificar. Sobre "Zoom → Extents" en blanco: el autor indica que suele ser un elemento muy alejado del dibujo; se deja la opción tal cual |

---

## Cómo construir, cargar y probar

- **Construir:** `node construir.mjs` desde la carpeta del repositorio (con `--prueba` crea además `ext-test`, la copia para las pruebas automáticas). Copia la fuente a `trabajo\build`, instala dependencias (solo paquetes publicados en npm, versiones fijadas), descarga y verifica las fuentes (SHA-256, `fuente\fuentes-hash.json`), compila el visor con Vite y deja la extensión en `trabajo\extension`. Para cambiar qué fuentes se incluyen: `node actualizar-fuentes.cjs` y volver a construir.
- **Cargar en Brave:** `brave://extensions` → desactivar "Gmail DWG Preview" y "CADPreview PoC (Fase B)" → "Cargar descomprimida" → `trabajo\extension`. ID de la extensión: `mdpdpfcdflnpoihphndhdoccgaabjkko` (sale de la clave pública `fuente\extension\clave-publica.b64`).
- **Pruebas** (necesitan `--prueba`; usan Brave con perfil temporal y una réplica de Gmail con su política de seguridad real): `node pruebas\escenarios.cjs [escenario…]`, `node pruebas\prueba-fuentes.cjs`, `node pruebas\prueba-herramientas.cjs [--sin-exportar]`, `node pruebas\prueba-exportar.cjs [html|pdf|svg]` (tardan minutos), `node pruebas\prueba-medidas.cjs [archivo] [--solo-layout]`, `node pruebas\prueba-ionos.cjs`, `node pruebas\prueba-gmail-tarjetas.cjs`, `node pruebas\prueba-almacenamiento.cjs`, `node pruebas\test_nombres.js`, `node pruebas\test_dxf.js`. Las muestras sin datos de clientes se crean con `node pruebas\crear-muestras.cjs`.

Estructura de `fuente\` (la extensión se reparte en `extension\core.js`, `gmail.js`, `ox.js` y `bridge.js`): `package.json` y `package-lock.json` (dependencias), `vite.config.ts`, `viewer.html`, `src\viewer.ts` (página del visor) y `src\font-shim.js` (capa de fuentes), `public\` (página aislada del lector de DWG y envoltorio del worker de textos), `extension\` (`bridge.js`, `content.js`, `generar-manifest.cjs`).

---

## Cómo se comporta el panel

1. Gmail abre su visor de adjuntos de un `.dwg`/`.dxf` → aparece el panel de CADPreview (título, tamaño, botones Renderizar, Descargar y Cerrar).
2. Lee la miniatura incrustada (DWG: cabecera; DXF: sección `THUMBNAILIMAGE` por rango) y la muestra, o dice por qué no hay. "Renderizar" queda activo en los dos casos.
3. "Renderizar": si el archivo pesa más de 8 MB, avisa y pide confirmación. Después quita la miniatura, abre el visor (iframe de la extensión), le pasa el archivo y muestra el progreso en la cabecera.

---

## Barra de herramientas del visor (11/11/2026)

Viene del paquete `@mlightcad/cad-simple-ui-plugin` (mismo `1.8.0-preview.3`; sin dependencias propias, sin `eval` ni peticiones externas), que el visor mínimo no cargaba. Se registra en `src\viewer.ts` con la barra a la derecha y plegable, y el panel de capas/mediciones desplegable.

- **Incluye:** Select, Pan, Zoom (Saved, Extents, Smart, Window), Find (texto), Layer Manager, Layout, Measure (Distance, Continuous, Angle, Area, Arc, XY, panel de resultados, mostrar/borrar, importar/exportar mediciones), Export (HTML, PDF, SVG) y Settings (tema, fondo, posición de la barra, idioma).
- **Se quita** con `excludeItems`: `open` (abrir otro archivo) y `annotation` (nubes, llamadas, textos, flechas… sobre el dibujo). La mini barra Deshacer/Rehacer/Borrar se oculta con CSS (`.ml-ui-shortcut-toolbar-shell`); ya salía desactivada.
- **El dibujo se abre en modo `Review`** (antes `Write`): se puede mirar, medir y buscar, pero no modificar.
- **Idioma:** la interfaz está en inglés; el plugin trae inglés, chino, japonés, coreano, árabe, checo y turco, **no español**.
- **Exportar:** cada formato se carga solo al usarlo (`registerLazy…Plugin`). SVG descarga al instante. **HTML y PDF hacen preguntas en la línea de comandos del visor** (formato, capas invisibles, layouts, fondo, vista inicial, modo del visor sin conexión; marco, layouts, texto, color), con valor por defecto: basta pulsar Intro en cada una. El HTML exportado lleva incluido un visor autónomo (`viewer-runtime.iife.js`, 1,8 MB, copiado a la extensión).
- **Almacenamiento bloqueado en el iframe:** dentro del panel (iframe de otro origen en Gmail), Brave niega IndexedDB y Cache Storage; solo funciona `localStorage`. Se comprobó con `pruebas\prueba-almacenamiento.cjs` (en una página propia de la extensión funcionan los tres). Consecuencias: (1) exportar a PDF fallaba con "The user denied permission to access the database"; se resuelve con una copia en memoria de IndexedDB (`fake-indexeddb`) que se activa solo si la real falla; (2) la caché de fuentes extra con Cache Storage no funciona dentro del iframe: las fuentes extra se descargan del CDN con una dirección fija por versión, que el servidor marca como inmutable durante un año, así que el navegador las guarda en su caché HTTP y no las vuelve a bajar mientras no se borre.
- **Tamaño de la extensión:** 47,4 MB con la barra, los exportadores y las 97 fuentes (35,3 MB con 11 fuentes; 30,7 MB con 6; 24,0 MB antes de la barra): plugin de PDF (≈4,5 MB), visor para el HTML exportado (1,8 MB), resto del plugin de interfaz y de los otros exportadores.
- **Fuentes que pide el visor con la barra de herramientas.** Cada "Renderizar" pedía además `verdana.woff`, `txt.shx`, `gbcbig.shx`, `isocp2.shx` y `simhei.woff` (4,62 MB), aunque el dibujo no tuviera texto, y esperar esas descargas era lo que lo frenaba. **Resuelto:** ya van incluidas, junto con el resto del catálogo (ver decisión "Fuentes"); las pruebas dan 0 peticiones a `cdn.jsdelivr.net`, incluido el DWG público que antes bajaba `ltypeshp.shx`.
- **Tiempo de lectura con la barra.** Con las 5 fuentes aún descargándose del CDN, el DWG público de 2,5 MB pasó de 7,7 s a ≈12 s (Review 12,2-12,6 s; Write 12,4-14,0 s: el modo no influye; el arranque de los plugins son solo 0,2 s), los DWG pequeños de 2,0-2,6 s a 3,6 s y el DXF de 0,5 s a 2,0 s. **Causa: la espera de esas descargas.** Con las 97 fuentes incluidas: DWG público 5,6-6,1 s (abrir) y 8,6-9,1 s (pintado), DWG pequeños 2,0 s, DXF 1,0 s; es decir, igual o mejor que antes de la barra. **DWG de 18,4 MB con la barra y las 97 fuentes:** aviso de tamaño, abre a los 47 s y termina de pintar a los 58 s (una sola medición; sin barra y con 6 fuentes fueron 99 s y 113 s en otra medición, y un intento anterior no terminó en 186 s: en este equipo los tiempos de este archivo varían mucho).

---

## Miniaturas automáticas en las tarjetas de adjuntos de Gmail (12/11/2026)

A petición del autor, igual que en el mosaico de IONOS: al abrir un mensaje, **la miniatura incrustada en cada .dwg/.dxf se carga sola y se pinta en la tarjeta del adjunto**, donde Gmail pone el icono genérico de archivo (Gmail lo hace con los PDF y las imágenes).

- **Estructura de Gmail** (vista de mensaje, comprobada en el Gmail real con el correo de prueba): un único `div.aQH` con un `span.aZo[download_url]` por adjunto (180×120 en la ventana usada), y dentro `a.aQy` → `.aSH` → `.aYv` (zona de vista previa de 178×85, `position:relative`) con el icono genérico `.aYw`, y `.aYy` (barra con el nombre). La capa de miniatura se pone dentro de `.aYv`, encima del icono (`z-index:1`, `pointer-events:none`), con una etiqueta DWG/DXF.
- **El clic no cambia**: sigue siendo el de Gmail (abre su visor y de ahí sale el panel, como antes).
- **Una sola implementación para Gmail e IONOS, en el núcleo**: `CADPreview.ponerMiniatura(contenedor, adjunto, { tamanoAprox, sondear, etiqueta, zIndex })` crea la capa, espera a que el contenedor entre en pantalla (`IntersectionObserver`), lee de **dos en dos** con un máximo de 25 s por archivo y guarda el resultado en una caché por dirección de descarga (120 como máximo). Si el correo repinta las tarjetas, las ya leídas vuelven al instante sin pedir nada. Los adaptadores (`gmail.js`, `ox.js`) solo dicen dónde ponerla. Los archivos sin miniatura dejan el icono de siempre; el PDF ni se toca.
- Gmail usa su lectura habitual (`content-length` para el DWG, `Range` de sufijo para el DXF); no se sondea el tamaño como en IONOS.
- **Verificado en la réplica de Gmail** con las tarjetas de esa estructura (`pruebas\prueba-gmail-tarjetas.cjs`): 4 de 8 tarjetas con miniatura (las que la traen), las otras 3 CAD con su icono, el PDF sin capa, la capa no intercepta el ratón, el clic no abre ningún panel propio y tras repintar toda la lista reaparecen las 4 con 0 peticiones nuevas. Además, regresión completa de IONOS (lista y mosaico) y de los escenarios de Gmail. **Confirmado por el autor en su Gmail real (12/11/2026): funciona, sin fallos por ahora.**
- Cambio de comportamiento en IONOS que sale de aquí: el aviso por tamaño usa ahora el tamaño exacto del servidor (`content-range`), no el texto de la pantalla.

---

## OX App Suite (IONOS y otros proveedores) — adaptador (11/11/2026; ampliado el 12/11/2026)

El caso real fue un correo propio de IONOS (Mail Basic/Standard/Business), cuyo webmail es OX App Suite estándar en `https://email.ionos.es/appsuite/` (`mail.ionos.es` solo redirige a `id.ionos.es`, el acceso de IONOS ID). Una única dirección sirve todo el correo: **no cambia al abrir un mensaje**, así que no se puede detectar por la URL como en Gmail.

**Lo que se vio en un correo de prueba** (un mensaje con muestras públicas; solo se leyó la estructura de ese mensaje):
- Cada adjunto es un `li.attachment` con el nombre en `title`, el tamaño en `.filesize` ("2,5 MB", "187,3 kB") y un atributo `data-downloadurl="application/octet-stream:NOMBRE:https://email.ionos.es/appsuite/api/mail/NOMBRE?action=attachment&attachment=3&context=…&delivery=download&folder=default0/INBOX&id=…&sequence=1&session=…&user=…"`, igual que el `download_url` de Gmail. La lista está plegada tras un enlace "N adjuntos" (`a.toggle-details`).
- `fetch` de esa dirección desde la página, con la sesión del navegador: 200 y el archivo completo (`AC1021`). Sin `content-length` en las respuestas completas; acepta `Range` (206 con `content-range`). La página `/appsuite/` no envía política de seguridad (CSP).
- **OX no tiene visor para DWG**: el menú de cada adjunto solo ofrece "Descargar". En la lista de mensajes solo hay un clip, sin los nombres de los adjuntos, así que no hay "vista previa desde la lista" como en Gmail.
- El objeto `ox` de OX no se veía desde la herramienta de inspección; no hizo falta, porque la sesión va en la propia dirección del adjunto.

**Adaptador `fuente\extension\ox.js`.** Vigila el DOM (`MutationObserver`) y añade un botón pequeño **"Vista previa CAD"** junto al tamaño de cada adjunto `.dwg`/`.dxf` (decisión del autor); al pulsarlo abre el mismo panel que en Gmail (miniatura al instante y botón Renderizar). El tamaño sale del texto de `.filesize` o del `content-range`. Los botones sobreviven a los repintados de la lista y funcionan si los adjuntos aparecen tarde.

**Vista en mosaico (12/11/2026).** OX tiene dos vistas de adjuntos: la de lista y la de "vista previa" (cuadrados de unos 120 px con el texto "dwg"/"dxf" sobre gris; en OX es `.abs.fallback` dentro de `li.attachment`, y el resto de textos del `li` quedan ocultos). A petición del autor, en el mosaico **la miniatura incrustada se carga sola, como la de un PDF**, y **un clic sobre el cuadro abre el panel** (el botón "Vista previa CAD" se esconde en esa vista y se muestra en la de lista). Detalles:
- Se detecta el mosaico porque `.fallback` tiene tamaño (en la lista no). Se añade una capa `div.cadpreview-tile` dentro del `li` con la miniatura de fondo (`contain`, fondo blanco) y una etiqueta DWG/DXF en una esquina; `pointer-events:none` y `z-index:0`, por debajo de cualquier control de OX.
- Carga **automática de todos los adjuntos CAD**, pero solo de los que entran en pantalla (`IntersectionObserver`, también al desplazar el carrusel), **dos a la vez**, con un tiempo máximo de 25 s por archivo y una caché por dirección de descarga (al volver al mensaje o cuando OX repinta los cuadros no se lee nada de nuevo; máximo 120 miniaturas, las más antiguas se liberan). Los archivos sin miniatura dejan el cuadro como estaba.
- El núcleo expone `CADPreview.miniatura(nombre, url, tamanoAprox, signal, sondear)` para esto.
- **Fallo real encontrado (12/11/2026):** en el mosaico de OX **el texto del tamaño (`.filesize`) está vacío**, así que sin tamaño la lectura de los DXF volvía a pedir `Range: bytes=-N`, que el servidor de IONOS no contesta nunca (el panel decía "el servidor no respondió a tiempo" a los 25 s y las miniaturas DXF no se cargaban). En la vista de lista el texto sí está, por eso allí funcionaba. **Corrección:** IONOS pasa `sondearTamano: true`: el tamaño exacto se pide siempre al servidor con `Range: bytes=0-0` (cabecera `content-range`) y las lecturas parciales son `bytes=X-`; nunca se usa `bytes=-N`. Comprobado en el webmail real que las cuatro respuestas `bytes=0-0` traen el total. La réplica de OX deja ahora vacío ese texto en el mosaico y la prueba reproduce el fallo con el código anterior (1 de 4 miniaturas) y pasa con el nuevo (4 de 4; el panel conoce el tamaño: 2 618 816 bytes).
- Un clic en el cuadro abre el panel salvo que sea sobre un control de OX (botones, enlaces, menú), que siguen funcionando.
- Verificado en la réplica de OX con `?mosaico=1` (cuadros de 120 px en un contenedor de 520 px con desplazamiento): al principio solo 2 de las 4 miniaturas disponibles, las 4 tras desplazar; sin capa en el PDF; el clic abre el panel; el clic en el botón de quitar de OX no lo abre; la vista de lista no crea capas. Confirmado por el autor en su webmail real (12/11/2026, tras corregir el tamaño vacío del mosaico): funciona sin fallos por ahora; sin comprobar cómo pinta OX el mosaico de un PDF ni los controles que aparecen al pasar el ratón.

**Dominios.** Decisión del autor: de momento su empresa, y añadir los principales dominios de IONOS con la misma arquitectura. Responden en `/appsuite/` (200): `email.ionos.es` (**el único comprobado por dentro**), `.com`, `.co.uk`, `.de`, `.fr`, `.it`, `.ca` y `.mx`. No responden: `.at`, `.ie`, `.pl`, `.nl`, `.pt`, `.us`, `.ch`. Para añadir otro: lista `DOMINIOS_IONOS` en `generar-manifest.cjs`.

**Otros proveedores con OX (12/11/2026, el autor: "empieza por OX").** El mismo adaptador (`ox.js`) se activa ahora también en: `office.mailbox.org`, `webmail.strato.de`, `office.hostpoint.ch`, `webmail.home.pl`, `webmail.hostway.com` y `webmail.dreamhost.com`. Todos responden en `/appsuite/`; mailbox.org, home.pl y Hostway muestran la pantalla de acceso estándar de OX 7.10, y STRATO y Hostpoint una parecida a la de IONOS. mailbox.org declara que su webmail se basa en OX App Suite; STRATO lo anunció en 2011 (nota de prensa); home.pl está en la lista de proveedores con OX de Wikipedia; Hostway lo documenta en su ayuda; de Hostpoint y DreamHost solo consta que `/appsuite/` responde. **Ninguno está comprobado por dentro** (no hay cuenta de prueba): el marcado de los adjuntos (`.attachment[data-downloadurl]`, `.filesize`, `.fallback`) es el de OX 8.x que usa IONOS, y las versiones antiguas (la pantalla de acceso de mailbox.org, home.pl y Hostway dice 7.10) podrían diferir. Por eso los selectores ya no exigen `<li>` (`.attachment[data-downloadurl]`).
- **Opción genérica:** `node construir.mjs --ox-generico` (o `CADPREVIEW_OX_GENERICO=1` con el generador) activa el adaptador en **cualquier dirección https con `/appsuite/`**. Es más cómoda para un proveedor nuevo, pero la extensión pide entonces permiso sobre todos los sitios (para uso personal; para publicarla, mejor la lista cerrada). La compilación normal sigue usando la lista.
- Comprobados con `curl` el 12/11/2026 (respuesta de `/appsuite/`): `1und1.de`, `1and1.com` y `1and1.es` dan 404; los dominios de acens (`webmail.`/`correo.`) y `webmail.mail.com` no responden; `privateemail.com` (Namecheap) y `webmail.mijndomein.nl` no tienen `/appsuite/`. No se han incluido.
- Para añadir un proveedor: su dirección en `OTROS_OX` de `generar-manifest.cjs` y volver a construir; si el adjunto no sale, mirar con un correo de prueba cómo marca OX el adjunto y la lista de adjuntos.

**Cambios de estructura.** `content.js` se partió en un **núcleo común** (`core.js`: panel, miniaturas, Renderizar, `window.CADPreview.abrir/cerrar`) y **un adaptador por sitio** (`gmail.js`, `ox.js`). El manifest tiene una entrada por sitio (`core.js` + su adaptador, mundo de la página) más el puente. Cada adaptador se desactiva solo según la ruta (`/appsuite` es IONOS). Dos mejoras del núcleo que también valen para Gmail: Cerrar y Esc avisan al adaptador (Gmail quita `projector=1` de la dirección y cierra su visor) y **mientras el panel está abierto las teclas no llegan a los atajos del correo** (OX y Gmail tienen atajos que borran o archivan mensajes).

**Fallo corregido por el camino.** En `web_accessible_resources` solo se admiten patrones de origen (`https://email.ionos.es/*`), no `…/appsuite/*`: con la ruta, Brave **rechaza la extensión entera** ("Invalid match pattern") sin ningún aviso visible.

**Verificado en la réplica de OX** (`/appsuite/` del servidor de pruebas, que imita la estructura de arriba: sesión en la dirección, sin `content-length`, `Range`; `pruebas\prueba-ionos.cjs`): botón solo en 6 de 7 adjuntos (no en el PDF), también con adjuntos tardíos y con repintado cada 2,5 s; DWG con miniatura 256×97 y Renderizar abre en 5,3 s; DXF con miniatura 128×64 (tamaño del `content-range`); DXF sin miniatura; aviso por tamaño con "12,0 MB" en pantalla; Esc y Cerrar cierran; la dirección de la página no cambia; 0 teclas llegan al correo con el panel abierto. **Gmail sin cambios:** los siete escenarios, Esc con `projector=1` en mensaje y lista y las pruebas unitarias pasan.

**Primera prueba real (el autor, 11/11/2026):** el botón queda bien alineado y los DWG funcionan. **Los DXF se quedaban colgados leyendo la miniatura y no dejaban pulsar Renderizar.** Causa, reproducida en su webmail con el correo de prueba: **el servidor de OX no responde nunca** cuando se le pide "los últimos N bytes" (`Range: bytes=-N`) con N mayor que el archivo, y la lectura de la miniatura de un DXF pedía los últimos 2 MB de un archivo de 190 KB. Con `bytes=-4096` o `bytes=0-` responde bien (206).

**Corrección:** con IONOS, `core.js` pregunta primero el tamaño exacto con `Range: bytes=0-0` (cabecera `content-range`) y pide "desde X hasta el final" (`bytes=X-`); con Gmail sigue usando `bytes=-N`, que allí funciona. Además, la lectura de la miniatura tiene ahora un **tiempo máximo de 25 s**: si el servidor no contesta, el panel avisa ("el servidor no respondió a tiempo") y deja pulsar Renderizar. La réplica de OX imita ahora ese cuelgue (y tiene un adjunto que nunca responde), así que `prueba-ionos.cjs` lo habría detectado. Con la corrección: miniaturas DXF correctas (128×64, tamaño sacado de `content-range`), el adjunto que no responde termina a los 25 s con Renderizar activo y Gmail sin cambios (escenarios y unitarias).

**Aviso sobre las muestras:** Cañón Pérez ñandú con miniatura.dxf lleva como miniatura un **degradado de colores sintético de 128×64** (se creó con crear-muestras.cjs solo para probar la lectura), no un dibujo; en el webmail real se ve exactamente eso, ampliado. Una miniatura DXF real (hatch.dxf, 512×512, de las muestras públicas) se ve bien por el camino de IONOS en la réplica (pruebas\prueba-ionos.cjs).

**Sin verificar en el webmail real:** los DXF tras la corrección, mensajes en ventana aparte, hilos con varios mensajes, la vista de móvil y cuándo caduca la sesión que va en la dirección del adjunto. Los dominios distintos de `.es` son una suposición.

---

## Publicación en GitHub (12/11/2026)

Copia limpia lista en `trabajo\` (generada con `publicar\`; ver su LEEME). Licencia **GPL-3.0-only** (el lector de DWG es GPL-3.0), avisos de terceros generados del `package-lock.json` (38 paquetes de producción, 2 con GPL), README en español con resumen en inglés, `.gitignore`, pruebas que solo usan muestras públicas y notas técnicas sin nombres de planos de clientes. Nueva opción `node construir.mjs --sin-fuentes`: no incluye ninguna fuente tipográfica (23,2 MB frente a 47,4 MB), para poder distribuir la extensión compilada sin redistribuir fuentes de terceros (el repositorio de donde salen no declara licencia). Verificado desde la copia limpia: compilación con y sin fuentes, 5 escenarios de panel, pruebas de OX y de las tarjetas de Gmail y pruebas unitarias. No se ha creado ningún repositorio ni commit.

---

## Verificado (réplica de Gmail, Brave 157 con perfil temporal, WebGL por software)

"Abrir" = desde pulsar Renderizar hasta que el visor termina de leer el archivo; "pintado" = hasta que deja de mostrar "Rendering drawing".

| Escenario | Miniatura | Abrir | Pintado |
| --- | --- | --- | --- |
| DXF sin miniatura, desde el mensaje | no (lo dice) | 0,5 s | 3,6 s |
| DXF con miniatura (128×64), mensaje y lista | sí | 0,5-1,0 s | 3,5-4,1 s |
| DWG público `canteen` (AC1021, 2,5 MB), lista | sí, 256×97 | 7,7 s | 10,7 s |
| Mismo DWG con el puntero a la miniatura anulado | no (lo dice) | 8,7 s | 11,8 s |
| DWG real BMP 200×140 (DWG real A), mensaje | sí | 2,1-2,6 s | 5,1-5,6 s |
| DWG real PNG 512×188 (DWG real B), lista | sí | 2,6-3,1 s | 5,6-6,1 s |
| DWG real de 18,4 MB, mensaje | sí, 256×112 | aviso de tamaño; con "Renderizar igualmente" abre a los 99 s | 113 s (un intento anterior no terminó en 186 s) |

Más comprobaciones: los nombres con tildes y ñ (`Cañón Pérez ñandú…`, enviados como palabra RFC 2047 en `Content-Disposition`) se resuelven bien desde la lista; el chip de otro archivo (`otro.pdf`) no activa el panel; ninguna petición a `cdn.jsdelivr.net` en esos escenarios (las fuentes salen de la extensión); pruebas unitarias de nombres y de miniaturas DXF: todas correctas. **Capa de fuentes** (`pruebas\prueba-fuentes.cjs`, desde la página del visor): `simplex.shx`, `AMGDT DWE Edits.shx` y `@extfont2.shx` salen de la extensión (`local`); `simsun.ttf`, el único fichero del repositorio que el catálogo no cita (10 MB), se descarga del CDN la primera vez (`cdn`) y la segunda sale de la caché (`cache`); una fuente que no existe devuelve 404 sin romper nada. Con las 97 fuentes incluidas, cinco escenarios de panel (DXF y DWG, mensaje y lista) dieron 0 peticiones a `cdn.jsdelivr.net`. La caché solo funciona en una página propia de la extensión; dentro del iframe de Gmail la bloquea Brave y las fuentes no incluidas se apoyan en la caché HTTP del navegador (ver "Almacenamiento bloqueado").

**Barra de herramientas** (muestra pública `Cañón Pérez ñandú.dwg`, 2,5 MB; scripts `pruebas\prueba-herramientas.cjs`, `prueba-exportar.cjs`, `prueba-almacenamiento.cjs`): aparecen los botones esperados y no aparecen Open, Annotation ni Undo/Redo/Delete; el menú de zoom ofrece Saved, Extents, Smart y Window; el panel de capas lista las 14 capas; **medir distancia** funciona (dos clics sobre la fachada dan "≈ 22011.5 mm" con flechas sobre el dibujo). **Exportación** (en este entorno lento, con WebGL por software): SVG 13 MB casi al instante; HTML 4,4 MB en 196 s (con 7 preguntas aceptadas con Intro); PDF 2,2 MB, `%PDF-1.7`, en 164 s (5 preguntas), con "errores: ninguno" en la consola. **Resto de herramientas** (`pruebas\prueba-medidas.cjs`, misma muestra pública): *Zoom* — Window cambia la vista, Extents vuelve exactamente a la vista inicial y Smart la cambia; Saved está activo (no se probó con vistas guardadas). *Find* — buscar "Facade" da "4 found" con la lista de textos y sus coordenadas. *Layout* — el menú lista los layouts del dibujo (`Model`, `Presentación (1_1000)`, `Presentación (1_500)` en DWG real A; `Model`, `Presentación1` en DWG real B; `Model`, `Layout1` en el DWG de 18,4 MB) y elegir uno cambia el dibujo. *Medidas* (cada una con dos a cuatro clics sobre el dibujo): Distance 5445 mm, Angle 90°, Area ≈ 9 114 575,99 mm², Arc ≈ 5547,24 mm, XY → X ≈ 26086,30 e Y ≈ 49156,46 mm; Continuous, Results, Show, Clear e Import no se probaron.

---

## Hallazgos técnicos

- **Paquetes de npm:** la versión publicada `1.8.0-preview.3` de `cad-simple-viewer` y `three-renderer` existe y reproduce lo probado con el clon (los npm "estables" más recientes son la 1.7.8, sin probar). Hay que fijar `@velipso/polybool@1.1.1` a mano (la declaran como dependencia "peer" y npm no la instala) y usar `--legacy-peer-deps` (se usan `data-model` 1.15.25 y `mtext-renderer` 0.13.9, no las que declaran los paquetes: 1.15.22 y 0.13.8, que es lo que se probó).
- **El iframe del visor no puede estar oculto ni tapado.** Con `visibility:hidden` el visor no termina nunca; con la miniatura encima, el DWG de 2,5 MB tardó 38 s en abrir en vez de 7,7 s. Chrome frena los iframes de otro origen que no se ven. Por eso "Renderizar" quita la miniatura al empezar.
- **Límite de la librería:** el worker de lectura corta a los 30 s por defecto; se sube a 300 s con la opción `timeout` de `openDocument`. Sin eso, el DWG de 18,4 MB fallaba con "Worker operation timed out".
- **Fuentes:** versión fija `be0a495…` de `mlightcad/cad-data` (16/09/2026). Se incluyen 97 (24,2 MB), ver la decisión "Fuentes"; la lista sale de `fonts.json` con `node actualizar-fuentes.cjs`, que descarga las que falten y reescribe `fuente\fuentes-hash.json` (huellas SHA-256) y la lista `INCLUIDAS` de `font-shim.js`; `construir.mjs` comprueba que las dos coinciden. **El listado de ficheros del servidor (jsDelivr) estaba incompleto** (85 de las 99 fuentes del catálogo, 19,3 MB en vez de 43 MB): hay que tomar la lista del catálogo, no del listado. Hay nombres con espacios y `@` (`AMGDT DWE Edits.shx`, `@extfont2.shx`); la capa decodifica y vuelve a codificar el nombre. La capa se instala por separado en la página del visor y en el worker de textos (un envoltorio, `mtext-worker.js`, la carga antes del worker original).
- **Tamaño:** 47,4 MB con la barra de herramientas, los exportadores y las 97 fuentes (sin barra ni exportadores y con 6 fuentes: 24,0 MB).
- La cuenta de Gmail (`/mail/u/N/`) se toma de la URL; la Fase A la tiene fija en `u/0`.
- `hatch.dxf` (muestra pública de mlightcad) trae su propia miniatura de 512×512.

---

## No verificado

- **En el Gmail real:** confirmado por el autor (11/11/2026, 20:24) que todo funciona. Sin detalles de tiempos con su tarjeta gráfica.
- El aspecto en pantalla con otras tarjetas gráficas; los tiempos son con WebGL por software.
- Una cuenta de Gmail distinta de la primera (`u/1`).
- Una fuente extra pedida por un dibujo real; el DWG real `AC1032` de 264 KB sin miniatura (se probó uno sintético); DXF binarios y de más de 30 MB.
- Que funcione con la Fase A o la prueba de la Fase B activas a la vez (hay que desactivarlas).
- **Barra de herramientas en el Gmail real:** incluida en la confirmación del autor (11/11/2026). El autor dijo que "todo funciona bien" sin detallar herramienta por herramienta; no se sabe si probó el PDF (el que necesita la copia en memoria de IndexedDB) ni las descargas de HTML y SVG.
- Medida continua (Continuous), panel de resultados, mostrar/borrar mediciones e importarlas; vistas guardadas de Zoom → Saved.
- Si "Zoom → Extents" deja la pantalla en blanco con elementos muy alejados del dibujo (lo que se observó en 2 de 8 DWG): se dejó como está.

## Riesgos

- Gmail puede cambiar su estructura interna (`download_url`, `tr.zA .brc`, `window.GLOBALS`); la lista depende de ella.
- La página aislada del lector de DWG y el `Worker` falso dependen de cómo mlightcad estructura su conversor; una actualización puede romperlos (por eso las versiones fijadas y `package-lock.json`).
- Las versiones usadas son una `preview`.
- Licencias: el lector de DWG (LibreDWG) es GPL-3.0. Uso personal sin distribuir: sin obligaciones; si se comparte con compañeros, habría que publicar el código de esa parte.


## 1.1 (12/11/2026) - Vista previa dentro de Google Drive
- **Hecho**: background.js (service worker que lee Drive sin CORS), drive.js (botón "Vista previa CAD" en vista de lista + panel al abrir el visor de Drive), core.js con lector propio (nucleo-4), manifest 1.1 con host_permissions de drive.google.com y drive.usercontent.google.com. Compilado en trabajo\
- **Verificado (réplica HTTPS de Drive, Brave headless)**: el fetch desde la página falla por CORS (premisa); botones solo en .dwg/.dxf; miniaturas DWG/DXF; Renderizar descarga todos los bytes; servidor sin Range; aviso antivirus; 403; visor de Drive + Esc; fila reutilizada; cookie SameSite=Lax. Regresión Gmail (tarjetas) e IONOS OK con la build 1.1.
- **Lección**: Chrome no reinyecta un mismo archivo (core.js) en una página donde otra entrada ya lo cargó. Con el patrón <all_urls> de la copia de pruebas, Gmail/OX cargaban core en MAIN y drive.js (ISOLATED) se quedaba sin núcleo. Solución: exclude_matches de drive.google.com en las entradas de Gmail/OX. En producción no ocurría.
- **Pendiente de prueba (Drive real)**: Range y cookies reales de drive.usercontent.google.com desde el service worker; archivos grandes con aviso antivirus; posición visual del botón; vista en cuadrícula (sin inspeccionar, requiere autorización del autor).

### 1.1.1 (12/11/2026) - tras la primera prueba del autor en su Drive real
- el autor: Drive previsualiza bien; (1) el botón parpadeaba al pasar el ratón y no dejaba pulsarlo; (2) no había miniatura en "Detalles".
- **Hecho**: botón fuera del bloque div.rxUYqf>div.JxSEve (que tiene tooltip, arrastre y overflow:hidden), hermano de rxUYqf, sin atributo title. Miniatura en el panel Detalles: capa encima del iframe de vista previa (otro origen, no se puede tocar). El título del panel Detalles ya no se confunde con el visor.
- **Verificado (réplica con la estructura real del DOM)**: botón fuera del bloque; capa con miniatura en DWG y DXF, ninguna en PDF, sin capturar el ratón, sin abrir el visor; resto de pruebas de Drive y regresión igual que 1.1.
- **Pendiente de prueba (Drive real)**: que el parpadeo desaparezca (causa por hipótesis: no reproducible en la réplica ni en el panel estrecho del navegador integrado) y que la capa cubra bien el iframe en el panel real.

### 1.1.2 (12/11/2026) - segunda prueba del autor en su Drive real
- el autor: la miniatura en "Detalles" se ve bien (**Verificado en Drive real**). El botón "Vista previa CAD" seguía parpadeando aunque estaba fuera del bloque del nombre; decide quitarlo en Drive.
- **Hecho**: botones de fila apagados por defecto (código conservado tras el interruptor dataset.cadpreviewBotonFilas='1', que solo usan las pruebas). En Drive quedan: miniatura en Detalles + doble clic (visor de Drive) abre el panel con Renderizar.
- **Verificado (réplica)**: sin botones por defecto; miniatura en Detalles DWG/DXF y no en PDF; resto de pruebas de Drive igual; regresión Gmail e IONOS OK.
- **Pendiente de prueba (Drive real)**: doble clic en el DWG abre el panel con Renderizar y descarga completa (Range/cookies reales, archivos grandes).
- Causa del parpadeo: no determinada (no se reproduce en la réplica).

### 1.1.3 (12/11/2026) - tercera prueba del autor: al quitar el botón, el doble clic no abre nuestro panel
- Causa (**Verificado en Drive real**, DOM inspeccionado con el navegador integrado): el visor de Drive para DWG/DXF ("No hay ninguna vista previa disponible", menús Archivo/Visualizar) NO está en la página sino en un iframe; no hay h2 en la página. La detección por h2 de 1.1 solo funcionaba en la réplica (el h2 que vi en el Drive real era el del panel Detalles). Con 1.1/1.1.1 se llegaba a Renderizar solo por el botón de la fila.
- **Hecho**: botón "Ver dibujo completo" sobre la miniatura del panel Detalles (abre el panel de CADPreview con Renderizar). Es un elemento nuestro dentro de nuestra capa; Drive no lo toca.
- **Verificado (réplica)**: botón presente, abre el panel (origen drive-detalles), Renderizar descarga 2.618.816 de 2.618.816 bytes, Esc cierra; DXF con miniatura; PDF sin capa ni botón; resto igual.
- **Pendiente de prueba (Drive real)**: el botón en Detalles (posición, que no parpadee), Renderizar con Range/cookies reales.
- Lección: no dar por válida una detección de DOM hecha solo contra la réplica; contrastar con el DOM real de cada pantalla (visor en iframe).

### 1.1.4 (14/11/2026) - el doble clic y Intro abren el panel de CADPreview
- el autor: miniatura en Detalles y botón "Ver dibujo completo" bien (**Verificado en Drive real**); pero con doble clic sobre el DWG sale el visor de Google ("No hay ninguna vista previa disponible"), no el nuestro. Decide que el doble clic abra siempre CADPreview para .dwg/.dxf y autoriza inspeccionar su Drive.
- **Medido en el Drive real** (navegador integrado, solo estructura y solo con las muestras públicas "Cañón Pérez ñandú..."; vista de lista y de cuadrícula; vista dejada como estaba):
  - El visor de Drive para DWG/DXF es un **iframe** a drive.google.com/viewer/main (pantalla completa) más otro a /odp/dialog. Su dirección no lleva el id del archivo, y **la dirección de la página no cambia** (sigue en /drive/home).
  - Un Escape **sintético** (KeyboardEvent en body o document) **no cierra** ese visor; el Escape real sí (el foco está dentro del iframe). Por eso cerrarVisorDeDrive (1.1) no servía.
  - Un doble clic real da: mousedown/mouseup/click con detail=1, luego mousedown/mouseup/click con **detail=2** y dblclick. El visor se abre con el segundo clic: cortar solo dblclick **no** lo impide; cortar mousedown, mouseup y click con detail>=2 (y dblclick) en captura sobre window **sí**, aunque el oyente se registre tarde. Intro sobre la fila enfocada también abre el visor y se corta igual (sin el corte, abre). Con la barra espaciadora no se abre, y el menú contextual de un DWG no tiene "Vista previa" (Abrir con, Descargar, Cambiar nombre...).
  - Cuadrícula: tarjetas div[role="gridcell"][data-id] (226x226) con aria-label "nombre.dwg Imagen Cargando... Más información" y un hijo div.hAkGVe[data-tooltip="nombre.dwg Imagen"] (no hay <strong>). Misma secuencia de eventos y mismo resultado del corte.
  - Lista: dentro de la fila hay botones (Compartir, Descargar, Cambiar nombre, Destacados, Más acciones) y dos div[role=button]; la cadena del nombre (strong > span > div[tooltip] > ... > td) no pasa por ningún control.
  - /file/d/ID/view (dirección directa): el título de la pestaña es "nombre.dwg - Google Drive".
- **Hecho** (drive.js): oyente en captura sobre window (mousedown, mouseup, click, dblclick, keydown) que, sobre una fila/tarjeta .dwg/.dxf (no sobre sus botones), corta el evento y abre el panel de CADPreview (origen drive-doble-clic o drive-intro); Intro con varios archivos seleccionados se deja a Drive. Dirección /file/d/ID/view (también /file/u/N/d/...): panel con el nombre del título (origen drive-enlace). nombreDe lee también el aria-label de la tarjeta y admite nombres con ".dwg" en medio. Eliminados detectarVisor (solo funcionaba en la réplica) y cerrarVisorDeDrive. Compilado en trabajo\extension (manifest 1.1.4).
- **Verificado (réplica, ahora con el visor como iframe que se abre con el 2.º clic o con Intro, vista de cuadrícula y /file/d/ID/view)**: doble clic e Intro abren el panel y el visor de Drive no se abre (solo llega un clic a la fila, queda seleccionada); PDF y botón "Más acciones" de la fila: Drive hace lo suyo y no sale panel; cuadrícula igual; enlace: panel con el nombre del título, se cierra con Esc y no se reabre. Resto de pruebas de Drive y regresión de Gmail (tarjetas), IONOS/OX y unitarias iguales.
- **Pendiente de prueba (Drive real con la extensión cargada)**: doble clic e Intro en lista y cuadrícula; enlace directo; Renderizar con Range y cookies reales y archivos grandes.
- Consecuencias: con doble clic en un .dwg/.dxf ya no sale la pantalla de Google con "Abrir con AutoCAD" y "Conectar más aplicaciones" (queda en el menú contextual → Abrir con; el panel trae su Descargar). Si Drive abre su visor por otra ruta, no hay forma de detectarlo (iframe sin id) ni de cerrarlo desde la extensión.
- Lección: antes de interceptar, medir qué evento abre de verdad la acción (aquí no era dblclick sino el segundo click) con un oyente de registro y una prueba de corte en el sitio real.

### 1.1.5 (14/11/2026) - el clic en el recuadro de la miniatura abre el panel
- el autor: el doble clic sobre el nombre del archivo ya abre el plugin (**Verificado en Drive real**); pero un clic sobre el recuadro de la miniatura del panel Detalles abría el visor de Drive.
- Causa: la capa de la miniatura no captura el ratón (pointer-events:none, decisión de 1.1.1 para no tapar nada de Drive), así que el clic llegaba al iframe de vista previa de Drive (otro origen) y este abría su visor.
- **Hecho** (drive.js): un elemento propio `.cadpreview-det-click` cubre toda la zona de vista previa del panel Detalles de los .dwg/.dxf (z-index 2, cursor pointer, también cuando no hay miniatura); el botón "Ver dibujo completo" sigue encima (z-index 3). Un oyente en captura sobre window (pointerdown, pointerup, mousedown, mouseup, click, dblclick) corta esos eventos para que no lleguen ni al iframe ni a ningún oyente de Drive, y el click abre el panel de CADPreview (origen drive-detalles-miniatura). Compilado en trabajo\extension (manifest 1.1.5).
- **Verificado (réplica; ahora un clic en la vista previa del panel abre el visor de Drive mediante un oyente del contenedor, el caso peor)**: clic en el recuadro de un DWG con miniatura y de un DXF sin miniatura abre el panel y el visor de Drive no se abre; en un PDF no hay recuadro nuestro y el clic abre el visor de Drive. Resto de pruebas de Drive (doble clic, Intro, cuadrícula, enlace, lectura, errores) igual.
- **Pendiente de prueba (Drive real con la extensión)**: clic en el recuadro con DWG y con DXF; que no quede ningún hueco de la vista previa sin cubrir.



### 1.1 (14/11/2026) - versión publicable: Cancelar, autodiagnóstico, README y copias finales
- el autor aprueba (14/11/2026): botón Cancelar durante el render (5), autodiagnóstico con aviso automático y "Copiar informe" (7), versión **1.1** (manifest "1.1", package.json 1.1.0) y carpeta `Final\1.1`. Descartados: zoom que ignora objetos lejanos (3), interfaz en español (4), más plataformas "sin un criterio claro" (6). Las pruebas con ficheros reales (2) las hizo el autor: todo correcto.
- **Cancelar (core.js, nucleo-5)**: botón "Cancelar" en la cabecera del panel, visible solo mientras se renderiza. Al pulsarlo: AbortController sobre la lectura del adjunto (el lector propio de Drive ya respetaba `init.signal`), se quita el iframe del visor y el listener de mensajes, vuelve la miniatura, el botón queda como "Renderizar" y el estado vuelve a `miniatura` (o al estado previo). El temporizador de 15 s ("sin-respuesta") ahora solo actúa sobre el render que lo creó (renderId), así que no mata un render posterior.
- **Autodiagnóstico (core.js + adaptadores)**: `CP.vigilar({ sitio, selectores, sospechosos })`; cada adaptador cuenta los elementos que parecen un adjunto .dwg/.dxf y no se reconocen (Gmail: tarjeta `.aQH` sin `span.aZo[download_url]` interpretable; OX: `.attachment` CAD sin `data-downloadurl` válido; Drive: fila/tarjeta con .dwg/.dxf en el texto sin que `nombreDe` lo reconozca, o panel Detalles con título CAD sin nuestra capa). Si siguen ahí en dos comprobaciones seguidas (cada 2 s) sale "CADPreview no reconoce este adjunto. Copiar informe" (descartable con ×). "Copiar informe" también aparece en el panel en los estados de error (`error-*`, `sin-respuesta`, `bloqueado-*`). El informe lleva solo: versión de la extensión, sitio (gmail/ox/drive), versión de Chrome, número de elementos por selector, nº de sospechosos y, en el panel, el código de estado y la directiva CSP. **Nada** de nombres de archivo, URLs ni texto. La versión de la extensión llega a Gmail/OX (mundo MAIN) por `dataset.cadpreviewVersion`, que pone bridge.js.
- Detalle aprendido: en el DOM el nombre y la columna siguiente se concatenan sin espacio ("plano.dwgHoy"), así que la detección por texto usa `\.(dwg|dxf)(?!\.)` (acepta "dwgHoy" y descarta "plano.dwg.pdf") y no `\b`. Observación (no corregida): `nombreDe` de Drive lee también aria-labels de hijos, incluido nuestro propio botón de fila (solo existe con el interruptor de pruebas), de modo que con ese botón puesto una fila sin `<strong>` se sigue "reconociendo".
- package-lock.json tenía la versión raíz 1.0.0 (desfasada): ahora 1.1.0 como package.json.
- **Verificado (réplicas, Brave)**: `pruebas/prueba-cancelar-diagnostico.cjs` (nueva): Cancelar en pleno render (estado renderizando, 1 iframe → miniatura, 0 iframes, botón Renderizar activo, nada reaparece a los 17 s, segundo render llega a "abierto"); página de Drive intacta sin aviso y con el HTML alterado (nombre fuera de `<strong>`, sin tooltips) aviso + informe sin datos personales + descartar; Copiar informe en el panel con error. `pruebas/prueba-diagnostico-gmail-ox.cjs` (nueva): Gmail (sin `download_url`) y OX (sin `data-downloadurl`): sin aviso con el HTML intacto, aviso e informe correcto con el alterado. Regresión: prueba-drive, prueba-ionos, prueba-gmail-tarjetas, test_nombres y test_dxf, todo igual que 1.1.5.
- **README**: Drive en la tabla de compatibilidad (lo que el autor verificó: doble clic, Intro, recuadro de la miniatura, enlace directo, lista y cuadrícula), uso de Cancelar y del aviso, instalación con CADPreview-1.1.zip, y **privacidad corregida**: la extensión no declara `permissions` pero desde 1.1 sí `host_permissions` para drive.google.com y drive.usercontent.google.com (service worker que lee la descarga de Drive porque la página no puede: sin CORS).
- **Pendiente de prueba (Drive/Gmail/OX reales)**: el aviso no debe salir nunca en uso normal (falsos positivos con HTML real); Cancelar con un DWG grande real.
- **Entregables 1.1 (14/11/2026)**: (a) `Final\1.1` (carpeta del proyecto) = solo el plugin (compilación con fuentes, manifest 1.1, sin id-extension.txt, con CADPreview.ico como Final\1.0); **Verificado**: 0 diferencias de hash frente a la compilación probada, carga en Brave (service worker background.js, versión 1.1). (b) Copia limpia regenerada en `trabajo\` (0,5 MB, con drive.js/background.js, README con la privacidad corregida; búsqueda de datos personales (la lista de términos está en `publicar\LEEME.md`) sin resultados). **Verificado**: compila desde esa copia con `--sin-fuentes` (23,3 MB) y su JS es idéntico al de la fuente. (c) `trabajo\CADPreview-1.1.zip` (sin fuentes, 6,1 MB, con LICENSE y THIRD_PARTY_NOTICES.md), SHA-256 `0a75faa1093a7eac39db1a752c9ce7a6ff16d5884d61de84b2811613d75c13da`, notas `NOTAS_RELEASE_v1.1.md`; **Verificado** que carga en Brave. preparar-repo.cjs ahora sustituye también cualquier ruta `trabajo\` en las notas.
- **Pendiente**: subir el zip como Release y la copia limpia a GitHub (lo hace el autor; no se ha publicado nada).
- **Icono (14/11/2026)**: el autor entrega el icono del plugin (`CADPreview.ico`, 256 px, y la imagen original 1152x976). Se generan PNG cuadrados de 16, 32, 48 y 128 px en `fuente\extension\icons\` y el manifest declara `icons` y `action.default_icon` (generar-manifest.cjs; construir.mjs copia la carpeta a extension y ext-test). Sigue siendo la versión 1.1 (decisión del autor: reemplazar el release 1.1 en lugar de sacar 1.1.1): zip, hash, `Final\1.1` y el release v1.1 de GitHub se regeneran con el icono. **Verificado**: regresión de Drive, IONOS, tarjetas de Gmail, Cancelar/diagnóstico y diagnóstico Gmail/OX igual que antes; carga en Brave.
