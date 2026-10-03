-- ============================================================
-- Soft-delete / Trash support for ZMI School ERP
-- Baseline script: run AFTER schema.sql and accounting.sql, BEFORE
-- security.sql and before migrations/. Safe to re-run.
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
    -- Small partial index for the Trash view (rows are NULL almost always, so a
    -- plain btree on deleted_at is useless; DB-20).
    execute format('create index if not exists %1$s_trashed_idx on public.%1$I (deleted_at desc) where deleted_at is not null;', t);
  end loop;
end $$;

-- Note: users, custom_roles, and audit_log intentionally do NOT get
-- soft-delete. Users are managed via the admin flow, and audit_log is
-- append-only. Deleting a user still hard-deletes their profile row.
