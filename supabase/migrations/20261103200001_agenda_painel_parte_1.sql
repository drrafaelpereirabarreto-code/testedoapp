-- iMed Agenda, fase 3.4 ("Painel no banco"), 03/11/2026. Arquitetura: memory/projects/imed-agenda-arquitetura.md
-- (§5, §7, §11, §12, §13 teste 9 e §14, item 3.4). Aplicada na produção em 3 partes (supabase/migrations/<versão>_
-- agenda_painel_parte_1 a 3), cada uma uma migração própria, na ordem: esta é a parte 1 (as leituras do painel).
-- Volta única das 3 partes: supabase/volta/<versão>_agenda_painel_parte_3.sql.
--
-- Em linguagem simples:
--   1. O PAINEL DA CLÍNICA lê a agenda só por funções (esta parte): quem sou e o que posso (agenda_me), a versão da
--      agenda (agenda_version), o dia e a semana (agenda_view), o mês (agenda_month), a busca rápida (agenda_search,
--      mínimo 3 letras, até 20), o detalhe de um agendamento (agenda_request_detail), o histórico só com códigos
--      (agenda_history), os números do dia a dia (agenda_dashboard) e o financeiro, separado (agenda_dashboard_
--      financeiro), e os conflitos para resolver (agenda_conflicts, agenda_conflict_resolve).
--   2. Cada função confere a permissão do papel (agenda.role_permissions) NA clínica do registro: ninguém vê dado de
--      outra clínica. O profissional vê só a própria agenda (os recursos ligados a ele) e sem telefone; o financeiro
--      não vê nomes; a equipe do IMED vê os números e, para abrir dado de paciente, precisa de imed.pacientes.ver e de
--      uma justificativa ("quebra de vidro").
--   3. Toda leitura de dado de paciente fica registrada em agenda.access_log (uma linha por dia, pessoa, clínica,
--      função, pedido e escopo; a leitura repetida soma). Por isso essas funções são VOLATILE (POST no PostgREST).
--   4. Dado de paciente nunca vai para a grade inteira: a grade mostra "Maria S."; telefone e e-mail só no detalhe.
--
-- Parte 2: equipe (convites, papéis, último dono), aviso pelo Realtime, preço "a partir de", permissões das funções
-- antigas e a retenção da reserva expirada. Parte 3 (a única que troca regra existente): papéis novos em
-- clinic_members e policies antigas por permissão.
--
-- Nada aqui apaga ou troca o que existe: só tabela, coluna e funções NOVAS. O site não muda (fase 4).
-- Pode rodar de novo sem erro e sem mudar nada. Conferir na produção depois das 3 partes (tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%') = 44
--      and to_regclass('agenda.member_invites') is not null
--      and (select count(*) from pg_policies where schemaname = 'realtime' and policyname like 'agenda:%') = 1
--      and not has_function_privilege('anon', 'public.agenda_view(uuid,date,integer)', 'EXECUTE')
--      and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'clinic_members_role_check') like '%finance%';

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Tabela e coluna novas ===================== */

-- Convites para a equipe da clínica (§12, R2-21): aceito só por quem entra com o MESMO e-mail (confirmado, sessão
-- pelo link); preso à conta na primeira aceitação; um convite aberto por (clínica, e-mail); vence em 7 dias.
-- O e-mail do convite é de funcionário da clínica (não de paciente) e não sai desta tabela (nem para a auditoria).
create table if not exists agenda.member_invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 6 and 254
                             and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('owner', 'manager', 'reception', 'professional', 'finance')),
  status text not null default 'aberto' check (status in ('aberto', 'aceito', 'cancelado')),
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  constraint member_invites_aceito_ck check ((status = 'aceito') = (accepted_by is not null and accepted_at is not null)),
  constraint member_invites_cancelado_ck check ((status = 'cancelado') = (cancelled_at is not null))
);
create unique index if not exists member_invites_aberto_uq on agenda.member_invites (clinic_id, email) where status = 'aberto';
create index if not exists member_invites_email_idx on agenda.member_invites (email) where status = 'aberto';
alter table agenda.member_invites enable row level security;
revoke all on table agenda.member_invites from public, anon, authenticated, service_role;

-- Quando os dados pessoais de uma reserva expirada foram apagados (retenção de 7 dias, §12; rotina na parte 2).
alter table public.appointment_requests add column if not exists anonymized_at timestamptz;
comment on column public.appointment_requests.anonymized_at is
  'Quando nome, telefone, e-mail e observações foram apagados (reserva expirada há mais de 7 dias; arquitetura §12).';

