# Minerador de Anúncios

Site só seu (com senha) que **todo dia** coleta anúncios ativos da Biblioteca de Anúncios do Meta (Facebook e Instagram),
descobre **quais produtos e ofertas estão escalando** e mostra tudo num painel escuro, fácil de usar no celular.

- **Hoje**: anúncios do dia, do mais forte para o mais fraco, com o selo 🔥 **Escalando agora**.
- **Produtos**: a IA junta anúncios do mesmo produto (mesmo de anunciantes diferentes), com anúncios ativos, dias no ar e tendência.
- **Categorias**: cada nicho separado (beleza, saúde, casa, pets, infoproduto, moda, eletrônicos, infantil…).
- **Por mês**: arquivo com os campeões de cada mês.
- **Detalhe do anúncio**: imagem ou vídeo, texto completo com botão **Copiar texto**, link da página de destino e da
  Biblioteca, gráficos de evolução, análise da IA (promessa, gancho, oferta, chamada) e **3 ideias de anúncio original**.
- **Favoritos**: salve anúncios e escreva anotações.
- **Filtros**: país, categoria, plataforma, mínimo de dias no ar, mínimo de anúncios ativos e palavra-chave.

---

## Como a Pontuação de Escala funciona (0 a 100)

| Sinal | Pontos | O que significa |
|---|---|---|
| Tempo no ar | até 30 | Anúncio que fica no ar muito tempo provavelmente dá lucro (30 dias ≈ 25 pts; 60+ dias = 30). |
| Anúncios ativos | até 25 | Quantos anúncios o mesmo anunciante (ou a mesma página de destino) tem no ar agora. Muitas variações = escala. |
| Cópias do criativo | até 20 | O mesmo vídeo ou imagem rodando em vários anúncios (o Meta informa isso, e o sistema também compara as mídias). |
| Crescimento | até 15 | Os anúncios ativos do anunciante subiram em relação a ~7 dias atrás. |
| Plataformas | até 10 | Rodando em Facebook, Instagram, Messenger e Audience Network ao mesmo tempo. |

**🔥 Escalando agora** = o anunciante colocou mais anúncios no ar nos últimos dias (pelo menos +20% e 2 anúncios a mais).
Nos primeiros dias de uso, quando ainda não há histórico, vale também: anúncio novo (até 14 dias) que já tem 8+ anúncios
ativos e o criativo repetido 3+ vezes.

O histórico de cada dia fica guardado no banco, por isso os gráficos e o "crescimento" ficam melhores com o passar dos dias.

> Atenção: o sistema só enxerga os anúncios que a coleta trouxe. Com 50 anúncios por busca, um anunciante com 300
> anúncios aparece com menos. Para acompanhar um anunciante inteiro, cadastre a página dele em Configurações.

---

## Passo a passo para iniciante

Você vai precisar de: um computador com internet, uns 30 minutos e um cartão de crédito (só para a chave da IA; o
Apify tem plano grátis).

### Passo 1 — Instalar o Node.js

1. Entre em <https://nodejs.org> e baixe a versão **LTS** (22 ou mais nova). Instale clicando em "Próximo" até o fim.
2. Para conferir, abra o **Terminal** (Mac) ou o **Prompt de Comando** (Windows) e digite `node -v`. Deve aparecer `v22...` ou maior.

### Passo 2 — Criar a conta no Apify e pegar o token (a coleta)

O Apify é um serviço que tem "robôs" prontos. O robô que usamos abre a Biblioteca de Anúncios e copia os anúncios.

1. Entre em <https://apify.com> e clique em **Sign up** (pode entrar com a conta Google). O plano **Free** dá
   **US$ 5 de crédito por mês**, sem cartão.
2. Abra a página do robô <https://apify.com/curious_coder/facebook-ads-library-scraper> e clique em **Try for free**
   (isso só adiciona o robô à sua conta).
