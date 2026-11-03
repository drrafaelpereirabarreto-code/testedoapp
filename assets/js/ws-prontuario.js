// Prontuário da consulta (iMed Medical Workspace, fase 2), na área do médico (medico.html). Baixado só quando a
// primeira consulta abre (medico.js chama abrir/fechar); sem ele, a teleconsulta segue igual.
// - Registro em abas: anamnese, exame físico (sinais vitais com a origem de cada número; nada se preenche
//   sozinho), diagnóstico (CID-10 do catálogo oficial, sem sugestão automática), conduta, evolução (SOAP ou texto
//   livre, sem perder nada ao trocar) e pré-visualização.
// - Rascunho salvo no servidor sozinho (2 s depois de parar de digitar e a cada 15 s com mudança), com versão: outra
//   aba ou aparelho salvou antes = aviso de conflito, nunca sobrescreve calado. O que ainda não foi enviado fica em
//   sessionStorage até salvar.
// - Finalizar com confirmação: o registro fica imutável no banco (hash encadeado); depois, só adendo com data e hora.
// - Linha do tempo com filtros (registro, versões, diagnósticos, adendos, documentos).
// Banco: public.ws_registro_* , public.ws_adendo_criar e public.cat_cid_buscar (supabase/migrations/*_prontuario.sql).
import * as A from './auth.js';
import * as T from './tele-core.js';
import * as D from './tele-docs.js';
import * as W from './ws-core.js';
import { iniciarLayout, novaConsulta } from './ws-layout.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = T.esc;
const SALVAR_MS = 2000;
const REPETIR_MS = 15000;
const RASC = (id) => `imed_ws_rasc:${id}`;

const ABAS = [
  ['anamnese', 'Anamnese'],
  ['exame', 'Exame físico'],
  ['diagnostico', 'Diagnóstico'],
  ['conduta', 'Conduta'],
  ['evolucao', 'Evolução'],
  ['previa', 'Pré-visualização'],
];
const ERROS = {
  forbidden: 'Você não tem acesso ao prontuário desta consulta.',
  sem_login: 'Sua entrada expirou. Entre de novo para continuar.',
  prazo_encerrado: 'O prazo para escrever neste registro acabou (24 horas depois do encerramento). Correções só por adendo, depois de finalizado.',
  ja_finalizado: 'Este registro já foi finalizado. Correções só por adendo.',
  vazio: 'O registro está vazio. Escreva algo antes de finalizar.',
  nao_finalizado: 'Finalize o registro antes de acrescentar um adendo.',
  justificativa: 'A leitura pela equipe exige justificativa.',
};
const CAMPOS = {
  cid_desconhecido: 'Um dos códigos CID-10 não está no catálogo oficial. Escolha da lista.',
  'diagnosticos.principal': 'Só um diagnóstico pode ser o principal.',
};

const S = {
  id: null, gen: 0, pat: null, acesso: null, podeEditar: false, podeAdendo: false,
  evo: null, adendos: [], c: W.vazio(), versao: 0, salvoEm: 0, sujo: false, salvando: null, mudou: 0,
  timer: 0, tick: 0, offline: false, conflito: null, aba: 'anamnese', eventos: [], filtro: 'tudo', faltou: false,
  cid: { timer: 0, itens: [], ativo: -1, q: '', seq: 0 }, medOrigem: null,
};

let ligado = false;
function ligarUmaVez() {
  if (ligado) return;
  ligado = true;
  iniciarLayout();
  $('#wsRegBox').addEventListener('input', onInput);
  $('#wsRegBox').addEventListener('change', onChange);
  $('#wsRegBox').addEventListener('click', onClick);
  $('#wsRegBox').addEventListener('keydown', onKey);
  $('#wsFiltros').addEventListener('click', (e) => { const b = e.target.closest('[data-ws-filtro]'); if (b) { S.filtro = b.dataset.wsFiltro; renderTempo(); } });
  $('#wsTempo').addEventListener('click', onTempoClick);
  // Encerrar a consulta com o prontuário ainda não finalizado: avisa (o rascunho fica salvo e dá para finalizar depois).
  $('#cEnd')?.addEventListener('click', avisoEncerrar);
  addEventListener('beforeunload', (e) => { if (S.id && S.sujo) { salvar(); e.preventDefault(); e.returnValue = ''; } });
  addEventListener('online', () => { if (S.sujo) salvar(); });
}

/* ======================= abrir e fechar ======================= */
export async function abrir({ id, patient }) {
  ligarUmaVez();
  if (S.id && S.id !== id) fechar();
  const gen = ++S.gen;
  Object.assign(S, { id, pat: patient || null, acesso: null, podeEditar: false, podeAdendo: false, evo: null, adendos: [], c: W.vazio(),
    versao: 0, salvoEm: 0, sujo: false, salvando: null, offline: false, conflito: null, aba: 'anamnese', eventos: [], filtro: 'tudo', faltou: false });
  novaConsulta();
  status('');
  $('#wsRegBox').innerHTML = '<p class="tl-load"><span class="spin" aria-hidden="true"></span>Carregando o prontuário…</p>';
  $('#wsTempo').innerHTML = '';
  $('#wsFiltros').innerHTML = '';
  $('#wsTempoNota').textContent = '';
  clearInterval(S.tick);
  S.tick = setInterval(() => { if (S.sujo && !S.salvando) salvar(); else pintarStatus(); }, REPETIR_MS);
  const r = await chamar('ws_registro_abrir', { p_consulta: id });
  if (gen !== S.gen) return;
  if (r.falha) { semProntuario(r); return; }
  aplicarAbertura(r.dados);
  carregarTempo();
}

export function fechar() {
  if (S.sujo && S.id) salvar();
  S.gen += 1;
  clearTimeout(S.timer); clearInterval(S.tick);
  S.id = null;
  $('#wsEndNote') && ($('#wsEndNote').hidden = true);
}

