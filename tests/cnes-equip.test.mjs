// Aparelhos do CNES no site (assets/js/geo-core.js): aviso sem prometer o exame, eco e laboratório nunca por aparelho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../assets/js/geo-core.js';

const row = (o = {}) => ({ cnes: '1234567', name: 'X', kind: 'clinica', services: ['usg'], lat: 0, lng: 0, ...o });

test('normalizeCnes junta o exame do aparelho e guarda a origem', () => {
  const p = G.normalizeCnes(row({ equip_exams: ['rm', 'eco', 'lab'], equip_exams_sus: ['rm'], equip_competencia: '2026-09-01' }), { lat: 0, lng: 0 });
  assert.deepEqual(p.services, ['usg', 'rm']);
  assert.deepEqual(p.equip, { exams: ['rm'], sus: ['rm'], competencia: '2026-09' });
});

test('sem as colunas equip_*: nada muda', () => {
  const p = G.normalizeCnes(row(), { lat: 0, lng: 0 });
  assert.equal(p.equip, null);
  assert.equal(G.equipNote(p, 'usg'), '');
});

test('aviso: aparelho em uso, cadastro oficial, confirme com o local; nunca "faz o exame"', () => {
  const p = G.normalizeCnes(row({ equip_exams: ['rm'] }), { lat: 0, lng: 0 });
  assert.equal(G.equipNote(p, 'rm'), 'Tem aparelho de ressonância em uso (cadastro oficial). Confirme com o local.');
  assert.equal(G.equipNote(p, 'tc'), '');
  for (const e of G.EQUIP_EXAMS) assert.ok(!/faz o exame/i.test(G.equipNote({ equip: { exams: [e] } }, e)));
  assert.ok(!G.EQUIP_EXAMS.includes('eco') && !G.EQUIP_EXAMS.includes('lab'));
});

test('pergunta ao ligar sobre o aparelho só quando ele vem do CNES', () => {
  const p = G.normalizeCnes(row({ equip_exams: ['rm'] }), { lat: 0, lng: 0 });
  assert.ok(G.callQuestions(p, 'rm').some((q) => q.id === 'aparelho'));
  assert.ok(!G.callQuestions(p, 'usg').some((q) => q.id === 'aparelho'));
});

test('equipPath só com CNES válidos, sem repetir, no máximo 150', () => {
  assert.equal(G.equipPath(['1234567', '1234567', 'x']), 'establishments?select=cnes,equip_exams,equip_exams_sus,equip_competencia&cnes=in.(1234567)');
  assert.equal(G.equipPath([]), null);
  assert.equal(G.formatComp('2026-09'), '09/2026');
});
