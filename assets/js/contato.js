// Fale com o IMED (contato.html): a mensagem é gravada no banco pela função send_contact, que devolve na hora
// um número de protocolo (IMED-AAAAMMDD-XXXX). Com a conta aberta, a mensagem vai ligada a ela (ajuda a
// confirmar pedidos sobre dados pessoais). Regras dos campos: confianca.js.
import * as A from './auth.js';
import * as T from './confianca.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const params = new URLSearchParams(location.search);
const form = $('#cform');
const card = $('#contato');
const blank = card.innerHTML; // para "Enviar outra mensagem"

// Campo do formulário → [id do campo, chave do erro].
const FIELDS = [['cAssunto', 'subject'], ['cNome', 'name'], ['cContato', 'contact'], ['cProtocolo', 'code'], ['cMensagem', 'message']];

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function values(f) {
  return {
    subject: f.elements.assunto.value,
    name: f.elements.nome.value,
    contact: f.elements.contato.value,
    code: f.elements.assunto.value === 'cancelamento' ? f.elements.protocolo.value : '',
    message: f.elements.mensagem.value,
  };
}

function showErrors(f, errs) {
  let first = null;
  for (const [id, key] of FIELDS) {
    const el = $(`#${id}`, f);
    $(`#${id}Err`, f).textContent = errs[key] ?? '';
    if (errs[key]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid');
  }
  return first;
}

// Dicas e campos que dependem do assunto.
function onSubject(f) {
  const s = f.elements.assunto.value;
  $('#cCodeBox', f).hidden = s !== 'cancelamento';
  $('#cTipCancel', f).hidden = s !== 'cancelamento';
  $('#cTipLgpd', f).hidden = !T.isLgpdSubject(s);
  $('#cTipClinic', f).hidden = s !== 'clinica';
}

function done(f, protocol, v) {
  const c = T.parseReplyContact(v.contact);
  const lgpd = T.isLgpdSubject(v.subject);
  card.innerHTML = `<div class="ct-done" id="cDone" role="status" tabindex="-1">
      <span class="ic" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></span>
      <h2 id="formTitle">Recebemos sua mensagem</h2>
      ${protocol ? `<p>Seu número de protocolo:</p>
      <p class="ct-proto"><b id="cProto">${esc(protocol)}</b><button class="btn btn-ghost btn-sm" type="button" id="cCopy"><i class="fa-regular fa-copy" aria-hidden="true"></i>Copiar</button></p>
      <p>Guarde este número: ele identifica a sua mensagem.</p>` : ''}
      <p>A equipe do IMED responde pelo ${c?.email ? 'e-mail' : 'celular'} <b>${esc(c?.email ?? (c?.phone ? c.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : ''))}</b>.${lgpd ? ' Pedidos sobre seus dados seguem os prazos da LGPD. Para confirmar que os dados são seus, podemos pedir uma confirmação por esse contato.' : ''}</p>
      <p class="ct-legal">O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp.</p>
      <div class="cl-actions"><a class="btn btn-primary" href="./">Voltar ao início</a><button class="btn btn-ghost" type="button" id="cAgain">Enviar outra mensagem</button></div>
    </div>`;
  card.setAttribute('aria-labelledby', 'formTitle');
  $('#cDone').focus();
  $('#cCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(protocol); toast('Protocolo copiado.'); } catch { toast(protocol); }
  });
  $('#cAgain').addEventListener('click', () => { card.innerHTML = blank; bind($('#cform')); $('#cAssunto').focus(); });
}

async function submit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const v = values(f);
  const errs = T.validateContact(v);
  const first = showErrors(f, errs);
  const msg = $('#cMsg', f);
  msg.innerHTML = '';
  if (first) { first.focus(); return; }
  // Campo escondido preenchido: robô. Não grava nada.
  if (f.elements.website.value) { done(f, '', v); return; }
  const btn = $('#cSend', f);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Enviando…';
  try {
    const protocol = await A.rpc('send_contact', T.contactArgs(v));
    if (!T.isProtocol(protocol)) throw new Error('sem protocolo');
    done(f, protocol, v);
  } catch (err) {
    const { field, text } = T.contactError(err);
    if (field) {
      const id = FIELDS.find(([, k]) => k === field)?.[0];
      if (id) { showErrors(f, { [field]: field === 'contact' ? T.validateContact({ ...v, contact: '' }).contact : 'Confira este campo.' }); $(`#${id}`, f).focus(); }
    }
    msg.innerHTML = `<p class="cl-note err" role="alert" style="margin-top:12px">${esc(text)}</p>`;
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
  }
}

function bind(f) {
  const pre = T.subjectFromParam(params.get('assunto'));
  if (pre && !f.elements.assunto.value) f.elements.assunto.value = pre;
  const code = String(params.get('pedido') ?? '').trim().toUpperCase();
  if (/^IMED-[A-Z0-9-]{4,30}$/.test(code)) f.elements.protocolo.value = code;
  onSubject(f);
  f.elements.assunto.addEventListener('change', () => onSubject(f));
  f.elements.mensagem.addEventListener('input', () => { $('#cCount', f).textContent = `${f.elements.mensagem.value.length} de ${T.CONTACT_MAX} caracteres`; });
  // Ao corrigir um campo, o aviso de erro dele some.
  f.addEventListener('input', (e) => {
    const id = e.target.id;
    if (!FIELDS.some(([x]) => x === id) || e.target.getAttribute('aria-invalid') !== 'true') return;
    e.target.removeAttribute('aria-invalid');
    $(`#${id}Err`, f).textContent = '';
  });
  // Conta aberta: a mensagem vai ligada a ela.
  const u = A.user();
  const acc = $('#cConta', f);
  if (u?.email) {
    acc.innerHTML = `<i class="fa-solid fa-user-check" aria-hidden="true"></i><span>Você está na conta <b>${esc(u.email)}</b>: a mensagem vai ligada a ela.</span>`;
    acc.hidden = false;
    if (!f.elements.contato.value) f.elements.contato.value = u.email;
  }
  f.addEventListener('submit', submit);
}

bind(form);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