/* ===================== 2. Apoio ===================== */

-- Escopo de quem está logado para uma permissão nesta clínica: 'clinica' (tudo da clínica), 'propria' (só os
-- recursos ligados ao profissional), 'central' (equipe do IMED com p_imed_perm) ou nulo (não pode).
create or replace function private.agenda_scope(p_clinic uuid, p_perm text, p_imed_perm text)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select x.s from (select public.clinic_perm_scope(p_clinic, p_perm) as s) x where x.s in ('clinica', 'propria')),
    case when p_imed_perm is not null and auth.uid() is not null and public.imed_has(p_imed_perm) then 'central' end);
$$;

-- Recursos ligados à pessoa logada nesta clínica (o profissional vê a própria agenda por eles).
create or replace function private.agenda_own_resources(p_clinic uuid)
returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(r.id order by r.id), '{}')
  from agenda.resources r where r.clinic_id = p_clinic and r.member_user_id = auth.uid() and auth.uid() is not null;
$$;

-- O pedido tem algum uso (ativo ou já encerrado) num dos recursos da lista?
create or replace function private.agenda_request_on(p_request uuid, p_resources uuid[])
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from agenda.appointment_items i join agenda.occupancy o on o.item_id = i.id
                 where i.request_id = p_request and o.resource_id = any (p_resources));
$$;

