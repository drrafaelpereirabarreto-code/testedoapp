-- Aviso em tempo real (iMed Agenda, fase 3.4; arquitetura §7):
--   - cada mudança na agenda (agenda_touch) grava UMA mensagem por tópico em realtime.messages, privada, de
--     Broadcast, só com a versão ({v}) em agenda:clinica:<id> e {clinic_id, v} em agenda:imed: nenhum dado de paciente;
--   - transação desfeita não deixa mensagem (o Realtime só entrega depois do COMMIT).
-- (A mensagem só é gravada quando realtime.messages tem a partição do dia, criada pelo serviço Realtime; sem ela, o
-- realtime.send só avisa no log e a agenda segue: o painel confere agenda_version de tempos em tempos.)
-- O WebSocket de verdade (entrar no canal, receber depois do COMMIT, canal de outra clínica recusado) está em
-- tests/banco/tempo-real.mjs. Tudo é desfeito no fim (rollback).
begin;
select plan(5);

insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values ('c3500000-0000-4000-8000-000000000001', 'Clínica do Tempo Real', 'imagem', 'Rua do Aviso, 1', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);

create temp table particao (ok boolean) on commit drop;
insert into particao
select exists (select 1 from pg_inherits h join pg_class c on c.oid = h.inhrelid
               where h.inhparent = 'realtime.messages'::regclass
                 and pg_get_expr(c.relpartbound, c.oid) like '%' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || '%');

select ok(to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null, 'realtime.send existe');
savepoint antes;
select private.agenda_touch('c3500000-0000-4000-8000-000000000001');
select case when not (select ok from particao) then skip('realtime.messages sem a partição de hoje (o serviço Realtime cria)', 3)
  else collect_tap(
    is((select string_agg(m.topic || ' ' || (m.payload - 'id')::text || ' ' || m.private || ' ' || m.extension || ' ' || m.event, ' ; ' order by m.topic)
        from realtime.messages m where m.topic in ('agenda:clinica:c3500000-0000-4000-8000-000000000001', 'agenda:imed')
          and (m.topic <> 'agenda:imed' or m.payload ->> 'clinic_id' = 'c3500000-0000-4000-8000-000000000001')),
       'agenda:clinica:c3500000-0000-4000-8000-000000000001 {"v": 1} true broadcast agenda ; agenda:imed {"v": 1, "clinic_id": "c3500000-0000-4000-8000-000000000001"} true broadcast agenda',
       'agenda_touch grava o aviso privado: só a versão (e o id da clínica no canal da equipe do IMED)'),
    ok((select bool_and(not (m.payload ?| array['name', 'patient', 'phone', 'request_id'])) from realtime.messages m
        where m.topic = 'agenda:clinica:c3500000-0000-4000-8000-000000000001'), 'o aviso não leva nome, telefone nem id de pedido'),
    is((select count(*)::int from realtime.messages m where m.topic = 'agenda:clinica:c3500000-0000-4000-8000-000000000001'), 1,
       'uma mensagem por mudança')) end;
rollback to savepoint antes;
select is((select count(*)::int from realtime.messages m where m.topic = 'agenda:clinica:c3500000-0000-4000-8000-000000000001'), 0,
          'mudança desfeita não deixa aviso');

select * from finish();
rollback;
