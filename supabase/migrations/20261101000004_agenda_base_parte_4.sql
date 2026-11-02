-- iMed Agenda, fase 3.1 ("Fundação"): parte 4 de 5 (blocos 9 a 11). O cabeçalho, com o que a
-- migração faz e as conferências, está na parte 1 (<versão>_agenda_base_parte_1.sql). Repete o bloco 0 (limite
-- de espera e travas): cada parte é uma transação própria.

/* ===================== 0. Limite de espera e travas (para aplicar na produção sem segurar o site) ===================== */
-- Se uma transação longa estiver segurando uma destas tabelas (por exemplo, uma consulta largada aberta no painel), a
-- migração desiste em 5 s com erro 55P03 e NADA é aplicado: é só rodar de novo. Sem isso, ela esperaria para sempre e
-- toda leitura do site entraria na fila atrás dela (o visitante levaria erro em 3 s). As travas são pegas de uma vez e
-- na mesma ordem do INSERT do site (primeiro o pedido, depois a clínica), para não haver impasse (40P01) com um pedido
-- feito durante a aplicação. (O LOCK fica num bloco DO porque a CLI do Supabase manda o arquivo como uma transação
-- implícita, onde LOCK TABLE solto é recusado; as travas valem até o fim da transação, como as dos ALTER.)
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
do $$
begin
  lock table public.appointment_requests, public.clinics, public.clinic_members, public.clinic_schedules,
    public.clinic_blocks in access exclusive mode;
end $$;

/* ===================== 9. Pedido de agendamento: gatilhos de origem, versão e histórico ===================== */

-- Antes de gravar um pedido (BEFORE INSERT). SECURITY DEFINER (search_path vazio, sem EXECUTE para ninguém):
-- a validação não depende de quem grava.
--   Sem a marca imed.origin: caminho antigo (o INSERT direto do site de hoje), com as MESMAS regras, na mesma
--   ordem e com as mesmas mensagens de antes; as colunas novas ficam sempre no valor padrão.
--   Com a marca (funções da agenda, 3.3 em diante): só os dados do paciente (validação única) e as datas; a função
--   decide situação, horário e canal.
create or replace function public.check_appointment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_ts timestamp;
  v_origin text := private.agenda_origin();
begin
  if v_origin is null then
    if new.preferred_date < today or new.preferred_date > today + 120 then
      raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
    end if;
    if new.clinic_id is not null and not exists (
      select 1 from public.clinics c
      where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
    ) then
      raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
    end if;
  end if;
  new := private.agenda_validate_patient(new);
  if v_origin is not null then
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    if v_origin = 'sql' then
      -- pedido criado à mão pelo SQL (sem a conferência do horário): exige o motivo e fica registrado (§5)
      perform private.agenda_audit_sql(new.clinic_id, 'pedido_criado_sql', 'appointment_request', new.id::text, null,
        jsonb_build_object('status', new.status, 'slot_start', new.slot_start, 'slot_end', new.slot_end,
                           'clinic_id', new.clinic_id, 'channel', new.channel));
    end if;
    return new;
  end if;
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.status := 'pending';
  if new.slot_start is not null then
    if new.clinic_id is null then
      raise exception 'Horário só pode ser escolhido em clínica parceira com agenda' using errcode = '22023';
    end if;
    if not exists (select 1 from public.available_slots(new.clinic_id, new.exam_code,
                     (new.slot_start at time zone 'America/Sao_Paulo')::date, 1) a where a.slot_start = new.slot_start) then
      raise exception 'Este horário não está mais livre. Escolha outro.' using errcode = '23P01';
    end if;
    local_ts := new.slot_start at time zone 'America/Sao_Paulo';
    new.preferred_date := local_ts::date;
    new.preferred_period := case when local_ts::time < '12:00' then 'manha' when local_ts::time < '18:00' then 'tarde' else 'noite' end;
    new.status := 'confirmed';
  end if;
  new.created_at := now();
  new.user_id := auth.uid();
  -- Colunas novas: sempre o padrão no caminho antigo (o navegador nem tem permissão para gravá-las).
  new.channel := 'imed_app';
  new.slot_end := null;
  new.hold_expires_at := null;
  new.version := 1;
  new.updated_at := now();
  new.cancel_reason := null;
  new.total_cents := null;
  new.payment_mode := 'no_local';
  new.notify_channels := '{}';
  new.uses_resources := false;
  return new;
