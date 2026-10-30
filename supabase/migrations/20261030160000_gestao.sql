-- Gestão do IMED e cobranças (30/10/2026). Só para a equipe do IMED (admin).
--
-- Em linguagem simples, esta migração:
--   1. Cria public.admin_gestao(p_days): os números do IMED nos últimos p_days dias (contando hoje; dia de São Paulo)
--      para a página de gestão, separada da página inicial (paciente não vê): visitas e o caminho do paciente no site
--      (funil), pedidos de agendamento, teleconsultas, documentos médicos, avaliações, médicos (inscritos, em análise,
--      aprovados, atendendo agora), clínicas parceiras, pedidos de cadastro, mensagens e o resumo da cobrança.
--      Tudo vem das próprias tabelas do site e do contador de visitas próprio. Só contagens e somas: nenhum dado de
--      paciente. Nada é inventado: número que não dá para calcular (uma média sem nenhum caso) volta null e a tela
--      mostra "—"; zero é zero.
--   2. Cria a tabela das cobranças, private.billing_charges, no schema private (a API não alcança): cada linha é uma
--      cobrança (teleconsulta, mensalidade ou comissão de clínica, outro), com o valor em centavos, o vencimento e a
--      situação (pendente, pago ou cancelado). A equipe do IMED registra o que cobrou e o que recebeu: nada é cobrado
--      sozinho de ninguém. Ninguém lê nem escreve direto na tabela (RLS ligado, sem política e sem permissão para
--      anon/authenticated): só pelas funções abaixo.
--   3. Cria as funções da cobrança: admin_cobranca_listar (lista), admin_cobranca_salvar (cria ou edita) e
--      admin_cobranca_status (marca como paga, cancela ou volta para pendente).
--
-- Quem pode usar: só a equipe do IMED (public.is_imed_admin(), as mesmas regras do painel; esta migração não mexe
-- nela). Qualquer outra pessoa recebe o erro 42501 'forbidden'. Dado inválido: erro 22023 com uma mensagem curta em
-- português, que a tela mostra (quando ajuda, a lista do que vale vai em "details").
-- Nada é apagado (nenhum DROP, DELETE ou TRUNCATE) e tudo pode rodar de novo sem erro. As tabelas lidas são todas de
-- migrações anteriores, já aplicadas (por isso não há to_regclass); a das cobranças se liga à teleconsulta e às clínicas.
--
-- Regras dos números de admin_gestao (período = de "de" até "ate", dias de São Paulo; "feito no período" = criado
-- num desses dias):
--   serie: um item por dia, em ordem. visitas = páginas abertas no dia (contador próprio, private.page_views_daily:
--     são visualizações de página, não pessoas); pedidos = pedidos de agendamento feitos no dia; tele_pedidas =
--     teleconsultas pedidas no dia; tele_encerradas = dessas, as que terminaram (encerradas); documentos = documentos
--     médicos emitidos no dia (inclusive os cancelados depois). Somando a série, dá os totais de pacientes e do funil.
--   pacientes.pedidos: pedidos feitos no período, pela situação de hoje (pendente = pending, contatado = contacted,
--     confirmado = confirmed, cancelado = cancelled, concluido = completed); parceiro = para clínica parceira
--     (clinic_id preenchido); concierge = para local do cadastro oficial, que a equipe do IMED liga e marca (clinic_id
--     vazio; a aba "Pedidos ao IMED" do painel usa a mesma regra).
--   pacientes.tele: teleconsultas pedidas no período, pela situação de fato (private.tele_effective_status: quem espera
--     há mais de 2 h já conta como expirada, mesmo antes da limpeza automática). espera_media_min = média do pedido até
--     o médico aceitar (só as aceitas); duracao_media_min = média do início ao fim das encerradas, fora as que o sistema
--     encerrou depois de 3 h (a duração real delas não se sabe). Sem nenhum caso: null.
--   pacientes.atendidos = pacientes.tele.encerrada + pacientes.pedidos.concluido. O pedido não guarda a data em que foi
--     concluído: conta o pedido feito no período que hoje está concluído.
--   pacientes.documentos: documentos emitidos no período; por_tipo traz os 7 tipos (zero quando não houve);
--     cancelados = os que foram cancelados depois; pdf_assinado = com o PDF assinado pelo médico (tele_document_files).
--   pacientes.avaliacoes: avaliações publicadas no período (as escondidas pela moderação ficam fora); media com 1 casa.
--   funil: visitas = todas as páginas abertas no período; abriram_busca, abriram_local e abriram_tele = vezes que
--     /perto.html, /local.html e /teleconsulta.html foram abertas; pedidos = pacientes.pedidos.total; confirmados =
--     confirmados + concluídos (todo concluído passou pela confirmação); concluidos; tele_fila = teleconsultas pedidas
--     (todas entram na fila); tele_atendidas = as que o médico aceitou e estão aceitas, em atendimento ou encerradas;
--     tele_encerradas; tele_com_documento = teleconsultas do período com pelo menos 1 documento válido (não cancelado).
--   medicos: inscritos_periodo = cadastros feitos no período; pendente, aprovado, recusado e suspenso = situação de hoje
--     de todos os cadastros; disponiveis_agora = aprovados com a página de atendimento aberta (mesma regra de
--     tele_doctors_online); aprovacao_media_horas = média da inscrição até a aprovação, dos aprovados no período (quem
--     voltou para análise depois de mudar os dados conta desde a inscrição; sem aprovação: null); aguardando = cadastros
--     em análise, mais antigos primeiro, até 50 (desde = data da inscrição).
--   clinicas: parceiras = clínicas publicadas, sem as fictícias de demonstração (is_demo); com_agenda = parceiras com a
--     agenda de horários ativa no site (aceitam pedido pelo site e têm horário cadastrado); com_preco = parceiras com pelo
--     menos 1 exame com preço informado; interessadas = cadastros "Seja parceiro" de clínicas feitos no período
--     (partner_leads); reivindicacoes = todos os pedidos de cadastro do CNES, pela situação de hoje (os pendentes são a
--     fila de trabalho, mesmo os antigos).
--   outros (feitos no período): lista_espera = inscrições na lista de espera; contatos = mensagens do Fale com o IMED;
--     avisos_de_erro = avisos "Algo errado aqui?" (o mesmo problema avisado de novo, ainda em aberto, conta 1).
--   cobranca: faturado_cents e qtd_pagas = cobranças pagas no período (pelo dia do pagamento); a_receber_cents e
--     qtd_pendentes = todas as pendentes; atrasado_cents = pendentes com vencimento antes de hoje; cancelado_cents =
--     todas as canceladas (a tabela não guarda a data do cancelamento); por_mes = últimos 12 meses, o atual por último:
--     faturado = pagas no mês (pelo dia do pagamento), a_receber = pendentes com vencimento no mês.
--
-- Contrato das chamadas (PostgREST, com a sessão de um admin):
--   POST /rest/v1/rpc/admin_gestao           {"p_days": 30}   (1 a 366; fora disso, o mais perto)  -> jsonb:
--     { dias, de, ate, gerado_em, serie: [{dia, visitas, pedidos, tele_pedidas, tele_encerradas, documentos}],
--       pacientes: { atendidos, pedidos: {total, pendente, contatado, confirmado, cancelado, concluido, parceiro,
--                    concierge}, tele: {total, aguardando, aceita, em_atendimento, encerrada, cancelada, expirada,
--                    espera_media_min, duracao_media_min}, documentos: {total, por_tipo: {tipo: n}, cancelados,
--                    pdf_assinado}, avaliacoes: {total, media} },
--       funil: {visitas, abriram_busca, abriram_local, pedidos, confirmados, concluidos, abriram_tele, tele_fila,
--               tele_atendidas, tele_encerradas, tele_com_documento},
--       medicos: {inscritos_periodo, pendente, aprovado, recusado, suspenso, disponiveis_agora, aprovacao_media_horas,
--                 aguardando: [{id, nome, crm, uf, especialidade, desde}]},
--       clinicas: {parceiras, com_agenda, com_preco, interessadas, reivindicacoes: {pendente, aprovado, recusado}},
--       outros: {lista_espera, contatos, avisos_de_erro},
--       cobranca: {faturado_cents, a_receber_cents, atrasado_cents, cancelado_cents, qtd_pagas, qtd_pendentes,
--                  por_mes: [{mes: "AAAA-MM", faturado_cents, a_receber_cents}]} }
--   POST /rest/v1/rpc/admin_cobranca_listar  {"p_status": "pendente" | "pago" | "cancelado" | null, "p_limite": 200}
--     -> [cobrança, ...] (mais nova primeiro; p_limite de 1 a 1000)
--   POST /rest/v1/rpc/admin_cobranca_salvar  {"p": {...}}  -> a cobrança salva
--   POST /rest/v1/rpc/admin_cobranca_status  {"p_id": "uuid", "p_status": "pago", "p_forma": "pix"}  -> a cobrança
--   cobrança: { id, criado_em, tipo, descricao, pagador_tipo, pagador_nome, valor_cents, vencimento, status, pago_em,
--               forma, obs, teleconsulta_id, clinica_id }
--   Datas: "AAAA-MM-DD"; data e hora: "AAAA-MM-DDTHH:MM:SSZ" (UTC), como gerado_em e desde.
--   admin_cobranca_salvar: sem "id" cria (tipo, descricao, pagador_tipo e valor_cents obrigatórios; vencimento padrão
--     hoje; status padrão pendente). Com "id" edita só os campos enviados; null num campo opcional (pagador_nome, forma,
--     obs, teleconsulta_id, clinica_id) apaga; vencimento e status com null ficam como estão. pago_em aceita
--     "AAAA-MM-DD" (meia-noite de São Paulo), data e hora sem fuso (hora de São Paulo) ou com fuso ("Z", "-03:00");
--     sem pago_em, vale agora quando a cobrança vira paga (a que já estava paga mantém a data); cobrança não paga fica
--     sem data de pagamento. Outros campos (ex.: criado_em, que a lista devolve) são ignorados.
--   admin_cobranca_status: "pago" grava agora como data do pagamento (a que já estava paga mantém a data); p_forma vazio
--     mantém a forma gravada; "pendente" e "cancelado" tiram a data do pagamento.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/* ===================== 1. Tabela das cobranças ===================== */
create table if not exists private.billing_charges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  kind text not null check (kind in ('teleconsulta', 'mensalidade_clinica', 'comissao_clinica', 'outro')),
  description text not null check (char_length(description) between 3 and 200),
  payer_type text not null check (payer_type in ('paciente', 'clinica', 'medico', 'outro')),
  payer_name text check (payer_name is null or char_length(payer_name) between 1 and 120),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  due_date date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  paid_at timestamptz,
  method text check (method is null or method in ('pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro')),
  notes text check (notes is null or char_length(notes) <= 500),
  teleconsultation_id uuid references public.teleconsultations (id) on delete set null,
  clinic_id uuid references public.clinics (id) on delete set null,
  -- Só a cobrança paga tem data de pagamento (e toda cobrança paga tem).
  constraint billing_charges_paid_ck check ((status = 'pago') = (paid_at is not null))
);
create index if not exists billing_charges_status_idx on private.billing_charges (status, created_at desc);
create index if not exists billing_charges_paid_idx on private.billing_charges (paid_at) where paid_at is not null;
create index if not exists billing_charges_tele_idx on private.billing_charges (teleconsultation_id);
create index if not exists billing_charges_clinic_idx on private.billing_charges (clinic_id);
comment on table private.billing_charges is 'Cobranças do IMED (teleconsulta, mensalidade ou comissão de clínica, outro), registradas pela equipe do IMED. Só as funções admin_cobranca_* e admin_gestao leem e escrevem (só admin).';
comment on column private.billing_charges.amount_cents is 'Valor em centavos (1 = R$ 0,01; máximo R$ 1.000.000,00).';
comment on column private.billing_charges.due_date is 'Vencimento (dia de São Paulo). Pendente com vencimento antes de hoje = atrasada.';
comment on column private.billing_charges.paid_at is 'Quando foi paga (só nas pagas). O faturado do período conta pelo dia deste pagamento (São Paulo).';
comment on column private.billing_charges.payer_name is 'Nome de quem paga (opcional). Só a equipe do IMED vê.';
comment on column private.billing_charges.created_by is 'Conta (auth.users) da equipe do IMED que criou a cobrança.';
comment on column private.billing_charges.updated_by is 'Conta (auth.users) da equipe do IMED que fez a última mudança.';

