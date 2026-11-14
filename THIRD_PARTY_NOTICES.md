# Avisos de terceros

CADPreview se distribuye bajo **GPL-3.0** (ver `LICENSE`). La extensión compilada incluye o carga los componentes de terceros de esta lista,
cada uno con su propia licencia (lista generada de `fuente/package-lock.json`, solo dependencias de producción):

| Paquete | Versión | Licencia | Dirección |
|---|---|---|---|
| @lukeed/csprng | 1.1.0 | MIT | lukeed/csprng |
| @mlightcad/cad-html-core | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-html-plugin | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-pdf-core | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-pdf-plugin | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-simple-ui-plugin | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-simple-viewer | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/cad-svg-plugin | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/common | 1.15.25 | MIT | https://github.com/mlightcad/realdwg-web |
| @mlightcad/data-model | 1.15.25 | MIT | https://github.com/mlightcad/realdwg-web |
| @mlightcad/emf-converter | 1.15.25 | Apache-2.0 | https://github.com/mlightcad/realdwg-web |
| @mlightcad/geometry-engine | 3.15.25 | MIT | https://github.com/mlightcad/realdwg-web |
| @mlightcad/graphic-interface | 3.15.25 | MIT | https://github.com/mlightcad/realdwg-web |
| @mlightcad/libredwg-converter | 3.15.25 | GPL-3.0 | https://github.com/mlightcad/realdwg-web |
| @mlightcad/libredwg-web | 0.8.8 | GPL-3.0 | https://github.com/mlightcad/libredwg-web |
| @mlightcad/mtext-parser | 1.5.7 | MIT | https://github.com/mlightcad/mtext-parser |
| @mlightcad/mtext-renderer | 0.13.9 | MIT | https://github.com/mlightcad/mtext-renderer |
| @mlightcad/pdf-renderer | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @mlightcad/shx-parser | 1.4.5 | MIT | https://github.com/mlightcad/shx-parser |
| @mlightcad/three-renderer | 1.8.0-preview.3 | MIT | https://github.com/mlightcad/cad-viewer |
| @pdf-lib/fontkit | 1.1.1 | MIT | https://github.com/Hopding/fontkit |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | https://github.com/Hopding/standard-fonts |
| @pdf-lib/upng | 1.0.1 | MIT | https://github.com/Hopding/upng |
| @velipso/polybool | 1.1.1 | 0BSD | https://github.com/velipso/polybool |
| fake-indexeddb | 6.2.8 | Apache-2.0 | https://github.com/dumbmatter/fakeIndexedDB |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| iconv-lite | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite |
| idb | 8.0.4 | ISC | https://github.com/jakearchibald/idb |
| lodash-es | 4.17.21 | MIT | lodash/lodash |
| loglevel | 1.9.2 | MIT | https://github.com/pimterry/loglevel |
| opentype.js | 2.0.0 | MIT | https://github.com/opentypejs/opentype.js |
| pako | 1.0.11 | (MIT AND Zlib) | nodeca/pako |
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer |
| three | 0.186.1 | MIT | https://github.com/mrdoob/three.js |
| tslib | 1.14.1 | 0BSD | https://github.com/Microsoft/tslib |
| tslib | 2.9.1 | 0BSD | https://github.com/Microsoft/tslib |
| uid | 2.0.2 | MIT | lukeed/uid |

## Componentes con GPL

- **@mlightcad/libredwg-converter** 3.15.25 (GPL-3.0): el lector de archivos DWG (LibreDWG compilado a WebAssembly y su conversor). Por eso CADPreview, como obra combinada, se publica bajo GPL-3.0.
- **@mlightcad/libredwg-web** 0.8.8 (GPL-3.0): el lector de archivos DWG (LibreDWG compilado a WebAssembly y su conversor). Por eso CADPreview, como obra combinada, se publica bajo GPL-3.0.

## Fuentes tipográficas

Este repositorio **no contiene ninguna fuente tipográfica**. `construir.mjs` puede descargar (de `github.com/mlightcad/cad-data`, vía jsDelivr, con la versión
fijada en `fuente/src/font-shim.js` y comprobando las huellas de `fuente/fuentes-hash.json`) las fuentes que usa el visor para dibujar los textos de los planos
(archivos SHX y tipos de letra como Arial, Verdana o SimSun) e incluirlas en la extensión compilada. **Ese repositorio no declara licencia y su README dice que
conseguir la licencia de esos datos es responsabilidad de quien los use.** Si vas a redistribuir la extensión compilada, usa `node construir.mjs --sin-fuentes`:
el visor las descarga entonces una sola vez del CDN cuando hacen falta.
