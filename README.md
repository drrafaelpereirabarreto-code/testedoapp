# IMED

Marketplace de saúde: clínicas de imagem, laboratórios e centros de diagnóstico perto de você, com pedido de agendamento e teleconsulta. Protótipo publicado em <https://drrafaelpereirabarreto-code.github.io/testedoapp/>.

## Arquitetura

| Parte | Tecnologia | Onde |
| --- | --- | --- |
| Site e app instalável (PWA) | HTML, CSS e JavaScript sem etapa de build, GitHub Pages | raiz do repositório |
| Mapa interativo | Leaflet 1.9.4 (copiado em `assets/vendor/leaflet`) com imagens do OpenStreetMap | `perto.html` |
| Banco de dados | Supabase (PostgreSQL + PostGIS), região São Paulo | `supabase/migrations` |
| Servidor da busca | Supabase Edge Function `clinicas-proximas` (Deno) | `supabase/functions/clinicas-proximas` |
| Estabelecimentos do mapa | Google Places API (New), se a chave estiver no servidor; senão OpenStreetMap (Overpass) | — |
| CEP, cidade e endereço | ViaCEP e BrasilAPI (CEP) + Google Geocoding ou Photon (OpenStreetMap) | — |

Páginas principais:

- `index.html`: página inicial com o botão **Encontrar clínicas perto de mim**, as clínicas de exemplo do protótipo, teleconsulta e agendamentos.
- `perto.html`: busca por localização ou por CEP, cidade ou endereço. Tem mapa, lista, filtros, detalhes e pedido de agendamento.
- `parceiros.html`: cadastro de clínicas e médicos parceiros.
- `exames/`: guias de preparo dos exames.

## Como funciona a busca "perto de mim"

1. A pessoa toca em **Encontrar clínicas perto de mim** (`perto.html?usar=localizacao`). O navegador pede a permissão de localização. Se a pessoa entrar direto em `perto.html`, a página explica o uso da localização e só pede a permissão depois de um toque.
2. A posição é arredondada para 3 casas decimais (cerca de 110 m) assim que chega e fica só na memória da página. A localização precisa não é pedida (`enableHighAccuracy: false`).
3. O site chama a Edge Function `clinicas-proximas` com a ação `search`. A função consulta o banco pela função `nearby_clinics`, que devolve as clínicas IMED publicadas dentro do raio, ordenadas pela distância real (PostGIS `ST_DWithin` + `ST_Distance`). Se a chave do Google estiver configurada, a função também busca no Google Places.
4. Sem a chave do Google, o próprio navegador busca os estabelecimentos no OpenStreetMap (Overpass). Os servidores públicos do OpenStreetMap recusam pedidos vindos de servidores em nuvem, e essa busca não precisa de chave.
5. O site junta as fontes e não repete no mapa uma clínica que já é parceira. Ele classifica cada estabelecimento (imagem, laboratório, clínica ou hospital) e reconhece os exames pelo nome. Os filtros são exame, tipo, especialidade, distância e faixa de preço.
6. Preço e horário só aparecem quando vêm da fonte: a clínica parceira (banco do IMED), o OpenStreetMap ou o Google. Nada é estimado. Sem preço informado, aparece "Preço sob consulta".
7. O pedido de agendamento grava uma linha em `appointment_requests`. A linha guarda o estabelecimento escolhido e os dados de contato, não a localização. Para clínicas parceiras, o pedido vai para a clínica. Para estabelecimentos do mapa, a equipe do IMED faz a ponte ("Pedir ao IMED para agendar").

Sem permissão de localização, a pessoa digita CEP, cidade ou endereço. A Edge Function faz a geocodificação (ação `geocode`) e a busca segue igual.

Estados tratados na tela:

- carregando;
- sem resultados (com sugestão de aumentar a distância);
- localização negada, indisponível, demorada ou sem suporte;
- falha do servidor (o site busca as clínicas IMED direto no banco);
- falha do mapa (aviso e só parceiros);
- falha total (botão "Tentar de novo");
- erro ao enviar o pedido.

## Chaves e variáveis de ambiente

O site só usa a chave pública `anon` do Supabase (`assets/js/config.js`). Ela é pública por natureza: as regras de segurança do banco (RLS) só deixam o público ver clínicas publicadas e inserir pedidos. Ninguém de fora consegue ler os pedidos.

As chaves secretas ficam só no servidor, como segredos da Edge Function (modelo em `supabase/functions/.env.example`):

| Variável | Para quê |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Opcional. Ativa Google Places API (New) e Geocoding API. Sem ela, a busca usa OpenStreetMap. |
| `ALLOWED_ORIGINS` | Sites que podem chamar a função, separados por vírgula. Padrão: o GitHub Pages do projeto e `localhost:8765`. |
| `NOMINATIM_CONTACT` | E-mail de contato enviado no User-Agent aos serviços do OpenStreetMap. |