-- Segunda tranca: RLS ligado e sem política. Só as funções abaixo (dono postgres) leem e escrevem.
alter table private.billing_charges enable row level security;
revoke all on table private.billing_charges from public, anon, authenticated;

/* ===================== 2. Funções internas (só as funções abaixo usam) ===================== */
-- Data e hora em UTC no formato da tela: "2026-10-30T15:00:00Z" (nulo continua nulo).
create or replace function private.gestao_iso(p timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- Campo do JSON enviado pela tela, como texto: ausente, null ou só espaços = nulo; número vira texto; lista, objeto
-- ou verdadeiro/falso = erro 22023 com o nome do campo.
create or replace function private.billing_text(p jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  case coalesce(jsonb_typeof(p -> p_key), 'null')
    when 'null' then
      return null;
    when 'string' then
      return nullif(btrim(p ->> p_key, E' \t\r\n'), '');
    when 'number' then
      return p ->> p_key;
    else
      raise exception 'Formato inválido no campo "%".', p_key using errcode = '22023';
  end case;
end $$;

-- Uma cobrança no formato da tela (as chaves do contrato).
create or replace function private.billing_json(c private.billing_charges)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'criado_em', private.gestao_iso(c.created_at),
    'tipo', c.kind,
    'descricao', c.description,
    'pagador_tipo', c.payer_type,
    'pagador_nome', c.payer_name,
    'valor_cents', c.amount_cents,
    'vencimento', c.due_date,
    'status', c.status,
    'pago_em', private.gestao_iso(c.paid_at),
    'forma', c.method,
    'obs', c.notes,
    'teleconsulta_id', c.teleconsultation_id,
    'clinica_id', c.clinic_id);
$$;

revoke all on function private.gestao_iso(timestamptz) from public, anon, authenticated;
revoke all on function private.billing_text(jsonb, text) from public, anon, authenticated;
revoke all on function private.billing_json(private.billing_charges) from public, anon, authenticated;

/* ===================== 3. admin_gestao: os números do IMED ===================== */
-- Números do IMED nos últimos p_days dias (com hoje, dia de São Paulo) para a página de gestão. Só admin.
-- As regras de cada número estão no topo deste arquivo.
create or replace function public.admin_gestao(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_now timestamptz := now();
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts timestamptz := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts timestamptz := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_serie jsonb;
  v_pedidos jsonb;
  v_tele jsonb;
  v_docs jsonb;
  v_aval jsonb;
  v_funil jsonb;
  v_medicos jsonb;
  v_clinicas jsonb;
  v_outros jsonb;
  v_cobranca jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Série: um item por dia do período, em ordem (dia sem nada: zeros).
  with dias as (
    select v_from + i as dia from generate_series(0, v_days - 1) as i
  ), vis as (
    select v.day as dia, sum(v.views) as n
    from private.page_views_daily v
    where v.day between v_from and v_to
    group by v.day
  ), ped as (
    select (a.created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
    from public.appointment_requests a
    where a.created_at >= v_from_ts and a.created_at < v_to_ts
    group by 1
  ), tel as (
    select (t.created_at at time zone 'America/Sao_Paulo')::date as dia,
           count(*) as pedidas,
           count(*) filter (where private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) = 'ended') as encerradas
    from public.teleconsultations t
    where t.created_at >= v_from_ts and t.created_at < v_to_ts
    group by 1
  ), doc as (
    select (d.created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
    from public.tele_documents d
    where d.created_at >= v_from_ts and d.created_at < v_to_ts
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'dia', g.dia,
           'visitas', coalesce(vis.n, 0),
           'pedidos', coalesce(ped.n, 0),
           'tele_pedidas', coalesce(tel.pedidas, 0),
           'tele_encerradas', coalesce(tel.encerradas, 0),
           'documentos', coalesce(doc.n, 0)) order by g.dia)
    into v_serie
  from dias g
  left join vis on vis.dia = g.dia
  left join ped on ped.dia = g.dia
  left join tel on tel.dia = g.dia
  left join doc on doc.dia = g.dia;

  -- Pedidos de agendamento feitos no período, pela situação de hoje.
  select jsonb_build_object(
           'total', count(*),
           'pendente', count(*) filter (where a.status = 'pending'),
           'contatado', count(*) filter (where a.status = 'contacted'),
           'confirmado', count(*) filter (where a.status = 'confirmed'),
           'cancelado', count(*) filter (where a.status = 'cancelled'),
           'concluido', count(*) filter (where a.status = 'completed'),
           'parceiro', count(*) filter (where a.clinic_id is not null),
           'concierge', count(*) filter (where a.clinic_id is null))
    into v_pedidos
  from public.appointment_requests a
  where a.created_at >= v_from_ts and a.created_at < v_to_ts;

  -- Teleconsultas pedidas no período, pela situação de fato; e a parte da teleconsulta no funil.
  with t as (
    select x.id, x.created_at, x.accepted_at, x.started_at, x.ended_at, x.closed_by,
           private.tele_effective_status(x.status, x.created_at, x.accepted_at, x.started_at) as eff
    from public.teleconsultations x
    where x.created_at >= v_from_ts and x.created_at < v_to_ts
  )
  select jsonb_build_object(
           'total', count(*),
           'aguardando', count(*) filter (where t.eff = 'waiting'),
           'aceita', count(*) filter (where t.eff = 'accepted'),
           'em_atendimento', count(*) filter (where t.eff = 'in_call'),
           'encerrada', count(*) filter (where t.eff = 'ended'),
           'cancelada', count(*) filter (where t.eff = 'cancelled'),
           'expirada', count(*) filter (where t.eff = 'expired'),
           'espera_media_min', round(avg(extract(epoch from (t.accepted_at - t.created_at)) / 60)
                                       filter (where t.accepted_at is not null), 1),
           'duracao_media_min', round(avg(extract(epoch from (t.ended_at - t.started_at)) / 60)
                                        filter (where t.eff = 'ended' and t.started_at is not null and t.ended_at is not null
                                                  and t.closed_by is distinct from 'system'), 1)),
         jsonb_build_object(
           'tele_fila', count(*),
           'tele_atendidas', count(*) filter (where t.eff in ('accepted', 'in_call', 'ended')),
           'tele_encerradas', count(*) filter (where t.eff = 'ended'),
           'tele_com_documento', count(*) filter (where exists (
             select 1 from public.tele_documents d where d.consultation_id = t.id and d.status = 'emitido')))
    into v_tele, v_funil
  from t;

  -- Documentos médicos emitidos no período (os 7 tipos sempre aparecem; zero quando não houve).
  with d as (
    select x.kind, x.status, (f.document_id is not null) as pdf
    from public.tele_documents x
    left join public.tele_document_files f on f.document_id = x.id
    where x.created_at >= v_from_ts and x.created_at < v_to_ts
  ), k as (
    select unnest(array['exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes']) as kind
    union
    select d.kind from d
  )
  select jsonb_build_object(
           'total', (select count(*) from d),
           'por_tipo', (select jsonb_object_agg(k.kind, (select count(*) from d where d.kind = k.kind)) from k),
           'cancelados', (select count(*) from d where d.status = 'cancelado'),
           'pdf_assinado', (select count(*) from d where d.pdf))
    into v_docs;

  -- Avaliações publicadas no período.
  select jsonb_build_object('total', count(*), 'media', round(avg(r.rating), 1))
    into v_aval
  from public.reviews r
  where r.status = 'published' and r.created_at >= v_from_ts and r.created_at < v_to_ts;

  -- Funil: páginas abertas (contador próprio) e os pedidos do período.
  select v_funil || jsonb_build_object(
           'visitas', coalesce(sum(v.views), 0),
           'abriram_busca', coalesce(sum(v.views) filter (where v.path = '/perto.html'), 0),
           'abriram_local', coalesce(sum(v.views) filter (where v.path = '/local.html'), 0),
           'abriram_tele', coalesce(sum(v.views) filter (where v.path = '/teleconsulta.html'), 0),
           'pedidos', v_pedidos -> 'total',
           'confirmados', (v_pedidos ->> 'confirmado')::bigint + (v_pedidos ->> 'concluido')::bigint,
           'concluidos', v_pedidos -> 'concluido')
    into v_funil
  from private.page_views_daily v
  where v.day between v_from and v_to;

  -- Médicos: inscritos no período, situação de hoje e a fila de quem espera a conferência.
  select jsonb_build_object(
           'inscritos_periodo', count(*) filter (where d.created_at >= v_from_ts and d.created_at < v_to_ts),
           'pendente', count(*) filter (where d.status = 'pending'),
           'aprovado', count(*) filter (where d.status = 'approved'),
           'recusado', count(*) filter (where d.status = 'rejected'),
           'suspenso', count(*) filter (where d.status = 'suspended'),
           'disponiveis_agora', count(*) filter (where d.status = 'approved' and d.available_until > v_now),
           'aprovacao_media_horas', round(avg(extract(epoch from (d.reviewed_at - d.created_at)) / 3600)
                                            filter (where d.status = 'approved' and d.reviewed_at >= v_from_ts
                                                      and d.reviewed_at < v_to_ts), 1),
           'aguardando', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', w.id,
                      'nome', w.full_name,
                      'crm', w.crm,
                      'uf', w.crm_uf::text,
                      'especialidade', w.specialty,
                      'desde', private.gestao_iso(w.created_at)) order by w.created_at, w.id)
             from (select p.id, p.full_name, p.crm, p.crm_uf, p.specialty, p.created_at
                   from public.doctors p
                   where p.status = 'pending'
                   order by p.created_at, p.id
                   limit 50) w), '[]'::jsonb))
    into v_medicos
  from public.doctors d;

  -- Clínicas parceiras (sem as de demonstração), interessadas no período e pedidos de cadastro (situação de hoje).
  select jsonb_build_object(
           'parceiras', count(*),
           'com_agenda', count(*) filter (where c.accepts_online_booking
                                            and exists (select 1 from public.clinic_schedules s where s.clinic_id = c.id)),
           'com_preco', count(*) filter (where exists (select 1 from public.clinic_exams e
                                                       where e.clinic_id = c.id and e.price_cents is not null)),
           'interessadas', (select count(*) from public.partner_leads l
                            where l.partner_type = 'clinica' and l.created_at >= v_from_ts and l.created_at < v_to_ts),
           'reivindicacoes', (select jsonb_build_object(
                                       'pendente', count(*) filter (where r.status = 'pending'),
                                       'aprovado', count(*) filter (where r.status = 'approved'),
                                       'recusado', count(*) filter (where r.status = 'rejected'))
                              from public.establishment_claims r))
    into v_clinicas
  from public.clinics c
  where c.status = 'published' and not c.is_demo;

  -- Lista de espera, Fale com o IMED e avisos de erro feitos no período.
  select jsonb_build_object(
           'lista_espera', (select count(*) from public.app_waitlist w
                            where w.created_at >= v_from_ts and w.created_at < v_to_ts),
           'contatos', (select count(*) from public.contact_messages m
                        where m.created_at >= v_from_ts and m.created_at < v_to_ts),
           'avisos_de_erro', (select count(*) from public.place_reports r
                              where r.created_at >= v_from_ts and r.created_at < v_to_ts))
    into v_outros;

  -- Cobrança: faturado no período (pelo dia do pagamento), pendentes, atrasadas, canceladas e os últimos 12 meses.
  select jsonb_build_object(
           'faturado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pago'
                                                                     and b.paid_at >= v_from_ts and b.paid_at < v_to_ts), 0),
           'a_receber_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pendente'), 0),
           'atrasado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pendente' and b.due_date < v_to), 0),
           'cancelado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'cancelado'), 0),
           'qtd_pagas', count(*) filter (where b.status = 'pago' and b.paid_at >= v_from_ts and b.paid_at < v_to_ts),
           'qtd_pendentes', count(*) filter (where b.status = 'pendente'),
           'por_mes', (
             select jsonb_agg(jsonb_build_object(
                      'mes', to_char(m.ini, 'YYYY-MM'),
                      'faturado_cents', coalesce((
                        select sum(x.amount_cents) from private.billing_charges x
                        where x.status = 'pago'
                          and x.paid_at >= (m.ini at time zone 'America/Sao_Paulo')
                          and x.paid_at < ((m.ini + interval '1 month') at time zone 'America/Sao_Paulo')), 0),
                      'a_receber_cents', coalesce((
                        select sum(x.amount_cents) from private.billing_charges x
                        where x.status = 'pendente'
                          and x.due_date >= m.ini::date
                          and x.due_date < (m.ini + interval '1 month')::date), 0)) order by m.ini)
             from (select date_trunc('month', v_to::timestamp) - make_interval(months => 11 - i) as ini
                   from generate_series(0, 11) as i) m))
    into v_cobranca
  from private.billing_charges b;

  return jsonb_build_object(
    'dias', v_days,
    'de', v_from,
    'ate', v_to,
    'gerado_em', private.gestao_iso(v_now),
    'serie', coalesce(v_serie, '[]'::jsonb),
    'pacientes', jsonb_build_object(
      'atendidos', (v_tele ->> 'encerrada')::bigint + (v_pedidos ->> 'concluido')::bigint,
      'pedidos', v_pedidos,
      'tele', v_tele,
      'documentos', v_docs,
      'avaliacoes', v_aval),
    'funil', v_funil,
    'medicos', v_medicos,
    'clinicas', v_clinicas,
    'outros', v_outros,
    'cobranca', v_cobranca);
