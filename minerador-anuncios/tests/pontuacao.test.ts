import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPontuacao, tendencia } from "../src/lib/pontuacao";

const base = { diasNoAr: 0, anuncianteAtivos: 1, dominioAtivos: 1, duplicacoes: 1, ativosHoje: 1, ativosAntes: null, plataformas: 1 };

test("anúncio novo, sozinho, 1 plataforma: pontuação baixa", () => {
  const p = calcularPontuacao(base);
  assert.ok(p.total <= 5, `total ${p.total}`);
  assert.equal(p.escalando, false);
});

test("anúncio vencedor clássico: pontuação alta", () => {
  const p = calcularPontuacao({ ...base, diasNoAr: 60, anuncianteAtivos: 50, duplicacoes: 20, ativosHoje: 50, ativosAntes: 25, plataformas: 4 });
  assert.equal(p.total, 100);
  assert.equal(p.escalando, true);
  assert.ok(p.motivos.some((m) => m.includes("60 dias")));
});

test("cada parte respeita o seu teto e o total fica entre 0 e 100", () => {
  const p = calcularPontuacao({ ...base, diasNoAr: 9999, anuncianteAtivos: 9999, duplicacoes: 9999, ativosHoje: 9999, ativosAntes: 1, plataformas: 9 });
  assert.deepEqual(p.partes, { tempo: 30, ativos: 25, duplicacoes: 20, crescimento: 15, plataformas: 10 });
  assert.equal(p.total, 100);
});

test("30 dias no ar vale mais que 7 e menos que 60", () => {
  const t = (d: number) => calcularPontuacao({ ...base, diasNoAr: d }).partes.tempo;
  assert.ok(t(7) < t(30) && t(30) < t(60));
  assert.ok(t(30) >= 24 && t(30) <= 26);
});

test("'Escalando agora' exige +20% e pelo menos 2 anúncios a mais", () => {
  assert.equal(calcularPontuacao({ ...base, ativosHoje: 12, ativosAntes: 10 }).escalando, true);
  assert.equal(calcularPontuacao({ ...base, ativosHoje: 11, ativosAntes: 10 }).escalando, false);
  assert.equal(calcularPontuacao({ ...base, ativosHoje: 2, ativosAntes: 1 }).escalando, false);
  assert.equal(calcularPontuacao({ ...base, ativosHoje: 5, ativosAntes: 10 }).escalando, false);
});

test("queda de anúncios não dá ponto de crescimento", () => {
  assert.equal(calcularPontuacao({ ...base, ativosHoje: 3, ativosAntes: 10 }).partes.crescimento, 0);
});

test("sem histórico: anúncio novo com muitas variações conta como escalando", () => {
  assert.equal(calcularPontuacao({ ...base, diasNoAr: 5, anuncianteAtivos: 10, duplicacoes: 4 }).escalando, true);
  assert.equal(calcularPontuacao({ ...base, diasNoAr: 40, anuncianteAtivos: 10, duplicacoes: 4 }).escalando, false);
});

test("tendência", () => {
  assert.equal(tendencia(15, 10), 0.5);
  assert.equal(tendencia(5, 10), -0.5);
  assert.equal(tendencia(5, null), 0);
});

import { faseProduto, notaOportunidade } from "../src/lib/pontuacao";

const p0 = { anunciantes: 1, anunciantesAntes: null, anunciosAtivos: 3, tendencia: 0, diasMax: 10 };

test("fase: poucos anunciantes e anúncios recentes = começando", () => {
  assert.equal(faseProduto(p0).fase, "comecando");
});

test("fase: muitos anunciantes = saturado", () => {
  assert.equal(faseProduto({ ...p0, anunciantes: 12, diasMax: 90 }).fase, "saturado");
});

test("fase: concorrência chegando rápido = saturado", () => {
  assert.equal(faseProduto({ ...p0, anunciantes: 7, anunciantesAntes: 4, diasMax: 60 }).fase, "saturado");
  assert.equal(faseProduto({ ...p0, anunciantes: 7, anunciantesAntes: 6, diasMax: 60 }).fase, "estavel");
});

test("fase: crescendo = escalando; caindo = em queda", () => {
  assert.equal(faseProduto({ ...p0, anunciantes: 4, diasMax: 60, tendencia: 0.5 }).fase, "escalando");
  assert.equal(faseProduto({ ...p0, anunciantes: 4, diasMax: 60, tendencia: -0.5 }).fase, "queda");
});

test("oportunidade: sem concorrência no Brasil vale mais; com 3+ anunciantes não é oportunidade", () => {
  const base = { foraAnuncios: 20, foraAnunciantes: 4, pontuacaoMax: 80, tendencia: 0.5 };
  const zero = notaOportunidade({ ...base, alvoAnunciantes: 0 });
  const um = notaOportunidade({ ...base, alvoAnunciantes: 1 });
  assert.ok(zero > um && um > 0);
  assert.ok(zero <= 100);
  assert.equal(notaOportunidade({ ...base, alvoAnunciantes: 3 }), 0);
  assert.equal(notaOportunidade({ ...base, foraAnuncios: 0, alvoAnunciantes: 0 }), 0);
});
