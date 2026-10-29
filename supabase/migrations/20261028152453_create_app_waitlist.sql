create table if not exists public.app_waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null check (char_length(email) between 5 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city text check (city is null or char_length(city) <= 80),
  interest text check (interest is null or interest in ('exames','teleconsulta','ambos'))
);
alter table public.app_waitlist enable row level security;
drop policy if exists "anon can join waitlist" on public.app_waitlist;
create policy "anon can join waitlist" on public.app_waitlist for insert to anon with check (true);
