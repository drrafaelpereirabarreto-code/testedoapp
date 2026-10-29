// Envio dos formulários para o banco do IMED (Supabase).
// A chave usada (assets/js/config.js) é pública: as regras do banco só permitem inserir
// cadastros e pedidos, e só administradores conseguem ler o que foi enviado.
(function () {
  var CFG = window.IMED_CONFIG || {};
  var URL = CFG.supabaseUrl;
  var KEY = CFG.supabaseAnonKey;

  window.imedInsert = function (table, row) {
    if (!URL || !KEY) return Promise.reject(new Error('IMED_CONFIG ausente: carregue assets/js/config.js antes de db.js'));
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('http ' + r.status);
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  };
})();
