-- iMed Agenda, fase 3.3: parte 3 de 4 (os números da equipe do IMED). O cabeçalho está na parte 1.
-- admin_stats (aba Visitas) e admin_gestao (página de gestão) contam os pedidos sem a reserva temporária (hold) e sem
-- a reserva expirada (expired): elas são da integração e do pagamento, não pedidos de paciente (arquitetura §5,
-- "Compatibilidade"). admin_gestao ganha os baldes das situações novas (presente, faltou, remarcação). O resto é
-- igual às versões de 20261030143839_visitas (admin_stats) e 20261030191354_painel_medico (admin_gestao); mesmas
-- assinaturas e permissões (só o dono do IMED, is_imed_admin).

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

create or replace function public.admin_stats(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 366);
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts timestamptz := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts timestamptz := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_tele bigint;
  v_out jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Teleconsultas pedidas (entraram na fila do médico). Sem a tabela da teleconsulta no banco: nulo.
  if to_regclass('public.teleconsultations') is not null then
    execute 'select count(*) from public.teleconsultations t where t.created_at >= $1 and t.created_at < $2'
      into v_tele using v_from_ts, v_to_ts;
  end if;
  with pv as (
    select v.day, v.path, v.views from private.page_views_daily v where v.day between v_from and v_to
  ), ev as (
    select e.event, e.detail, sum(e.total) as n
    from private.site_events_daily e where e.day between v_from and v_to
    group by e.event, e.detail
  ), rk as (
    select ev.event, ev.detail, ev.n, row_number() over (partition by ev.event order by ev.n desc, ev.detail) as pos
    from ev
  ), rq as (
    select coalesce(a.exam_code, '') as exam, count(*) as n
    from public.appointment_requests a where a.created_at >= v_from_ts and a.created_at < v_to_ts
      and a.status not in ('hold', 'expired')   -- reserva temporária e reserva expirada não são pedidos (3.3)
    group by 1
  )
  select jsonb_build_object(
    'dias', v_days,
    'de', v_from,
    'ate', v_to,
    'visitas', (select coalesce(sum(pv.views), 0) from pv),
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', g.d, 'visitas', coalesce(s.n, 0)) order by g.d)
                from (select v_from + i as d from generate_series(0, v_days - 1) as i) g
                left join (select pv.day, sum(pv.views) as n from pv group by pv.day) s on s.day = g.d),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('pagina', x.path, 'visitas', x.n) order by x.n desc, x.path)
                from (select pv.path, sum(pv.views) as n from pv group by pv.path order by n desc, pv.path limit 20) x), '[]'::jsonb),
    'exames', coalesce((select jsonb_agg(jsonb_build_object('exame', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_exame' and t.pos <= 10), '[]'::jsonb),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_tipo' and t.pos <= 10), '[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_cidade' and t.pos <= 10), '[]'::jsonb),
    'pedidos_total', (select coalesce(sum(rq.n), 0) from rq),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('exame', x.exam, 'total', x.n) order by x.n desc, x.exam)
                from (select rq.exam, rq.n from rq order by rq.n desc, rq.exam limit 12) x), '[]'::jsonb),
    'teleconsultas', v_tele,
    'eventos', coalesce((select jsonb_object_agg(x.event, x.n)
                from (select ev.event, sum(ev.n) as n from ev group by ev.event) x), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;

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
      and a.status not in ('hold', 'expired')   -- reserva temporária e reserva expirada não são pedidos (3.3)
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
           -- situações da agenda nova (3.3)
           'presente', count(*) filter (where a.status in ('checked_in', 'in_service')),
           'faltou', count(*) filter (where a.status = 'no_show'),
           'remarcacao', count(*) filter (where a.status = 'reschedule_requested'),
           'parceiro', count(*) filter (where a.clinic_id is not null),
           'concierge', count(*) filter (where a.clinic_id is null))
    into v_pedidos
  from public.appointment_requests a
  where a.created_at >= v_from_ts and a.created_at < v_to_ts
    and a.status not in ('hold', 'expired')   -- reserva temporária e reserva expirada não são pedidos (3.3)
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

revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;
revoke all on function public.admin_gestao(integer) from public, anon;
grant execute on function public.admin_gestao(integer) to authenticated;
