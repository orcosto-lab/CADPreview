// Fuentes del visor: las 97 del catálogo (fonts.json, 24,2 MB; sin msyh.woff, simfang.woff, msgothic.woff) van incluidas en la
// extensión (viewer/data/fonts); si un plano pide otra,
// se descarga UNA vez del CDN público (versión fija) y se guarda en la caché de la extensión.
// Se carga en la página del visor (importado por viewer.ts) y en el worker de textos (mtext-worker.js).
export const FONT_COMMIT = 'be0a4956038c05acdd664266e8c803ac04f0ac77'; // mlightcad/cad-data, 16/09/2026
export const FONT_BASE = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@' + FONT_COMMIT + '/';

const FONTS_PREFIX = FONT_BASE + 'fonts/';
const LOCAL = new URL('../data/', import.meta.url).href; // viewer/data/ (assets/ y workers/ cuelgan de viewer/)
const CACHE_NAME = 'cadpreview-fuentes-' + FONT_COMMIT.slice(0, 8);
// Debe coincidir con fuentes-hash.json (lo comprueba construir.ps1)
const INCLUIDAS = new Set([
  '@extfont2.shx', 'AcadEref.shx', 'aehalf.shx', 'AIGDT.ttf', 'AMDTSymbols.shx',
  'AMGDT DWE Edits.shx', 'amgdt.shx', 'AMGDTANS DWE Edits.shx', 'amgdtans.shx', 'arial.woff',
  'bigfont.shx', 'bold.shx', 'CDM_NC.shx', 'Cdm.shx', 'chineset.shx',
  'complex.shx', 'dim.shx', 'extfont.shx', 'extfont2.shx', 'exthalf2.shx',
  'extslim2.shx', 'g12f13.shx', 'g13f12d.shx', 'g13f12w.shx', 'gbcbig.shx',
  'gbeitc.shx', 'gbenor.shx', 'gbgdt.woff', 'gbhzfs.shx', 'gdt.shx',
  'GENISO.shx', 'geniso12.shx', 'GENLTSHP.shx', 'GENPRESE.shx', 'gothice.shx',
  'gothicg.shx', 'gothici.shx', 'greekc.shx', 'greeks.shx', 'hand1.shx',
  'hztxt.shx', 'iges1001.shx', 'iges1002.shx', 'iges1003.shx', 'intecad.shx',
  'ISO.shx', 'isocp.shx', 'isocp2.shx', 'isocp3.shx', 'isoct.shx',
  'isoct2.shx', 'isoct3.shx', 'italic.shx', 'ITALIC8.shx', 'italicc.shx',
  'italict.shx', 'ltypeshp.shx', 'monotxt.shx', 'MONOTXT8.shx', 'noto-sans-kr.woff',
  'pkpmeng.shx', 'romanc.shx', 'romand.shx', 'romans.shx', 'romant.shx',
  'scriptc.shx', 'scripts.shx', 'simhei.woff', 'simkai.woff', 'simplex.shx',
  'SIMPLEX8.shx', 'simsun.woff', 'SJQY.woff', 'spec_bar.shx', 'spec_sl.shx',
  'special.shx', 'syastro.shx', 'symap.shx', 'symath.shx', 'symeteo.shx',
  'symusic.shx', 'tahoma.woff', 'times.shx', 'timesout.shx', 'tssdchn.shx',
  'tssdeng.shx', 'txt.shx', 'verdana.woff', 'whgdtxt.shx', 'whgtxt.shx',
  'whtgtxt.shx', 'whtmtxt.shx', 'yjkchn.shx', 'yjkeng.shx', 'zjdz-s.shx',
  'zjdz.shx', 'fonts.json'
]);

const originalFetch = globalThis.fetch.bind(globalThis);

// Traza de depuración (consola, nivel "debug"): de dónde salió cada fuente y cuánto tardó.
const traza = (origen, nombre, t0, extra) => { try { console.debug('[cadpreview-fuentes]', origen, nombre, Math.round(performance.now() - t0) + 'ms', extra || ''); } catch (_) { /* nada */ } };

async function fuente(url) {
  const t0 = performance.now();
  let nombre = url.slice(FONTS_PREFIX.length).split('?')[0];
  try { nombre = decodeURIComponent(nombre); } catch (_) { /* tal cual */ } // hay nombres con espacios y @
  // 1) incluida en la extensión
  if (INCLUIDAS.has(nombre)) {
    try { const r = await originalFetch(LOCAL + 'fonts/' + encodeURIComponent(nombre)); if (r.ok) { traza('local', nombre, t0); return r; } } catch (_) { /* sigue */ }
  }
  // 2) guardada de una descarga anterior
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const guardada = await cache.match(url);
    if (guardada) { traza('cache', nombre, t0); return guardada; }
  } catch (_) { /* sin caché: se descarga */ }
  // 3) descarga del CDN (una vez) y se guarda
  const r = await originalFetch(url);
  traza('cdn', nombre, t0, 'HTTP ' + r.status);
  if (r.ok && cache) { try { await cache.put(url, r.clone()); } catch (_) { /* nada */ } }
  return r;
}

if (!globalThis.__cadpreviewFontShim) {
  globalThis.__cadpreviewFontShim = true;
  globalThis.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      if (url && url.startsWith(FONTS_PREFIX)) return fuente(url);
    } catch (_) { /* sigue con el fetch normal */ }
    return originalFetch(input, init);
  };
}
