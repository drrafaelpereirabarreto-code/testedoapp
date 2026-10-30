-- Painel do médico e a fila da teleconsulta "agora" (30/10/2026).
--
-- Em linguagem simples, esta migração:
--   1. Cria public.tele_painel_medico(): os números da página inicial do médico que atende pelo IMED (medico.html),
--      para ele ver o movimento antes mesmo de ficar disponível: quantos pacientes esperam na fila agora, há quanto
--      tempo espera o primeiro da fila, a consulta dele em andamento, quantos pacientes ele atendeu hoje, quantos
--      documentos ainda faltam assinar e quantos médicos estão disponíveis para atender agora. Só contagens e minutos:
--      nenhum nome, idade, motivo, celular ou código de paciente (LGPD: só o necessário). Os dados de cada paciente
--      continuam só na fila (public.tele_queue), que a página abre quando o médico fica disponível para atender, como
--      antes.
--   2. Recria public.admin_gestao(p_days), a função da página de gestão (migração 20261030163758_gestao.sql), igual e
--      com a mesma assinatura, só com uma chave a mais: "agora" (a fila da teleconsulta neste momento). As outras
--      chaves e as regras delas não mudam.
--   3. Cria private.tele_agora(p_doctor): a conta dos números de "agora", a mesma para o médico e para a gestão (os
--      dois veem sempre o mesmo número).
--
-- Os números vêm só do banco (nada é estimado nem inventado): zero é zero; o que não existe volta null e a tela mostra
-- "—". "Agora" é a hora do banco (now()); "hoje" é o dia de São Paulo.
--   aguardando: pedidos na fila agora. Mesma regra de tele_queue: situação waiting e pedido feito há no máximo 2 h (com
--     mais de 2 h o pedido já conta como expirado, private.tele_effective_status).
--   espera_mais_longa_min: há quantos minutos (inteiros, como o wait_minutes de tele_queue; nunca negativo) espera o
--     pedido mais antigo da fila. Ninguém esperando: null.
--   em_atendimento: consultas aceitas ou em chamada agora. Mesma regra de tele_queue: aceita há no máximo 30 min sem
--     começar, ou começada há no máximo 3 h (private.tele_effective_status). No painel do médico, só as dele (no máximo
--     1: o banco não deixa o médico ter duas ao mesmo tempo); na gestão, as de todos os médicos. Atenção: na gestão,
--     pacientes.tele.em_atendimento é outra conta (teleconsultas pedidas no período, com a "aceita" separada).
--   atendidos_hoje (só no painel): consultas do médico encerradas hoje, pela hora do fim, em que o atendimento começou
--     (started_at: vídeo, ligação ou mensagem do médico; a mesma regra de "atendidos" da gestão). A hora do fim é a que
--     vem primeiro: o fim gravado (ended_at) ou 3 h depois do começo, porque com 3 h em andamento a consulta já conta
--     como encerrada (private.tele_effective_status). Assim a consulta que passou de 3 h termina nas 3 h, antes e
--     depois de a limpeza automática (a cada 10 min) ou o médico gravarem o fim mais tarde, e nunca conta em dois dias
--     (ex.: 3 h completas às 23:57 e limpeza às 00:05: conta só no dia das 23:57). A consulta que o médico encerrou sem
--     o paciente aparecer (sem started_at) não conta. Para a conta ser rápida, só entram as consultas pedidas a partir
--     de 24 h antes do começo de hoje (created_at): do pedido ao fim são no máximo 5 h 30 (até 2 h na fila, até 30 min
--     para começar depois de aceita e até 3 h de consulta), então nenhuma consulta encerrada hoje fica de fora.
--   documentos_para_assinar (só no painel): documentos do médico emitidos (não cancelados), ainda sem o PDF assinado e
--     no prazo de 7 dias para enviar o PDF. É a lista "Falta assinar" (tele_doc_pending) sem os que passaram do prazo
--     (expired: esses o médico só pode cancelar).
--   medicos_disponiveis: médicos aprovados com a página de atendimento aberta agora. Mesma regra de tele_doctors_online
--     (aprovado e available_until no futuro), contando todos (a lista dela para em 50). No painel, conta também o
--     próprio médico, se ele estiver disponível. Na gestão, é o mesmo número de medicos.disponiveis_agora.
--   atualizado_em (só no painel): a hora do cálculo, em UTC ("2026-10-30T15:00:00Z", como o gerado_em da gestão).
--
-- Quem pode usar:
--   tele_painel_medico: só o médico com cadastro aprovado (private.tele_me(true), como tele_queue). Os erros são os
--     mesmos da fila (código P0001): 'sem_login', 'sem_cadastro' ou 'nao_aprovado' (em análise, recusado ou suspenso).
--   admin_gestao: só a equipe do IMED (public.is_imed_admin()); qualquer outra pessoa recebe o erro 42501 'forbidden'.
--   private.tele_agora: só as duas funções acima (a API não alcança o schema private).
-- Nada é apagado (nenhuma tabela, função ou linha sai do banco) e tudo pode rodar de novo sem erro. As tabelas e as
-- funções usadas são das migrações da teleconsulta, dos documentos e da gestão, já aplicadas.
--
-- Contrato das chamadas (PostgREST):
--   POST /rest/v1/rpc/tele_painel_medico  {}  (sessão do médico)  -> jsonb (exemplo só do formato):
--     { "aguardando": 0, "espera_mais_longa_min": null, "em_atendimento": 0, "atendidos_hoje": 0,
--       "documentos_para_assinar": 0, "medicos_disponiveis": 0, "atualizado_em": "2026-10-30T15:00:00Z" }
--   POST /rest/v1/rpc/admin_gestao  {"p_days": 30}  (sessão de admin)  -> o mesmo jsonb de antes (contrato no
--     cabeçalho da migração 20261030163758_gestao.sql) e mais a chave:
--     "agora": { "aguardando": 0, "espera_mais_longa_min": null, "em_atendimento": 0, "medicos_disponiveis": 0 }

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/* ===================== 1. A fila da teleconsulta agora (conta única) ===================== */
-- Os números de "agora" (regras no topo deste arquivo) para um médico (p_doctor = id em public.doctors: em_atendimento
-- conta só as consultas dele) ou para a gestão (p_doctor nulo: as de todos os médicos). Só contagens e minutos.
create or replace function private.tele_agora(p_doctor uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
           'aguardando', f.n,
           'espera_mais_longa_min', case when f.mais_antigo is not null
                                         then greatest(floor(extract(epoch from (now() - f.mais_antigo)) / 60), 0)::integer
                                    end,
           'em_atendimento', (select count(*)
                              from public.teleconsultations t
                              where t.status in ('accepted', 'in_call')
                                and (p_doctor is null or t.doctor_id = p_doctor)
                                and private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at)
                                    in ('accepted', 'in_call')),
           'medicos_disponiveis', (select count(*)
                                   from public.doctors d
                                   where d.status = 'approved' and d.available_until > now()))
  from (select count(*) as n, min(t.created_at) as mais_antigo
        from public.teleconsultations t
        where t.status = 'waiting' and t.created_at >= now() - interval '2 hours') f;
