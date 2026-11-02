// Tema escuro do grupo "conta" (conta, painel, reivindicar, parceiros, contato, páginas de texto, para médicos).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const blocos = (css) => {
  const a = css.match(/@media screen and \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/);
  const b = css.match(/@media screen\{\s*:root\[data-theme="dark"\]\{([^}]*)\}/);
  return [a?.[1].trim(), b?.[1].trim()];
};
for (const f of ['assets/css/conta.css', 'assets/css/clinica.css', 'assets/css/texto.css']) {
  test(`${f}: tokens --conta-* nos dois blocos escuros iguais, e todo uso tem cor de reserva clara`, () => {
    const css = ler(f);
    const [a, b] = blocos(css);
    assert.ok(a && a.includes('--conta-'), 'bloco escuro do Automático');
    assert.equal(a, b, 'os dois blocos escuros são iguais');
    const usos = [...css.matchAll(/var\(--conta-[\w-]+\)/g)].map((m) => m[0]);
    const fora = usos.filter((u) => !a.includes(u)); // só pode aparecer sem reserva dentro dos blocos (não há)
    assert.deepEqual(fora, [], 'uso de --conta-* sem cor de reserva (no claro ficaria sem cor)');
  });
}
test('páginas do grupo: sem fundo #fff fixo no CSS próprio e botão de tema no cabeçalho de conta e painel', () => {
  for (const f of ['assets/css/conta.css', 'assets/css/clinica.css', 'assets/css/texto.css', 'assets/css/para-medicos.css']) {
    assert.ok(!/background:#fff\b/i.test(ler(f)), `${f}: fundo branco fixo`);
  }
  for (const f of ['conta.html', 'painel.html']) assert.match(ler(f), /<header class="pt-top">[\s\S]*<button type="button" class="tema-btn" data-tema><\/button>\s*<\/div>\s*<\/header>/);
});
