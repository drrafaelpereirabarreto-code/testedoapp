-- iMed Agenda, fase 3.4: parte 2 de 3 (equipe, aviso em tempo real, preço "a partir de", permissões das funções
-- antigas e retenção). O cabeçalho está na parte 1. Nada aqui apaga objeto: funções novas, CREATE OR REPLACE com a
-- mesma assinatura, um gatilho novo e uma policy NOVA em realtime.messages.
--   1. EQUIPE: convite por e-mail (agenda_invite; quem convida precisa de equipe.gerenciar; o gestor não convida nem
--      mexe em dono), lista (agenda_team), meus convites (agenda_my_invites), aceitar (agenda_invite_accept: mesmo
--      e-mail, confirmado, sessão pelo link), cancelar convite, trocar papel e remover (o último dono nunca sai nem é
--      rebaixado: as linhas de dono são travadas antes de contar). O e-mail do convite NÃO é enviado pelo IMED ainda
--      (fase 0.2, Resend): a pessoa entra no painel com aquele e-mail e aceita.
--   2. AVISO EM TEMPO REAL (§7): agenda_touch passa a mandar, pelo Supabase Realtime (Broadcast do banco, canal
--      PRIVADO), só {v: versão} no tópico agenda:clinica:<id> e {clinic_id, v} em agenda:imed. Nenhum dado de
--      paciente. A mensagem só sai depois do COMMIT (transação desfeita não avisa). Quem pode ouvir: a policy nova de
--      realtime.messages chama public.agenda_realtime_ok (membro com agenda.ver, inclusive o profissional; equipe do
--      IMED com imed.agenda.monitor). Ninguém publica pelo cliente (sem policy de INSERT). A correção nunca depende
--      do aviso: o painel confere agenda_version de tempos em tempos.
--   3. PREÇO "A PARTIR DE" (§2.5): com a agenda ativa, o preço da categoria em clinic_exams (o que a busca usa) é o
--      menor preço entre os procedimentos ativos dela, recalculado por gatilho; set_my_clinic_exams não muda essas
--      categorias (responde managed_by_agenda se tentarem).
--   4. FUNÇÕES ANTIGAS POR PERMISSÃO (§12): update_my_clinic exige clinica.editar e set_my_clinic_exams exige
--      precos.editar (a recepção não muda mais preço nem cadastro; hoje há 0 vínculos de equipe na produção).
--   5. RETENÇÃO (§12): reserva expirada há mais de 7 dias perde nome, telefone, e-mail, observações e o vínculo com a
--      conta (private.agenda_anonimizar, chamada pela manutenção de 30 s, lotes de 500).

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Equipe ===================== */

-- Membros e convites abertos da clínica (equipe.gerenciar ou imed.clinicas.configurar). E-mail de funcionário (não
-- de paciente), só para quem gerencia a equipe.
create or replace function public.agenda_team(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.clinic_perm_scope(p_clinic, 'equipe.gerenciar'), '') not in ('clinica', 'sem_donos')
     and not (auth.uid() is not null and public.imed_has('imed.clinicas.configurar')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
                                                             'created_at', m.created_at, 'me', m.user_id = auth.uid())
                                          order by m.role, u.email)
                         from public.clinic_members m join auth.users u on u.id = m.user_id
                         where m.clinic_id = p_clinic), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role,
                                                             'created_at', i.created_at, 'expires_at', i.expires_at)
                                          order by i.created_at)
                         from agenda.member_invites i
                         where i.clinic_id = p_clinic and i.status = 'aberto' and i.expires_at > now()), '[]'::jsonb));
end $$;

