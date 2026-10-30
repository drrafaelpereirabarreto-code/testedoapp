# Memória do projeto IMED

> Lido automaticamente pelo Claude no início de cada sessão. Mantenha curto (~100 linhas).
> Detalhes em `memory/`. Este repositório é público (GitHub Pages): **nunca** escreva aqui segredos, senhas ou dados de pacientes.

## Quem sou eu (dono do projeto)
Dr. Rafael Pereira Barreto Silva, médico, **CRM-SP 266930**, dono e responsável técnico médico do IMED (autorizou usar nome e CRM no site). Fala português do Brasil, não é programador.

## Preferências (seguir sempre)
- Responder em **português do Brasil**, linguagem simples, sem jargão.
- **"Aceite tudo, não precisa perguntar"**: pode executar as tarefas do projeto sem pedir confirmação a cada passo
  (exceto gastar dinheiro, apagar dados reais ou algo irreversível fora do projeto).
- **Nunca inventar** preço, nota, horário, contagem, depoimento ou médico. Sem dado → não mostrar ("sob consulta").
- Localização do paciente: arredondar (~110 m), nunca gravar. Chaves secretas só no servidor.
- Depois de mudar o site: rodar os testes, subir `VERSION` em `sw.js`, commit e push na `main` (o Pages publica).

## O que é
| Item | Valor |
|------|-------|
| **IMED** | Marketplace de saúde: clínicas, laboratórios, diagnóstico por imagem e hospitais reais perto do paciente, com pedido de agendamento |
| Site | https://drrafaelpereirabarreto-code.github.io/testedoapp/ (repo `drrafaelpereirabarreto-code/testedoapp`, branch `main`) |
| Banco | Supabase projeto `pyoqiecupxhdzigjudyd` (região São Paulo) — conector Supabase do claude.ai |
| Dados reais | **CNES** (cadastro do Ministério da Saúde), importado por cidade |
| Stack | HTML/CSS/JS sem build, Leaflet, Three.js (cidade 3D), Edge Functions Deno, Playwright nos testes |

## Termos
| Termo | Significado |
|-------|-------------|
| **CNES** | Cadastro Nacional de Estabelecimentos de Saúde (dados oficiais, públicos) |
| **Parceiro / Parceiro verificado** | Clínica que fechou com o IMED (`clinics`), com preço/agenda informados por ela |
| **Cadastro oficial** | Estabelecimento do CNES ainda não parceiro (`establishments`) |
| **Concierge** | Pedido para local não parceiro: a equipe do IMED liga e marca |
| **Reivindicar** | Clínica assume o próprio cadastro do CNES (`establishment_claims` → `approve_claim`) |
| **Fila** | `import_queue` + pg_cron: pré-carrega capitais e grandes cidades |
| **wip/melhorias** | Branch com cópia de segurança de trabalho ainda não publicado |

## Estado atual (atualize ao terminar cada etapa)
- No ar (30/10/2026): as 14 melhorias — página inicial só com dados reais, selos, filtros SUS/convênio, faixa de preço,
  avaliações, "Adicionar à agenda", conta do paciente (`conta.html`), reivindicar cadastro (`reivindicar.html`),
  área da clínica/admin (`painel.html`), páginas por cidade (`cidades/`, gerar com `scripts/gerar-cidades.mjs`),
  teleconsulta "em breve". Fila de importação (143 cidades) rodando sozinha.
- Testes: `node --test tests/*.test.mjs` e `node tests/e2e-{perto,inicio,clinica,conta}.mjs` (todos passando).
- Também no ar: página de cada local (`local.html`), agenda com horário (aba Agenda no painel; reserva já confirmada), "Quem somos" e "Termos", 143 cidades. O Dr. Rafael é admin (`admin_emails`) e aprova cadastros no `painel.html`.
- **Próximo:** vídeo de divulgação (gravar a tela do site → AI Producer by OpusClip); quando a fila terminar,
  exportar `imported_cities()` para `scripts/cidades.json` e rodar o gerador de novo.

## Pendências que dependem do Dr. Rafael
- Razão social e CNPJ do IMED → `sobre.html` (hoje "em atualização"). Termos de uso: pedir revisão de um advogado.
- Comprar domínio (ex.: imed.com.br; dá para ver na Hostinger) → trocar `siteUrl` em `assets/js/config.js`.
- Número de WhatsApp do IMED → `whatsapp` em `assets/js/config.js`.
- Conectar **Resend** (e-mail) → SMTP no Supabase Auth; e Auth → URL Configuration com o endereço do site.
- Aprovar quando o Supabase pedir confirmação de SQL (o tempo esgota se ninguém responde).

→ Detalhes técnicos: `memory/context/arquitetura.md` · Histórico: `memory/projects/`
