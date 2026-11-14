// Servidor de prueba que imita lo mínimo de Google Drive que usa CADPreview v1.1. Solo escucha en 127.0.0.1 por HTTPS (certificado
// autofirmado) y sirve las muestras públicas (nunca archivos de clientes). El navegador de prueba lo ve como los dos servidores reales
// gracias a --host-resolver-rules ("drive.google.com" y "drive.usercontent.google.com" → este servidor). Ver prueba-drive.cjs.
//   https://drive.google.com/drive/recent       lista con filas <tr data-id role=row> (estructura vista en el Drive real el 12/11/2026) y un
//                                               visor propio que se abre con doble clic (h2 dentro de un elemento con aria-label "nombre tipo")
//   https://drive.usercontent.google.com/download?id=...   descarga SIN cabeceras CORS (como el real) y que exige la cookie SID
//   /__log, /__reset                            peticiones de descarga recibidas (para las comprobaciones)
// Modos de descarga: normal (Range: a-b, a-, -n → 206), sinrango (ignora Range y devuelve 200 con el archivo entero),
// aviso (primero una página HTML de "no se puede analizar en busca de virus" con confirm y uuid), prohibido (HTML 403).
//   ?samesite=lax   la cookie de sesión se pone con SameSite=Lax en vez de None
//   ?reutiliza=1    a los 3 s la primera fila se reutiliza para un archivo que no es CAD (Drive reutiliza filas al desplazar)
const https = require('https');
const fs = require('fs');
const path = require('path');

const [,, CARPETA, CERT, CLAVE, PUERTO = '8443'] = process.argv;
if (!CARPETA || !CERT || !CLAVE) { console.error('Uso: node servidor-drive-falso.js <carpeta de muestras> <cert.pem> <clave.pem> [puerto]'); process.exit(1); }

