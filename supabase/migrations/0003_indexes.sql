-- ============================================================
-- 0003  Indexes that match the RLS policies and the app's queries
-- ------------------------------------------------------------
-- Audit: DB-6, DB-20.
-- Depends on : 0001; trash.sql (deleted_at columns)
-- Idempotent : yes (create index if not exists / drop index if exists)
-- Data change: none. Indexes only. Plain CREATE INDEX takes a short write
--              lock per table; fine at school scale (thousands of rows).
--              On a much bigger table, create the index CONCURRENTLY by hand
--              outside a transaction instead.
-- App impact : none (faster reads).
-- Rollback   : drop index if exists <name>;  (names below)
--              The two removed legacy indexes are recreated by trash.sql.
-- ============================================================
begin;
select public._mig_log('0003', '_start', 'info');

-- Branch scope key used by every RLS policy (0007). The expression here
-- MUST stay identical to the one in the policies:
--     coalesce(nullif(branch_id,'main'),'')
create index if not exists students_branch_key_idx  on public.students  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists employees_branch_key_idx on public.employees ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists invoices_branch_key_idx  on public.invoices  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists expenses_branch_key_idx  on public.expenses  ((coalesce(nullif(branch_id,'main'),'')), date) where deleted_at is null;
create index if not exists payments_branch_key_idx  on public.payments  ((coalesce(nullif(branch_id,'main'),'')), date) where deleted_at is null;
create index if not exists payslips_branch_key_idx  on public.payslips  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;

-- Reference lookups. Full (non-partial) so the referential-integrity
-- triggers of 0006 can also find rows that are in Trash.
create index if not exists invoices_student_idx   on public.invoices (student_id);
create index if not exists payslips_employee_idx  on public.payslips (employee_id);

-- Live-row indexes for balances, overdue lists, ledger lookups.
create index if not exists invoices_status_due_idx   on public.invoices (status, due_date) where deleted_at is null;
create index if not exists payments_account_date_idx on public.payments (account, date) where deleted_at is null;
create index if not exists payments_source_live_idx  on public.payments (source, source_id) where deleted_at is null;

-- Ordered feeds.
create index if not exists reminder_logs_ts_idx  on public.reminder_logs ("timestamp" desc) where deleted_at is null;
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- Trash view: tiny partial index instead of a btree on a column that is
-- NULL for nearly every row.
do $$
declare t text;
begin
  foreach t in array array['students','employees','invoices','expenses','payments',
                           'payslips','accounts','journals','branches','reminder_logs'] loop
    execute format('drop index if exists public.idx_%1$s_deleted_at', t);
    execute format('create index if not exists %1$s_trashed_idx on public.%1$I (deleted_at desc) where deleted_at is not null', t);
  end loop;
end $$;

select public._mig_log('0003', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0003'
  and at >= (select max(at) from public.migration_log where migration = '0003' and step = '_start')
order by id;
