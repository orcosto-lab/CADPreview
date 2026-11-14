// Prueba del adaptador de IONOS (OX App Suite) sobre la réplica /appsuite/ del servidor de pruebas: botón "Vista previa CAD"
// solo en los .dwg/.dxf, que sobreviva a los repintados de la lista, panel con miniatura y Renderizar, aviso por tamaño,
// teclas que no llegan al correo, y que la dirección de la página no cambie.
// Usa muestras sin datos de clientes (carpeta <trabajo>\muestras). Uso: node prueba-ionos.cjs
const { spawn } = require('child_process');
const { createRequire } = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
// playwright-core: se instala con "npm install" en esta carpeta; PLAYWRIGHT_DIR permite usar otra copia
const { chromium } = (() => { try { return require('playwright-core'); } catch (_) { return createRequire(path.join(process.env.PLAYWRIGHT_DIR || __dirname, 'x.js'))('playwright-core'); } })();
const NAVEGADOR = process.env.NAVEGADOR || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = path.join(TRABAJO, 'ext-test');
const OUT = path.join(TRABAJO, 'resultados');
fs.mkdirSync(OUT, { recursive: true });
const MUESTRA = path.join(TRABAJO, 'muestras', 'canteen.dwg');
const URL = 'http://127.0.0.1:8099/appsuite/';
const SOLO_CAD = ['Cañón Pérez ñandú con miniatura.dxf', 'Cañón Pérez ñandú sin miniatura.dwg', 'Cañón Pérez ñandú.dwg', 'Cañón Pérez ñandú.dxf', 'fuente-extra.dxf', 'hatch.dxf', 'Plano grande (prueba aviso).dwg', 'Plano que cuelga.dxf'];

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), MUESTRA], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-ox-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  // cuenta las teclas que llegan a la página (el panel debe impedir que lleguen a los atajos del correo)
  await ctx.addInitScript(() => { window.__teclas = 0; document.addEventListener('keydown', () => { window.__teclas++; }); });
  const errores = [];
  const nuevaPagina = async (query) => {
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
    p.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 200)));
    await p.goto(URL + (query || ''), { waitUntil: 'load' });
    return p;
  };
  const r = { botones: {}, panel: {} };
  const ok = (cond) => !!cond;
  try {
    // ---- 1) botones: solo en .dwg/.dxf, también si la lista aparece tarde o se repinta ----
    const contar = (p) => p.evaluate(() => ({
      total: document.querySelectorAll('li.attachment').length,
      conBoton: [...document.querySelectorAll('li.attachment')].filter(li => li.querySelector(':scope > .cadpreview-btn')).map(li => li.getAttribute('title')),
      texto: (document.querySelector('.cadpreview-btn') || {}).textContent || null,
    }));
    let p = await nuevaPagina(); await p.waitForTimeout(1200);
    let c = await contar(p);
    r.botones.normal = { adjuntos: c.total, conBoton: c.conBoton.length, texto: c.texto, soloLosCad: ok(c.conBoton.length === SOLO_CAD.length && SOLO_CAD.every(n => c.conBoton.includes(n))), sinBotonEnElPdf: !c.conBoton.includes('informe.pdf') };
    await p.close();
    p = await nuevaPagina('?tarde=1'); await p.waitForTimeout(600); const antes = (await contar(p)).conBoton.length; await p.waitForTimeout(1800); c = await contar(p);
    r.botones.tarde = { antesDeQueAparezcanLosAdjuntos: antes, despues: c.conBoton.length, correcto: ok(antes === 0 && c.conBoton.length === SOLO_CAD.length) };
    await p.close();
    p = await nuevaPagina('?rerender=1'); await p.waitForTimeout(1000); let sobreviven = [];
    for (let i = 0; i < 4; i++) { await p.waitForTimeout(2600); sobreviven.push((await contar(p)).conBoton.length); }
    r.botones.repintado = { recuentosTrasCadaRepintado: sobreviven, correcto: ok(sobreviven.every(n => n === SOLO_CAD.length)) };
    await p.close();

    // ---- 1b) vista en mosaico: miniatura automática, carga al desplazar, clic y controles de OX ----
    r.mosaico = {};
    const pm = await nuevaPagina('?mosaico=1'); await pm.waitForTimeout(4500);
    const conImagen = () => pm.evaluate(() => [...document.querySelectorAll('li.attachment')].filter(li => { const c = li.querySelector(':scope > .cadpreview-tile'); return c && /blob:/.test(c.style.backgroundImage); }).map(li => li.getAttribute('title')));
    const capas = () => pm.evaluate(() => [...document.querySelectorAll('li.attachment')].filter(li => li.querySelector(':scope > .cadpreview-tile')).map(li => li.getAttribute('title')));
    const esperadas = ['Cañón Pérez ñandú.dwg', 'Cañón Pérez ñandú con miniatura.dxf', 'hatch.dxf', 'Plano grande (prueba aviso).dwg'];
    const ini = await conImagen();
    r.mosaico.alPrincipio = { conImagen: ini.length, quienes: ini };
    await pm.evaluate(() => { document.getElementById('envoltorio').scrollLeft = 99999; }); await pm.waitForTimeout(5000);
    const fin = await conImagen();
    r.mosaico.trasDesplazar = { conImagen: fin.length, quienes: fin, correcto: ok(fin.length === esperadas.length && esperadas.every(n => fin.includes(n))) };
    r.mosaico.cargaPerezosa = ok(ini.length < fin.length);
    r.mosaico.capasEnLosCuadrosCad = (await capas()).length;
    r.mosaico.tamanoEnPantalla = await pm.evaluate(() => [...new Set([...document.querySelectorAll('li.attachment .filesize')].map(e => e.textContent))]); // debe ser vacío, como en OX
    r.mosaico.sinCapaEnElPdf = ok(!(await capas()).includes('informe.pdf'));
    await pm.screenshot({ path: path.join(OUT, 'ionos__0-mosaico.png') });
    // clic en el cuadro → abre el panel (sin cambiar la dirección)
    await pm.evaluate(() => { document.getElementById('envoltorio').scrollLeft = 0; });
    await pm.locator('li.attachment[title="Cañón Pérez ñandú.dwg"]').click({ position: { x: 60, y: 70 } });
    for (let i = 0; i < 40; i++) { const e = await pm.evaluate(() => { const el = document.getElementById('cadpreview-overlay'); return el ? el.dataset.estado : null; }); if (e && e !== 'localizando') { r.mosaico.clicEnElCuadro = e; break; } await pm.waitForTimeout(250); }
    await pm.waitForTimeout(500); r.mosaico.tamanoEnElPanel = await pm.evaluate(() => { const el = document.getElementById('cadpreview-overlay'); return el ? el.dataset.tamano : null; }); // el panel debe conocer el tamaño por la sonda
    await pm.keyboard.press('Escape'); await pm.waitForTimeout(400);
    // clic en un control propio de OX (el botón de quitar adjunto): NO debe abrir el panel
    await pm.locator('li.attachment[title="hatch.dxf"] .remove-attachment').scrollIntoViewIfNeeded();
    await pm.locator('li.attachment[title="hatch.dxf"] .remove-attachment').click(); await pm.waitForTimeout(600);
    r.mosaico.clicEnControlDeOxNoAbreElPanel = await pm.evaluate(() => !document.getElementById('cadpreview-overlay'));
    await pm.close();
    // en la vista de lista no hay capas de miniatura
    const pl = await nuevaPagina(); await pl.waitForTimeout(1500);
    r.mosaico.listaSinCapas = ok((await pl.evaluate(() => document.querySelectorAll('.cadpreview-tile').length)) === 0);
    await pl.close();

    // ---- 2) panel ----
    p = await nuevaPagina();
    await p.waitForTimeout(800);
    const estado = async (listos) => { for (let i = 0; i < 80; i++) { const e = await p.evaluate(() => { const el = document.getElementById('cadpreview-overlay'); return el ? { estado: el.dataset.estado, origen: el.dataset.origen, mini: el.dataset.miniatura || null, tam: el.dataset.tamano || null, titulo: el.querySelector('.cpv-title').textContent, info: el.querySelector('.cpv-info').textContent, aviso: el.querySelector('.cpv-aviso').style.display === 'flex' ? el.querySelector('.cpv-aviso .cpv-txt').textContent : null, descarga: !!el.querySelector('a.cpv-btn').getAttribute('href') && el.querySelector('a.cpv-btn').getAttribute('href') !== '#' } : null; }); if (e && listos.includes(e.estado)) return e; await p.waitForTimeout(500); } return null; };
    const pulsar = async (nombre) => p.locator(`li.attachment[title="${nombre}"] .cadpreview-btn`).click();
    const hash0 = await p.evaluate(() => location.href);
    // a) DWG con miniatura + Renderizar
    await pulsar('Cañón Pérez ñandú.dwg');
    const a = await estado(['miniatura', 'sin-miniatura', 'error-miniatura']);
    await p.waitForTimeout(600); if (a) a.mini = await p.evaluate(() => (document.getElementById('cadpreview-overlay') || { dataset: {} }).dataset.miniatura || null);
    r.panel.dwgConMiniatura = a;
    await p.screenshot({ path: path.join(OUT, 'ionos__1-panel-miniatura.png') });
    // las teclas no deben llegar al correo mientras el panel está abierto
    const t0 = await p.evaluate(() => window.__teclas); await p.keyboard.press('Delete'); await p.keyboard.press('KeyE'); await p.waitForTimeout(200); const t1 = await p.evaluate(() => window.__teclas);
    r.panel.teclasQueLlegaronAlCorreo = t1 - t0;
    await p.locator('.cpv-primary').click();
    const b = await estado(['abierto', 'error-lectura', 'error-apertura', 'sin-respuesta', 'bloqueado-csp']);
    r.panel.render = b;
    await p.screenshot({ path: path.join(OUT, 'ionos__2-render.png') });
    // Esc cierra el panel y la dirección no cambia
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    r.panel.cierraConEsc = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    r.panel.direccionSinCambios = ok((await p.evaluate(() => location.href)) === hash0);
    // b) DXF con miniatura (tamaño sacado de content-range)
    await pulsar('Cañón Pérez ñandú con miniatura.dxf');
    r.panel.dxfConMiniatura = await estado(['miniatura', 'sin-miniatura', 'error-miniatura']);
    await p.locator('.cpv-btn', { hasText: 'Cerrar' }).click(); await p.waitForTimeout(300);
    r.panel.cierraConBoton = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    // c) DXF sin miniatura
    await pulsar('Cañón Pérez ñandú.dxf');
    r.panel.dxfSinMiniatura = await estado(['miniatura', 'sin-miniatura', 'error-miniatura']);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // DXF con miniatura REAL (512x512, la de la muestra pública hatch.dxf)
    await pulsar('hatch.dxf');
    r.panel.dxfMiniaturaReal = await estado(['miniatura', 'sin-miniatura', 'error-miniatura']);
    await p.waitForTimeout(800); await p.screenshot({ path: path.join(OUT, 'ionos__4-dxf-miniatura-real.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // e) servidor que no contesta: el panel no se queda colgado y "Renderizar" sigue disponible
    const tCuelga = Date.now();
    await pulsar('Plano que cuelga.dxf');
    const cu = await estado(['error-miniatura', 'miniatura', 'sin-miniatura']);
    r.panel.servidorQueNoResponde = Object.assign({ segundos: Math.round((Date.now() - tCuelga) / 1000) }, cu, { renderizarActivo: await p.evaluate(() => !document.querySelector('.cpv-primary').disabled), nota: await p.evaluate(() => (document.querySelector('.cpv-note') || {}).textContent || null) });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // d) aviso por tamaño (la pantalla dice 12,0 MB)
    await pulsar('Plano grande (prueba aviso).dwg');
    await estado(['miniatura', 'sin-miniatura', 'error-miniatura']);
    await p.locator('.cpv-primary').click();
    r.panel.avisoTamano = await estado(['aviso-tamano', 'renderizando']);
    await p.screenshot({ path: path.join(OUT, 'ionos__3-aviso.png') });
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.errores = [...new Set(errores)].slice(0, 6);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
