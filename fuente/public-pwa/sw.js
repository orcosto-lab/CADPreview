// Service worker de CADPreview (versión móvil).
//  - Deja la aplicación en caché para abrirla sin conexión (la lista la inyecta construir-pwa.mjs).
//  - Recibe el archivo cuando se comparte con CADPreview desde otra app (Web Share Target: POST multipart a ./compartir),
//    lo guarda en una caché y redirige a la página, que lo abre.
const VERSION = '__VERSION__';
const PRECACHE = /*__PRECACHE__*/[];
const CACHE_APP = 'cadpreview-app-' + VERSION;
const CACHE_COMPARTIDO = 'cadpreview-compartido';
const CLAVE_COMPARTIDO = new URL('__compartido', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cadpreview-app-') && k !== CACHE_APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function recibir(req) {
  const destino = (q) => Response.redirect(new URL('./?compartido=' + q, self.registration.scope).href, 303);
  try {
    const datos = await req.formData();
    const f = datos.getAll('archivo').find((x) => x && typeof x === 'object' && 'name' in x);
    if (!f) return destino('error');
    const cache = await caches.open(CACHE_COMPARTIDO);
    await cache.put(CLAVE_COMPARTIDO, new Response(f, { headers: { 'X-Nombre': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' } }));
    return destino('1');
  } catch (_) {
    return destino('error');
  }
}

async function primeroCache(req) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(req, { ignoreSearch: true });
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok && r.type === 'basic') { try { await cache.put(req, r.clone()); } catch (_) { /* nada */ } }
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/compartir')) { e.respondWith(recibir(req)); return; }
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  e.respondWith(primeroCache(req));
});