-- Nome curto para a grade ("Maria S."): o primeiro nome e a inicial do último.
create or replace function private.agenda_short_name(p_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when cardinality(w) > 1 then w[1] || ' ' || left(w[cardinality(w)], 1) || '.' else w[1] end
  from (select regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+') as w) x;
$$;

-- Registro de leitura de dado de paciente (agenda.access_log): a mesma leitura no mesmo dia só soma reads.
create or replace function private.agenda_log_access(p_fn text, p_clinic uuid, p_request uuid, p_scope text,
                                                     p_justification text default null)
returns void
language sql
set search_path = ''
as $$
  insert into agenda.access_log (day, user_id, clinic_id, fn, request_id, scope, justification_code)
  values ((now() at time zone 'America/Sao_Paulo')::date, auth.uid(), p_clinic, p_fn, p_request, p_scope, p_justification)
  on conflict on constraint access_log_uq
  do update set reads = agenda.access_log.reads + 1, last_at = now();
$$;

revoke all on function private.agenda_scope(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_own_resources(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_request_on(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_short_name(text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_log_access(text, uuid, uuid, text, text) from public, anon, authenticated, service_role;

/* ===================== 3. Quem sou e versão ===================== */

-- Unidades, papéis e permissões de quem está logado (o painel monta as abas com isto) e as permissões da equipe do
-- IMED. Conta inativa (e-mail não confirmado, apagada, banida, anônima) não recebe nada.
create or replace function public.agenda_me()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'user_id', auth.uid(),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clinic_id', c.id, 'name', c.name, 'role', m.role, 'timezone', c.timezone,
               'agenda_mode', c.agenda_mode, 'agenda_active', u.clinic_id is not null,
               'online', c.agenda_online_since is not null,
               'permissions', (select coalesce(jsonb_object_agg(rp.permission, rp.scope), '{}'::jsonb)
                               from agenda.role_permissions rp where rp.role = m.role))
             order by c.name, c.id)
      from public.clinic_members m
      join public.clinics c on c.id = m.clinic_id
      join auth.users au on au.id = m.user_id
      left join agenda.unit_settings u on u.clinic_id = c.id
      where m.user_id = auth.uid()
        and au.email_confirmed_at is not null and au.deleted_at is null
        and (au.banned_until is null or au.banned_until <= now()) and not coalesce(au.is_anonymous, false)), '[]'::jsonb),
    'imed', jsonb_build_object(
      'admin', coalesce(public.is_imed_admin(), false),
      'permissions', coalesce((select jsonb_agg(p.permission order by p.permission)
                               from (select distinct rp.permission from agenda.role_permissions rp
                                     where rp.scope = 'imed') p
                               where public.imed_has(p.permission)), '[]'::jsonb)));
end $$;

-- Versão da agenda da clínica (o painel lê ANTES dos dados e relê quando muda; §7). Sem dado nenhum de paciente.
create or replace function public.agenda_version(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v agenda.clinic_versions;
begin
  if private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor') is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into v from agenda.clinic_versions x where x.clinic_id = p_clinic;
  return jsonb_build_object('status', 'ok', 'version', coalesce(v.version, 0), 'changed_at', v.changed_at);
end $$;

/* ===================== 4. Dia, semana e mês ===================== */

-- A grade de 1 a 7 dias a partir de p_from (hora local da unidade): recursos, agendamentos (sem as reservas
-- expiradas), "ocupados" e bloqueios. Nome curto do paciente só para quem tem agenda.pacientes na clínica; a equipe
-- do IMED vê a grade sem nomes. O profissional (escopo 'propria') vê só os recursos dele.
create or replace function public.agenda_view(p_clinic uuid, p_from date, p_days integer default 1)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  v_pac text;
  v_tz text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_own uuid[];
  v_version bigint;
  v_items jsonb;
  v_out jsonb;
begin
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_from is null or p_days is null or p_days not between 1 and 7 then return jsonb_build_object('status', 'invalid'); end if;
  v_pac := case when v_scope <> 'central' then public.clinic_perm_scope(p_clinic, 'agenda.pacientes') end;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_ini := p_from::timestamp at time zone v_tz;
  v_fim := (p_from + p_days)::timestamp at time zone v_tz;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  select coalesce(cv.version, 0) into v_version from (select 1) d left join agenda.clinic_versions cv on cv.clinic_id = p_clinic;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'request_id', i.request_id, 'seq', i.seq, 'procedure_id', i.procedure_id, 'procedure', p.name,
           'exam_code', i.exam_code, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status,
           'request_version', a.version, 'channel', a.channel, 'hold_expires_at', a.hold_expires_at,
           'resources', (select coalesce(jsonb_agg(distinct o.resource_id), '[]'::jsonb) from agenda.occupancy o
                         where o.item_id = i.id and (o.active or o.release_reason in ('concluido', 'faltou'))),
           'patient', case when v_pac in ('clinica', 'propria')
                           then private.agenda_short_name(case when a.for_other then a.other_name else a.patient_name end) end)
         order by i.starts_at, i.seq), '[]'::jsonb)
    into v_items
  from agenda.appointment_items i
  join public.appointment_requests a on a.id = i.request_id
  join agenda.procedures p on p.id = i.procedure_id
  where i.clinic_id = p_clinic and i.starts_at < v_fim and i.ends_at > v_ini and i.status <> 'expired'
    and (v_own is null or exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.resource_id = any (v_own)));

  v_out := jsonb_build_object(
    'status', 'ok', 'version', v_version, 'timezone', v_tz, 'from', v_ini, 'to', v_fim, 'scope', v_scope,
    'patients', v_pac is not null,
    'resources', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name,
                                                               'capacity', r.capacity, 'active', r.active)
                                            order by r.kind, r.name)
                           from agenda.resources r
                           where r.clinic_id = p_clinic and r.archived_at is null
                             and (v_own is null or r.id = any (v_own))), '[]'::jsonb),
    'items', v_items,
    'busy', case when v_scope = 'propria' then '[]'::jsonb else coalesce((
              select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
                                                  'reason_code', b.reason_code,
                                                  'resources', (select coalesce(jsonb_agg(distinct o.resource_id), '[]'::jsonb)
                                                                from agenda.occupancy o where o.busy_id = b.id and o.active))
                               order by b.starts_at)
              from agenda.busy_marks b
              where b.clinic_id = p_clinic and b.removed_at is null and b.starts_at < v_fim and b.ends_at > v_ini), '[]'::jsonb) end,
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'resource_id', b.resource_id, 'kind', b.kind,
                                                            'starts_at', b.starts_at, 'ends_at', b.ends_at,
                                                            'reason', case when v_scope = 'clinica' then b.reason end)
                                         order by b.starts_at)
                        from public.clinic_blocks b
                        where b.clinic_id = p_clinic and b.removed_at is null and b.starts_at < v_fim and b.ends_at > v_ini
                          and (v_own is null or b.resource_id is null or b.resource_id = any (v_own))), '[]'::jsonb));
  if v_pac is not null and jsonb_array_length(v_items) > 0 then
    perform private.agenda_log_access('agenda_view', p_clinic, null, 'grade');
  end if;
  return v_out;
end $$;

