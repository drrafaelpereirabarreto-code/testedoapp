// Conferência pública de documento da teleconsulta (documento.html, aberta pelo QR Code com ?c=CÓDIGO ou digitando o
// código). Mostra só o que a função pública tele_doc_verify devolve: tipo, data e hora da emissão, nome e CRM/UF do
// médico, iniciais do paciente, se foi cancelado e se o médico enviou o PDF assinado. Nada de conteúdo clínico.
// A validade da assinatura digital quem confere é o validar.iti.gov.br (o IMED não afirma que a assinatura vale).
import * as T from './tele-core.js';
import * as D from './tele-docs.js';

T.ensureCompat();
const C = window.IMED_CONFIG || {};
const $ = (s) => document.querySelector(s);
const esc = T.esc;
const CFM = '<a class="link" href="https://portal.cfm.org.br/busca-medicos/" target="_blank" rel="noopener">conferir no CFM<span class="sr"> (abre em outra aba)</span></a>';
const ITI = '<a class="link" href="https://validar.iti.gov.br/" target="_blank" rel="noopener">validar.iti.gov.br<span class="sr"> (abre em outra aba)</span></a>';

// Chamada só com a chave pública (não usa a conta de quem estiver logado neste aparelho).
async function verify(code) {
  const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/tele_doc_verify`, {
    method: 'POST',
    headers: { apikey: C.supabaseAnonKey, Authorization: `Bearer ${C.supabaseAnonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_code: code }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error((data && data.message) || `http ${res.status}`), { status: res.status, data });
  return Array.isArray(data) ? data : [];
}

