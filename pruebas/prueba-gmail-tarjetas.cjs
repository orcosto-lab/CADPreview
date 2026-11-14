// Prueba de las miniaturas automáticas en las tarjetas de adjuntos de Gmail (réplica con la estructura real:
// .aQH > span.aZo[download_url] > a.aQy > .aSH > .aYv con el icono genérico .aYw).
// Comprueba que las miniaturas se pintan solas encima del icono (solo en los archivos que la traen), que el PDF queda como
// estaba, que el clic sigue siendo el de Gmail (no se abre nada por nuestra cuenta) y que sobreviven a un repintado.
// Uso: node prueba-gmail-tarjetas.cjs
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

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), MUESTRA], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-gm-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const errores = [];
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 200)));
  const r = {};
  try {
    await p.goto('http://127.0.0.1:8099/#inbox/prueba', { waitUntil: 'load' });
    const estadoTarjetas = () => p.evaluate(() => [...document.querySelectorAll('.aQH span.aZo[download_url]')].map(s => {
      const dd = s.getAttribute('download_url'); const nombre = decodeURIComponent(dd.slice(dd.indexOf(':') + 1, dd.indexOf(':', dd.indexOf(':') + 1)));
      const c = s.querySelector('.aYv > .cadpreview-tile');
      return { nombre, capa: !!c, imagen: !!(c && /blob:/.test(c.style.backgroundImage)), etiqueta: c && c.querySelector('span') ? c.querySelector('span').textContent : null };
    }));
    await p.waitForTimeout(6000);
    const t1 = await estadoTarjetas();
    r.tarjetas = t1.length;
    r.conImagen = t1.filter(t => t.imagen).map(t => t.nombre + ' [' + t.etiqueta + ']');
    r.conCapaSinImagen = t1.filter(t => t.capa && !t.imagen).map(t => t.nombre);
    r.sinCapa = t1.filter(t => !t.capa).map(t => t.nombre);
    r.pdfSinCapa = t1.filter(t => t.nombre === 'informe.pdf').every(t => !t.capa);
    await p.screenshot({ path: path.join(OUT, 'gmail__0-tarjetas.png') });
    // el clic sigue siendo el de Gmail: la capa no intercepta el ratón y no se abre ningún panel por nuestra cuenta
    const primera = p.locator('.aQH span.aZo').first();
    r.capaSinInterceptarRaton = await p.evaluate(() => { const c = document.querySelector('.aQH .cadpreview-tile'); return c ? getComputedStyle(c).pointerEvents === 'none' : null; });
    await primera.locator('a.aQy').click({ position: { x: 90, y: 40 } }); await p.waitForTimeout(600);
    r.clicNoAbrePanelPropio = await p.evaluate(() => !document.getElementById('cadpreview-overlay'));
    // repintado: Gmail sustituye el contenido de las tarjetas; las miniaturas ya leídas vuelven al instante sin pedir nada
    const antesPeticiones = await p.evaluate(() => performance.getEntriesByType('resource').filter(e => /\/adjunto/.test(e.name)).length);
    await p.evaluate(() => { const c = document.querySelector('.aQH'); const html = c.cloneNode(true); c.replaceWith(html); });
    await p.waitForTimeout(1500);
    const t2 = await estadoTarjetas();
    const despuesPeticiones = await p.evaluate(() => performance.getEntriesByType('resource').filter(e => /\/adjunto/.test(e.name)).length);
    r.repintado = { conImagen: t2.filter(t => t.imagen).length, igualQueAntes: t2.filter(t => t.imagen).length === t1.filter(t => t.imagen).length, peticionesNuevas: despuesPeticiones - antesPeticiones };
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.errores = [...new Set(errores)].slice(0, 6);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
