// Prueba automática del panel de CADPreview (miniatura al instante + botón "Renderizar") en Brave con la extensión
// cargada, sobre una réplica mínima de Gmail que envía la política de seguridad real de Gmail (gmail-csp.txt).
// Uso: node prueba-panel.js <archivo> [--lista] [--render] [--forzar] [--tag nombre]
//   --lista   abre el visor desde la lista (chip + projector=1 sin messagePartId); por defecto, desde el mensaje.
//   --render  pulsa "Renderizar" y espera a que el dibujo termine de pintarse.
//   --forzar  si sale el aviso por tamaño, pulsa "Renderizar igualmente".
// Variables: CADPREVIEW_TRABAJO (por defecto la carpeta "trabajo" del repositorio), PLAYWRIGHT_DIR, NAVEGADOR.
// Usa archivos locales (nunca se suben a ningún sitio). Las capturas van a <trabajo>\resultados.
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

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const tag = flag('--tag') ? args[args.indexOf('--tag') + 1] : '';
const muestra = args.find((a, i) => !a.startsWith('--') && !(flag('--tag') && i === args.indexOf('--tag') + 1));
if (!muestra) { console.error('Uso: node prueba-panel.js <archivo> [--lista] [--render] [--forzar] [--tag nombre]'); process.exit(1); }

const leer = (page) => page.evaluate(() => {
  const el = document.getElementById('cadpreview-overlay');
  if (!el) return null;
  const q = s => el.querySelector(s);
  return {
    estado: el.dataset.estado, origen: el.dataset.origen, miniatura: el.dataset.miniatura || null,
    tamano: el.dataset.tamano || null, csp: el.dataset.csp || null, ms: el.dataset.ms || null,
    titulo: q('.cpv-title').textContent, info: q('.cpv-info').textContent, nota: (q('.cpv-note') || {}).textContent || null,
    botonRenderizar: { texto: q('.cpv-primary').textContent, activo: !q('.cpv-primary').disabled },
    aviso: q('.cpv-aviso').style.display === 'flex' ? q('.cpv-aviso .cpv-txt').textContent : null,
  };
});

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), muestra], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  // PERFIL_DIR: perfil persistente (para comprobar la caché de fuentes entre dos ejecuciones); si no, uno temporal
  const dir = process.env.PERFIL_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const externas = new Set(), fuentesLocales = new Set();
  ctx.on('request', r => {
    const u = r.url();
    if (/jsdelivr/.test(u)) externas.add(u.replace(/^https:\/\/cdn\.jsdelivr\.net\/gh\/mlightcad\/cad-data@[0-9a-f]+\//, '…/'));
    if (/\/viewer\/data\/fonts\//.test(u)) fuentesLocales.add(u.split('/').pop());
  });
  const page = await ctx.newPage();
  const logs = [], fuentes = [], trazas = [];
  const consola = m => {
    const t = m.text();
    if (/^\[cadpreview-fuentes\]/.test(t)) fuentes.push(t.replace('[cadpreview-fuentes] ', ''));
    else if (/^\[cadpreview\] /.test(t)) trazas.push(t.replace('[cadpreview] ', ''));
    else if (m.type() === 'error') logs.push(t.slice(0, 240));
  };
  page.on('console', consola);
  page.on('worker', w => w.on('console', consola));
  const nombre = path.basename(muestra).replace(/[^\w.-]+/g, '_') + (flag('--lista') ? '__lista' : '__mensaje') + (tag ? '__' + tag : '');
  const r = { muestra: path.basename(muestra), modo: flag('--lista') ? 'lista' : 'mensaje' };
  try {
    if (flag('--lista')) {
      await page.goto('http://127.0.0.1:8099/mail/u/0/#search/dwg', { waitUntil: 'load' });
      await page.waitForTimeout(800);
      r.sinClicNoHayPanel = await page.evaluate(() => !document.getElementById('cadpreview-overlay'));
      await page.locator('.brc').nth(1).click();
      await page.evaluate(() => { location.hash = '#search/dwg?projector=1'; });
    } else {
      await page.goto('http://127.0.0.1:8099/#inbox/prueba?projector=1&messagePartId=0.1', { waitUntil: 'load' });
    }
    const t0 = Date.now();
    const listos = ['miniatura', 'sin-miniatura', 'error-miniatura', 'error-localizar', 'bloqueado-csp'];
    let d = null;
    for (let i = 0; i < 120; i++) { await page.waitForTimeout(500); d = await leer(page); if (d && listos.includes(d.estado)) break; }
    r.alAbrir = d; r.hastaMiniaturaMs = Date.now() - t0;
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, nombre + '__1-miniatura.png') });
    if (flag('--cerrar')) { // Esc debe cerrar el panel Y quitar projector=1 de la dirección (cierra también el visor de Gmail)
      const hashAntes = await page.evaluate(() => location.hash);
      await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      r.cierre = { hashAntes, hashDespues: await page.evaluate(() => location.hash), panelCerrado: await page.evaluate(() => !document.getElementById('cadpreview-overlay')) };
    }

    if (flag('--render') && d && d.botonRenderizar.activo) {
      await page.locator('.cpv-primary').click();
      let e = null;
      for (let i = 0; i < 20; i++) { await page.waitForTimeout(250); e = await leer(page); if (e && e.estado !== d.estado) break; }
      if (e && e.estado === 'aviso-tamano') {
        r.aviso = e.aviso;
        await page.screenshot({ path: path.join(OUT, nombre + '__2-aviso.png') });
        if (flag('--forzar')) await page.getByText('Renderizar igualmente').click(); else { r.renderizado = false; throw new Error('FIN: aviso sin --forzar'); }
      }
      const t1 = Date.now();
      const fin = ['abierto', 'error-lectura', 'error-apertura', 'sin-respuesta', 'bloqueado-csp'];
      const ESPERA_S = +process.env.ESPERA_RENDER_S || 180; // segundos máximos hasta que el visor abre el archivo
      for (let i = 0; i < ESPERA_S * 2; i++) { await page.waitForTimeout(500); e = await leer(page); if (e && fin.includes(e.estado)) break; }
      r.alRenderizar = e; r.hastaAbiertoMs = Date.now() - t1;
      if (e && e.estado === 'abierto') {
        const frame = page.frames().find(f => /viewer\.html/.test(f.url()));
        let libres = 0; const t2 = Date.now();
        while (libres < 3 && Date.now() - t2 < 120000) {
          await page.waitForTimeout(1000);
          const ocupado = await frame.evaluate(() => /Rendering drawing|Loading|Parsing|Procesando/i.test(document.body.innerText)).catch(() => false);
          libres = ocupado ? 0 : libres + 1;
        }
        r.hastaPintadoMs = Date.now() - t1;
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, nombre + '__3-render.png') });
      } else await page.screenshot({ path: path.join(OUT, nombre + '__3-render-error.png') });
    }
  } catch (e) { if (!/^Error: FIN/.test(String(e))) r.error = String(e).slice(0, 300); }
  r.peticionesAJsDelivr = [...externas];
  r.fuentesLocalesUsadas = [...fuentesLocales];
  r.fuentes = fuentes; // origen (local/cache/cdn), nombre y tiempo de cada fuente pedida
  r.trazas = trazas;   // tiempos internos del visor (arranque de plugins y lectura del dibujo)
  r.errores = [...new Set(logs)].slice(0, 5);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close();
  srv.kill();
  if (!process.env.PERFIL_DIR) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ } }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
