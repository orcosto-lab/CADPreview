// Servidor de prueba: imita lo mínimo de Gmail que usa la extensión y envía la política de seguridad real de
// Gmail (gmail-csp.txt, copiada el 11/11/2026). Solo escucha en 127.0.0.1. Sirve la muestra pública indicada
// (nunca archivos de clientes).
//   /                      vista de mensaje: tarjeta de adjunto (span.aZo[download_url])
//   /adjunto               bytes del adjunto de la vista de mensaje
//   /appsuite/             réplica mínima de IONOS (OX App Suite): mensaje abierto con adjuntos (ver más abajo)
//   /mail/u/0/             lista: fila tr.zA con chip .brc[title]; con ?view=pt la vista de impresión del hilo;
//                          con ?view=att el adjunto (nombre en Content-Disposition como palabra codificada RFC 2047,
//                          igual que Gmail con tildes y ñ). Exige ik=IK123 (la clave que pone el test en GLOBALS[9]).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8099;
const IK = 'IK123';
const CSP = fs.readFileSync(path.join(__dirname, 'gmail-csp.txt'), 'utf8').trim();
const MUESTRA = process.argv[2];
if (!MUESTRA || !fs.existsSync(MUESTRA)) { console.error('Uso: node servidor-gmail-falso.js <archivo.dxf|dwg>'); process.exit(1); }
const NOMBRE = path.basename(MUESTRA);
const ASCII = /^[\x20-\x7e]*$/.test(NOMBRE);
// Como Gmail: nombres no ASCII como =?UTF-8?B?...?=
const CD_NOMBRE = ASCII ? `attachment; filename="${NOMBRE}"` : `attachment; filename="=?UTF-8?B?${Buffer.from(NOMBRE, 'utf8').toString('base64')}?="`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  // ---- Réplica mínima de IONOS (OX App Suite): /appsuite/ ----
  // Página con un mensaje abierto: <li class="attachment"> con el nombre en title, el tamaño en .filesize y la dirección
  // de descarga (con session=...) en data-downloadurl. Sin política de seguridad (como el OX real). Parámetros:
  //   ?tarde=1     los adjuntos aparecen 1,2 s después (como al desplegar "N adjuntos")
  //   ?rerender=1  la lista se vuelve a pintar entera cada 2,5 s (OX lo hace al cambiar de mensaje)
  if (u.pathname === '/appsuite/' || u.pathname === '/appsuite') {
    const carpeta = path.dirname(MUESTRA);
    const reales = fs.readdirSync(carpeta).filter(n => /\.(dwg|dxf)$/i.test(n) && n !== 'canteen.dwg').sort();
    const fmt = (b) => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : (b / 1024).toFixed(1).replace('.', ',') + ' kB';
    const items = reales.map(n => ({ nombre: n, tam: fmt(fs.statSync(path.join(carpeta, n)).size) }));
    items.push({ nombre: 'informe.pdf', tam: '18,0 kB' });
    items.push({ nombre: 'Plano que cuelga.dxf', tam: '0,2 MB' });
    items.push({ nombre: 'Plano grande (prueba aviso).dwg', tam: '12,0 MB', alias: 'Cañón Pérez ñandú.dwg' });
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Correo - OX falso</title><style>
.attachment .fallback{display:none}
.mosaico li.attachment{position:relative;display:inline-block;width:120px;height:120px;margin:4px;vertical-align:top;background:#e5e5e5;border-radius:6px;overflow:hidden;list-style:none;padding:0}
.mosaico li.attachment .filename,.mosaico li.attachment .filesize,.mosaico li.attachment a[data-action]{display:none}
.mosaico li.attachment .fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:22px}
.mosaico li.attachment .remove-attachment{position:absolute;top:2px;right:2px;z-index:3;width:22px;height:22px}
</style></head>
<body style="font:14px sans-serif;background:#fff">
<h3>Imitación mínima de IONOS / OX App Suite (prueba)</h3>
<div class="mail-detail-pane"><div class="thread-view-control"><ul class="attachments mail-attachment-list show-preview open" id="lista"></ul></div></div>
<script>
const DATOS = ${JSON.stringify(items)};
const lista = document.getElementById('lista');
if (location.search.includes('mosaico=1')) { document.body.classList.add('mosaico'); const w = document.createElement('div'); w.id = 'envoltorio'; w.style.cssText = 'width:520px;overflow-x:auto;white-space:nowrap;border:1px solid #ccc'; lista.parentNode.insertBefore(w, lista); w.appendChild(lista); }
function pintar() {
  lista.innerHTML = '';
  DATOS.forEach((d, i) => {
    const li = document.createElement('li');
    li.className = 'attachment flex-row zero-min-width no-image';
    li.setAttribute('data-id', String(i + 2)); li.setAttribute('draggable', 'true'); li.setAttribute('tabindex', '0'); li.setAttribute('title', d.nombre);
    li.setAttribute('data-downloadurl', 'application/octet-stream:' + d.nombre + ':' + location.origin + '/appsuite/api/mail/' + encodeURIComponent(d.nombre) + '?action=attachment&attachment=' + (i + 2) + '&context=1&delivery=download&folder=default0/INBOX&id=1&sequence=1&session=SECRETO123&user=1');
    li.innerHTML = '<div class="smart-dropdown-container dropdown filename el"><button class="dropdown-toggle btn btn-toolbar"></button></div><a href="#" data-action="io.ox/mail/attachment/actions/download">Descargar</a><span class="filesize text-gray pl-4 text-nowrap"></span><button class="btn btn-link remove-attachment">x</button><div class="abs fallback ellipsis"></div>';
    li.querySelector('button.dropdown-toggle').textContent = d.nombre;
    li.querySelector('.filesize').textContent = location.search.includes('mosaico=1') ? '' : d.tam; // en el mosaico real el texto del tamaño está vacío
    li.querySelector('.fallback').textContent = d.nombre.split('.').pop().toLowerCase();
    lista.appendChild(li);
  });
}
const tarde = location.search.includes('tarde=1');
if (tarde) setTimeout(pintar, 1200); else pintar();
if (location.search.includes('rerender=1')) setInterval(pintar, 2500);
</script></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  // Descarga del adjunto: exige session=SECRETO123 en la dirección; sin content-length en las respuestas completas y
  // con Range (206 + content-range), como el OX real.
  if (u.pathname.startsWith('/appsuite/api/mail/')) {
    if (u.searchParams.get('session') !== 'SECRETO123') { res.writeHead(403); return res.end('sesión incorrecta'); }
    const carpeta = path.dirname(MUESTRA);
    let nombre = decodeURIComponent(u.pathname.slice('/appsuite/api/mail/'.length));
    const esGrande = nombre.startsWith('Plano grande');   // para la prueba del aviso: dice que pesa 12 MB al sondear con bytes=0-0
    if (esGrande) nombre = 'Cañón Pérez ñandú.dwg';
    const ruta = path.join(carpeta, path.basename(nombre));
    if (nombre.startsWith('Plano que cuelga')) return; // nunca responde
    if (nombre === 'informe.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4 falso'); }
    if (!fs.existsSync(ruta)) { res.writeHead(404); return res.end('no existe'); }
    const total = fs.statSync(ruta).size;
    const cab = { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(nombre), 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg) {
      let ini, fin;
      if (rg[1] === '') { const n = +rg[2]; if (n > total) return; /* el OX real de IONOS no responde nunca a bytes=-N con N mayor que el archivo */ ini = Math.max(0, total - n); fin = total - 1; } else { ini = +rg[1]; fin = rg[2] === '' ? total - 1 : Math.min(+rg[2], total - 1); }
      const totalDicho = (esGrande && ini === 0 && fin === 0) ? 12 * 1048576 : total;
      res.writeHead(206, Object.assign({ 'content-range': `bytes ${ini}-${fin}/${totalDicho}`, 'content-length': fin - ini + 1 }, cab));
      return fs.createReadStream(ruta, { start: ini, end: fin }).pipe(res);
    }
    res.writeHead(200, cab);
    return fs.createReadStream(ruta).pipe(res);
  }

  if (u.pathname === '/adjunto') {
    const otro = u.searchParams.get('n');
    const ruta = otro ? path.join(path.dirname(MUESTRA), path.basename(otro)) : MUESTRA;
    if (!fs.existsSync(ruta)) { res.writeHead(404); return res.end('no existe'); }
    const nom = otro ? path.basename(otro) : NOMBRE;
    const cd = /^[\x20-\x7e]*$/.test(nom) ? `attachment; filename="${nom}"` : `attachment; filename="=?UTF-8?B?${Buffer.from(nom, 'utf8').toString('base64')}?="`;
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': cd, 'content-length': fs.statSync(ruta).size });
    return fs.createReadStream(ruta).pipe(res);
  }
  if (u.pathname === '/mail/u/0/') {
    const view = u.searchParams.get('view');
    if (view) {
      if (u.searchParams.get('ik') !== IK) { res.writeHead(403); return res.end('ik incorrecta'); }
      if (view === 'pt') { // vista de impresión del hilo: dos adjuntos, el nuestro es el segundo
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<html><body>
<a href="?ui=2&amp;view=att&amp;th=m1&amp;attid=0.1&amp;disp=attd&amp;realattid=f_a&amp;safe=1&amp;zw">otro.pdf</a>
<a href="?ui=2&amp;view=att&amp;th=m1&amp;attid=0.2&amp;disp=attd&amp;realattid=f_b&amp;safe=1&amp;zw">${NOMBRE}</a>
</body></html>`);
      }
      if (view === 'att') {
        if (u.searchParams.get('attid') === '0.1') { res.writeHead(200, { 'content-disposition': 'attachment; filename="otro.pdf"' }); return res.end('%PDF-1.4 falso'); }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': CD_NOMBRE, 'content-length': fs.statSync(MUESTRA).size });
        return fs.createReadStream(MUESTRA).pipe(res);
      }
    }
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Gmail falso (lista)</title></head>
<body style="background:#fff;font:14px sans-serif">
<h3>Imitación mínima de la lista de Gmail (prueba)</h3>
<table><tbody>
<tr class="zA"><td><div data-legacy-thread-id="t1" data-legacy-last-message-id="m1">Asunto de prueba</div>
<div class="brc" title="otro.pdf">otro.pdf</div>
<div class="brc" title="${NOMBRE}">${NOMBRE}</div></td></tr>
</tbody></table></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP });
    return res.end(html);
  }
  const carpeta = path.dirname(MUESTRA);
  const otros = fs.readdirSync(carpeta).filter(n => /\.(dwg|dxf)$/i.test(n) && n !== NOMBRE).sort();
  const tarjetas = [{ nombre: NOMBRE, attid: '0.1' }].concat(otros.map((n, k) => ({ nombre: n, attid: '0.' + (k + 2) })), [{ nombre: 'informe.pdf', attid: '0.99' }]);
  const tarjeta = (c) => `<span class="aZo N5jrZb" style="position:relative;display:inline-block;width:180px;height:120px;margin:4px;vertical-align:top" download_url="application/octet-stream:${encodeURIComponent(c.nombre)}:http://127.0.0.1:${PORT}/adjunto?attid=${c.attid}&n=${encodeURIComponent(c.nombre)}"><a class="aQy e" href="#" style="position:relative;display:block;width:180px;height:120px;overflow:hidden;background:#fff;border:1px solid #ccc"><div class="aSH" style="position:absolute;left:1px;top:1px;width:178px;height:118px;overflow:hidden;z-index:1"><div class="aYv" style="position:relative;width:178px;height:85px"><div class="aYw" style="position:absolute;left:69px;top:22px;width:40px;height:40px;background:#cfcfcf"></div></div><div class="aYy" style="position:absolute;left:1px;top:86px;width:176px;height:32px;overflow:hidden;font-size:12px">${c.nombre}</div></div></a></span>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Gmail falso</title></head>
<body style="background:#fff;font:14px sans-serif">
<h3>Imitación mínima de Gmail (prueba)</h3>
<div class="aQH">${tarjetas.map(tarjeta).join('')}</div>
</body></html>`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP });
  res.end(html);
}).listen(PORT, '127.0.0.1', () => console.log('escuchando en http://127.0.0.1:' + PORT + ' con ' + NOMBRE));
