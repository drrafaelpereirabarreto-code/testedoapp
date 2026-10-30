-- Recursos de confiança do IMED (30/10/2026).
--
-- Em linguagem simples, esta migração:
--   1. Deixa o paciente CANCELAR o pedido pelo site (cancel_request), com o código secreto que fica no aparelho
--      ou pela conta. O horário marcado volta a ficar livre (o índice único e available_slots já ignoram
--      pedidos cancelados) e o painel mostra quem cancelou e quando (cancelled_at / cancelled_by).
--   2. Cria o "Fale com o IMED" (contact_messages + send_contact): a mensagem fica gravada e a pessoa recebe na
--      hora um número de protocolo (IMED-AAAAMMDD-XXXX). Só a equipe do IMED lê e marca como respondida.
--   3. Cria os avisos "Algo errado aqui?" da ficha de cada local (place_reports + report_place_issue): telefone
--      errado, local fechado, endereço novo, exame que não é feito. Só a equipe do IMED lê e resolve.
--   4. Pedido para OUTRA PESSOA (filho, pai idoso...): nome de quem vai fazer o exame, parentesco e, para menor de
--      18 anos, o consentimento do responsável legal (LGPD, art. 14). O gatilho do pedido confere tudo.
--   5. CONFERÊNCIA obrigatória antes de aprovar uma clínica (claim_checks + save_claim_checks): CNES ativo, CNPJ
--      ativo, ligação para o telefone oficial do CNES e CRM ativo do responsável técnico, gravada com a data.
--      approve_claim (mesma chamada de antes) passa a exigir as quatro e grava clinics.verified_at
--      ("Verificado pelo IMED em dd/mm/aaaa" na página do parceiro).
--   6. Data real da última atualização do cadastro oficial (cnes_last_update), para a página inicial.
--
-- Limites contra abuso (mensagens e avisos): por contato, por local, por conta e um teto geral por hora.
-- Tabelas novas fechadas para anon/authenticated: só leitura da equipe do IMED (RLS) e escrita pelas funções.
-- Nada é apagado (nenhum DROP) e tudo pode rodar de novo sem erro. Funciona antes ou depois da migração de segurança
-- (20261030071000_seguranca.sql): não mexe em submit_review nem em is_imed_admin, e a checagem de dono do
-- pedido usa a mesma regra "is true" de lá.

/* ===================== 1. Cancelar pedido pelo site ===================== */
alter table public.appointment_requests add column if not exists cancelled_at timestamptz;
alter table public.appointment_requests add column if not exists cancelled_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_cancelled_by_check') then
    alter table public.appointment_requests add constraint appointment_requests_cancelled_by_check
      check (cancelled_by is null or cancelled_by in ('patient', 'clinic', 'imed'));
  end if;
end $$;
comment on column public.appointment_requests.cancelled_at is 'Quando o pedido foi cancelado (nulo se não está cancelado).';
comment on column public.appointment_requests.cancelled_by is 'Quem cancelou: patient (pelo site), clinic (painel da clínica) ou imed (equipe do IMED).';