end $$;
comment on function public.admin_gestao(integer) is 'Números do IMED para a página de gestão (só admin): visitas, funil, pedidos, teleconsultas, documentos, avaliações, médicos, clínicas, mensagens e cobrança, nos últimos p_days dias (São Paulo). Só contagens e somas, sem dado de paciente.';

/* ===================== 4. Cobranças ===================== */
-- Lista as cobranças, mais nova primeiro: todas ou só de uma situação (pendente, pago ou cancelado). Só admin.
create or replace function public.admin_cobranca_listar(p_status text default null, p_limite integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limite, 200), 1), 1000);
  v_out jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('pendente', 'pago', 'cancelado') then
    raise exception 'Situação inválida.' using errcode = '22023',
      detail = 'Use pendente, pago ou cancelado (ou nada, para todas).';
  end if;
  select coalesce(jsonb_agg(private.billing_json(b) order by b.created_at desc, b.id desc), '[]'::jsonb)
    into v_out
  from private.billing_charges b
  where b.id in (select c.id from private.billing_charges c
                 where v_status is null or c.status = v_status
                 order by c.created_at desc, c.id desc
                 limit v_limit);
  return v_out;
end $$;
comment on function public.admin_cobranca_listar(text, integer) is 'Lista as cobranças do IMED (mais nova primeiro), todas ou de uma situação. Só admin.';

