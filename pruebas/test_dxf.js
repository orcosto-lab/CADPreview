// Prueba del análisis de la sección THUMBNAILIMAGE de un DXF (parseDxfThumbnail de core.js (fase C)).
// Uso: node test_dxf.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'fuente', 'extension', 'core.js'), 'utf8');
const bloque = src.split('// <<dxf')[1].split('// dxf>>')[0];
const { parseDxfThumbnail } = new Function(bloque + '; return { parseDxfThumbnail };')();

// DIB de 2×2 píxeles, 24 bits (cabecera BITMAPINFOHEADER de 40 bytes + 2 filas de 8 bytes)
function dib2x2() {
  const b = Buffer.alloc(56);
  b.writeUInt32LE(40, 0); b.writeInt32LE(2, 4); b.writeInt32LE(2, 8);
  b.writeUInt16LE(1, 12); b.writeUInt16LE(24, 14); b.writeUInt32LE(0, 16); b.writeUInt32LE(16, 20);
  for (let i = 40; i < 56; i++) b[i] = i; // píxeles reconocibles
  return b;
}
function seccion(dib, { declared = dib.length, eol = '\n', trozo = 16 } = {}) {
  const hex = dib.toString('hex').toUpperCase();
  let s = ['  0', 'SECTION', '  2', 'THUMBNAILIMAGE', ' 90', String(declared)].join(eol) + eol;
  for (let i = 0; i < hex.length; i += trozo * 2) s += '310' + eol + hex.slice(i, i + trozo * 2) + eol;
  return s + ['  0', 'ENDSEC', '  0', 'EOF'].join(eol) + eol;
}
// Parte inicial con códigos 90 y 310 ajenos a la sección, como en un DXF real
const antes = ['  0', 'SECTION', '  2', 'OBJECTS', ' 90', '7', '310', 'DEADBEEF', '  0', 'ENDSEC'].join('\n') + '\n';

let fallos = 0;
function caso(nombre, cond) { if (!cond) fallos++; console.log((cond ? 'OK    ' : 'FALLO ') + nombre); }

const d = dib2x2();
let p = parseDxfThumbnail(antes + seccion(d));
caso('lee un DIB válido y recupera los mismos bytes', p.dib && Buffer.from(p.dib).equals(d) && !p.truncated && p.declared === 56);

p = parseDxfThumbnail(antes + seccion(d, { eol: '\r\n' }));
caso('acepta saltos de línea CRLF', p.dib && Buffer.from(p.dib).equals(d));

p = parseDxfThumbnail(antes + seccion(d, { trozo: 1 }));
caso('acepta líneas 310 de 1 byte', p.dib && Buffer.from(p.dib).equals(d));

p = parseDxfThumbnail(seccion(d).replace(/310\r?\n[0-9A-F]+\r?\n$/m, '')); // sin cortar nada importante
caso('solo con la sección (tramo final del archivo)', !!p.dib || !!p.truncated);

p = parseDxfThumbnail(antes + '  0\nEOF\n');
caso('sin THUMBNAILIMAGE → missing', p.missing === true);

p = parseDxfThumbnail('  0\nSECTION\n  2\nTHUMBNAILIMAGE\n 90\n0\n  0\nENDSEC\n  0\nEOF\n');
caso('sección sin datos 310 → empty', p.empty === true);

p = parseDxfThumbnail(antes + seccion(d, { declared: 100 }));
caso('menos bytes de los declarados → truncated', p.truncated === true);

p = parseDxfThumbnail(antes + seccion(d).replace('310\n', '310\nZZ'));
caso('hexadecimal dañado → corrupt', p.corrupt === true);

const raro = Buffer.from(d); raro.writeUInt32LE(12, 0);
p = parseDxfThumbnail(antes + seccion(raro));
caso('cabecera DIB desconocida → corrupt', p.corrupt === true);

console.log(fallos ? fallos + ' fallo(s)' : 'Todas las pruebas correctas');
process.exit(fallos ? 1 : 0);
