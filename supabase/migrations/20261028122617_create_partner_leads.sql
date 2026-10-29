create table public.partner_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_type text not null check (partner_type in ('clinica','medico')),
  name text not null check (char_length(name) between 2 and 200),
  cnpj text not null check (char_length(cnpj) between 11 and 20),
  phone text not null check (char_length(phone) between 8 and 25),
  email text not null check (char_length(email) between 5 and 200),
  address text check (char_length(address) <= 300),
  services text check (char_length(services) <= 1000),
  online_only boolean not null default false
);

alter table public.partner_leads enable row level security;

create policy "anon can insert partner leads"
  on public.partner_leads for insert
  to anon
  with check (true);

revoke all on public.partner_leads from anon, authenticated;
grant insert on public.partner_leads to anon;