-- Cria (sem "id") ou edita (com "id": só os campos enviados) uma cobrança e devolve como ficou. Só admin.
create or replace function public.admin_cobranca_salvar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_new boolean;
  v_row private.billing_charges;
  v_txt text;
  v_date date;
  v_paid timestamptz;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da cobrança inválidos.' using errcode = '22023';
  end if;

  -- Sem "id": cobrança nova, com os valores padrão. Com "id": começa da cobrança gravada.
  v_txt := lower(private.billing_text(p, 'id'));
  v_new := v_txt is null;
  if v_new then
    v_row.status := 'pendente';
    v_row.due_date := v_today;
  else
    if v_txt !~ v_uuid then
      raise exception 'Cobrança não encontrada.' using errcode = '22023';
    end if;
    select * into v_row from private.billing_charges b where b.id = v_txt::uuid for update;
    if not found then
      raise exception 'Cobrança não encontrada.' using errcode = '22023';
    end if;
  end if;

  -- Tipo (obrigatório na cobrança nova).
  if v_new or p ? 'tipo' then
    v_txt := lower(private.billing_text(p, 'tipo'));
    if v_txt is null or v_txt not in ('teleconsulta', 'mensalidade_clinica', 'comissao_clinica', 'outro') then
      raise exception 'Tipo de cobrança inválido.' using errcode = '22023',
        detail = 'Use teleconsulta, mensalidade_clinica, comissao_clinica ou outro.';
    end if;
    v_row.kind := v_txt;
  end if;

  -- Descrição (obrigatória): de 3 a 200 caracteres, numa linha.
  if v_new or p ? 'descricao' then
    v_txt := nullif(btrim(regexp_replace(coalesce(private.billing_text(p, 'descricao'), ''), '\s+', ' ', 'g')), '');
    if v_txt is null or char_length(v_txt) not between 3 and 200 then
      raise exception 'Descrição deve ter de 3 a 200 caracteres.' using errcode = '22023';
    end if;
    v_row.description := v_txt;
  end if;

  -- Quem paga (obrigatório) e o nome (opcional, até 120 caracteres; null apaga).
  if v_new or p ? 'pagador_tipo' then
    v_txt := lower(private.billing_text(p, 'pagador_tipo'));
    if v_txt is null or v_txt not in ('paciente', 'clinica', 'medico', 'outro') then
      raise exception 'Tipo de pagador inválido.' using errcode = '22023', detail = 'Use paciente, clinica, medico ou outro.';
    end if;
    v_row.payer_type := v_txt;
  end if;
  if p ? 'pagador_nome' then
    v_txt := nullif(btrim(regexp_replace(coalesce(private.billing_text(p, 'pagador_nome'), ''), '\s+', ' ', 'g')), '');
    if char_length(v_txt) > 120 then
      raise exception 'Nome do pagador deve ter até 120 caracteres.' using errcode = '22023';
    end if;
    v_row.payer_name := v_txt;
  end if;

  -- Valor em centavos (obrigatório): número inteiro de 1 (R$ 0,01) a 100000000 (R$ 1.000.000,00).
  if v_new or p ? 'valor_cents' then
    v_txt := private.billing_text(p, 'valor_cents');
    if v_txt is null or v_txt !~ '^[0-9]{1,9}$' then
      raise exception 'Valor inválido: informe de R$ 0,01 a R$ 1.000.000,00.' using errcode = '22023',
        detail = 'valor_cents: número inteiro de centavos, de 1 a 100000000.';
    end if;
    if v_txt::integer not between 1 and 100000000 then
      raise exception 'Valor inválido: informe de R$ 0,01 a R$ 1.000.000,00.' using errcode = '22023',
        detail = 'valor_cents: número inteiro de centavos, de 1 a 100000000.';
    end if;
    v_row.amount_cents := v_txt::integer;
  end if;

  -- Vencimento "AAAA-MM-DD" (na cobrança nova, sem data = hoje; null numa edição mantém a data gravada).
  if p ? 'vencimento' then
    v_txt := private.billing_text(p, 'vencimento');
    if v_txt is not null then
      v_date := null;
      if v_txt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        begin
          v_date := v_txt::date;
        exception when others then
          v_date := null;  -- dia que não existe (ex.: 2026-02-30)
        end;
      end if;
      if v_date is null or v_date not between date '2020-01-01' and date '2099-12-31' then
        raise exception 'Vencimento inválido: use uma data de 2020 a 2099 (AAAA-MM-DD).' using errcode = '22023';
      end if;
      v_row.due_date := v_date;
    end if;
  end if;

  -- Situação (na cobrança nova, padrão pendente; null numa edição mantém a gravada).
  if p ? 'status' then
    v_txt := lower(private.billing_text(p, 'status'));
    if v_txt is not null then
      if v_txt not in ('pendente', 'pago', 'cancelado') then
        raise exception 'Situação inválida.' using errcode = '22023', detail = 'Use pendente, pago ou cancelado.';
      end if;
      v_row.status := v_txt;
    end if;
  end if;

  -- Forma de pagamento (opcional; null apaga).
  if p ? 'forma' then
    v_txt := lower(private.billing_text(p, 'forma'));
    if v_txt is not null and v_txt not in ('pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro') then
      raise exception 'Forma de pagamento inválida.' using errcode = '22023',
        detail = 'Use pix, cartao, boleto, dinheiro, transferencia ou outro.';
    end if;
    v_row.method := v_txt;
  end if;

  -- Data do pagamento: só na cobrança paga. Informada: "AAAA-MM-DD" (meia-noite de São Paulo), data e hora sem fuso
  -- (hora de São Paulo) ou com fuso ("Z", "-03:00"); até 1 h à frente do relógio do banco vira agora; mais que isso é
  -- erro. Sem ela: a data já gravada ou, se virou paga agora, agora.
  if v_row.status = 'pago' then
    v_txt := case when p ? 'pago_em' then private.billing_text(p, 'pago_em') end;
    if v_txt is not null then
      v_paid := null;
      if v_txt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$' then
        begin
          if v_txt !~ '[T ]' then
            v_paid := v_txt::date::timestamp at time zone 'America/Sao_Paulo';
          elsif v_txt ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
            v_paid := v_txt::timestamptz;
          else
            v_paid := v_txt::timestamp at time zone 'America/Sao_Paulo';
          end if;
        exception when others then
          v_paid := null;  -- dia ou hora que não existe
        end;
      end if;
      if v_paid is null or v_paid < timestamptz '2020-01-01 00:00:00-03' then
        raise exception 'Data do pagamento inválida.' using errcode = '22023';
      end if;
      if v_paid > v_now + interval '1 hour' then
        raise exception 'A data do pagamento não pode ser no futuro.' using errcode = '22023';
      end if;
      v_row.paid_at := least(v_paid, v_now);
    elsif v_row.paid_at is null then
      v_row.paid_at := v_now;
    end if;
  else
    v_row.paid_at := null;
  end if;

  -- Observação (opcional, até 500 caracteres; null apaga).
  if p ? 'obs' then
    v_txt := private.billing_text(p, 'obs');
    if char_length(v_txt) > 500 then
      raise exception 'Observação deve ter até 500 caracteres.' using errcode = '22023';
    end if;
    v_row.notes := v_txt;
  end if;

  -- Teleconsulta e clínica ligadas à cobrança (opcionais; precisam existir; null apaga).
  if p ? 'teleconsulta_id' then
    v_txt := lower(private.billing_text(p, 'teleconsulta_id'));
    v_row.teleconsultation_id := null;
    if v_txt is not null then
      if v_txt ~ v_uuid then
        select t.id into v_row.teleconsultation_id from public.teleconsultations t where t.id = v_txt::uuid;
      end if;
      if v_row.teleconsultation_id is null then
        raise exception 'Teleconsulta não encontrada.' using errcode = '22023';
      end if;
    end if;
  end if;
  if p ? 'clinica_id' then
    v_txt := lower(private.billing_text(p, 'clinica_id'));
    v_row.clinic_id := null;
    if v_txt is not null then
      if v_txt ~ v_uuid then
        select c.id into v_row.clinic_id from public.clinics c where c.id = v_txt::uuid;
      end if;
      if v_row.clinic_id is null then
        raise exception 'Clínica não encontrada.' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_new then
    insert into private.billing_charges (created_by, updated_by, kind, description, payer_type, payer_name, amount_cents,
                                         due_date, status, paid_at, method, notes, teleconsultation_id, clinic_id)
    values (auth.uid(), auth.uid(), v_row.kind, v_row.description, v_row.payer_type, v_row.payer_name, v_row.amount_cents,
            v_row.due_date, v_row.status, v_row.paid_at, v_row.method, v_row.notes, v_row.teleconsultation_id, v_row.clinic_id)
    returning * into v_row;
  else
    update private.billing_charges b set
      updated_at = v_now,
      updated_by = auth.uid(),
      kind = v_row.kind,
      description = v_row.description,
      payer_type = v_row.payer_type,
      payer_name = v_row.payer_name,
      amount_cents = v_row.amount_cents,
      due_date = v_row.due_date,
      status = v_row.status,
      paid_at = v_row.paid_at,
      method = v_row.method,
      notes = v_row.notes,
      teleconsultation_id = v_row.teleconsultation_id,
      clinic_id = v_row.clinic_id
    where b.id = v_row.id
    returning * into v_row;
  end if;
  return private.billing_json(v_row);