$$;
comment on function private.tele_agora(uuid) is 'Teleconsulta agora: aguardando na fila, espera mais longa (minutos), em atendimento e médicos disponíveis, com as regras de tele_queue e tele_doctors_online. p_doctor: em_atendimento só desse médico; nulo = de todos (gestão). Uso interno de tele_painel_medico e admin_gestao.';

/* ===================== 2. Painel do médico ===================== */
-- Números da página inicial do médico aprovado (medico.html), sem nenhum dado de paciente. Regras no topo deste
-- arquivo; os erros são os de tele_queue.
create or replace function public.tele_painel_medico()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_now timestamptz := now();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini timestamptz;
  v_fim timestamptz;
  v_atendidos bigint;
  v_documentos bigint;
begin
  -- Só médico com cadastro aprovado, como a fila (tele_queue): sem_login, sem_cadastro ou nao_aprovado (P0001).
  v_doc := private.tele_me(true);
  -- Hoje no horário de São Paulo: do começo do dia até o começo de amanhã.
  v_ini := v_hoje::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (v_hoje + 1)::timestamp at time zone 'America/Sao_Paulo';

  -- Atendidos hoje: consultas dele encerradas hoje (pela hora do fim) em que o atendimento começou. O fim é o que vem
  -- primeiro: o gravado ou 3 h depois do começo (com 3 h em andamento a consulta já é encerrada,
  -- private.tele_effective_status), então a limpeza automática ou o médico gravando o fim mais tarde não mudam o dia
  -- (least ignora o ended_at nulo). Só as pedidas a partir de 24 h antes do começo de hoje (usa o índice do médico por
  -- created_at): do pedido ao fim são no máximo 5 h 30 (2 h na fila, 30 min para começar e 3 h de consulta).
  select count(*) into v_atendidos
  from public.teleconsultations t
  where t.doctor_id = v_doc.id
    and t.created_at >= v_ini - interval '1 day'
    and t.started_at is not null
    and private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) = 'ended'
    and least(t.ended_at, t.started_at + interval '3 hours') >= v_ini
    and least(t.ended_at, t.started_at + interval '3 hours') < v_fim;

  -- Falta assinar: a regra de tele_doc_pending, só os que ainda estão no prazo de 7 dias para enviar o PDF.
  select count(*) into v_documentos
  from public.tele_documents d
  where d.doctor_id = v_doc.id and d.status = 'emitido' and d.signed_at is null
    and d.created_at >= v_now - interval '7 days';

  return private.tele_agora(v_doc.id) || jsonb_build_object(
    'atendidos_hoje', v_atendidos,
    'documentos_para_assinar', v_documentos,
    'atualizado_em', private.gestao_iso(v_now));
