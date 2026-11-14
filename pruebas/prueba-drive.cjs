// Prueba del adaptador de Google Drive (v1.1.4) sobre la réplica de pruebas (servidor-drive-falso.js, HTTPS) con la extensión de
// pruebas cargada en Brave: botón solo en los .dwg/.dxf, panel con miniatura, Renderizar, lectura por el service worker (la página
// NO puede leer la descarga: sin CORS), archivos cuyo servidor ignora Range, aviso del antivirus, error 403, doble clic e Intro (lista
// y cuadrícula: sale el panel y el visor de Drive, un iframe, no se abre), direcciones /file/d/ID/view, filas reutilizadas y cookie SameSite=Lax. Usa muestras sin datos de clientes (carpeta <trabajo>\muestras).
// Uso: node prueba-drive.cjs   (necesita haber construido con: node construir.mjs --prueba)
const { spawn, execFileSync } = require('child_process');
const { createRequire } = require('module');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
// playwright-core: se instala con "npm install" en esta carpeta; PLAYWRIGHT_DIR permite usar otra copia
const { chromium } = (() => { try { return require('playwright-core'); } catch (_) { return createRequire(path.join(process.env.PLAYWRIGHT_DIR || __dirname, 'x.js'))('playwright-core'); } })();
const NAVEGADOR = process.env.NAVEGADOR || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const OPENSSL = process.env.OPENSSL || 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe';
const EXT = path.join(TRABAJO, 'ext-test');
const OUT = path.join(TRABAJO, 'resultados');
const MUESTRAS = path.join(TRABAJO, 'muestras');
const PUERTO = 8443;
fs.mkdirSync(OUT, { recursive: true });

const tam = (n) => fs.statSync(path.join(MUESTRAS, n)).size;
const leerLog = () => new Promise((ok, mal) => https.get({ host: '127.0.0.1', port: PUERTO, path: '/__log', rejectUnauthorized: false, headers: { host: 'drive.google.com' } }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => ok(JSON.parse(d))); }).on('error', mal));
const reiniciarLog = () => new Promise((ok) => https.get({ host: '127.0.0.1', port: PUERTO, path: '/__reset', rejectUnauthorized: false, headers: { host: 'drive.google.com' } }, (res) => { res.resume(); res.on('end', ok); }));

