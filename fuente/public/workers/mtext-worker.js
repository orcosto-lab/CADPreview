// Envoltorio del worker de textos de mlightcad: primero instala la capa de fuentes locales, después carga el worker original.
// (Los import estáticos se evalúan en orden, así que font-shim.js se ejecuta antes que el worker.)
import './font-shim.js';
import './mtext-renderer-worker.js';