function aplicarAbertura(d) {
  S.acesso = d.acesso;
  S.podeEditar = !!d.pode_editar;
  S.podeAdendo = !!d.pode_adendo;
  S.evo = d.evolucao || null;
  S.adendos = Array.isArray(d.adendos) ? d.adendos : [];
  S.versao = S.evo ? Number(S.evo.versao) || 0 : 0;
  S.salvoEm = S.evo?.salvo_em ? Date.parse(S.evo.salvo_em) : 0;
  S.c = W.normalizar(S.evo?.conteudo);
  if (S.podeEditar && (!S.evo || S.evo.situacao === 'rascunho')) {
    // O que este aparelho escreveu e ainda não tinha chegado ao banco (mesma versão): volta para a tela.
    const b = lerRascunho();
    if (b && b.versao === S.versao && JSON.stringify(W.paraSalvar(b.c)) !== JSON.stringify(W.paraSalvar(S.c))) {
      S.c = W.normalizar(b.c);
      S.sujo = true;
      S.faltou = true;
    }
  }
  render();
  if (S.sujo) agendar();
}

function semProntuario(r) {
  const naoTem = r.status === 404 || r.codigo === 'PGRST202';
  const msg = naoTem ? 'O prontuário ainda não está disponível. O registro da consulta continua no campo “Registro da consulta”.'
    : ERROS[r.codigo] || 'Não foi possível abrir o prontuário agora. Tente de novo em instantes.';
  $('#wsRegBox').innerHTML = `<p class="tl-msg warn">${esc(msg)}</p>${naoTem || r.codigo === 'forbidden' ? '' : '<div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-ws="reabrir">Tentar de novo</button></div>'}`;
  status('');
}

/* ======================= banco ======================= */
// Chamada às funções do prontuário. Erro do banco vem como {erro: ...} (sem exceção, para a trilha guardar o negado).
async function chamar(fn, args) {
  try {
    const dados = await A.rpc(fn, args);
    if (dados && typeof dados === 'object' && dados.erro) return { falha: true, codigo: dados.erro, campo: dados.campo, dados };
    return { dados };
  } catch (err) {
    const rede = !err?.status;
    return { falha: true, rede, status: err?.status, codigo: err?.data?.code || (rede ? 'rede' : 'erro') };
  }
}

/* ======================= salvar ======================= */
function lerRascunho() { try { return JSON.parse(sessionStorage.getItem(RASC(S.id)) || 'null'); } catch { return null; } }
function guardarRascunho() { try { sessionStorage.setItem(RASC(S.id), JSON.stringify({ versao: S.versao, c: S.c, em: Date.now() })); } catch { /* sem armazenamento */ } }
function esquecerRascunho(id = S.id) { try { sessionStorage.removeItem(RASC(id)); } catch { /* sem armazenamento */ } }

function mudou() {
  S.sujo = true;
  S.mudou += 1;
  guardarRascunho();
  pintarStatus();
  agendar();
}
function agendar() { clearTimeout(S.timer); S.timer = setTimeout(() => salvar(), SALVAR_MS); }

async function salvar() {
  if (!S.id || !S.podeEditar || S.conflito || (S.evo && S.evo.situacao !== 'rascunho')) return false;
  if (S.salvando) return S.salvando;
  clearTimeout(S.timer);
  const id = S.id;
  const gen = S.gen;
  const marca = S.mudou;
  const corpo = W.paraSalvar(S.c);
  const erro = W.conteudoErro(corpo);
  if (erro) { status(textoCampo(erro), 'err'); return false; }
  status('Salvando…');
  S.salvando = (async () => {
    const r = await chamar('ws_registro_salvar', { p_consulta: id, p_conteudo: corpo, p_versao: S.versao });
    if (gen !== S.gen) return !r.falha;
    if (!r.falha) {
      S.versao = Number(r.dados.versao) || S.versao;
      S.salvoEm = Date.now();
      S.offline = false;
      if (!S.evo) S.evo = { id: r.dados.id, situacao: 'rascunho', versao: S.versao };
      if (S.mudou === marca) { S.sujo = false; esquecerRascunho(id); } else { guardarRascunho(); agendar(); }
      pintarStatus();
      return true;
    }
    if (r.codigo === 'versao_conflito') { mostrarConflito(r.dados); return false; }
    if (r.rede) { S.offline = true; pintarStatus(); return false; }
    if (r.codigo === 'prazo_encerrado' || r.codigo === 'ja_finalizado' || r.codigo === 'forbidden') {
      S.podeEditar = false;
      status(ERROS[r.codigo], 'err');
      reabrir();
      return false;
    }
    status(r.codigo === 'dados_invalidos' ? textoCampo(r.campo) : 'Não foi possível salvar agora. Vamos tentar de novo.', 'err');
    return false;
  })();
  try { return await S.salvando; } finally { S.salvando = null; }
}

function textoCampo(campo) {
  if (CAMPOS[campo]) return CAMPOS[campo];
  const m = String(campo || '').match(/^medida\.(\d+)/);
  if (m) return `Confira o sinal vital nº ${m[1]} (valor, origem ou hora).`;
  const d = String(campo || '').match(/^diagnostico\.(\d+)/);
  if (d) return `Confira o diagnóstico nº ${d[1]}.`;
  return 'Há um campo que o banco recusou. Confira o que foi escrito.';
}

function status(t, cls = '') { const el = $('#wsSalvo'); if (!el) return; el.textContent = t; el.className = `ws-salvo${cls ? ` ${cls}` : ''}`; }
function pintarStatus() {
  if (!S.id) return;
  if (S.evo && S.evo.situacao === 'finalizada') { status(`Finalizado em ${T.fmtDateTime(S.evo.finalizada_em)}`, 'ok'); return; }
  if (S.evo && S.evo.situacao === 'encerrada_sem_finalizar') { status('Encerrado sem finalizar (prazo de 24 horas)', 'warn'); return; }
  if (!S.podeEditar) { status('Somente leitura'); return; }
  if (S.conflito) { status('Conflito: salvo em outra aba ou aparelho', 'err'); return; }
  if (S.offline) { status('Sem conexão: guardado neste aparelho, tentando de novo', 'warn'); return; }
  if (S.salvando) { status('Salvando…'); return; }
  if (S.sujo) { status('Alterações ainda não salvas'); return; }
  if (S.salvoEm) { status(`Rascunho salvo ${W.haQuanto(S.salvoEm)}`, 'ok'); return; }
  status('Rascunho: começa a ser salvo quando você escrever');
}