const ITEMS = [
  { id: 'id_dwg_nandu_000001', name: 'Cañón Pérez ñandú.dwg', tipo: 'Imagen', file: 'Cañón Pérez ñandú.dwg' },
  { id: 'id_dxf_miniatura_02', name: 'Cañón Pérez ñandú con miniatura.dxf', tipo: 'AutoCAD', file: 'Cañón Pérez ñandú con miniatura.dxf' },
  { id: 'id_dxf_sinmini_00003', name: 'Cañón Pérez ñandú.dxf', tipo: 'AutoCAD', file: 'Cañón Pérez ñandú.dxf' },
  { id: 'id_hatch_dxf_0000004', name: 'hatch.dxf', tipo: 'AutoCAD', file: 'hatch.dxf' },
  { id: 'id_sinrango_dwg_0005', name: 'Sin Rango.dwg', tipo: 'Imagen', file: 'canteen.dwg', modo: 'sinrango' },
  { id: 'id_sinrango_dxf_0006', name: 'Sin Rango.dxf', tipo: 'AutoCAD', file: 'hatch.dxf', modo: 'sinrango' },
  { id: 'id_aviso_dwg_0000007', name: 'Con aviso.dwg', tipo: 'Imagen', file: 'canteen.dwg', modo: 'aviso' },
  { id: 'id_prohibido_dwg_008', name: 'Prohibido.dwg', tipo: 'Imagen', file: 'canteen.dwg', modo: 'prohibido' },
  { id: 'id_informe_pdf_00009', name: 'informe.pdf', tipo: 'PDF', file: null }
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let registro = [];

function pagina(u) {
  const grid = !!u.searchParams.get('cuadricula');
  const sel = 'tr[data-id], [role="gridcell"][data-id]';
  const filas = ITEMS.map((it, i) => `<tr data-selectable="" data-target="doc" role="row" data-id="${it.id}" data-nombre="${esc(it.name)}" data-tipo="${esc(it.tipo)}" data-selection-key="0" aria-selected="false" aria-rowindex="${i + 1}" draggable="true" tabindex="${i ? -1 : 0}"><td class="NYP1ee M3pype"><div class="YMwAs MLwCse"><div class="NYP1ee"><div class="FAGDGb" data-file-icon="" aria-hidden="true" data-id="${it.id}"><img width="24" height="24" alt="${esc(it.tipo)}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div class="rxUYqf" style="overflow:hidden"><div class="JxSEve" aria-label="${esc(it.name)} ${it.tipo}" style="display:flex;overflow:hidden"><div class=" i92Sbe a65Cwf" data-id="${it.id}" data-tooltip="${esc(it.name)} ${it.tipo}" data-tooltip-delay="500" style="overflow:hidden"><span class="WQJtxb"><strong class="DNoYtb">${esc(it.name)}</strong></span></div></div></div></div></div></td><td>Hoy</td><td><button type="button" aria-label="Más acciones (Alt + A)" style="background:#444;color:#eee;border:0">⋮</button></td></tr>`).join('\n');
  const tarjetas = ITEMS.map((it, i) => `<div role="gridcell" class="QMCpLe XBL9Ke hZxXte" data-id="${it.id}" data-nombre="${esc(it.name)}" data-tipo="${esc(it.tipo)}" aria-label="${esc(it.name)} ${esc(it.tipo)} Cargando... Más información" aria-selected="false" tabindex="${i ? -1 : 0}" style="display:inline-block;position:relative;width:226px;height:226px;margin:6px;background:#2b2b2b;vertical-align:top"><div class="hAkGVe" data-id="${it.id}" data-tooltip="${esc(it.name)} ${esc(it.tipo)}" style="width:150px;height:20px;overflow:hidden;position:absolute;left:8px;bottom:8px">${esc(it.name)}</div><button type="button" aria-label="Más acciones (Alt + A)" style="position:absolute;right:4px;bottom:4px;background:#444;color:#eee;border:0">⋮</button></div>`).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reciente - Google Drive (réplica)</title></head>
<body style="background:#1f1f1f;color:#e8eaed;font:14px sans-serif">
<h2 style="margin:8px">Reciente</h2>
${grid ? '<div role="grid" style="width:1000px">' + tarjetas + '</div>' : '<table style="width:900px"><tbody>' + filas + '</tbody></table>'}
<script>
  const SEL = '${sel}';
  const items = () => [...document.querySelectorAll(SEL)];
  // Drive abre su visor con el segundo clic del doble clic (click con detail=2), o con Intro sobre la fila enfocada
  function abrirVisor(it) {
    window.__visoresAbiertos = (window.__visoresAbiertos || 0) + 1;
    const f = document.createElement('iframe'); f.id = 'visor-drive';
    f.src = '/viewer/main?origin=https%3A%2F%2Fdrive.google.com&source=10&authuser=0';
    f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:1000;background:#202124';
    document.body.appendChild(f);
  }
  document.addEventListener('click', (e) => {
    const it = e.target.closest(SEL); if (!it) return;
    items().forEach(f => f.setAttribute('aria-selected', String(f === it)));
    window.__clicsEnFila = (window.__clicsEnFila || 0) + 1; panelDetalles(it);
    if (e.detail >= 2) abrirVisor(it);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const v = document.getElementById('visor-drive'); if (v) v.remove(); }
    if (e.key === 'Enter') { const it = e.target.closest && e.target.closest(SEL); if (it) abrirVisor(it); }
  });
  // Panel de detalles como el real: título en h2 dentro de un elemento con aria-label, y la vista previa en un iframe
  function panelDetalles(it) {
    let p = document.getElementById('detalles');
    if (!p) { p = document.createElement('div'); p.id = 'detalles'; p.setAttribute('role', 'complementary'); p.setAttribute('aria-label', 'Panel de detalles'); p.style.cssText = 'position:fixed;right:0;top:40px;width:320px;background:#2b2b2b'; document.body.appendChild(p); }
    const nombre = it.dataset.nombre, tipo = it.dataset.tipo;
    p.innerHTML = '<div class="a-ub-D"><div class="a-Mg-V" aria-label="' + nombre.replace(/"/g, '&quot;') + ' ' + tipo + '"><h2 class="a-Mg-lp"><div role="button" class="a-Mg-V-j"><div class="a-Mg-V-T"></div></div></h2></div></div><div class="a-ub-oa" style="height:313px"><div class="l-Mg-qs-ra" style="height:313px"><div class="a-szr7ld-ub" style="height:313px"><iframe class="a-szr7ld-Vc" style="width:320px;height:313px;border:0;background:#888;pointer-events:none" src="about:blank"></iframe></div></div></div>';
    p.querySelector('.a-Mg-V-T').textContent = nombre;
    // como el Drive real (medido el 14/11/2026): un clic en la vista previa del panel abre el visor de Drive; aquí lo hace un oyente del
    // contenedor del iframe (el peor caso: no basta con tapar el iframe, hay que cortar el evento)
    p.querySelector('.a-szr7ld-ub').addEventListener('click', () => abrirVisor(it));
  }
  ${u.searchParams.get('reutiliza') ? `setTimeout(() => { const tr = items()[0]; tr.querySelector('strong').textContent = 'Presupuesto.txt'; tr.querySelector('[data-tooltip]').setAttribute('data-tooltip', 'Presupuesto.txt Texto'); tr.querySelector('.JxSEve').setAttribute('aria-label', 'Presupuesto.txt Texto'); }, 3000);` : ''}
</script></body></html>`;
}

https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(CLAVE) }, (req, res) => {
  const u = new URL(req.url, 'https://drive.google.com');
  const host = (req.headers.host || '').split(':')[0];
  if (u.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(registro)); }
  if (u.pathname === '/__reset') { registro = []; res.writeHead(200); return res.end('ok'); }

  if (host === 'drive.google.com') {
    if (u.pathname === '/viewer/main') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><body style="background:#202124;color:#e8eaed;font:20px sans-serif"><p style="padding:60px">No hay ninguna vista previa disponible</p></body>');
    }
    const mv = /^\/file\/(?:u\/\d+\/)?d\/([\w-]+)\/view$/.exec(u.pathname);
    if (mv) {
      const it = ITEMS.find(x => x.id === mv[1]);
      if (!it) { res.writeHead(404); return res.end('no existe'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'", 'set-cookie': 'SID=ok; Domain=google.com; Path=/; Secure; SameSite=None' });
      // el título llega un instante después, como en el Drive real
      return res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Google Drive</title></head><body style="background:#1f1f1f;color:#e8eaed;font:14px sans-serif"><p>Visor de Drive (réplica)</p><script>setTimeout(() => { document.title = ' + JSON.stringify(it.name + ' - Google Drive') + '; }, 600);</script></body></html>');
    }
    if (u.pathname === '/drive/recent') {
      const lax = u.searchParams.get('samesite') === 'lax';
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        // como el Drive real (medido): solo script-src, object-src y base-uri; sin restricciones de frames ni de estilos
        'content-security-policy': "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
        'set-cookie': `SID=ok; Domain=google.com; Path=/; Secure; ${lax ? 'SameSite=Lax' : 'SameSite=None'}`
      });
      return res.end(pagina(u));
    }
    res.writeHead(404); return res.end('no existe');
  }

  if (host === 'drive.usercontent.google.com' && u.pathname === '/download') {
    const id = u.searchParams.get('id');
    const it = ITEMS.find(x => x.id === id);
    const reg = { id, range: req.headers.range || null, confirm: u.searchParams.get('confirm'), cookie: /(^|;\s*)SID=ok/.test(req.headers.cookie || ''), origin: req.headers.origin || null, modo: it ? (it.modo || 'normal') : null };
    registro.push(reg);
    const html = (cod, txt) => { res.writeHead(cod, { 'content-type': 'text/html; charset=utf-8' }); res.end(txt); };
    if (!reg.cookie) return html(403, '<html><body>Sin sesión</body></html>');
    if (!it || !it.file) return html(404, '<html><body>No existe</body></html>');
    if (it.modo === 'prohibido') return html(403, '<html><body>No tienes permiso</body></html>');
    if (it.modo === 'aviso' && !reg.confirm) {
      return html(200, `<html><body><form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="UU-123"></form>Google Drive no puede analizar este archivo en busca de virus.</body></html>`);
    }
    const ruta = path.join(CARPETA, it.file);
    const total = fs.statSync(ruta).size;
    const cab = { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(it.name), 'cache-control': 'no-store' };   // sin cabeceras CORS, como el real
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && it.modo !== 'sinrango') {
      let ini, fin;
      if (rg[1] === '') { ini = Math.max(0, total - +rg[2]); fin = total - 1; } else { ini = +rg[1]; fin = rg[2] === '' ? total - 1 : Math.min(+rg[2], total - 1); }
      if (ini >= total) { res.writeHead(416, { 'content-range': `bytes */${total}` }); return res.end(); }
      res.writeHead(206, Object.assign({ 'content-range': `bytes ${ini}-${fin}/${total}`, 'content-length': fin - ini + 1, 'accept-ranges': 'bytes' }, cab));
      return fs.createReadStream(ruta, { start: ini, end: fin }).pipe(res);
    }
    res.writeHead(200, Object.assign({ 'content-length': total }, it.modo === 'sinrango' ? {} : { 'accept-ranges': 'bytes' }, cab));
    return fs.createReadStream(ruta).pipe(res);
  }
  res.writeHead(404); res.end('no existe');
}).listen(+PUERTO, '127.0.0.1', () => console.log('escuchando en https://127.0.0.1:' + PUERTO));
