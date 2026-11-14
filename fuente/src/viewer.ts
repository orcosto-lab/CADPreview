// Página del visor de CADPreview: recibe el DWG/DXF por postMessage desde el panel de Gmail y lo dibuja con
// cad-simple-viewer + LibreDWG (WebAssembly en un worker).
import { FONT_BASE } from './font-shim.js' // instala también la capa de fuentes locales
import { AcApDocManager, AcEdOpenMode, acedApplyUiTheme } from '@mlightcad/cad-simple-viewer'
import { acuiRegisterSimpleUiPlugin } from '@mlightcad/cad-simple-ui-plugin/register'
import { registerLazyHtmlPlugin } from '@mlightcad/cad-html-plugin/register'
import { registerLazyPdfPlugin } from '@mlightcad/cad-pdf-plugin/register'
import { registerLazySvgPlugin } from '@mlightcad/cad-svg-plugin/register'
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'

const DWG_WORKER = './workers/libredwg-parser-worker.js'
const MTEXT_WORKER = './workers/mtext-worker.js' // envoltorio: fuentes locales + worker original

// LibreDWG (WebAssembly con Embind) crea funciones con `new Function`, que el CSP de las páginas de una extensión
// MV3 prohíbe. Se ejecuta dentro de una página "sandbox" de la extensión (permite unsafe-eval) y aquí se la
// presenta al visor como si fuera un Worker.
const RealWorker = window.Worker
class SandboxWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: null = null
  private frame: HTMLIFrameElement
  private ready: Promise<void>
  private listeners: Array<(e: MessageEvent) => void> = []
  private onWin = (ev: MessageEvent) => {
    if (ev.source !== this.frame.contentWindow || !ev.data || !ev.data.__sandboxWorker) return
    if (ev.data.__error) {
      this.onerror?.(new ErrorEvent('error', { message: ev.data.__error }))
      return
    }
    const msg = new MessageEvent('message', { data: ev.data.data })
    this.onmessage?.(msg)
    this.listeners.forEach(l => l(msg))
  }
  constructor(_url: string | URL, _opts?: WorkerOptions) {
    this.frame = document.createElement('iframe')
    this.frame.style.display = 'none'
    this.frame.src = './parser-sandbox.html'
    this.ready = new Promise(res => this.frame.addEventListener('load', () => res(), { once: true }))
    window.addEventListener('message', this.onWin)
    document.body.appendChild(this.frame)
  }
  postMessage(msg: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
    const list = Array.isArray(transfer) ? transfer : (transfer as StructuredSerializeOptions | undefined)?.transfer ?? []
    this.ready.then(() => this.frame.contentWindow!.postMessage(msg, '*', list))
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { if (type === 'message') this.listeners.push(fn) }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { if (type === 'message') this.listeners = this.listeners.filter(l => l !== fn) }
  terminate() { window.removeEventListener('message', this.onWin); this.frame.remove() }
}
;(window as unknown as { Worker: unknown }).Worker = function (url: string | URL, opts?: WorkerOptions) {
  return /libredwg-parser-worker/.test(String(url)) ? new SandboxWorker(url, opts) : new RealWorker(url, opts)
}

const statusEl = document.getElementById('status') as HTMLDivElement
const container = document.getElementById('cad-container') as HTMLDivElement
let started = false

function say(text: string, error = false) {
  statusEl.textContent = text
  statusEl.style.display = text ? 'block' : 'none'
  statusEl.style.color = error ? '#f28b82' : '#e8eaed'
  window.parent.postMessage({ type: 'status', text, error }, '*')
}

const host = document.getElementById('cad-host') as HTMLDivElement

// Brave (y Chrome con el almacenamiento de terceros bloqueado) niegan IndexedDB y Cache Storage a una página de
// extensión dentro de un iframe de Gmail. Exportar a PDF necesita IndexedDB: si no funciona, se usa una copia en memoria.
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
    console.debug('[cadpreview] IndexedDB bloqueada en el iframe: se usa una copia en memoria')
  }
}

async function start() {
  if (started) return
  started = true
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
    useMainThreadDraw: true,
    webworkerFileUrls: { mtextRender: MTEXT_WORKER, dwgParser: DWG_WORKER }
  })
  const pluginManager = AcApDocManager.instance.pluginManager
  // Exportar: HTML, PDF y SVG (cada plugin se carga solo cuando se usa su comando)
  registerLazyHtmlPlugin(pluginManager, { viewerRuntimeUrl: './viewer-runtime.iife.js' })
  registerLazyPdfPlugin(pluginManager)
  registerLazySvgPlugin(pluginManager)
  // Barra de herramientas del visor (a la derecha, plegable). Se quitan "open" (abrir otro archivo) y "annotation"
  // (marcas de dibujo: nubes, flechas, textos…): aquí solo se mira, se mide, se busca y se exporta.
  await acuiRegisterSimpleUiPlugin(pluginManager, {
    host,
    dockPanel: { defaultOpen: false, defaultHeight: 240, defaultWidth: 280 },
    toolbar: { placement: 'right', items: 'default', excludeItems: ['open', 'annotation'], collapsible: true }
  })
}

window.addEventListener('message', async (ev: MessageEvent) => {
  if (ev.source !== window.parent) return
  const msg = ev.data
  if (!msg || msg.type !== 'open-file' || !(msg.buffer instanceof ArrayBuffer)) return
  const t0 = performance.now()
  try {
    say('Procesando el dibujo…')
    await start()
    const tInicio = Math.round(performance.now() - t0)
    console.debug(`[cadpreview] arranque del visor y de los plugins: ${tInicio} ms`)
    const ok = await AcApDocManager.instance.openDocument(String(msg.name || 'dibujo.dwg'), msg.buffer, {
      minimumChunkSize: 1000,
      mode: AcEdOpenMode.Review, // se puede mirar, medir y buscar, pero no modificar el dibujo (los tiempos son los mismos que en Write)
      sysVars: { lwdisplay: false },
      timeout: 300000 // por defecto la librería corta a los 30 s; un DWG de 18 MB tarda ≈ 50 s solo en leerse
    } as never)
    const ms = Math.round(performance.now() - t0)
    console.debug(`[cadpreview] lectura del dibujo: ${ms - tInicio} ms (total ${ms} ms)`)
    if (ok) {
      say('')
      window.parent.postMessage({ type: 'opened', ok: true, ms }, '*')
    } else {
      say('No se pudo abrir el archivo.', true)
      window.parent.postMessage({ type: 'opened', ok: false, ms }, '*')
    }
  } catch (e) {
    say('Error al abrir el archivo: ' + String((e as Error)?.message || e).slice(0, 200), true)
    window.parent.postMessage({ type: 'opened', ok: false, error: String(e).slice(0, 300) }, '*')
  }
})

window.addEventListener('error', e => window.parent.postMessage({ type: 'status', text: 'Error: ' + e.message, error: true }, '*'))
window.parent.postMessage({ type: 'ready' }, '*')