function mostrarConflito(d) {
  S.conflito = d || {};
  pintarStatus();
  const box = $('#wsConflito');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<p><b>Este registro foi salvo em outra aba ou aparelho</b>${d?.salvo_em ? ` (${esc(T.fmtDateTime(d.salvo_em))})` : ''}. O que você quer fazer?</p>
    <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-ws="conflito-usar">Usar o que está salvo</button><button class="btn btn-coral btn-sm" type="button" data-ws="conflito-manter">Manter o que está nesta tela</button></div>`;
  box.querySelector('button')?.focus();
}
function resolverConflito(manter) {
  const d = S.conflito || {};
  S.conflito = null;
  $('#wsConflito').hidden = true;
  S.versao = Number(d.versao) || 0;
  if (manter) { mudou(); salvar(); return; }
  S.c = W.normalizar(d.conteudo);
  S.sujo = false;
  esquecerRascunho();
  render();
  pintarStatus();
}

async function reabrir() {
  if (!S.id) return;
  const gen = S.gen;
  const r = await chamar('ws_registro_abrir', { p_consulta: S.id });
  if (gen !== S.gen) return;
  if (r.falha) { semProntuario(r); return; }
  const sujo = S.sujo;
  const c = S.c;
  aplicarAbertura(r.dados);
  if (sujo && S.podeEditar && S.evo?.situacao !== 'finalizada') { S.c = c; render(); mudou(); }
  carregarTempo();
}

/* ======================= tela ======================= */
function render() {
  const box = $('#wsRegBox');
  if (!box) return;
  const fim = S.evo && S.evo.situacao !== 'rascunho';
  if (fim || !S.podeEditar) { box.innerHTML = vistaFechada(); pintarStatus(); return; }
  box.innerHTML = `${S.faltou ? '<p class="ws-alerta" role="status">Recuperamos o que você escreveu neste aparelho e ainda não tinha sido salvo. Ele será salvo agora.</p>' : ''}
    <div class="ws-alerta" id="wsConflito" role="alert" hidden></div>
    <div class="md-dtabs" role="tablist" aria-label="Partes do registro" id="wsAbasReg">${ABAS.map(([k, t]) => `<button type="button" role="tab" class="md-dtab" id="wsTab-${k}" aria-controls="wsP-${k}" aria-selected="${k === S.aba}" tabindex="${k === S.aba ? 0 : -1}" data-ws-tab="${k}">${t}</button>`).join('')}</div>
    ${ABAS.map(([k]) => `<div class="ws-painel" role="tabpanel" id="wsP-${k}" aria-labelledby="wsTab-${k}" tabindex="0"${k === S.aba ? '' : ' hidden'}>${painel(k)}</div>`).join('')}
    <div class="tl-row"><button class="btn btn-coral" type="button" data-ws="finalizar"><i class="fa-solid fa-lock" aria-hidden="true"></i>Finalizar registro</button></div>
    <div class="tl-confirm" id="wsFinConfirm" role="group" aria-labelledby="wsFinQ" hidden></div>
    <p class="tl-msg" id="wsMsg" role="status"></p>`;
  S.faltou = false;
  pintarStatus();
}

const campo = (k, rotulo, valor, { linhas = 3, max = W.TEXTO_MAX, dica = '' } = {}) => {
  const id = `wsF-${k.replace(/\./g, '-')}`;
  return `<div class="fld"><label for="${id}">${esc(rotulo)}${dica ? ` <small class="h">${esc(dica)}</small>` : ''}</label><textarea id="${id}" rows="${linhas}" maxlength="${max}" data-k="${esc(k)}">${esc(valor || '')}</textarea></div>`;
};

function painel(k) {
  const c = S.c;
  if (k === 'anamnese') {
    return `<div class="ws-grade dois">${W.ANAMNESE.map(([key, t]) => campo(`anamnese.${key}`, t, c.anamnese[key], { linhas: key === 'hda' ? 5 : 3 })).join('')}</div>
      <p class="ws-nota">Medicamentos e alergias aqui são o que o paciente relatou nesta consulta (texto livre).</p>`;
  }
  if (k === 'exame') return painelExame();
  if (k === 'diagnostico') return painelDiag();
  if (k === 'conduta') {
    return `${campo('conduta', 'Conduta e orientações', c.conduta, { linhas: 6, max: W.LIVRE_MAX })}
      <p class="ws-nota">Receita, pedido de exames e outros documentos ficam em “Documentos”. Aqui fica o que você decidiu e orientou.</p>`;
  }
  if (k === 'evolucao') return painelEvolucao();
  return `<div id="wsPrevia">${vista(W.paraSalvar(c), null)}</div>
    <p class="ws-nota">É assim que o registro fica ao finalizar. Registro não assinado digitalmente.</p>`;
}

function painelExame() {
  const c = S.c;
  const meds = c.exame.medidas;
  const tipo = $('#wsMedTipo')?.value || '';
  const imc = W.imc(meds, idade());
  return `${campo('exame.geral', 'O que você observou no vídeo (exame físico)', c.exame.geral, { linhas: 4, dica: '(texto)' })}
    <h4>Sinais vitais</h4>
    <p class="tl-small">Registre só o que foi medido, com a origem de cada número. Sinal não aferido: não registre. Nada é preenchido sozinho.</p>
    <ul class="ws-meds" id="wsMeds">${meds.length ? meds.map((m, i) => medHtml(m, i)).join('') : '<li class="tl-small">Nenhum sinal vital registrado.</li>'}</ul>
    ${imc ? `<p class="ws-imc" id="wsImc"><b>${esc(imc.texto)}</b>${imc.classificacao ? ` (${esc(imc.classificacao)})` : ''} · calculado na tela, não é gravado como medida. ${esc(imc.origem)}${imc.aviso ? ` <b>${esc(imc.aviso)}</b>` : ''}</p>` : ''}
    <fieldset class="ws-medform" id="wsMedForm">
      <legend>Adicionar sinal vital</legend>
      <div class="ws-grade dois">
        <div class="fld"><label for="wsMedTipo">Sinal vital</label><select id="wsMedTipo"><option value="">Escolha</option>${Object.entries(W.MEDIDAS).map(([t, d]) => `<option value="${t}"${t === tipo ? ' selected' : ''}>${esc(d.rotulo)} (${esc(d.unidade)})</option>`).join('')}</select></div>
        <div class="fld"><label for="wsMedValor">Valor medido</label><input id="wsMedValor" inputmode="decimal" autocomplete="off" maxlength="8" aria-describedby="wsMedErr"></div>
        <div class="fld"><label for="wsMedOrigem">Origem do número</label><select id="wsMedOrigem">${origemOpts(tipo)}</select></div>
        <div class="fld" id="wsMedHoraF" hidden><label for="wsMedHora">Hora da medida</label><input id="wsMedHora" type="time"></div>
        <div class="fld"><label for="wsMedAparelho">Aparelho <small class="h">(opcional)</small></label><input id="wsMedAparelho" maxlength="80" autocomplete="off"></div>
      </div>
      <p class="tl-msg err" id="wsMedErr" role="alert"></p>
      <button class="btn btn-ghost btn-sm" type="button" data-ws="med-add"><i class="fa-solid fa-plus" aria-hidden="true"></i>Adicionar</button>
    </fieldset>`;
}
const origemOpts = (tipo) => `<option value="">Escolha quem mediu e como</option>${(tipo ? W.origensPara(tipo) : W.ORIGENS).map((o) => `<option value="${o.id}">${esc(o.rotulo)}</option>`).join('')}`;
function medHtml(m, i) {
  const d = W.MEDIDAS[m.tipo] || { rotulo: m.tipo, unidade: m.unidade || '' };
  const hora = m.medido_em ? ` às ${T.fmtTime(m.medido_em)}` : '';
  return `<li class="ws-med"><span><b>${esc(d.rotulo)}: ${esc(W.fmtNum(m.valor))} ${esc(m.unidade || d.unidade)}</b> <span class="ws-origem">${esc(W.origemTexto(m))}${esc(hora)}</span></span>${S.podeEditar && !S.evo?.finalizada_em ? `<button class="btn btn-ghost btn-sm" type="button" data-ws-med-del="${i}" aria-label="Remover ${esc(d.rotulo)} ${esc(W.fmtNum(m.valor))}">Remover</button>` : ''}</li>`;
}
function idade() {
  const p = S.pat || {};
  return p.age_years ?? T.ageOn(p.patient_birthdate, T.todaySP());
}

function painelDiag() {
  const ds = S.c.diagnosticos;
  return `<p class="ws-nota">O IMED não sugere diagnóstico: busque e escolha o código, ou registre só a descrição. CID-10: catálogo oficial do DATASUS (OMS; tradução CBCD/FSP-USP).</p>
    <div class="fld ws-cid"><label for="wsCidQ">Buscar na CID-10 (código ou palavras)</label>
      <input id="wsCidQ" type="search" autocomplete="off" maxlength="80" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wsCidLista" aria-describedby="wsCidInfo" placeholder="Ex.: J06.9 ou faringite">
      <small class="h" id="wsCidInfo" aria-live="polite"></small>
      <ul class="ws-cidlista" id="wsCidLista" role="listbox" aria-label="Códigos da CID-10"></ul>
    </div>
    <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-ws="diag-livre"><i class="fa-solid fa-plus" aria-hidden="true"></i>Registrar sem código (só a descrição)</button></div>
    <h4>Hipóteses e diagnósticos (${ds.length})</h4>
    <ol class="ws-diags" id="wsDiags">${ds.length ? ds.map(diagHtml).join('') : '<li class="tl-small">Nenhum ainda.</li>'}</ol>`;
}
function diagHtml(d, i) {
  const sel = (nome, lista, v) => `<select id="wsD${nome}${i}" data-ws-diag="${i}" data-campo="${nome}">${lista.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  return `<li class="ws-diag">
    <p>${d.cid ? `<b>${esc(W.cidFmt(d.cid))}</b> ` : '<b>Sem código</b> '}${esc(d.descricao)}</p>
    ${d._sexo ? `<p class="tl-small">${esc(W.avisoSexo(d._sexo))}</p>` : ''}
    <div class="ws-grade">
      <div class="fld"><label for="wsDdesc${i}">Descrição</label><input id="wsDdesc${i}" maxlength="300" value="${esc(d.descricao)}" data-ws-diag="${i}" data-campo="descricao"></div>
      <div class="fld"><label for="wsDpapel${i}">Papel</label>${sel('papel', W.PAPEIS, d.papel)}</div>
      <div class="fld"><label for="wsDsituacao${i}">Situação</label>${sel('situacao', W.SITUACOES, d.situacao)}</div>
    </div>
    <button class="btn btn-ghost btn-sm" type="button" data-ws-diag-del="${i}">Remover</button></li>`;
}

function painelEvolucao() {
  const c = S.c;
  const livre = c.modo === 'livre';
  return `<fieldset class="ws-modo"><legend>Formato da evolução</legend>
      <label><input type="radio" name="wsModo" value="soap"${livre ? '' : ' checked'}>SOAP</label>
      <label><input type="radio" name="wsModo" value="livre"${livre ? ' checked' : ''}>Texto livre</label>
    </fieldset>
    <p class="tl-small">Trocar o formato não apaga nada: o outro formato continua guardado e aparece na pré-visualização se tiver algo diferente.</p>
    ${livre ? campo('livre', 'Evolução (texto livre)', c.livre, { linhas: 10, max: W.LIVRE_MAX })
      : `<div class="ws-grade dois">${W.SOAP.map(([k, t]) => campo(`soap.${k}`, t, c.soap[k], { linhas: 4 })).join('')}</div>`}
    ${c.nao_classificado.trim() ? campo('nao_classificado', 'Texto não classificado (veio do texto livre, sem rótulo S, O, A ou P)', c.nao_classificado, { linhas: 3, max: W.LIVRE_MAX }) : ''}`;
}

// Registro em leitura (pré-visualização, finalizado, versão antiga). c = conteúdo como o banco guarda; filhas = medidas e
// diagnósticos gravados (finalizado) ou null (usa os do conteúdo).
function vista(c, filhas) {
  const n = W.normalizar(c);
  const meds = filhas ? filhas.medidas : n.exame.medidas;
  const ds = filhas ? filhas.diagnosticos : n.diagnosticos;
  const bloco = (t, v) => (String(v || '').trim() ? `<h4>${esc(t)}</h4><p class="tl-pre">${esc(v)}</p>` : '');
  const partes = [];
  partes.push(W.ANAMNESE.map(([k, t]) => bloco(t, n.anamnese[k])).join(''));
  partes.push(bloco('Exame físico (observado no vídeo)', n.exame.geral));
  if (meds.length) partes.push(`<h4>Sinais vitais</h4><ul>${meds.map((m) => `<li>${esc(W.MEDIDAS[m.tipo]?.rotulo || m.tipo)}: ${esc(W.fmtNum(m.valor))} ${esc(m.unidade || W.MEDIDAS[m.tipo]?.unidade || '')}. ${esc(W.origemTexto(m))}${m.medido_em ? `, às ${esc(T.fmtTime(m.medido_em))}` : ''}</li>`).join('')}</ul>`);
  if (ds.length) partes.push(`<h4>Hipóteses e diagnósticos</h4><ul>${ds.map((d) => `<li>${d.cid ? `${esc(W.cidFmt(d.cid))} ` : ''}${esc(d.descricao)} (${esc(rot(W.PAPEIS, d.papel))}, ${esc(rot(W.SITUACOES, d.situacao).toLowerCase())})</li>`).join('')}</ul>`);
  partes.push(bloco('Conduta e orientações', n.conduta));
  if (n.modo === 'livre') partes.push(bloco('Evolução', n.livre));
  else partes.push(W.SOAP.map(([k, t]) => bloco(t, n.soap[k])).join(''));
  if (W.outroFormatoDiferente(n)) {
    partes.push(n.modo === 'livre' ? `<h4>Também registrado em SOAP</h4>${W.SOAP.map(([k, t]) => bloco(t, n.soap[k])).join('')}` : bloco('Também registrado em texto livre', n.livre));
  }
  partes.push(bloco('Texto não classificado', n.nao_classificado));
  const html = partes.join('');
  return `<div class="ws-prev">${html || '<p class="tl-muted">Nada escrito ainda.</p>'}</div>`;
}
const rot = (lista, k) => lista.find(([x]) => x === k)?.[1] || k || '';

function vistaFechada() {
  const e = S.evo;
  let topo = '';
  if (!e) topo = `<p class="tl-msg warn">${S.acesso === 'reader' ? 'Sem registro estruturado nesta consulta.' : 'O prazo para escrever neste registro acabou e ele não foi iniciado.'}</p>`;
  else if (e.situacao === 'finalizada') {
    topo = `<p class="ws-fim"><i class="fa-solid fa-lock" aria-hidden="true"></i> Registro finalizado em ${esc(T.fmtDateTime(e.finalizada_em))}${e.medico?.nome ? ` por ${esc(e.medico.nome)}` : ''}. Não pode ser mudado: correções só por adendo. Registro não assinado digitalmente.</p>`;
  } else if (e.situacao === 'encerrada_sem_finalizar') {
    topo = `<p class="ws-alerta">Rascunho encerrado sem finalizar em ${esc(T.fmtDateTime(e.encerrada_em))} (prazo de 24 horas). Ficou guardado como estava.</p>`;
  } else topo = '<p class="ws-alerta">Rascunho em leitura (sem permissão para escrever agora).</p>';
  const filhas = e && e.situacao !== 'rascunho' ? { medidas: e.medidas || [], diagnosticos: e.diagnosticos || [] } : null;
  const corpo = e ? vista(e.conteudo, filhas) : '';
  const hash = e?.hash ? `<p class="ws-hash tl-small">Código de integridade (SHA-256): ${esc(e.hash)}</p>` : '';
  const ads = S.adendos.length ? `<h4>Adendos (${S.adendos.length})</h4><ol class="ws-adendos">${S.adendos.map((a) => `<li class="ws-adendo"><p class="tl-small"><b>${esc(T.fmtDateTime(a.finalizada_em))}</b>${a.medico?.nome ? ` · ${esc(a.medico.nome)}` : ''}</p><p class="tl-pre">${esc(a.texto)}</p></li>`).join('')}</ol>` : '';
  const form = S.podeAdendo ? `<div class="fld"><label for="wsAdendo">Novo adendo</label><textarea id="wsAdendo" rows="3" maxlength="8000" aria-describedby="wsAdendoH"></textarea><small class="h" id="wsAdendoH">Entra com a data e a hora de agora e o seu nome. O registro original não muda.</small></div>
    <div class="tl-row"><button class="btn btn-primary btn-sm" type="button" data-ws="adendo">Acrescentar adendo</button></div>
    <div class="tl-confirm" id="wsAdConfirm" role="group" aria-labelledby="wsAdQ" hidden><p id="wsAdQ">Acrescentar este adendo? Depois de salvo, ele não pode ser mudado.</p><div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-ws="adendo-sim">Sim, acrescentar</button><button class="btn btn-ghost btn-sm" type="button" data-ws="adendo-nao">Voltar</button></div></div>` : '';
  return `${topo}${corpo}${hash}${ads}${form}<p class="tl-msg" id="wsMsg" role="status"></p>`;
}

function msg(t, cls = '') { const m = $('#wsMsg'); if (m) { m.textContent = t; m.className = `tl-msg${cls ? ` ${cls}` : ''}`; } }

function trocarAba(k, foco = false) {
  S.aba = k;
  for (const [x] of ABAS) {
    const tab = $(`#wsTab-${x}`);
    const p = $(`#wsP-${x}`);
    if (!tab || !p) continue;
    tab.setAttribute('aria-selected', String(x === k));
    tab.tabIndex = x === k ? 0 : -1;
    p.hidden = x !== k;
  }
  if (k === 'previa') $('#wsP-previa').innerHTML = painel('previa');
  if (foco) $(`#wsTab-${k}`)?.focus();
}
function repintar(k) { const p = $(`#wsP-${k}`); if (p) p.innerHTML = painel(k); }

/* ======================= eventos ======================= */
function setPath(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[ks.at(-1)] = v;
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.k && S.podeEditar) { setPath(S.c, t.dataset.k, t.value); mudou(); return; }
  if (t.id === 'wsCidQ') { buscarCid(t.value); return; }
  if (t.dataset.wsDiag != null && t.dataset.campo === 'descricao') {
    const d = S.c.diagnosticos[Number(t.dataset.wsDiag)];
    if (d) { d.descricao = t.value; mudou(); }
  }
}
function onChange(e) {
  const t = e.target;
  if (t.name === 'wsModo') {
    S.c = W.alternarModo(S.c, t.value);
    repintar('evolucao');
    $(`#wsP-evolucao input[value="${t.value}"]`)?.focus();
    mudou();
    return;
  }
  if (t.id === 'wsMedTipo') {
    const atual = $('#wsMedOrigem').value;
    $('#wsMedOrigem').innerHTML = origemOpts(t.value);
    if ([...$('#wsMedOrigem').options].some((o) => o.value === atual)) $('#wsMedOrigem').value = atual;
    return;
  }
  if (t.id === 'wsMedOrigem') { $('#wsMedHoraF').hidden = !W.ORIGENS.find((o) => o.id === t.value)?.hora; return; }
  if (t.dataset.wsDiag != null && (t.dataset.campo === 'papel' || t.dataset.campo === 'situacao')) {
    const d = S.c.diagnosticos[Number(t.dataset.wsDiag)];
    if (d) { d[t.dataset.campo] = t.value; mudou(); }
  }
}
function onClick(e) {
  const tab = e.target.closest('[data-ws-tab]');
  if (tab) { trocarAba(tab.dataset.wsTab); return; }
  const op = e.target.closest('[data-cid-i]');
  if (op) { escolherCid(Number(op.dataset.cidI)); return; }
  const md = e.target.closest('[data-ws-med-del]');
  if (md) { S.c.exame.medidas.splice(Number(md.dataset.wsMedDel), 1); repintar('exame'); mudou(); $('#wsMedTipo')?.focus(); return; }
  const dd = e.target.closest('[data-ws-diag-del]');
  if (dd) { S.c.diagnosticos.splice(Number(dd.dataset.wsDiagDel), 1); repintar('diagnostico'); mudou(); $('#wsCidQ')?.focus(); return; }
  const b = e.target.closest('[data-ws]');
  if (!b) return;
  const a = b.dataset.ws;
  if (a === 'med-add') addMedida();
  else if (a === 'diag-livre') addDiagLivre();
  else if (a === 'finalizar') pedirFinalizar();
  else if (a === 'fin-sim') finalizar(b);
  else if (a === 'fin-nao') { $('#wsFinConfirm').hidden = true; $('[data-ws="finalizar"]')?.focus(); }
  else if (a === 'conflito-usar') resolverConflito(false);
  else if (a === 'conflito-manter') resolverConflito(true);
  else if (a === 'adendo') pedirAdendo();
  else if (a === 'adendo-sim') criarAdendo(b);
  else if (a === 'adendo-nao') { $('#wsAdConfirm').hidden = true; $('[data-ws="adendo"]')?.focus(); }
  else if (a === 'reabrir') { if (S.id) abrir({ id: S.id, patient: S.pat }); }
}
function onKey(e) {
  if (e.target.closest('#wsAbasReg') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const i = ABAS.findIndex(([k]) => k === S.aba);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? ABAS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ABAS.length) % ABAS.length;
    e.preventDefault();
    trocarAba(ABAS[n][0], true);
    return;
  }
  if (e.target.id === 'wsCidQ') {
    const n = S.cid.itens.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); marcarCid((S.cid.ativo + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); marcarCid((S.cid.ativo - 1 + n) % n); }
    else if (e.key === 'Enter' && S.cid.ativo >= 0) { e.preventDefault(); escolherCid(S.cid.ativo); }
    else if (e.key === 'Escape') { fecharCid(); }
  }
}

