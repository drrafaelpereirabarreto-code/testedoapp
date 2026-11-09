import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirSenha, criarSessao, lerSessao, usuarios } from "../src/lib/sessao";

test("uma pessoa só: SENHA_ACESSO", async () => {
  delete process.env.USUARIOS;
  process.env.SENHA_ACESSO = "abc";
  process.env.SESSAO_SEGREDO = "segredo-de-teste-com-mais-de-16";
  assert.deepEqual([...usuarios().keys()], ["eu"]);
  assert.equal(await conferirSenha("", "abc"), "eu");
  assert.equal(await conferirSenha("", "errada"), null);
});

test("duas pessoas: cada uma com a sua senha e o seu crachá", async () => {
  process.env.USUARIOS = "Rafael:senha1, esposa:senha2";
  assert.deepEqual([...usuarios().keys()], ["rafael", "esposa"]);
  assert.equal(await conferirSenha("esposa", "senha2"), "esposa");
  assert.equal(await conferirSenha("esposa", "senha1"), null, "senha de outra pessoa não vale");
  assert.equal(await conferirSenha("ninguem", "senha1"), null);
  const c = await criarSessao("esposa");
  assert.equal(await lerSessao(c), "esposa");
  assert.equal(await lerSessao(c.replace("esposa", "rafael")), null, "não dá para trocar o nome no crachá");
  process.env.USUARIOS = "rafael:senha1";
  assert.equal(await lerSessao(c), null, "quem sai da lista perde o acesso");
  delete process.env.USUARIOS;
});
