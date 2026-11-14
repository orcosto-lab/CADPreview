// Prueba de la exportación (HTML, PDF, SVG) desde el visor dentro del panel de CADPreview, con una muestra pública.
// HTML y PDF hacen preguntas en la línea de comandos: se aceptan los valores por defecto con Intro SOLO cuando hay una
// pregunta a la vista, y después se espera hasta 4 minutos a que llegue la descarga.
// Uso: node prueba-exportar.cjs [html|pdf|svg ...]
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
const EXPORTS = path.join(OUT, 'exportaciones');
fs.mkdirSync(EXPORTS, { recursive: true });
const muestra = path.join(TRABAJO, 'muestras', 'Cañón Pérez ñandú.dwg');
const formatos = process.argv.slice(2).length ? process.argv.slice(2) : ['html', 'pdf'];
const ESPERA_S = +process.env.ESPERA_EXPORT_S || 240;

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), muestra], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-exp-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1400, height: 850 }, acceptDownloads: true,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const page = await ctx.newPage();
  const errores = [];
  const registra = m => { if (m.type() === 'error') errores.push(m.text().slice(0, 240)); };
  page.on('console', registra); page.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 240)));
  page.on('worker', w => w.on('console', registra));
  const r = { muestra: path.basename(muestra), exportaciones: {} };
  try {
    await page.goto('http://127.0.0.1:8099/#inbox/prueba?projector=1&messagePartId=0.1', { waitUntil: 'load' });
    await page.locator('.cpv-primary:not([disabled])').waitFor({ timeout: 60000 });
    await page.locator('.cpv-primary').click();
    await page.waitForFunction(() => document.getElementById('cadpreview-overlay')?.dataset.estado === 'abierto', null, { timeout: 120000 });
    const frame = page.frames().find(f => /viewer\.html/.test(f.url()));
    let libres = 0;
    while (libres < 3) { await page.waitForTimeout(1000); libres = (await frame.evaluate(() => /Rendering drawing|Loading|Parsing|Procesando/i.test(document.body.innerText)).catch(() => false)) ? 0 : libres + 1; }
    await page.waitForTimeout(1500);

    const boton = (patron) => frame.evaluateHandle((p) => [...document.querySelectorAll('[class*="toolbar"] button, button[class*="toolbar"], [class*="toolbar-btn"]')].find(b => new RegExp(p, 'i').test(b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '')) || null, patron).then(h => h.asElement());

    for (const formato of formatos) {
      const t0 = Date.now(); let enters = 0;
      try {
        await (await boton('^export$')).click(); await page.waitForTimeout(500);
        const item = await boton(formato);
        let descarga = null;
        const espera = page.waitForEvent('download', { timeout: ESPERA_S * 1000 }).then(d => { descarga = d; return d; }, () => null);
        await item.click();
        while (!descarga && (Date.now() - t0) < ESPERA_S * 1000) {
          await page.waitForTimeout(2000);
          if (descarga) break;
          const hayPregunta = await frame.evaluate(() => { const l = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean); return /\]\s*<[^>]*>\s*:?\s*$/.test(l[l.length - 1] || '') || [...document.querySelectorAll('div')].some(d => d.children.length === 0 && /\]\s*<[^>]*>\s*:\s*$/.test(d.textContent || '')); }).catch(() => false);
          if (hayPregunta) { await frame.locator('input[placeholder="Type command"]').focus().catch(() => { }); await page.keyboard.press('Enter'); enters++; }
        }
        const d = await espera;
        if (!d) { r.exportaciones[formato] = { sinDescarga: true, segundos: Math.round((Date.now() - t0) / 1000), enters }; await page.screenshot({ path: path.join(OUT, 'exportar__sin-descarga-' + formato + '.png') }); continue; }
        const destino = path.join(EXPORTS, 'prueba.' + formato);
        await d.saveAs(destino);
        r.exportaciones[formato] = { nombre: d.suggestedFilename(), bytes: fs.statSync(destino).size, segundos: Math.round((Date.now() - t0) / 1000), enters, fallo: await d.failure() };
      } catch (e) { r.exportaciones[formato] = 'ERROR ' + String(e).slice(0, 160); }
      await page.waitForTimeout(1000);
    }
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.errores = [...new Set(errores)].slice(0, 8);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
