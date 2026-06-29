-- ============================================================
-- Realtime configuration for ZMI School ERP
-- Run this once in the Supabase SQL Editor, AFTER schema.sql.
--
-- Two things this does:
--   1. Adds every table to the supabase_realtime publication so
--      the app receives live INSERT/UPDATE/DELETE events.
--   2. Sets REPLICA IDENTITY FULL so DELETE events include the
--      deleted row's data (by default Postgres only sends the
--      primary key, and without this a delete can arrive without
--      an id — which is what caused deleted invoices to linger
--      until a page refresh).
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'users','branches','students','employees','invoices','expenses',
    'payments','payslips','accounts','journals','custom_roles',
    'reminder_logs','audit_log'
  ] loop
    -- include deleted-row data in realtime DELETE payloads
    execute format('alter table public.%I replica identity full;', t);

    -- add to the realtime publication (ignore if already a member)
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception
      when duplicate_object then null;  -- already added
      when others then null;            -- publication may auto-include; ignore
    end;
  end loop;
end $$;

-- Verify which tables are publishing realtime events:
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