end $$;
-- Função de gatilho: ninguém chama como RPC (o gatilho continua funcionando), como antes.
revoke execute on function public.check_appointment_request() from public, anon, authenticated;

-- BEFORE UPDATE OF status, slot_start, slot_end, clinic_id, hold_expires_at, uses_resources e BEFORE DELETE: só com a
-- marca de origem. Saída de emergência pelo SQL (imed.origin = 'sql' + imed.reason), registrada em agenda.audit_log.
-- Exceção: a clínica foi apagada e a chave estrangeira (on delete set null) solta o pedido dela, como sempre.
-- (Apagar um pedido apaga em cascata os itens e a ocupação dele: sem a marca, o horário seria liberado sem registro.
-- Nenhum código de hoje apaga pedido.)
create or replace function private.agenda_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  if tg_op = 'DELETE' then
    v_origin := private.agenda_origin();
    if v_origin is null then
      raise exception 'Um pedido só é apagado pelas funções da agenda'
        using errcode = '42501',
              hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
    end if;
    if v_origin = 'sql' then
      perform private.agenda_audit_sql(old.clinic_id, 'pedido_apagado_sql', 'appointment_request', old.id::text,
        jsonb_build_object('status', old.status, 'slot_start', old.slot_start, 'slot_end', old.slot_end,
                           'clinic_id', old.clinic_id, 'uses_resources', old.uses_resources), null);
    end if;
    return old;
  end if;
  if (new.status, new.slot_start, new.slot_end, new.clinic_id, new.hold_expires_at, new.uses_resources)
     is not distinct from (old.status, old.slot_start, old.slot_end, old.clinic_id, old.hold_expires_at, old.uses_resources) then
    return new;
  end if;
  if new.clinic_id is null and old.clinic_id is not null
     and (new.status, new.slot_start, new.slot_end, new.hold_expires_at, new.uses_resources)
         is not distinct from (old.status, old.slot_start, old.slot_end, old.hold_expires_at, old.uses_resources)
     and not exists (select 1 from public.clinics c where c.id = old.clinic_id) then
    return new;
  end if;
  v_origin := private.agenda_origin();
  if v_origin is null then
    raise exception 'A situação, o horário e a clínica de um pedido só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    perform private.agenda_audit_sql(coalesce(new.clinic_id, old.clinic_id), 'pedido_alterado_sql', 'appointment_request',
      new.id::text,
      jsonb_build_object('status', old.status, 'slot_start', old.slot_start, 'slot_end', old.slot_end, 'clinic_id', old.clinic_id,
                         'hold_expires_at', old.hold_expires_at, 'uses_resources', old.uses_resources),
      jsonb_build_object('status', new.status, 'slot_start', new.slot_start, 'slot_end', new.slot_end, 'clinic_id', new.clinic_id,
                         'hold_expires_at', new.hold_expires_at, 'uses_resources', new.uses_resources));
  end if;
  return new;
end $$;

-- BEFORE UPDATE: toda mudança de verdade sobe a versão (controle de concorrência do painel) e o updated_at.
create or replace function private.agenda_requests_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new is not distinct from old then
    return new;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- AFTER UPDATE OF status (só quando muda): uma linha no histórico, com a origem da marca e o motivo (código).
create or replace function private.agenda_requests_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := coalesce(private.agenda_origin(), 'sql');
  v_actor text;
  v_role text;
