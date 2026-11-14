// CADPreview (fase C): núcleo común. Un único panel sobre el correo web:
//  1) Muestra al instante la miniatura incrustada en el .dwg/.dxf (lo que era la fase A).
//  2) El botón "Renderizar" carga en el mismo panel el visor completo, en una página de la extensión (fase B),
//     porque tarda mucho más en abrirse.
// Este archivo no sabe nada de ningún correo en concreto: cada sitio (Gmail, IONOS...) tiene su adaptador, que detecta
// cuándo se abre un adjunto y llama a window.CADPreview.abrir({...}).
// Corre en el MUNDO DE LA PÁGINA (los adaptadores lo necesitan). La URL del visor se la deja el puente (bridge.js) en
// document.documentElement.dataset.cadpreviewViewer. Todo es local: el adjunto se lee con la sesión del correo ya
// abierta y no se envía a ningún sitio.
//
// API para los adaptadores:
//   CADPreview.abrir({ nombre, adjunto?, resolver?, tamanoAprox?, origen?, alCerrar? })
//     nombre       nombre del archivo que se muestra en el título
//     adjunto      { name, url } si ya se conoce; si no, resolver() lo devuelve (async) o null si no lo encuentra
//     tamanoAprox  tamaño en bytes si el servidor no lo da (p. ej. el que muestra la pantalla)
//     sondearTamano  true si el servidor entiende Range pero NO responde a "los últimos N bytes" (IONOS): el tamaño exacto
//                  se pide con bytes=0-0 y las lecturas parciales se hacen siempre con "desde X"
//     origen       texto para las pruebas ("mensaje", "lista", "ionos"...)
//     alCerrar     se llama al pulsar Cerrar o Esc (p. ej. para cerrar también el visor del propio correo)
//   CADPreview.cerrar()      quita el panel
//   CADPreview.esCad(nombre) true si es .dwg o .dxf
(() => {
  'use strict';
  if (window.CADPreview) return;

  const VIEWER_URL = document.documentElement.dataset.cadpreviewViewer;
  if (!VIEWER_URL) { console.warn('[CADPreview] No se encontró la URL del visor (puente no ejecutado).'); return; }
  const VIEWER_ORIGIN = new URL(VIEWER_URL).origin;
  const ID = 'cadpreview-overlay';
  const CAD_RE = /\.(dwg|dxf)$/i;
  const SENTINEL = [0x1F, 0x25, 0x6D, 0x07, 0xD4, 0x36, 0x28, 0x28, 0x9D, 0x57, 0xCA, 0x3F, 0x9D, 0x44, 0x10, 0x2B];
  const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const MAX_BYTES = 8 * 1024 * 1024;            // tope al leer la cabecera de un DWG
  const MAX_DXF = 30 * 1024 * 1024;
  const AVISO_RENDER_BYTES = 8 * 1024 * 1024;   // por encima, "Renderizar" pide confirmación
  let seq = 0;
  let objectUrl = null;
  let msgHandler = null;
  let cspHandler = null;
  let teclasHandler = null;
  let alCerrarActual = null;

  // Un adaptador puede registrar su propia lectura del archivo (Drive: el servidor de descargas no admite CORS desde la
  // página y se lee desde el service worker de la extensión). Debe devolver un Response, como fetch.
  let lectorPropio = null; // { acepta(url) → bool, fetch(url, init) → Promise<Response> }
  const leer = (url, init) => (lectorPropio && lectorPropio.acepta(url)) ? lectorPropio.fetch(url, init) : fetch(url, init);

  // <<dxf
  // Sección THUMBNAILIMAGE de un DXF ASCII (R2000 o posterior): el código 90 da el tamaño en bytes y los
  // grupos 310 llevan los datos en hexadecimal (un DIB, sin la cabecera de archivo BMP).
  function parseDxfThumbnail(text) {
    const i = text.indexOf('THUMBNAILIMAGE');
    if (i < 0) return { missing: true };
    const lines = text.slice(i).split(/\r?\n/).map(s => s.trim());
    const k90 = lines.indexOf('90');
    const declared = k90 >= 0 ? parseInt(lines[k90 + 1], 10) : NaN;
    let k = lines.indexOf('310');
    if (k < 0) return { empty: true };
    const hex = [];
    for (; k + 1 < lines.length && lines[k] === '310'; k += 2) hex.push(lines[k + 1]);
    const hs = hex.join('');
    if (hs.length % 2 || /[^0-9A-Fa-f]/.test(hs)) return { corrupt: true };
    const dib = new Uint8Array(hs.length / 2);
    for (let j = 0; j < dib.length; j++) dib[j] = parseInt(hs.substr(j * 2, 2), 16);
    if (dib.length < 40 || ![40, 108, 124].includes(new DataView(dib.buffer).getUint32(0, true))) return { corrupt: true };
    return { dib, declared, truncated: Number.isFinite(declared) && dib.length < declared };
  }
  // dxf>>

  const hasSig = (buf, off, sig) => off >= 0 && off + sig.length <= buf.length && sig.every((b, i) => buf[off + i] === b);

  // ---------- Miniaturas ----------
  // Lectura en streaming: se corta en cuanto se tiene la miniatura (no se baja el DWG entero).
  function makeReader(resp) {
    const reader = resp.body.getReader();
    let buf = new Uint8Array(0);
    let done = false;
    return {
      get buf() { return buf; },
      async ensure(n) {
        if (n > MAX_BYTES * 2) return false;
        while (buf.length < n && !done) {
          const r = await reader.read();
          if (r.done) { done = true; break; }
          const nb = new Uint8Array(buf.length + r.value.length);
          nb.set(buf); nb.set(r.value, buf.length); buf = nb;
        }
        return buf.length >= n;
      },
      cancel() { try { reader.cancel(); } catch (_) { /* nada */ } }
    };
  }

  function dibToBmp(dib) {
    const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    const hdr = dv.getUint32(0, true);
    const bits = dv.getUint16(14, true);
    const comp = dv.getUint32(16, true);
    let colors = dv.getUint32(32, true);
    if (!colors && bits <= 8) colors = 1 << bits;
    const off = 14 + hdr + colors * 4 + (comp === 3 && hdr === 40 ? 12 : 0);
    const out = new Uint8Array(14 + dib.length);
    out[0] = 0x42; out[1] = 0x4D;
    const o = new DataView(out.buffer);
    o.setUint32(2, out.length, true); o.setUint32(10, off, true);
    out.set(dib, 14);
    return out;
  }

  // Devuelve { size, version, kind, blob } o { size, version, none: "motivo" }
  async function extractDwgThumb(url, signal, sondear) {
    const total = sondear ? await tamanoPorSonda(url, signal) : null;
    const resp = await leer(url, { credentials: 'include', signal });
    if (!resp.ok) throw new Error('El servidor respondió HTTP ' + resp.status);
    const size = +resp.headers.get('content-length') || total || null;
    const res = (o) => Object.assign({ size }, o);
    const rd = makeReader(resp);
    try {
      const dv = () => new DataView(rd.buf.buffer, rd.buf.byteOffset, rd.buf.byteLength);
      if (!(await rd.ensure(0x11))) return res({ none: 'El archivo está incompleto o no es un DWG.' });
      const version = String.fromCharCode(...rd.buf.slice(0, 6));
      if (!/^AC10(1[2-9]|[2-9]\d)$/.test(version)) return res({ version, none: 'Esta versión de DWG (' + version + ') no incluye miniatura.' });
      const seeker = dv().getInt32(0x0D, true);
      if (seeker <= 0 || seeker > MAX_BYTES) return res({ version, none: 'Este DWG no guarda miniatura (guardado con RASTERPREVIEW/THUMBSAVE desactivados, o creado con otro software).' });
      if (!(await rd.ensure(seeker + 21)) || !hasSig(rd.buf, seeker, SENTINEL)) return res({ version, none: 'No se encontró el bloque de miniatura en la cabecera.' });
      const n = Math.min(rd.buf[seeker + 20], 8);
      if (!(await rd.ensure(seeker + 21 + n * 9))) return res({ version, none: 'Cabecera de miniatura incompleta.' });
      const entries = [];
      for (let i = 0; i < n; i++) {
        const p = seeker + 21 + i * 9;
        entries.push({ code: rd.buf[p], start: dv().getInt32(p + 1, true), size: dv().getInt32(p + 5, true) });
      }
      let bmpDib = null;
      for (const e of entries) {
        if (e.code === 1 || e.start <= 0 || e.size <= 0 || e.size > MAX_BYTES) continue;
        if (!(await rd.ensure(e.start + e.size))) continue;
        const data = rd.buf.slice(e.start, e.start + e.size);
        if (hasSig(data, 0, PNG_SIG)) return res({ version, kind: 'PNG', blob: new Blob([data], { type: 'image/png' }) });
        if (e.code === 2 && !bmpDib) bmpDib = data;
      }
      if (bmpDib) return res({ version, kind: 'BMP', blob: new Blob([dibToBmp(bmpDib)], { type: 'image/bmp' }) });
      return res({ version, none: 'Este DWG no incluye miniatura.' });
    } finally {
      rd.cancel();
    }
  }

  // Tamaño exacto pidiendo un solo byte (content-range: bytes 0-0/TOTAL). Solo para servidores que lo dejan leer (IONOS).
  async function tamanoPorSonda(url, signal) {
    try {
      const r = await leer(url, { credentials: 'include', headers: { Range: 'bytes=0-0' }, signal });
      const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
      if (r.body) r.body.cancel();
      return m ? +m[1] : null;
    } catch (e) { if (e && e.name === 'AbortError') throw e; return null; }
  }

  async function sizeOf(url, signal) {
    const r = await leer(url, { credentials: 'include', signal });
    const len = +r.headers.get('content-length') || null;
    if (r.body) r.body.cancel();
    return len;
  }

  async function extractDxfThumb(url, tamanoAprox, signal, sondear) {
    // La sección va al final del archivo: basta con pedir el tramo final (Range) y no bajar el DXF entero.
    // Si el adaptador conoce el tamaño aproximado (IONOS), NO se pide "los últimos N bytes" (bytes=-N): el OX de IONOS
    // no responde nunca cuando N es mayor que el archivo. Se pregunta el tamaño exacto con bytes=0-0 (content-range) y
    // se pide "desde X hasta el final" (bytes=X-), que sí funciona. Con Gmail se sigue usando bytes=-N.
    let conocido = null;
    if (tamanoAprox || sondear) conocido = (await tamanoPorSonda(url, signal)) || tamanoAprox || null;
    // con sondeo (IONOS) y tamaño desconocido se pide desde el principio, nunca "los últimos N bytes"
    const rango = (bytes) => conocido ? 'bytes=' + Math.max(0, conocido - bytes) + '-' : (sondear ? 'bytes=0-' : 'bytes=-' + bytes);
    const fetchTail = async bytes => {
      const resp = await leer(url, { credentials: 'include', headers: { Range: rango(bytes) }, signal });
      if (!resp.ok) throw new Error('El servidor respondió HTTP ' + resp.status);
      const len = +resp.headers.get('content-length') || 0;
      if (resp.status === 200 && len > MAX_DXF) { if (resp.body) resp.body.cancel(); return { big: true }; }
      const cr = /\/(\d+)\s*$/.exec(resp.headers.get('content-range') || ''); // tamaño total, si el servidor lo deja leer
      const text = new TextDecoder('latin1').decode(new Uint8Array(await resp.arrayBuffer()));
      return { text, partial: resp.status === 206, total: cr ? +cr[1] : null };
    };
    // el tamaño se pide en paralelo (Gmail) salvo que el adaptador ya lo conozca
    const [size0, first] = await Promise.all([conocido ? Promise.resolve(conocido) : sizeOf(url, signal), fetchTail(2 * 1024 * 1024)]);
    const size = first.total || size0;
    const res = (o) => Object.assign({ size, version: 'DXF' }, o);
    let r = first;
    if (r.big) return res({ none: 'Este DXF es demasiado grande para buscar su miniatura.' });
    let p = parseDxfThumbnail(r.text);
    // Si el tramo acaba en datos hexadecimales pero no contiene el inicio de la sección, se amplía una vez.
    if (p.missing && r.partial && /\n\s*310\s*\r?\n[0-9A-Fa-f]{20,}/.test(r.text.slice(-4000))) {
      r = await fetchTail(16 * 1024 * 1024);
      p = parseDxfThumbnail(r.text);
    }
    if (p.missing || p.empty) return res({ none: 'Este DXF no incluye miniatura incrustada.' });
    if (p.corrupt || p.truncated) return res({ none: 'La miniatura de este DXF está incompleta o dañada.' });
    return res({ kind: 'BMP', blob: new Blob([dibToBmp(p.dib)], { type: 'image/bmp' }) });
  }

  // ---------- Panel ----------
  function ensureStyle() {
    if (document.getElementById('cadpreview-style')) return;
    const s = document.createElement('style');
    s.id = 'cadpreview-style';
    s.textContent = `
      #${ID}{position:fixed;inset:0;z-index:2147483000;background:#1f1f1f;color:#e8eaed;display:flex;flex-direction:column;font:14px/1.4 "Google Sans",Roboto,Arial,sans-serif;outline:none}
      #${ID} .cpv-head{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #3c4043}
      #${ID} .cpv-title{font-size:18px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ID} .cpv-info{color:#9aa0a6;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ID} .cpv-btn{color:#8ab4f8;background:none;border:1px solid #5f6368;border-radius:18px;padding:6px 16px;cursor:pointer;text-decoration:none;font:inherit}
      #${ID} .cpv-btn:hover:not([disabled]){background:#303134}
      #${ID} .cpv-btn[disabled]{opacity:.5;cursor:default}
      #${ID} .cpv-primary{color:#202124;background:#8ab4f8;border-color:#8ab4f8}
      #${ID} .cpv-primary:hover:not([disabled]){background:#aecbfa}
      #${ID} .cpv-aviso{display:none;align-items:center;gap:12px;padding:10px 20px;background:#3c3a1f;color:#fde293;border-bottom:1px solid #5f5a2a}
      #${ID} .cpv-aviso .cpv-txt{flex:1}
      #${ID} .cpv-body{position:relative;flex:1;overflow:hidden}
      #${ID} .cpv-thumb{position:absolute;inset:0;z-index:2;background:#1f1f1f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;overflow:auto}
      #${ID} .cpv-thumb img{max-width:min(94vw,1600px);max-height:72vh;width:auto;height:auto;min-width:min(90vw,768px);object-fit:contain;border-radius:4px;box-shadow:0 2px 12px #0008}
      #${ID} .cpv-note{color:#9aa0a6;max-width:720px;text-align:center}
      #${ID} iframe{position:absolute;inset:0;z-index:1;width:100%;height:100%;border:0;background:#000}
    `;
    document.head.appendChild(s);
  }

  function removeOverlay() {
    const el = document.getElementById(ID);
    if (el) el.remove();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (msgHandler) { window.removeEventListener('message', msgHandler); msgHandler = null; }
    if (cspHandler) { document.removeEventListener('securitypolicyviolation', cspHandler, true); cspHandler = null; }
    if (teclasHandler) { window.removeEventListener('keydown', teclasHandler, true); window.removeEventListener('keyup', teclasHandler, true); window.removeEventListener('keypress', teclasHandler, true); teclasHandler = null; }
    alCerrarActual = null;
  }

  // Pulsar Cerrar o Esc: quita el panel y avisa al adaptador (p. ej. Gmail cierra también su visor)
  function cerrarDesdePanel() {
    const cb = alCerrarActual;
    seq++;
    removeOverlay();
    if (cb) { try { cb(); } catch (_) { /* nada */ } }
  }

  const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function abrir(op) {
    ensureStyle();
    removeOverlay();
    const mine = ++seq;
    const nombre = op.nombre || (op.adjunto && op.adjunto.name) || 'dibujo';
    alCerrarActual = op.alCerrar || null;
    const el = node('div'); el.id = ID;
    el.tabIndex = -1;
    // las teclas pulsadas dentro del panel tampoco deben subir hasta los atajos del correo (OX y Gmail escuchan en document)
    for (const tipo of ['keydown', 'keyup', 'keypress']) el.addEventListener(tipo, (ev) => { if (ev.key !== 'Escape') ev.stopPropagation(); });
    el.dataset.estado = 'localizando';
    el.dataset.origen = op.origen || 'mensaje';

    const head = node('div', 'cpv-head');
    const title = node('div', 'cpv-title', nombre);
    const info = node('div', 'cpv-info');
    const bRender = node('button', 'cpv-btn cpv-primary', 'Renderizar'); bRender.type = 'button'; bRender.disabled = true;
    bRender.title = 'Abre el dibujo completo (tarda más que la miniatura)';
    const bDl = node('a', 'cpv-btn', 'Descargar'); bDl.href = op.adjunto ? op.adjunto.url : '#'; bDl.download = nombre;
    const bClose = node('button', 'cpv-btn', 'Cerrar'); bClose.type = 'button';
    const bCancelRender = node('button', 'cpv-btn cpv-cancelar', 'Cancelar'); bCancelRender.type = 'button'; bCancelRender.style.display = 'none';
    bCancelRender.title = 'Detiene la carga y vuelve a la miniatura';
    const bInforme = node('button', 'cpv-btn', 'Copiar informe'); bInforme.type = 'button'; bInforme.style.display = 'none';
    bInforme.title = 'Copia un informe tecnico sin datos personales (sin nombres de archivo ni enlaces)';
    head.append(title, info, bRender, bCancelRender, bInforme, bDl, bClose);

    const aviso = node('div', 'cpv-aviso');
    const avisoTxt = node('div', 'cpv-txt');
    const bSeguir = node('button', 'cpv-btn', 'Renderizar igualmente'); bSeguir.type = 'button';
    const bNo = node('button', 'cpv-btn', 'Cancelar'); bNo.type = 'button';
    aviso.append(avisoTxt, bSeguir, bNo);

    const body = node('div', 'cpv-body');
    const thumb = node('div', 'cpv-thumb');
    const note = node('div', 'cpv-note', 'Localizando el adjunto…');
    thumb.append(note);
    body.append(thumb);
    el.append(head, aviso, body);

    const setInfo = t => { info.textContent = t; info.title = t; };
    const setEstado = s => { el.dataset.estado = s; bInforme.style.display = /^(error|sin-respuesta|bloqueado)/.test(s) ? '' : 'none'; };
    bInforme.addEventListener('click', () => copiarTexto(informe({ estado: el.dataset.estado, directiva_csp: (el.dataset.csp || '').split(' ')[0] || '-' }), bInforme, 'Copiar informe'));
    let adj = op.adjunto || null;
    let tamano = null;
    let rendering = false;
    let renderId = 0;
    let cancelarRender = null;

    bClose.addEventListener('click', cerrarDesdePanel);

    // Mientras el panel está abierto, las teclas no llegan al correo de debajo (Gmail y OX tienen atajos que
    // borran o archivan mensajes); solo se atiende Esc.
    teclasHandler = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cerrarDesdePanel(); return; }
      if (el.contains(e.target)) return;
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && e.key !== 'Tab') e.preventDefault();
    };
    window.addEventListener('keydown', teclasHandler, true);
    window.addEventListener('keyup', teclasHandler, true);
    window.addEventListener('keypress', teclasHandler, true);

    cspHandler = (e) => {
      el.dataset.csp = (e.violatedDirective || '') + ' ' + (e.blockedURI || '');
      setInfo('Bloqueado por la política de seguridad de la página: ' + e.violatedDirective);
      setEstado('bloqueado-csp');
    };
    document.addEventListener('securitypolicyviolation', cspHandler, true);

    // --- visor completo ---
    function renderizar() {
      if (rendering || !adj) return;
      rendering = true;
      const miId = ++renderId;
      const ac = new AbortController();
      aviso.style.display = 'none';
      bCancelRender.style.display = '';
      bRender.disabled = true;
      bRender.textContent = 'Renderizando…';
      setEstado('renderizando');
      // El iframe no puede estar oculto NI tapado: Chrome frena los iframes de otro origen que no se ven. Medido con
      // visibility:hidden el visor no termina nunca; con la miniatura encima tarda 38 s en vez de 7,7 s (DWG de 2,5 MB).
      const frame = document.createElement('iframe');
      body.append(frame);
      thumb.style.display = 'none'; // la miniatura se quita ya: tapado, el visor va hasta 5 veces más lento (ver arriba)
      const falla = (texto, estado) => {
        setInfo(texto); setEstado(estado);
        frame.remove(); rendering = false; thumb.style.display = ''; bCancelRender.style.display = 'none'; cancelarRender = null;
        bRender.disabled = false; bRender.textContent = 'Reintentar';
        if (msgHandler) { window.removeEventListener('message', msgHandler); msgHandler = null; }
      };
      cancelarRender = () => {
        if (!rendering || miId !== renderId) return;
        ac.abort();
        frame.remove(); rendering = false; thumb.style.display = ''; bCancelRender.style.display = 'none'; cancelarRender = null;
        if (msgHandler) { window.removeEventListener('message', msgHandler); msgHandler = null; }
        delete el.dataset.bytes;
        bRender.disabled = false; bRender.textContent = 'Renderizar';
        setInfo('Renderizado cancelado'); setEstado(el.dataset.antes || 'miniatura');
      };
      msgHandler = async (ev) => {
        if (ev.source !== frame.contentWindow || ev.origin !== VIEWER_ORIGIN) return;
        const m = ev.data || {};
        if (m.type === 'ready') {
          try {
            setInfo('Descargando el archivo…');
            const r = await leer(adj.url, { credentials: 'include', signal: ac.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const buf = await r.arrayBuffer();
            if (mine !== seq || ac.signal.aborted) return;
            el.dataset.bytes = String(buf.byteLength);
            setInfo('Enviando ' + mb(buf.byteLength) + ' al visor…');
            setEstado('enviado');
            frame.contentWindow.postMessage({ type: 'open-file', name: adj.name, buffer: buf }, VIEWER_ORIGIN, [buf]);
          } catch (e) { if (ac.signal.aborted) return; falla('No se pudo leer el adjunto: ' + e.message, 'error-lectura'); }
        } else if (m.type === 'status') {
          if (m.text) setInfo(m.text);
        } else if (m.type === 'opened') {
          el.dataset.ms = String(m.ms || '');
          if (m.ok) {
            thumb.style.display = 'none'; // destapa el visor
            setInfo('Listo (' + m.ms + ' ms de apertura)');
            bRender.textContent = 'Renderizado';
            bCancelRender.style.display = 'none'; cancelarRender = null;
            setEstado('abierto');
          } else falla('No se pudo abrir el archivo', 'error-apertura');
        }
      };
      window.addEventListener('message', msgHandler);
      frame.src = VIEWER_URL;
      setTimeout(() => {
        if (mine === seq && miId === renderId && rendering && el.isConnected && el.dataset.estado === 'renderizando') falla('El visor no respondió: puede estar bloqueado por la página.', 'sin-respuesta');
      }, 15000);
    }

    bRender.addEventListener('click', () => {
      if (tamano && tamano > AVISO_RENDER_BYTES) {
        avisoTxt.textContent = 'Este archivo pesa ' + mb(tamano) + '. Renderizarlo puede tardar más de un minuto y usar mucha memoria.';
        aviso.style.display = 'flex';
        setEstado('aviso-tamano');
      } else renderizar();
    });
    bSeguir.addEventListener('click', renderizar);
    bCancelRender.addEventListener('click', () => { if (cancelarRender) cancelarRender(); });
    bNo.addEventListener('click', () => { aviso.style.display = 'none'; setEstado(el.dataset.antes || 'miniatura'); });

    document.body.appendChild(el);
    try { el.focus({ preventScroll: true }); } catch (_) { /* nada */ }

    // --- localizar el adjunto y leer la miniatura ---
    (async () => {
      try {
        if (!adj) {
          setInfo('Localizando el adjunto...');
          adj = op.resolver ? await op.resolver() : null;
          if (mine !== seq) return;
          if (!adj) { note.textContent = 'No he podido localizar este adjunto. Ábrelo desde el correo.'; setEstado('error-localizar'); return; }
          bDl.href = adj.url;
        }
        setInfo('Leyendo la miniatura...');
        // un servidor que no contesta no debe dejar el panel colgado ni impedir "Renderizar"
        const ac = new AbortController();
        const reloj = setTimeout(() => ac.abort(), 25000);
        let t;
        try { t = /\.dxf$/i.test(adj.name) ? await extractDxfThumb(adj.url, op.tamanoAprox, ac.signal, op.sondearTamano) : await extractDwgThumb(adj.url, ac.signal, op.sondearTamano); }
        finally { clearTimeout(reloj); }
        if (mine !== seq) return;
        tamano = t.size || op.tamanoAprox || null;
        el.dataset.tamano = tamano ? String(tamano) : '';
        if (t.blob) {
          objectUrl = URL.createObjectURL(t.blob);
          const img = document.createElement('img');
          img.alt = 'Miniatura de ' + adj.name;
          img.addEventListener('load', () => {
            note.textContent = 'Miniatura incrustada en el archivo (' + img.naturalWidth + '×' + img.naturalHeight + ' px, ' + t.version + '). ' +
              'No es un render del dibujo: es la imagen que guardó el programa de CAD y puede estar desactualizada o mal encuadrada. Pulsa "Renderizar" para ver el dibujo completo.';
            el.dataset.miniatura = img.naturalWidth + 'x' + img.naturalHeight;
          });
          img.src = objectUrl;
          thumb.replaceChildren(img, note);
          note.textContent = 'Miniatura incrustada en el archivo (' + t.version + ').';
          setEstado('miniatura');
        } else {
          note.textContent = t.none + ' Pulsa "Renderizar" para ver el dibujo completo.';
          el.dataset.miniatura = 'ninguna';
          setEstado('sin-miniatura');
        }
        el.dataset.antes = el.dataset.estado;
        setInfo(tamano ? mb(tamano) : '');
        bRender.disabled = false;
      } catch (e) {
        // aunque falle la miniatura, se puede intentar el render completo
        note.textContent = 'No se pudo leer la miniatura: ' + (e && e.name === 'AbortError' ? 'el servidor no respondió a tiempo' : e.message) + '. Puedes probar "Renderizar".';
        setEstado('error-miniatura');
        el.dataset.antes = 'error-miniatura';
        bRender.disabled = !adj;
      }
    })();
  }

  // Lectura de la miniatura sin abrir el panel (la usa el mosaico de IONOS). Devuelve { size, version, kind, blob } o { none }
  function leerMiniatura(nombre, url, tamanoAprox, signal, sondear) {
    return /\.dxf$/i.test(nombre) ? extractDxfThumb(url, tamanoAprox, signal, sondear) : extractDwgThumb(url, signal, sondear);
  }

  // ---------- Miniaturas automáticas en las tarjetas / cuadros de adjuntos del propio correo ----------
  // Los adaptadores llaman a ponerMiniatura(contenedor, adjunto, opciones): se crea una capa con la miniatura encima del icono
  // genérico del contenedor, SOLO cuando el contenedor entra en pantalla, con 2 lecturas a la vez, tiempo máximo por archivo y
  // una caché por dirección de descarga (al volver al mensaje, o cuando el correo repinta las tarjetas, no se lee nada de nuevo).
  const LECTURAS_A_LA_VEZ = 2;
  const TIEMPO_MAXIMO_MS = 25000;
  const MAX_EN_CACHE = 120;
  const CLASE_CAPA = 'cadpreview-tile';
  const cacheMini = new Map();      // url → { estado: 'cargando' | 'listo' | 'sin' | 'error', blobUrl, promesa }
  const pendientes = new WeakMap(); // contenedor → { adj, tamanoAprox, sondear }
  const colaMini = [];
  let lecturasActivas = 0;
  function bombear() {
    while (lecturasActivas < LECTURAS_A_LA_VEZ && colaMini.length) {
      const tarea = colaMini.shift();
      lecturasActivas++;
      tarea().finally(() => { lecturasActivas--; bombear(); });
    }
  }
  function cargarMiniaturaEnCola(adj, tamanoAprox, sondear) {
    const previa = cacheMini.get(adj.url);
    if (previa) return previa;
    const entrada = { estado: 'cargando', blobUrl: null, promesa: null };
    entrada.promesa = new Promise((resolver) => {
      colaMini.push(async () => {
        const ac = new AbortController();
        const reloj = setTimeout(() => ac.abort(), TIEMPO_MAXIMO_MS);
        try {
          const t = await leerMiniatura(adj.name, adj.url, tamanoAprox, ac.signal, sondear);
          if (t.blob) { entrada.blobUrl = URL.createObjectURL(t.blob); entrada.estado = 'listo'; } else entrada.estado = 'sin';
        } catch (_) { entrada.estado = 'error'; } finally { clearTimeout(reloj); resolver(entrada); }
      });
      bombear();
    });
    cacheMini.set(adj.url, entrada);
    if (cacheMini.size > MAX_EN_CACHE) { // se olvida lo más antiguo
      const [clave, vieja] = cacheMini.entries().next().value;
      if (vieja.blobUrl) URL.revokeObjectURL(vieja.blobUrl);
      cacheMini.delete(clave);
    }
    return entrada;
  }
  function crearCapaMiniatura(contenedor, etiqueta, zIndex) {
    const capa = document.createElement('div');
    capa.className = CLASE_CAPA;
    // pointer-events none: los clics siguen su camino normal (abrir el visor del correo, controles propios...)
    capa.style.cssText = 'position:absolute;inset:0;z-index:' + (zIndex || 0) + ';display:none;pointer-events:none;border-radius:inherit;' +
      'background-color:#fff;background-position:center;background-size:contain;background-repeat:no-repeat';
    if (etiqueta) {
      const et = document.createElement('span');
      et.textContent = etiqueta;
      et.style.cssText = 'position:absolute;left:4px;bottom:4px;padding:0 5px;border-radius:3px;background:rgba(0,0,0,.65);color:#fff;font:600 10px/15px sans-serif';
      capa.append(et);
    }
    if (getComputedStyle(contenedor).position === 'static') contenedor.style.position = 'relative';
    contenedor.append(capa);
    return capa;
  }
  function pintarCapa(capa, entrada) {
    if (capa && entrada.estado === 'listo' && entrada.blobUrl) {
      capa.style.backgroundImage = 'url("' + entrada.blobUrl + '")';
      capa.style.display = 'block';
    }
  }
  const observadorMini = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      observadorMini.unobserve(e.target);
      const info = pendientes.get(e.target);
      if (!info) continue;
      pendientes.delete(e.target);
      const entrada = cargarMiniaturaEnCola(info.adj, info.tamanoAprox, info.sondear);
      entrada.promesa.then((res) => pintarCapa(e.target.querySelector(':scope > .' + CLASE_CAPA), res));
    }
  }, { rootMargin: '150px' });

  // opciones: { tamanoAprox, sondear, etiqueta, zIndex }. Se puede llamar muchas veces para el mismo contenedor.
  function ponerMiniatura(contenedor, adj, opciones) {
    const op = opciones || {};
    let capa = contenedor.querySelector(':scope > .' + CLASE_CAPA);
    if (!capa) capa = crearCapaMiniatura(contenedor, op.etiqueta, op.zIndex);
    const previa = cacheMini.get(adj.url);
    if (previa) { // ya leída o en curso: se pinta cuando esté, sin pedir nada
      if (previa.estado === 'listo') pintarCapa(capa, previa);
      else if (previa.estado === 'cargando') previa.promesa.then((res) => pintarCapa(contenedor.querySelector(':scope > .' + CLASE_CAPA), res));
      return;
    }
    if (!pendientes.has(contenedor)) {
      pendientes.set(contenedor, { adj, tamanoAprox: op.tamanoAprox || null, sondear: !!op.sondear });
      observadorMini.observe(contenedor);
    }
  }

  // ---------- Autodiagnostico: informe solo con ESTRUCTURA (sin nombres de archivo, URLs ni texto del correo) ----------
  let diagCfg = null;
  const versionExt = () => {
    try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) return chrome.runtime.getManifest().version; } catch (_) { /* nada */ }
    return document.documentElement.dataset.cadpreviewVersion || '?';
  };
  function informe(extra) {
    const cfg = diagCfg || { sitio: '?', selectores: {} };
    const m = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
    const l = ['CADPreview ' + versionExt() + ' (' + 'nucleo-5' + ')', 'sitio: ' + cfg.sitio, 'navegador: Chrome/' + (m ? m[1] : '?'), 'selectores:'];
    for (const k of Object.keys(cfg.selectores || {})) {
      let n; try { n = document.querySelectorAll(cfg.selectores[k]).length; } catch (_) { n = 'error'; }
      l.push('  ' + k + ' = ' + n);
    }
    for (const k of Object.keys(extra || {})) l.push(k + ': ' + extra[k]);
    return l.join('\n');
  }
  function copiarTexto(texto, boton, original) {
    const listo = () => { boton.textContent = 'Informe copiado'; setTimeout(() => { boton.textContent = original; }, 2500); };
    const respaldo = () => {
      try {
        const ta = document.createElement('textarea'); ta.value = texto; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
        if (ok) listo(); else boton.textContent = 'No se pudo copiar';
      } catch (_) { boton.textContent = 'No se pudo copiar'; }
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(listo, respaldo); return; } } catch (_) { /* respaldo */ }
    respaldo();
  }
  const ID_AVISO = 'cadpreview-aviso';
  function ocultarAviso() { const a = document.getElementById(ID_AVISO); if (a) a.remove(); }
  function mostrarAviso(alDescartar) {
    if (document.getElementById(ID_AVISO)) return;
    const a = node('div'); a.id = ID_AVISO;
    a.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;gap:10px;align-items:center;max-width:460px;padding:8px 12px;' +
      'background:#202124;color:#e8eaed;border:1px solid #5f6368;border-radius:8px;font:13px/18px Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    const t = node('span', null, 'CADPreview no reconoce este adjunto.');
    const b = node('button', null, 'Copiar informe'); b.type = 'button';
    b.style.cssText = 'color:#8ab4f8;background:none;border:1px solid #5f6368;border-radius:14px;padding:2px 10px;cursor:pointer;font:inherit;white-space:nowrap';
    b.addEventListener('click', () => copiarTexto(informe({ sospechosos: diagCfg ? contarSospechosos() : '?' }), b, 'Copiar informe'));
    const x = node('button', null, '\u00d7'); x.type = 'button'; x.title = 'Descartar'; x.setAttribute('aria-label', 'Descartar');
    x.style.cssText = 'color:#9aa0a6;background:none;border:0;cursor:pointer;font:16px/16px Arial,sans-serif;padding:0 2px';
    x.addEventListener('click', () => { a.remove(); if (alDescartar) alDescartar(); });
    a.append(t, b, x);
    document.body.appendChild(a);
  }
  function contarSospechosos() { try { return (diagCfg && diagCfg.sospechosos()) | 0; } catch (_) { return 0; } }
  // El adaptador dice como contar los elementos que PARECEN un adjunto CAD y no se han reconocido. El aviso sale si siguen ahi en dos
  // comprobaciones seguidas (2 s), para no avisar durante los repintados normales de la pagina.
  function vigilar(cfg) {
    diagCfg = cfg;
    let previo = 0, descartado = false;
    setInterval(() => {
      if (descartado || document.hidden) return;
      const n = contarSospechosos();
      if (n > 0 && previo > 0) mostrarAviso(() => { descartado = true; });
      else if (n === 0) ocultarAviso();
      previo = n;
    }, 2000);
  }

  window.CADPreview = {
    abrir,
    vigilar,
    miniatura: leerMiniatura,
    ponerMiniatura,
    cerrar() { seq++; removeOverlay(); },
    registrarLector(l) { lectorPropio = l; },
    esCad: (nombre) => CAD_RE.test(nombre || ''),
    version: 'nucleo-5'
  };
})();
