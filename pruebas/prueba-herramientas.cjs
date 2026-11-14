// Prueba de la barra de herramientas del visor (plugin de interfaz) dentro del panel de CADPreview.
// Abre una muestra pública desde la réplica de Gmail, pulsa "Renderizar" y: lista los botones, abre el menú de zoom,
// el panel de capas y exporta a HTML, PDF y SVG (captura las descargas).
// Uso: node prueba-herramientas.cjs [archivo]   (por defecto, la muestra pública "Cañón Pérez ñandú.dwg")
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
const muestra = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(TRABAJO, 'muestras', 'Cañón Pérez ñandú.dwg');

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), muestra], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-herr-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1400, height: 850 }, acceptDownloads: true,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const page = await ctx.newPage();
  const errores = [];
  const registra = m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); };
  page.on('console', registra);
  page.on('worker', w => w.on('console', registra));
  const r = { muestra: path.basename(muestra) };
  try {
    await page.goto('http://127.0.0.1:8099/#inbox/prueba?projector=1&messagePartId=0.1', { waitUntil: 'load' });
    await page.locator('.cpv-primary:not([disabled])').waitFor({ timeout: 60000 });
    await page.locator('.cpv-primary').click();
    await page.waitForFunction(() => document.getElementById('cadpreview-overlay')?.dataset.estado === 'abierto', null, { timeout: 120000 });
    const frame = page.frames().find(f => /viewer\.html/.test(f.url()));
    let libres = 0;
    while (libres < 3) { await page.waitForTimeout(1000); libres = (await frame.evaluate(() => /Rendering drawing|Loading|Parsing|Procesando/i.test(document.body.innerText)).catch(() => false)) ? 0 : libres + 1; }
    await page.waitForTimeout(1500);

    // 1) todos los botones de la barra (raíz y submenús ya abiertos)
    const botones = () => frame.evaluate(() => [...document.querySelectorAll('[class*="toolbar"] button, button[class*="toolbar"], [class*="toolbar-btn"]')]
      .filter(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0; })
      .map(b => (b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean));
    r.botonesRaiz = [...new Set(await botones())];
    await page.screenshot({ path: path.join(OUT, 'herramientas__1-barra.png') });

    // 2) zoom
    const abrir = async (patron) => {
      const b = frame.locator('[class*="toolbar"] button, button[class*="toolbar"], [class*="toolbar-btn"]').filter({ has: frame.locator('xpath=self::*') });
      const el = await frame.evaluateHandle((p) => [...document.querySelectorAll('[class*="toolbar"] button, button[class*="toolbar"], [class*="toolbar-btn"]')].filter(b => new RegExp(p, 'i').test(b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '')).find(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0; }) || null, patron);
      return el.asElement();
    };
    const zoom = await abrir('^zoom');
    if (zoom) { await zoom.click(); await page.waitForTimeout(600); r.menuZoom = [...new Set(await botones())].filter(t => !r.botonesRaiz.includes(t)); await page.screenshot({ path: path.join(OUT, 'herramientas__2-zoom.png') }); await zoom.click().catch(() => { }); }

    // 3) capas
    const capas = await abrir('layer');
    if (capas) { await capas.click(); await page.waitForTimeout(1200); r.panelCapas = await frame.evaluate(() => (document.body.innerText.match(/layer/gi) || []).length); await page.screenshot({ path: path.join(OUT, 'herramientas__3-capas.png') }); await capas.click().catch(() => { }); }

    // 4) exportar: HTML, PDF, SVG
    r.exportaciones = {};
    for (const formato of (process.argv.includes('--sin-exportar') ? [] : ['html', 'pdf', 'svg'])) {
      try {
        const exp = await abrir('^export$');
        if (!exp) { r.exportaciones[formato] = 'no hay botón Export'; continue; }
        await exp.click(); await page.waitForTimeout(500);
        const item = await abrir(formato);
        if (!item) { r.exportaciones[formato] = 'no hay entrada ' + formato; await exp.click().catch(() => { }); continue; }
        // HTML y PDF preguntan en la línea de comandos ("Export format…", "Model space frame…"): se aceptan los
        // valores por defecto con Intro cada 2 s hasta que llega la descarga (SVG no pregunta nada)
        let hayDescarga = false;
        const espera = page.waitForEvent('download', { timeout: 60000 }).then(d => { hayDescarga = true; return d; }, () => null);
        await item.click();
        r.preguntas = r.preguntas || {};
        for (let i = 0; i < 10 && !hayDescarga; i++) {
          await page.waitForTimeout(2500);
          if (hayDescarga) break;
          const lineas = await frame.evaluate(() => document.body.innerText.split('\n').map(s => s.trim()).filter(l => /\]\s*<[^>]*>\s*:?\s*$|^Specify|^Enter |^Select |\?\s*$/.test(l)).slice(-3));
          (r.preguntas[formato] = r.preguntas[formato] || []).push(lineas);
          await frame.locator('input[placeholder="Type command"]').focus().catch(() => { });
          await page.keyboard.press('Enter');
        }
        const descarga = await espera;
        if (!descarga) { r.exportaciones[formato] = 'sin descarga tras responder a las preguntas'; await page.screenshot({ path: path.join(OUT, 'herramientas__sin-descarga-' + formato + '.png') }); continue; }
        const destino = path.join(EXPORTS, 'prueba.' + formato);
        await descarga.saveAs(destino);
        r.exportaciones[formato] = { nombre: descarga.suggestedFilename(), bytes: fs.statSync(destino).size, fallo: await descarga.failure() };
      } catch (e) { r.exportaciones[formato] = 'ERROR ' + String(e).slice(0, 120); }
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(OUT, 'herramientas__4-tras-exportar.png') });

    // 5) medir distancia: menú Measure → Distance → dos clics sobre el dibujo
    try {
      await page.mouse.click(255, 73).catch(() => { }); // cierra el panel de capas (tapa parte del dibujo) ANTES de abrir el menú
      await page.waitForTimeout(500);
      const med = await abrir('^measure$');
      await med.click(); await page.waitForTimeout(500);
      r.menuMedir = [...new Set(await botones())].filter(t => !r.botonesRaiz.includes(t));
      const dist = await abrir('^distance');
      if (dist) {
        const caja = await dist.boundingBox(); r.cajaDistancia = caja;
        await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2); await page.waitForTimeout(200);
        await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2); await page.waitForTimeout(900);
        r.avisosTrasElegir = await frame.evaluate(() => document.body.innerText.split('\n').map(s => s.trim()).filter(l => /point|punto|Specify/i.test(l)).slice(-3));
        await page.mouse.click(500, 140); await page.waitForTimeout(600);
        await page.mouse.click(800, 140); await page.waitForTimeout(1500);
        r.medirTextoCerca = await frame.evaluate(() => (document.body.innerText.match(/[^\n]*(distance|Distance|length|Length)[^\n]*/g) || []).slice(0, 4));
        await page.screenshot({ path: path.join(OUT, 'herramientas__5-medir.png') });
      }
    } catch (e) { r.medir = 'ERROR ' + String(e).slice(0, 120); }

    // 6) mini barra Undo / Redo / Delete: dónde está, para ocultarla (no se debe poder borrar nada)
    r.miniBarra = await frame.evaluate(() => { const u = [...document.querySelectorAll('[title]')].find(e => e.getAttribute('title') === 'Undo'); if (!u) return null; const cadena = []; for (let e = u, i = 0; e && i < 5; e = e.parentElement, i++) cadena.push(e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/).join('.').slice(0, 60)); return { cadena, deshabilitado: u.disabled || u.getAttribute('aria-disabled') }; });
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.errores = [...new Set(errores)].slice(0, 6);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
