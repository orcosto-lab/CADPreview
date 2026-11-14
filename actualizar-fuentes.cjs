// Prepara la lista de fuentes que se incluyen en la extensión: todas las del catálogo del visor (fonts.json) de la
// versión fija de mlightcad/cad-data, menos las excluidas. Descarga las que falten, calcula su huella SHA-256 y
// reescribe fuente\fuentes-hash.json y la lista INCLUIDAS de fuente\src\font-shim.js.
// Uso: node actualizar-fuentes.cjs
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, 'trabajo');
const DESCARGAS = path.join(TRABAJO, 'fuentes-descargadas', 'fonts');
const SHIM = path.join(__dirname, 'fuente', 'src', 'font-shim.js');
const HUELLAS = path.join(__dirname, 'fuente', 'fuentes-hash.json');
// Tipografías de sistema chinas/japonesas de 4-9 MB cada una (suman 19,3 MB): solo hacen falta con texto CJK
const EXCLUIDAS = ['msyh.woff', 'simfang.woff', 'msgothic.woff'];
const sha = (b) => createHash('sha256').update(b).digest('hex');

(async () => {
  const commit = /FONT_COMMIT = '([0-9a-f]{40})'/.exec(fs.readFileSync(SHIM, 'utf8'))[1];
  fs.mkdirSync(DESCARGAS, { recursive: true });
  const base = `https://cdn.jsdelivr.net/gh/mlightcad/cad-data@${commit}/fonts/`;
  const bajar = async (nombre) => {
    const destino = path.join(DESCARGAS, nombre);
    if (fs.existsSync(destino) && fs.statSync(destino).size > 0) return fs.readFileSync(destino);
    const r = await fetch(base + encodeURIComponent(nombre));
    if (!r.ok) return null;
    const datos = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(destino, datos);
    return datos;
  };
  const catalogo = JSON.parse((await bajar('fonts.json')).toString('utf8').replace(/^\uFEFF/, ''));
  const nombres = [...new Set(catalogo.map(e => e.file))].filter(n => !EXCLUIDAS.includes(n)).sort((a, b) => a.localeCompare(b));
  nombres.push('fonts.json');
  const huellas = [], faltan = [];
  for (const n of nombres) {
    const datos = await bajar(n);
    if (!datos) { faltan.push(n); continue; }
    huellas.push({ nombre: 'fonts/' + n, bytes: datos.length, sha256: sha(datos) });
  }
  const total = huellas.reduce((s, h) => s + h.bytes, 0);
  fs.writeFileSync(HUELLAS, JSON.stringify(huellas, null, 2));

  const lineas = [];
  for (let i = 0; i < huellas.length; i += 5) lineas.push('  ' + huellas.slice(i, i + 5).map(h => `'${h.nombre.replace(/^fonts\//, '')}'`).join(', '));
  let s = fs.readFileSync(SHIM, 'utf8');
  s = s.replace(/new Set\(\[[^\]]+\]\)/, `new Set([\n${lineas.join(',\n')}\n])`);
  s = s.replace(/^\/\/ Fuentes del visor:[^\n]*\n/, `// Fuentes del visor: las ${huellas.length} del catálogo (fonts.json, ${(total / 1048576).toFixed(1).replace('.', ',')} MB; sin ${EXCLUIDAS.join(', ')}) van incluidas en la\n// extensión (viewer/data/fonts); si un plano pide otra,\n`);
  fs.writeFileSync(SHIM, s);
  console.log(`Fuentes incluidas: ${huellas.length} (${(total / 1048576).toFixed(1)} MB). Excluidas: ${EXCLUIDAS.join(', ')}.`);
  if (faltan.length) console.log('No existen en esa versión: ' + faltan.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