begin
  v_actor := case v_origin when 'app' then 'paciente' when 'painel' then 'clinica' when 'central' then 'imed'
                           when 'api' then 'integracao' when 'webhook_pagamento' then 'gateway' when 'cron' then 'sistema'
                           else 'sql' end;
  if v_actor = 'clinica' then
    select m.role into v_role from public.clinic_members m where m.clinic_id = new.clinic_id and m.user_id = auth.uid();
  elsif v_actor = 'imed' then
    v_role := case when coalesce(public.is_imed_admin(), false) then 'imed_admin'
                   else (select 'imed_' || s.role from private.imed_staff s
                         where s.user_id = auth.uid() and s.revoked_at is null order by s.role limit 1) end;
  end if;
  insert into agenda.status_history (request_id, item_id, from_status, to_status, actor_kind, actor_user, actor_role,
                                     origin, reason_code, request_version)
  values (new.id, null, old.status, new.status, v_actor, auth.uid(), v_role, v_origin, private.agenda_reason(), new.version);
  return null;
end $$;

revoke all on function private.agenda_requests_guard() from public, anon, authenticated, service_role;
revoke all on function private.agenda_requests_touch() from public, anon, authenticated, service_role;
revoke all on function private.agenda_requests_history() from public, anon, authenticated, service_role;

create or replace trigger appointment_requests_guard
  before update of status, slot_start, slot_end, clinic_id, hold_expires_at, uses_resources or delete
  on public.appointment_requests
  for each row execute function private.agenda_requests_guard();
create or replace trigger appointment_requests_touch
  before update on public.appointment_requests
  for each row execute function private.agenda_requests_touch();
create or replace trigger appointment_requests_hist
  after update of status on public.appointment_requests
  for each row when (old.status is distinct from new.status) execute function private.agenda_requests_history();

/* ===================== 10. Clínica: fuso, modalidade e venda online só pelas funções da agenda ===================== */
-- BEFORE INSERT: sem a marca, clínica nova nasce no modelo de pedido, sem venda online e com o fuso sugerido pela UF
-- (não confirmado). BEFORE UPDATE OF timezone, timezone_confirmed_at, agenda_mode, agenda_online_since: só com a
-- marca (fecha também o PATCH direto que a policy "admin gerencia clinicas" permite hoje); pelo SQL, registrado.
create or replace function private.agenda_clinics_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_origin();
begin
  if tg_op = 'INSERT' then
    if v_origin is null then
      if new.agenda_mode is distinct from 'pedido' or new.agenda_online_since is not null
         or new.timezone_confirmed_at is not null then
        raise exception 'Modalidade da agenda, venda online e confirmação do fuso só mudam pelas funções da agenda'
          using errcode = '42501';
      end if;
      -- de propósito: sem a marca, o fuso vem SEMPRE da UF (o que o INSERT mandou é ignorado; a clínica confirma
      -- o fuso pelas funções da agenda antes de ativar)
      new.timezone := private.agenda_suggested_timezone(new.state, new.cnes);
    elsif v_origin = 'sql' then
      perform private.agenda_audit_sql(new.id, 'clinica_criada_sql', 'clinic', new.id::text, null,
        jsonb_build_object('timezone', new.timezone, 'timezone_confirmed_at', new.timezone_confirmed_at,
                           'agenda_mode', new.agenda_mode, 'agenda_online_since', new.agenda_online_since));
    end if;
    return new;
  end if;
  if (new.timezone, new.timezone_confirmed_at, new.agenda_mode, new.agenda_online_since)
     is not distinct from (old.timezone, old.timezone_confirmed_at, old.agenda_mode, old.agenda_online_since) then
    return new;
  end if;
  if v_origin is null then
    raise exception 'Fuso, modalidade da agenda e venda online só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    perform private.agenda_audit_sql(new.id, 'clinica_agenda_sql', 'clinic', new.id::text,
      jsonb_build_object('timezone', old.timezone, 'timezone_confirmed_at', old.timezone_confirmed_at,
                         'agenda_mode', old.agenda_mode, 'agenda_online_since', old.agenda_online_since),
      jsonb_build_object('timezone', new.timezone, 'timezone_confirmed_at', new.timezone_confirmed_at,
                         'agenda_mode', new.agenda_mode, 'agenda_online_since', new.agenda_online_since));
  end if;
  return new;
end $$;
revoke all on function private.agenda_clinics_guard() from public, anon, authenticated, service_role;

