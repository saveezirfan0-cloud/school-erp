-- ============================================================
-- Soft-delete / Trash support for ZMI School ERP
-- Run once in the SQL Editor, AFTER schema.sql (order with
-- security.sql does not matter, but running this before
-- security.sql is fine too). Safe to re-run.
--
-- Adds a `deleted_at timestamptz` column to every data table.
--   deleted_at IS NULL  -> live record
--   deleted_at NOT NULL -> in Trash (soft-deleted at that time)
--
-- The app:
--   - "delete" sets deleted_at = now()  (moves to Trash)
--   - "restore" sets deleted_at = null
--   - "empty trash" hard-deletes the row
--   - normal lists automatically hide rows where deleted_at is set
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'students','employees','invoices','expenses','payments',
    'payslips','accounts','journals','branches','reminder_logs'
  ] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz;', t);
    -- index so filtering live vs trashed rows stays fast
    execute format('create index if not exists idx_%1$s_deleted_at on public.%1$s (deleted_at);', t);
  end loop;
end $$;

-- Note: users, custom_roles, and audit_log intentionally do NOT get
-- soft-delete. Users are managed via the admin flow, and audit_log is
-- append-only. Deleting a user still hard-deletes their profile row.
