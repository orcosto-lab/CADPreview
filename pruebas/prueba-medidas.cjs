// Prueba de las herramientas de la barra que faltaban: opciones de zoom, Find, Layout y medidas (Distance, Angle, Area,
// Arc, XY) sobre la muestra pública "Cañón Pérez ñandú.dwg", dentro del panel de CADPreview en la réplica de Gmail.
// Para cada herramienta se guardan los textos NUEVOS que aparecen en el visor y una captura (resultados\medidas-*.png).
// Uso: node prueba-medidas.cjs
const { spawn } = require('child_process');
const { createRequire } = require('module');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
// playwright-core: se instala con "npm install" en esta carpeta; PLAYWRIGHT_DIR permite usar otra copia
const { chromium } = (() => { try { return require('playwright-core'); } catch (_) { return createRequire(path.join(process.env.PLAYWRIGHT_DIR || __dirname, 'x.js'))('playwright-core'); } })();
const NAVEGADOR = process.env.NAVEGADOR || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = path.join(TRABAJO, 'ext-test');
const OUT = path.join(TRABAJO, 'resultados');
const muestra = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(TRABAJO, 'muestras', 'Cañón Pérez ñandú.dwg');
const SOLO_LAYOUT = process.argv.includes('--solo-layout'); // solo abre el menú Layout (para dibujos con varios layouts)
const ESPERA_ABRIR_MS = (+process.env.ESPERA_RENDER_S || 120) * 1000;
const hash = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 10);

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), muestra], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-med-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1400, height: 850 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const page = await ctx.newPage();
  const errores = [];
  const registra = m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); };
  page.on('console', registra); page.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 200)));
  const r = { zoom: {}, find: {}, layout: {}, medidas: {} };
  try {
    await page.goto('http://127.0.0.1:8099/#inbox/prueba?projector=1&messagePartId=0.1', { waitUntil: 'load' });
    await page.locator('.cpv-primary:not([disabled])').waitFor({ timeout: 60000 });
    const tClic = Date.now();
    await page.locator('.cpv-primary').click();
    // por encima de 8 MB el panel avisa y pide confirmación
    await page.waitForTimeout(600);
    const seguir = page.getByText('Renderizar igualmente'); if (await seguir.isVisible().catch(() => false)) { r.avisoTamano = true; await seguir.click(); }
    await page.waitForFunction(() => document.getElementById('cadpreview-overlay')?.dataset.estado === 'abierto', null, { timeout: ESPERA_ABRIR_MS });
    r.abiertoMs = Date.now() - tClic;
    const frame = page.frames().find(f => /viewer\.html/.test(f.url()));
    let libres = 0;
    while (libres < 3) { await page.waitForTimeout(1000); libres = (await frame.evaluate(() => /Rendering drawing|Loading|Parsing|Procesando/i.test(document.body.innerText)).catch(() => false)) ? 0 : libres + 1; }
    r.pintadoMs = Date.now() - tClic;
    await page.waitForTimeout(1500);

    const SEL = '[class*="toolbar"] button, button[class*="toolbar"], [class*="toolbar-btn"]';
    // centro (en coordenadas de la página) del primer botón VISIBLE cuyo título cumple el patrón
    const centro = (patron) => frame.evaluate(({ p, sel }) => {
      const b = [...document.querySelectorAll(sel)].filter(x => new RegExp(p, 'i').test(x.getAttribute('title') || x.getAttribute('aria-label') || x.innerText || '')).find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!b) return null; const r = b.getBoundingClientRect(); const marco = window.frameElement ? window.frameElement.getBoundingClientRect() : { x: 0, y: 0 };
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, desactivado: !!(b.disabled || b.getAttribute('aria-disabled') === 'true') };
    }, { p: patron, sel: SEL });
    const clic = async (patron) => {
      const c = await centro(patron); if (!c) return null;
      const marco = await page.locator('#cadpreview-overlay iframe').boundingBox(); // el visor está en un iframe de otro origen: se suma su posición
      await page.mouse.click(c.x + marco.x, c.y + marco.y); await page.waitForTimeout(500); return c;
    };
    const menu = async () => frame.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)].filter(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0; }).map(b => (b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean))], SEL);
    const textos = () => frame.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && (e.textContent || '').trim() && e.getBoundingClientRect().width > 0).map(e => e.textContent.trim()).filter(t => t.length < 80));
    const nuevos = async (antes) => { const d = await textos(); const s = new Set(antes); return [...new Set(d.filter(t => !s.has(t)))].slice(0, 12); };
    const captura = async (n) => { await page.screenshot({ path: path.join(OUT, 'medidas-' + n + '.png') }); };
    const lienzo = async () => hash(await page.screenshot({ clip: { x: 0, y: 70, width: 1400, height: 700 } }));

    if (SOLO_LAYOUT) {
      const antesL = await textos(); await clic('^layout'); r.layout.menu = await menu(); r.layout.textosNuevos = await nuevos(antesL); await captura('5-layout-' + path.basename(muestra).replace(/[^\w.-]+/g, '_')); r.layout.entradasDelMenu = await frame.evaluate(() => [...document.querySelectorAll('[role=menuitem], [class*=menu] li, [class*=layout] button')].filter(e => e.getBoundingClientRect().width > 0).map(e => (e.getAttribute('title') || e.innerText || '').trim()).filter(Boolean));
      const h0 = await lienzo(); const el = frame.getByText(/^Presentaci/).first();
      if (await el.count()) { await el.click(); await page.waitForTimeout(3500); r.layout.cambioDeLienzo = (await lienzo()) !== h0; await captura('5b-layout-cambiado-' + path.basename(muestra).replace(/[^\w.-]+/g, '_')); }
      throw new Error('FIN');
    }

    // ---------- ZOOM ----------
    r.zoom.inicial = await lienzo();
    await clic('^zoom'); const menuZoom = await menu(); r.zoom.menu = menuZoom;
    r.zoom.saved = await centro('^saved');            // ¿activo? (sin vistas guardadas puede estar desactivado)
    await page.mouse.click(1000, 110); await page.waitForTimeout(300);  // cierra el menú
    // Window: elegir y dos clics sobre una zona
    await clic('^zoom'); await clic('^window');
    await page.mouse.click(200, 450); await page.waitForTimeout(400); await page.mouse.click(600, 750); await page.waitForTimeout(2000);
    r.zoom.trasWindow = await lienzo(); await captura('1-zoom-window');
    // Extents: vuelve a ver todo
    await clic('^zoom'); await clic('^extents'); await page.waitForTimeout(2000);
    r.zoom.trasExtents = await lienzo(); await captura('2-zoom-extents');
    // Smart
    await clic('^zoom'); await clic('^smart'); await page.waitForTimeout(2000);
    r.zoom.trasSmart = await lienzo(); await captura('3-zoom-smart');
    r.zoom.cambioConWindow = r.zoom.trasWindow !== r.zoom.inicial;
    r.zoom.extentsRestaura = r.zoom.trasExtents === r.zoom.inicial;

    // ---------- FIND ----------
    const antesFind = await textos();
    await clic('^find');
    await page.waitForTimeout(800);
    const caja = frame.locator('input[type="text"], input[type="search"], input:not([type])').filter({ hasNot: frame.locator('[placeholder="Type command"]') });
    const entradas = await frame.evaluate(() => [...document.querySelectorAll('input')].filter(i => i.getBoundingClientRect().width > 0).map(i => i.placeholder || i.type));
    r.find.entradasVisibles = entradas;
    const campo = frame.locator('input').filter({ has: frame.locator('xpath=self::*') }).filter({ hasNotText: 'zzzz' });
    const idx = entradas.findIndex(p => !/Type command/i.test(p));
    if (idx >= 0) {
      const visibles = await frame.locator('input:visible').all();
      let usado = null;
      for (const el of visibles) { const ph = await el.getAttribute('placeholder'); if (!/Type command/i.test(ph || '')) { usado = el; break; } }
      if (usado) {
        await usado.fill('Facade'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
        r.find.textosNuevos = await nuevos(antesFind); await captura('4-find');
      }
    } else r.find.nota = 'no apareció ningún campo de búsqueda';
    await page.keyboard.press('Escape').catch(() => { });

    // ---------- LAYOUT ----------
    const antesLayout = await textos();
    await clic('^layout');
    r.layout.menu = await menu();
    r.layout.textosNuevos = await nuevos(antesLayout); await captura('5-layout');
    await page.keyboard.press('Escape').catch(() => { }); await page.mouse.click(1000, 110); await page.waitForTimeout(300);

    // ---------- MEDIDAS ----------
    const medir = async (nombre, patron, puntos, fin) => {
      try {
        const antes = await textos();
        await clic('^measure'); const c = await clic(patron);
        if (!c) { r.medidas[nombre] = 'no hay entrada ' + patron; return; }
        for (const [x, y] of puntos) { await page.mouse.click(x, y); await page.waitForTimeout(500); }
        if (fin) { await page.keyboard.press(fin); }
        await page.waitForTimeout(1200);
        r.medidas[nombre] = await nuevos(antes); await captura('6-' + nombre);
        await page.keyboard.press('Escape').catch(() => { }); await page.waitForTimeout(300);
      } catch (e) { r.medidas[nombre] = 'ERROR ' + String(e).slice(0, 120); }
    };
    await medir('distance', '^distance', [[500, 140], [800, 140]]);
    await medir('angle', '^angle', [[400, 600], [600, 600], [400, 450]]);
    await medir('area', '^area', [[300, 560], [500, 560], [500, 700], [300, 700]], 'Enter');
    await medir('arc', '^arc', [[300, 700], [400, 600], [500, 700]]);
    await medir('xy', '^xy', [[420, 620]]);
  } catch (e) { if (!/^Error: FIN/.test(String(e))) r.error = String(e).slice(0, 300); }
  r.errores = [...new Set(errores)].slice(0, 6);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
