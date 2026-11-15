// Construye la versión móvil (PWA) de CADPreview a partir de ".\fuente" y la deja lista para publicar en una carpeta.
// Uso:  node construir-pwa.mjs
// Variable opcional: CADPREVIEW_TRABAJO_PWA (por defecto la carpeta "trabajo-pwa" del repositorio). El sitio queda en "<trabajo>/sitio".
// La PWA no incluye ninguna fuente tipográfica: el visor las descarga del CDN la primera vez y el navegador las guarda.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(AQUI, 'fuente');
const TRABAJO = process.env.CADPREVIEW_TRABAJO_PWA || path.join(AQUI, 'trabajo-pwa');
const BUILD = path.join(TRABAJO, 'build');
const SITIO = path.join(TRABAJO, 'sitio');
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

// 1) copiar la fuente a la carpeta de compilación (node_modules se conserva)
console.log('1/4 Copiando la fuente…');
fs.mkdirSync(BUILD, { recursive: true });
for (const f of ['package.json', 'package-lock.json', 'vite.pwa.config.ts', 'pwa.html']) fs.copyFileSync(path.join(FUENTE, f), path.join(BUILD, f));
for (const d of ['src', 'public', 'public-pwa']) {
  fs.rmSync(path.join(BUILD, d), { recursive: true, force: true });
  fs.cpSync(path.join(FUENTE, d), path.join(BUILD, d), { recursive: true });
}

// 2) dependencias (solo paquetes publicados en npm, versiones fijadas)
console.log('2/4 Instalando dependencias…');
run('npm install --legacy-peer-deps --no-audit --no-fund', BUILD);

// 3) compilar el visor
console.log('3/4 Compilando…');
run('npx vite build -c vite.pwa.config.ts', BUILD, { CADPREVIEW_OUT: SITIO });
fs.renameSync(path.join(SITIO, 'pwa.html'), path.join(SITIO, 'index.html'));
fs.writeFileSync(path.join(SITIO, '.nojekyll'), '');

// 4) service worker: lista de archivos que se dejan en caché al instalar y versión (huella del contenido)
console.log('4/4 Service worker…');
const lista = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? lista(path.join(dir, e.name), base + e.name + '/') : [base + e.name]);
const todos = lista(SITIO).filter((f) => f !== 'sw.js' && f !== '.nojekyll').sort();
// Los bloques que solo se usan al exportar (PDF, visor del HTML exportado) se guardan la primera vez que se piden
const precache = ['./', ...todos.filter((f) => !/^assets\/cad-pdf-plugin-/.test(f) && f !== 'viewer-runtime.iife.js').map((f) => './' + f)];
const hash = createHash('sha256');
for (const f of todos) { hash.update(f); hash.update(fs.readFileSync(path.join(SITIO, f))); }
const version = hash.digest('hex').slice(0, 12);
const rutaSw = path.join(SITIO, 'sw.js');
let sw = fs.readFileSync(rutaSw, 'utf8');
if (!sw.includes('/*__PRECACHE__*/[]') || !sw.includes("'__VERSION__'")) throw new Error('sw.js no tiene los marcadores esperados');
sw = sw.replace('/*__PRECACHE__*/[]', JSON.stringify(precache, null, 1)).replace("'__VERSION__'", JSON.stringify(version));
fs.writeFileSync(rutaSw, sw);
const mb = (n) => (n / 1048576).toFixed(1);
const tam = (fs2) => fs2.reduce((a, f) => a + fs.statSync(path.join(SITIO, f)).size, 0);
console.log(`Listo: ${SITIO}\n  ${todos.length} archivos (${mb(tam(todos))} MB), ${precache.length} en caché al instalar (versión ${version}).`);
