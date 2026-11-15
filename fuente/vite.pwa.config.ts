import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = process.env.CADPREVIEW_OUT || resolve(__dirname, 'dist-pwa')

// Versión móvil (PWA): misma pila que el visor de la extensión, sin fuentes incluidas (se bajan del CDN y se cachean).
export default defineConfig({
  base: './',
  publicDir: resolve(__dirname, 'public-pwa'), // manifest, service worker e iconos (la carpeta public/ es la de la extensión)
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    modulePreload: false,
    minify: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: { input: { index: resolve(__dirname, 'pwa.html') } }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: './node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: './node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: './node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm', dest: 'workers', rename: { stripBase: true } },
        { src: './node_modules/@mlightcad/cad-html-plugin/dist/viewer-runtime.iife.js', dest: '.', rename: { stripBase: true } },
        { src: './src/font-shim.js', dest: 'workers', rename: { stripBase: true } },
        { src: './public/workers/mtext-worker.js', dest: 'workers', rename: { stripBase: true } }
      ]
    })
  ]
})
