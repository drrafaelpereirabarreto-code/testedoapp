// Bloco "Entrar com senha" para os quadros de entrada do site (conta, painel da clínica, gestão, reivindicar e área
// do médico). O quadro continua mandando o link por e-mail; este bloco acrescenta, embaixo, o botão "Entrar com
// senha", que abre o campo da senha, o botão "Entrar" e "Esqueci a senha" (link de recuperação por e-mail, que leva
// para definir-senha.html). Quem nunca definiu uma senha define em definir-senha.html.
// Uso: montarSenha({ form, email: () => texto do campo de e-mail, msg: elemento da mensagem, depois: () => void })
//   - form: o <form> do quadro (o bloco entra no fim dele, antes da mensagem se ela estiver no form);
//   - depois: chamado quando a entrada com senha dá certo (a página redesenha e carrega os dados).
// Nenhuma senha fica guardada: só a sessão que o Supabase devolve (auth.js).
import * as auth from './auth.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Estilo do bloco, uma vez por página (as páginas têm style-src 'unsafe-inline'; as cores vêm do tema).
const CSS = `.es-bloco{margin-top:12px;width:100%;flex-basis:100%}
.es-abrir{background:none;border:0;padding:0;color:var(--primary,#0E7C9C);font:inherit;font-weight:700;font-size:14.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.es-abrir i{margin-right:6px}
.es-campos{margin-top:10px;display:grid;gap:8px}
.es-lbl{display:block;font-weight:700;font-size:14px;color:var(--ink)}
.es-row{display:flex;gap:8px;flex-wrap:wrap}
.es-row input{flex:1 1 200px;min-width:0;border:1px solid var(--line,#cddbe2);border-radius:12px;padding:12px 14px;font-size:16px;background:var(--field,#fff);color:var(--ink);outline:none}
.es-row input:focus{border-color:var(--primary,#0E7C9C);box-shadow:0 0 0 3px rgba(14,124,156,.15)}
.es-row .btn{flex:0 0 auto}
.es-ajuda{font-size:13.5px;color:var(--muted);line-height:1.5;margin:0}
.es-ajuda a,.es-link{color:var(--primary,#0E7C9C);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.es-link{background:none;border:0;padding:0;font:inherit;cursor:pointer}
.es-abrir:focus-visible,.es-link:focus-visible{outline:3px solid var(--primary,#0E7C9C);outline-offset:2px;border-radius:4px}`;
function estilo() {
  if (document.getElementById('es-css')) return;
  const s = document.createElement('style');
  s.id = 'es-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function montarSenha({ form, email, msg, depois, classe = '' }) {
  if (!form || form.querySelector('[data-senha]')) return;
  estilo();
  const box = document.createElement('div');
  box.className = `es-bloco ${classe}`.trim();
  box.setAttribute('data-senha', '');
  box.innerHTML = `<button class="es-abrir" type="button" aria-expanded="false" aria-controls="senhaCampos"><i class="fa-solid fa-key" aria-hidden="true"></i>Entrar com senha</button>
    <div class="es-campos" id="senhaCampos" hidden>
      <label class="es-lbl" for="loginSenha">Sua senha</label>
      <div class="es-row">
        <input id="loginSenha" type="password" autocomplete="current-password" maxlength="200" aria-describedby="loginMsg" placeholder="Sua senha">
        <button class="btn btn-primary" type="button" id="loginSenhaBtn">Entrar</button>
      </div>
      <p class="es-ajuda">Ainda não tem senha? <a href="definir-senha.html">Definir ou trocar a senha</a> · <button class="es-link" type="button" id="loginEsqueci">Esqueci a senha</button></p>
    </div>`;
  // A mensagem (#loginMsg) fica por último no form; o bloco entra antes dela.
  const m = msg && msg.parentNode === form ? msg : null;
  if (m) form.insertBefore(box, m); else form.appendChild(box);

  const abrir = box.querySelector('.es-abrir');
  const campos = box.querySelector('.es-campos');
  const senha = box.querySelector('#loginSenha');
  const entrar = box.querySelector('#loginSenhaBtn');
  const esqueci = box.querySelector('#loginEsqueci');
  const aviso = (texto, kind = 'err') => {
    if (!msg) return;
    msg.className = msg.className.replace(/\b(ok|err|warn)\b/g, '').trim();
    msg.textContent = texto;
    if (kind) msg.classList.add(kind);
    msg.hidden = !texto;
  };

  abrir.addEventListener('click', () => {
    const aberto = campos.hidden;
    campos.hidden = !aberto;
    abrir.setAttribute('aria-expanded', String(aberto));
    if (aberto) senha.focus();
  });

  async function entrarComSenha() {
    const e = String(email() || '').trim();
    if (!EMAIL_OK.test(e)) { aviso('Digite um e-mail válido antes da senha.'); form.querySelector('input[type="email"]')?.focus(); return; }
    if (!senha.value) { aviso('Digite a sua senha.'); senha.focus(); return; }
    entrar.disabled = true;
    aviso('Entrando…', '');
    try {
      await auth.signInWithPassword(e, senha.value);
      senha.value = '';
      aviso('');
      depois?.();
    } catch (err) {
      aviso(err?.status === 429 ? 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.'
        : err?.code === 'invalid_credentials' || err?.status === 400 ? 'E-mail ou senha errados. Se você nunca definiu uma senha, use "Esqueci a senha" ou o link por e-mail.'
          : err?.code === 'email_not_confirmed' ? 'Este e-mail ainda não foi confirmado. Entre uma vez pelo link do e-mail.'
            : 'Não foi possível entrar agora. Confira a internet e tente de novo.');
      senha.focus();
    } finally {
      entrar.disabled = false;
    }
  }
  entrar.addEventListener('click', entrarComSenha);
  senha.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); entrarComSenha(); } });

  esqueci.addEventListener('click', async () => {
    const e = String(email() || '').trim();
    if (!EMAIL_OK.test(e)) { aviso('Digite o seu e-mail para receber o link de senha.'); form.querySelector('input[type="email"]')?.focus(); return; }
    esqueci.disabled = true;
    aviso('Enviando…', '');
    try {
      await auth.recover(e);
      aviso(`Enviamos um link para ${e.toLowerCase()}. Abra o e-mail e toque no link para definir a nova senha (vale 1 hora).`, 'ok');
    } catch (err) {
      aviso(err?.status === 429 ? 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.'
        : 'Não foi possível enviar o e-mail agora. Tente de novo mais tarde ou fale com a equipe do IMED pela página "Fale com o IMED".');
    } finally {
      esqueci.disabled = false;
    }
  });
  return box;
}

// Mensagem curta para quando a entrada venceu (link ou senha).
export const ENTRADA_VENCIDA = 'Sua entrada expirou. Entre de novo abaixo (link por e-mail ou senha).';
export { esc };