end $$;
comment on function public.tele_painel_medico() is 'Painel do médico aprovado da teleconsulta (medico.html): pacientes aguardando na fila, espera mais longa (minutos), consulta dele em andamento, atendidos hoje (São Paulo), documentos para assinar no prazo e médicos disponíveis agora. Só contagens, sem dado de paciente. Mesmos erros de tele_queue.';

/* ===================== 3. admin_gestao: os números do IMED, com a chave "agora" ===================== */
-- Igual à da migração 20261030163758_gestao.sql (as regras de cada número estão no topo dela), com a chave "agora" no
-- fim (regras no topo deste arquivo). Mesma assinatura: create or replace troca só o corpo; dono e permissões ficam.
create or replace function public.admin_gestao(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(p_days, 30);
  v_now timestamptz := now();
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_serie jsonb;
  v_pedidos jsonb;
  v_tele jsonb;
  v_tele_atendidos bigint;
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
  if v_days not between 1 and 366 then
    raise exception 'Período inválido: use de 1 a 366 dias.' using errcode = '22023';
  end if;
  v_from := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';

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
      and not exists (select 1 from public.clinics c where c.id = a.clinic_id and c.is_demo)
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

  -- Pedidos de agendamento feitos no período, pela situação de hoje (sem os de teste às clínicas de demonstração).
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
  where a.created_at >= v_from_ts and a.created_at < v_to_ts
    and not exists (select 1 from public.clinics c where c.id = a.clinic_id and c.is_demo);

  -- Teleconsultas pedidas no período, pela situação de fato; a parte da teleconsulta no funil; e as encerradas em que
  -- o atendimento começou (vídeo, ligação ou mensagem do médico), que são os pacientes atendidos.
  with t as (
    select x.id, x.created_at, x.accepted_at, x.started_at, x.ended_at, x.closed_by,
           private.tele_effective_status(x.status, x.created_at, x.accepted_at, x.started_at) as eff
    from public.teleconsultations x
    where x.created_at >= v_from_ts and x.created_at < v_to_ts
  )
  select jsonb_build_object(
           'total', count(*),
           'aguardando', count(*) filter (where t.eff = 'waiting'),
           'aceita', count(*) filter (where t.eff = 'accepted' and t.started_at is null),
           'em_atendimento', count(*) filter (where t.eff = 'in_call' or (t.eff = 'accepted' and t.started_at is not null)),
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
             select 1 from public.tele_documents d where d.consultation_id = t.id and d.status = 'emitido'))),
         count(*) filter (where t.eff = 'ended' and t.started_at is not null)
    into v_tele, v_funil, v_tele_atendidos
  from t;

  -- Documentos médicos emitidos no período (os 7 tipos sempre aparecem; zero quando não houve).
  with d as (
    select x.kind, x.status, (x.signed_at is not null) as pdf
    from public.tele_documents x
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

  -- Avaliações publicadas no período (sem as de pedidos às clínicas de demonstração).
  select jsonb_build_object('total', count(*), 'media', round(avg(r.rating), 1))
    into v_aval
  from public.reviews r
  where r.status = 'published' and r.created_at >= v_from_ts and r.created_at < v_to_ts
    and not exists (select 1 from public.appointment_requests a join public.clinics c on c.id = a.clinic_id
                    where a.id = r.request_id and c.is_demo);

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
           -- Só os inscritos no período: reviewed_at é a última decisão (ver o topo do arquivo).
           'aprovacao_media_horas', round(avg(extract(epoch from (d.reviewed_at - d.created_at)) / 3600)
                                            filter (where d.status = 'approved' and d.created_at >= v_from_ts
                                                      and d.created_at < v_to_ts), 1),
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

  -- Lista de espera e Fale com o IMED feitos no período; avisos de erro com algum envio no período.
  select jsonb_build_object(
           'lista_espera', (select count(*) from public.app_waitlist w
                            where w.created_at >= v_from_ts and w.created_at < v_to_ts),
           'contatos', (select count(*) from public.contact_messages m
                        where m.created_at >= v_from_ts and m.created_at < v_to_ts),
           'avisos_de_erro', (select count(*) from public.place_reports r
                              where r.last_at >= v_from_ts and r.last_at < v_to_ts))
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
      'atendidos', v_tele_atendidos + (v_pedidos ->> 'concluido')::bigint,
      'pedidos', v_pedidos,
      'tele', v_tele,
      'documentos', v_docs,
      'avaliacoes', v_aval),
    'funil', v_funil,
    'medicos', v_medicos,
    'clinicas', v_clinicas,
    'outros', v_outros,
    'cobranca', v_cobranca,
    -- A teleconsulta neste momento (não depende do período): a mesma conta do painel do médico.
    'agora', private.tele_agora(null::uuid));
end $$;
comment on function public.admin_gestao(integer) is 'Números do IMED para a página de gestão (só admin): visitas, funil, pedidos, teleconsultas, documentos, avaliações, médicos, clínicas, mensagens e cobrança, nos últimos p_days dias (São Paulo; 1 a 366), e a teleconsulta agora (fila, em atendimento e médicos disponíveis). Só contagens e somas, sem dado de paciente.';

/* ===================== 4. Permissões ===================== */
-- A conta interna: só as funções acima (dono postgres) usam.
revoke all on function private.tele_agora(uuid) from public, anon, authenticated;
-- Só quem está logado chama (e cada função confere quem é: médico aprovado ou admin); visitante sem conta, nem isso.
revoke all on function public.tele_painel_medico() from public, anon;
grant execute on function public.tele_painel_medico() to authenticated;
revoke all on function public.admin_gestao(integer) from public, anon;
grant execute on function public.admin_gestao(integer) to authenticated;