-- O mês (hora local da unidade): por dia, agendamentos ativos, concluídos, faltas, cancelados e bloqueios. Sem dado
-- de paciente.
create or replace function public.agenda_month(p_clinic uuid, p_month date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  v_tz text;
  v_d0 date;
  v_d1 date;
  v_own uuid[];
begin
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_month is null then return jsonb_build_object('status', 'invalid'); end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_d0 := date_trunc('month', p_month)::date;
  v_d1 := (v_d0 + interval '1 month')::date;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  return jsonb_build_object('status', 'ok', 'timezone', v_tz, 'month', v_d0, 'days', (
    select jsonb_agg(jsonb_build_object(
             'day', g.d,
             'ativos', coalesce(x.ativos, 0), 'concluidos', coalesce(x.concluidos, 0), 'faltas', coalesce(x.faltas, 0),
             'cancelados', coalesce(x.cancelados, 0),
             'bloqueios', (select count(*) from public.clinic_blocks b
                           where b.clinic_id = p_clinic and b.removed_at is null
                             and (v_own is null or b.resource_id is null or b.resource_id = any (v_own))
                             and b.starts_at < (g.d + 1)::timestamp at time zone v_tz
                             and b.ends_at > g.d::timestamp at time zone v_tz)) order by g.d)
    from generate_series(v_d0, v_d1 - 1, interval '1 day') g0
    cross join lateral (select g0::date as d) g
    left join (select (i.starts_at at time zone v_tz)::date as d,
                      count(*) filter (where private.agenda_active_status(i.status)) as ativos,
                      count(*) filter (where i.status = 'completed') as concluidos,
                      count(*) filter (where i.status = 'no_show') as faltas,
                      count(*) filter (where i.status = 'cancelled') as cancelados
               from agenda.appointment_items i
               where i.clinic_id = p_clinic and i.status <> 'expired'
                 and i.starts_at >= v_d0::timestamp at time zone v_tz and i.starts_at < v_d1::timestamp at time zone v_tz
                 and (v_own is null or exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.resource_id = any (v_own)))
               group by 1) x on x.d = g.d));
end $$;

/* ===================== 5. Busca, detalhe e histórico ===================== */

-- Busca rápida da recepção (sempre por POST: o nome não vai à URL). Mínimo 3 caracteres; até 20 resultados, os mais
-- perto de agora primeiro. Pelo nome (de quem pediu ou de quem faz o exame) ou, para quem vê a clínica inteira, pelos
-- dígitos do telefone (4 ou mais). Fica no access_log.
create or replace function public.agenda_search(p_clinic uuid, p_q text)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_scope text := public.clinic_perm_scope(p_clinic, 'agenda.pacientes');
  v_q text := btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'));
  v_like text;
  v_dig text;
  v_own uuid[];
  v_out jsonb;
begin
  if v_scope is null or v_scope not in ('clinica', 'propria') then return jsonb_build_object('status', 'forbidden'); end if;
  if char_length(v_q) < 3 then return jsonb_build_object('status', 'too_short'); end if;
  if char_length(v_q) > 80 then return jsonb_build_object('status', 'invalid'); end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_dig := case when v_scope = 'clinica' and v_q ~ '^[0-9 ()+.-]+$' then regexp_replace(v_q, '\D', '', 'g') end;
  if v_dig is not null and char_length(v_dig) < 4 then v_dig := null; end if;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  select coalesce(jsonb_agg(x.j order by x.dist, x.id), '[]'::jsonb) into v_out
  from (select a.id, abs(extract(epoch from (coalesce(a.slot_start, a.created_at) - now()))) as dist,
               jsonb_build_object('id', a.id, 'status', a.status, 'slot_start', a.slot_start, 'agenda', a.uses_resources,
                                  'preferred_date', a.preferred_date, 'exam_code', a.exam_code, 'version', a.version,
                                  'name', case when a.for_other then a.other_name else a.patient_name end,
                                  'phone_end', case when v_scope = 'clinica' then right(a.patient_phone, 4) end) as j
        from public.appointment_requests a
        where a.clinic_id = p_clinic and a.status not in ('hold', 'expired') and a.anonymized_at is null
          and (a.patient_name ilike v_like or a.other_name ilike v_like
               or (v_dig is not null and a.patient_phone like '%' || v_dig || '%'))
          and (v_own is null or private.agenda_request_on(a.id, v_own))
        order by 2, a.id
        limit 20) x;
  perform private.agenda_log_access('agenda_search', p_clinic, null, 'busca');
  return jsonb_build_object('status', 'ok', 'results', v_out);
