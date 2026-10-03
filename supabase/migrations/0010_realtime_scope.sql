-- ============================================================
-- 0010  Realtime: stop publishing users and audit_log, drop REPLICA IDENTITY FULL
-- ------------------------------------------------------------
-- Audit: SEC-20, DB-19.
-- Depends on : 0001
-- Idempotent : yes
-- Data change: none
-- App impact : * Live updates stop for the `users` table (a role change made
--                by an admin is picked up at the next page load / sign-in
--                instead of instantly; the database enforces it at once
--                either way) and for `audit_log` (the Activity Log refreshes
--                on reload).
--              * DELETE events now carry only the primary key (that is all
--                the app uses; it soft-deletes through UPDATE).
-- Rollback   : alter publication supabase_realtime add table public.users, public.audit_log;
--              alter table public.<t> replica identity full;   (old realtime.sql)
--
-- Why: users carries the PIN and the permission overrides, audit_log carries
-- who-did-what. Supabase does not apply RLS to DELETE events, and FULL replica
-- identity writes every column of every changed row (including the jsonb
-- `extra`) into the write-ahead log for no benefit.
-- ============================================================
begin;
select public._mig_log('0010', '_start', 'info');

do $$
declare t text;
begin
  foreach t in array array['users','branches','students','employees','invoices','expenses',
                           'payments','payslips','accounts','journals','custom_roles',
                           'reminder_logs','audit_log'] loop
    execute format('alter table public.%I replica identity default', t);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['users','audit_log'] loop
      if exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
        perform public._mig_log('0010', 'unpublish_' || t, 'ok');
      end if;
    end loop;
    -- the tables the UI does subscribe to stay published (RLS filters each subscriber)
    foreach t in array array['branches','students','employees','invoices','expenses',
                             'payments','payslips','accounts','journals','custom_roles','reminder_logs'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
        perform public._mig_log('0010', 'publish_' || t, 'ok');
      end if;
    end loop;
  else
    perform public._mig_log('0010', 'publication', 'skipped', 'publication supabase_realtime does not exist');
  end if;
end $$;

select public._mig_log('0010', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0010'
  and at >= (select max(at) from public.migration_log where migration = '0010' and step = '_start')
order by id;