-- O paciente cancela o próprio pedido: pelo código do pedido (aparelho) ou pela conta.
-- Pode cancelar o que ainda está ativo (aguardando contato, em contato ou confirmado), desde que o horário
-- marcado ainda não tenha passado (sem horário marcado, pode cancelar).
-- Devolve: ok, not_found, forbidden, already_cancelled, not_cancellable (concluído) ou past (horário passou).
create or replace function public.cancel_request(p_id uuid, p_token text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
begin
  select * into r from public.appointment_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  -- "is true": para quem não está logado, auth.uid() é nulo e a comparação não pode virar "dono".
  if not ((r.user_id = auth.uid()) is true
          or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return 'forbidden';
  end if;
  if r.status = 'cancelled' then return 'already_cancelled'; end if;
  if r.status not in ('pending', 'contacted', 'confirmed') then return 'not_cancellable'; end if;
  if r.slot_start is not null and r.slot_start <= now() then return 'past'; end if;
  update public.appointment_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient'
   where id = r.id;
  return 'ok';
end $$;
revoke execute on function public.cancel_request(uuid, text) from public;
grant execute on function public.cancel_request(uuid, text) to anon, authenticated;

-- A clínica (ou a equipe do IMED) muda a situação do pedido. Igual a antes, e agora também guarda quem cancelou.
create or replace function public.set_request_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  who text;
begin
  if p_status not in ('contacted', 'confirmed', 'cancelled', 'completed') then return 'invalid_status'; end if;
  select * into r from public.appointment_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not (public.is_imed_admin() or (r.clinic_id is not null and public.is_clinic_member(r.clinic_id))) then
    return 'forbidden';
  end if;
  who := case when r.clinic_id is not null and public.is_clinic_member(r.clinic_id) then 'clinic' else 'imed' end;
  update public.appointment_requests set
    status = p_status,
    cancelled_at = case when p_status <> 'cancelled' then null when r.status = 'cancelled' then r.cancelled_at else now() end,
    cancelled_by = case when p_status <> 'cancelled' then null when r.status = 'cancelled' then r.cancelled_by else who end
  where id = p_id;
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

/* ===================== 2. Fale com o IMED ===================== */
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique check (protocol ~ '^IMED-[0-9]{8}-[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  subject text not null check (subject in ('duvida', 'cancelamento', 'dados_acesso', 'dados_correcao', 'dados_exclusao', 'clinica', 'outro')),
  name text not null check (char_length(name) between 2 and 120),
  reply_email text check (reply_email is null or (char_length(reply_email) <= 254 and reply_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  reply_phone text check (reply_phone is null or reply_phone ~ '^[1-9]{2}[0-9]{8,9}$'),
  message text not null check (char_length(message) between 5 and 2000),
  request_code text check (request_code is null or char_length(request_code) <= 40),
  user_id uuid references auth.users (id) on delete set null,
  account_email text check (account_email is null or char_length(account_email) <= 254),
  status text not null default 'open' check (status in ('open', 'answered')),
  answered_at timestamptz,
  answered_by uuid references auth.users (id) on delete set null,
  check (reply_email is not null or reply_phone is not null)
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_open_idx on public.contact_messages (created_at) where status = 'open';
comment on table public.contact_messages is 'Mensagens do Fale com o IMED (dúvidas, cancelamentos, pedidos sobre dados pessoais da LGPD). Só a equipe do IMED lê.';
comment on column public.contact_messages.protocol is 'Número de protocolo mostrado na hora para a pessoa: IMED-AAAAMMDD-XXXX (data de São Paulo).';
comment on column public.contact_messages.user_id is 'Conta de quem escreveu, quando estava logado (ajuda a confirmar pedidos sobre dados pessoais).';
comment on column public.contact_messages.account_email is 'E-mail da conta logada no envio (vem do token assinado, não do formulário).';
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
grant select on public.contact_messages to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'contact_messages' and policyname = 'admin le mensagens') then
    create policy "admin le mensagens" on public.contact_messages for select to authenticated using (public.is_imed_admin());
  end if;
end $$;

-- Envia a mensagem e devolve o protocolo. p_contact: e-mail ou celular com DDD para a resposta.
-- Erros (exceção P0001): 'dados_invalidos' (o campo vai em "details": assunto, nome, contato, mensagem, protocolo)
-- ou 'limite' (muitas mensagens em pouco tempo).
create or replace function public.send_contact(
  p_subject text default null,
  p_name text default null,
  p_contact text default null,
  p_message text default null,
  p_request_code text default null
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_code text := nullif(upper(btrim(regexp_replace(coalesce(p_request_code, ''), '\s+', ' ', 'g'))), '');
  v_email text;
  v_phone text;
  v_uid uuid := auth.uid();
  v_day text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD');
  v_protocol text;
begin
  if v_subject not in ('duvida', 'cancelamento', 'dados_acesso', 'dados_correcao', 'dados_exclusao', 'clinica', 'outro') then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'assunto';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nome';
  end if;
  if position('@' in v_contact) > 0 then
    v_email := lower(v_contact);
    if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'contato';
    end if;
  else
    v_phone := regexp_replace(v_contact, '\D', '', 'g');
    if char_length(v_phone) in (12, 13) and left(v_phone, 2) = '55' then v_phone := substr(v_phone, 3); end if;
    if v_phone !~ '^[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$' then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'contato';
    end if;
  end if;
  if char_length(v_message) not between 5 and 2000 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'mensagem';
  end if;
  if v_code is not null and char_length(v_code) > 40 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'protocolo';
  end if;

  -- Limites contra abuso: um envio de cada vez; até 3 por hora e 10 por dia do mesmo contato (ou da mesma conta);
  -- até 100 por hora no total.
  perform pg_advisory_xact_lock(hashtext('imed_send_contact'));
  if (select count(*) from public.contact_messages m
      where m.created_at > now() - interval '1 hour'
        and ((v_email is not null and m.reply_email = v_email) or (v_phone is not null and m.reply_phone = v_phone)
             or (v_uid is not null and m.user_id = v_uid))) >= 3
     or (select count(*) from public.contact_messages m
         where m.created_at > now() - interval '1 day'
           and ((v_email is not null and m.reply_email = v_email) or (v_phone is not null and m.reply_phone = v_phone)
                or (v_uid is not null and m.user_id = v_uid))) >= 10
     or (select count(*) from public.contact_messages m where m.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'limite' using errcode = 'P0001';
  end if;

  -- Protocolo: data de São Paulo + 4 letras/números sem os que confundem (0/O, 1/I). Repetido: tenta outro.
  for i in 1..12 loop
    v_protocol := 'IMED-' || v_day || '-' || (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '')
      from generate_series(1, 4));
    begin
      insert into public.contact_messages (protocol, subject, name, reply_email, reply_phone, message, request_code, user_id, account_email)
      values (v_protocol, v_subject, v_name, v_email, v_phone, v_message, v_code, v_uid,
              case when v_uid is not null then nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') end);
      return v_protocol;
    exception when unique_violation then
      null; -- protocolo já usado hoje: sorteia outro
    end;
  end loop;
  raise exception 'erro_protocolo' using errcode = 'P0001';
end $$;
revoke execute on function public.send_contact(text, text, text, text, text) from public;
grant execute on function public.send_contact(text, text, text, text, text) to anon, authenticated;

-- A equipe do IMED marca a mensagem como respondida (ou volta para em aberto).
-- Devolve: ok, forbidden, invalid_status ou not_found.
create or replace function public.set_contact_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then return 'forbidden'; end if;
  if p_status is null or p_status not in ('open', 'answered') then return 'invalid_status'; end if;
  update public.contact_messages set
    status = p_status,
    answered_at = case when p_status = 'answered' then now() end,
    answered_by = case when p_status = 'answered' then auth.uid() end
  where id = p_id;
  if not found then return 'not_found'; end if;
  return 'ok';
end $$;
revoke execute on function public.set_contact_status(uuid, text) from public, anon;
grant execute on function public.set_contact_status(uuid, text) to authenticated;

/* ===================== 3. "Algo errado aqui? Avise o IMED" ===================== */
create table if not exists public.place_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cnes text references public.establishments (cnes) on delete cascade,
  clinic_id uuid references public.clinics (id) on delete cascade,
  kind text not null check (kind in ('telefone', 'fechado', 'endereco', 'exame', 'outro')),
  note text check (note is null or char_length(note) <= 300),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  check (num_nonnulls(cnes, clinic_id) = 1)
);
create index if not exists place_reports_created_idx on public.place_reports (created_at desc);
create index if not exists place_reports_cnes_idx on public.place_reports (cnes) where cnes is not null;
create index if not exists place_reports_clinic_idx on public.place_reports (clinic_id) where clinic_id is not null;
comment on table public.place_reports is 'Avisos de dado errado na ficha de um local (telefone, local fechado, endereço, exame). A equipe do IMED confere; a correção oficial do CNES é feita pelo próprio estabelecimento.';
alter table public.place_reports enable row level security;
revoke all on public.place_reports from anon, authenticated;
grant select on public.place_reports to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_reports' and policyname = 'admin le avisos') then
    create policy "admin le avisos" on public.place_reports for select to authenticated using (public.is_imed_admin());
  end if;
end $$;

-- Aviso de dado errado. Um dos dois: p_cnes (cadastro oficial, 7 dígitos) ou p_clinic (parceiro publicado).
-- p_kind: telefone, fechado, endereco, exame ou outro. p_note: texto curto opcional (até 300).
-- Devolve: ok, dados_invalidos, nao_encontrado ou limite. O mesmo aviso repetido (mesmo local, tipo e texto,
-- ainda em aberto, nas últimas 24 h) não é gravado de novo e devolve ok.
create or replace function public.report_place_issue(
  p_cnes text default null,
  p_clinic uuid default null,
  p_kind text default null,
  p_note text default null
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cnes text := nullif(btrim(coalesce(p_cnes, '')), '');
  v_kind text := btrim(coalesce(p_kind, ''));
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_uid uuid := auth.uid();
begin
  if num_nonnulls(v_cnes, p_clinic) <> 1 then return 'dados_invalidos'; end if;
  if v_kind not in ('telefone', 'fechado', 'endereco', 'exame', 'outro') then return 'dados_invalidos'; end if;
  if v_note is not null and char_length(v_note) > 300 then return 'dados_invalidos'; end if;
  if v_cnes is not null then
    if v_cnes !~ '^[0-9]{7}$' then return 'dados_invalidos'; end if;
    if not exists (select 1 from public.establishments e where e.cnes = v_cnes) then return 'nao_encontrado'; end if;
  elsif not exists (select 1 from public.clinics c where c.id = p_clinic and c.status = 'published') then
    return 'nao_encontrado';
  end if;

  -- Limites contra abuso: um envio de cada vez; até 10 avisos por local por dia, 20 por conta por hora e
  -- 300 por hora no total.
  perform pg_advisory_xact_lock(hashtext('imed_place_reports'));
  if exists (select 1 from public.place_reports r
             where r.status = 'open' and r.created_at > now() - interval '1 day'
               and r.cnes is not distinct from v_cnes and r.clinic_id is not distinct from p_clinic
               and r.kind = v_kind and r.note is not distinct from v_note) then
    return 'ok';
  end if;
  if (select count(*) from public.place_reports r
      where r.created_at > now() - interval '1 day'
        and r.cnes is not distinct from v_cnes and r.clinic_id is not distinct from p_clinic) >= 10
     or (v_uid is not null and (select count(*) from public.place_reports r
                                where r.user_id = v_uid and r.created_at > now() - interval '1 hour') >= 20)
     or (select count(*) from public.place_reports r where r.created_at > now() - interval '1 hour') >= 300 then
    return 'limite';
  end if;
  insert into public.place_reports (cnes, clinic_id, kind, note, user_id) values (v_cnes, p_clinic, v_kind, v_note, v_uid);
  return 'ok';
end $$;
revoke execute on function public.report_place_issue(text, uuid, text, text) from public;
grant execute on function public.report_place_issue(text, uuid, text, text) to anon, authenticated;

-- A equipe do IMED marca o aviso como resolvido (ou volta para em aberto).
-- Devolve: ok, forbidden, invalid_status ou not_found.
create or replace function public.set_place_report_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then return 'forbidden'; end if;
  if p_status is null or p_status not in ('open', 'resolved') then return 'invalid_status'; end if;
  update public.place_reports set
    status = p_status,
    resolved_at = case when p_status = 'resolved' then now() end,
    resolved_by = case when p_status = 'resolved' then auth.uid() end
  where id = p_id;
  if not found then return 'not_found'; end if;
  return 'ok';
end $$;
revoke execute on function public.set_place_report_status(uuid, text) from public, anon;
grant execute on function public.set_place_report_status(uuid, text) to authenticated;

/* ===================== 4. Pedido para outra pessoa ===================== */
alter table public.appointment_requests add column if not exists for_other boolean not null default false;
alter table public.appointment_requests add column if not exists other_name text;
alter table public.appointment_requests add column if not exists relationship text;
alter table public.appointment_requests add column if not exists other_minor boolean not null default false;
alter table public.appointment_requests add column if not exists guardian_consent boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_for_other_check') then
    alter table public.appointment_requests add constraint appointment_requests_for_other_check check (
      case when for_other
        then char_length(coalesce(other_name, '')) between 2 and 120
         and char_length(coalesce(relationship, '')) between 2 and 60
         and (not other_minor or guardian_consent)
        else other_name is null and relationship is null and not other_minor and not guardian_consent
      end);
  end if;
end $$;
comment on column public.appointment_requests.patient_name is 'Nome de quem fez o pedido (o contato). Se o exame é para outra pessoa, o nome dela fica em other_name.';
comment on column public.appointment_requests.for_other is 'O exame é para outra pessoa (filho, pai idoso...), não para quem pediu.';
comment on column public.appointment_requests.other_name is 'Nome de quem vai fazer o exame, quando for outra pessoa.';
comment on column public.appointment_requests.relationship is 'Parentesco de quem vai fazer o exame com quem pediu (ex.: Filho ou filha).';
comment on column public.appointment_requests.other_minor is 'Quem vai fazer o exame tem menos de 18 anos.';
comment on column public.appointment_requests.guardian_consent is 'Consentimento do pai, da mãe ou do responsável legal (LGPD, art. 14), obrigatório para menor de 18 anos.';

-- Pedido com horário: confere se o horário existe e está livre; se estiver, já sai confirmado.
-- Igual à versão da agenda, mais a conferência do pedido para outra pessoa.
create or replace function public.check_appointment_request()
returns trigger language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_ts timestamp;
begin
  if new.preferred_date < today or new.preferred_date > today + 120 then
    raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
  end if;
  if new.clinic_id is not null and not exists (
    select 1 from public.clinics c
    where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
  ) then
    raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
  end if;
  -- Exame para outra pessoa: nome e parentesco; menor de 18 anos só com o consentimento do responsável legal.
  if coalesce(new.for_other, false) then
    new.for_other := true;
    new.other_name := nullif(btrim(regexp_replace(coalesce(new.other_name, ''), '\s+', ' ', 'g')), '');
    new.relationship := nullif(btrim(regexp_replace(coalesce(new.relationship, ''), '\s+', ' ', 'g')), '');
    new.other_minor := coalesce(new.other_minor, false);
    if char_length(coalesce(new.other_name, '')) not between 2 and 120 then
      raise exception 'Informe o nome de quem vai fazer o exame' using errcode = '22023';
    end if;
    if char_length(coalesce(new.relationship, '')) not between 2 and 60 then
      raise exception 'Informe o parentesco de quem vai fazer o exame' using errcode = '22023';
    end if;
    if new.other_minor and not coalesce(new.guardian_consent, false) then
      raise exception 'Para menor de 18 anos, é preciso o consentimento do responsável legal' using errcode = '22023';
    end if;
    new.guardian_consent := new.other_minor;
  else
    new.for_other := false;
    new.other_name := null;
    new.relationship := null;
    new.other_minor := false;
    new.guardian_consent := false;
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
  return new;
end $$;
-- Função de gatilho: ninguém chama como RPC (o gatilho continua funcionando). Igual à migração de segurança.
revoke execute on function public.check_appointment_request() from public, anon, authenticated;

/* ===================== 5. Conferência antes de aprovar uma clínica ===================== */
alter table public.clinics add column if not exists verified_at timestamptz;
comment on column public.clinics.verified_at is 'Data da conferência da equipe do IMED (CNES, CNPJ, ligação e CRM). Aparece como "Verificado pelo IMED em".';

create table if not exists public.claim_checks (
  claim_id uuid primary key references public.establishment_claims (id) on delete cascade,
  cnes_active boolean not null default false,
  cnpj_active boolean not null default false,
  phone_confirmed boolean not null default false,
  crm_active boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users (id) on delete set null
);
comment on table public.claim_checks is 'Conferência da equipe do IMED antes de aprovar um pedido de cadastro: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES confirmando quem pediu e CRM ativo do responsável técnico.';
alter table public.claim_checks enable row level security;
revoke all on public.claim_checks from anon, authenticated;
grant select on public.claim_checks to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'claim_checks' and policyname = 'admin ve conferencias') then
    create policy "admin ve conferencias" on public.claim_checks for select to authenticated using (public.is_imed_admin());
  end if;
end $$;

-- Grava a conferência (substitui a anterior) com a data de agora. Só o JSON true marca um item.
create or replace function private.save_claim_checks(p_claim uuid, p_checks jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.claim_checks (claim_id, cnes_active, cnpj_active, phone_confirmed, crm_active, note, checked_at, checked_by)
  values (p_claim,
          coalesce(p_checks -> 'cnes_active' = 'true'::jsonb, false),
          coalesce(p_checks -> 'cnpj_active' = 'true'::jsonb, false),
          coalesce(p_checks -> 'phone_confirmed' = 'true'::jsonb, false),
          coalesce(p_checks -> 'crm_active' = 'true'::jsonb, false),
          left(nullif(btrim(coalesce(p_checks ->> 'note', '')), ''), 300),
          now(), auth.uid())
  on conflict (claim_id) do update set
    cnes_active = excluded.cnes_active, cnpj_active = excluded.cnpj_active,
    phone_confirmed = excluded.phone_confirmed, crm_active = excluded.crm_active,
    note = excluded.note, checked_at = excluded.checked_at, checked_by = excluded.checked_by;
$$;
revoke all on function private.save_claim_checks(uuid, jsonb) from public, anon, authenticated;

-- A equipe do IMED salva a conferência de um pedido ainda em análise (pode salvar aos poucos).
-- Devolve: ok, forbidden, not_found ou already_decided.
create or replace function public.save_claim_checks(p_claim uuid, p_checks jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  st text;
begin
  if not public.is_imed_admin() then return 'forbidden'; end if;
  select status into st from public.establishment_claims where id = p_claim for update;
  if not found then return 'not_found'; end if;
  if st <> 'pending' then return 'already_decided'; end if;
  perform private.save_claim_checks(p_claim, coalesce(p_checks, '{}'::jsonb));
  return 'ok';
end $$;
revoke execute on function public.save_claim_checks(uuid, jsonb) from public, anon;
grant execute on function public.save_claim_checks(uuid, jsonb) to authenticated;

-- A equipe do IMED aprova: o estabelecimento vira clínica parceira e quem pediu passa a administrá-la.
-- Mesma chamada de antes (só p_claim, devolve o id da clínica), mas agora exige a conferência completa
-- (as quatro), salva antes com save_claim_checks. A data da conferência vira clinics.verified_at.
create or replace function public.approve_claim(p_claim uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.establishment_claims;
  ck public.claim_checks;
  e public.establishments;
  m public.municipalities;
  cid uuid;
begin
  if not public.is_imed_admin() then raise exception 'Só a equipe do IMED aprova' using errcode = '42501'; end if;
  select * into cl from public.establishment_claims where id = p_claim for update;
  if not found or cl.status <> 'pending' then raise exception 'Pedido não encontrado ou já decidido' using errcode = '22023'; end if;
  select * into ck from public.claim_checks where claim_id = cl.id;
  if not found or not (ck.cnes_active and ck.cnpj_active and ck.phone_confirmed and ck.crm_active) then
    raise exception 'Antes de aprovar, faça a conferência: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES e CRM ativo do responsável técnico.'
      using errcode = '22023';
  end if;
  select * into e from public.establishments where cnes = cl.cnes;
  if e.location is null then raise exception 'Estabelecimento sem localização no mapa' using errcode = '22023'; end if;
  select * into m from public.municipalities where ibge = e.city_ibge;
  select id into cid from public.clinics where cnes = e.cnes;
  if cid is null then
    insert into public.clinics (name, kind, address_line, neighborhood, city, state, cep, location, phone, specialties,
                                accepts_online_booking, status, is_demo, cnes, verified_at)
    values (e.name, e.kind, coalesce(nullif(e.address_line, ''), 'Endereço a confirmar'), e.neighborhood, m.name, m.uf,
            case when e.cep ~ '^[0-9]{8}$' then left(e.cep, 5) || '-' || right(e.cep, 3) end,
            e.location, case when char_length(coalesce(e.phone, '')) between 8 and 25 then e.phone end, e.specialties,
            true, 'published', false, e.cnes, ck.checked_at)
    returning id into cid;
    insert into public.clinic_exams (clinic_id, exam_code, price_cents)
    select cid, s, null from unnest(e.services) s
    where s in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
    on conflict do nothing;
  else
    update public.clinics set status = 'published', verified_at = ck.checked_at where id = cid;
  end if;
  insert into public.clinic_members (clinic_id, user_id, role) values (cid, cl.user_id, 'owner') on conflict do nothing;
  update public.establishment_claims set status = 'approved', decided_at = now(), clinic_id = cid where id = cl.id;
  return cid;
end $$;
revoke execute on function public.approve_claim(uuid) from public, anon;
grant execute on function public.approve_claim(uuid) to authenticated;

/* ===================== 6. Data da última atualização do cadastro oficial ===================== */
-- Só a data (fuso de São Paulo) da importação do CNES mais recente que terminou. Sem importação: nulo.
create or replace function public.cnes_last_update()
returns date
language sql stable security definer
set search_path = ''
as $$
  select (max(i.finished_at) at time zone 'America/Sao_Paulo')::date
  from public.establishment_imports i
  where i.status = 'done' and i.finished_at is not null;
$$;
revoke execute on function public.cnes_last_update() from public;
grant execute on function public.cnes_last_update() to anon, authenticated;
