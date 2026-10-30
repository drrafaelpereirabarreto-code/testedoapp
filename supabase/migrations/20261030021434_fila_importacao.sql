-- Fila para pré-carregar as clínicas reais (CNES) das capitais e das maiores cidades, sem esperar
-- a primeira busca de um paciente. A cada minuto, o pg_cron manda até 2 cidades ao importador.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Token interno: o banco o usa para chamar o importador; ninguém de fora lê.
create table if not exists private.app_tokens (
  name text primary key,
  token text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into private.app_tokens (name) values ('importer') on conflict do nothing;

-- O importador confere o token por aqui (só com a chave de serviço).
create or replace function public.check_internal_token(p_name text, p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_tokens where name = p_name and token = p_token);
$$;
revoke execute on function public.check_internal_token(text, text) from public, anon, authenticated;
grant execute on function public.check_internal_token(text, text) to service_role;

create table if not exists public.import_queue (
  id serial primary key,
  uf char(2) not null,
  city_name text not null,
  priority smallint not null default 2,
  city_ibge integer references public.municipalities (ibge),
  status text not null default 'pending' check (status in ('pending', 'sent', 'done', 'error')),
  attempts smallint not null default 0,
  last_try timestamptz,
  error text,
  unique (uf, city_name)
);
alter table public.import_queue enable row level security;
revoke all on public.import_queue from anon, authenticated;

-- O importador avisa o resultado de cada cidade da fila.
create or replace function public.import_queue_mark(p_id integer, p_city integer, p_status text, p_error text default null)
returns void
language sql
set search_path = public
as $$
  update public.import_queue
  set city_ibge = coalesce(p_city, city_ibge), status = p_status, error = left(p_error, 300)
  where id = p_id;
$$;
revoke execute on function public.import_queue_mark(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.import_queue_mark(integer, integer, text, text) to service_role;

create or replace function private.process_import_queue()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  tok text;
  running integer;
begin
  -- cidades enviadas: terminam quando a importação delas termina
  update public.import_queue iq set status = case ei.status when 'done' then 'done' else 'error' end, error = ei.error
  from public.establishment_imports ei
  where iq.status = 'sent' and ei.city_ibge = iq.city_ibge and ei.status in ('done', 'error');
  -- envio sem resposta em 10 minutos volta para a fila (até 3 tentativas)
  update public.import_queue set status = case when attempts >= 3 then 'error' else 'pending' end
  where status = 'sent' and last_try < now() - interval '10 minutes';

  select count(*) into running from public.establishment_imports
  where status = 'running' and started_at > now() - interval '15 minutes';
  if running >= 2 then return; end if;

  select token into tok from private.app_tokens where name = 'importer';
  for q in
    select id, uf, city_name from public.import_queue
    where status = 'pending' order by priority, id limit 2 - running
  loop
    update public.import_queue set status = 'sent', attempts = attempts + 1, last_try = now() where id = q.id;
    perform net.http_post(
      url := 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/importar-clinicas',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', tok),
      body := jsonb_build_object('action', 'importar', 'fila', q.id, 'uf', q.uf, 'cidade', q.city_name),
      timeout_milliseconds := 30000
    );
  end loop;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'imed-fila-importacao';
select cron.schedule('imed-fila-importacao', '* * * * *', 'select private.process_import_queue()');

-- Atualização mensal: as cidades importadas há mais de 30 dias voltam para a fila.
select cron.unschedule(jobid) from cron.job where jobname = 'imed-atualizacao-mensal';
select cron.schedule('imed-atualizacao-mensal', '17 4 * * *', $job$
  update public.import_queue iq set status = 'pending', attempts = 0
  from public.establishment_imports ei
  where iq.status in ('done', 'error') and ei.city_ibge = iq.city_ibge and ei.finished_at < now() - interval '30 days'
$job$);

insert into public.import_queue (uf, city_name, priority) values
  -- capitais
  ('AC','Rio Branco',1),('AL','Maceió',1),('AP','Macapá',1),('AM','Manaus',1),('BA','Salvador',1),('CE','Fortaleza',1),
  ('DF','Brasília',1),('ES','Vitória',1),('GO','Goiânia',1),('MA','São Luís',1),('MT','Cuiabá',1),('MS','Campo Grande',1),
  ('MG','Belo Horizonte',1),('PA','Belém',1),('PB','João Pessoa',1),('PR','Curitiba',1),('PE','Recife',1),('PI','Teresina',1),
  ('RJ','Rio de Janeiro',1),('RN','Natal',1),('RS','Porto Alegre',1),('RO','Porto Velho',1),('RR','Boa Vista',1),
  ('SC','Florianópolis',1),('SP','São Paulo',1),('SE','Aracaju',1),('TO','Palmas',1),
  -- cidades grandes
  ('SP','Guarulhos',2),('SP','Campinas',2),('RJ','São Gonçalo',2),('RJ','Duque de Caxias',2),('SP','São Bernardo do Campo',2),
  ('RJ','Nova Iguaçu',2),('SP','Santo André',2),('SP','Osasco',2),('PE','Jaboatão dos Guararapes',2),('MG','Contagem',2),
  ('SP','Ribeirão Preto',2),('MG','Uberlândia',2),('SP','Sorocaba',2),('SP','São José dos Campos',2),('BA','Feira de Santana',2),
  ('SC','Joinville',2),('MG','Juiz de Fora',2),('PR','Londrina',2),('GO','Aparecida de Goiânia',2),('PA','Ananindeua',2),
  ('ES','Serra',2),('RJ','Niterói',2),('RJ','Belford Roxo',2),('RS','Caxias do Sul',2),('RJ','Campos dos Goytacazes',2),
  ('ES','Vila Velha',2),('SP','Mauá',2),('RJ','São João de Meriti',2),('SP','Santos',2),('SP','Mogi das Cruzes',2),
  ('MG','Betim',2),('SP','Diadema',2),('SP','Jundiaí',2),('PR','Maringá',2),('SP','Piracicaba',2),('MG','Montes Claros',2),
  ('SP','Carapicuíba',2),('PE','Olinda',2),('PB','Campina Grande',2),('SP','São José do Rio Preto',2),('CE','Caucaia',2),
  ('ES','Cariacica',2),('SP','Bauru',2),('SP','Itaquaquecetuba',2),('SP','São Vicente',2),('BA','Vitória da Conquista',2),
  ('RS','Pelotas',2),('RS','Canoas',2),('SP','Franca',2),('PR','Ponta Grossa',2),('SC','Blumenau',2),('PE','Paulista',2),
  ('PE','Petrolina',2),('MG','Uberaba',2),('PR','Cascavel',2),('SP','Guarujá',2),('SP','Praia Grande',2),('SP','Taubaté',2),
  ('SP','Limeira',2),('RJ','Petrópolis',2),('PA','Santarém',2),('BA','Camaçari',2),('SP','Suzano',2),('RN','Mossoró',2),
  ('MG','Governador Valadares',2),('SP','Taboão da Serra',2),('MT','Várzea Grande',2),('RS','Santa Maria',2),('RS','Gravataí',2),
  ('RJ','Volta Redonda',2),('CE','Juazeiro do Norte',2),('PR','Foz do Iguaçu',2),('MA','Imperatriz',2),('GO','Anápolis',2),
  ('SC','São José',2),('MG','Ipatinga',2),('MG','Sete Lagoas',2),('PA','Marabá',2),('MG','Divinópolis',2),('SP','Sumaré',2),
  ('SP','Barueri',2),('SP','Embu das Artes',2),('SP','São Carlos',2),('BA','Itabuna',2),('SP','Indaiatuba',2),('SP','Americana',2),
  ('SP','Araraquara',2),('CE','Maracanaú',2),('SC','Chapecó',2),('GO','Rio Verde',2),('SC','Itajaí',2),('SP','Hortolândia',2),
  ('SP','Presidente Prudente',2),('SP','Jacareí',2),('MS','Dourados',2),('SC','Criciúma',2),('RN','Parnamirim',2),
  ('MT','Rondonópolis',2),('BA','Lauro de Freitas',2),('AL','Arapiraca',2),('RJ','Macaé',2),('RJ','Magé',2),('RJ','Itaboraí',2),
  ('RJ','Cabo Frio',2),('RS','Novo Hamburgo',2),('RS','Rio Grande',2),('RS','Passo Fundo',2),('RS','São Leopoldo',2),
  ('RS','Viamão',2),('RS','Alvorada',2),('SP','Cotia',2),('BA','Ilhéus',2),('PE','Caruaru',2),('BA','Juazeiro',2),
  ('CE','Sobral',2),('PA','Parauapebas',2)
on conflict do nothing;