-- Quem pode mexer neste papel: o dono (escopo clinica) em tudo; o gestor (sem_donos) só fora de 'owner'; a equipe do
-- IMED com imed.clinicas.configurar. Devolve a origem ('painel' ou 'central') ou nulo.
create or replace function private.agenda_team_actor(p_clinic uuid, p_role text)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when public.clinic_perm_scope(p_clinic, 'equipe.gerenciar') = 'clinica' then 'painel'
    when public.clinic_perm_scope(p_clinic, 'equipe.gerenciar') = 'sem_donos' and coalesce(p_role, '') <> 'owner' then 'painel'
    when auth.uid() is not null and public.imed_has('imed.clinicas.configurar') then 'central' end;
$$;
revoke all on function private.agenda_team_actor(uuid, text) from public, anon, authenticated, service_role;

-- Convida um e-mail para um papel. Já é da equipe: already_member; já tem convite aberto: o papel é atualizado e o
-- prazo renovado. A auditoria guarda o papel, nunca o e-mail.
create or replace function public.agenda_invite(p_clinic uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_origin text;
  v_id uuid;
begin
  if p_role is null or p_role not in ('owner', 'manager', 'reception', 'professional', 'finance') then
    return jsonb_build_object('status', 'invalid_role');
  end if;
  v_origin := private.agenda_team_actor(p_clinic, p_role);
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if char_length(v_email) not between 6 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('status', 'invalid_email');
  end if;
  if exists (select 1 from public.clinic_members m join auth.users u on u.id = m.user_id
             where m.clinic_id = p_clinic and lower(u.email) = v_email) then
    return jsonb_build_object('status', 'already_member');
  end if;
  -- convite vencido ainda "aberto" sai do caminho (o índice único vale só para os abertos)
  update agenda.member_invites i set status = 'cancelado', cancelled_at = now()
  where i.clinic_id = p_clinic and i.email = v_email and i.status = 'aberto' and i.expires_at <= now();
  insert into agenda.member_invites (clinic_id, email, role, created_by)
  values (p_clinic, v_email, p_role, auth.uid())
  on conflict (clinic_id, email) where status = 'aberto'
  do update set role = excluded.role, created_by = excluded.created_by, expires_at = now() + interval '7 days'
  returning id into v_id;
  perform private.agenda_audit(p_clinic, v_origin, 'convite_criado', 'member_invite', v_id::text, null,
                               jsonb_build_object('role', p_role));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.agenda_invite_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i agenda.member_invites;
  v_origin text;
begin
  select * into i from agenda.member_invites x where x.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_origin := private.agenda_team_actor(i.clinic_id, i.role);
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if i.status <> 'aberto' then return jsonb_build_object('status', 'not_open'); end if;
  update agenda.member_invites x set status = 'cancelado', cancelled_at = now() where x.id = p_id and x.status = 'aberto';
  perform private.agenda_audit(i.clinic_id, v_origin, 'convite_cancelado', 'member_invite', i.id::text,
                               jsonb_build_object('role', i.role), null);
  return jsonb_build_object('status', 'ok');
end $$;

-- Convites abertos para o e-mail de quem está logado (só com a sessão segura: e-mail confirmado, entrada pelo link).
create or replace function public.agenda_my_invites()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.agenda_secure_session() then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'invites', coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'clinic_id', i.clinic_id, 'clinic_name', c.name, 'role', i.role,
                                        'expires_at', i.expires_at) order by i.created_at)
    from agenda.member_invites i join public.clinics c on c.id = i.clinic_id join auth.users u on u.id = auth.uid()
    where i.status = 'aberto' and i.expires_at > now() and i.email = lower(u.email)), '[]'::jsonb));
end $$;