end $$;
comment on function public.admin_cobranca_salvar(jsonb) is 'Cria (sem "id") ou edita (com "id", só os campos enviados) uma cobrança do IMED e devolve como ficou. Só admin; dado inválido: erro 22023 com a mensagem para a tela.';

-- Muda a situação de uma cobrança (pago, com a forma opcional; pendente; cancelado) e devolve como ficou. Só admin.
create or replace function public.admin_cobranca_status(p_id uuid, p_status text, p_forma text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_forma text := nullif(lower(btrim(coalesce(p_forma, ''))), '');
  v_row private.billing_charges;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status not in ('pendente', 'pago', 'cancelado') then
    raise exception 'Situação inválida.' using errcode = '22023', detail = 'Use pendente, pago ou cancelado.';
  end if;
  if v_forma is not null and v_forma not in ('pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro') then
    raise exception 'Forma de pagamento inválida.' using errcode = '22023',
      detail = 'Use pix, cartao, boleto, dinheiro, transferencia ou outro.';
  end if;
  update private.billing_charges b set
    status = v_status,
    -- Paga: a data do pagamento é agora (a que já estava paga mantém a data). Pendente ou cancelada: sem data.
    paid_at = case when v_status = 'pago' then coalesce(b.paid_at, now()) end,
    method = coalesce(v_forma, b.method),
    updated_at = now(),
    updated_by = auth.uid()
  where b.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Cobrança não encontrada.' using errcode = '22023';
  end if;
  return private.billing_json(v_row);
end $$;
comment on function public.admin_cobranca_status(uuid, text, text) is 'Muda a situação de uma cobrança do IMED (pago, pendente ou cancelado; forma de pagamento opcional) e devolve como ficou. Só admin.';

/* ===================== 5. Permissões ===================== */
-- Só quem está logado chama (e cada função confere se é admin); visitante sem conta, nem isso.
revoke all on function public.admin_gestao(integer) from public, anon;
grant execute on function public.admin_gestao(integer) to authenticated;
revoke all on function public.admin_cobranca_listar(text, integer) from public, anon;
grant execute on function public.admin_cobranca_listar(text, integer) to authenticated;
revoke all on function public.admin_cobranca_salvar(jsonb) from public, anon;
grant execute on function public.admin_cobranca_salvar(jsonb) to authenticated;
revoke all on function public.admin_cobranca_status(uuid, text, text) from public, anon;
grant execute on function public.admin_cobranca_status(uuid, text, text) to authenticated;
