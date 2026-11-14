// CADPreview: service worker (v1.1). Su único trabajo es leer fragmentos de archivos de Google Drive para el adaptador drive.js.
// Motivo (medido el 12/11/2026 en el Drive real): el servidor de descargas (drive.usercontent.google.com) no envía cabeceras
// CORS, así que un fetch desde la página de Drive falla (solo "no-cors", con respuesta opaca e ilegible). Un service worker
// con permiso de host (host_permissions) no está sujeto a CORS y envía las cookies de la sesión de Drive.
//
// Protocolo (chrome.runtime.sendMessage desde el script de contenido):
//   pide:     { cadpreview: 'leer', url, desde, hasta }   hasta puede ser null (hasta el final del archivo, con el tope del trozo)
//   responde: { status, total, desde, n, b64 }            n = bytes devueltos; total = tamaño del archivo (o null si no se sabe)
//             { error: 'texto' }
// Los bytes viajan en base64 porque los mensajes de extensión son JSON (no admiten ArrayBuffer).
'use strict';

const HOST_DESCARGA = 'drive.usercontent.google.com';
const TROZO_MAX = 3 * 1024 * 1024;       // tope por mensaje (≈ 4 MB en base64; el límite de Chrome es 64 MB)
const confirmados = new Map();           // id → dirección con el "confirm" del aviso del antivirus de Drive (se olvida si el worker se duerme)

// Solo se aceptan direcciones de descarga de Drive; de la dirección recibida solo se usan el id y la cuenta (authuser).
function dirigir(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error('Dirección no válida'); }
  const okHost = u.protocol === 'https:' && (u.hostname === HOST_DESCARGA || u.hostname === 'drive.google.com');
  const okRuta = u.pathname === '/download' || u.pathname === '/uc' || /^\/u\/\d+\/uc$/.test(u.pathname);
  const id = u.searchParams.get('id') || '';
  const authuser = u.searchParams.get('authuser') || '0';
  if (!okHost || !okRuta || !/^[\w-]{10,}$/.test(id) || !/^\d{1,2}$/.test(authuser)) throw new Error('Dirección no permitida');
  return { id, authuser };
}

const baseUrl = (id, authuser) => `https://${HOST_DESCARGA}/download?id=${encodeURIComponent(id)}&export=download&authuser=${authuser}`;

// Lee hasta `max` bytes del cuerpo saltándose los primeros `saltar` (si el servidor ignora Range y devuelve el archivo entero).
async function tomar(resp, saltar, max) {
  const lector = resp.body.getReader();
  const partes = [];
  let leido = 0, visto = 0;
  try {
    while (leido < max) {
      const { done, value } = await lector.read();
      if (done) break;
      let v = value;
      if (visto < saltar) {
        const corte = Math.min(saltar - visto, v.length);
        visto += corte; v = v.subarray(corte);
        if (!v.length) continue;
      }
      if (leido + v.length > max) v = v.subarray(0, max - leido);
      partes.push(v); leido += v.length;
    }
  } finally { try { await lector.cancel(); } catch (_) { /* nada */ } }
  const out = new Uint8Array(leido);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

function aBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// El aviso de "no se puede analizar en busca de virus" que Drive pone en archivos grandes: una página HTML con un formulario
// que lleva "confirm" y "uuid". Se repite la petición con esos valores.
function buscarConfirmacion(html) {
  const c = /name="confirm"\s+value="([^"]+)"/.exec(html);
  const u = /name="uuid"\s+value="([^"]+)"/.exec(html);
  return c ? { confirm: c[1], uuid: u ? u[1] : null } : null;
}

async function leerTrozo(msg) {
  const { id, authuser } = dirigir(msg.url);
  const desde = Number(msg.desde);
  if (!Number.isFinite(desde) || desde < 0) throw new Error('Rango no válido');
  const topeFin = desde + TROZO_MAX - 1;
  const fin = msg.hasta == null ? topeFin : Math.min(Number(msg.hasta), topeFin);
  const max = fin - desde + 1;
  if (!(max > 0)) throw new Error('Rango no válido');
  let destino = confirmados.get(id) || baseUrl(id, authuser);
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(destino, { credentials: 'include', headers: { Range: `bytes=${desde}-${fin}` }, redirect: 'follow', cache: 'no-store' });
    const tipo = r.headers.get('content-type') || '';
    if (/text\/html/i.test(tipo)) {
      const html = (await r.text()).slice(0, 400000);
      const conf = intento === 0 ? buscarConfirmacion(html) : null;
      if (conf) {
        destino = baseUrl(id, authuser) + '&confirm=' + encodeURIComponent(conf.confirm) + (conf.uuid ? '&uuid=' + encodeURIComponent(conf.uuid) : '');
        confirmados.set(id, destino);
        continue;
      }
      throw new Error(r.status === 404 ? 'Drive no encuentra el archivo' : 'Drive devolvió una página en lugar del archivo (¿sin permiso de lectura o sesión caducada?)');
    }
    const cr = r.headers.get('content-range') || '';
    if (r.status === 416) { // rango fuera del archivo
      const t = /\/(\d+)\s*$/.exec(cr);
      try { await r.body.cancel(); } catch (_) { /* nada */ }
      return { status: 416, total: t ? +t[1] : null, desde, n: 0, b64: '' };
    }
    if (r.status !== 200 && r.status !== 206) throw new Error('HTTP ' + r.status);
    const t = /\/(\d+)\s*$/.exec(cr);
    const total = t ? +t[1] : (r.status === 200 ? (+r.headers.get('content-length') || null) : null);
    // 206: el cuerpo ya empieza en `desde`. 200: el servidor ignoró Range y hay que saltar `desde` bytes.
    const bytes = await tomar(r, r.status === 206 ? 0 : desde, max);
    return { status: r.status, total, desde, n: bytes.length, b64: aBase64(bytes) };
  }
  throw new Error('Drive no entregó el archivo');
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (!msg || msg.cadpreview !== 'leer') return false;
  // solo desde scripts de contenido de esta extensión que corren en la página de Drive
  let hostRemitente = '';
  try { hostRemitente = new URL(sender.tab && sender.tab.url || '').hostname; } catch (_) { /* nada */ }
  if (sender.id !== chrome.runtime.id || hostRemitente !== 'drive.google.com') { responder({ error: 'Remitente no permitido' }); return false; }
  leerTrozo(msg).then(responder, (e) => responder({ error: (e && e.message) || String(e) }));
  return true; // respuesta asíncrona
});
