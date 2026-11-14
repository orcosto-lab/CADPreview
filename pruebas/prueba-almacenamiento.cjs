// Comprueba qué almacenamiento del navegador funciona en la página del visor: (a) abierta dentro del panel de Gmail
// (iframe de otro origen) y (b) abierta como página propia. Lo usa el visor para la caché de fuentes y el PDF.
// Uso: node prueba-almacenamiento.cjs
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
const ID = fs.readFileSync(path.join(EXT, 'id-extension.txt'), 'utf8').trim();
const muestra = path.join(TRABAJO, 'muestras', 'Cañón Pérez ñandú.dxf');

const sonda = async () => {
  const r = {};
  try { const q = indexedDB.open('sonda-' + Math.random()); await new Promise((ok, ko) => { q.onsuccess = ok; q.onerror = () => ko(q.error); q.onblocked = () => ko(new Error('bloqueada')); }); r.indexedDB = 'ok'; } catch (e) { r.indexedDB = 'FALLA ' + (e && e.name) + ': ' + (e && e.message); }
  try { await caches.open('sonda'); r.caches = 'ok'; } catch (e) { r.caches = 'FALLA ' + (e && e.name) + ': ' + (e && e.message); }
  try { localStorage.setItem('s', '1'); r.localStorage = 'ok'; } catch (e) { r.localStorage = 'FALLA ' + (e && e.name); }
  r.fakeIndexedDB = typeof globalThis.__fakeIndexedDB !== 'undefined' ? 'instalada' : 'no';
  return r;
};

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'servidor-gmail-falso.js'), muestra], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-alm-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await ctx.addInitScript(() => { window.GLOBALS = []; window.GLOBALS[9] = 'IK123'; });
  const res = {};
  try {
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8099/#inbox/prueba?projector=1&messagePartId=0.1', { waitUntil: 'load' });
    await page.locator('.cpv-primary:not([disabled])').waitFor({ timeout: 60000 });
    await page.locator('.cpv-primary').click();
    await page.waitForFunction(() => document.getElementById('cadpreview-overlay')?.dataset.estado === 'abierto', null, { timeout: 90000 });
    const frame = page.frames().find(f => /viewer\.html/.test(f.url()));
    res.dentroDelPanel = await frame.evaluate(sonda);
    const propia = await ctx.newPage();
    await propia.goto(`chrome-extension://${ID}/viewer/viewer.html`, { waitUntil: 'load' });
    res.paginaPropia = await propia.evaluate(sonda);
  } catch (e) { res.error = String(e).slice(0, 300); }
  console.log(JSON.stringify(res, null, 1));
  await ctx.close();
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
