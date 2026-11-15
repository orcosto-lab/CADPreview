// CADPreview - versión móvil (PWA). Misma pila que el visor de la extensión (mlightcad + LibreDWG/WASM), pero:
//  - sin iframe ni postMessage: el archivo sale de un <input type="file"> y se pasa directamente al visor;
//  - sin página "sandbox": aquí no hay CSP de extensión MV3, así que LibreDWG corre en un Worker normal.
import { FONT_BASE } from './font-shim.js' // instala también la capa de fuentes (local si existe, si no CDN)
import { AcApDocManager, AcEdOpenMode, acedApplyUiTheme } from '@mlightcad/cad-simple-viewer'
import { acuiRegisterSimpleUiPlugin } from '@mlightcad/cad-simple-ui-plugin/register'
import { registerLazyHtmlPlugin } from '@mlightcad/cad-html-plugin/register'
import { registerLazyPdfPlugin } from '@mlightcad/cad-pdf-plugin/register'
import { registerLazySvgPlugin } from '@mlightcad/cad-svg-plugin/register'
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'

const DWG_WORKER = './workers/libredwg-parser-worker.js'
const MTEXT_WORKER = './workers/mtext-worker.js'

const params = new URLSearchParams(location.search)
// ?hilo=1 -> dibujo de textos en worker (useMainThreadDraw: false), por si el hilo principal se congela en el móvil
const USAR_HILO_PRINCIPAL = !params.has('hilo')

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const estadoEl = $<HTMLDivElement>('estado')
const medidasEl = $<HTMLDivElement>('medidas')
const inicioEl = $<HTMLDivElement>('inicio')
const archivoEl = $<HTMLInputElement>('archivo')
const container = $<HTMLDivElement>('cad-container')
const host = $<HTMLDivElement>('cad-host')

function decir(texto: string, error = false) {
  estadoEl.textContent = texto
  estadoEl.style.display = texto ? 'block' : 'none'
  estadoEl.style.color = error ? '#f28b82' : '#e8eaed'
}

function infoDispositivo(): string {
  const nav = navigator as Navigator & { deviceMemory?: number }
  let gl = 'WebGL: no disponible'
  try {
    const c = document.createElement('canvas')
    const ctx = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    if (ctx) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info')
      gl = 'WebGL: ' + (ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER))
    }
  } catch { /* nada */ }
  return `${gl}\nnúcleos: ${nav.hardwareConcurrency ?? '?'} · memoria: ${nav.deviceMemory ?? '?'} GB (aprox.)\nhilo principal: ${USAR_HILO_PRINCIPAL ? 'sí' : 'no (?hilo=1)'}`
}

// IndexedDB bloqueada (modo privado, etc.): copia en memoria, solo para que la exportación a PDF no falle
async function asegurarIndexedDB() {
  try {
    await new Promise<void>((ok, ko) => {
      const q = indexedDB.open('cadpreview-sonda')
      q.onsuccess = () => { q.result.close(); indexedDB.deleteDatabase('cadpreview-sonda'); ok() }
      q.onerror = () => ko(q.error)
      q.onblocked = () => ko(new Error('bloqueada'))
    })
  } catch {
    const fake = await import('fake-indexeddb')
    const globales: Record<string, unknown> = {
      indexedDB: fake.indexedDB, IDBFactory: fake.IDBFactory, IDBKeyRange: fake.IDBKeyRange, IDBDatabase: fake.IDBDatabase,
      IDBObjectStore: fake.IDBObjectStore, IDBIndex: fake.IDBIndex, IDBCursor: fake.IDBCursor, IDBCursorWithValue: fake.IDBCursorWithValue,
      IDBTransaction: fake.IDBTransaction, IDBRequest: fake.IDBRequest, IDBOpenDBRequest: fake.IDBOpenDBRequest,
      IDBVersionChangeEvent: fake.IDBVersionChangeEvent
    }
    for (const [nombre, valor] of Object.entries(globales)) {
      Object.defineProperty(globalThis, nombre, { value: valor, configurable: true, writable: true })
    }
  }
}