(async () => {
  // certificado autofirmado (el navegador de prueba lo acepta con --ignore-certificate-errors)
  const dirCert = path.join(TRABAJO, 'cert');
  const CERT = path.join(dirCert, 'cert.pem'), CLAVE = path.join(dirCert, 'clave.pem');
  if (!fs.existsSync(CERT)) {
    fs.mkdirSync(dirCert, { recursive: true });
    execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', CLAVE, '-out', CERT, '-days', '3', '-subj', '/CN=drive.google.com'], { stdio: 'ignore', env: Object.assign({}, process.env, { OPENSSL_CONF: 'C:\\Program Files\\Git\\mingw64\\etc\\ssl\\openssl.cnf' }) });
  }
  const srv = spawn('node', [path.join(__dirname, 'servidor-drive-falso.js'), MUESTRAS, CERT, CLAVE, String(PUERTO)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-drive-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 }, ignoreHTTPSErrors: true,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--ignore-certificate-errors', `--host-resolver-rules=MAP drive.google.com 127.0.0.1:${PUERTO},MAP drive.usercontent.google.com 127.0.0.1:${PUERTO}`],
  });
  const errores = [];
  // conBoton: la extensión no pone botones en las filas de Drive (parpadeaban en el Drive real); el código sigue ahí y se activa con
  // dataset.cadpreviewBotonFilas='1' para poder probar con él los casos de lectura (DXF, sin Range, aviso, 403...)
  const nuevaPagina = async (query, conBoton = true) => {
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error' || /\[CADPreview\]/.test(m.text())) errores.push(m.type() + ': ' + m.text().slice(0, 220)); });
    p.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 220)));
    await p.goto('https://drive.google.com/drive/recent' + (query || ''), { waitUntil: 'load' });
    // el interruptor está en el DOM (compartido con el mundo aislado); un cambio de DOM despierta al observador de drive.js
    if (conBoton) await p.evaluate(() => { document.documentElement.dataset.cadpreviewBotonFilas = '1'; const d = document.createElement('div'); document.body.append(d); d.remove(); });
    return p;
  };
  const r = { sw: null, premisa: {}, botones: {}, panel: {}, visor: {}, cuadricula: {}, enlace: {}, filaReutilizada: {}, sameSiteLax: {}, log: {} };
  const estado = async (p, listos, intentos = 80) => { for (let i = 0; i < intentos; i++) { const e = await p.evaluate(() => { const el = document.getElementById('cadpreview-overlay'); return el ? { estado: el.dataset.estado, origen: el.dataset.origen, mini: el.dataset.miniatura || null, tam: el.dataset.tamano || null, bytes: el.dataset.bytes || null, titulo: el.querySelector('.cpv-title').textContent, nota: (el.querySelector('.cpv-note') || {}).textContent || null, info: el.querySelector('.cpv-info').textContent, descarga: el.querySelector('a.cpv-btn').getAttribute('href'), aviso: el.querySelector('.cpv-aviso').style.display === 'flex' } : null; }); if (e && listos.includes(e.estado)) return e; await p.waitForTimeout(500); } return null; };
  const MINI = ['miniatura', 'sin-miniatura', 'error-miniatura'];
  try {
    let p = await nuevaPagina(); await p.waitForTimeout(1500);
    // el service worker de la extensión está activo
    r.sw = ctx.serviceWorkers().map(w => w.url().replace(/^chrome-extension:\/\/[^/]+/, ''));
    // 0) premisa: la página NO puede leer la descarga (sin CORS)
    r.premisa.fetchDesdeLaPagina = await p.evaluate(async () => { try { await fetch('https://drive.usercontent.google.com/download?id=id_dwg_nandu_000001&export=download', { credentials: 'include', headers: { Range: 'bytes=0-0' } }); return 'LEE (inesperado)'; } catch (e) { return String(e); } });
    // 1) botones solo en .dwg/.dxf; el clic en el botón no selecciona ni abre la fila de Drive
    const filas = () => p.evaluate(() => [...document.querySelectorAll('tr[data-id]')].map(tr => ({ nombre: tr.querySelector('strong').textContent, boton: !!tr.querySelector('.cadpreview-btn') })));
    const f = await filas();
    r.botones.filas = f.length;
    r.botones.conBoton = f.filter(x => x.boton).map(x => x.nombre);
    r.botones.soloCad = f.every(x => x.boton === /\.(dwg|dxf)$/i.test(x.nombre));
    // 1a) por defecto (sin el interruptor de pruebas) no hay botones en las filas
    { const q = await nuevaPagina('', false); await q.waitForTimeout(1200);
      r.botones.sinBotonPorDefecto = await q.evaluate(() => document.querySelectorAll('tr[data-id]').length > 0 && !document.querySelector('.cadpreview-btn'));
      await q.close(); }
    // 1b) el botón es hermano de div.rxUYqf (fuera del bloque con tooltip y arrastre de Drive)
    r.botones.fueraDelBloqueDelNombre = await p.evaluate(() => [...document.querySelectorAll('.cadpreview-btn')].every(b => b.previousElementSibling && b.previousElementSibling.classList.contains('rxUYqf') && !b.closest('.JxSEve')));
    // 1c) panel Detalles: miniatura encima del iframe gris; el título del panel NO abre el visor; PDF sin capa; otro DWG cambia la capa
    const detalles = async () => p.evaluate(() => { const t = document.querySelector('#detalles .cadpreview-tile'); return { capa: !!t, visible: !!t && t.style.display === 'block', imagen: !!t && /^url\("blob:/.test(t.style.backgroundImage), pointerEvents: t ? t.style.pointerEvents : null, overlay: !!document.getElementById('cadpreview-overlay') }; });
    const esperarCapa = async () => { for (let i = 0; i < 60; i++) { const d = await detalles(); if (d.imagen) return d; await p.waitForTimeout(250); } return detalles(); };
    await p.locator('tr[data-id="id_dwg_nandu_000001"] td:nth-child(2)').click();
    r.detalles = { dwg: await esperarCapa() };
    await p.screenshot({ path: path.join(OUT, 'drive__0-detalles.png') });
    // botón "Ver dibujo completo" del panel Detalles: abre el panel de CADPreview; Renderizar lee el archivo entero; Esc lo cierra
    r.detalles.botonPresente = await p.evaluate(() => document.querySelectorAll('#detalles .cadpreview-det-btn').length);
    await p.locator('#detalles .cadpreview-det-btn').click();
    const dd = await estado(p, MINI);
    r.detalles.panel = dd && { estado: dd.estado, origen: dd.origen, titulo: dd.titulo };
    await p.locator('.cpv-primary').click();
    const dr = await estado(p, ['abierto', 'error-lectura', 'error-apertura', 'sin-respuesta', 'bloqueado-csp'], 240);
    r.detalles.render = dr && { estado: dr.estado, bytes: dr.bytes, coincide: dr.bytes === String(tam('Cañón Pérez ñandú.dwg')) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    r.detalles.cierraConEsc = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    // un clic sobre el recuadro de la miniatura abre el panel de CADPreview y no el visor de Drive (que en el Drive real se abría con ese clic)
    r.detalles.recuadro = {};
    r.detalles.recuadro.capturas = await p.evaluate(() => document.querySelectorAll('#detalles .cadpreview-det-click').length);
    await p.locator('#detalles .cadpreview-det-click').click({ position: { x: 100, y: 100 } });
    const rc = await estado(p, MINI);
    r.detalles.recuadro.dwg = { panel: rc && { estado: rc.estado, origen: rc.origen, titulo: rc.titulo }, visoresDeDrive: await p.evaluate(() => window.__visoresAbiertos || 0) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.locator('tr[data-id="id_dxf_miniatura_02"] td:nth-child(2)').click();
    r.detalles.dxf = await esperarCapa();
    await p.locator('tr[data-id="id_informe_pdf_00009"] td:nth-child(2)').click(); await p.waitForTimeout(600);
    r.detalles.pdf = await detalles();
    r.detalles.recuadro.pdf = { capturas: await p.evaluate(() => document.querySelectorAll('#detalles .cadpreview-det-click').length) };
    // DXF sin miniatura: el recuadro sigue siendo nuestro (la capa no se ve, pero el clic abre el panel)
    await p.locator('tr[data-id="id_dxf_sinmini_00003"] td:nth-child(2)').click(); await p.waitForTimeout(900);
    await p.locator('#detalles .cadpreview-det-click').click({ position: { x: 100, y: 100 } });
    const rs = await estado(p, MINI);
    r.detalles.recuadro.dxfSinMiniatura = { panel: rs && { estado: rs.estado, origen: rs.origen, titulo: rs.titulo }, visoresDeDrive: await p.evaluate(() => window.__visoresAbiertos || 0) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    // el PDF: el clic en su vista previa abre el visor de Drive (la réplica lo hace, para que la prueba tenga sentido); se reinicia el contador
    await p.locator('tr[data-id="id_informe_pdf_00009"] td:nth-child(2)').click(); await p.waitForTimeout(500);
    await p.locator('#detalles .a-szr7ld-ub').click({ position: { x: 100, y: 100 } }); await p.waitForTimeout(500);
    r.detalles.recuadro.pdf.visorDeDriveAbierto = (await p.evaluate(() => window.__visoresAbiertos || 0)) === 1 && await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.evaluate(() => { window.__visoresAbiertos = 0; });
    r.detalles.recuadro.correcto = r.detalles.recuadro.capturas === 1 && !!r.detalles.recuadro.dwg.panel && r.detalles.recuadro.dwg.panel.origen === 'drive-detalles-miniatura' && r.detalles.recuadro.dwg.visoresDeDrive === 0
      && r.detalles.recuadro.pdf.capturas === 0 && r.detalles.recuadro.pdf.visorDeDriveAbierto === true
      && !!r.detalles.recuadro.dxfSinMiniatura.panel && r.detalles.recuadro.dxfSinMiniatura.panel.origen === 'drive-detalles-miniatura' && r.detalles.recuadro.dxfSinMiniatura.visoresDeDrive === 0;
    const clics0 = await p.evaluate(() => window.__clicsEnFila || 0);
    const pulsar = (id) => p.locator(`tr[data-id="${id}"] .cadpreview-btn`).click();
    await reiniciarLog();
    // 2) DWG con miniatura: panel, tamaño por content-range, y Renderizar (bytes recibidos = tamaño real)
    await pulsar('id_dwg_nandu_000001');
    const a = await estado(p, MINI); await p.waitForTimeout(600);
    if (a) a.mini = await p.evaluate(() => document.getElementById('cadpreview-overlay').dataset.miniatura || null);
    r.panel.dwgConMiniatura = a;
    r.botones.clicNoSeleccionaLaFila = (await p.evaluate(() => window.__clicsEnFila || 0)) === clics0;
    r.panel.tamanoCorrecto = !!a && +a.tam === tam('Cañón Pérez ñandú.dwg');
    r.log.trasLaMiniaturaDwg = (await leerLog()).map(x => x.range);
    await p.screenshot({ path: path.join(OUT, 'drive__1-panel-miniatura.png') });
    await p.locator('.cpv-primary').click();
    const b = await estado(p, ['abierto', 'error-lectura', 'error-apertura', 'sin-respuesta', 'bloqueado-csp'], 240);
    r.panel.renderDwg = b && { estado: b.estado, bytes: b.bytes, bytesEsperados: String(tam('Cañón Pérez ñandú.dwg')), coincide: b.bytes === String(tam('Cañón Pérez ñandú.dwg')), info: b.info };
    await p.screenshot({ path: path.join(OUT, 'drive__2-render.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    r.panel.cierraConEsc = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    // 3) DXF con miniatura, sin miniatura, y la miniatura real de hatch.dxf
    const caso = async (clave, id) => { await pulsar(id); r.panel[clave] = await estado(p, MINI); await p.waitForTimeout(500); await p.keyboard.press('Escape'); await p.waitForTimeout(300); };
    await caso('dxfConMiniatura', 'id_dxf_miniatura_02');
    await caso('dxfSinMiniatura', 'id_dxf_sinmini_00003');
    await caso('dxfMiniaturaReal', 'id_hatch_dxf_0000004');
    // 4) el servidor ignora Range y devuelve 200 con el archivo entero (el service worker salta los bytes)
    await caso('dwgSinRango', 'id_sinrango_dwg_0005');
    await caso('dxfSinRango', 'id_sinrango_dxf_0006');
    // 5) aviso del antivirus (HTML con confirm y uuid) → se repite con confirm
    await reiniciarLog();
    await caso('avisoAntivirus', 'id_aviso_dwg_0000007');
    r.log.avisoAntivirus = (await leerLog()).map(x => ({ confirm: x.confirm, range: x.range }));
    // 6) sin permiso (403 con HTML): error claro y Renderizar sigue disponible
    await pulsar('id_prohibido_dwg_008');
    const e403 = await estado(p, MINI);
    r.panel.sinPermiso = Object.assign({}, e403, { renderizarActivo: await p.evaluate(() => !document.querySelector('.cpv-primary').disabled) });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // 7) doble clic e Intro. Medido en el Drive real (14/11/2026): su visor es un iframe que se abre con el 2.º clic del doble clic o con Intro
    //    sobre la fila enfocada. Sobre un .dwg/.dxf debe salir el panel de CADPreview y NO abrirse el visor de Drive; en los demás archivos y en
    //    los botones de la fila Drive hace lo suyo.
    const visores = () => p.evaluate(() => window.__visoresAbiertos || 0);
    const sinPanel = () => p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    const resumen = (e) => e && { estado: e.estado, origen: e.origen, titulo: e.titulo };
    r.visor.visoresAntes = await visores();
    const clicsPrev = await p.evaluate(() => window.__clicsEnFila || 0);
    await p.locator('tr[data-id="id_dxf_miniatura_02"] strong').dblclick();
    const v = await estado(p, MINI);
    r.visor.dobleClic = { panel: resumen(v), visoresDeDrive: await visores(), clicsQueLlegaronAFila: (await p.evaluate(() => window.__clicsEnFila || 0)) - clicsPrev };
    await p.screenshot({ path: path.join(OUT, 'drive__3-doble-clic.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    r.visor.dobleClic.panelCerrado = await sinPanel();
    r.visor.dobleClic.filaSigueSeleccionada = await p.evaluate(() => document.querySelector('tr[data-id="id_dxf_miniatura_02"]').getAttribute('aria-selected') === 'true');
    // Intro con la fila enfocada
    await p.locator('tr[data-id="id_dwg_nandu_000001"] td:nth-child(2)').click();
    await p.waitForTimeout(300);
    await p.keyboard.press('Enter');
    const vi = await estado(p, MINI);
    r.visor.intro = { panel: resumen(vi), visoresDeDrive: await visores() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    r.visor.intro.panelCerrado = await sinPanel();
    // un archivo que no es CAD (PDF): Drive abre su visor y no sale panel, con doble clic y con Intro
    await p.locator('tr[data-id="id_informe_pdf_00009"] strong').dblclick(); await p.waitForTimeout(900);
    r.visor.pdfDobleClic = { sinPanel: await sinPanel(), visoresDeDrive: await visores() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.locator('tr[data-id="id_informe_pdf_00009"] td:nth-child(2)').click(); await p.waitForTimeout(300);
    await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    r.visor.pdfIntro = { sinPanel: await sinPanel(), visoresDeDrive: await visores() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // doble clic en un botón de la fila CAD ("Más acciones"): no se intercepta, lo trata Drive
    await p.locator('tr[data-id="id_dwg_nandu_000001"] button[aria-label^="Más acciones"]').dblclick(); await p.waitForTimeout(900);
    r.visor.botonDeLaFila = { sinPanel: await sinPanel(), visoresDeDrive: await visores() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    r.visor.correcto = r.visor.visoresAntes === 0
      && !!r.visor.dobleClic.panel && r.visor.dobleClic.panel.origen === 'drive-doble-clic' && r.visor.dobleClic.visoresDeDrive === 0 && r.visor.dobleClic.clicsQueLlegaronAFila === 1 && r.visor.dobleClic.panelCerrado && r.visor.dobleClic.filaSigueSeleccionada
      && !!r.visor.intro.panel && r.visor.intro.panel.origen === 'drive-intro' && r.visor.intro.visoresDeDrive === 0 && r.visor.intro.panelCerrado
      && r.visor.pdfDobleClic.sinPanel && r.visor.pdfDobleClic.visoresDeDrive === 1
      && r.visor.pdfIntro.sinPanel && r.visor.pdfIntro.visoresDeDrive === 2
      && r.visor.botonDeLaFila.sinPanel && r.visor.botonDeLaFila.visoresDeDrive === 3;
    r.log.totalPeticiones = (await leerLog()).length;
    await p.close();
    // 7b) vista de cuadrícula: tarjetas div[role=gridcell] con aria-label "nombre tipo Cargando..."
    p = await nuevaPagina('?cuadricula=1', false); await p.waitForTimeout(1200);
    const tarjeta = (id) => p.locator('[role="gridcell"][data-id="' + id + '"]');
    r.cuadricula.tarjetas = await p.evaluate(() => document.querySelectorAll('[role="gridcell"][data-id]').length);
    await tarjeta('id_dxf_miniatura_02').dblclick({ position: { x: 100, y: 100 } });
    const g1 = await estado(p, MINI);
    r.cuadricula.dobleClic = { panel: g1 && { estado: g1.estado, origen: g1.origen, titulo: g1.titulo }, visoresDeDrive: await p.evaluate(() => window.__visoresAbiertos || 0) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    await tarjeta('id_dwg_nandu_000001').click({ position: { x: 100, y: 100 } }); await p.waitForTimeout(300);
    await p.keyboard.press('Enter');
    const g2 = await estado(p, MINI);
    r.cuadricula.intro = { panel: g2 && { estado: g2.estado, origen: g2.origen, titulo: g2.titulo }, visoresDeDrive: await p.evaluate(() => window.__visoresAbiertos || 0) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    await tarjeta('id_informe_pdf_00009').dblclick({ position: { x: 100, y: 100 } }); await p.waitForTimeout(900);
    r.cuadricula.pdf = { sinPanel: await p.evaluate(() => !document.getElementById('cadpreview-overlay')), visoresDeDrive: await p.evaluate(() => window.__visoresAbiertos || 0) };
    r.cuadricula.correcto = r.cuadricula.tarjetas === 9
      && !!r.cuadricula.dobleClic.panel && r.cuadricula.dobleClic.panel.origen === 'drive-doble-clic' && r.cuadricula.dobleClic.visoresDeDrive === 0
      && !!r.cuadricula.intro.panel && r.cuadricula.intro.panel.origen === 'drive-intro' && r.cuadricula.intro.visoresDeDrive === 0
      && r.cuadricula.pdf.sinPanel && r.cuadricula.pdf.visoresDeDrive === 1;
    await p.close();
    // 7c) dirección directa /file/d/ID/view: el nombre sale del título de la pestaña (llega un instante después)
    const abrirEnlace = async (ruta) => {
      const q = await ctx.newPage();
      q.on('console', m => { if (m.type() === 'error' || /\[CADPreview\]/.test(m.text())) errores.push(m.type() + ': ' + m.text().slice(0, 220)); });
      await q.goto('https://drive.google.com' + ruta, { waitUntil: 'load' });
      return q;
    };
    p = await abrirEnlace('/file/d/id_dxf_miniatura_02/view');
    const e1 = await estado(p, MINI);
    r.enlace.cad = { panel: e1 && { estado: e1.estado, origen: e1.origen, titulo: e1.titulo }, tituloDeLaPestana: await p.title() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(1800);
    r.enlace.cad.cerradoYNoReabre = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    await p.close();
    p = await abrirEnlace('/file/d/id_informe_pdf_00009/view'); await p.waitForTimeout(2500);
    r.enlace.pdf = { sinPanel: await p.evaluate(() => !document.getElementById('cadpreview-overlay')), tituloDeLaPestana: await p.title() };
    r.enlace.correcto = !!r.enlace.cad.panel && r.enlace.cad.panel.origen === 'drive-enlace' && r.enlace.cad.panel.titulo === 'Cañón Pérez ñandú con miniatura.dxf' && r.enlace.cad.cerradoYNoReabre && r.enlace.pdf.sinPanel;
    await p.close();
    // 8) fila reutilizada: Drive recicla filas al desplazar; el botón debe desaparecer si ya no es CAD
    p = await nuevaPagina('?reutiliza=1'); await p.waitForTimeout(1000);
    const antes = (await filas())[0]; await p.waitForTimeout(3600); const despues = (await filas())[0];
    r.filaReutilizada = { antes, despues, correcto: antes.boton === true && despues.boton === false && despues.nombre === 'Presupuesto.txt' };
    await p.close();
    // 9) cookie de sesión SameSite=Lax (información: ¿llega la cookie en la lectura desde el service worker?)
    await reiniciarLog();
    p = await nuevaPagina('?samesite=lax'); await p.waitForTimeout(1000);
    await p.locator('tr[data-id="id_dwg_nandu_000001"] .cadpreview-btn').click();
    r.sameSiteLax.panel = await estado(p, MINI);
    r.sameSiteLax.peticiones = (await leerLog()).map(x => ({ cookie: x.cookie, range: x.range }));
    await p.close();
  } catch (e) { r.error = String(e).slice(0, 500); }
  r.errores = errores.slice(0, 12);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close(); srv.kill();
})();
