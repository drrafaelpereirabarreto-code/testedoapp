-- Tabela de prova do laço rápido: agenda.occupancy IGUAL à da arquitetura (§2.5), sem as chaves estrangeiras
-- (itens, bloqueios e "ocupado" não existem aqui), mais o mínimo de agenda.resources para a capacidade (vagas).
-- É onde a regra fundamental mora: "nenhum recurso usado por mais pacientes do que a capacidade ao mesmo tempo".
-- Quando a fase 3.1 criar o schema agenda de verdade, este arquivo é o espelho que o laço rápido usa.

create schema prova;

create table prova.resources (
  id uuid primary key,
  clinic_id uuid not null,
  kind text not null default 'equipamento' check (kind in ('equipamento', 'sala', 'profissional', 'chegadas')),
  name text not null,
  capacity smallint not null default 1 check (capacity between 1 and 50),        -- vagas simultâneas
  active boolean not null default true
);

create table prova.occupancy (                     -- o único lugar que diz "este recurso está ocupado"
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('agendamento', 'ocupado', 'bloqueio')),  -- uso, uso sem paciente, fechamento
  seats int4range not null,                         -- uso: uma vaga [s,s+1); fechamento: todas [1,51)
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)
                                   and not lower_inf(during) and not upper_inf(during)),
  excl_group int8range not null default '(,)',      -- gatilho: [id,id] para fechamento
  item_id uuid, group_no smallint,
  busy_id uuid,
  block_id uuid,
  hold_until timestamptz,
  active boolean not null default true,
  released_at timestamptz,
  release_reason text check (release_reason in ('cancelado', 'expirada', 'remarcado', 'bloqueio_forcado',
                                                'removido', 'capacidade', 'corrigido')),
  created_at timestamptz not null default now(),
  check ((kind = 'agendamento') = (item_id is not null and group_no is not null)),
  check ((kind = 'ocupado') = (busy_id is not null)),
  check ((kind = 'bloqueio') = (block_id is not null)),
  check (case when kind = 'bloqueio'
              then seats = int4range(1, 51) and excl_group = int8range(id, id, '[]')
              else upper(seats) - lower(seats) = 1 and lower(seats) >= 1 and upper(seats) <= 51
                   and excl_group = '(,)'::int8range end),
  check (hold_until is null or kind = 'agendamento'),
  check (active or released_at is not null),
  constraint occupancy_no_overlap exclude using gist                    -- imediata, nunca adiável
    (resource_id with =, seats with &&, during with &&, excl_group with &&) where (active)
);

-- Antes de gravar: fechamento ganha o próprio grupo ([id,id]); uso precisa de recurso ativo e de vaga dentro da
-- capacidade, lida com FOR SHARE (conflita com quem estiver mudando a capacidade ao mesmo tempo; §3.2).
create function prova.occupancy_bi() returns trigger language plpgsql set search_path = '' as $$
declare
  cap smallint;
begin
  if new.kind = 'bloqueio' and new.excl_group = '(,)'::int8range then
    new.excl_group := int8range(new.id, new.id, '[]');
  end if;
  if new.kind <> 'bloqueio' and new.active then
    select r.capacity into cap from prova.resources r where r.id = new.resource_id and r.active for share;
    if cap is null then
      raise exception 'recurso inexistente ou inativo' using errcode = '23503';
    end if;
    if upper(new.seats) - 1 > cap then
      raise exception 'vaga % acima da capacidade % do recurso', upper(new.seats) - 1, cap using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger occupancy_bi before insert or update on prova.occupancy
for each row execute function prova.occupancy_bi();

-- Oráculo da regra fundamental, sem olhar a vaga: para cada recurso, o máximo de usos ativos ao mesmo tempo
-- (≤ capacidade) e quantos usos ativos cruzam um fechamento ativo (= 0).
create function prova.violacoes() returns table (resource_id uuid, capacidade smallint, maximo_simultaneo bigint, usos_em_fechamento bigint)
language sql stable set search_path = '' as $$
  with usos as (
    select o.* from prova.occupancy o where o.active and o.kind <> 'bloqueio'
  ), pontos as (
    select u.resource_id, lower(u.during) as t from usos u
  ), simultaneos as (
    select p.resource_id, count(*) as n
    from pontos p join usos u on u.resource_id = p.resource_id and u.during @> p.t
    group by p.resource_id, p.t
  )
  select r.id, r.capacity,
         coalesce((select max(s.n) from simultaneos s where s.resource_id = r.id), 0),
         (select count(*) from usos u join prova.occupancy f
            on f.resource_id = u.resource_id and f.active and f.kind = 'bloqueio' and f.during && u.during
          where u.resource_id = r.id)
  from prova.resources r
$$;
