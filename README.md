# CADPreview

Extensión para navegadores basados en Chromium que muestra una **vista previa de los archivos DWG y DXF** en el correo web y en Google Drive, sin descargarlos ni abrir AutoCAD:

- **Al instante:** la miniatura que el propio programa de CAD guardó dentro del archivo, en un panel y también directamente en las tarjetas de adjuntos del mensaje (como hace el correo con los PDF).
- **Bajo demanda:** el botón **Renderizar** abre el dibujo completo en un visor con zoom, capas, búsqueda de texto, medición y exportación a HTML, PDF y SVG.

Todo ocurre en tu navegador, con la sesión que ya tienes abierta: el adjunto no se envía a ningún servidor.

> Proyecto personal. Está probado a mano en **Brave (Windows)** con **Gmail**, **Google Drive** y el webmail de **IONOS** (`email.ionos.es`). El resto de lo que aparece en esta página es lo que *debería* funcionar según cómo están hechos esos servicios y está marcado como tal.

## Dónde funciona

| Correo | Estado |
|---|---|
| **Gmail** (`mail.google.com`) | Comprobado: miniaturas en las tarjetas del mensaje, panel al abrir el adjunto (desde el mensaje y desde la lista de resultados), visor completo. |
| **Google Drive** (`drive.google.com`) | Comprobado (versión 1.1): miniatura y botón **Ver dibujo completo** en el panel *Detalles*; **doble clic** o **Intro** sobre el archivo, y clic sobre el recuadro de la miniatura, abren el panel de CADPreview en lugar del visor de Drive (que no sabe abrir DWG/DXF); también la dirección directa `/file/d/…/view`. En vista de lista y de cuadrícula. |
| **IONOS** (`email.ionos.es`, webmail OX App Suite) | Comprobado: botón "Vista previa CAD" en la vista de lista de adjuntos; miniatura automática y clic sobre el cuadro en la vista de mosaico. |
| Otros dominios de IONOS (`.com`, `.co.uk`, `.de`, `.fr`, `.it`, `.ca`, `.mx`) | Incluidos, **sin comprobar por dentro** (su `/appsuite/` responde). |
| Otros proveedores con OX App Suite: mailbox.org, STRATO, Hostpoint, home.pl, Hostway, DreamHost | Incluidos, **sin comprobar** (no hay cuenta de prueba; el marcado de los adjuntos podría diferir en versiones antiguas de OX). |
| Cualquier dirección con `/appsuite/` | Opción de compilación `--ox-generico` (la extensión pide entonces permiso sobre todos los sitios). |
| Outlook en la web, Roundcube, Yahoo, Proton, iCloud… | No soportados. Roundcube sería sencillo de añadir; Outlook en la web, difícil. |

Navegadores: cualquier Chromium con Manifest V3 (Chrome, Edge, Brave, Vivaldi…). Solo probado en Brave. Firefox y Safari no están soportados (el lector de DWG necesita una página aislada con `eval` que solo admite Chromium).

## Cómo usarlo

1. **Google Drive:** doble clic (o Intro) sobre un `.dwg`/`.dxf`; o selecciónalo y pulsa **Ver dibujo completo** (o el recuadro de la miniatura) en el panel *Detalles*. Los demás tipos de archivo se abren como siempre.
2. **Gmail:** abre un mensaje con `.dwg`/`.dxf`. Las tarjetas de esos adjuntos muestran su miniatura. Al pulsar un adjunto (o al abrirlo desde una lista de resultados) se abre el panel.
3. **IONOS/OX, vista de lista:** botón **Vista previa CAD** junto al tamaño de cada adjunto. **Vista de mosaico:** la miniatura se carga sola; un clic sobre el cuadro abre el panel.
4. En el panel: **Renderizar** (el dibujo completo; para archivos de más de 8 MB pide confirmación), **Cancelar** (aparece mientras se carga el dibujo: lo descarta y vuelve a la miniatura), **Descargar**, **Cerrar** (o `Esc`). Mientras está abierto, las teclas no llegan a los atajos del correo.
5. El visor abre el dibujo en modo revisión (se puede mirar, medir y buscar; no modificar). La barra de herramientas está en inglés.
6. Si la página tiene algo que claramente es un adjunto CAD y la extensión no lo reconoce (porque el correo o Drive han cambiado su HTML), sale un aviso discreto: **"CADPreview no reconoce este adjunto. Copiar informe"**. El mismo botón aparece en el panel cuando hay un error. El informe es un texto con la versión, el sitio, el navegador y cuántos elementos hay de cada tipo en la página: **sin nombres de archivo, direcciones ni texto del correo**. Solo se copia al portapapeles al pulsar el botón; no se envía a ningún sitio.

