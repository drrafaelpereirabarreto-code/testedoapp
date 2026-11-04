-- VOLTA da migração supabase/migrations/<mesmo nome>.sql (iMed Agenda, fase 4.1; só se for preciso desfazer).
-- Tem o mesmo nome da migração: se ela for renomeada, renomeie esta também. Tira as duas funções novas; nada mais
-- muda (a modalidade e o compromisso gravados por agenda_mode_set ficam como estão: são colunas da 3.1).
-- Testado no CI (banco.yml): depois desta volta a impressão digital é IGUAL à da produção antes da 4.1.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

drop function if exists public.agenda_mode_set(uuid, text, boolean);
drop function if exists public.agenda_config(uuid);
