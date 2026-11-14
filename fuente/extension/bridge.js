// Puente (mundo aislado de la extensión): deja en el DOM la URL de la página del visor para que el script principal,
// que corre en el mundo de la página (necesita la clave de sesión de Gmail), pueda crear el iframe.
document.documentElement.dataset.cadpreviewViewer = chrome.runtime.getURL('viewer/viewer.html');
document.documentElement.dataset.cadpreviewVersion = chrome.runtime.getManifest().version;
