-- ============================================================
-- Realtime configuration for ZMI School ERP   [BASELINE, safe to re-run]
-- Run once in the Supabase SQL Editor, AFTER schema.sql.
--
-- 1. Publishes the tables the UI subscribes to in supabase_realtime so
--    the app receives live INSERT/UPDATE/DELETE events.
-- 2. NEVER publishes `users` (it holds the PIN and per-user permission
--    overrides) or `audit_log` (who-did-what): audit SEC-20 / DB-19.
-- 3. Uses the default REPLICA IDENTITY. The old version of this script set
--    REPLICA IDENTITY FULL on every table "so deletes carry an id", but the
--    default identity already includes the primary key, and FULL writes the
--    whole old row (including the jsonb `extra`) to the WAL on every update.
--    The app soft-deletes through UPDATE, so FULL bought nothing.
--
-- This file replaces the previous realtime.sql; it does the same thing as
-- migrations/0010_realtime_scope.sql, so running either is fine.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['users','branches','students','employees','invoices','expenses',
                           'payments','payslips','accounts','journals','custom_roles',
                           'reminder_logs','audit_log'] loop
    execute format('alter table public.%I replica identity default', t);
  end loop;

  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found; nothing published';
    return;
  end if;

  foreach t in array array['users','audit_log'] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;

  foreach t in array array['branches','students','employees','invoices','expenses',
                           'payments','payslips','accounts','journals','custom_roles','reminder_logs'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Verify which tables are publishing realtime events:
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
