// CADPreview: adaptador de OX App Suite (IONOS en email.ionos.*/appsuite/ y otros proveedores que usan OX: ver la lista en
// generar-manifest.cjs; con --ox-generico, cualquier dirección con /appsuite/). OX no tiene visor para DWG ni DXF
// (el menú de cada adjunto solo ofrece "Descargar"), así que este adaptador añade dos formas de abrir el panel del núcleo:
//  - VISTA DE LISTA: un botón pequeño "Vista previa CAD" junto al tamaño de cada adjunto .dwg/.dxf.
//  - VISTA EN MOSAICO (la de "vista previa" de OX): la miniatura incrustada en el archivo se carga sola y se pinta en el
//    cuadro, como hace OX con los PDF; un clic sobre el cuadro abre el panel.
// La dirección de la página no cambia al abrir un mensaje, por eso se vigila el DOM. Cada adjunto es un
// <li class="attachment"> con el nombre en `title`, el tamaño en `.filesize` (oculto en el mosaico, pero con su texto) y la
// dirección de descarga (con la sesión incluida) en `data-downloadurl="tipo:nombre:https://..."`, igual que el
// download_url de Gmail. En el mosaico, el cuadro gris con la extensión es `.fallback`. El adjunto se lee con fetch y la
// sesión del navegador.
(() => {
  'use strict';
  if (!location.pathname.startsWith('/appsuite')) return;   // solo OX App Suite
  if (window.__cadpreviewIonos) return;
  window.__cadpreviewIonos = true;
  const CP = window.CADPreview;
  if (!CP) { console.warn('[CADPreview] El núcleo no está cargado.'); return; }

  const CLASE_BOTON = 'cadpreview-btn';
  const UNIDADES = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824 };

  // "2,5 MB", "187,3 kB", "1.234,5 kB", "512 B" → bytes (aproximados: la pantalla redondea)
  function parseTamano(txt) {
    const m = /([\d.,]+)\s*([kKmMgG]?[bB])\b/.exec(txt || '');
    if (!m) return null;
    let n = m[1];
    n = n.includes(',') ? n.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(n) ? n.replace(/\./g, '') : n);
    const v = parseFloat(n);
    return Number.isFinite(v) ? Math.round(v * (UNIDADES[m[2].toLowerCase()] || 1)) : null;
  }

  function leerAdjunto(li) {
    const dd = li.getAttribute('data-downloadurl') || '';
    const i = dd.search(/:https?:\/\//);
    if (i < 0) return null;
    const nombre = li.getAttribute('title') || dd.slice(dd.indexOf(':') + 1, i);
    return { name: nombre, url: dd.slice(i + 1) };
  }

  const tamanoDe = (li) => { const fs = li.querySelector('.filesize'); return parseTamano(fs && fs.textContent); };

  function abrirPanel(li) {
    const adj = leerAdjunto(li);
    if (!adj) return;
    CP.abrir({ nombre: adj.name, adjunto: adj, tamanoAprox: tamanoDe(li), sondearTamano: true, origen: 'ionos' });
  }

  // ---------- Vista de lista: botón "Vista previa CAD" ----------
  function crearBoton(li) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = CLASE_BOTON;
    b.textContent = 'Vista previa CAD';
    b.title = 'Abrir la vista previa del dibujo (CADPreview)';
    b.style.cssText = 'flex:none;margin-left:8px;padding:1px 9px;border:1px solid currentColor;border-radius:11px;background:transparent;' +
      'color:#0a66c2;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap';
    // OX tiene manejadores de selección y arrastre en el <li>: que no vean este botón
    for (const ev of ['mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup', 'dragstart']) b.addEventListener(ev, e => e.stopPropagation());
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrirPanel(li); });
    return b;
  }

  // ---------- Vista en mosaico: miniatura automática (la lectura, la cola y la caché están en el núcleo) ----------
  // ¿Es un mosaico? El cuadro gris con la extensión (.fallback) solo tiene tamaño en esa vista.
  function esMosaico(li) {
    const fb = li.querySelector('.fallback');
    if (!fb) return false;
    const r = fb.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }

  function decorarMosaico(li) {
    if (!esMosaico(li)) return;
    const adj = leerAdjunto(li);
    if (!adj) return;
    li.style.cursor = 'pointer';
    CP.ponerMiniatura(li, adj, { tamanoAprox: tamanoDe(li), sondear: true, etiqueta: (adj.name.split('.').pop() || '').toUpperCase(), zIndex: 0 });
  }

  // Un clic sobre el cuadro abre el panel; los controles propios de OX (descargar, quitar...) siguen funcionando
  document.addEventListener('click', (e) => {
    const li = e.target instanceof Element ? e.target.closest('.attachment[data-downloadurl]') : null;
    if (!li || !CP.esCad(li.getAttribute('title'))) return;
    if (e.target.closest('button, a, input, .dropdown-menu')) return;
    if (!esMosaico(li)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    abrirPanel(li);
  }, true);

  function decorar() {
    for (const li of document.querySelectorAll('.attachment[data-downloadurl]')) {
      const nombre = li.getAttribute('title') || '';
      if (!CP.esCad(nombre)) continue;
      if (!li.querySelector(':scope > .' + CLASE_BOTON)) {
        const fs = li.querySelector(':scope > .filesize, :scope .filesize');
        if (fs && fs.parentElement === li) fs.after(crearBoton(li)); else li.append(crearBoton(li));
      }
      const boton = li.querySelector(':scope > .' + CLASE_BOTON);
      if (boton) boton.style.display = esMosaico(li) ? 'none' : '';   // en el mosaico basta el clic sobre el cuadro
      decorarMosaico(li);
    }
  }

  // OX vuelve a pintar la lista de adjuntos cuando se abre o cambia el mensaje: se vigila el DOM
  let pendiente = null;
  const programar = () => { if (pendiente) return; pendiente = setTimeout(() => { pendiente = null; try { decorar(); } catch (e) { console.warn('[CADPreview]', e); } }, 150); };
  new MutationObserver(programar).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', programar);
  decorar();

  // Autodiagnostico: adjuntos cuyo nombre es .dwg/.dxf pero sin la estructura que espera el adaptador
  CP.vigilar({
    sitio: 'ox',
    selectores: {
      '.attachment': '.attachment',
      '.attachment[data-downloadurl]': '.attachment[data-downloadurl]',
      '.attachment .filesize': '.attachment .filesize',
      '.attachment .fallback': '.attachment .fallback'
    },
    sospechosos: () => {
      let n = 0;
      for (const li of document.querySelectorAll('.attachment')) {
        const nombre = li.getAttribute('title') || '';
        if (!/\.(dwg|dxf)\b/i.test(nombre || li.textContent || '')) continue;
        if (!li.hasAttribute('data-downloadurl') || !leerAdjunto(li)) n++;
      }
      return n;
    }
  });
})();
