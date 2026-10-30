// Peças comuns das páginas da clínica (reivindicar.html e painel.html): escapar texto, validar
// CPF/CNPJ e telefone, formatar datas, mostrar avisos e o quadro de entrada com link por e-mail.
import * as auth from './auth.js';
import { EXAMS, KINDS, PERIODS, statusLabel, onlyDigits, maskPhone, isValidPhone, isValidEmail, telHref } from './geo-core.js';

export { auth, EXAMS, KINDS, PERIODS, statusLabel, onlyDigits, maskPhone, isValidPhone, isValidEmail, telHref };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Todo dado vindo do banco ou de quem usa o site passa por aqui antes de ir para o HTML.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const EXAM_NAMES = { ...Object.fromEntries(Object.entries(EXAMS).map(([k, v]) => [k, v.n])), consulta: 'Consulta', outro: 'Outro' };
export const examName = (code) => (code ? EXAM_NAMES[code] || code : 'Não informado');
export const kindName = (k) => KINDS[k]?.n || '';

export const ROLES = {
  proprietario: 'Proprietário(a)',
  socio: 'Sócio(a)',
  gestor: 'Gestor(a) ou administrador(a)',
  responsavel_tecnico: 'Responsável técnico(a)',
  outro: 'Outro',
};
export const CLAIM_STATUS = { pending: 'Em análise', approved: 'Aprovado', rejected: 'Recusado' };

// CPF e CNPJ com dígitos verificadores.
export function isValidCpf(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const dv = ((s * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}
export function isValidCnpj(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, x, i) => acc + Number(d[i]) * x, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
export function maskDoc(v) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, (_, a, b, c, e, f) => `${a}.${b}.${c}/${e}${f ? `-${f}` : ''}`);
}
// Documento parcialmente escondido (para mostrar na tela da equipe).
export function hideDoc(v) {
  const d = onlyDigits(v);
  if (d.length === 11) return `${d.slice(0, 3)}.•••.•••-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.•••.•••/${d.slice(8, 12)}-${d.slice(12)}`;
  return '•••';
}
export const fmtPhone = (v) => { const d = onlyDigits(v); return d.length >= 10 && d.length <= 11 ? maskPhone(d) : String(v ?? ''); };

const TZ = 'America/Sao_Paulo';
export function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);
}
export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
}

// Preço digitado em reais ("450", "450,00", "1.234,56", "1234.5") para centavos inteiros. null se vazio; NaN se inválido.
export function parsePrice(v) {
  let s = String(v ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

// Quando a renovação da entrada falha, auth.js apaga a sessão: a pessoa precisa pedir outro link.
export const EXPIRED = 'Sua entrada expirou. Peça um novo link abaixo.';
export const sessionLost = (err) => !auth.user() && (err?.status === 401 || err?.status === 403 || err?.data?.code === '42501' || /JWT/i.test(String(err?.data?.message || err?.message || '')));

// Mensagem do banco em linguagem simples.
export function friendlyError(err, fallback = 'Não foi possível concluir agora. Tente de novo em instantes.') {
  const code = err?.data?.code;
  const msg = String(err?.data?.message || err?.message || '');
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'O servidor demorou para responder. Confira a internet e tente de novo.';
  if (sessionLost(err)) return EXPIRED;
  if (err?.status === 401 || /JWT/i.test(msg)) return 'Sua entrada expirou. Saia e entre de novo com o link por e-mail.';
  if (code === '23514') return 'Algum dado não está no formato aceito. Confira os campos e tente de novo.';
  if (code === '42501' || err?.status === 403) return 'Sua conta não tem permissão para isso.';
  return fallback;
}

let toastTimer;
export function toast(text) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

export const loading = (text = 'Carregando…') => `<p class="cl-state" role="status"><span class="spin" aria-hidden="true"></span>${esc(text)}</p>`;
export const note = (text, kind = 'info') => `<p class="cl-note ${kind}" ${kind === 'err' ? 'role="alert"' : 'role="status"'}>${text}</p>`;

// Volta do link mágico. Devolve um aviso (texto) para mostrar ou null.
export async function finishLogin() {
  const r = await auth.handleRedirect();
  if (!r) return null;
  return r.status === 'ok' ? { kind: 'ok', text: 'Pronto, você entrou.' } : { kind: 'err', text: r.message };
}

// Quadro "Entrar com e-mail" / "Você entrou como ...". onChange é chamado ao sair.
export function renderAuth(box, { back, intro, onSignOut }) {
  const u = auth.user();
  if (u) {
    box.innerHTML = `<div class="cl-who"><span><i class="fa-solid fa-circle-user" aria-hidden="true"></i>Você entrou como <b>${esc(u.email)}</b></span>
      <button class="btn btn-ghost btn-sm" type="button" data-signout>Sair</button></div>`;
    $('[data-signout]', box).onclick = async () => { await auth.signOut(); onSignOut?.(); };
    return;
  }
  box.innerHTML = `<form class="cl-login" novalidate>
      <p class="cl-help">${intro}</p>
      <label class="cl-lbl" for="loginEmail">Seu e-mail</label>
      <div class="cl-row">
        <input id="loginEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required aria-describedby="loginMsg" placeholder="voce@clinica.com.br">
        <button class="btn btn-coral" type="submit">Receber link</button>
      </div>
      <p class="cl-msg" id="loginMsg" aria-live="polite"></p>
    </form>`;
  const form = $('form', box);
  const msg = $('#loginMsg', box);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#loginEmail', box).value.trim();
    msg.className = 'cl-msg';
    if (!isValidEmail(email)) { msg.textContent = 'Digite um e-mail válido, como voce@clinica.com.br.'; msg.classList.add('err'); $('#loginEmail', box).focus(); return; }
    const btn = $('button', form);
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    try {
      await auth.signIn(email, typeof back === 'function' ? back() : back);
      msg.innerHTML = `Enviamos um link para <b>${esc(email.toLowerCase())}</b>. Abra no mesmo aparelho e navegador para continuar.`;
      msg.classList.add('ok');
    } catch (err) {
      msg.textContent = err?.status === 429 ? 'Muitos pedidos de link em pouco tempo. Espere um minuto e tente de novo.' : 'Não foi possível enviar o link agora. Confira o e-mail e tente de novo.';
      msg.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  };
}
