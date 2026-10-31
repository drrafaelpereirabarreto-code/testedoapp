-- Oráculo do laço rápido (tests/banco/local/). As tabelas prova.resources e prova.occupancy e os gatilhos delas NÃO
-- ficam aqui: o rodar.mjs os gera da própria migração da fundação (supabase/migrations/*_agenda_base.sql, blocos
-- "[espelho do laço local]"), trocando agenda/private por prova e sem as chaves estrangeiras para fora da agenda
-- (linhas "[só no banco]"). Assim o laço local testa sempre a MESMA restrição de exclusão, os mesmos CHECKs e os
-- mesmos gatilhos (vagas e capacidade) do banco de verdade. Este arquivo roda depois do espelho.

-- Oráculo da regra fundamental, sem olhar a vaga: para cada recurso, o máximo de usos ativos ao mesmo tempo
-- (≤ capacidade) e quantos usos ativos cruzam um fechamento ativo (= 0). O máximo de intervalos [início, fim)
-- que se cruzam acontece sempre no início de algum deles: basta contar, em cada início (sem repetir o mesmo
-- instante, senão dois usos que começam juntos seriam contados duas vezes), quantos usos o cobrem.
create function prova.violacoes() returns table (resource_id uuid, capacidade smallint, maximo_simultaneo bigint, usos_em_fechamento bigint)
language sql stable set search_path = '' as $$
  with usos as (
    select o.* from prova.occupancy o where o.active and o.kind <> 'bloqueio'
  ), pontos as (
    select distinct u.resource_id, lower(u.during) as t from usos u
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