3. Vá em **Settings → API & Integrations** (<https://console.apify.com/settings/integrations>) e copie o
   **Personal API token**. Guarde: ele vai no `APIFY_TOKEN`.

### Passo 3 — Pegar a chave da IA (Anthropic / Claude)

1. Entre em <https://console.anthropic.com> e crie a conta.
2. Em **Billing**, coloque um cartão e compre créditos (US$ 5 já dá para começar).
   Dica: em **Limits** você pode pôr um teto de gasto por mês.
3. Em **API Keys** (<https://console.anthropic.com/settings/keys>) clique em **Create Key** e copie a chave
   (começa com `sk-ant-`). Ela vai no `ANTHROPIC_API_KEY`.

Sem essa chave o site funciona, mas sem a análise da IA e sem o agrupamento por produto.

### Passo 4 — Configurar e rodar no seu computador

No Terminal, dentro da pasta `minerador-anuncios`:

```bash
npm install                 # baixa as peças do projeto (só na primeira vez)
cp .env.example .env        # cria o seu arquivo de chaves (no Windows: copy .env.example .env)
```

Abra o arquivo `.env` num editor de texto (Bloco de Notas serve) e preencha:

- `SENHA_ACESSO` = a senha para entrar no site
- `SESSAO_SEGREDO` = um texto longo qualquer (gere com o comando que está no próprio arquivo)
- `APIFY_TOKEN` = o token do passo 2
- `ANTHROPIC_API_KEY` = a chave do passo 3

Depois:

```bash
npm run dev
```

Abra <http://localhost:3000>, entre com a sua senha, vá em **Configurações**, confira as palavras-chave e os países e
clique em **Atualizar**. A primeira coleta leva de 1 a 5 minutos.

> **Quer ver o painel antes de pegar as chaves?** Rode `npm run exemplo`. Ele carrega anúncios **inventados** (com um aviso
> amarelo no topo) só para você conhecer as telas. Depois apague em Configurações ou com `npm run exemplo:apagar`.

### Passo 5 — Coleta automática todo dia

- **Na Vercel** (passo 6): já vem pronto. O arquivo `vercel.json` manda a Vercel rodar a coleta todo dia às 6h
  (horário de Brasília).
- **No seu computador ou num servidor**: agende o comando `npm run coletar`.
  - Linux/Mac (cron): `crontab -e` e adicione `0 6 * * * cd /caminho/minerador-anuncios && npm run coletar >> coleta.log 2>&1`
  - Windows: **Agendador de Tarefas** → Criar tarefa básica → Diariamente → programa `cmd`, argumentos
    `/c cd C:\caminho\minerador-anuncios && npm run coletar`.

O botão **Atualizar** no topo do site faz a coleta na hora, quando você quiser.

---

## Passo 6 — Colocar no ar (para acessar do celular, de qualquer lugar)

### Opção A: Vercel (grátis, recomendado)

Na Vercel o site não tem disco fixo, então o banco precisa ser **Postgres** na nuvem (grátis no Supabase ou no Neon).

1. **Banco**: crie um projeto grátis em <https://supabase.com> (ou <https://neon.tech>). No Supabase, vá em
   **Connect → Connection string → Session pooler** e copie o endereço que começa com `postgres://`. Troque
   `[YOUR-PASSWORD]` pela senha do banco. As tabelas são criadas sozinhas na primeira vez.
2. **Código no GitHub**: o ideal é deixar este projeto num repositório **privado** só dele (crie um em
   <https://github.com/new> chamado `minerador-anuncios`, marque **Private**, e envie esta pasta para lá).
3. **Vercel**: entre em <https://vercel.com> com a conta do GitHub → **Add New → Project** → escolha o repositório →
   se o projeto estiver dentro de outra pasta, em **Root Directory** escolha `minerador-anuncios`.
4. Em **Environment Variables**, adicione as mesmas chaves do `.env`: `SENHA_ACESSO`, `SESSAO_SEGREDO`, `APIFY_TOKEN`,
   `ANTHROPIC_API_KEY`, `CLAUDE_MODELO`, `DATABASE_URL` (a do passo 1) e `CRON_SECRET` (invente um texto longo; a Vercel
   usa para chamar a coleta diária).
5. Clique em **Deploy**. Em 2 minutos você recebe um endereço `https://...vercel.app`. Abra no celular e, no menu do
   navegador, toque em **Adicionar à tela de início** para virar um "app".

> O plano grátis da Vercel (Hobby) é para uso pessoal e não comercial — é o caso deste painel só seu.
> Cada chamada pode durar até 5 minutos. Se o Apify demorar mais que isso, o site avisa "ainda está coletando" e a
> próxima chamada (ou um novo clique em Atualizar) busca o resultado.

### Opção B: servidor barato (VPS de ~US$ 5/mês, ex.: Hostinger, DigitalOcean, Hetzner)

Funciona com SQLite (arquivo), sem precisar de banco na nuvem:

```bash
git clone <seu repositório> && cd minerador-anuncios
npm install && cp .env.example .env   # preencha o .env
npm run build
npx pm2 start "npm start" --name minerador   # deixa o site ligado (porta 3000)
```

Agende `npm run coletar` no cron (passo 5) e aponte um domínio com HTTPS (ex.: Caddy ou o painel da hospedagem).

---

## Quanto custa por mês (estimativa)

Com a configuração padrão: 5 palavras-chave × 2 países × até 50 anúncios = **até 500 anúncios por dia** e
**30 análises de IA por dia**.

| Serviço | Como cobra | Estimativa por mês |
|---|---|---|
| Apify (robô padrão) | US$ 0,75 por 1.000 anúncios | até ~**US$ 11** (15 mil anúncios). Plano grátis cobre US$ 5 → baixe para ~20 anúncios por busca e fica grátis |
| Claude **Opus 5.5** (padrão, melhor qualidade) | US$ 4 por milhão de tokens de entrada / US$ 20 de saída | ~US$ 0,03 por anúncio analisado → 900 análises ≈ **US$ 25 a 35** |
| Claude **Haiku 5.5** (`CLAUDE_MODELO=claude-haiku-5-5`) | US$ 0,10 / US$ 0,50 por milhão de tokens | ≈ **US$ 1** por mês |
| Vercel Hobby | grátis | US$ 0 |
| Supabase / Neon (plano grátis) | grátis até 500 MB | US$ 0 |
| API oficial do Meta (opcional) | grátis | US$ 0 |

**Total**: de **~US$ 1** (Apify grátis + Haiku) a **~US$ 45** (padrão com Opus). O site mostra em Configurações o
máximo de anúncios por dia e o custo do Apify com os seus números. Para gastar menos com a IA:

- troque o modelo para `claude-haiku-5-5` no `.env` (fica bem mais barato, com análise um pouco mais simples);
- diminua **Análises de IA por dia** em Configurações (a IA analisa primeiro os anúncios de maior pontuação);
- anúncios com o **mesmo criativo** reaproveitam a análise e não gastam de novo.

---

## Fontes de dados

1. **Apify (principal)** — `APIFY_TOKEN` + `APIFY_ACTOR`. O padrão é `curious_coder/facebook-ads-library-scraper`
   (o mais usado da loja). Também aceita `apify/facebook-ads-scraper` e `memo23/facebook-ads-library-scraper-cheerio`:
   é só trocar o `APIFY_ACTOR` no `.env`.
2. **API oficial do Meta (opcional)** — `META_TOKEN`. Usa o endpoint `ads_archive`. Fora da União Europeia ela **só traz
   dados completos de anúncios políticos**, então para produtos no Brasil e EUA quase não ajuda. Fica desligada se o
   token estiver vazio. Token em <https://developers.facebook.com/tools/explorer/> (precisa confirmar a identidade em
   <https://www.facebook.com/ID>).
3. **Palavras-chave, países e idioma** — em **Configurações** no próprio site. Coloque entre aspas para frase exata
   (`"frete grátis"`). Também dá para cadastrar **anunciantes para acompanhar sempre** (ID da página do Facebook).

---

## Uso responsável

Use os anúncios como **estudo**: veja o ângulo, a promessa, a oferta e o formato que estão funcionando e crie a **sua
versão**. Copiar texto, imagem, vídeo, marca ou depoimento de outra pessoa pode violar direitos autorais e as regras de
anúncios do Meta (e derrubar a sua conta de anúncios). As ideias da IA já vêm escritas como peças originais.

---

## Para quem mexe no código

- `npm test` — testes automáticos (pontuação, leitura dos formatos do Apify, coleta completa com Apify e IA simulados).
  Para testar no Postgres: `TESTE_DATABASE_URL=postgres://... npm test` (use um banco vazio, só de teste).
- `npm run typecheck` — confere os tipos.
- Estrutura:
  - `src/lib/pontuacao.ts` — a Pontuação de Escala.
  - `src/lib/fontes.ts` — Apify e API do Meta. `src/lib/normalizar.ts` — lê os formatos de cada robô.
  - `src/lib/coleta.ts` — a coleta diária (salvar, pontuar, histórico, IA, produtos). Pode ser retomada se o tempo acabar.
  - `src/lib/ia.ts` — análise com o Claude (saída estruturada, com "fallback" automático se o modelo recusar por engano).
  - `src/lib/db.ts` + `schema.ts` — SQLite (Node 22, sem instalar nada) ou Postgres (`DATABASE_URL`).
  - `src/app/(painel)/` — as páginas; `src/app/api/` — coleta, cron, favoritos, IA, configurações e login.
  - `src/proxy.ts` — exige a senha em todas as páginas (menos `/entrar` e `/api/cron`, que tem o próprio segredo).
- Next.js 16 + React 19 + Tailwind 4. Sem build de banco: as tabelas são criadas na primeira conexão.