/* ---------- sinais vitais ---------- */
function addMedida() {
  const tipo = $('#wsMedTipo').value;
  const o = W.ORIGENS.find((x) => x.id === $('#wsMedOrigem').value);
  const valor = W.numero($('#wsMedValor').value);
  const m = { tipo, valor: valor ?? NaN, quem_mediu: o?.quem_mediu, como_obtido: o?.como_obtido };
  const ap = $('#wsMedAparelho').value.trim();
  if (ap) m.aparelho = ap;
  if (o?.hora && $('#wsMedHora').value) {
    const [h, mi] = $('#wsMedHora').value.split(':').map(Number);
    const d = new Date(); d.setHours(h, mi, 0, 0);
    m.medido_em = d.toISOString();
  }
  const erro = W.medidaErro(m);
  const out = $('#wsMedErr');
  if (erro) { out.textContent = erro; $(!tipo ? '#wsMedTipo' : valor == null ? '#wsMedValor' : '#wsMedOrigem')?.focus(); return; }
  if (S.c.exame.medidas.length >= W.MEDIDAS_MAX) { out.textContent = `Até ${W.MEDIDAS_MAX} sinais vitais.`; return; }
  S.c.exame.medidas.push(m);
  repintar('exame');
  mudou();
  $('#wsMedTipo')?.focus();
}