## Instalar sin compilar

Cada versión publicada en [*Releases*](../../releases) lleva adjunto un `.zip` ya compilado, para quien no quiera instalar Node.js.

1. Descarga `CADPreview-1.1.zip` y descomprímelo: sale una carpeta `CADPreview-1.1`.
2. En `brave://extensions` (o `chrome://extensions`) activa el **modo desarrollador**, pulsa **Cargar descomprimida** y elige esa carpeta (la que contiene `manifest.json`).
3. Abre Gmail, Drive o tu webmail OX con un mensaje que lleve un `.dwg` o `.dxf`.

Para actualizar, descarga la versión nueva, sustituye la carpeta y pulsa **Recargar** en la tarjeta de la extensión.

- Es una extensión "sin empaquetar": no está en ninguna tienda de extensiones, y el navegador puede avisar al arrancar de que hay extensiones en modo desarrollador.
- El zip está compilado con `--sin-fuentes`: **no lleva ninguna fuente tipográfica**. El visor las descarga del CDN la primera vez que hacen falta (hace falta conexión; sin ella, el texto de algunos planos puede salir con fuentes de sustitución) y el navegador las guarda.
- Para comprobar que el archivo no se ha alterado, compara su SHA-256 con el de las notas de la versión (PowerShell: `Get-FileHash CADPreview-1.1.zip`; Linux y macOS: `sha256sum CADPreview-1.1.zip`).
- El zip incluye `LICENSE` (GPL-3.0) y `THIRD_PARTY_NOTICES.md`. Su código fuente es el de este repositorio, en la etiqueta de esa versión.

## Compilar desde el código

Requisitos: **Node.js 20 o superior** (desarrollado con la 24) y conexión a internet.

```
node construir.mjs
```

Deja la extensión en `trabajo/extension`. Después, en `brave://extensions` (o `chrome://extensions`): activa el modo desarrollador → **Cargar descomprimida** → elige esa carpeta. Tras cambiar el código, vuelve a compilar y pulsa **Recargar** en la tarjeta de la extensión.

Opciones de `construir.mjs`:

- `--sin-fuentes` — no incluye ninguna fuente tipográfica (la extensión pesa unos 24 MB menos). El visor las descarga entonces del CDN la primera vez que hacen falta y el navegador las guarda. **Usa esta opción si vas a redistribuir la extensión compilada**: mira "Fuentes y licencias".
- `--ox-generico` — activa el adaptador de OX App Suite en cualquier dirección https con `/appsuite/`.
- `--prueba` — crea además `trabajo/ext-test`, la copia con permiso en cualquier sitio que usan las pruebas automáticas.

Las dependencias salen de npm con las versiones fijadas en `fuente/package-lock.json` (mlightcad `1.8.0-preview.3`, una versión preliminar; dos de ellas se instalan con `--legacy-peer-deps` porque sus versiones de pares no coinciden con las probadas).

## Versión móvil (PWA)

Además de la extensión, el repositorio incluye una **versión para el móvil**: el mismo visor como página web instalable, con un botón para elegir un `.dwg` o `.dxf` y, una vez instalada, la opción **Compartir con CADPreview** desde otras apps (Gmail, Drive, el gestor de archivos). Todo se procesa en el dispositivo; el archivo no se sube a ningún sitio.

