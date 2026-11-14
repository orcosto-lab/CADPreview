// CADPreview: adaptador de Gmail. Detecta cuándo Gmail abre su visor de un adjunto (por el hash de la dirección) y abre
// el panel del núcleo (core.js). Corre en el MUNDO DE LA PÁGINA: desde la lista de mensajes necesita window.GLOBALS[9]
// (la clave de sesión de Gmail).
(() => {
  'use strict';
  if (location.pathname.startsWith('/appsuite')) return;   // eso es OX App Suite (ox.js)
  if (window.__cadpreviewGmail) return;
  window.__cadpreviewGmail = true;
  const CP = window.CADPreview;
  if (!CP) { console.warn('[CADPreview] El núcleo no está cargado.'); return; }

  const CAD_RE = /\.(dwg|dxf)$/i;
  // Ruta de la cuenta de Gmail abierta (/mail/u/0/, /mail/u/1/...)
  const BASE = location.origin + ((/^\/mail\/u\/\d+\//.exec(location.pathname) || ['/mail/u/0/'])[0]);
  let handled = null;
  let lastClicked = null; // adjunto pulsado en la vista de mensaje
  let lastChip = null;    // adjunto pulsado en una lista (bandeja o búsqueda)

  // <<nombres
  // Gmail envía los nombres con tildes o ñ como palabras codificadas RFC 2047: =?UTF-8?B?...?= (o ?Q?).
  function decodeMimeWords(s) {
    return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (m, cs, enc, txt) => {
      try {
        let bytes;
        if (enc.toUpperCase() === 'B') {
          bytes = Uint8Array.from(atob(txt), c => c.charCodeAt(0));
        } else {
          const t = txt.replace(/_/g, ' ');
          const arr = [];
          for (let i = 0; i < t.length; i++) {
            if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { arr.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
            else arr.push(t.charCodeAt(i));
          }
          bytes = Uint8Array.from(arr);
        }
        return new TextDecoder(cs).decode(bytes);
      } catch (_) { return m; }
    });
  }

  function dispositionName(cd) {
    if (!cd) return null;
    let m = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { /* sigue */ } }
    m = /filename\s*=\s*"([^"]*)"/.exec(cd) || /filename\s*=\s*([^;]+)/.exec(cd);
    return m ? decodeMimeWords(m[1].trim()) : null;
  }

  const norm = s => s.normalize('NFC').toLowerCase();
  const sameName = (a, b) => !!a && !!b && norm(a) === norm(b);
  // nombres>>

  // ---------- Localizar el adjunto ----------
  function parseAttachment(span) {
    const v = span.getAttribute('download_url') || '';
    const i1 = v.indexOf(':'), i2 = v.indexOf(':', i1 + 1);
    const i3 = Math.max(v.lastIndexOf('https://'), v.lastIndexOf('http://'));
    if (i1 < 0 || i2 < 0 || i3 < 0) return null;
    let name = v.slice(i1 + 1, i2);
    try { name = decodeURIComponent(name); } catch (_) { /* tal cual */ }
    const url = v.slice(i3);
    let attid = null;
    try { attid = new URL(url).searchParams.get('attid'); } catch (_) { /* nada */ }
    return { name, url, attid };
  }

  function findAttachment(partId) {
    const all = [...document.querySelectorAll('span.aZo[download_url]')].map(parseAttachment).filter(Boolean);
    if (lastClicked && lastClicked.attid === partId) return lastClicked;
    const same = all.filter(a => a.attid === partId);
    if (same.length === 1) return same[0];
    const cads = all.filter(a => CAD_RE.test(a.name));
    return cads.length === 1 ? cads[0] : null;
  }

  // Desde la lista la URL del visor no dice qué adjunto es: se localiza en la vista de impresión del hilo
  // y se confirma comparando el nombre del archivo con el de la cabecera Content-Disposition.
  async function resolveFromList(chip) {
    const ik = window.GLOBALS && window.GLOBALS[9];
    if (!ik) throw new Error('no se pudo obtener la clave de sesión de Gmail');
    const resp = await fetch(BASE + '?ui=2&ik=' + encodeURIComponent(ik) + '&view=pt&search=all&th=' + encodeURIComponent(chip.threadId), { credentials: 'include' });
    if (!resp.ok) throw new Error('Gmail respondió HTTP ' + resp.status);
    const html = await resp.text(); // sin DOMParser: Gmail exige Trusted Types
    const seen = new Set();
    const urls = [];
    for (const m of html.matchAll(/href="([^"]*view=att[^"]*)"/g)) {
      const q = new URL(m[1].replace(/&amp;/g, '&'), BASE).searchParams;
      q.set('ui', '2'); q.set('ik', ik);
      const u = BASE + '?' + q.toString();
      if (!seen.has(u)) { seen.add(u); urls.push(u); }
    }
    for (const url of urls.slice(0, 20)) {
      const r = await fetch(url, { credentials: 'include' });
      const name = dispositionName(r.headers.get('content-disposition'));
      if (r.body) r.body.cancel();
      if (r.ok && sameName(name, chip.title)) return { name: chip.title, url, attid: null };
    }
    return null;
  }

  // ---------- Detección del visor de Gmail ----------
  // Cerrar el panel (botón o Esc) cierra también el visor de Gmail: se quita projector=1 de la dirección.
  const alCerrar = () => { location.hash = location.hash.replace(/\?projector=1.*$/, ''); };

  function check(retries = 0) {
    const h = location.hash;
    if (!/projector=1/.test(h)) { CP.cerrar(); handled = null; return; }
    const m = /messagePartId=([\d.]+)/.exec(h);
    if (m) { // visor abierto desde el mensaje
      if (handled === h) return;
      const att = findAttachment(m[1]);
      if (!att) { if (retries < 10) setTimeout(() => check(retries + 1), 500); return; }
      handled = h;
      if (CAD_RE.test(att.name)) CP.abrir({ nombre: att.name, adjunto: att, origen: 'mensaje', alCerrar }); else CP.cerrar();
      return;
    }
    // visor abierto desde la lista: la URL no incluye el adjunto, se usa el último chip pulsado
    if (!lastChip) return;
    const key = h + '|' + lastChip.title;
    if (handled === key) return;
    handled = key;
    const chip = lastChip;
    if (CAD_RE.test(chip.title)) CP.abrir({ nombre: chip.title, resolver: () => resolveFromList(chip), origen: 'lista', alCerrar }); else CP.cerrar();
  }

  document.addEventListener('click', e => {
    const card = e.target instanceof Element ? e.target.closest('.aQH') : null;
    const span = card && card.querySelector('span.aZo[download_url]');
    if (span) lastClicked = parseAttachment(span);
    const chip = e.target instanceof Element ? e.target.closest('tr.zA .brc[title]') : null;
    if (chip) {
      const el = chip.closest('tr.zA').querySelector('[data-legacy-thread-id]');
      lastChip = el ? { title: chip.getAttribute('title'), threadId: el.getAttribute('data-legacy-thread-id') } : null;
    }
  }, true);
  // ---------- Miniaturas automáticas en las tarjetas de adjuntos del mensaje ----------
  // Cada adjunto es un span.aZo[download_url] (180x120) con la zona de vista previa en .aYv (donde Gmail pone el icono
  // genérico de archivo). La miniatura incrustada se carga sola y se pinta ahí, como hace Gmail con los PDF y las imágenes.
  // El clic en la tarjeta sigue siendo el de Gmail (abre su visor, y de ahí sale el panel).
  function decorarTarjetas() {
    for (const span of document.querySelectorAll('.aQH span.aZo[download_url]')) {
      const adj = parseAttachment(span);
      if (!adj || !CAD_RE.test(adj.name)) continue;
      const previa = span.querySelector('.aYv');
      if (previa) CP.ponerMiniatura(previa, adj, { etiqueta: (adj.name.split('.').pop() || '').toUpperCase(), zIndex: 1 });
    }
  }
  // Gmail repinta mucho el DOM: se vigila con un retardo para no trabajar en cada cambio
  let pendiente = null;
  const programar = () => { if (pendiente) return; pendiente = setTimeout(() => { pendiente = null; try { decorarTarjetas(); } catch (e) { console.warn('[CADPreview]', e); } }, 250); };
  new MutationObserver(programar).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('hashchange', () => check());
  check();
  decorarTarjetas();

  // Autodiagnostico: tarjetas de adjunto que mencionan un .dwg/.dxf y que no se han podido interpretar
  CP.vigilar({
    sitio: 'gmail',
    selectores: {
      'tarjeta .aQH': '.aQH',
      'span.aZo[download_url]': 'span.aZo[download_url]',
      'tarjeta con span.aZo': '.aQH span.aZo[download_url]',
      'zona de vista previa .aYv': '.aQH .aYv'
    },
    sospechosos: () => {
      let n = 0;
      for (const card of document.querySelectorAll('.aQH')) {
        const sp = card.querySelector('span.aZo[download_url]');
        if (sp) { if (!parseAttachment(sp) && /\.(dwg|dxf)/i.test(sp.getAttribute('download_url') || '')) n++; }
        else if (/\.(dwg|dxf)(?!\.)/i.test(card.textContent || '')) n++;
      }
      return n;
    }
  });
})();
