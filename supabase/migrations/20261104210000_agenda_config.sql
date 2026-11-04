-- iMed Agenda, fase 4.1 ("Equipe e cadastros"), 04/11/2026. Arquitetura: memory/projects/imed-agenda-arquitetura.md
-- (§8 modalidades, §11 cadastros, §12 papéis, §14 item 4.1). Volta: supabase/volta/<mesmo nome>.sql.
--
-- Em linguagem simples: a tela de cadastros do painel da clínica precisa LER o que já está gravado antes de mudar
-- (as funções da 3.2 só gravam, e algumas trocam a lista inteira) e precisa de um jeito de escolher a MODALIDADE da
-- agenda com o compromisso da modalidade manual. São duas funções novas, nada mais:
--   1. agenda_config(p_clinic): a configuração inteira da unidade (configurações, fuso e se foi confirmado,
--      modalidade, recursos, procedimentos com os grupos de recursos, regras de abrir e pausar, regras de pacote,
--      aberturas em feriado). Só quem configura a agenda (agenda.configurar: dona e gestor) ou a equipe do IMED com
--      imed.clinicas.configurar. A recepção, o profissional e o financeiro recebem forbidden. Nenhum dado de paciente.
--   2. agenda_mode_set(p_clinic, p_mode, p_commitment): troca a modalidade (pedido, nativa, manual, externa). Fora de
--      "pedido" exige a agenda ativa (agenda_not_started) e o fuso confirmado (timezone_not_confirmed); "manual" exige
--      o compromisso aceito na mesma chamada (commitment_required; decisão 6); "externa" (ou sair dela) exige
--      integracao.gerenciar (só a dona) ou a equipe do IMED; voltar a "pedido" com a venda online ligada é recusado
--      (online_active). NÃO liga a venda online (isso é da 5.1). Grava a auditoria só com códigos e sobe a versão.
--
-- Nada aqui apaga ou troca o que existe: só CREATE FUNCTION novas, REVOKE e GRANT. Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%') = 46
--      and has_function_privilege('authenticated', 'public.agenda_config(uuid)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_config(uuid)', 'EXECUTE')
--      and has_function_privilege('authenticated', 'public.agenda_mode_set(uuid,text,boolean)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_mode_set(uuid,text,boolean)', 'EXECUTE');

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Ler a configuração ===================== */
create or replace function public.agenda_config(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  c public.clinics;
  u agenda.unit_settings;
begin
  if private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar') is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into c from public.clinics x where x.id = p_clinic;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  return jsonb_build_object(
    'status', 'ok',
    'clinic_id', c.id,
    'active', u.clinic_id is not null,
    'old_schedule_exists', u.clinic_id is null and exists (select 1 from public.clinic_schedules s where s.clinic_id = p_clinic),
    'unit', jsonb_build_object(
      'timezone', c.timezone,
      'timezone_suggested', private.agenda_suggested_timezone(c.state, c.cnes),
      'timezone_confirmed_at', c.timezone_confirmed_at,
      'agenda_mode', c.agenda_mode,
      'agenda_online_since', c.agenda_online_since,
      'manual_commitment_at', u.manual_commitment_at,
      'step_min', u.step_min, 'min_notice_min', u.min_notice_min, 'max_advance_days', u.max_advance_days,
      'holidays_checked_until', u.holidays_checked_until, 'hold_minutes', u.hold_minutes,
      'payment_grace_min', u.payment_grace_min, 'patient_cancel_until_min', u.patient_cancel_until_min,
      'patient_reschedule_until_min', u.patient_reschedule_until_min, 'checkin_before_min', u.checkin_before_min,
      'no_show_after_min', u.no_show_after_min, 'patient_gap_min', u.patient_gap_min,
      'closes_on_holidays', u.closes_on_holidays, 'payment_mode', u.payment_mode, 'updated_at', u.updated_at),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'capacity', r.capacity,
                                          'setup_min', r.setup_min, 'cleanup_min', r.cleanup_min,
                                          'member_user_id', r.member_user_id, 'council', r.council,
                                          'council_number', r.council_number, 'active', r.active)
                       order by r.kind, lower(r.name))
      from agenda.resources r where r.clinic_id = p_clinic and r.archived_at is null), '[]'::jsonb),
    'procedures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'exam_code', p.exam_code, 'name', p.name, 'duration_min', p.duration_min, 'step_min', p.step_min,
               'price_cents', p.price_cents, 'price_confirmed_at', p.price_confirmed_at,
               'patient_prep_text', p.patient_prep_text, 'fasting_hours', p.fasting_hours,
               'min_notice_min', p.min_notice_min, 'max_advance_days', p.max_advance_days,
               'online_booking', p.online_booking, 'default_for_exam', p.default_for_exam, 'active', p.active,
               'requirements', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'group_no', g.group_no, 'resource_kind', g.resource_kind, 'offset_min', g.offset_min,
                          'duration_min', g.duration_min, 'align_min', g.align_min, 'label', g.label,
                          'options', coalesce((select jsonb_agg(jsonb_build_object('resource_id', o.resource_id, 'priority', o.priority)
                                                                order by o.priority, o.resource_id)
                                               from agenda.requirement_options o where o.requirement_id = g.id), '[]'::jsonb))
                        order by g.group_no)
                 from agenda.procedure_requirements g where g.procedure_id = p.id), '[]'::jsonb))
             order by p.exam_code, lower(p.name))
      from agenda.procedures p where p.clinic_id = p_clinic and p.archived_at is null), '[]'::jsonb),
    -- regras de abrir e pausar (as linhas de clinic_schedules só são regras do motor com a agenda ativa)
    'rules', case when u.clinic_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('resource_id', s.resource_id, 'weekday', s.weekday,
                                          'start', to_char(s.start_time, 'HH24:MI'),
                                          'end', case when s.end_time = '24:00'::time then '24:00' else to_char(s.end_time, 'HH24:MI') end,
                                          'kind', s.kind, 'valid_from', s.valid_from, 'valid_to', s.valid_to,
                                          'label', s.label, 'procedure_ids', to_jsonb(s.procedure_ids))
                       order by s.resource_id nulls first, s.weekday, s.start_time, s.kind)
      from public.clinic_schedules s where s.clinic_id = p_clinic), '[]'::jsonb) end,
    'pair_rules', coalesce((
      select jsonb_agg(jsonb_build_object('first_procedure', r.first_procedure, 'second_procedure', r.second_procedure,
                                          'rule', r.rule, 'min_gap_min', r.min_gap_min)
                       order by r.first_procedure, r.second_procedure, r.rule)
      from agenda.procedure_pair_rules r where r.clinic_id = p_clinic), '[]'::jsonb),
    'holiday_openings', coalesce((
      select jsonb_agg(h.day order by h.day) from agenda.holiday_openings h
      where h.clinic_id = p_clinic and h.day >= (now() at time zone c.timezone)::date), '[]'::jsonb));