-- Aceita um convite: o e-mail da conta (confirmado, sessão pelo link) tem de ser o do convite; o convite fica preso
-- a esta conta. Quem já é da equipe continua com o papel que tem (already_member).
create or replace function public.agenda_invite_accept(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i agenda.member_invites;
  v_email text;
begin
  if auth.uid() is null or not private.agenda_secure_session() then return jsonb_build_object('status', 'forbidden'); end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  select * into i from agenda.member_invites x where x.id = p_id for update;
  if not found or i.email <> v_email then return jsonb_build_object('status', 'not_found'); end if;
  if i.status <> 'aberto' then return jsonb_build_object('status', 'not_open'); end if;
  if i.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  if exists (select 1 from public.clinic_members m where m.clinic_id = i.clinic_id and m.user_id = auth.uid()) then
    update agenda.member_invites x set status = 'cancelado', cancelled_at = now() where x.id = i.id;
    return jsonb_build_object('status', 'already_member');
  end if;
  insert into public.clinic_members (clinic_id, user_id, role, created_by) values (i.clinic_id, auth.uid(), i.role, i.created_by);
  update agenda.member_invites x set status = 'aceito', accepted_by = auth.uid(), accepted_at = now() where x.id = i.id;
  perform private.agenda_audit(i.clinic_id, 'painel', 'convite_aceito', 'member_invite', i.id::text, null,
                               jsonb_build_object('role', i.role));
  return jsonb_build_object('status', 'ok', 'clinic_id', i.clinic_id, 'role', i.role);
end $$;

-- Troca o papel de alguém da equipe. O último dono não é rebaixado (as linhas de dono são travadas antes de contar).
create or replace function public.agenda_member_role(p_clinic uuid, p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_role is null or p_role not in ('owner', 'manager', 'reception', 'professional', 'finance') then
    return jsonb_build_object('status', 'invalid_role');
  end if;
  if private.agenda_team_actor(p_clinic, null) is null then return jsonb_build_object('status', 'forbidden'); end if;
  perform 1 from public.clinic_members m where m.clinic_id = p_clinic and m.role = 'owner' order by m.user_id for update;
  select m.role into v_old from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if private.agenda_team_actor(p_clinic, v_old) is null or private.agenda_team_actor(p_clinic, p_role) is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_old = p_role then return jsonb_build_object('status', 'ok', 'unchanged', true); end if;
  if v_old = 'owner' and (select count(*) from public.clinic_members m where m.clinic_id = p_clinic and m.role = 'owner') <= 1 then
    return jsonb_build_object('status', 'last_owner');
  end if;
  update public.clinic_members m set role = p_role, updated_at = now() where m.clinic_id = p_clinic and m.user_id = p_user;
  perform private.agenda_audit(p_clinic, private.agenda_team_actor(p_clinic, p_role), 'papel_trocado', 'clinic_member',
                               p_user::text, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
  return jsonb_build_object('status', 'ok');
end $$;

-- Tira alguém da equipe (inclusive a si mesmo). O último dono nunca sai. O profissional ligado a um recurso perde o
-- vínculo (o recurso continua). Perde o acesso na próxima chamada.
create or replace function public.agenda_member_remove(p_clinic uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_origin text;
begin
  -- sair da própria equipe: qualquer membro; tirar outra pessoa: quem gerencia a equipe (o gestor não tira dono)
  if p_user is distinct from auth.uid() and private.agenda_team_actor(p_clinic, null) is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  perform 1 from public.clinic_members m where m.clinic_id = p_clinic and m.role = 'owner' order by m.user_id for update;
  select m.role into v_old from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_origin := case when p_user = auth.uid() then 'painel' else private.agenda_team_actor(p_clinic, v_old) end;
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if v_old = 'owner' and (select count(*) from public.clinic_members m where m.clinic_id = p_clinic and m.role = 'owner') <= 1 then
    return jsonb_build_object('status', 'last_owner');
  end if;
  perform private.agenda_audit(p_clinic, v_origin, 'membro_removido', 'clinic_member', p_user::text,
                               jsonb_build_object('role', v_old), null);
  update agenda.resources r set member_user_id = null, updated_at = now(), updated_by = auth.uid()
  where r.clinic_id = p_clinic and r.member_user_id = p_user;
  delete from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = p_user;
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 2. Aviso em tempo real (§7) ===================== */

-- Quem pode ouvir um tópico: agenda:clinica:<id> = quem tem agenda.ver na clínica (inclusive o profissional, de
-- escopo 'propria') ou a equipe do IMED com imed.agenda.monitor; agenda:imed = só a equipe do IMED. Usada pela policy
-- de realtime.messages (roda como a pessoa conectada; por isso fica em public, só para authenticated).
create or replace function public.agenda_realtime_ok(p_topic text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or p_topic is null then false
    when p_topic ~ '^agenda:clinica:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then coalesce(public.clinic_perm_scope(split_part(p_topic, ':', 3)::uuid, 'agenda.ver') in ('clinica', 'propria'), false)
           or public.imed_has('imed.agenda.monitor')
    when p_topic = 'agenda:imed' then public.imed_has('imed.agenda.monitor')
    else false end;
$$;
revoke all on function public.agenda_realtime_ok(text) from public, anon, authenticated;
grant execute on function public.agenda_realtime_ok(text) to authenticated;

-- Versão da agenda da clínica + aviso. A mensagem vai para realtime.messages DENTRO desta transação e o Realtime só
-- a entrega depois do COMMIT. realtime.send não derruba a transação se falhar (só registra um aviso no log).
create or replace function private.agenda_touch(p_clinic uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into agenda.clinic_versions as cv (clinic_id, version, changed_at)
  values (p_clinic, 1, now())
  on conflict (clinic_id) do update set version = cv.version + 1, changed_at = now()
  returning cv.version into v;
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    perform realtime.send(jsonb_build_object('v', v), 'agenda', 'agenda:clinica:' || p_clinic::text, true);
    perform realtime.send(jsonb_build_object('clinic_id', p_clinic, 'v', v), 'agenda', 'agenda:imed', true);
  end if;
  return v;
end $$;
revoke all on function private.agenda_touch(uuid) from public, anon, authenticated, service_role;

-- Só leitura (nenhuma policy de INSERT: o cliente não publica). Uma policy só, para os dois tópicos.
-- (criada só se ainda não existe: rodar de novo não muda nada e nada é apagado)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'agenda: avisos da agenda') then
    create policy "agenda: avisos da agenda" on realtime.messages
      for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.agenda_realtime_ok((select realtime.topic())));
  end if;
end $$;

/* ===================== 3. Preço "a partir de" (§2.5) ===================== */

-- Depois de mudar procedimentos: o preço da categoria em clinic_exams = o menor preço dos procedimentos ativos dela
-- (nulo = sob consulta). Trava a linha de clinic_exams antes de recalcular. Categoria sem procedimento ativo: fica
-- como está (a clínica volta a cuidar dela pelo editor antigo).
create or replace function private.agenda_price_from()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  v_n integer;
  v_min integer;
begin
  for k in
    select distinct x.clinic_id, x.exam_code
    from (select new.clinic_id, new.exam_code where tg_op <> 'DELETE'
          union all select old.clinic_id, old.exam_code where tg_op <> 'INSERT') x
    order by 1, 2
  loop
    perform 1 from public.clinic_exams e where e.clinic_id = k.clinic_id and e.exam_code = k.exam_code for update;
    select count(*), min(p.price_cents) into v_n, v_min
    from agenda.procedures p
    where p.clinic_id = k.clinic_id and p.exam_code = k.exam_code and p.active and p.archived_at is null;
    if v_n > 0 and exists (select 1 from public.clinics c where c.id = k.clinic_id) then
      insert into public.clinic_exams as e (clinic_id, exam_code, price_cents, price_updated_at)
      values (k.clinic_id, k.exam_code, v_min, now())
      on conflict (clinic_id, exam_code) do update
        set price_cents = excluded.price_cents, price_updated_at = now()
        where e.price_cents is distinct from excluded.price_cents;
    end if;
  end loop;
  return null;
end $$;
revoke all on function private.agenda_price_from() from public, anon, authenticated, service_role;

create or replace trigger procedures_price_from
  after insert or update of price_cents, active, archived_at, exam_code or delete on agenda.procedures
  for each row execute function private.agenda_price_from();
-- (como as outras guardas da agenda: vale também com session_replication_role = replica)
alter table agenda.procedures enable always trigger procedures_price_from;

/* ===================== 4. Funções antigas por permissão (§12) ===================== */

-- Igual à de 20261030021903_marketplace, com a permissão clinica.editar (dono e gestor) no lugar de "qualquer membro".
create or replace function public.update_my_clinic(p_clinic uuid, p jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.has_clinic_perm(p_clinic, 'clinica.editar') or public.is_imed_admin()) then return 'forbidden'; end if;
  update public.clinics c set
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else c.phone end,
    whatsapp = case when p ? 'whatsapp' then nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), '') else c.whatsapp end,
    email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else c.email end,
    website = case when p ? 'website' then nullif(btrim(p ->> 'website'), '') else c.website end,
    description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else c.description end,
    opening_hours = case when p ? 'opening_hours' then nullif(p -> 'opening_hours', 'null'::jsonb) else c.opening_hours end,
    accepts_online_booking = case when p ? 'accepts_online_booking' then coalesce((p ->> 'accepts_online_booking')::boolean, false) else c.accepts_online_booking end,
    specialties = case when p ? 'specialties' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'specialties') x where btrim(x) <> '' limit 30), '{}') else c.specialties end,
    insurances = case when p ? 'insurances' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'insurances') x where btrim(x) <> '' limit 60), '{}') else c.insurances end,
    updated_at = now()
  where c.id = p_clinic;
  return 'ok';