function showErr(text) {
  const inp = $('#dcCode');
  $('#dcErr').textContent = text || '';
  inp.setAttribute('aria-invalid', text ? 'true' : 'false');
  inp.closest('.fld').classList.toggle('bad', !!text);
}
function head(cls, icon, title, text) {
  return `<div class="dc-head ${cls}"><i class="fa-solid ${icon}" aria-hidden="true"></i><div><h3 id="dcResTitle" tabindex="-1">${esc(title)}</h3><p>${text}</p></div></div>`;
}
function render(code, row) {
  const box = $('#dcRes');
  const shown = D.fmtCode(code);
  if (!row) {
    box.innerHTML = head('dc-bad', 'fa-circle-xmark', 'Documento não encontrado',
      `Não há documento do IMED com o código <b>${esc(shown)}</b>. Confira as letras e os números. Se o código estiver certo, o documento pode ser falso: não aceite.`);
    return;
  }
  const k = D.KIND[row.kind]?.title || 'Documento';
  const cancelled = row.status === 'cancelado';
  // O médico tem 7 dias para enviar o PDF assinado; depois disso, o rascunho não vale e não vai mais valer.
  const until = D.signDeadline(row);
  const late = !cancelled && !row.signed && !!until && Date.now() >= Date.parse(until);
  const crm = row.doctor_crm ? `CRM-${String(row.doctor_crm_uf || '').toUpperCase()} ${row.doctor_crm}` : '';
  const intro = cancelled
    ? head('dc-bad', 'fa-ban', 'Documento cancelado', `Este documento foi cancelado${row.cancelled_at ? ` em ${esc(T.fmtDateTime(row.cancelled_at))}` : ''}. <b>Não aceite.</b>`)
    : row.signed
      ? head('dc-ok', 'fa-circle-check', 'Documento encontrado', 'Emitido pelo IMED em teleconsulta, e o médico enviou o PDF assinado. Confira a assinatura do arquivo (veja abaixo).')
      : late
        ? head('dc-bad', 'fa-circle-xmark', 'Documento sem assinatura (prazo encerrado)', 'O médico não enviou o PDF assinado no prazo de 7 dias. Este rascunho não vale como documento: <b>não aceite</b>.')
        : head('dc-warn', 'fa-triangle-exclamation', 'Documento encontrado, ainda sem assinatura', `Emitido pelo IMED em teleconsulta, mas o médico ainda não enviou o PDF assinado (prazo: até ${esc(T.fmtDateTime(until))}). Até lá, é só um rascunho: <b>não vale como documento oficial</b>.`);
  const rows = [
    ['Código', esc(shown)],
    ['Tipo', esc(k)],
    ['Emitido em', `${esc(T.fmtDateTime(row.created_at))} (horário de Brasília)`],
    ['Médico(a)', esc(row.doctor_name || '')],
    ['CRM', `${esc(crm)}${crm ? ` · ${CFM}` : ''}`],
    ['Paciente (iniciais)', esc(row.patient_initials || '')],
    ['Situação', cancelled ? `Cancelado${row.cancelled_at ? ` em ${esc(T.fmtDateTime(row.cancelled_at))}` : ''}` : 'Não cancelado'],
    ['PDF assinado', row.signed ? 'Sim: o médico enviou o PDF assinado' : late ? 'Não: o prazo para o médico enviar terminou (rascunho sem valor)' : 'Não: ainda sem assinatura (rascunho, não vale como documento oficial)'],
  ];
  box.innerHTML = `${intro}
    <dl class="md-dl dc-dl">${rows.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${b}</dd></div>`).join('')}</dl>
    ${cancelled ? '<p class="dc-alert">Documento cancelado: peça um novo a quem emitiu.</p>' : late ? '<p class="dc-alert">Rascunho sem assinatura e com o prazo encerrado: não vale. Peça um documento novo a quem emitiu.</p>' : `<p class="${row.signed ? 'tl-small' : 'dc-draft'}">${row.signed
      ? `Para conferir a assinatura, peça o arquivo PDF (não um print nem uma foto) e envie em ${ITI}. O resultado precisa ser “Aprovado”, com a assinatura ${row.doctor_name ? `de ${esc(row.doctor_name)}` : 'do(a) médico(a) acima'}, e o código impresso no PDF precisa ser ${esc(shown)}. O IMED não confere a validade da assinatura.`
      : 'Peça o PDF assinado ao paciente ou ao médico. Quando o médico enviar, esta página passa a mostrar “PDF assinado: Sim”.'}</p>`}`;
}
async function check(raw, { focus = true, push = true } = {}) {
  const code = D.normCode(raw);
  $('#dcRes').innerHTML = '';
  if (!code) {
    showErr(String(raw ?? '').trim()
      ? 'O código tem 10 letras e números, sem 0, 1, I e O (por exemplo: ABCDE-FGHJK). Confira o que foi digitado.'
      : 'Digite o código impresso no documento.');
    $('#dcCode').focus();
    return;
  }
  showErr('');
  $('#dcCode').value = D.fmtCode(code);
  const btn = $('#dcBtn');
  btn.disabled = true;
  $('#dcRes').innerHTML = '<p class="tl-load"><span class="spin" aria-hidden="true"></span>Conferindo…</p>';
  try {
    const rows = await verify(code);
    render(code, rows[0] || null);
    if (push) { try { history.replaceState(null, '', `${location.pathname}?c=${code}`); } catch { /* sem histórico */ } }
    if (focus) $('#dcResTitle')?.focus();
  } catch (err) {
    const msg = String(err?.data?.message || '');
    if (msg === 'dados_invalidos') { $('#dcRes').innerHTML = ''; showErr('Código inválido: confira as letras e os números.'); $('#dcCode').focus(); return; }
    $('#dcRes').innerHTML = `<p class="bk-err show">${esc(err?.name === 'TimeoutError' || !err?.status ? 'Sem resposta do servidor. Confira a internet e tente de novo.' : 'Não foi possível conferir agora. Tente de novo em instantes.')}</p>`;
  } finally {
    btn.disabled = false;
  }
}

$('#dcForm').addEventListener('submit', (e) => { e.preventDefault(); check($('#dcCode').value); });
$('#dcCode').addEventListener('input', () => { if ($('#dcCode').getAttribute('aria-invalid') === 'true') showErr(''); });
const first = new URLSearchParams(location.search).get('c');
if (first) { $('#dcCode').value = first.slice(0, 40); check(first, { focus: false, push: false }); }