- **Compilar:** `node construir-pwa.mjs` (Node 20 o superior); el sitio queda en `trabajo-pwa/sitio`. No incluye fuentes tipográficas: el visor las baja del CDN la primera vez.
- **Publicar:** el flujo `.github/workflows/pages.yml` lo compila y lo sube a GitHub Pages. Se activa una sola vez en *Settings → Pages → Source: GitHub Actions*.
- **Instalar en Android:** abre la dirección de Pages en Chrome y usa *Instalar aplicación* (o *Añadir a la pantalla de inicio*). El service worker y la instalación solo funcionan en HTTPS (o en `localhost`).
- **Límites:** solo probada la apertura de archivos y el servicio de compartir simulado en un Chrome de escritorio; en un móvil real falta comprobar que Android ofrezca CADPreview para los `.dwg` (depende del tipo MIME con que la app de origen los comparta). No hay miniatura incrustada ni integración en el correo: eso es cosa de la extensión.

## Privacidad

- No hay servidor propio, telemetría ni analítica. En Gmail y OX el adjunto se lee con `fetch` desde la página del correo con tu sesión; en Drive lo lee el service worker de la extensión con la sesión del navegador (ver abajo). En los dos casos se procesa en el navegador.
- La extensión **no declara `permissions`**. Desde la versión 1.1 declara `host_permissions` **solo** para `drive.google.com` y `drive.usercontent.google.com`: Drive no permite que la página lea la descarga (su servidor no envía cabeceras CORS), así que un service worker (`background.js`) la lee a trozos con tu sesión y se la pasa al panel. Ese service worker solo acepta mensajes de la propia extensión y solo pide direcciones de descarga de Drive (de la dirección solo usa el identificador del archivo y la cuenta). En Gmail y OX solo se inyectan scripts en las direcciones del correo.
- "Copiar informe" (autodiagnóstico) solo copia al portapapeles, cuando lo pulsas, un texto con la estructura de la página; no incluye nombres de archivo, direcciones ni contenido del correo, y no se envía a ningún sitio.
- Las únicas peticiones externas posibles son las de las **fuentes tipográficas** a `cdn.jsdelivr.net` (con `--sin-fuentes`, o si un plano usa una fuente que no se incluyó). El CDN ve tu dirección IP y qué fuentes pides, no tu dibujo.

## Fuentes y licencias

El código está bajo **GPL-3.0** (`LICENSE`), porque el lector de DWG (LibreDWG compilado a WebAssembly, vía `@mlightcad/libredwg-converter`) es GPL-3.0. Los demás componentes (visor de mlightcad, three.js, pdf-lib…) están en `THIRD_PARTY_NOTICES.md` con sus licencias.

**Este repositorio no incluye fuentes tipográficas.** La compilación normal las descarga de `mlightcad/cad-data` (versión fija, con huellas SHA-256 en `fuente/fuentes-hash.json`) y las mete en la extensión. Ese repositorio **no declara licencia**, y algunas de las fuentes parecen de terceros (Arial, Verdana, SimSun, fuentes SHX de AutoCAD): para uso propio es un asunto tuyo, pero para publicar una versión compilada usa `--sin-fuentes`. `node actualizar-fuentes.cjs` regenera esa lista.

## Cómo funciona

Resumen (los detalles, y lo que se descubrió por el camino, están en [`docs/NOTAS_TECNICAS.md`](docs/NOTAS_TECNICAS.md)):

- `fuente/extension/core.js` — núcleo común: panel, lectura de la miniatura incrustada (DWG: cabecera del archivo; DXF: sección `THUMBNAILIMAGE` con una petición `Range`), cola y caché de miniaturas.
- `gmail.js`, `ox.js` y `drive.js` — un adaptador por servicio: detectan el adjunto y llaman al núcleo. `drive.js` además registra un lector propio que pide los trozos del archivo al service worker `background.js`.
- El núcleo incluye el botón **Cancelar** del render y el autodiagnóstico (cada adaptador dice cómo contar los adjuntos CAD que no ha reconocido).
- `fuente/src/viewer.ts` — el visor completo (mlightcad `cad-simple-viewer` + plugins de interfaz y de exportación), que se abre en un iframe de la propia extensión. El lector de DWG corre en una página `sandbox` con `eval`, que MV3 prohíbe en las páginas normales.
- `pruebas/` — pruebas automáticas con Playwright contra **réplicas mínimas** de Gmail y de OX (no contra cuentas reales).

