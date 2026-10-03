-- ============================================================
-- 0020  VALIDATE the NOT VALID constraints   (run LATER, after data cleanup)
-- ------------------------------------------------------------
-- Audit: DB-2.
-- Depends on : 0005 (and the cleanup you did with the README queries)
-- Idempotent : yes. Already-validated constraints are skipped; constraints
--              that still have violating rows are logged 'failed' with the
--              reason and stay NOT VALID (they keep protecting new writes).
-- Data change: none. VALIDATE only reads the table (it takes a lock that
--              allows normal reads and writes while it scans).
-- App impact : none.
-- Rollback   : none needed (a validated constraint is just a constraint). To
--              remove one: alter table public.<t> drop constraint <name>;
--
-- Run it as often as you like. Each run prints, per constraint, ok or
-- failed + the first reason. Fix the rows (queries in migrations/README.md,
-- section "Legacy data checks"), then run this file again.
-- ============================================================
begin;
select public._mig_log('0020', '_start', 'info');

do $$
declare c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where connamespace = 'public'::regnamespace and contype = 'c' and not convalidated
     order by 1, 2
  loop
    perform public._mig_try('0020', 'validate_' || c.conname,
      format('alter table %s validate constraint %I', c.tbl, c.conname));
  end loop;
end $$;

select public._mig_log('0020', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0020'
  and at >= (select max(at) from public.migration_log where migration = '0020' and step = '_start')
order by id;