let iniciado = false
async function iniciar() {
  if (iniciado) return
  iniciado = true
  await asegurarIndexedDB()
  acedApplyUiTheme('dark', document.documentElement)
  acedApplyUiTheme('dark', host)
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DWG,
    new AcDbLibreDwgConverter({ convertByEntityType: false, useWorker: true, parserWorkerUrl: DWG_WORKER })
  )
  AcApDocManager.createInstance({
    container,
    busyIndicatorHost: host,
    autoResize: true,
    baseUrl: FONT_BASE,
    useMainThreadDraw: USAR_HILO_PRINCIPAL,
    webworkerFileUrls: { mtextRender: MTEXT_WORKER, dwgParser: DWG_WORKER }
  })
  const pluginManager = AcApDocManager.instance.pluginManager
  registerLazyHtmlPlugin(pluginManager, { viewerRuntimeUrl: './viewer-runtime.iife.js' })
  registerLazyPdfPlugin(pluginManager)
  registerLazySvgPlugin(pluginManager)
  await acuiRegisterSimpleUiPlugin(pluginManager, {
    host,
    dockPanel: { defaultOpen: false, defaultHeight: 240, defaultWidth: 280 },
    toolbar: { placement: 'right', items: 'default', excludeItems: ['open', 'annotation'], collapsible: true }
  })
}

async function abrir(f: File) {
  const t0 = performance.now()
  inicioEl.style.display = 'none'
  medidasEl.style.display = 'block'
  const mb = (f.size / 1048576).toFixed(1)
  medidasEl.textContent = `${f.name} · ${mb} MB\n${infoDispositivo()}`
  try {
    decir('Leyendo el archivo…')
    const buffer = await f.arrayBuffer()
    decir('Procesando el dibujo…')
    await iniciar()
    const tArranque = performance.now() - t0
    const ok = await AcApDocManager.instance.openDocument(f.name, buffer, {
      minimumChunkSize: 1000,
      mode: AcEdOpenMode.Review,
      sysVars: { lwdisplay: false },
      timeout: 300000
    } as never)
    const total = (performance.now() - t0) / 1000
    if (ok) {
      decir('')
      medidasEl.textContent += `\narranque: ${(tArranque / 1000).toFixed(1)} s · abierto en: ${total.toFixed(1)} s`
    } else {
      decir('No se pudo abrir el archivo.', true)
      inicioEl.style.display = 'flex'
    }
  } catch (e) {
    decir('Error al abrir el archivo: ' + String((e as Error)?.message || e).slice(0, 300), true)
    inicioEl.style.display = 'flex'
  }
}

medidasEl.addEventListener('click', () => medidasEl.classList.toggle('plegado')) // un toque pliega o despliega el cuadro de medidas
archivoEl.addEventListener('change', () => {
  const f = archivoEl.files?.[0]
  if (f) void abrir(f)
})


// ---------- Instalación y "Compartir con CADPreview" ----------
// El service worker (sw.js) solo se registra en un contexto seguro (HTTPS o localhost). Cuando otra app comparte un archivo con
// CADPreview, el service worker lo guarda en una caché y redirige a ./?compartido=1 (o =error); aquí se recoge y se abre.
const CACHE_COMPARTIDO = 'cadpreview-compartido'

async function recogerCompartido(): Promise<File | null> {
  const marca = params.get('compartido')
  if (!marca) return null
  history.replaceState(null, '', location.pathname) // que recargar no vuelva a abrirlo
  if (marca !== '1') { decir('No se pudo recibir el archivo compartido. Elígelo con el botón.', true); return null }
  try {
    const cache = await caches.open(CACHE_COMPARTIDO)
    const clave = new URL('./__compartido', location.href).href
    const r = await cache.match(clave)
    if (!r) return null
    const nombre = decodeURIComponent(r.headers.get('X-Nombre') || 'dibujo.dwg')
    const blob = await r.blob()
    await cache.delete(clave)
    return new File([blob], nombre)
  } catch {
    decir('No se pudo leer el archivo compartido. Elígelo con el botón.', true)
    return null
  }
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.debug('[cadpreview] service worker no registrado', e))
}
void recogerCompartido().then((f) => { if (f) void abrir(f) })

window.addEventListener('error', (e) => decir('Error: ' + e.message, true))
window.addEventListener('unhandledrejection', (e) => decir('Error: ' + String((e.reason as Error)?.message || e.reason), true))
// para pruebas automáticas
;(window as unknown as { __abrirArchivo: (f: File) => Promise<void> }).__abrirArchivo = abrir
