# Plano: implementar as 14 melhorias no IMED

## Contexto
O usuário pediu para implementar as 14 sugestões (comparação com Doctoralia, BoaConsulta, Dr. Consulta etc.).
Já feito antes do modo de planejamento (está no ar):
- **Item 6 (pré-carga):** migração `fila_importacao` aplicada — `import_queue` com 143 cidades (27 capitais + ~116 grandes),
  `pg_cron` a cada minuto chama `importar-clinicas` (ação `importar`, token interno em `private.app_tokens`,
  conferido por `check_internal_token`). Importador v8 publicado com `verify_jwt=false` (a própria função exige
  chave de serviço ou o token). Já importou ~12 cidades; termina sozinho em ~70 min. Atualização mensal agendada.
- **Banco do marketplace:** migração `marketplace` aplicada (arquivo `supabase/migrations/20261030030000_marketplace.sql`):
  `clinics.insurances`, `clinics.cnes`, `clinic_members`, `is_clinic_member`, `nearby_clinics` (agora devolve
  `insurances`, `cnes`), `nearby_establishments` (esconde CNES que virou parceiro), `appointment_requests.user_id`
  (preenchido pelo gatilho com `auth.uid()`), `review_token_hash`, status `completed`, `set_request_status`,
  `request_status(ids, tokens)`, `reviews` + `submit_review`, `place_ratings(keys)`, `place_reviews(key)`,
  `establishment_claims` + gatilho + `approve_claim` / `reject_claim`, `update_my_clinic`, `set_my_clinic_exams`,
  `city_establishments(ibge, kind, limit, offset)`, `imported_cities()` (security definer).

Pendências de arrumação já conhecidas:
- renomear `20261030020000_fila_importacao.sql` → `20261030021434_fila_importacao.sql` e
  `20261030030000_marketplace.sql` → `20261030021903_marketplace.sql` (versões aplicadas);
- no arquivo do marketplace, `imported_cities()` passar a `security definer` (já aplicado no banco por SQL);
- README: deploy do importador com `--no-verify-jwt` e a fila/pg_cron.

## O que depende do usuário (dizer no final)
- **Domínio (2):** comprar (ex.: imed.com.br). Deixar `siteUrl` em `assets/js/config.js`, gerador de páginas
  com base configurável e passo a passo do CNAME/DNS no README.
- **WhatsApp (4):** número do IMED → `config.js` `whatsapp: ''`; botão só aparece com número.
- **Login por e-mail (9, 10, 11):** no painel do Supabase, Auth → URL Configuration: Site URL e Redirect URLs
  com o endereço do site; e SMTP próprio (ex.: Resend), porque o SMTP padrão só envia para a equipe do projeto.
- **Lembretes por WhatsApp/e-mail (12):** precisam de provedor; agora entra "Adicionar à agenda" (.ics) com o preparo.

## Implementação (Workflow multi-agente; ultracode está ligado)
O banco já está pronto, então o trabalho de tela se divide por arquivos, sem conflito. Agentes em paralelo no
mesmo diretório, cada um dono dos próprios arquivos. Arquivos compartilhados (`sw.js`, `README.md`,
`privacidade.html`, `assets/js/config.js`) ficam comigo no final.

Peça comum criada primeiro por mim: **`assets/js/auth.js`** (módulo ES, sem dependências), com login por link
mágico via REST do Supabase Auth:
- `POST /auth/v1/otp` com `email`, `create_user: true` e `redirect_to` para a página atual;
- leitura do `#access_token` na volta, sessão no `localStorage` e renovação por `/auth/v1/token?grant_type=refresh_token`;
- funções `session()`, `signIn(email)`, `signOut()`, `rpc(fn, args)` e `rest(path)` com o token do usuário.

Reaproveitar `assets/js/config.js` (`supabaseUrl`, `supabaseAnonKey`) e o padrão de `rpc` de `assets/js/perto.js`.

### Agente A — Página inicial com dados reais (itens 1, 4, 14) — `index.html`, `assets/js/data.js`
- Remover clínicas fictícias, notas ("4,9"), preços "a partir de R$", "clínicas abertas agora", horários e
  "Super Clínicas", o carrinho com preços, os chips falsos (Pix, laudo na hora) e os contadores inventados.
- Trocar por:
  - números reais vindos de `imported_cities()`: total de estabelecimentos e de cidades;
  - as listas "perto de você" a partir de `nearby_establishments` e `nearby_clinics`;
  - as categorias levando para `perto.html?exame=…`.
- **Mapa 3D:** a `API.clinics()` passa a usar estabelecimentos reais perto (campos `id`, `n`, `ini`, `c`, `lat`,
  `lng`, `open`, `r`/`sup` com valores neutros). O texto do rótulo (`meta`) mostra tipo e distância, sem nota.
  Ajuste mínimo em `assets/js/hero3d.js` se a altura depender de `r`.
- **Teleconsulta (14):** sem médicos fictícios. Seção "Em breve" com inscrição na lista de espera (`app_waitlist`).
- **WhatsApp (4):** botão fixo que só aparece se `IMED_CONFIG.whatsapp` tiver número.
- **"Agendados":** passa a consultar a situação real via `request_status`, usando o id e o código guardados no aparelho.
- **Rodapé:** links para "Sua clínica no IMED" (`reivindicar.html`), "Área da clínica" (`painel.html`),
  "Minha conta" (`conta.html`) e "Clínicas por cidade" (`cidades/`).

