import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Salida: la carpeta "viewer" de la extensión que se carga en el navegador (la fija construir.ps1).
const OUT_DIR = process.env.CADPREVIEW_OUT || resolve(__dirname, '../extension/viewer')

export default defineConfig({
  base: './',
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    modulePreload: false,
    minify: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: { input: { viewer: resolve(__dirname, 'viewer.html') } }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // workers de mlightcad (tal cual salen de los paquetes publicados en npm)
        { src: './node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: './node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: './node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm', dest: 'workers', rename: { stripBase: true } },
        // exportar a HTML: el archivo HTML exportado incluye este visor autónomo
        { src: './node_modules/@mlightcad/cad-html-plugin/dist/viewer-runtime.iife.js', dest: '.', rename: { stripBase: true } },
        // capa de fuentes: la usa el worker de textos (la página la importa en el paquete)
        { src: './src/font-shim.js', dest: 'workers', rename: { stripBase: true } },
        // fuentes incluidas (las descarga y verifica construir.ps1)
        { src: './datos/fonts/*', dest: 'data/fonts', rename: { stripBase: true } }
      ]
    })
  ]
})