end $$;

-- Detalhe de um agendamento, conforme o papel: quem vê a clínica inteira recebe telefone, e-mail e observação do
-- pedido; o profissional, só se o agendamento usa um recurso dele, e sem telefone e e-mail; o financeiro não vê. A
-- equipe do IMED precisa de imed.pacientes.ver e de uma justificativa em código ("quebra de vidro"). Fica no access_log.
create or replace function public.agenda_request_detail(p_id uuid, p_justification text default null)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_scope text;
  v_full boolean;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_id;
  if not found or r.clinic_id is null then return jsonb_build_object('status', 'not_found'); end if;
  v_scope := public.clinic_perm_scope(r.clinic_id, 'agenda.pacientes');
  if v_scope = 'propria' and not private.agenda_request_on(r.id, private.agenda_own_resources(r.clinic_id)) then
    v_scope := null;
  end if;
  if v_scope is null or v_scope not in ('clinica', 'propria') then
    if public.imed_has('imed.pacientes.ver') then
      if p_justification is null or p_justification !~ '^[a-z][a-z0-9_]{2,59}$' or p_justification ~ '[0-9]{4,}' then
        return jsonb_build_object('status', 'justification_required');
      end if;
      v_scope := 'central';
    else
      return jsonb_build_object('status', 'forbidden');
    end if;
  end if;
  -- reserva expirada: some do painel da clínica (como na leitura direta); fica só para a equipe do IMED
  if r.status = 'expired' and v_scope <> 'central' then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_full := v_scope in ('clinica', 'central');
  perform private.agenda_log_access('agenda_request_detail', r.clinic_id, r.id, v_scope,
                                    case when v_scope = 'central' then p_justification end);
  return jsonb_build_object(
    'status', 'ok', 'scope', v_scope, 'id', r.id, 'clinic_id', r.clinic_id, 'request_status', r.status,
    'version', r.version, 'agenda', r.uses_resources, 'channel', r.channel, 'created_at', r.created_at,
    'exam_code', r.exam_code, 'preferred_date', r.preferred_date, 'preferred_period', r.preferred_period,
    'slot_start', r.slot_start, 'slot_end', r.slot_end, 'hold_expires_at', r.hold_expires_at,
    'cancel_reason', r.cancel_reason, 'cancelled_by', r.cancelled_by, 'cancelled_at', r.cancelled_at,
    'anonymized', r.anonymized_at is not null,
    'patient', jsonb_build_object(
      'name', r.patient_name,
      'phone', case when v_full then r.patient_phone end,
      'email', case when v_full then r.patient_email end,
      'for_other', r.for_other, 'other_name', r.other_name, 'relationship', r.relationship, 'other_minor', r.other_minor,
      'notes', case when v_full then r.notes end),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', i.id, 'seq', i.seq, 'procedure_id', i.procedure_id, 'procedure', p.name,
                         'exam_code', i.exam_code, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status,
                         'version', i.version, 'price_cents', i.price_cents,
                         'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', rs.id, 'name', rs.name, 'kind', rs.kind)
                                                                 order by o.group_no), '[]'::jsonb)
                                       from agenda.occupancy o join agenda.resources rs on rs.id = o.resource_id
                                       where o.item_id = i.id and (o.active or o.release_reason in ('concluido', 'faltou'))))
                       order by i.seq)
                       from agenda.appointment_items i join agenda.procedures p on p.id = i.procedure_id
                       where i.request_id = r.id), '[]'::jsonb),
    'notes', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'text', n.text,
                                                                             'created_at', n.created_at) order by n.created_at)
                                         from agenda.notes n where n.request_id = r.id and n.deleted_at is null), '[]'::jsonb)
                  else '[]'::jsonb end);
end $$;