/* ---------- CID-10 ---------- */
function buscarCid(q) {
  clearTimeout(S.cid.timer);
  const v = q.trim();
  S.cid.q = v;
  if (v.length < 2) { fecharCid(); $('#wsCidInfo').textContent = ''; return; }
  S.cid.timer = setTimeout(async () => {
    const seq = ++S.cid.seq;
    $('#wsCidInfo').textContent = 'Buscando…';
    const r = await chamar('cat_cid_buscar', { p_q: v });
    if (seq !== S.cid.seq || !$('#wsCidQ')) return;
    if (r.falha) { fecharCid(); $('#wsCidInfo').textContent = r.status === 404 ? 'A busca da CID-10 ainda não está disponível.' : 'Não foi possível buscar agora.'; return; }
    S.cid.itens = Array.isArray(r.dados.itens) ? r.dados.itens : [];
    S.cid.ativo = -1;
    $('#wsCidLista').innerHTML = S.cid.itens.map((it, i) => `<li class="ws-cidop" role="option" id="wsCidOp${i}" aria-selected="false" data-cid-i="${i}"><b>${esc(W.cidFmt(it.codigo))}</b>${esc(it.descricao)}</li>`).join('');
    $('#wsCidQ').setAttribute('aria-expanded', String(S.cid.itens.length > 0));
    $('#wsCidQ').removeAttribute('aria-activedescendant');
    $('#wsCidInfo').textContent = S.cid.itens.length ? `${S.cid.itens.length} código${S.cid.itens.length > 1 ? 's' : ''}. Use as setas e Enter, ou toque.`
      : 'Nenhum código encontrado. Você pode registrar só a descrição.';
  }, 250);
}
function marcarCid(i) {
  S.cid.ativo = i;
  $$('#wsCidLista [role="option"]').forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
  $('#wsCidQ').setAttribute('aria-activedescendant', `wsCidOp${i}`);
  $(`#wsCidOp${i}`)?.scrollIntoView({ block: 'nearest' });
}
function fecharCid() {
  S.cid.itens = []; S.cid.ativo = -1;
  if ($('#wsCidLista')) $('#wsCidLista').innerHTML = '';
  $('#wsCidQ')?.setAttribute('aria-expanded', 'false');
  $('#wsCidQ')?.removeAttribute('aria-activedescendant');
}
function escolherCid(i) {
  const it = S.cid.itens[i];
  if (!it) return;
  if (S.c.diagnosticos.length >= W.DIAG_MAX) { $('#wsCidInfo').textContent = `Até ${W.DIAG_MAX} diagnósticos.`; return; }
  S.c.diagnosticos.push({ cid: it.codigo, descricao: it.descricao.slice(0, 300), papel: 'hipotese', situacao: 'suspeito', ...(it.restr_sexo ? { _sexo: it.restr_sexo } : {}) });
  repintar('diagnostico');
  mudou();
  $('#wsCidInfo').textContent = `${W.cidFmt(it.codigo)} acrescentado como hipótese. Ajuste o papel e a situação.`;
  $(`#wsDpapel${S.c.diagnosticos.length - 1}`)?.focus();
}
function addDiagLivre() {
  const t = ($('#wsCidQ')?.value || '').trim();
  if (t.length < 2) { $('#wsCidInfo').textContent = 'Escreva a descrição no campo de busca e toque de novo.'; $('#wsCidQ')?.focus(); return; }
  S.c.diagnosticos.push({ cid: null, descricao: t.slice(0, 300), papel: 'hipotese', situacao: 'suspeito' });
  repintar('diagnostico');
  mudou();
  $(`#wsDpapel${S.c.diagnosticos.length - 1}`)?.focus();
}