create or replace trigger clinics_agenda_guard
  before insert or update of timezone, timezone_confirmed_at, agenda_mode, agenda_online_since on public.clinics
  for each row execute function private.agenda_clinics_guard();

/* ===================== 11. Ocupação e recursos: vagas, capacidade e marca de origem ===================== */

-- [espelho do laço local]
-- Antes de gravar uma ocupação: o fechamento ganha o próprio grupo ([id,id]); o uso (novo, reativado ou que mudou
-- de vaga, horário ou recurso) precisa de recurso ativo da mesma clínica e de vaga dentro da capacidade, lida com
-- FOR SHARE (espera quem estiver mudando a capacidade ao mesmo tempo, e vice-versa; §3.2 e §3.3, I1-c).
create or replace function private.agenda_occupancy_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap smallint;
begin
  if new.kind = 'bloqueio' and new.excl_group = '(,)'::int8range then
    new.excl_group := int8range(new.id, new.id, '[]');
  end if;
  if new.kind <> 'bloqueio' and new.active
     and (tg_op = 'INSERT' or not old.active or new.seats <> old.seats or new.during <> old.during
          or new.resource_id <> old.resource_id or new.clinic_id <> old.clinic_id) then
    select r.capacity into v_cap
    from agenda.resources r
    where r.id = new.resource_id and r.clinic_id = new.clinic_id and r.active and r.archived_at is null
    for share;
    if v_cap is null then
      raise exception 'Recurso inexistente, inativo ou arquivado' using errcode = '23503';
    end if;
    if coalesce(upper(new.seats) - 1 > v_cap, true) then   -- vaga sem limite (NULL) também é recusada
      raise exception 'Vaga % acima da capacidade % do recurso', upper(new.seats) - 1, v_cap using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace trigger occupancy_seats
  before insert or update on agenda.occupancy
  for each row execute function private.agenda_occupancy_seats();
-- ALWAYS: vale também com session_replication_role = replica (que desliga os gatilhos comuns; o dono do banco
-- consegue ligar esse modo na produção, e a documentação do Supabase o sugere em restaurações). Ver bloco 17.
alter table agenda.occupancy enable always trigger occupancy_seats;

-- Reduzir a capacidade, desativar ou arquivar um recurso só sem usos futuros ativos que deixariam de caber
-- (redução temporária é bloqueio, nunca edição). Com a trava da linha do recurso, quem marca na vaga alta espera
-- esta mudança e depois é recusado, ou esta mudança espera a marcação e depois a vê (§3.3, I1-c).
create or replace function private.agenda_resources_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.capacity < old.capacity and exists (
       select 1 from agenda.occupancy o
       where o.resource_id = old.id and o.active and o.kind <> 'bloqueio'
         and upper(o.during) > now() and upper(o.seats) - 1 > new.capacity) then
    raise exception 'Há usos futuros nas vagas acima da nova capacidade (%): remarque antes ou use um bloqueio', new.capacity
      using errcode = '23514';
  end if;
  if ((old.active and not new.active) or (old.archived_at is null and new.archived_at is not null)) and exists (
       select 1 from agenda.occupancy o
       where o.resource_id = old.id and o.active and o.kind <> 'bloqueio' and upper(o.during) > now()) then
    raise exception 'O recurso tem usos futuros: remarque ou cancele antes de desativar ou arquivar'
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace trigger resources_guard
  before update of capacity, active, archived_at on agenda.resources
  for each row execute function private.agenda_resources_guard();
alter table agenda.resources enable always trigger resources_guard;
-- [fim do espelho]

-- Itens e ocupação só mudam pelas funções da agenda (marca de origem); pelo SQL, com motivo e registrado.
-- Apagar em cascata (o pedido, o item, o "ocupado" ou o bloqueio dono da linha foi apagado) segue livre.
-- Dois gatilhos com a mesma função: BEFORE confere a marca e o motivo (recusa cedo); AFTER registra a linha FINAL
-- (depois dos outros gatilhos BEFORE, como o que dá o grupo [id,id] ao fechamento) e só se ela foi mesmo gravada
-- (um ON CONFLICT DO NOTHING que não grava não deixa auditoria). A auditoria guarda uma lista FIXA de campos (sem
-- dado de paciente nem texto livre, mesmo que uma coluna nova apareça depois).
create or replace function private.agenda_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
  v_cascata boolean := false;
  v_campos text[];
  v_old jsonb;
  v_new jsonb;
