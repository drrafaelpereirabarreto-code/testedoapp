# Laço rápido do banco (sem Docker)

Confere em segundos, num PostgreSQL descartável desta máquina, a regra mais importante da agenda:
**nenhum aparelho, sala ou profissional usado por mais pacientes do que a capacidade ao mesmo tempo**
(a restrição de exclusão `occupancy_no_overlap` da arquitetura, §2.5 e §3.4).

## Como rodar

```bash
npm ci --prefix tests/banco --ignore-scripts         # uma vez, na pasta do repositório (versões travadas)
node tests/banco/local/rodar.mjs                     # os casos (uns 2 s)
node tests/banco/local/rodar.mjs --concorrencia      # + todos os modos de concorrência (uns 6 s)
node tests/banco/local/rodar.mjs --concorrencia=sem-trava:40,com-trava,remarcacao,capacidade   # os que o GitHub roda
node tests/banco/local/rodar.mjs --concorrencia --sem-limite   # sem o tempo-limite de 3 s do visitante
```

Precisa do PostgreSQL 16 ou mais novo instalado (com `btree_gist`). O script acha os programas em
`/usr/lib/postgresql/<versão>/bin` (ou em `PG_BIN`), cria o banco numa pasta temporária, usa uma porta livre
só em 127.0.0.1 e apaga tudo no fim. Como root, roda o `initdb` como o usuário `postgres` do sistema.
O GitHub roda o mesmo laço no começo do `banco.yml` (lá, sem PostgreSQL na máquina, o laço reprova em vez de pular;
e se o laço reprovar, o resto da execução continua e o último passo reprova). `<modo>:N` roda só com N ao mesmo
tempo (ex.: `sem-trava:40`).

## O que ele confere

- **Casos** (`prova.sql`, igual à tabela `agenda.occupancy` da arquitetura, sem as chaves estrangeiras):
  cruzamento recusado (inícios diferentes também), encostado aceito, bloqueio × bloqueio aceito, uso dentro de
  bloqueio recusado, sala com capacidade 2 (vagas, inclusive dois usos que começam juntos), vaga acima da
  capacidade, bloqueio em cima de uso, reativar bloqueio por cima de uso. No fim de cada cenário, um oráculo que
  não olha a vaga confere a capacidade (`prova.violacoes()`).
- **Concorrência** (N transações partem juntas: barreira com `pg_advisory_lock`):
  - `sem-trava` e `com-trava`: 40 e 100 no mesmo aparelho, inícios 10:00/10:05/10:10 de 45 min.
    *Sem trava*, só a restrição de exclusão segura: nunca entra mais de 1 (sem ela, entram todos: é o modo que pega
    a restrição faltando sob concorrência) e os perdedores recebem 23P01, impasse (40P01) ou estouro de tempo (57014;
    numa cadeia de impasses cortada pelos 3 s, até o vencedor pode estourar e ninguém entrar). *Com a trava por
    recurso* (`pg_advisory_xact_lock(7102, ...)` antes de conferir e gravar), entra exatamente 1 e os outros recebem
    "sem horário", sem erro.
  - `remarcacao`: a troca de horário desativa o antigo e grava o novo na mesma transação e segura 1,5 s; quem
    tenta o horário antigo espera até o fim. Com COMMIT, entra depois; com ROLLBACK, recebe 23P01 e o antigo continua.
  - `capacidade`: sala com 2 vagas, 60 pedidos de 15 min com inícios variados, com trava: nunca 3 ao mesmo tempo.

## Limites

Não substitui o banco de verdade do GitHub (`.github/workflows/banco.yml`): aqui não há PostGIS, PostgREST, Auth,
Realtime nem as migrações do site. A base mínima (`base.sql`) tem só os papéis `anon`, `authenticated`,
`service_role` e as funções `auth.uid()`, `auth.role()` e `auth.jwt()` iguais às do Supabase.
