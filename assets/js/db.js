// Envio dos formulários para o banco do IMED (Supabase).
// A chave abaixo é pública: as regras do banco só permitem inserir
// cadastros, e só administradores conseguem ler o que foi enviado.
(function () {
  var URL = 'https://pyoqiecupxhdzigjudyd.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5b3FpZWN1cHhoZHppZ2p1ZHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxODMwNjAsImV4cCI6MjEwODc1OTA2MH0.a0tD8O7CASKLr50kEkEaBIHDSiuySqPNfyVvQ3fzq7Q';

  window.imedInsert = function (table, row) {
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
