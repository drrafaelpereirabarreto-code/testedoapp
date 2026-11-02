// Página "Para clínicas" (parceiros.html): números reais do banco e o formulário de contato de clínicas.
// Carregado depois de config.js e db.js. Nada inventado: sem resposta do banco, os números não aparecem.
(function () {
  var C = window.IMED_CONFIG || {};
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  var fmtInt = function (n) { return Number(n).toLocaleString('pt-BR'); };

  // Números reais do cadastro oficial importado no IMED (imported_cities).
  function numeros() {
    var box = $('#numeros');
    if (!box || !C.supabaseUrl || !C.supabaseKey || typeof C.supabaseHeaders !== 'function') return;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 15000);
    fetch(C.supabaseUrl + '/rest/v1/rpc/imported_cities', {
      method: 'POST',
      headers: C.supabaseHeaders(null, { 'Content-Type': 'application/json' }),
      body: '{}',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (rows) {
      if (timer) clearTimeout(timer);
      var list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && Number(r.total) > 0; });
      if (!list.length) return;
      var total = list.reduce(function (s, r) { return s + Number(r.total); }, 0);
      var onde = list.length === 1 ? 'em ' + esc(list[0].name) : 'em ' + fmtInt(list.length) + ' cidades';
      box.innerHTML = '<i class="fa-solid fa-building-circle-check" aria-hidden="true"></i><span>Hoje o IMED mostra <b>' + fmtInt(total) + ' estabelecimentos</b> do cadastro oficial ' + onde + '. O seu pode estar entre eles: <a class="link" href="reivindicar.html" style="color:#fff">procure pelo nome</a>.</span>';
      box.hidden = false;
    }).catch(function () { if (timer) clearTimeout(timer); /* sem número: a frase não aparece */ });
  }

  // Máscaras
  function fmtCNPJ(d) { d = d.slice(0, 14); var o = d.slice(0, 2); if (d.length > 2) o += '.' + d.slice(2, 5); if (d.length > 5) o += '.' + d.slice(5, 8); if (d.length > 8) o += '/' + d.slice(8, 12); if (d.length > 12) o += '-' + d.slice(12); return o; }
  function fmtTel(d) { d = d.slice(0, 11); if (!d) return ''; if (d.length <= 2) return '(' + d; var r = d.slice(2), o = '(' + d.slice(0, 2) + ') '; if (r.length <= 4) return o + r; return o + (d.length === 11 ? r.slice(0, 5) + '-' + r.slice(5) : r.slice(0, 4) + '-' + r.slice(4)); }

  var CAMPOS = [
    ['nome', 'pNome', function (v) { return v.trim().length < 2 ? 'Escreva o nome do estabelecimento.' : ''; }],
    ['tipo', 'pTipo', function (v) { return v ? '' : 'Escolha o tipo.'; }],
    ['doc', 'pDoc', function (v) { return digits(v).length === 14 ? '' : 'Confira o CNPJ (14 números).'; }],
    ['tel', 'pTel', function (v) { var n = digits(v).length; return n === 10 || n === 11 ? '' : 'Confira o celular com DDD.'; }],
    ['email', 'pEmail', function (v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? '' : 'Confira o e-mail.'; }],
    ['cidade', 'pCidade', function (v) { return v.trim().length < 2 ? 'Escreva a cidade.' : ''; }],
  ];

  function validar(f) {
    var primeiro = null;
    CAMPOS.forEach(function (c) {
      var el = f.elements[c[0]], msg = c[2](el.value || '');
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      $('#' + c[1] + 'Err').textContent = msg;
      if (msg && !primeiro) primeiro = el;
    });
    var ok = f.elements.lgpd.checked;
    $('#pLgpdErr').textContent = ok ? '' : 'Para continuar, aceite o uso dos dados para contato.';
    f.elements.lgpd.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok && !primeiro) primeiro = f.elements.lgpd;
    return primeiro;
  }

  function formulario() {
    var f = $('#pform');
    if (!f) return;
    f.elements.doc.addEventListener('input', function (e) { e.target.value = fmtCNPJ(digits(e.target.value)); });
    f.elements.tel.addEventListener('input', function (e) { e.target.value = fmtTel(digits(e.target.value)); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('#pMsg'), btn = $('#pSend');
      msg.innerHTML = '';
      var ruim = validar(f);
      if (ruim) { ruim.focus(); return; }
      var row = {
        partner_type: 'clinica',
        name: f.elements.nome.value.trim(),
        cnpj: f.elements.doc.value.trim(),
        phone: f.elements.tel.value.trim(),
        email: f.elements.email.value.trim().toLowerCase(),
        address: f.elements.cidade.value.trim(),
        services: 'Tipo: ' + f.elements.tipo.value + ' · Pela página Para clínicas',
        online_only: false
      };
      var pronto = function () {
        var card = $('#contato');
        card.innerHTML = '<h2 id="contatoTitle" tabindex="-1">Recebemos o seu contato</h2>'
          + '<div class="pc-ok" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><p>Obrigado, <b>' + esc(row.name) + '</b>. A equipe do IMED vai falar com você pelo celular <b>' + esc(row.phone) + '</b> ou pelo e-mail <b>' + esc(row.email) + '</b>.</p></div>';
        var h = $('#contatoTitle'); if (h) h.focus();
      };
      if (f.elements.website.value) { pronto(); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Enviando…';
      window.imedInsert('partner_leads', row).then(pronto).catch(function () {
        msg.innerHTML = '<p class="cl-note err" role="alert" style="margin-top:12px">Não foi possível enviar agora. Verifique sua internet e tente de novo, ou escreva pelo <a href="contato.html">Fale com o IMED</a>.</p>';
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
      });
    });
  }

  numeros();
  formulario();
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {}); });
  }
})();
