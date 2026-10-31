-- "Impressão digital" do banco: uma linha por objeto dos schemas do IMED (funções com o corpo e as permissões,
-- tabelas com colunas, RLS e permissões, restrições, índices, policies, gatilhos) e os jobs do pg_cron.
-- O banco.yml tira a impressão antes e depois de "volta + reaplicação" das migrações que têm volta
-- (supabase/volta/): as duas têm de ser iguais. Ignora o que muda sozinho (oids, ids dos jobs, job ativo ou não).
--   psql "$DB_URL" -qAt -f tests/banco/catalogo.sql > antes.txt
with esquemas as (
  select oid, nspname from pg_namespace where nspname in ('public', 'private', 'agenda')
)
select x from (
  select format('funcao %s.%s(%s) %s acl=%s', n.nspname, p.proname, oidvectortypes(p.proargtypes),
                md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, '-')) as x
  from pg_proc p join esquemas n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select format('tabela %s.%s %s rls=%s acl=%s colunas=%s', n.nspname, c.relname, c.relkind, c.relrowsecurity,
                coalesce(c.relacl::text, '-'),
                (select string_agg(format('%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                          coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')), ',' order by a.attnum)
                 from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
                 where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
  from pg_class c join esquemas n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  union all
  select format('restricao %s %s %s', co.conrelid::regclass, co.conname, pg_get_constraintdef(co.oid))
  from pg_constraint co join esquemas n on n.oid = co.connamespace
  union all
  select format('indice %s', pg_get_indexdef(i.indexrelid))
  from pg_index i join pg_class c on c.oid = i.indrelid join esquemas n on n.oid = c.relnamespace
  union all
  select format('policy %s.%s %s %s %s using=%s check=%s', po.schemaname, po.tablename, po.policyname, po.cmd, po.roles,
                coalesce(po.qual, '-'), coalesce(po.with_check, '-'))
  from pg_policies po where po.schemaname in ('public', 'private', 'agenda')
  union all
  select format('gatilho %s %s %s', g.tgrelid::regclass, g.tgname, pg_get_triggerdef(g.oid))
  from pg_trigger g join pg_class c on c.oid = g.tgrelid join esquemas n on n.oid = c.relnamespace
  where not g.tgisinternal
  union all
  select format('job %s %s %s', j.jobname, j.schedule, j.command) from cron.job j
) s
order by x;