begin
  -- (cada tabela no seu bloco: o PL/pgSQL só resolve old.<coluna> da tabela do gatilho)
  if tg_op = 'DELETE' then
    if tg_table_name = 'occupancy' then
      v_cascata := (old.item_id is not null and not exists (select 1 from agenda.appointment_items i where i.id = old.item_id))
                or (old.busy_id is not null and not exists (select 1 from agenda.busy_marks b where b.id = old.busy_id))
                or (old.block_id is not null and not exists (select 1 from public.clinic_blocks b where b.id = old.block_id));
    elsif tg_table_name = 'appointment_items' then
      v_cascata := not exists (select 1 from public.appointment_requests r where r.id = old.request_id);
    end if;
  end if;
  v_origin := private.agenda_origin();

  if tg_when = 'AFTER' then
    -- registro da emergência pelo SQL (a cascata já ficou registrada no dono que foi apagado)
    if v_origin = 'sql' and not v_cascata then
      v_campos := case tg_table_name
        when 'occupancy' then array['id', 'resource_id', 'kind', 'seats', 'during', 'excl_group', 'item_id', 'group_no',
                                    'busy_id', 'block_id', 'hold_until', 'active', 'released_at', 'release_reason']
        else array['id', 'request_id', 'seq', 'procedure_id', 'exam_code', 'starts_at', 'ends_at', 'status', 'version'] end;
      if tg_op <> 'INSERT' then
        select jsonb_object_agg(e.key, e.value) into v_old from jsonb_each(to_jsonb(old)) e where e.key = any (v_campos);
      end if;
      if tg_op <> 'DELETE' then
        select jsonb_object_agg(e.key, e.value) into v_new from jsonb_each(to_jsonb(new)) e where e.key = any (v_campos);
      end if;
      perform private.agenda_audit_sql(case tg_op when 'DELETE' then old.clinic_id else new.clinic_id end,
        tg_table_name || '_' || lower(tg_op), tg_table_name, coalesce(v_new, v_old) ->> 'id', v_old, v_new);
    end if;
    return null;
  end if;

  -- BEFORE
  if v_cascata then
    return old;
  end if;
  if v_origin is null then
    raise exception 'Itens e ocupação da agenda só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    if tg_op = 'TRUNCATE' then
      perform private.agenda_audit_sql(null, tg_table_name || '_truncate', tg_table_name, null, null, null);
      return null;
    end if;
    if private.agenda_reason() is null then
      raise exception 'Mudança pelo SQL sem motivo: defina imed.reason (um código) junto com imed.origin = ''sql'''
        using errcode = '42501',
              hint = 'select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true);';
    end if;
  end if;
  if tg_op = 'TRUNCATE' then return null; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function private.agenda_occupancy_seats() from public, anon, authenticated, service_role;
revoke all on function private.agenda_resources_guard() from public, anon, authenticated, service_role;
revoke all on function private.agenda_write_guard() from public, anon, authenticated, service_role;

create or replace trigger occupancy_guard
  before insert or update or delete on agenda.occupancy
  for each row execute function private.agenda_write_guard();
create or replace trigger occupancy_guard_audit
  after insert or update or delete on agenda.occupancy
  for each row execute function private.agenda_write_guard();
create or replace trigger occupancy_guard_truncate
  before truncate on agenda.occupancy
  for each statement execute function private.agenda_write_guard();
create or replace trigger appointment_items_guard
  before insert or update or delete on agenda.appointment_items
  for each row execute function private.agenda_write_guard();
create or replace trigger appointment_items_guard_audit
  after insert or update or delete on agenda.appointment_items
  for each row execute function private.agenda_write_guard();
create or replace trigger appointment_items_guard_truncate
  before truncate on agenda.appointment_items
  for each statement execute function private.agenda_write_guard();
