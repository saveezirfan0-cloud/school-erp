-- ============================================================
-- 0001  Migration log + helpers used by every later migration
-- ------------------------------------------------------------
-- Depends on : baseline scripts (schema, accounting, trash, security)
-- Idempotent : yes (create ... if not exists / create or replace)
-- Data change: none
-- App impact : none
-- Rollback   : drop table public.migration_log, public.migration_backup
--              cascade; drop function public._mig_log, public._mig_try;
--              (nothing else depends on them except later migrations)
--
-- Why: there was no record of which SQL ran in production (audit DEP-15,
-- DB-18). Every migration writes rows to public.migration_log, and the
-- "best effort" steps (constraints, unique indexes, NOT NULL) go through
-- _mig_try(), which logs FAILED/SKIPPED instead of aborting the file, so
-- one bad legacy row never blocks the rest of the run. The last query of
-- every file prints the log of that run: look for status = 'failed' or
-- 'skipped'.
-- ============================================================
begin;

create table if not exists public.migration_log (
  id        bigserial primary key,
  migration text        not null,
  step      text        not null,
  status    text        not null check (status in ('info','ok','applied','skipped','failed')),
  detail    text,
  at        timestamptz not null default clock_timestamp()
);
alter table public.migration_log enable row level security;   -- no policies: postgres / service_role only
revoke all on public.migration_log from anon, authenticated;
revoke all on sequence public.migration_log_id_seq from anon, authenticated;

-- Old values of any live row a migration had to change, so it can be undone.
create table if not exists public.migration_backup (
  id          bigserial primary key,
  migration   text        not null,
  table_name  text        not null,
  row_id      text        not null,
  column_name text        not null,
  old_value   text,
  at          timestamptz not null default clock_timestamp()
);
alter table public.migration_backup enable row level security;
revoke all on public.migration_backup from anon, authenticated;
revoke all on sequence public.migration_backup_id_seq from anon, authenticated;

create or replace function public._mig_log(p_mig text, p_step text, p_status text, p_detail text default null)
returns void language sql as $$
  insert into public.migration_log (migration, step, status, detail) values (p_mig, p_step, p_status, p_detail);
$$;

-- Run one DDL statement; never abort the surrounding migration.
--   "already exists" (42710 / 42P07) counts as ok, so re-runs stay quiet.
create or replace function public._mig_try(p_mig text, p_step text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  perform public._mig_log(p_mig, p_step, 'ok');
exception
  when duplicate_object or duplicate_table then
    perform public._mig_log(p_mig, p_step, 'ok', 'already present');
  when others then
    perform public._mig_log(p_mig, p_step, 'failed', sqlstate || ': ' || sqlerrm);
end $$;

-- Create a unique index only if no live duplicates exist; otherwise log
-- SKIPPED with the reason (unique indexes cannot be added NOT VALID).
--   p_dup_sql must return one row per duplicate group (it is only tested for existence).
create or replace function public._mig_unique_index(p_mig text, p_step text, p_dup_sql text, p_ddl text)
returns void language plpgsql as $$
declare dup boolean;
begin
  execute 'select exists (' || p_dup_sql || ')' into dup;
  if dup then
    perform public._mig_log(p_mig, p_step, 'skipped',
      'duplicate rows exist; run the matching query from migrations/README.md, fix the data, then re-run this file');
  else
    perform public._mig_try(p_mig, p_step, p_ddl);
  end if;
end $$;

-- Only the owner (postgres, i.e. the SQL editor) may call these.
revoke all on function public._mig_log(text,text,text,text)        from public, anon, authenticated, service_role;
revoke all on function public._mig_try(text,text,text)             from public, anon, authenticated, service_role;
revoke all on function public._mig_unique_index(text,text,text,text) from public, anon, authenticated, service_role;

select public._mig_log('0001', '_start', 'info');
select public._mig_log('0001', '_done',  'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0001'
  and at >= (select max(at) from public.migration_log where migration = '0001' and step = '_start')
order by id;
