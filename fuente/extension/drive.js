// CADPreview (v1.1.4): adaptador de Google Drive (drive.google.com). Corre en el MUNDO AISLADO de la extensión (no en el de la
// página, a diferencia de gmail.js y ox.js) porque necesita chrome.runtime para hablar con el service worker (background.js).
//
// Qué hace:
//  - DOBLE CLIC / INTRO: Drive no sabe mostrar DWG/DXF (su visor, un iframe, dice "No hay ninguna vista previa disponible"). Sobre un
//    .dwg/.dxf se cortan los eventos que abren ese visor y sale el panel de CADPreview (miniatura, Renderizar, Descargar). Lo mismo
//    con una dirección /file/d/ID/view (enlaces compartidos, "abrir en otra pestaña").
//  - PANEL "DETALLES": miniatura en lugar del icono gris y botón "Ver dibujo completo".
//  - LECTURA DEL ARCHIVO: el servidor de descargas de Drive (drive.usercontent.google.com) no envía cabeceras CORS, así que un
//    fetch desde la página no puede leerlo (medido en el Drive real). Este adaptador registra en el núcleo un "lector propio":
//    emula fetch + Range pidiendo trozos de 2 MB al service worker, que sí puede leer Drive con la sesión del navegador.
//    El núcleo (core.js) no se entera: sigue pidiendo "bytes=0-0", "bytes=X-", etc. y recibe un Response normal.
// Lo que se vio en el Drive real (12 y 14/11/2026): lista = <tr data-id="ID" role="row"> con el nombre en <strong> y en data-tooltip
// ("nombre.dwg Imagen"); cuadrícula = <div role="gridcell" data-id="ID"> con aria-label "nombre.dwg Imagen Cargando..." y un hijo con
// data-tooltip; el visor de Drive es un iframe a drive.google.com/viewer/main (sin el id del archivo en la dirección, la dirección de
// la página no cambia, y un Escape sintético no lo cierra). Drive no restringe frames ni estilos en su política de seguridad.
(() => {
  'use strict';
  if (location.hostname !== 'drive.google.com') return;
  if (window.__cadpreviewDrive) return;
  window.__cadpreviewDrive = true;
  const CP = window.CADPreview;
  if (!CP) { console.warn('[CADPreview] (drive) El núcleo no está cargado.'); return; }

  const CLASE_BOTON = 'cadpreview-btn';
  const TROZO = 2 * 1024 * 1024;   // el service worker admite hasta 3 MB por mensaje
  const PRIMER_TROZO = 256 * 1024;
  const capturas = new WeakMap();   // elemento .cadpreview-det-click → función que abre el panel

  // ---------- Dirección de descarga y cuenta ----------
  const cuenta = () => { const m = /^\/(?:drive\/|file\/)?u\/(\d+)\//.exec(location.pathname); return m ? m[1] : '0'; };
  const urlDescarga = (id) => 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=download&authuser=' + cuenta();

  // ---------- Lector propio: fetch + Range sobre el service worker ----------
  function pedirTrozo(url, desde, hasta) {
    return new Promise((ok, mal) => {
      try {
        chrome.runtime.sendMessage({ cadpreview: 'leer', url, desde, hasta }, (r) => {
          const e = chrome.runtime.lastError;
          if (e) mal(new Error(e.message));
          else if (!r) mal(new Error('El service worker no respondió'));
          else if (r.error) mal(new Error(r.error));
          else ok(r);
        });
      } catch (e) { mal(e); }
    });
  }
  function aBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const abortado = () => new DOMException('Aborted', 'AbortError');

  // Devuelve un Response como el de fetch: 200 sin Range, 206 con Range (bytes=a-b, a-, -n), cuerpo en streaming por trozos.
  async function fetchDrive(url, init) {
    const signal = init && init.signal;
    if (signal && signal.aborted) throw abortado();
    const h = (init && init.headers) || {};
    const rango = h.Range || h.range || null;
    let desde = 0, hasta = null;
    if (rango) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rango);
      if (!m || (m[1] === '' && m[2] === '')) throw new Error('Rango no admitido');
      if (m[1] === '') { // "los últimos N bytes": hace falta el tamaño
        const sonda = await pedirTrozo(url, 0, 0);
        if (signal && signal.aborted) throw abortado();
        if (!sonda.total) throw new Error('Drive no da el tamaño del archivo');
        desde = Math.max(0, sonda.total - Number(m[2]));
        hasta = sonda.total - 1;
      } else { desde = Number(m[1]); hasta = m[2] === '' ? null : Number(m[2]); }
    }
    const tope = (d, n) => (hasta == null ? d + n - 1 : Math.min(hasta, d + n - 1));
    // sin Range el núcleo lee la cabecera de un DWG (cientos de KB) y corta: el primer trozo es pequeño; con Range o al
    // leer el archivo entero para Renderizar, trozos de 2 MB
    const primer = await pedirTrozo(url, desde, tope(desde, rango ? TROZO : PRIMER_TROZO));
    if (signal && signal.aborted) throw abortado();
    const total = primer.total || null;
    if (primer.status === 416 || (primer.n === 0 && desde > 0)) {
      return new Response(null, { status: 416, headers: total ? { 'content-range': 'bytes */' + total } : {} });
    }
    const ultimo = hasta == null ? (total ? total - 1 : Infinity) : (total ? Math.min(hasta, total - 1) : hasta);
    const cab = {};
    if (rango) {
      const fin = Number.isFinite(ultimo) ? ultimo : desde + primer.n - 1;
      if (Number.isFinite(ultimo)) cab['content-length'] = String(ultimo - desde + 1);
      cab['content-range'] = 'bytes ' + desde + '-' + fin + '/' + (total || '*');
    } else if (total) cab['content-length'] = String(total);

    let pendiente = primer, siguiente = desde + primer.n, cancelado = false;
    const cuerpo = new ReadableStream({
      async pull(c) {
        try {
          if (cancelado) return;
          let t = pendiente; pendiente = null;
          if (!t) {
            if (signal && signal.aborted) { c.error(abortado()); return; }
            if (siguiente > ultimo) { c.close(); return; }
            t = await pedirTrozo(url, siguiente, tope(siguiente, TROZO));
            if (cancelado) return;
            if (signal && signal.aborted) { c.error(abortado()); return; }
            if (!t.n) { c.close(); return; }
            siguiente += t.n;
          }
          c.enqueue(aBytes(t.b64));
          if (siguiente > ultimo) c.close();
        } catch (e) { c.error(e); }
      },
      cancel() { cancelado = true; }
    }, { highWaterMark: 0 });   // solo se pide el trozo siguiente cuando el núcleo lo lee: si corta, no se baja el resto
    return new Response(cuerpo, { status: rango ? 206 : 200, headers: cab });
  }
  CP.registrarLector({ acepta: (url) => /^https:\/\/drive\.usercontent\.google\.com\/download\?/.test(url), fetch: fetchDrive });

  // ---------- Nombres e ids ----------
  // Nombre del archivo CAD de una fila o tarjeta ("nombre.dwg"), o null si no es .dwg/.dxf. Fila: <strong>; tarjeta: aria-label de la
  // propia tarjeta ("nombre.dwg Imagen Cargando...") o data-tooltip de un hijo ("nombre.dwg Imagen"). Voraz a propósito: un nombre
  // como "plano.dwg v2.dwg" no debe cortarse en el primer ".dwg".
  const NOMBRE_EN_TEXTO = /^(.+\.(?:dwg|dxf))(?:\s\S+)?(?:\s|$)/i;
  function nombreDe(el) {
    const s = el.querySelector('strong');
    const t = s && s.textContent.trim();
    if (t && CP.esCad(t)) return t;
    const textos = [el.getAttribute('aria-label') || ''];
    for (const c of el.querySelectorAll('[data-tooltip], [aria-label]')) textos.push(c.getAttribute('data-tooltip') || c.getAttribute('aria-label') || '');
    for (const txt of textos) { const m = NOMBRE_EN_TEXTO.exec(txt); if (m) return m[1]; }
    return null;
  }

  // id del archivo del panel "Detalles": la dirección /file/d/ID/..., o el elemento seleccionado de ese nombre
  function idDelVisor(nombre) {
    const m = /\/file\/d\/([\w-]+)/.exec(location.pathname);
    if (m) return m[1];
    const sel = [...document.querySelectorAll('[data-id][aria-selected="true"]')].find((e) => nombreDe(e) === nombre);
    if (sel) return sel.getAttribute('data-id');
    const todos = [...document.querySelectorAll('tr[data-id]')].filter((e) => nombreDe(e) === nombre);
    return todos.length === 1 ? todos[0].getAttribute('data-id') : null;
  }

  // ---------- Vista de lista: botón "Vista previa CAD" ----------
  function abrirPanelFila(tr) {
    // se lee la fila en el momento del clic: Drive reutiliza las filas al desplazar la lista
    const id = tr.getAttribute('data-id');
    const nombre = nombreDe(tr);
    if (!id || !nombre) return;
    CP.abrir({ nombre, adjunto: { name: nombre, url: urlDescarga(id) }, sondearTamano: true, origen: 'drive-lista' });
  }

  function crearBoton(tr) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = CLASE_BOTON;
    b.textContent = 'Vista previa CAD';
    // sin atributo title: la tooltip del navegador compite con la de Drive
    b.style.cssText = 'display:inline-block;flex:none;align-self:center;margin-left:10px;padding:1px 9px;border:1px solid currentColor;border-radius:11px;' +
      'background:transparent;color:#8ab4f8;font:500 12px/18px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap;vertical-align:middle';
    // Drive tiene manejadores de selección, doble clic y arrastre en la fila: que no vean este botón
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'dragstart']) b.addEventListener(ev, (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.preventDefault(); abrirPanelFila(tr); });
    return b;
  }

  // Los botones en la lista parpadeaban en el Drive real (1.1 y 1.1.1) y no hacen falta: la miniatura sale en "Detalles" y el visor
  // de Drive (doble clic) abre el panel con Renderizar. Quedan apagados; solo las pruebas automáticas los encienden.
  const botonesEnFilas = () => document.documentElement.dataset.cadpreviewBotonFilas === '1';
  function decorarFilas() {
    if (!botonesEnFilas()) return;
    for (const tr of document.querySelectorAll('tr[data-id][role="row"]')) {
      const nombre = nombreDe(tr);
      const actual = tr.querySelector('.' + CLASE_BOTON);
      if (!nombre) { if (actual) actual.remove(); continue; }   // la fila se reutilizó para otro archivo
      if (actual) continue;
      const fuerte = tr.querySelector('strong');
      // Drive (12/11/2026): el nombre va en div.rxUYqf > div.JxSEve (con tooltip, arrastre y overflow:hidden); el botón dentro de
      // ese bloque parpadeaba al pasar el ratón. Va fuera, como hermano de div.rxUYqf en la fila flex del nombre.
      const bloque = fuerte && fuerte.closest('.rxUYqf');
      const ancla = bloque || (fuerte ? (fuerte.closest('[data-tooltip]') || fuerte.parentElement) : null);
      const boton = crearBoton(tr);
      if (ancla && ancla.parentElement) ancla.after(boton); else (tr.querySelector('td') || tr).append(boton);
    }
  }

  // ---------- Panel "Detalles" de Drive: miniatura en lugar del icono gris ----------
  // Drive (12/11/2026): div[role=complementary][aria-label="Panel de detalles"], título en h2 .a-Mg-V-T, y la vista previa es un
  // iframe de otro origen (no se puede tocar): se pone encima una capa con la miniatura, sin capturar el ratón.
  const PANEL_DETALLES = '[role="complementary"][aria-label="Panel de detalles"]';
  let detallesId = null;
  function decorarDetalles() {
    const panel = document.querySelector(PANEL_DETALLES);
    if (!panel) { detallesId = null; return; }
    const iframe = panel.querySelector('iframe');
    const cont = iframe && iframe.parentElement;
    if (!cont) return;
    const titulo = panel.querySelector('h2');
    const nombre = titulo && titulo.textContent.trim();
    const capaAnterior = cont.querySelector(':scope > .cadpreview-tile');
    const botonAnterior = cont.querySelector(':scope > .cadpreview-det-btn');
    const capturaAnterior = cont.querySelector(':scope > .cadpreview-det-click');
    const limpiar = () => { if (capaAnterior) capaAnterior.remove(); if (botonAnterior) botonAnterior.remove(); if (capturaAnterior) capturaAnterior.remove(); };
    if (!nombre || !CP.esCad(nombre)) { limpiar(); detallesId = null; return; }
    const id = idDelVisor(nombre);
    if (!id) return;
    if (capaAnterior && botonAnterior && capturaAnterior && detallesId === id) return;
    limpiar();
    detallesId = id;
    CP.ponerMiniatura(cont, { name: nombre, url: urlDescarga(id) }, { sondear: true, zIndex: 2 });
    // Todo el recuadro de la vista previa es nuestro: un clic abre el panel de CADPreview (antes llegaba al iframe de Drive, que abría su
    // visor "No hay ninguna vista previa disponible"). Los eventos se cortan en captura sobre window (capturarMiniatura).
    const area = document.createElement('div');
    area.className = 'cadpreview-det-click';
    area.style.cssText = 'position:absolute;inset:0;z-index:2;cursor:pointer;background:transparent';
    capturas.set(area, () => CP.abrir({ nombre, adjunto: { name: nombre, url: urlDescarga(id) }, sondearTamano: true, origen: 'drive-detalles-miniatura' }));
    cont.append(area);
    // Botón "Renderizar" sobre la miniatura: el visor de Drive para un DWG/DXF vive en un iframe y no se puede detectar desde la
    // página, y el botón en las filas parpadeaba; la miniatura de Detalles es nuestra y Drive no la toca.
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cadpreview-det-btn';
    b.textContent = 'Ver dibujo completo';
    b.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:3;padding:4px 12px;border:1px solid #8ab4f8;border-radius:14px;background:#202124;color:#8ab4f8;' +
      'font:500 12px/18px "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap';
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup']) b.addEventListener(ev, (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      CP.abrir({ nombre, adjunto: { name: nombre, url: urlDescarga(id) }, sondearTamano: true, origen: 'drive-detalles' });
    });
    cont.append(b);
  }

  // ---------- Doble clic e Intro: el panel de CADPreview en lugar del visor de Drive ----------
  // Medido en el Drive real (14/11/2026, vistas de lista y de cuadrícula): el visor de Drive para un DWG/DXF se abre con el SEGUNDO
  // clic de un doble clic (mousedown, mouseup y click con detail=2, antes del evento dblclick: cortar solo dblclick no basta) o con
  // Intro sobre la fila enfocada. Un oyente en captura sobre window que corta esos eventos sobre los .dwg/.dxf impide que Drive abra su
  // visor (aunque se registre tarde: Drive escucha más abajo en el árbol), y en su lugar sale el panel de CADPreview. La barra
  // espaciadora y el menú contextual no abren el visor de Drive para estos archivos. Los demás tipos de archivo no se tocan.
  const ITEM = 'tr[data-id], [role="gridcell"][data-id]';   // fila (lista) o tarjeta (cuadrícula)
  const CONTROL = 'button, [role="button"], [role="checkbox"], a[href], input, [aria-haspopup]';

  // La fila o tarjeta CAD sobre la que cae el evento, o null (otro tipo de archivo, o un botón de la propia fila)
  function itemCad(destino) {
    if (!(destino instanceof Element)) return null;
    const item = destino.closest(ITEM);
    if (!item) return null;
    const control = destino.closest(CONTROL);
    if (control && control !== item && item.contains(control)) return null;   // compartir, descargar, más acciones, casilla...
    const id = item.getAttribute('data-id');
    const nombre = nombreDe(item);
    return id && nombre ? { id, nombre } : null;
  }
  function abrirPanelItem(it, origen) {
    CP.abrir({ nombre: it.nombre, adjunto: { name: it.nombre, url: urlDescarga(it.id) }, sondearTamano: true, origen });
  }
  function interceptar(e) {
    let origen = null;
    if (e.type === 'keydown') {
      if (e.key !== 'Enter' || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.isComposing) return;
      // con varios archivos seleccionados Intro abre otra cosa: se deja a Drive
      if (document.querySelectorAll('[data-id][aria-selected="true"]').length > 1) return;
      if (!e.repeat) origen = 'drive-intro';
    } else if (e.type === 'dblclick') origen = 'drive-doble-clic';
    else if (!(e.detail >= 2)) return;   // mousedown, mouseup y click: solo el segundo
    const it = itemCad(e.target);
    if (!it) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (origen) abrirPanelItem(it, origen);
  }
  for (const tipo of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown']) window.addEventListener(tipo, interceptar, true);

  // Recuadro de la miniatura del panel "Detalles": los eventos de ratón no pasan a Drive; el clic abre el panel de CADPreview
  function capturarMiniatura(e) {
    const area = e.target instanceof Element && e.target.closest('.cadpreview-det-click');
    if (!area) return;
    e.stopImmediatePropagation();
    if (e.type === 'click') { e.preventDefault(); const abrir = capturas.get(area); if (abrir) abrir(); }
  }
  for (const tipo of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) window.addEventListener(tipo, capturarMiniatura, true);

  // Enlace directo (/file/d/ID/view, también /file/u/N/d/ID/view): la página es el visor de Drive; el nombre está en el título de la
  // pestaña ("nombre.dwg - Google Drive"). Se abre el panel una vez por archivo.
  let enlaceAbierto = null;
  function detectarEnlace() {
    const m = /\/file\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(location.pathname);
    if (!m) { enlaceAbierto = null; return; }
    if (m[1] === enlaceAbierto) return;
    const nombre = document.title.replace(/\s[-–—]\s(?:Google\s)?Drive\s*$/i, '').trim();
    if (!CP.esCad(nombre)) return;   // el título aún no está o no es CAD
    enlaceAbierto = m[1];
    CP.abrir({ nombre, adjunto: { name: nombre, url: urlDescarga(m[1]) }, sondearTamano: true, origen: 'drive-enlace' });
  }

  // Drive repinta la lista al desplazar, ordenar o cambiar de carpeta: se vigila el DOM
  let pendiente = null;
  const programar = () => { if (pendiente) return; pendiente = setTimeout(() => { pendiente = null; try { decorarFilas(); decorarDetalles(); detectarEnlace(); } catch (e) { console.warn('[CADPreview]', e); } }, 150); };
  new MutationObserver(programar).observe(document.documentElement, { childList: true, subtree: true });
  programar();

  // Autodiagnostico: filas/tarjetas o panel de Detalles que mencionan un .dwg/.dxf y no se han reconocido
  CP.vigilar({
    sitio: 'drive',
    selectores: {
      'tr[data-id]': 'tr[data-id]',
      '[role=gridcell][data-id]': '[role="gridcell"][data-id]',
      'strong en filas': 'tr[data-id] strong',
      'panel Detalles': PANEL_DETALLES,
      'iframe en Detalles': PANEL_DETALLES + ' iframe'
    },
    sospechosos: () => {
      let n = 0;
      for (const it of document.querySelectorAll(ITEM)) {
        const txt = (it.textContent || '') + ' ' + (it.getAttribute('aria-label') || '');
        if (/\.(dwg|dxf)(?!\.)/i.test(txt) && !nombreDe(it)) n++;
      }
      const panel = document.querySelector(PANEL_DETALLES);
      if (panel && panel.querySelector('iframe')) {
        const h = panel.querySelector('h2');
        if (h && CP.esCad(h.textContent.trim()) && !panel.querySelector('.cadpreview-det-click')) n++;
      }
      return n;
    }
  });
})();
