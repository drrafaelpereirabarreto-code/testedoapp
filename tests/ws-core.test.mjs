// Testes das regras puras do prontuário (assets/js/ws-core.js) e da coerência com o banco
// (supabase/migrations/*_prontuario.sql): faixas e unidades dos sinais vitais, origem de cada número, SOAP <-> texto
// livre sem perder nada, IMC com origem e sem classificação de adulto para menores de 20 anos, CID-10 e linha do tempo.
// Rodar com: node --test tests/ws-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as W from '../assets/js/ws-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIG = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /_prontuario\.sql$/.test(f));
const SQL = readFileSync(join(ROOT, 'supabase/migrations', MIG.at(-1)), 'utf8');
const AGORA = Date.parse('2026-11-03T15:00:00Z');

test('a migração do prontuário existe (uma só) e tem volta com o mesmo nome', () => {
  assert.equal(MIG.length, 1, MIG.join(', '));
  assert.ok(readdirSync(join(ROOT, 'supabase/volta')).includes(MIG[0]), 'supabase/volta/<mesmo nome>.sql');
});

test('unidades e faixas dos sinais vitais iguais às do banco', () => {
  const unid = Object.fromEntries([...SQL.matchAll(/when '([a-z_0-9]+)' then '([^']+)'/g)].map((m) => [m[1], m[2]]));
  const faixa = Object.fromEntries([...SQL.matchAll(/when '([a-z_0-9]+)' then p_valor between ([\d.]+) and ([\d.]+)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
  assert.deepEqual(Object.keys(faixa).sort(), Object.keys(W.MEDIDAS).sort());
  for (const [t, d] of Object.entries(W.MEDIDAS)) {
    assert.equal(unid[t], d.unidade, `unidade de ${t}`);
    assert.deepEqual(faixa[t], [d.min, d.max], `faixa de ${t}`);
  }
});

test('origens: só as que o banco aceita; contagem pelo médico só para a frequência respiratória', () => {
  for (const o of W.ORIGENS) {
    assert.ok(['paciente', 'acompanhante', 'medico'].includes(o.quem_mediu), o.id);
    assert.ok(['relato', 'estimado', 'aparelho_na_camera', 'contado_pelo_medico_no_video'].includes(o.como_obtido), o.id);
  }
  assert.ok(!W.ORIGENS.some((o) => o.como_obtido === 'integracao' || o.quem_mediu === 'profissional'), 'integração e profissional ainda não existem');
  assert.deepEqual(W.origensPara('fc').map((o) => o.id).includes('medico_video'), false);
  assert.deepEqual(W.origensPara('fr').map((o) => o.id).includes('medico_video'), true);
});

test('medida: nada sem valor, fora da faixa, sem origem ou sem hora quando o aparelho aparece na câmera', () => {
  const ok = { tipo: 'temperatura', valor: 38.2, quem_mediu: 'paciente', como_obtido: 'relato' };
  assert.equal(W.medidaErro(ok, AGORA), null);
  assert.match(W.medidaErro({ ...ok, valor: NaN }, AGORA), /não aferido: não registre/);
  assert.match(W.medidaErro({ ...ok, valor: 50 }, AGORA), /fora do esperado/);
  assert.match(W.medidaErro({ ...ok, quem_mediu: undefined }, AGORA), /origem/);
  assert.match(W.medidaErro({ tipo: 'fc', valor: 80, quem_mediu: 'medico', como_obtido: 'contado_pelo_medico_no_video' }, AGORA), /só consegue contar a frequência respiratória/);
  assert.equal(W.medidaErro({ tipo: 'fr', valor: 18, quem_mediu: 'medico', como_obtido: 'contado_pelo_medico_no_video' }, AGORA), null);
  const cam = { tipo: 'spo2', valor: 97, quem_mediu: 'paciente', como_obtido: 'aparelho_na_camera' };
  assert.match(W.medidaErro(cam, AGORA), /hora da medida/);
  assert.equal(W.medidaErro({ ...cam, medido_em: '2026-11-03T14:50:00Z' }, AGORA), null);
  assert.match(W.medidaErro({ ...cam, medido_em: '2026-11-03T16:00:00Z' }, AGORA), /inválida/);
  assert.equal(W.numero('38,5'), 38.5);
  assert.equal(W.numero(''), null);
  assert.equal(W.numero('abc'), null);
});

test('paraSalvar: só o que foi escrito (nenhum campo inventado) e chaves que o banco conhece', () => {
  assert.deepEqual(W.paraSalvar(W.vazio()), { modo: 'soap' });
  const c = W.normalizar({ anamnese: { queixa: 'Tosse', hda: '  ' }, exame: { medidas: [{ tipo: 'fc', valor: '88', quem_mediu: 'paciente', como_obtido: 'relato', aparelho: ' ' }] },
    diagnosticos: [{ cid: 'J069', descricao: ' IVAS ', papel: 'hipotese', situacao: 'suspeito', _sexo: 'M' }] });
  assert.deepEqual(W.paraSalvar(c), {
    modo: 'soap', anamnese: { queixa: 'Tosse' },
    exame: { medidas: [{ tipo: 'fc', valor: 88, quem_mediu: 'paciente', como_obtido: 'relato' }] },
    diagnosticos: [{ cid: 'J069', descricao: 'IVAS', papel: 'hipotese', situacao: 'suspeito' }],
  });
  const chaves = SQL.match(/if k not in \('modo', 'anamnese'[^)]+\)/)[0];
  for (const k of Object.keys(W.vazio())) assert.ok(chaves.includes(`'${k === 'exame' ? 'exame' : k}'`), k);
  for (const [k] of W.ANAMNESE) assert.ok(SQL.includes(`'${k}'`), `anamnese.${k} no banco`);
});

test('conteudoErro: mesmo critério do banco (um principal só, CID no formato, descrição)', () => {
  const base = { diagnosticos: [{ cid: 'J069', descricao: 'IVAS', papel: 'principal', situacao: 'suspeito' }] };
  assert.equal(W.conteudoErro(base), null);
  assert.equal(W.conteudoErro({ diagnosticos: [...base.diagnosticos, { cid: null, descricao: 'Outra', papel: 'principal', situacao: 'confirmado' }] }), 'diagnosticos.principal');
  assert.equal(W.conteudoErro({ diagnosticos: [{ cid: 'J06.9', descricao: 'IVAS', papel: 'hipotese', situacao: 'suspeito' }] }), 'diagnostico.1.cid');
  assert.equal(W.conteudoErro({ diagnosticos: [{ cid: null, descricao: 'x', papel: 'hipotese', situacao: 'suspeito' }] }), 'diagnostico.1.descricao');
  assert.equal(W.conteudoErro({ livre: 'x'.repeat(W.LIVRE_MAX + 1) }), 'livre');
  assert.ok(W.estaVazio(W.vazio()));
  assert.ok(!W.estaVazio({ conduta: 'Retorno se piorar' }));
});

test('SOAP -> texto livre -> SOAP: ida e volta sem perder nada', () => {
  const c = W.normalizar({ modo: 'soap', soap: { s: 'Dor ao engolir', o: 'Corado', a: 'IVAS', p: 'Sintomáticos\nRetorno se febre' } });
  const livre = W.alternarModo(c, 'livre');
  assert.equal(livre.modo, 'livre');
  assert.equal(livre.livre, 'S: Dor ao engolir\n\nO: Corado\n\nA: IVAS\n\nP: Sintomáticos\nRetorno se febre');
  assert.deepEqual(livre.soap, c.soap, 'o SOAP continua guardado');
  const volta = W.alternarModo(livre, 'soap');
  assert.deepEqual(volta.soap, c.soap);
  assert.equal(volta.livre, livre.livre, 'o texto livre também continua');
  assert.equal(W.outroFormatoDiferente(volta), false, 'texto livre igual ao SOAP: a prévia não repete');
});

test('texto livre -> SOAP: rótulos viram campos e o resto vai para "não classificado"', () => {
  const c = W.normalizar({ modo: 'livre', livre: 'Paciente veio com a mãe.\nSubjetivo: tosse há 3 dias\npiora à noite\nA: provável IVAS\nPlano - hidratação' });
  const s = W.alternarModo(c, 'soap');
  assert.deepEqual(s.soap, { s: 'tosse há 3 dias\npiora à noite', a: 'provável IVAS', p: 'hidratação' });
  assert.equal(s.nao_classificado, 'Paciente veio com a mãe.');
  assert.equal(s.livre, c.livre, 'o texto original continua guardado');
  // SOAP já escrito: trocar o modo não mexe nele.
  const j = W.alternarModo(W.normalizar({ modo: 'livre', livre: 'S: outro', soap: { s: 'meu' } }), 'soap');
  assert.deepEqual(j.soap, { s: 'meu' });
  assert.equal(W.outroFormatoDiferente(j), true, 'o texto livre diferente aparece na prévia');
});

test('IMC: só na tela, com a origem dos dois números; menor de 20 anos sem classificação de adulto', () => {
  const meds = [
    { tipo: 'peso', valor: 70, quem_mediu: 'paciente', como_obtido: 'relato' },
    { tipo: 'altura', valor: 175, quem_mediu: 'paciente', como_obtido: 'estimado' },
  ];
  const a = W.imc(meds, 40);
  assert.equal(a.valor, 22.9);
  assert.equal(a.texto, 'IMC 22,9 kg/m²');
  assert.equal(a.classificacao, 'Entre 18,5 e 24,9');
  assert.match(a.origem, /Peso: Medido pelo paciente \(informado por ele\)\. Altura: Estimado pelo paciente/);
  const b = W.imc(meds, 15);
  assert.equal(b.classificacao, null);
  assert.match(b.aviso, /percentil/);
  assert.equal(W.imc(meds.slice(0, 1), 40), null, 'sem altura, sem IMC (nada inventado)');
});

test('CID-10: formato com ponto e aviso de sexo neutro', () => {
  assert.equal(W.cidFmt('J069'), 'J06.9');
  assert.equal(W.cidFmt('J06'), 'J06');
  assert.match(W.avisoSexo('M'), /costuma se aplicar ao sexo masculino\. Confira\./);
  assert.equal(W.avisoSexo(null), '');
});

test('linha do tempo: filtros e contagens', () => {
  const ev = [{ tipo: 'versao' }, { tipo: 'versao' }, { tipo: 'finalizado' }, { tipo: 'diagnostico' }, { tipo: 'adendo' }, { tipo: 'documento' }, { tipo: 'encerrado_sem_finalizar' }];
  assert.deepEqual(W.contarPorFiltro(ev), { tudo: 7, registro: 2, versao: 2, diagnostico: 1, adendo: 1, documento: 1 });
  assert.equal(W.filtrarEventos(ev, 'versao').length, 2);
  assert.equal(W.filtrarEventos(ev, 'tudo').length, 7);
  assert.equal(W.haQuanto(AGORA - 3000, AGORA), 'agora');
  assert.equal(W.haQuanto(AGORA - 12000, AGORA), 'há 12 s');
});

test('banco: funções do prontuário com SECURITY DEFINER, search_path vazio, revoke e grant explícito', () => {
  const fns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns.sort(), ['cat_cid_buscar', 'ws_adendo_criar', 'ws_integridade_conferir', 'ws_registro_abrir', 'ws_registro_finalizar', 'ws_registro_historico', 'ws_registro_salvar', 'ws_registro_versao']);
  for (const f of fns) {
    const corpo = SQL.slice(SQL.indexOf(`create or replace function public.${f}(`));
    assert.match(corpo.slice(0, 400), /security definer\s+set search_path = ''/, f);
    assert.match(SQL, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated, service_role;`), `${f}: revoke`);
    assert.match(SQL, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated;`), `${f}: grant`);
  }
  // Nada destrutivo sobre o que existe (só os gatilhos de guarda falam em delete/truncate).
  const semComentario = SQL.replace(/--.*$/gm, '');
  assert.ok(!/\bdrop\s/i.test(semComentario), 'sem DROP');
  assert.ok(!/^\s*(delete|truncate)\s/im.test(semComentario), 'sem DELETE/TRUNCATE');
  assert.ok(!/\bdo\s+\$\$/i.test(semComentario), 'nada escondido em DO');
  assert.ok(!/create policy/i.test(semComentario), 'nenhuma policy (acesso só pelas funções)');
});

test('sw.js: os arquivos do prontuário estão no CORE', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['assets/js/ws-core.js', 'assets/js/ws-layout.js', 'assets/js/ws-prontuario.js', 'assets/css/ws.css']) assert.ok(sw.includes(`'./${f}'`), f);
});
