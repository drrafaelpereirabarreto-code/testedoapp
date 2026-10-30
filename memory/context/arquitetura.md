# Arquitetura do IMED (referência técnica)

## Páginas
| Arquivo | Para quê |
|---------|----------|
| `index.html` | Início: cidade 3D (`assets/js/hero3d.js`), mapa de clínicas reais (#reais), agendados, lista de espera |
| `perto.html` + `assets/js/perto.js` | Busca por localização/CEP: mapa, lista, filtros, detalhes, pedido |
| `assets/js/geo-core.js` | Regras puras (normalizar, filtrar, ordenar, pedido) — testadas em `tests/geo-core.test.mjs` |
| `assets/js/auth.js` | Login por link mágico (Supabase Auth via REST) para conta, painel e reivindicação |
| `parceiros.html` | Cadastro de clínicas/médicos parceiros (`partner_leads`) |
| `exames/` | Guias de preparo dos exames |
| `privacidade.html` | Política de privacidade (LGPD) |
| `sw.js` | Service worker: scripts/páginas pela internet primeiro; suba `VERSION` a cada mudança |

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

## Testes
```bash
node --test tests/*.test.mjs
node --experimental-strip-types --test supabase/functions/*/lib.test.ts
node tests/e2e-perto.mjs   # e e2e-inicio, e2e-local, e2e-conta, e2e-clinica
```
- `E2E_PORT=<porta>` roda um e2e em outra porta (para rodar em paralelo); `ONLY="trecho"` no e2e-perto roda só alguns cenários.
- GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada envio para a main; veja com `gh run list`.