-- Histórico de situação de um agendamento: só códigos (de, para, quando, quem por papel, origem, motivo).
create or replace function public.agenda_history(p_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_scope text;
begin
  select a.clinic_id into v_clinic from public.appointment_requests a where a.id = p_id;
  if v_clinic is null then return jsonb_build_object('status', 'not_found'); end if;
  v_scope := private.agenda_scope(v_clinic, 'agenda.ver', 'imed.agenda.monitor');
  if v_scope = 'propria' and not private.agenda_request_on(p_id, private.agenda_own_resources(v_clinic)) then
    v_scope := null;
  end if;
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'history', coalesce((
    select jsonb_agg(jsonb_build_object('at', h.at, 'item_seq', i.seq, 'from', h.from_status, 'to', h.to_status,
                                        'actor_kind', h.actor_kind, 'actor_role', h.actor_role, 'origin', h.origin,
                                        'reason_code', h.reason_code, 'request_version', h.request_version)
                     order by h.at, h.id)
    from agenda.status_history h left join agenda.appointment_items i on i.id = h.item_id
    where h.request_id = p_id), '[]'::jsonb));
end $$;

/* ===================== 6. Painel gerencial (sem dado pessoal) ===================== */

-- Operacional (§11): agendamentos por dia e por situação, cancelamentos por motivo, faltas (%), exames realizados,
-- origem (iMed, clínica, externo) e a ocupação por recurso = minutos ocupados (agendamento + "ocupado", inclusive os
-- já concluídos e as faltas) ÷ minutos abertos (livres + ocupados agora; regras − pausas − feriados − bloqueios).
-- Filtros (p_filters): procedure_id, resource_id, exam_code, channel. Até 92 dias.
create or replace function public.agenda_dashboard(p_clinic uuid, p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  v_tz text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_proc uuid;
  v_res uuid;
  v_exam text;
  v_chan text;
  v_out jsonb;
  v_recursos jsonb;
begin
  if v_scope is null or v_scope = 'propria' then return jsonb_build_object('status', 'forbidden'); end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 or jsonb_typeof(coalesce(p_filters, '{}')) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  begin
    v_proc := nullif(p_filters ->> 'procedure_id', '')::uuid;
    v_res := nullif(p_filters ->> 'resource_id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('status', 'invalid');
  end;
  v_exam := nullif(p_filters ->> 'exam_code', '');
  v_chan := nullif(p_filters ->> 'channel', '');
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_ini := p_from::timestamp at time zone v_tz;
  v_fim := (p_to + 1)::timestamp at time zone v_tz;

  with it as (
    select i.*, a.channel, a.cancel_reason
    from agenda.appointment_items i join public.appointment_requests a on a.id = i.request_id
    where i.clinic_id = p_clinic and i.starts_at >= v_ini and i.starts_at < v_fim and i.status <> 'expired'
      and (v_proc is null or i.procedure_id = v_proc) and (v_exam is null or i.exam_code = v_exam)
      and (v_chan is null or a.channel = v_chan)
      and (v_res is null or exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.resource_id = v_res))
  )
  select jsonb_build_object(
    'total', count(*),
    'por_situacao', jsonb_build_object(
      'reservado', count(*) filter (where it.status in ('hold', 'awaiting_payment')),
      'confirmado', count(*) filter (where it.status = 'confirmed'),
      'presente', count(*) filter (where it.status in ('checked_in', 'in_service')),
      'concluido', count(*) filter (where it.status = 'completed'),
      'faltou', count(*) filter (where it.status = 'no_show'),
      'remarcacao', count(*) filter (where it.status = 'reschedule_requested'),
      'cancelado', count(*) filter (where it.status = 'cancelled')),
    'faltas_pct', round(100.0 * count(*) filter (where it.status = 'no_show')
                        / nullif(count(*) filter (where it.status in ('completed', 'no_show')), 0), 1),
    'cancelamentos_por_motivo', coalesce((select jsonb_object_agg(m.motivo, m.n) from (
        select coalesce(x.cancel_reason, 'sem_motivo') as motivo, count(*) as n from it x where x.status = 'cancelled' group by 1) m),
      '{}'::jsonb),
    'origem', jsonb_build_object(
      'imed', count(*) filter (where it.channel in ('imed_app', 'imed_equipe')),
      'clinica', count(*) filter (where it.channel in ('clinica_telefone', 'clinica_balcao', 'clinica_outro')),
      'externo', count(*) filter (where it.channel = 'externo')),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('day', d.dia, 'total', d.n) order by d.dia) from (
        select (x.starts_at at time zone v_tz)::date as dia, count(*) as n from it x where x.status <> 'cancelled' group by 1) d),
      '[]'::jsonb))
  into v_out
  from it;

  -- Ocupação por recurso (os minutos de todas as vagas do recurso).
  with rec as (
    select r.id, r.name, r.kind, r.capacity from agenda.resources r
    where r.clinic_id = p_clinic and r.archived_at is null and (v_res is null or r.id = v_res)
  ), livre as (
    select f.resource_id, sum(coalesce((select sum(extract(epoch from (upper(x) - lower(x))))
                                        from unnest(f.free) x), 0)) / 60 as minutos
    from private.agenda_free_map(p_clinic, (select coalesce(array_agg(rec.id), '{}') from rec), v_ini, v_fim, now()) f
    group by f.resource_id
  ), uso as (
    select o.resource_id,
           sum(extract(epoch from (least(upper(o.during), v_fim) - greatest(lower(o.during), v_ini)))) / 60 as ocupado,
           sum(extract(epoch from (least(upper(o.during), v_fim) - greatest(lower(o.during), v_ini))))
             filter (where o.active) / 60 as ativo
    from agenda.occupancy o
    where o.clinic_id = p_clinic and o.kind in ('agendamento', 'ocupado') and o.during && tstzrange(v_ini, v_fim, '[)')
      and (o.active or o.release_reason in ('concluido', 'faltou')) and o.resource_id in (select rec.id from rec)
    group by o.resource_id
  ), bloq as (
    select o.resource_id,
           sum(extract(epoch from (least(upper(o.during), v_fim) - greatest(lower(o.during), v_ini)))) / 60 as minutos
    from agenda.occupancy o
    where o.clinic_id = p_clinic and o.kind = 'bloqueio' and o.active and o.during && tstzrange(v_ini, v_fim, '[)')
      and o.resource_id in (select rec.id from rec)
    group by o.resource_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'resource_id', rec.id, 'name', rec.name, 'kind', rec.kind, 'capacity', rec.capacity,
           'minutos_ocupados', round(coalesce(uso.ocupado, 0)),
           'minutos_livres', round(coalesce(livre.minutos, 0)),
           'minutos_abertos', round(coalesce(livre.minutos, 0) + coalesce(uso.ativo, 0)),
           'minutos_bloqueados', round(coalesce(bloq.minutos, 0)),
           'ocupacao_pct', round(100.0 * coalesce(uso.ocupado, 0) / nullif(coalesce(livre.minutos, 0) + coalesce(uso.ativo, 0), 0), 1))
         order by rec.kind, rec.name), '[]'::jsonb)
    into v_recursos
  from rec left join livre on livre.resource_id = rec.id left join uso on uso.resource_id = rec.id
  left join bloq on bloq.resource_id = rec.id;

  return v_out || jsonb_build_object('status', 'ok', 'from', p_from, 'to', p_to, 'timezone', v_tz,
    'recursos', v_recursos,
    'formula', 'ocupação = minutos ocupados (agendamentos e "ocupado", inclusive concluídos e faltas) ÷ minutos abertos (horário de funcionamento menos pausas, feriados e bloqueios)');