Para configurar pelo terminal:

```bash
supabase secrets set --env-file supabase/functions/.env --project-ref pyoqiecupxhdzigjudyd
```

Também dá para configurar pelo painel: Supabase → Edge Functions → Secrets.

### Como restringir a chave do Google

- Crie uma chave só para o servidor. Em **Restrições de API**, permita apenas **Places API (New)** e **Geocoding API**.
- As Edge Functions não têm IP fixo, então a restrição por IP não se aplica. Proteja a chave com cotas diárias por API e um alerta de orçamento no Google Cloud.
- Nunca coloque essa chave no site, no Git ou em mensagens. Se vazar, gere outra e apague a antiga.
- Se um dia o site usar o Maps JavaScript API no navegador, crie outra chave, restrita por referenciador HTTP (`https://drrafaelpereirabarreto-code.github.io/*`) e só às APIs do navegador.

## Banco de dados

As migrações estão em `supabase/migrations`:

- `clinics`: clínicas parceiras com localização (`geography(point)`), contato, especialidades, horário (opcional) e situação (`draft`, `published`, `suspended`).
- `clinic_exams`: exames de cada clínica, com preço em centavos. O preço fica vazio até a clínica informar.
- `appointment_requests`: pedidos de agendamento. Um gatilho confere a data (de hoje até 120 dias) e se a clínica aceita pedidos, e sempre grava o status `pending`.
- `nearby_clinics(...)`: busca por raio, com filtros de exame, tipo, especialidade e preço, ordenada por distância.

### Cadastrar uma clínica parceira

```sql
with c as (
  insert into public.clinics (name, kind, address_line, neighborhood, city, state, cep, location,
                              phone, whatsapp, specialties, opening_hours, accepts_online_booking, status)
  values ('Clínica Exemplo', 'imagem', 'Rua Exemplo, 100', 'Centro', 'São Paulo', 'SP', '01000-000',
          extensions.st_setsrid(extensions.st_makepoint(-46.6333, -23.5505), 4326)::extensions.geography,
          '(11) 3000-0000', '5511999999999', '{Radiologia}',
          '{"seg": "07:00–19:00", "sab": "08:00–12:00"}', true, 'published')
  returning id
)
insert into public.clinic_exams (clinic_id, exam_code, price_cents, price_updated_at)
select id, e.code, e.price, now() from c,
  (values ('rx', 9000), ('usg', null::integer)) as e(code, price);
```

O ponto é `st_makepoint(longitude, latitude)`, nessa ordem. Deixe `price_cents` vazio (`null`) quando a clínica não informar o preço.

### Pedidos de agendamento

Só administradores leem os pedidos. Para isso, o e-mail precisa estar em `admin_emails` e a pessoa precisa entrar com Supabase Auth. Também dá para ver os pedidos no Table Editor do painel:

```sql
select created_at, place_name, place_source, exam_code, preferred_date, preferred_period,
       patient_name, patient_phone, status
from public.appointment_requests
order by created_at desc;
```

### Clínicas de demonstração

As 12 clínicas fictícias do protótipo estão no banco com `is_demo = true`, sem preço e sem horário. Elas não aparecem na busca normal. Para ver o fluxo completo de parceiros, abra `perto.html?demo=1` e use um endereço em São Paulo (por exemplo, o botão "Testar na Av. Paulista").

Para apagá-las:

```sql
delete from public.clinics where is_demo;
```

## Publicar

- Site: faça o push para a branch `main`. O GitHub Pages publica sozinho. Ao mudar arquivos do site, aumente `VERSION` em `sw.js` para os celulares baixarem a nova versão.
- Edge Function:

```bash
supabase functions deploy clinicas-proximas --project-ref pyoqiecupxhdzigjudyd
```

- Banco: aplique as novas migrações de `supabase/migrations`, por exemplo com `supabase db push`.

## Testes

```bash
node --test tests/*.test.mjs
```

```bash
node --experimental-strip-types --test supabase/functions/clinicas-proximas/lib.test.ts
```

```bash
node tests/e2e-perto.mjs
```

1. Regras de busca do site: classificação, filtros, distância e validação do pedido.
2. Lógica da Edge Function: Google Places, CEP e geocodificação.
3. Ponta a ponta num navegador de verdade. Precisa do pacote `playwright`. Simula localização, servidor, banco e OpenStreetMap, e cobre página inicial, busca, filtros, detalhes, pedido e todos os estados de erro.

## Privacidade

- A localização só é usada depois da permissão do navegador. Ela é arredondada (cerca de 110 m) antes de sair do aparelho.
- A localização não é gravada no banco, nos logs da função nem no aparelho. O pedido de agendamento não leva a localização.
- O pedido pede consentimento específico, porque o exame é um dado de saúde (LGPD, art. 11).
- Detalhes em `privacidade.html`.
