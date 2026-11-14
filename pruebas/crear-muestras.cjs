// Prepara muestras de prueba SIN datos de clientes, con nombres con tildes y ñ, en <trabajo>\muestras:
//  - "Cañón Pérez ñandú.dwg"                : copia de la muestra pública canteen.dwg
//  - "Cañón Pérez ñandú.dxf"                : copia de la muestra pública hatch.dxf (sin miniatura)
//  - "Cañón Pérez ñandú con miniatura.dxf"  : hatch.dxf + sección THUMBNAILIMAGE sintética (degradado 128×64, 24 bits)
// Las muestras públicas salen del repositorio mlightcad/cad-data (se descargan si faltan).
const fs = require('fs');
const path = require('path');
const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
const DIR = path.join(TRABAJO, 'muestras');
fs.mkdirSync(DIR, { recursive: true });

async function publica(nombre) {
  const destino = path.join(DIR, nombre);
  if (!fs.existsSync(destino)) {
    const r = await fetch('https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/data/' + nombre);
    if (!r.ok) throw new Error('No se pudo descargar ' + nombre);
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  }
  return fs.readFileSync(destino);
}

(async () => {
  const dwg = await publica('canteen.dwg');
  const dxf = await publica('hatch.dxf');
  fs.writeFileSync(path.join(DIR, 'Cañón Pérez ñandú.dwg'), dwg);
  fs.writeFileSync(path.join(DIR, 'Cañón Pérez ñandú.dxf'), dxf);

  // DIB sintético 128×64, 24 bits (filas de 384 bytes, ya alineadas a 4)
  const w = 128, h = 64, fila = w * 3, dib = Buffer.alloc(40 + fila * h);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(w, 4); dib.writeInt32LE(h, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(24, 14);
  dib.writeUInt32LE(fila * h, 20);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 40 + y * fila + x * 3; dib[o] = x * 2; dib[o + 1] = y * 4; dib[o + 2] = 255 - x * 2; }
  const hex = dib.toString('hex').toUpperCase();
  let sec = '  0\r\nSECTION\r\n  2\r\nTHUMBNAILIMAGE\r\n 90\r\n' + dib.length + '\r\n';
  for (let i = 0; i < hex.length; i += 128) sec += '310\r\n' + hex.slice(i, i + 128) + '\r\n';
  sec += '  0\r\nENDSEC\r\n';
  // hatch.dxf trae su propia miniatura (512×512): se quita para controlar qué hay en cada muestra
  const sinMini = dxf.toString('latin1').replace(/\r?\n\s*0\r?\nSECTION\r?\n\s*2\r?\nTHUMBNAILIMAGE[\s\S]*?\r?\n\s*0\r?\nENDSEC/, '').replace(/\r?\n\s*0\r?\nEOF\s*$/, '\r\n');
  if (/THUMBNAILIMAGE/.test(sinMini)) throw new Error('No se pudo quitar la miniatura de hatch.dxf');
  fs.writeFileSync(path.join(DIR, 'Cañón Pérez ñandú.dxf'), Buffer.from(sinMini + '  0\r\nEOF\r\n', 'latin1'));            // sin miniatura
  fs.writeFileSync(path.join(DIR, 'Cañón Pérez ñandú con miniatura.dxf'), Buffer.from(sinMini + sec + '  0\r\nEOF\r\n', 'latin1')); // miniatura sintética 128×64
  // DWG sin miniatura: se anula el puntero a la imagen de la cabecera (offset 0x0D)
  const dwgSin = Buffer.from(dwg); dwgSin.writeInt32LE(0, 0x0D);
  fs.writeFileSync(path.join(DIR, 'Cañón Pérez ñandú sin miniatura.dwg'), dwgSin);
  // DXF mínimo (R12) con un texto de estilo ROMANS, para las pruebas que necesitan un archivo más
  fs.writeFileSync(path.join(DIR, 'fuente-extra.dxf'), "  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1009\n  0\nENDSEC\n  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nSTYLE\n 70\n     1\n  0\nSTYLE\n  2\nROMANS\n 70\n     0\n 40\n0.0\n 41\n1.0\n 50\n0.0\n 71\n     0\n 42\n2.5\n  3\nromans.shx\n  4\n\n  0\nENDTAB\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n  0\nTEXT\n  8\n0\n 10\n0.0\n 20\n0.0\n 30\n0.0\n 40\n2.5\n  1\nPrueba con fuente extra romans\n  7\nROMANS\n  0\nLINE\n  8\n0\n 10\n0.0\n 20\n-2.0\n 30\n0.0\n 11\n60.0\n 21\n-2.0\n 31\n0.0\n  0\nENDSEC\n  0\nEOF\n");
  for (const f of fs.readdirSync(DIR)) console.log(f.padEnd(44) + (fs.statSync(path.join(DIR, f)).size / 1024).toFixed(0) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