## Pruebas

```
node construir.mjs --prueba          # primero
cd pruebas
npm install                          # playwright-core
node crear-muestras.cjs              # muestras públicas con nombres con tildes y ñ
node escenarios.cjs                  # panel: DXF y DWG con y sin miniatura, mensaje y lista
node prueba-ionos.cjs                # adaptador de OX: lista, mosaico, panel, servidor que no responde...
node prueba-gmail-tarjetas.cjs       # miniaturas en las tarjetas de Gmail
node prueba-drive.cjs                # adaptador de Drive: doble clic, Intro, Detalles, enlace, cuadrícula...
node prueba-cancelar-diagnostico.cjs # botón Cancelar y autodiagnóstico (réplica de Drive)
node prueba-diagnostico-gmail-ox.cjs # autodiagnóstico en las réplicas de Gmail y OX
node test_nombres.js && node test_dxf.js
```

Usan Brave en `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (otro navegador o ruta: variable `NAVEGADOR`). Las réplicas copian lo que se vio en Gmail, Drive y OX; no sustituyen probar con una cuenta real.

## Límites conocidos

- Los DWG grandes tardan en renderizarse (un DWG de 18 MB: de 50 s a más de un minuto con WebGL por software); por eso el panel enseña primero la miniatura y pide confirmación por encima de 8 MB.
- Gmail, Drive y OX pueden cambiar su HTML: la detección de adjuntos depende de él (para eso está el aviso con "Copiar informe").
- En Drive no hay botón en cada fila de la lista (parpadeaba): se abre con doble clic o Intro, o desde el panel *Detalles*. Una selección de varios archivos no se intercepta.
- Dentro del iframe, Brave bloquea IndexedDB y Cache Storage; la extensión lo compensa con una copia de IndexedDB en memoria (para exportar a PDF) y, para las fuentes, con la caché HTTP del navegador.
- Con `--sin-fuentes`, la consola del navegador muestra algún "Failed to load resource" (la extensión prueba primero la fuente local, que no existe, y después la descarga del CDN); es inofensivo.
- Solo se leen miniaturas de DWG desde AC1012 y de DXF ASCII de R2000 en adelante; otros archivos solo se pueden renderizar.

---

## English summary

CADPreview is a Chromium (Manifest V3) extension that previews **DWG/DXF attachments in webmail** without downloading them: it first shows the thumbnail embedded in the file (also directly on the attachment cards), and a **Render** button opens the full drawing in a viewer (zoom, layers, text search, measuring, export to HTML/PDF/SVG). Everything runs in your browser using your existing session; nothing is sent to any server. Supported: **Gmail**, **Google Drive** and **OX App Suite webmail (IONOS tested; mailbox.org, STRATO, Hostpoint, home.pl, Hostway, DreamHost included but untested)**. Only tested in Brave on Windows. Since 1.1 the extension declares `host_permissions` only for `drive.google.com` and `drive.usercontent.google.com` (a service worker reads Drive downloads, which the page itself cannot); it declares no `permissions`. A **Cancel** button stops a render in progress, and if the page contains a CAD attachment the extension cannot recognise, a notice offers a structure-only diagnostic report (no file names, URLs or mail text) that is only copied to the clipboard when you press the button.

A prebuilt zip (built with `--sin-fuentes`, i.e. without font files) is attached to each GitHub release: unzip it and load the folder as an unpacked extension. To build it yourself: `node construir.mjs` (Node 20+), then load `trabajo/extension`. Use `--sin-fuentes` to build without bundling any font files (recommended for redistribution; the fonts come from a third-party repository with no declared license). Licensed under **GPL-3.0** because it includes LibreDWG compiled to WebAssembly; see `THIRD_PARTY_NOTICES.md`. Technical notes are in `docs/NOTAS_TECNICAS.md` (Spanish).