end $$;
revoke execute on function public.update_my_clinic(uuid, jsonb) from public, anon;
grant execute on function public.update_my_clinic(uuid, jsonb) to authenticated;

-- Igual à de 20261030021903_marketplace, com a permissão precos.editar (dono e gestor) e sem mexer nas categorias que
-- a agenda calcula (procedimento ativo): para elas, se a lista tentar mudar algo, responde managed_by_agenda (o
-- resto é gravado do mesmo jeito).
create or replace function public.set_my_clinic_exams(p_clinic uuid, p_exams jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_agenda text[];
  v_mexeu boolean;
begin
  if not (public.has_clinic_perm(p_clinic, 'precos.editar') or public.is_imed_admin()) then return 'forbidden'; end if;
  select coalesce(array_agg(distinct p.exam_code), '{}') into v_agenda
  from agenda.procedures p where p.clinic_id = p_clinic and p.active and p.archived_at is null;
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_exams, '[]'::jsonb)) x
    where x ->> 'code' = any (v_agenda)
      and (select e.price_cents from public.clinic_exams e where e.clinic_id = p_clinic and e.exam_code = x ->> 'code')
          is distinct from nullif(x ->> 'price_cents', '')::integer)
    or exists (select 1 from unnest(v_agenda) a
               where not exists (select 1 from jsonb_array_elements(coalesce(p_exams, '[]'::jsonb)) x where x ->> 'code' = a))
  into v_mexeu;
  delete from public.clinic_exams where clinic_id = p_clinic and exam_code <> all (v_agenda);
  insert into public.clinic_exams (clinic_id, exam_code, price_cents, price_updated_at)
  select p_clinic, x ->> 'code', nullif(x ->> 'price_cents', '')::integer,
         case when nullif(x ->> 'price_cents', '') is not null then now() end
  from jsonb_array_elements(coalesce(p_exams, '[]'::jsonb)) x
  where x ->> 'code' in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
    and x ->> 'code' <> all (v_agenda)
  on conflict do nothing;
  return case when v_mexeu then 'managed_by_agenda' else 'ok' end;
