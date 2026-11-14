// Construye la extensión CADPreview a partir de ".\fuente" y la deja en la carpeta de trabajo.
// Uso:  node construir.mjs [--prueba]
//   --ox-generico  el adaptador de OX se activa en cualquier dirección https con /appsuite/ (la extensión pide permiso sobre todos los sitios)
//   --sin-fuentes  no incluye ninguna fuente tipográfica en la extensión (la compilada pesa unos 24 MB menos); el visor las baja del CDN
//   --prueba  además crea "ext-test" (copia con permiso en cualquier origen, para las pruebas automáticas).
// Variable opcional: CADPREVIEW_TRABAJO (por defecto la carpeta "trabajo" del repositorio).
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(AQUI, 'fuente');
const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(AQUI, 'trabajo');
const BUILD = path.join(TRABAJO, 'build');
const EXT = path.join(TRABAJO, 'extension');
const EXT_TEST = path.join(TRABAJO, 'ext-test');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

// 1) copiar la fuente a la carpeta de compilación (node_modules y datos se conservan)
console.log('1/5 Copiando la fuente…');
fs.mkdirSync(BUILD, { recursive: true });
for (const f of ['package.json', 'package-lock.json', 'vite.config.ts', 'viewer.html']) fs.copyFileSync(path.join(FUENTE, f), path.join(BUILD, f));
for (const d of ['src', 'public']) {
  fs.rmSync(path.join(BUILD, d), { recursive: true, force: true });
  fs.cpSync(path.join(FUENTE, d), path.join(BUILD, d), { recursive: true });
}

// 2) dependencias (solo paquetes publicados en npm, versiones fijadas)
console.log('2/5 Instalando dependencias…');
run('npm install --legacy-peer-deps --no-audit --no-fund', BUILD);

// 3) fuentes incluidas: se descargan de la versión fija y se verifican con su huella SHA-256
console.log('3/5 Fuentes incluidas…');
const sinFuentes = process.argv.includes('--sin-fuentes');
if (sinFuentes) {
  // la carpeta debe existir (Vite copia datos/fonts/*): lleva solo una nota
  const dirVacia = path.join(BUILD, 'datos', 'fonts');
  fs.rmSync(path.join(BUILD, 'datos'), { recursive: true, force: true });
  fs.mkdirSync(dirVacia, { recursive: true });
  fs.writeFileSync(path.join(dirVacia, 'LEEME.txt'), 'Compilada con --sin-fuentes: no se incluye ninguna fuente tipografica. El visor las descarga una vez de cdn.jsdelivr.net y el navegador las guarda.\n');
  console.log('   --sin-fuentes: no se incluye ninguna fuente (se descargarán del CDN la primera vez que hagan falta)');
} else {
  const commit = /FONT_COMMIT = '([0-9a-f]{40})'/.exec(fs.readFileSync(path.join(FUENTE, 'src', 'font-shim.js'), 'utf8'))[1];
  const huellas = JSON.parse(fs.readFileSync(path.join(FUENTE, 'fuentes-hash.json'), 'utf8').replace(/^\uFEFF/, ''));
  const dirFonts = path.join(BUILD, 'datos', 'fonts');
  fs.rmSync(path.join(BUILD, 'datos'), { recursive: true, force: true });
  fs.mkdirSync(dirFonts, { recursive: true });
  const cacheFuentes = path.join(TRABAJO, 'fuentes-descargadas', 'fonts');
  let totalFuentes = 0;
  for (const h of huellas) {
    const nombre = path.basename(h.nombre);
    const destino = path.join(dirFonts, nombre);
    const previa = path.join(cacheFuentes, nombre);
    let datos = fs.existsSync(previa) ? fs.readFileSync(previa) : null;
    if (!datos || sha(datos) !== h.sha256) {
      // hay nombres con espacios y "@": cada tramo de la ruta va codificado
      const url = `https://cdn.jsdelivr.net/gh/mlightcad/cad-data@${commit}/${h.nombre.split('/').map(encodeURIComponent).join('/')}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`No se pudo descargar ${h.nombre}: HTTP ${r.status}`);
      datos = Buffer.from(await r.arrayBuffer());
    }
    if (sha(datos) !== h.sha256) throw new Error(`La huella de ${h.nombre} no coincide con fuentes-hash.json`);
    fs.writeFileSync(destino, datos);
    totalFuentes += datos.length;
  }
  console.log(`   ${huellas.length} fuentes verificadas (${(totalFuentes / 1048576).toFixed(1)} MB)`);
  // la lista de fuentes del código debe coincidir con la de las huellas
  const enCodigo = /INCLUIDAS = new Set\(\[([^\]]+)\]\)/.exec(fs.readFileSync(path.join(FUENTE, 'src', 'font-shim.js'), 'utf8'))[1].match(/'([^']+)'/g).map(s => s.slice(1, -1)).sort();
  const enHuellas = huellas.map(h => path.basename(h.nombre)).sort();
  if (JSON.stringify(enCodigo) !== JSON.stringify(enHuellas)) throw new Error('INCLUIDAS (font-shim.js) no coincide con fuentes-hash.json');
}

// 4) visor (Vite)
console.log('4/5 Compilando el visor…');
run('npx vite build', BUILD, { CADPREVIEW_OUT: path.join(EXT, 'viewer') });

// 5) script de contenido, puente y manifest
console.log('5/5 Script de contenido y manifest…');
for (const viejo of ['content.js', 'ionos.js']) { fs.rmSync(path.join(EXT, viejo), { force: true }); fs.rmSync(path.join(EXT_TEST, viejo), { force: true }); } // restos de versiones anteriores
for (const f of ['bridge.js', 'core.js', 'gmail.js', 'ox.js', 'drive.js', 'background.js']) fs.copyFileSync(path.join(FUENTE, 'extension', f), path.join(EXT, f));
const envOx = process.argv.includes('--ox-generico') ? { CADPREVIEW_OX_GENERICO: '1' } : {};
run(`node "${path.join(FUENTE, 'extension', 'generar-manifest.cjs')}" "${EXT}"`, FUENTE, envOx);

if (process.argv.includes('--prueba')) {
  fs.mkdirSync(EXT_TEST, { recursive: true });
  for (const f of ['bridge.js', 'core.js', 'gmail.js', 'ox.js', 'drive.js', 'background.js']) fs.copyFileSync(path.join(EXT, f), path.join(EXT_TEST, f));
  run(`node "${path.join(FUENTE, 'extension', 'generar-manifest.cjs')}" "${EXT_TEST}" "<all_urls>"`, FUENTE);
  const enlace = path.join(EXT_TEST, 'viewer');
  if (!fs.existsSync(enlace)) fs.symlinkSync(path.join(EXT, 'viewer'), enlace, 'junction');
  console.log('   ext-test listo: ' + EXT_TEST);
}

const total = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? total(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`\nListo. Extensión en: ${EXT}  (${(total(EXT) / 1048576).toFixed(1)} MB)`);