end $$;

-- Financeiro (financeiro.ver; §11): receita ESTIMADA (preço informado no momento da marcação, dos agendamentos
-- marcados e concluídos) e a dos exames CONCLUÍDOS. Sem pagamento online (fase 5.4), nada aparece como "pago".
-- Exames "sob consulta" (sem preço) só são contados. Sem nomes.
create or replace function public.agenda_dashboard_financeiro(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'financeiro.ver', 'imed.financeiro.ver');
  v_tz text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_out jsonb;
begin
  if v_scope is null or v_scope = 'propria' then return jsonb_build_object('status', 'forbidden'); end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then return jsonb_build_object('status', 'invalid'); end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_ini := p_from::timestamp at time zone v_tz;
  v_fim := (p_to + 1)::timestamp at time zone v_tz;
  with it as (
    select i.exam_code, i.status, i.price_cents from agenda.appointment_items i
    where i.clinic_id = p_clinic and i.starts_at >= v_ini and i.starts_at < v_fim
      and (private.agenda_active_status(i.status) or i.status = 'completed')
  )
  select jsonb_build_object(
    'status', 'ok', 'from', p_from, 'to', p_to, 'timezone', v_tz,
    'receita_estimada_cents', coalesce(sum(it.price_cents), 0),
    'receita_concluida_cents', coalesce(sum(it.price_cents) filter (where it.status = 'completed'), 0),
    'agendamentos', count(*),
    'sob_consulta', count(*) filter (where it.price_cents is null),
    'pagamento_online', false,
    'por_exame', coalesce((select jsonb_object_agg(e.exam_code, jsonb_build_object(
                                    'estimada_cents', e.est, 'concluida_cents', e.conc, 'agendamentos', e.n))
                           from (select x.exam_code, coalesce(sum(x.price_cents), 0) as est,
                                        coalesce(sum(x.price_cents) filter (where x.status = 'completed'), 0) as conc, count(*) as n
                                 from it x group by 1) e), '{}'::jsonb),
    'nota', 'Valores pelo preço informado pela clínica na hora da marcação. O pagamento é feito no local; o IMED não confirma pagamentos.')
  into v_out
  from it;
  return v_out;
