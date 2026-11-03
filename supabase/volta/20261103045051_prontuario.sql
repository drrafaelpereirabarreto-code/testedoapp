-- VOLTA da migração supabase/migrations/<mesmo nome>.sql (prontuário, fase 2 do Workspace; só se for preciso desfazer).
-- Tem o mesmo nome da migração; se a migração for renomeada, renomeie esta também.
-- Tira tudo o que a migração criou: o job do pg_cron, as funções public.ws_*, public.cat_cid_buscar,
-- public.ws_integridade_conferir, as funções private.ws_* e private.cid10_*, e os schemas prontuario e catalogo.
-- ATENÇÃO: apaga o registro clínico e as trilhas que existirem (na produção, só depois de exportar e com o dono e
-- o advogado de acordo: o prontuário tem guarda permanente). No CI o banco é descartável.

select cron.unschedule(jobid) from cron.job where jobname = 'imed-prontuario-encerra';

drop function if exists public.ws_integridade_conferir();
drop function if exists public.cat_cid_buscar(text);
drop function if exists public.ws_registro_versao(uuid, integer, text);
drop function if exists public.ws_registro_historico(uuid, text);
drop function if exists public.ws_adendo_criar(uuid, text);
drop function if exists public.ws_registro_finalizar(uuid, integer);
drop function if exists public.ws_registro_salvar(uuid, jsonb, integer);
drop function if exists public.ws_registro_abrir(uuid, text);

-- As tabelas saem antes das funções que os gatilhos delas usam.
drop schema if exists prontuario cascade;
drop schema if exists catalogo cascade;

drop function if exists private.cid10_carregar(text, text, text);
drop function if exists private.cid10_linhas(text);
drop function if exists private.ws_encerrar_rascunhos();
drop function if exists private.ws_fechar(uuid, text);
drop function if exists private.ws_acesso(uuid, text, text);
drop function if exists private.ws_escrita(text, text, text, uuid, uuid, integer, integer, text);
drop function if exists private.ws_trilha(text, text, text, text, uuid, text, uuid, text);
drop function if exists private.ws_cadeia_proximo();
drop function if exists private.ws_hash(text);
drop function if exists private.ws_canonico(uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, text);
drop function if exists private.ws_ts(timestamptz);
drop function if exists private.ws_conteudo_vazio(jsonb);
drop function if exists private.ws_conteudo_erro(jsonb);
drop function if exists private.ws_faixa_ok(text, numeric);
drop function if exists private.ws_unidade(text);
drop function if exists private.ws_fold(text);
drop function if exists private.ws_filha_guard();
drop function if exists private.ws_so_acrescimo();
drop function if exists private.ws_guard();