end $$;
revoke execute on function public.set_my_clinic_exams(uuid, jsonb) from public, anon;
grant execute on function public.set_my_clinic_exams(uuid, jsonb) to authenticated;

/* ===================== 5. Retenção da reserva expirada (§12) ===================== */

-- Reserva expirada há mais de 7 dias: apaga nome, telefone, e-mail, observação, nome e parentesco de quem faria o
-- exame, o vínculo com a conta e o código de acompanhamento; as notas livres do pedido também. Ficam só códigos,
-- horários e a situação (para os números). Lotes de até p_limit (SKIP LOCKED). Devolve quantas apagou.
create or replace function private.agenda_anonimizar(p_limit integer default 500)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(x.id) into v_ids
  from (select a.id from public.appointment_requests a
        where a.status = 'expired' and a.anonymized_at is null and a.updated_at < now() - interval '7 days'
        order by a.updated_at
        limit greatest(coalesce(p_limit, 500), 1)
        for update skip locked) x;
  if v_ids is null then return 0; end if;
  update public.appointment_requests a
  set patient_name = 'Removido', patient_phone = '0000000000', patient_email = null, notes = null,
      other_name = case when a.for_other then 'Removido' end,
      relationship = case when a.for_other then 'Removido' end,
      user_id = null, review_token_hash = null, anonymized_at = now()
  where a.id = any (v_ids);
  update agenda.notes n set text = null, deleted_at = now() where n.request_id = any (v_ids) and n.deleted_at is null;
  return cardinality(v_ids);
