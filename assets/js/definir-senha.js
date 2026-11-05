// Definir ou trocar a senha (definir-senha.html). Três situações:
//   1. a pessoa chegou pelo link de recuperação (#access_token=...&type=recovery) ou já está logada: mostra o quadro
//      "Escolha a sua senha" (duas vezes, mínimo de 8 caracteres) e salva com auth.setPassword (PUT /auth/v1/user);
//   2. sem sessão: quadro "Receber o link para definir a senha" (auth.recover; o e-mail traz o link, que vale 1 h);
//   3. link vencido ou já usado: aviso e o quadro de pedir outro.
// Depois de salvar, mostra os atalhos (Minha conta, Área da clínica, Área do médico) e a pessoa passa a entrar com
// e-mail e senha em qualquer quadro de entrada do site.
// Nenhuma senha fica guardada aqui: só a sessão que o Supabase devolve (auth.js).
import * as A from './auth.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN = 8;

function flash(text, kind = 'info') {
  const f = $('flash');
  f.textContent = text;
  f.className = `ct-flash ${kind}`;
  f.hidden = !text;
}
const msg = (el, text, kind = '') => { el.textContent = text; el.hidden = !text; el.className = `ct-msg${kind ? ` ${kind}` : ''}`; };

function render() {
  const u = A.user();
  $('semSessao').hidden = !!u;
  $('comSessao').hidden = !u;
  if (u) $('meEmail').textContent = u.email || 'sua conta';
}

// Quadro 1: salvar a senha da conta logada.
function bindSalvar() {
  $('senhaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s1 = $('senha1').value;
    const s2 = $('senha2').value;
    const m = $('senhaMsg');
    if (s1.length < MIN) { msg(m, `A senha precisa ter pelo menos ${MIN} caracteres (letras, números ou sinais).`); $('senha1').focus(); return; }
    if (s1 !== s2) { msg(m, 'As duas senhas não são iguais. Digite a mesma senha nos dois campos.'); $('senha2').focus(); return; }
    const btn = $('senhaBtn');
    btn.disabled = true;
    msg(m, 'Salvando…');
    try {
      await A.setPassword(s1);
      $('senha1').value = ''; $('senha2').value = '';
      msg(m, '');
      await mostrarPronto();
    } catch (err) {
      if (err?.status === 401 || err?.code === 'no_session') {
        A.signOut().catch(() => {});
        render();
        flash('Sua entrada venceu antes de salvar. Peça um novo link abaixo.', 'warn');
      } else if (err?.code === 'weak_password' || err?.status === 422) {
        msg(m, err?.data?.msg && /password/i.test(err.data.msg) ? 'Esta senha é fraca demais. Use pelo menos 8 caracteres, misturando letras, números e sinais.' : `A senha precisa ter pelo menos ${MIN} caracteres.`);
        $('senha1').focus();
      } else if (err?.code === 'same_password') {
        msg(m, 'Esta já é a sua senha atual. Escolha outra ou use a mesma para entrar.');
      } else if (err?.status === 429) {
        msg(m, 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.');
      } else {
        msg(m, 'Não foi possível salvar a senha agora. Confira a internet e tente de novo.');
      }
    } finally {
      btn.disabled = false;
    }
  });
  $('sairBtn').addEventListener('click', async () => {
    await A.signOut();
    render();
    flash('Você saiu da conta.', 'info');
    $('recEmail').focus();
  });
}

// Depois de salvar: atalhos para as áreas do site.
async function mostrarPronto() {
  $('senhaForm').hidden = true;
  const box = $('pronto');
  box.hidden = false;
  box.focus();
}

// Quadro 2: pedir o link de recuperação.
function bindRecuperar() {
  $('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('recEmail').value.trim();
    const m = $('recMsg');
    if (!EMAIL_OK.test(email)) { msg(m, 'Digite um e-mail válido, por exemplo voce@exemplo.com.'); $('recEmail').focus(); return; }
    const btn = $('recBtn');
    btn.disabled = true;
    msg(m, 'Enviando…');
    try {
      await A.recover(email, `${location.origin}${location.pathname}`);
      msg(m, `Enviamos um link para ${email.toLowerCase()}. Abra o e-mail e toque no link para definir a senha (vale 1 hora e só uma vez). Confira também a caixa de spam.`, 'ok');
    } catch (err) {
      msg(m, err?.status === 429 ? 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.'
        : 'Não foi possível enviar o e-mail agora. Tente de novo mais tarde ou fale com a equipe do IMED pela página "Fale com o IMED".');
    } finally {
      btn.disabled = false;
    }
  });
}

async function init() {
  bindSalvar();
  bindRecuperar();
  const r = await A.handleRedirect();
  if (r?.status === 'ok') flash(r.recovery ? 'Link confirmado. Agora escolha a sua senha.' : 'Pronto, você entrou. Escolha a sua senha.', 'ok');
  else if (r?.status === 'error') flash(r.message, 'warn');
  else if (location.hash === '#definir') { history.replaceState(history.state, '', location.pathname + location.search); flash('Link confirmado. Agora escolha a sua senha.', 'ok'); }
  render();
  if (A.user()) {
    if (await A.token()) $('senha1').focus();
    else { render(); flash('Sua entrada venceu. Peça um novo link abaixo.', 'warn'); }
  }
}

init();
export { esc };
