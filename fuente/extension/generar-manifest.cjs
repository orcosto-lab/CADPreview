// Genera manifest.json de CADPreview con una clave fija (ID de extensión estable).
// Uso: node generar-manifest.cjs <carpeta_salida> [patrón_de_coincidencia_extra]
//   El patrón extra (p. ej. "<all_urls>") solo se usa en la copia de pruebas automáticas.
const { generateKeyPairSync, createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const keyFile = path.join(__dirname, 'clave-publica.b64'); // solo clave pública; el ID sale de ella
let b64;
if (fs.existsSync(keyFile)) b64 = fs.readFileSync(keyFile, 'utf8').trim();
else {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  b64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  fs.writeFileSync(keyFile, b64);
}
const hex = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
const id = [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

// npm exige tres números (1.0.0); en el manifest se escribe "1.0" (se quita el ".0" final de X.Y.0)
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version.replace(/^(\d+\.\d+)\.0$/, '$1');
const out = path.resolve(process.argv[2] || '.');
const extra = process.argv[3] ? [process.argv[3]] : [];

// Un adaptador por sitio (cada uno carga primero el núcleo, core.js).
// IONOS: email.ionos.es está comprobado; los demás dominios responden en /appsuite/ pero no se ha visto su interfaz.
const DOMINIOS_IONOS = ['es', 'com', 'co.uk', 'de', 'fr', 'it', 'ca', 'mx'];
// Otros proveedores con OX App Suite: responden en /appsuite/ con la pantalla de acceso de OX (mailbox.org, home.pl, Hostway: OX 7.10) o
// con una pantalla parecida a la de IONOS (STRATO, Hostpoint, DreamHost). Ninguno está comprobado por dentro.
const OTROS_OX = ['office.mailbox.org', 'webmail.strato.de', 'office.hostpoint.ch', 'webmail.home.pl', 'webmail.hostway.com', 'webmail.dreamhost.com'];
// CADPREVIEW_OX_GENERICO=1 (node construir.mjs --ox-generico): cualquier dirección https con /appsuite/. Más cómodo, pero la
// extensión pide permiso sobre todos los sitios; para uso personal.
const OX_GENERICO = process.env.CADPREVIEW_OX_GENERICO === '1';
const MATCHES_OX = OX_GENERICO ? ['https://*/appsuite/*'] : [...DOMINIOS_IONOS.map(d => `https://email.ionos.${d}/appsuite/*`), ...OTROS_OX.map(h => `https://${h}/appsuite/*`)];
// Gmail y OX corren en el mundo de la página (necesitan sus variables y la sesión del correo). Drive (v1.1) corre en el mundo
// aislado: necesita chrome.runtime para hablar con el service worker, que lee Drive sin CORS (ver background.js y drive.js).
const SITIOS = [
  { matches: ['https://mail.google.com/*'], js: ['core.js', 'gmail.js'], world: 'MAIN' },
  { matches: MATCHES_OX, js: ['core.js', 'ox.js'], world: 'MAIN' },
  { matches: ['https://drive.google.com/*'], js: ['core.js', 'drive.js'], world: 'ISOLATED' }
];
// Solo el service worker lee estos servidores (sin CORS y con las cookies de la sesión)
const HOSTS_DRIVE = ['https://drive.google.com/*', 'https://drive.usercontent.google.com/*'];
const todas = [...new Set(SITIOS.flatMap(s => s.matches))];

const manifest = {
  manifest_version: 3,
  name: 'CADPreview',
  version,
  description: 'Vista previa de archivos DWG y DXF en Gmail, Google Drive e IONOS/OX: miniatura al instante y botón Renderizar para el dibujo completo.',
  key: b64,
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_title: 'CADPreview', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } },
  background: { service_worker: 'background.js' },
  host_permissions: HOSTS_DRIVE,
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    // Página aislada (sandbox) para el lector de DWG: LibreDWG necesita 'unsafe-eval', prohibido en páginas normales.
    sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'self'"
  },
  sandbox: { pages: ['viewer/parser-sandbox.html'] },
  content_scripts: [
    // puente en el mundo aislado: deja la URL del visor en el DOM
    { matches: [...todas, ...extra], js: ['bridge.js'], run_at: 'document_start' },
    // un script principal por sitio (el mundo de cada uno se indica en SITIOS)
    // Chrome no vuelve a inyectar un mismo archivo (core.js) en una página donde otra entrada ya lo cargó: con el patrón extra de
    // pruebas, los adaptadores de Gmail/OX atraparían Drive y su núcleo (mundo página) dejaría a drive.js sin núcleo (mundo aislado).
    ...SITIOS.map(s => ({ matches: [...s.matches, ...extra], js: s.js, run_at: 'document_idle', world: s.world,
      ...(s.js.includes('drive.js') ? {} : { exclude_matches: ['https://drive.google.com/*'] }) }))
  ],
  // en web_accessible_resources solo se admiten patrones de origen (ruta /*), no /appsuite/*
  web_accessible_resources: [{ resources: ['viewer/*'], matches: [...new Set(todas.map(m => m.replace(/^(https:\/\/[^/]+)\/.*$/, '$1/*'))), ...extra] }]
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(out, 'id-extension.txt'), id);
console.log('ID de la extensión: ' + id + ' (versión ' + version + ')' + (OX_GENERICO ? ' [OX genérico: https://*/appsuite/*]' : ''));