end $$;

/* ===================== 7. Conflitos ===================== */

-- Conflitos da clínica ("Precisa de atenção"): abertos e em andamento (padrão) ou todos dos últimos 90 dias.
create or replace function public.agenda_conflicts(p_clinic uuid, p_all boolean default false)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
begin
  if v_scope is null or v_scope = 'propria' then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'conflicts', coalesce((
    select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'request_id', k.request_id, 'item_id', k.item_id,
                                        'starts_at', i.starts_at, 'procedure_id', i.procedure_id, 'details', k.details,
                                        'status', k.status, 'resolution_code', k.resolution_code,
                                        'created_at', k.created_at, 'resolved_at', k.resolved_at)
                     order by k.created_at desc, k.id)
    from agenda.conflicts k left join agenda.appointment_items i on i.id = k.item_id
    where k.clinic_id = p_clinic
      and (case when coalesce(p_all, false) then k.created_at > now() - interval '90 days'
                else k.status in ('aberto', 'em_andamento') end)), '[]'::jsonb));
end $$;

-- Marca um conflito como em andamento, resolvido ou descartado (com código de resolução). conflitos.resolver na
-- clínica ou imed.conflitos.resolver. Vai para a auditoria e sobe a versão da agenda.
create or replace function public.agenda_conflict_resolve(p_id uuid, p_status text, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k agenda.conflicts;
  v_origin text;
begin
  select * into k from agenda.conflicts c where c.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_origin := private.agenda_actor(k.clinic_id, 'conflitos.resolver', 'imed.conflitos.resolver');
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_status is null or p_status not in ('em_andamento', 'resolvido', 'descartado') then
    return jsonb_build_object('status', 'invalid_status');
  end if;
  if p_status in ('resolvido', 'descartado')
     and (p_code is null or p_code !~ '^[a-z][a-z0-9_]{2,59}$' or p_code ~ '[0-9]{4,}') then
    return jsonb_build_object('status', 'reason_required');
  end if;
  select * into k from agenda.conflicts c where c.id = p_id for update;
  if k.status in ('resolvido', 'descartado') then return jsonb_build_object('status', 'already_closed'); end if;
  update agenda.conflicts c
  set status = p_status,
      resolution_code = case when p_status = 'em_andamento' then c.resolution_code else p_code end,
      resolved_at = case when p_status = 'em_andamento' then null else now() end,
      resolved_by = case when p_status = 'em_andamento' then null else auth.uid() end
  where c.id = p_id;
  perform private.agenda_audit(k.clinic_id, v_origin, 'conflito_' || p_status, 'conflict', k.id::text,
                               jsonb_build_object('status', k.status, 'kind', k.kind),
                               jsonb_build_object('status', p_status, 'resolution_code', p_code));
  perform private.agenda_touch(k.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 8. Permissões das funções novas ===================== */
-- Só quem está logado (cada função confere a permissão por dentro); nada para visitante.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agenda_me()', 'public.agenda_version(uuid)', 'public.agenda_view(uuid, date, integer)',
    'public.agenda_month(uuid, date)', 'public.agenda_search(uuid, text)', 'public.agenda_request_detail(uuid, text)',
    'public.agenda_history(uuid)', 'public.agenda_dashboard(uuid, date, date, jsonb)',
    'public.agenda_dashboard_financeiro(uuid, date, date)', 'public.agenda_conflicts(uuid, boolean)',
    'public.agenda_conflict_resolve(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on function public.agenda_view(uuid, date, integer) is
  'Grade da agenda (1 a 7 dias) para o painel: nome curto do paciente só com agenda.pacientes; leitura registrada em agenda.access_log.';
comment on function public.agenda_request_detail(uuid, text) is
  'Detalhe de um agendamento conforme o papel (profissional sem telefone; equipe do IMED com justificativa); registrado em agenda.access_log.';