/* ---------- finalizar e adendo ---------- */
function pedirFinalizar() {
  const box = $('#wsFinConfirm');
  const c = W.paraSalvar(S.c);
  if (W.estaVazio(c)) { msg(ERROS.vazio, 'err'); return; }
  const erro = W.conteudoErro(c);
  if (erro) { msg(textoCampo(erro), 'err'); return; }
  const n = (c.exame?.medidas || []).length;
  const d = (c.diagnosticos || []).length;
  box.innerHTML = `<p id="wsFinQ"><b>Finalizar o registro?</b> Depois disso ele não muda: correções só por adendo, com data e hora. Vão ${n} sinal${n === 1 ? '' : 'is'} vita${n === 1 ? 'l' : 'is'} e ${d} diagnóstico${d === 1 ? '' : 's'}. Registro não assinado digitalmente.</p>
    <div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-ws="fin-sim">Sim, finalizar</button><button class="btn btn-ghost btn-sm" type="button" data-ws="fin-nao">Voltar</button></div>`;
  box.hidden = false;
  box.querySelector('[data-ws="fin-sim"]').focus();
}
async function finalizar(btn) {
  btn.disabled = true;
  try {
    if (S.salvando) await S.salvando;
    if (S.sujo) await salvar();
    if (S.sujo || S.conflito) { msg('Não foi possível salvar o rascunho antes de finalizar. Confira a conexão e tente de novo.', 'err'); return; }
    if (!S.evo) { msg(ERROS.vazio, 'err'); return; }
    const gen = S.gen;
    const r = await chamar('ws_registro_finalizar', { p_consulta: S.id, p_versao: S.versao });
    if (gen !== S.gen) return;
    if (r.falha) {
      if (r.codigo === 'versao_conflito') { $('#wsFinConfirm').hidden = true; mostrarConflito(r.dados); return; }
      msg(r.codigo === 'dados_invalidos' ? textoCampo(r.campo) : ERROS[r.codigo] || (r.rede ? 'Sem conexão. Tente de novo.' : 'Não foi possível finalizar agora.'), 'err');
      return;
    }
    S.evo = r.dados.evolucao;
    S.podeEditar = false;
    S.podeAdendo = true;
    S.sujo = false;
    esquecerRascunho();
    render();
    $('#wsRegTitle')?.focus();
    msg('Registro finalizado.', 'ok');
    carregarTempo();
  } finally { btn.disabled = false; }
}
function pedirAdendo() {
  const t = $('#wsAdendo').value.trim();
  if (t.length < 3) { msg('Escreva o adendo (pelo menos 3 caracteres).', 'err'); $('#wsAdendo').focus(); return; }
  $('#wsAdConfirm').hidden = false;
  $('[data-ws="adendo-sim"]').focus();
}
async function criarAdendo(btn) {
  btn.disabled = true;
  const texto = $('#wsAdendo').value;
  const r = await chamar('ws_adendo_criar', { p_consulta: S.id, p_texto: texto });
  btn.disabled = false;
  if (r.falha) { msg(r.codigo === 'dados_invalidos' ? 'O adendo precisa ter de 3 a 8.000 caracteres.' : ERROS[r.codigo] || 'Não foi possível salvar o adendo agora.', 'err'); return; }
  await reabrir();
  msg('Adendo acrescentado.', 'ok');
}

