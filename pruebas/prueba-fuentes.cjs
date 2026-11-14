// Prueba de la capa de fuentes: pide desde la página del visor una fuente incluida (simplex.shx) y una extra (simsun.ttf)
// DOS veces con el mismo perfil (simsun.ttf es el único fichero del repositorio que el catálogo no cita: 10 MB). Esperado: incluida -> "local" siempre; extra -> "cdn" la 1.ª vez y "cache" la 2.ª.
// Uso: node prueba-fuentes.cjs
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
const COMMIT = /FONT_COMMIT = '([0-9a-f]{40})'/.exec(fs.readFileSync(path.join(__dirname, '..', 'fuente', 'src', 'font-shim.js'), 'utf8'))[1];
const BASE = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@' + COMMIT + '/fonts/';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-fuentes-'));
  let fallos = 0;
  for (const vez of [1, 2]) {
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: NAVEGADOR, headless: false,
      args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    const trazas = [];
    const page = await ctx.newPage();
    page.on('console', m => { const t = m.text(); if (/^\[cadpreview-fuentes\]/.test(t)) trazas.push(t.replace('[cadpreview-fuentes] ', '')); });
    await page.goto(`chrome-extension://${ID}/viewer/viewer.html`, { waitUntil: 'load' });
    const res = await page.evaluate(async (base) => {
      const out = {};
      for (const f of ['simplex.shx', 'AMGDT DWE Edits.shx', '@extfont2.shx', 'simsun.ttf', 'no-existe-xyz.shx']) {
        try { const r = await fetch(base + f); out[f] = { ok: r.ok, status: r.status, bytes: r.ok ? (await r.arrayBuffer()).byteLength : 0 }; }
        catch (e) { out[f] = { error: String(e).slice(0, 60) }; }
      }
      return out;
    }, BASE);
    const origen = f => (trazas.find(t => t.split(' ').slice(1).join(' ').startsWith(f + ' ')) || '').split(' ')[0] || '(sin traza)';
    console.log(`Vez ${vez}: simplex.shx → ${origen('simplex.shx')} (${res['simplex.shx'].bytes} B) | simsun.ttf → ${origen('simsun.ttf')} (${res['simsun.ttf'].bytes} B) | no-existe → HTTP ${res['no-existe-xyz.shx'].status} (${origen('no-existe-xyz.shx')})`);
    const esperado = vez === 1 ? 'cdn' : 'cache';
    console.log(`        nombres con espacio o @: "AMGDT DWE Edits.shx" → ${origen('AMGDT DWE Edits.shx')} (${res['AMGDT DWE Edits.shx'].bytes} B) | "@extfont2.shx" → ${origen('@extfont2.shx')} (${res['@extfont2.shx'].bytes} B)`);
    if (origen('AMGDT DWE Edits.shx') !== 'local' || origen('@extfont2.shx') !== 'local' || origen('simplex.shx') !== 'local' || origen('simsun.ttf') !== esperado || !res['simsun.ttf'].ok) fallos++;
    await ctx.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fallos ? 'FALLOS: ' + fallos : 'OK: incluida=local; extra=cdn la 1.ª vez y cache la 2.ª');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
