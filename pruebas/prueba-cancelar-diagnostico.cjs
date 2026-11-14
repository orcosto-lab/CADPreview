// Prueba de v1.1: botón "Cancelar" durante el render y autodiagnóstico (aviso + "Copiar informe"), sobre la réplica de Drive.
// Uso: node prueba-cancelar-diagnostico.cjs   (necesita haber construido con: node construir.mjs --prueba)
const { spawn, execFileSync } = require('child_process');
const { createRequire } = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRABAJO = process.env.CADPREVIEW_TRABAJO || path.join(__dirname, '..', 'trabajo');
// playwright-core: se instala con "npm install" en esta carpeta; PLAYWRIGHT_DIR permite usar otra copia
const { chromium } = (() => { try { return require('playwright-core'); } catch (_) { return createRequire(path.join(process.env.PLAYWRIGHT_DIR || __dirname, 'x.js'))('playwright-core'); } })();
const NAVEGADOR = process.env.NAVEGADOR || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const OPENSSL = process.env.OPENSSL || 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe';
const EXT = path.join(TRABAJO, 'ext-test');
const MUESTRAS = path.join(TRABAJO, 'muestras');
const PUERTO = 8444;

(async () => {
  const dirCert = path.join(TRABAJO, 'cert');
  const CERT = path.join(dirCert, 'cert.pem'), CLAVE = path.join(dirCert, 'clave.pem');
  if (!fs.existsSync(CERT)) {
    fs.mkdirSync(dirCert, { recursive: true });
    execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', CLAVE, '-out', CERT, '-days', '3', '-subj', '/CN=drive.google.com'], { stdio: 'ignore', env: Object.assign({}, process.env, { OPENSSL_CONF: 'C:\\Program Files\\Git\\mingw64\\etc\\ssl\\openssl.cnf' }) });
  }
  const srv = spawn('node', [path.join(__dirname, 'servidor-drive-falso.js'), MUESTRAS, CERT, CLAVE, String(PUERTO)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpreview-cd-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: NAVEGADOR, headless: false, viewport: { width: 1300, height: 800 }, ignoreHTTPSErrors: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--ignore-certificate-errors', `--host-resolver-rules=MAP drive.google.com 127.0.0.1:${PUERTO},MAP drive.usercontent.google.com 127.0.0.1:${PUERTO}`],
  });
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://drive.google.com' }); } catch (_) { /* nada */ }
  const errores = [];
  const nueva = async (query, conBoton = true) => {
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error' || /\[CADPreview\]/.test(m.text())) errores.push(m.type() + ': ' + m.text().slice(0, 200)); });
    p.on('pageerror', e => errores.push('pageerror: ' + String(e).slice(0, 200)));
    await p.goto('https://drive.google.com/drive/recent' + (query || ''), { waitUntil: 'load' });
    if (conBoton) await p.evaluate(() => { document.documentElement.dataset.cadpreviewBotonFilas = '1'; const d = document.createElement('div'); document.body.append(d); d.remove(); });
    return p;
  };
  const leer = (p) => p.evaluate(() => {
    const el = document.getElementById('cadpreview-overlay');
    if (!el) return null;
    const vis = (s) => { const b = el.querySelector(s); return !!b && b.style.display !== 'none'; };
    const rb = [...el.querySelectorAll('.cpv-head .cpv-btn')].find(b => /^(Renderizar|Reintentar|Renderizando|Renderizado)/.test(b.textContent));
    return { estado: el.dataset.estado, info: el.querySelector('.cpv-info').textContent, iframes: el.querySelectorAll('iframe').length,
      cancelar: vis('.cpv-cancelar'), renderTxt: rb && rb.textContent, renderOff: rb && rb.disabled, miniatura: getComputedStyle(el.querySelector('.cpv-thumb')).display !== 'none',
      informe: [...el.querySelectorAll('.cpv-head .cpv-btn')].some(b => b.textContent.startsWith('Copiar informe') && b.style.display !== 'none') };
  });
  const esperar = async (p, ok, n = 120) => { for (let i = 0; i < n; i++) { const e = await leer(p); if (e && ok(e)) return e; await p.waitForTimeout(250); } return leer(p); };
  const r = { cancelar: {}, diagnostico: {}, informePanel: {} };
  try {
    // ---------- Cancelar ----------
    let p = await nueva(); await p.waitForTimeout(1200);
    await p.locator('tr[data-id="id_dwg_nandu_000001"] .cadpreview-btn').click();
    r.cancelar.panel = await esperar(p, e => /^(miniatura|sin-miniatura|error-miniatura)$/.test(e.estado));
    await p.locator('.cpv-primary').click();
    r.cancelar.renderizando = await esperar(p, e => e.estado === 'renderizando' || e.estado === 'enviado', 40);
    await p.locator('.cpv-cancelar').click();
    await p.waitForTimeout(300);
    r.cancelar.trasCancelar = await leer(p);
    // no debe reaparecer nada pasado el tiempo del timeout de 15 s ni llegar el visor tarde
    await p.waitForTimeout(17000);
    r.cancelar.pasados17s = await leer(p);
    // y se puede volver a renderizar
    await p.locator('.cpv-primary').click();
    r.cancelar.segundoRender = await esperar(p, e => e.estado === 'abierto' || /^error|sin-resp/.test(e.estado), 240);
    r.cancelar.cancelarOcultoAlTerminar = r.cancelar.segundoRender && r.cancelar.segundoRender.cancelar === false;
    const c = r.cancelar;
    c.correcto = !!c.renderizando && c.renderizando.cancelar === true && c.trasCancelar.estado === 'miniatura' && c.trasCancelar.iframes === 0 && c.trasCancelar.cancelar === false
      && c.trasCancelar.renderTxt === 'Renderizar' && c.trasCancelar.renderOff === false && c.trasCancelar.miniatura === true
      && c.pasados17s.estado === 'miniatura' && c.pasados17s.iframes === 0 && c.segundoRender.estado === 'abierto' && c.cancelarOcultoAlTerminar === true;
    await p.close();

    // ---------- Autodiagnóstico: página sin tocar (no debe avisar) ----------
    p = await nueva('', false); await p.waitForTimeout(6500);
    r.diagnostico.sinAlterar = { aviso: await p.evaluate(() => !!document.getElementById('cadpreview-aviso')) };
    // ---------- página con el HTML alterado: el nombre ya no está en <strong> ni en tooltips ----------
    await p.evaluate(() => {
      for (const tr of document.querySelectorAll('tr[data-id]')) {
        const s = tr.querySelector('strong');
        if (s) { const sp = document.createElement('span'); sp.textContent = s.textContent; s.replaceWith(sp); }
        for (const e of tr.querySelectorAll('[data-tooltip],[aria-label]')) { e.removeAttribute('data-tooltip'); e.removeAttribute('aria-label'); }
        tr.removeAttribute('aria-label');
      }
    });
    r.diagnostico.aviso = null;
    for (let i = 0; i < 20 && !r.diagnostico.aviso; i++) { await p.waitForTimeout(500); r.diagnostico.aviso = await p.evaluate(() => { const a = document.getElementById('cadpreview-aviso'); return a ? a.textContent : null; }); }
    r.diagnostico.depuracion = await p.evaluate(() => ({ oculta: document.hidden, filas: document.querySelectorAll('tr[data-id]').length, txt: document.querySelector('tr[data-id]').textContent.slice(0, 120), tips: document.querySelector('tr[data-id]').querySelectorAll('[data-tooltip],[aria-label]').length, strongs: document.querySelectorAll('tr[data-id] strong').length, btn: document.querySelectorAll('.cadpreview-btn').length, items: document.querySelectorAll('tr[data-id], [role=gridcell][data-id]').length }));
    await p.locator('#cadpreview-aviso button', { hasText: 'Copiar informe' }).click({ timeout: 4000 });
    await p.waitForTimeout(500);
    r.diagnostico.botonTrasCopiar = await p.evaluate(() => [...document.querySelectorAll('#cadpreview-aviso button')].map(b => b.textContent));
    const informe = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERROR: ' + e));
    r.diagnostico.informe = informe;
    r.diagnostico.sinDatosPersonales = !/Cañón|Pérez|ñandú|\.dwg|\.dxf|https?:|drive\.google/i.test(informe);
    r.diagnostico.contieneEstructura = /CADPreview 1\.1/.test(informe) && /sitio: drive/.test(informe) && /tr\[data-id\] = \d+/.test(informe) && /sospechosos: [1-9]/.test(informe);
    // descartar con la x
    await p.locator('#cadpreview-aviso button', { hasText: '×' }).click(); await p.waitForTimeout(3500);
    r.diagnostico.descartado = await p.evaluate(() => !document.getElementById('cadpreview-aviso'));
    r.diagnostico.correcto = r.diagnostico.sinAlterar.aviso === false && /no reconoce este adjunto/.test(r.diagnostico.aviso || '') && r.diagnostico.sinDatosPersonales && r.diagnostico.contieneEstructura && r.diagnostico.descartado;
    await p.close();

    // ---------- "Copiar informe" en el panel cuando hay error (archivo que el servidor prohíbe: 403) ----------
    p = await nueva(); await p.waitForTimeout(1200);
    await p.locator('tr[data-id="id_prohibido_dwg_008"] .cadpreview-btn').click();
    r.informePanel.panel = await esperar(p, e => /^(error|miniatura|sin-miniatura)/.test(e.estado), 60);
    if (r.informePanel.panel && r.informePanel.panel.estado === 'miniatura') { await p.locator('.cpv-primary').click(); r.informePanel.panel = await esperar(p, e => /^error|sin-resp/.test(e.estado), 120); }
    await p.locator('.cpv-head .cpv-btn', { hasText: 'Copiar informe' }).click(); await p.waitForTimeout(500);
    const inf2 = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERROR: ' + e));
    r.informePanel.informe = inf2;
    r.informePanel.correcto = !!r.informePanel.panel && r.informePanel.panel.informe === true && /estado: error/.test(inf2) && !/Prohibido|\.dwg|https?:/i.test(inf2);
    await p.close();
  } catch (e) { r.error = String(e).slice(0, 500); }
  r.errores = errores.slice(-14);
  console.log(JSON.stringify(r, null, 1));
  await ctx.close(); srv.kill();
})();
