// Prueba del autodiagnóstico (v1.1) en las réplicas de Gmail y de OX/IONOS: con el HTML intacto no sale aviso; si se altera la
// estructura de los adjuntos (se quita download_url / data-downloadurl) sale "CADPreview no reconoce este adjunto" y el informe copiado
// solo lleva estructura (sin nombres de archivo ni enlaces). Uso: node prueba-diagnostico-gmail-ox.cjs
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
const MUESTRA = path.join(TRABAJO, 'muestras', 'canteen.dwg');

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), MUESTRA], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-dg-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8099' }); } catch (_) { /* nada */ }
  const r = {};
  const caso = async (clave, url, sitio, alterar) => {
    const o = r[clave] = {};
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(6500);
    o.sinAlterar = { aviso: await p.evaluate(() => !!document.getElementById('cadpreview-aviso')) };
    await p.evaluate(alterar);
    for (let i = 0; i < 20; i++) { if (await p.evaluate(() => !!document.getElementById('cadpreview-aviso'))) break; await p.waitForTimeout(500); }
    o.aviso = await p.evaluate(() => { const a = document.getElementById('cadpreview-aviso'); return a ? a.textContent : null; });
    if (o.aviso) {
      await p.locator('#cadpreview-aviso button', { hasText: 'Copiar informe' }).click({ timeout: 4000 });
      await p.waitForTimeout(500);
      o.informe = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERROR: ' + e));
    }
    o.correcto = o.sinAlterar.aviso === false && /no reconoce este adjunto/.test(o.aviso || '') && new RegExp('CADPreview 1\\.1').test(o.informe || '') && new RegExp('sitio: ' + sitio).test(o.informe || '')
      && /sospechosos: [1-9]/.test(o.informe || '') && !/Cañón|Pérez|ñandú|canteen|hatch|\.dwg|\.dxf|https?:|127\.0\.0\.1/i.test(o.informe || '');
    await p.close();
  };
  try {
    await caso('gmail', 'http://127.0.0.1:8099/#inbox/prueba', 'gmail', () => { for (const s of document.querySelectorAll('.aQH span.aZo[download_url]')) s.removeAttribute('download_url'); });
    await caso('ox', 'http://127.0.0.1:8099/appsuite/', 'ox', () => { for (const li of document.querySelectorAll('.attachment[data-downloadurl]')) li.removeAttribute('data-downloadurl'); });
  } catch (e) { r.error = String(e).slice(0, 500); }
  console.log(JSON.stringify(r, null, 1));
  await ctx.close(); srv.kill();
})();