### Agente B — Busca (itens 3, 4, 7, 8, 12, 13) — `assets/js/perto.js`, `perto.html`, `assets/css/perto.css`, `assets/js/geo-core.js`, `tests/geo-core.test.mjs`, `tests/e2e-perto.mjs`
- **Selos (3):** "Parceiro verificado" (IMED não demo) e "Cadastro oficial" (CNES), com legenda curta.
- **Filtros (7):**
  - "Atende SUS", usando `sus` do CNES;
  - "Convênio", com um select montado a partir de `insurances` dos parceiros e o aviso "convênio só informado por parceiros".
  - `G.filterPlaces` e `activeFilterCount` ganham `sus` e `insurance`.
- **Comparador de preço (13):** com um exame escolhido, mostrar a faixa "de R$ X a R$ Y em N clínicas que
  informaram". Sem preço informado, "Nenhuma clínica informou preço para este exame ainda". Função pura `priceRange` em `geo-core.js`.
- **Avaliações (8):** buscar `place_ratings` dos ids exibidos e mostrar ★ média (n) só quando existir.
  Na ficha, listar `place_reviews`.
- **Pedido:**
  - gerar um código aleatório e gravar `review_token_hash` (SHA-256 com `crypto.subtle`) no pedido;
  - guardar `{id, token}` em `imed_appts`;
  - na tela de sucesso, "Adicionar à agenda" gera um `.ics` com data e período, o preparo resumido do exame e o link do guia (12).
- **WhatsApp (4):** botão "Falar com o IMED" no detalhe, se configurado.
- **Testes:** atualizar os mocks (as RPCs novas) e criar cenários de SUS, convênio, faixa de preço, nota e `.ics`.

### Agente C — Lado da clínica (itens 9, 10) — `reivindicar.html`, `painel.html`, `assets/js/clinica.js`, `assets/css/clinica.css`, `tests/e2e-clinica.mjs`
- **`reivindicar.html`:**
  - busca o estabelecimento por nome e cidade (RPC nova não é necessária: usar `city_establishments` + texto, ou `nearby_establishments` pelo CEP via `clinicas-proximas` geocode);
  - login por e-mail;
  - formulário: nome, cargo, CPF/CNPJ, CRM (opcional), celular e mensagem;
  - insert em `establishment_claims`, depois tela "em análise".
  - Também aceita `?cnes=` vindo do botão "É sua clínica?" na ficha da busca. Esse botão é do Agente B.
- **`painel.html`:**
  - login;
  - lista as clínicas do usuário (`clinic_members` + `clinics`) e os pedidos (`appointment_requests` via RLS);
  - muda a situação com `set_request_status`, incluindo "Concluído", que libera a avaliação;
  - edita os dados com `update_my_clinic`: telefone, WhatsApp, site, descrição, horários, convênios e especialidades;
  - edita exames e preços com `set_my_clinic_exams`.
- **Painel do admin:** quando `is_imed_admin()`, aparece a aba "Pedidos de cadastro", com aprovar (`approve_claim`)
  e recusar (`reject_claim`), e os pedidos ao IMED de locais do CNES (concierge), com `set_request_status`.

### Agente D — Conta do paciente e páginas por cidade (itens 5, 11, 2) — `conta.html`, `assets/js/conta.js`, `scripts/gerar-cidades.mjs`, `cidades/**`, `assets/js/cidade.js`, `sitemap.xml`, `robots.txt`
- **`conta.html` (11):**
  - entrar e sair;
  - "Meus pedidos": pedidos da conta mais os do aparelho, via `request_status`;
  - avaliar pedido concluído com `submit_review` (estrelas e comentário);
  - baixar o `.ics`.
- **Páginas por cidade (5):** um script Node lê um JSON de cidades. Eu exporto `imported_cities()` pelo MCP para
  `scripts/cidades.json` (cerca de 150 linhas). O script gera:
  - `cidades/index.html`, com todas as cidades por estado;
  - `cidades/<uf>/<slug>/index.html`, com o resumo por tipo;
  - `cidades/<uf>/<slug>/<tipo>.html`, com 4 tipos.

  O título, a descrição, o H1, o texto e os dados estruturados (`schema.org` ItemList) já vêm no HTML.
  A lista é carregada por `city_establishments` em `cidade.js`, com paginação e link para `perto.html`.
- **Também:** `sitemap.xml` e `robots.txt` gerados com a base `siteUrl` (domínio, item 2).

### Eu, no final (integração)
- `config.js` (`siteUrl`, `whatsapp: ''`), `sw.js` (versão, arquivos novos no cache), `privacidade.html`
  (contas, avaliações, reivindicação, convênios), README (tudo acima e os passos do usuário) e renomear as migrações.
- `get_advisors` de segurança e desempenho e correção do que surgir das funções novas.

## Revisão (segundo workflow)
Revisores por área (segurança/RLS das RPCs e telas, correção de fluxo, dados inventados remanescentes,
acessibilidade/celular), cada achado verificado por um cético antes de corrigir.

## Verificação
- `node --test tests/*.test.mjs` e `node --experimental-strip-types --test supabase/functions/**/lib.test.ts`.
- `node tests/e2e-perto.mjs`, `node tests/e2e-clinica.mjs` e um e2e de conta e cidade, com o Supabase simulado.
- Capturas das telas (início, busca, reivindicar, painel, conta, cidade) no computador e no celular.
- SQL real pelo MCP:
  - criar pedido de teste → `set_request_status('completed')` como admin → `submit_review` com o código → `place_ratings`, e apagar depois;
  - `city_establishments` de uma cidade importada;
  - fila: `select status, count(*) from import_queue`.
- Commit e push em `main`, e confirmar o deploy do Pages.
