// Ejecuta una serie de escenarios con prueba-panel.js y resume cada uno en una línea.
// Uso: node escenarios.cjs [nombre_de_escenario ...]   (sin argumentos: todos los rápidos)
// Muestras sin datos de clientes en <trabajo>\muestras (ver crear-muestras.cjs).
const { spawnSync } = require('child_process');
const path = require('path');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
const M = path.join(TRABAJO, 'muestras');
const ESC = {
  'dxf-sin-miniatura-mensaje': [path.join(M, 'Cañón Pérez ñandú.dxf'), '--render'],
  'dxf-con-miniatura-mensaje': [path.join(M, 'Cañón Pérez ñandú con miniatura.dxf'), '--render'],
  'dxf-con-miniatura-lista': [path.join(M, 'Cañón Pérez ñandú con miniatura.dxf'), '--lista', '--render'],
  'dwg-publico-lista': [path.join(M, 'Cañón Pérez ñandú.dwg'), '--lista', '--render'],
  'dwg-sin-miniatura-mensaje': [path.join(M, 'Cañón Pérez ñandú sin miniatura.dwg'), '--render'],
};
const rapidos = Object.keys(ESC).filter(k => !k.includes('grande'));
const lista = process.argv.slice(2).length ? process.argv.slice(2) : rapidos;

for (const nombre of lista) {
  const a = ESC[nombre];
  if (!a) { console.log(nombre + ': escenario desconocido'); continue; }
  const r = spawnSync('node', [path.join(__dirname, 'prueba-panel.js'), ...a, '--tag', nombre], { encoding: 'utf8', maxBuffer: 1 << 26 });
  let j; try { j = JSON.parse(r.stdout); } catch (e) { console.log(`${nombre}: SIN RESULTADO ${(r.stderr || r.stdout).slice(0, 200)}`); continue; }
  const i = j.alAbrir || {}, f = j.alRenderizar || {};
  console.log([
    nombre.padEnd(28),
    'inicial=' + (i.estado || '-'), 'mini=' + (i.miniatura || '-'), 'tam=' + (i.tamano ? (i.tamano / 1048576).toFixed(1) + 'MB' : '-'),
    'render=' + (f.estado || (j.aviso ? 'aviso' : '-')), 'abierto=' + (j.hastaAbiertoMs ?? '-') + 'ms', 'pintado=' + (j.hastaPintadoMs ?? '-') + 'ms',
    'titulo="' + (i.titulo || '') + '"', 'jsdelivr=' + (j.peticionesAJsDelivr || []).length,
    j.error ? 'ERROR=' + j.error : '', (j.errores || []).length ? 'consola=' + j.errores.join('|').slice(0, 120) : '',
    j.aviso ? 'AVISO="' + j.aviso + '"' : '',
  ].filter(Boolean).join('  '));
  const fu = j.fuentes || [];
  if (fu.length) {
    const por = {}; fu.forEach(l => { const o = l.split(' ')[0]; por[o] = (por[o] || 0) + 1; });
    console.log('    fuentes: ' + Object.entries(por).map(([o, n]) => o + '×' + n).join(', ') + (por.cdn ? '  (CDN: ' + fu.filter(l => l.startsWith('cdn')).map(l => l.split(' ').slice(1, 3).join(' ')).join('; ') + ')' : ''));
  }
}
