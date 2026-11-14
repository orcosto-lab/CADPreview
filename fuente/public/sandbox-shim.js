// Hace que esta página se comporte como el contexto global de un Worker:
//  - lo que el script del lector envía con postMessage(datos, [transferibles]) va a la página padre;
//  - lo que el padre envía llega al script como eventos "message" (igual que en un worker).
(function () {
  var parentWin = window.parent;
  window.postMessage = function (data, transfer) {
    var list = Array.isArray(transfer) ? transfer : (transfer && transfer.transfer) || [];
    parentWin.postMessage({ __sandboxWorker: true, data: data }, '*', list);
  };
  // En un worker, "self" y el ámbito global coinciden; aquí window ya hace de ambos.
  window.addEventListener('error', function (e) {
    parentWin.postMessage({ __sandboxWorker: true, __error: String(e.message || e.error || 'error') }, '*');
  });
  window.addEventListener('unhandledrejection', function (e) {
    parentWin.postMessage({ __sandboxWorker: true, __error: 'rechazo no controlado: ' + String(e.reason && e.reason.message || e.reason) }, '*');
  });
})();