function avisoEncerrar() {
  const el = $('#wsEndNote');
  if (!el || !S.id) return;
  const aberto = S.podeEditar && (!S.evo || S.evo.situacao === 'rascunho') && !W.estaVazio(S.c);
  el.hidden = !aberto;
  el.textContent = aberto ? 'O prontuário ainda não foi finalizado. O rascunho fica salvo e você pode finalizar em até 24 horas depois do encerramento (em “Suas consultas anteriores”, “Complementar”). Depois disso ele é encerrado sem finalizar.' : '';
  if (aberto && S.sujo) salvar();
}

/* ======================= linha do tempo ======================= */
async function carregarTempo() {
  if (!S.id) return;
  const gen = S.gen;
  const r = await chamar('ws_registro_historico', { p_consulta: S.id });
  if (gen !== S.gen) return;
  if (r.falha) { $('#wsTempo').innerHTML = ''; $('#wsTempoNota').textContent = r.status === 404 ? '' : 'Não foi possível carregar a linha do tempo.'; return; }
  S.eventos = Array.isArray(r.dados.eventos) ? r.dados.eventos : [];
  $('#wsTempoNota').textContent = r.dados.outras_consultas || '';
  renderTempo();
}
function renderTempo() {
  const n = W.contarPorFiltro(S.eventos);
  $('#wsFiltros').innerHTML = W.FILTROS.map(([k, t]) => `<button type="button" class="ws-filtro" data-ws-filtro="${k}" aria-pressed="${k === S.filtro}">${t} (${n[k]})</button>`).join('');
  const lista = W.filtrarEventos(S.eventos, S.filtro);
  $('#wsTempo').innerHTML = lista.length ? lista.map(eventoHtml).join('') : '<li class="tl-small">Nada aqui ainda.</li>';
}
function eventoHtml(ev) {
  const quando = `<time datetime="${esc(ev.em)}">${esc(T.fmtDateTime(ev.em))}</time>`;
  if (ev.tipo === 'versao') {
    return `<li>${quando}Rascunho salvo (versão ${esc(ev.versao)}, ${ev.modo === 'livre' ? 'texto livre' : 'SOAP'})
      <button class="btn btn-ghost btn-sm" type="button" data-ws-versao="${esc(ev.versao)}" aria-expanded="false">Ver esta versão</button><div data-ws-versao-box="${esc(ev.versao)}" hidden></div></li>`;
  }
  if (ev.tipo === 'finalizado') return `<li>${quando}Registro finalizado${ev.medico ? ` por ${esc(ev.medico)}` : ''}.</li>`;
  if (ev.tipo === 'encerrado_sem_finalizar') return `<li>${quando}Rascunho encerrado sem finalizar (prazo de 24 horas).</li>`;
  if (ev.tipo === 'adendo') return `<li>${quando}Adendo${ev.medico ? ` de ${esc(ev.medico)}` : ''}: <span class="tl-pre">${esc(ev.texto)}</span></li>`;
  if (ev.tipo === 'diagnostico') return `<li>${quando}${ev.cid ? `${esc(W.cidFmt(ev.cid))} ` : ''}${esc(ev.descricao)} (${esc(rot(W.PAPEIS, ev.papel))}, ${esc(rot(W.SITUACOES, ev.situacao).toLowerCase())})</li>`;
  if (ev.tipo === 'documento') return `<li>${quando}Documento emitido: ${esc(D.KIND[ev.documento]?.title || ev.documento)}${ev.codigo ? ` (código ${esc(ev.codigo)})` : ''}</li>`;
  return `<li>${quando}${esc(ev.tipo)}</li>`;
}
async function onTempoClick(e) {
  const b = e.target.closest('[data-ws-versao]');
  if (!b) return;
  const v = b.dataset.wsVersao;
  const box = $(`[data-ws-versao-box="${CSS.escape(v)}"]`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; b.setAttribute('aria-expanded', 'false'); b.textContent = 'Ver esta versão'; return; }
  b.disabled = true;
  const r = await chamar('ws_registro_versao', { p_consulta: S.id, p_versao: Number(v) });
  b.disabled = false;
  box.innerHTML = r.falha ? '<p class="tl-small">Não foi possível abrir esta versão.</p>' : vista(r.dados.conteudo, null);
  box.hidden = false;
  b.setAttribute('aria-expanded', 'true');
  b.textContent = 'Esconder esta versão';
}
