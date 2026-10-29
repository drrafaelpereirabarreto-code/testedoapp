create table if not exists public.admin_emails (email text primary key check (email = lower(email)));
alter table public.admin_emails enable row level security;
-- sem policies: ninguém via API lê/escreve esta tabela; só o dono pelo painel do Supabase/SQL.
create or replace function public.is_imed_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.admin_emails where email = lower(coalesce(auth.jwt()->>'email','')));
$$;
revoke all on function public.is_imed_admin() from public, anon;
grant execute on function public.is_imed_admin() to authenticated;
drop policy if exists "admin le partner_leads" on public.partner_leads;
create policy "admin le partner_leads" on public.partner_leads for select to authenticated using (public.is_imed_admin());
drop policy if exists "admin le app_waitlist" on public.app_waitlist;
create policy "admin le app_waitlist" on public.app_waitlist for select to authenticated using (public.is_imed_admin());
