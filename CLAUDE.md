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
- Testes: `node --test tests/*.test.mjs` e todos os `tests/e2e-*.mjs` (o GitHub roda tudo a cada envio; `E2E_PORT` muda a porta; o e2e-a11y precisa do axe-core via `AXE_PATH`).
- Também no ar: página de cada local (`local.html`), agenda com horário (aba Agenda no painel; reserva já confirmada), "Quem somos" e "Termos". O Dr. Rafael é admin (`admin_emails`) e aprova cadastros no `painel.html`.
- Noite de 30/10 (no ar): busca na área inteira (até 50 km); mapa da página inicial com todos os locais em 2 km; segurança do banco; testes automáticos no GitHub; 318 cidades (`scripts/cidades.json`, páginas geradas).
- 30/10 de manhã (no ar): **teleconsulta** por vídeo (`teleconsulta.html` paciente, `medico.html` médico/admin, `termo-teleconsulta.html`), com **documentos médicos** (pedido de exames, receita simples, atestado, comparecimento, encaminhamento, relatório, orientações; PDF com QR → `documento.html`; o médico assina com ICP-Brasil e envia o PDF); **confiança** (rodapé único com médico responsável em todas as páginas — `scripts/rodape.mjs` + `aplicar-rodape.mjs`; faxina do inventado; `como-funciona.html`, `acessibilidade.html`, `contato.html` "Fale com o IMED"; cancelar pedido; "Algo errado? Avise"; conferência de clínica no painel); **contador de visitas** próprio sem cookies (`assets/js/visitas.js`, aba Visitas no painel); acessibilidade (axe) e velocidade (fontes e ícones do próprio site — `scripts/fontes.mjs`).
- Migrações aplicadas: `..._seguranca`, `..._teleconsulta`, `..._tele_documentos`, `..._confianca`, `..._visitas`, `20261030163758_gestao`, `20261030191354_painel_medico` (nomes iguais às versões do banco).
- Tarde de 30/10: **vídeo de divulgação** gravado no GitHub (`scripts/gravar-video.mjs`, Actions → "Vídeo de divulgação", ramo `video/execucao-N`); correção da lista do mapa em celular de 360 px; análise dos concorrentes (`memory/projects/concorrentes-2026-10-30.md`, melhorias L1–L16).
- Noite de 30/10 (no ar): **painel de gestão** `gestao.html` (só admin, `noindex`, sem contador de visitas; dados só pelas funções `admin_gestao` e `admin_cobranca_*` da migração `..._gestao`, que conferem `is_imed_admin`; cobranças registradas pela equipe em `private.billing_charges`, com histórico) e **"Para médicos"** `para-medicos.html` (fluxograma da inscrição até o atendimento) + etapas do cadastro na área do médico.
- 30/10, 20h (no ar): **plataforma do médico** — `medico.html` virou "Plataforma de atendimento do IMED" (menu próprio e volta ao site) com o painel "Agora na plataforma" (aguardando, espera mais longa, em atendimento, atendimentos hoje, documentos para assinar, médicos disponíveis; função `tele_painel_medico`, só números, sem dado de paciente); "Sou médico" e perguntas frequentes na `teleconsulta.html`; bloco "Agora" no painel de gestão; "Área do médico" no rodapé.
- 30/10, noite (no ar): melhorias dos concorrentes — L1 "o que perguntar ao ligar" nos locais não parceiros (local e busca); L6 perguntas frequentes com JSON-LD nas 318 páginas de cidade + `llms.txt`; L7 "O que levar" nos 8 guias; L11 confirmação de preço fora do normal no painel da clínica + `tests/sem-dado-de-teste.test.mjs`; "não é plano de saúde nem cartão de desconto" em Quem somos e Termos.
- 30/10, noite (no ar): página inicial **"Clínicas perto de você"** — pede a localização ao abrir (1 vez por aba; não pede sozinha depois de 2 recusas ou pedidos sem resposta; o aviso LGPD espera a resposta), os 10 mais perto com abas por tipo e mapa (no celular, tela cheia e mapa só depois do toque), seletor "Onde você está?" no lugar de "Clínicas por cidade" (`assets/js/inicio-perto.js` + `inicio-core.js`; detalhes em `memory/context/arquitetura.md`).
- 31/10, madrugada (no ar): **L2** — a busca entende o nome popular, a sigla e uma letra errada do exame (hemograma, TSH, USG, tomo, "ressonancia"…), na página inicial, na busca ("ressonância em Campinas" liga o filtro e procura só Campinas) e na área do médico; "eco" e doença sozinha perguntam; laboratório sempre com "confirme se o local faz este exame" (`assets/js/exames-nomes.js`, baixado só quando a pessoa digita).
- **iMed Agenda** (pedido de 30/10): arquitetura final pronta em 31/10 (`memory/projects/imed-agenda-arquitetura.md`: modelo, concorrência com EXCLUDE, estados, fases 0 a 7 e as 26 decisões do dono com recomendação). Ordem: 0.1 chaves novas (a publishable já existe) → 3.0 banco de testes no GitHub → 3.1 a 3.4 → 4 → 5.
- **Próximo:** fases do iMed Agenda acima; Turnstile e TURN; domínio próprio antes do 1º documento real.

## Pendências que dependem do Dr. Rafael
- Razão social e CNPJ do IMED → `sobre.html` (hoje "em atualização"). Termos de uso: pedir revisão de um advogado.
- Comprar domínio (ex.: imed.com.br; dá para ver na Hostinger) → trocar `siteUrl` em `assets/js/config.js`.
- Cobrança pelo site: abrir conta num meio de pagamento (Mercado Pago, Asaas…); até lá, o painel de gestão registra as cobranças feitas por fora.
- Número de WhatsApp do IMED → `whatsapp` em `assets/js/config.js`.
- Conectar **Resend** (e-mail) → SMTP no Supabase Auth; e Auth → URL Configuration com o endereço do site.
- Aprovar quando o Supabase pedir confirmação de SQL (o tempo esgota se ninguém responde).
- Segurança: manter "Confirm email" ligado; entrar no `painel.html` pelo link do e-mail (cria a conta de admin) e depois rodar `select * from private.vincular_admin();`; 2FA no Supabase e no GitHub; backup (plano Pro, custo).
- Teleconsulta: inscrição da empresa no CRM (CREMESP) com diretor técnico antes de atender; certificado digital ICP-Brasil para assinar documentos; advogado revisar termo e textos; aprovar médicos em `medico.html` só depois de conferir identidade e CRM.

→ Detalhes técnicos: `memory/context/arquitetura.md` · Histórico: `memory/projects/`