end $$;
revoke all on function public.agenda_config(uuid) from public, anon, authenticated;
grant execute on function public.agenda_config(uuid) to authenticated;

/* ===================== 2. Modalidade e compromisso ===================== */
create or replace function public.agenda_mode_set(p_clinic uuid, p_mode text, p_commitment boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  c public.clinics;
  u agenda.unit_settings;
  v_compromisso boolean;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_mode is null or p_mode not in ('pedido', 'nativa', 'manual', 'externa') then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  select * into c from public.clinics x where x.id = p_clinic for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  -- entrar na externa ou sair dela: só quem gerencia a integração (a dona) ou a equipe do IMED
  if 'externa' in (p_mode, c.agenda_mode) and p_mode is distinct from c.agenda_mode then
    v_origin := private.agenda_actor(p_clinic, 'integracao.gerenciar', 'imed.clinicas.configurar');
    if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic for update;
  if p_mode <> 'pedido' then
    if u.clinic_id is null then return jsonb_build_object('status', 'agenda_not_started'); end if;
    if c.timezone_confirmed_at is null then return jsonb_build_object('status', 'timezone_not_confirmed'); end if;
  end if;
  if p_mode = 'manual' and not coalesce(p_commitment, false) then
    return jsonb_build_object('status', 'commitment_required');
  end if;
  if p_mode = 'pedido' and c.agenda_online_since is not null then
    return jsonb_build_object('status', 'online_active');
  end if;
  v_compromisso := p_mode = 'manual';
  if p_mode = c.agenda_mode and (u.manual_commitment_at is not null) = v_compromisso then
    return jsonb_build_object('status', 'ok', 'mode', p_mode, 'unchanged', true);
  end if;
  perform set_config('imed.origin', v_origin, true);
  if p_mode is distinct from c.agenda_mode then
    update public.clinics x set agenda_mode = p_mode where x.id = p_clinic;
  end if;
  if u.clinic_id is not null then
    update agenda.unit_settings s set
      manual_commitment_at = case when v_compromisso then now() end,
      manual_commitment_by = case when v_compromisso then auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
    where s.clinic_id = p_clinic;
  end if;
  perform private.agenda_audit(p_clinic, v_origin, 'modalidade.trocar', 'clinic', p_clinic::text,
    jsonb_build_object('agenda_mode', c.agenda_mode, 'compromisso', u.manual_commitment_at is not null),
    jsonb_build_object('agenda_mode', p_mode, 'compromisso', v_compromisso));
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'mode', p_mode);
end $$;
revoke all on function public.agenda_mode_set(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.agenda_mode_set(uuid, text, boolean) to authenticated;

comment on function public.agenda_config(uuid) is
  'Configuração da unidade para o painel (agenda.configurar ou imed.clinicas.configurar). Sem dado de paciente. Fase 4.1.';
comment on function public.agenda_mode_set(uuid, text, boolean) is
  'Troca a modalidade da agenda (pedido, nativa, manual com compromisso, externa). Não liga a venda online. Fase 4.1.';
