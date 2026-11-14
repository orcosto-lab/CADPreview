// Prueba de la decodificación de nombres de adjunto (Content-Disposition) de gmail.js (fase C).
// Uso: node test_nombres.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'fuente', 'extension', 'gmail.js'), 'utf8');
const bloque = src.split('// <<nombres')[1].split('// nombres>>')[0];
const { dispositionName, sameName } = new Function(bloque + '; return { dispositionName, sameName };')();

const casos = [
  // [cabecera Content-Disposition, nombre del chip de la lista, ¿debe coincidir?]
  ['attachment; filename="ES Perfil 1015.dwg"', 'ES Perfil 1015.dwg', true],
  ['attachment; filename="=?UTF-8?B?Q0FKRVTDjU4gQTNfRE9DIExJUVVJREFDSU9OLmR3Zw==?="', 'CAJETÍN A3_DOC LIQUIDACION.dwg', true],
  ['attachment; filename="=?UTF-8?B?VlRQIC0gIE1vZHVsYWNpw7NuIENpdWRhZCBMaW5lYWxfVjEuZHdn?="', 'VTP -  Modulación Ciudad Lineal_V1.dwg', true],
  ['attachment; filename="=?UTF-8?B?U0IgQ2HDsW9uMSBjYW1hcmEgYnVmYS5kd2c=?="', 'SB Cañon1 camara bufa.dwg', true],
  ['attachment; filename="=?UTF-8?B?U0IgQ2HDsW9uMSBEZXNwaWVjZSBWMDEuZHdn?="', 'SB Cañon1 Despiece V01.dwg', true],
  ['attachment; filename="=?UTF-8?B?U0IgUEVUTyBNZWPDoW5pY2FzIFYwMS5kd2c=?="', 'SB PETO Mecánicas V01.dwg', true],
  // Variante Q (quoted-printable) y partida en dos palabras codificadas
  ['attachment; filename="=?UTF-8?Q?Ca=C3=B1on_1.dwg?="', 'Cañon 1.dwg', true],
  ['attachment; filename="=?UTF-8?B?U0IgQ2HDsW9u?= =?UTF-8?B?MSBjYW1hcmEuZHdn?="', 'SB Cañon1 camara.dwg', true],
  // Forma RFC 5987
  ["attachment; filename*=UTF-8''Ca%C3%B1on.dwg", 'Cañon.dwg', true],
  // Mismo texto con la ñ descompuesta (NFD) frente a compuesta (NFC)
  ['attachment; filename="=?UTF-8?B?U0IgQ2HDsW9uMS5kd2c=?="', 'SB Can\u0303on1.dwg'.replace('Can\u0303on1', 'Cañon1').normalize('NFD'), true],
  // Negativos
  ['attachment; filename="otro.dwg"', 'ES Perfil 1015.dwg', false],
  [null, 'ES Perfil 1015.dwg', false],
];

let fallos = 0;
for (const [cd, chip, esperado] of casos) {
  const nombre = dispositionName(cd);
  const ok = sameName(nombre, chip) === esperado;
  if (!ok) fallos++;
  console.log((ok ? 'OK    ' : 'FALLO ') + JSON.stringify(nombre) + ' vs ' + JSON.stringify(chip));
}
console.log(fallos ? fallos + ' fallo(s)' : 'Todas las pruebas correctas');
process.exit(fallos ? 1 : 0);