end $$;
revoke all on function private.agenda_anonimizar(integer) from public, anon, authenticated, service_role;

-- A rotina do pg_cron (igual à da 3.3) + a retenção acima, antes da limpeza de idempotência e contadores.
create or replace procedure private.agenda_manutencao()
language plpgsql
as $$
declare
  v_ids uuid[];
  v_clinics uuid[];
  v_id uuid;
  v_c uuid;
  v_n integer;
  v_lote integer := 0;
begin
  loop
    v_lote := v_lote + 1;
    exit when v_lote > 40;
    perform pg_catalog.set_config('lock_timeout', '2s', true);
    select pg_catalog.array_agg(x.id order by x.venc), pg_catalog.array_agg(x.clinic_id order by x.venc)
      into v_ids, v_clinics
    from (select a.id, a.clinic_id, a.hold_expires_at + pg_catalog.make_interval(mins => coalesce(u.payment_grace_min, 0)::integer) as venc
          from public.appointment_requests a
          left join agenda.unit_settings u on u.clinic_id = a.clinic_id
          where a.status in ('hold', 'awaiting_payment')
            and a.hold_expires_at + pg_catalog.make_interval(mins => coalesce(u.payment_grace_min, 0)::integer) <= pg_catalog.now()
          order by 3
          limit 50) x;
    exit when v_ids is null;
    v_n := 0;
    for i in 1 .. pg_catalog.cardinality(v_ids) loop
      if private.agenda_expire(v_ids[i]) then
        v_n := v_n + 1;
      else
        v_clinics[i] := null;
      end if;
    end loop;
    for v_c in select distinct c from pg_catalog.unnest(v_clinics) c where c is not null order by 1 loop
      perform private.agenda_touch(v_c);
    end loop;
    commit;
    exit when v_n = 0 or pg_catalog.cardinality(v_ids) < 50;
  end loop;
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  perform private.agenda_anonimizar(500);
  commit;
  delete from agenda.idempotency where ctid in (
    select ctid from agenda.idempotency where created_at < pg_catalog.now() - interval '7 days' limit 5000);
  delete from agenda.rate_counters where ctid in (
    select ctid from agenda.rate_counters where window_start < pg_catalog.now() - interval '48 hours' limit 5000);
  commit;
end $$;

/* ===================== 6. Permissões das funções novas ===================== */
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agenda_team(uuid)', 'public.agenda_invite(uuid, text, text)', 'public.agenda_invite_cancel(uuid)',
    'public.agenda_my_invites()', 'public.agenda_invite_accept(uuid)', 'public.agenda_member_role(uuid, uuid, text)',
    'public.agenda_member_remove(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
