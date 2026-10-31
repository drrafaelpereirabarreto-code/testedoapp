# Arquitetura do IMED (referência técnica)

## Páginas
| Arquivo | Para quê |
|---------|----------|
| `index.html` | Início: cidade 3D (`assets/js/hero3d.js`), "Clínicas perto de você" (#reais: os 10 mais perto, abas por tipo, mapa e seletor "Onde você está?"), agendados, lista de espera |
| `assets/js/inicio-perto.js` + `inicio-core.js` | Início "perto de você": pede a localização ao abrir (1 vez por aba; não pede sozinho depois de 2 recusas ou pedidos sem resposta), lista e mapa (no celular, mapa em tela cheia só depois do toque), seletor de cidade. Regras puras em `inicio-core.js` (testadas em `tests/inicio-core.test.mjs`; posição simulada nos e2e com `tests/geo-simulado.mjs`) |
| `perto.html` + `assets/js/perto.js` | Busca por localização/CEP: mapa, lista, filtros, detalhes, pedido |
| `assets/js/geo-core.js` | Regras puras (normalizar, filtrar, ordenar, pedido) — testadas em `tests/geo-core.test.mjs` |
| `assets/js/exames-nomes.js` | Dicionário de nomes de exames (nome popular, sigla, uma letra errada → código da busca; "eco" e doença sozinha perguntam). Baixado só quando a pessoa digita (início, busca e área do médico); testes em `tests/exames-nomes.test.mjs` |
| `assets/js/auth.js` | Login por link mágico (Supabase Auth via REST) para conta, painel e reivindicação |
| `parceiros.html` | Cadastro de clínicas/médicos parceiros (`partner_leads`) |
| `exames/` | Guias de preparo dos exames |
| `privacidade.html` | Política de privacidade (LGPD) |
| `sw.js` | Service worker: scripts/páginas pela internet primeiro; suba `VERSION` a cada mudança |
| `teleconsulta.html` + `assets/js/teleconsulta.js` | Paciente: termo, fila, vídeo (WebRTC direto, sinalização pelo banco), chat, resumo e documentos |
| `medico.html` + `assets/js/medico.js` | Médico: cadastro, fila, atendimento, documentos (PDF com `assets/vendor/pdf-lib`, QR) e admin (aprovar médicos) |
| `assets/js/tele-core.js`, `assets/js/tele-docs.js` | Regras puras da teleconsulta e dos documentos (testadas em `tests/tele-*.test.mjs`) |
| `documento.html` | Conferência pública de documento pelo código (só tipo, data, médico, iniciais, situação) |
| `gestao.html` + `assets/js/gestao.js`, `gestao-core.js` | Painel de gestão só do admin (`noindex`, fora da navegação, sem contador): pacientes atendidos, funil do paciente, entrada de médicos (fluxograma com números) e clínicas, resultados, faturamento e cobrança (registro manual, CSV). Gráficos SVG feitos à mão, com tabela em "Ver em tabela" |
| `para-medicos.html` | Página pública "Atenda pelo IMED": requisitos, situação do IMED, fluxograma da inscrição até o atendimento, perguntas |
| `contato.html`, `como-funciona.html`, `acessibilidade.html` | Fale com o IMED (protocolo), regras do site, acessibilidade |
| `scripts/rodape.mjs`, `aplicar-rodape.mjs`, `aplicar-visitas.mjs`, `fontes.mjs` | Rodapé único, contador de visitas em todas as páginas, letras e ícones do próprio site (rode depois de criar página) |

## Página inicial "perto de você" (decisões)
- Decisão do Dr. Rafael (30/10): a página inicial pede a localização assim que abre. A busca (`perto.html`) continua
  pedindo só no toque. O aviso do Lighthouse sobre "pede localização ao carregar" é esperado na página inicial.
- A posição fica só na memória da página (arredondada, ~110 m): nunca vai para o aparelho, o endereço ou o banco.
- Chaves do aparelho: `imed_cidade` e `imed_cidades_recentes` (cidade escolhida no seletor), `imed_geo_recusas`
  (contagem de recusas), `imed_geo_pedido` (sessionStorage: já pediu nesta aba). A chave antiga `imed_place`
  (bairros de São Paulo) é apagada ao abrir.
- Aviso LGPD: com `data-lgpd-depois` no `<html>`, `assets/js/aviso.js` espera a página chamar `IMED_LGPD.mostrar()`
  (depois da resposta do pedido de localização), ou aparece sozinho em 15 s.
- Botão voltar do celular: mapa em tela cheia e seletor de cidade entram no histórico (`history.pushState` com
  `imedMapa` / `imedCid`), então "voltar" fecha o que está aberto em vez de sair da página.

## Supabase (`pyoqiecupxhdzigjudyd`)
- Migrações em `supabase/migrations` com o **mesmo número de versão aplicado no banco** (confira `list_migrations` e renomeie o arquivo).
- Edge Functions: `clinicas-proximas` (busca pública: parceiros + CNES + cobertura; Google Places opcional) e
  `importar-clinicas` (importa CNES por cidade; aceita chave service_role ou token interno `x-imed-token`; deploy com `verify_jwt=false`).
- Tabelas principais: `clinics`, `clinic_exams`, `clinic_members`, `appointment_requests`, `reviews`,
  `establishments`, `municipalities`, `establishment_imports`, `establishment_claims`, `import_queue`,
  `partner_leads`, `app_waitlist`, `admin_emails` (quem é admin).
- RPCs públicas: `nearby_clinics`, `nearby_establishments` (filtros p_kind/p_exam/p_sus, p_offset e `total`),
  `establishment_points` (pontos leves da área toda para o mapa, até 5.000), `imported_cities`, `city_establishments`,
  `request_status`, `submit_review`, `place_ratings`, `place_reviews`, `available_slots`.
- RPCs logadas: `set_request_status`, `update_my_clinic`, `set_my_clinic_exams`, `approve_claim`, `reject_claim`, `is_imed_admin`.
- Teleconsulta (`..._teleconsulta`, `..._tele_documentos`): tabelas `doctors`, `doctor_checks`, `teleconsultations`,
  `tele_messages`, `tele_record_*`, `tele_access_log`, `tele_documents`, `tele_document_files`; tudo por funções `tele_*`
  (paciente com id + token; médico aprovado; admin). Quem lê prontuário: `tele_record_readers`. Job `imed-teleconsulta-expira`.
  Receita só simples (antibiótico/controlados bloqueados: SNCR da Anvisa). Versão do termo em `tele-core.js` (TCLE_VERSION) e no SQL.
- Gestão (`20261030163758_gestao`): `admin_gestao(p_days)` (todos os números do painel, contrato no comentário da
  migração), `admin_cobranca_listar/salvar/status` e as tabelas `private.billing_charges` e `private.billing_charge_log`
  (histórico só de situação, valor, vencimento e pagamento). Tudo confere `is_imed_admin`. O site não recebe pagamento:
  a equipe registra as cobranças feitas por fora.
- Painel do médico (`20261030191354_painel_medico`): `tele_painel_medico()` (só médico aprovado; 7 números, nenhum dado
  de paciente) e `admin_gestao` com a chave `agora` (aguardando, espera mais longa, em atendimento, médicos disponíveis).
- Confiança/visitas (`..._confianca`, `..._visitas`): `cancel_request`, `send_contact`, avisos de erro de locais,
  conferência de clínica, `cnes_last_update(p_city)`, `track` (contador agregado em `private.*_daily`), `admin_stats`.
- pg_cron: `imed-fila-importacao` (a cada minuto, 2 cidades) e `imed-atualizacao-mensal`. A fila tem 316 cidades
  (capitais, grandes e as de ~100 mil habitantes ou mais); `imported_cities()` → `scripts/cidades.json` → `node scripts/gerar-cidades.mjs`.
- Segurança (migração `20261030074604_seguranca`): `is_imed_admin` só vale para a conta certa, com e-mail confirmado,
  login só por e-mail e sessão aberta pelo link (nunca senha/anônimo); depois da 1ª entrada do admin rode
  `select * from private.vincular_admin();`. `submit_review` usa `is true` (sem brecha de nulo). Quem mexer nessas
  funções mantém as regras.

## Limitações conhecidas do ambiente do Claude
- A sessão na nuvem não acessa supabase.co, IBGE, CNES nem Photon diretamente; usar o conector Supabase (SQL/MCP).
- Overpass/Nominatim bloqueiam servidores do Supabase → OpenStreetMap roda no navegador.
- Para testar chamadas HTTP pelo banco: extensão `http` (instalar só para o teste e remover depois).
- No modo automático, envio forçado (`push -f`) é bloqueado: a cópia de segurança em `wip/melhorias` é um commit com
  dois pais (HEAD e a ponta antiga da wip), enviado sem forçar. Commits de trabalho de agentes: testar e
  commitar a partir de uma `git worktree` limpa e depois `git reset <commit>` (sem --hard) na pasta principal.
- O registro das execuções do GitHub (logs e artifacts) fica num armazenamento bloqueado daqui. Para ver por que um
  teste falhou: `gh api repos/<repo>/check-runs/<job>/annotations` — o testes.yml põe em cada aviso até 14 linhas do erro.
  Cada envio para a main cancela a execução de testes anterior que ainda estiver rodando (concurrency).
- Os mapas (OpenStreetMap) também ficam bloqueados daqui: o vídeo de divulgação é gravado no GitHub.

## Vídeo de divulgação
- `scripts/gravar-video.mjs` (Playwright + ffmpeg) grava o site no ar com dados reais: início, mapa com locais reais,
  busca de ressonância, resultados, página do local, médico responsável e cartão final. Não envia pedido e não conta
  visita. A teleconsulta fica de fora até a inscrição no CREMESP.
- Rodar: Actions → "Vídeo de divulgação" → Run workflow (`gh workflow run video.yml -f formatos=vertical,horizontal`).
  O resultado vai para o ramo `video/execucao-N` (baixar com `git fetch --depth 1 origin refs/heads/video/execucao-N`).
- Escala de verdade no Chromium (`--force-device-scale-factor`, sem viewport emulado): com a escala só emulada os
  quadros saem pequenos. No computador grava com "movimento reduzido": a cidade 3D sem placa de vídeo deixa a página
  quase parada (no celular ela é menor e gira normalmente).

## Testes
```bash
node --test tests/*.test.mjs
node --experimental-strip-types --test supabase/functions/*/lib.test.ts
node tests/e2e-perto.mjs   # e e2e-inicio, e2e-local, e2e-conta, e2e-clinica
```
- `E2E_PORT=<porta>` roda um e2e em outra porta (para rodar em paralelo); `ONLY="trecho"` no e2e-perto roda só alguns cenários.
- Celular: no modo celular do Playwright, quando algo passa da tela o navegador afasta o zoom e o `innerWidth` cresce
  junto; para conferir rolagem lateral, medir contra a largura configurada (ex.: 360), não contra `innerWidth`.
- GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada envio para a main; veja com `gh run list`.
