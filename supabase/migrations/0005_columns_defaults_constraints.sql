-- ============================================================
-- 0005  New columns, safe defaults, CHECKs (NOT VALID), NOT NULL, unique keys
-- ------------------------------------------------------------
-- Audit: DB-2, DB-9, DB-3 (keys), DB-7, DB-15, DB-16/UX-002, SEC-08 (column).
-- Depends on : 0001, 0004 (so duplicates are already merged); trash.sql
-- Idempotent : yes. Safe to re-run after you clean legacy data: steps that
--              were SKIPPED or FAILED are simply retried.
-- Data change: additive only. reminder_logs.branch_id is backfilled from the
--              student. No row is deleted or rewritten otherwise.
-- App impact : see the list at the bottom. In short: bad values (negative
--              money, unknown status/type, non-ISO dates, a second live
--              branch/account/admission number with the same name) are now
--              rejected on write.
-- Rollback   : see "Rollback 0005" in migrations/README.md.
--
-- How a failure is handled: every constraint / index / NOT NULL goes
-- through public._mig_try / _mig_unique_index (from 0001), so one bad
-- legacy row logs 'failed' or 'skipped' and the rest still applies. The
-- query at the end of the file prints the log: look for non-'ok' rows.
--
-- CHECK constraints are added NOT VALID: they are enforced for every new
-- INSERT and for every UPDATE of a row, but existing rows are not scanned.
-- NOTE: that means an UPDATE of a legacy row that already violates a rule
-- (even just moving it to Trash) fails until that row is corrected. Use the
-- detection queries in migrations/README.md first, then run
-- 0020_validate_constraints.sql once they return nothing.
-- ============================================================
begin;
select public._mig_log('0005', '_start', 'info');

-- ---------- columns ----------
alter table public.payments  add column if not exists idempotency_key uuid;
alter table public.payments  add column if not exists receipt_no      text;
alter table public.invoices  add column if not exists invoice_no      text;
alter table public.invoices  add column if not exists idempotency_key uuid;
alter table public.reminder_logs add column if not exists branch_id   text;   -- SEC-08
alter table public.audit_log add column if not exists actor_id        uuid;   -- SEC-04: stamped by trigger (0008)

-- who trashed a row (set by the trigger in 0007)
do $$
declare t text;
begin
  foreach t in array array['students','employees','invoices','expenses','payments',
                           'payslips','accounts','journals','branches','reminder_logs'] loop
    execute format('alter table public.%I add column if not exists deleted_by uuid', t);
  end loop;
end $$;

-- reminder_logs had no branch. Fill it from the student; rows whose student
-- cannot be found stay NULL (= main office scope). A trigger in 0007 keeps
-- filling it for new rows, even when the writer does not send it.
update public.reminder_logs r
   set branch_id = s.branch_id
  from public.students s
 where r.branch_id is null and s.id::text = r.student_id;
create index if not exists reminder_logs_branch_key_idx
  on public.reminder_logs ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;

-- ---------- defaults ----------
alter table public.users        alter column role set default 'none';          -- DB-15: fail closed
alter table public.invoices     alter column status set default 'pending';
alter table public.custom_roles alter column id set default ('role_' || replace(gen_random_uuid()::text, '-', ''));  -- UX-002

-- ---------- CHECK constraints (NOT VALID) ----------
select public._mig_try('0005','invoices_amount_nonneg',  $q$alter table public.invoices add constraint invoices_amount_nonneg check (amount >= 0) not valid$q$);
select public._mig_try('0005','invoices_paid_nonneg',    $q$alter table public.invoices add constraint invoices_paid_nonneg check (coalesce(paid_amount,0) >= 0 and coalesce(concession_amount,0) >= 0) not valid$q$);
select public._mig_try('0005','invoices_not_overpaid',   $q$alter table public.invoices add constraint invoices_not_overpaid check (coalesce(paid_amount,0) + coalesce(concession_amount,0) <= coalesce(amount,0) + 0.01) not valid$q$);
select public._mig_try('0005','invoices_status_chk',     $q$alter table public.invoices add constraint invoices_status_chk check (status in ('pending','partial','paid','void')) not valid$q$);
select public._mig_try('0005','invoices_due_date_iso',   $q$alter table public.invoices add constraint invoices_due_date_iso check (due_date is null or due_date = '' or due_date ~ '^\d{4}-\d{2}-\d{2}') not valid$q$);

select public._mig_try('0005','payments_amount_pos',     $q$alter table public.payments add constraint payments_amount_pos check (amount > 0) not valid$q$);
select public._mig_try('0005','payments_type_chk',       $q$alter table public.payments add constraint payments_type_chk check (type in ('cash_in','cash_out')) not valid$q$);
select public._mig_try('0005','payments_source_chk',     $q$alter table public.payments add constraint payments_source_chk check (source is null or source in ('','invoice','payslip','expense','transfer')) not valid$q$);
select public._mig_try('0005','payments_not_self_reversal', $q$alter table public.payments add constraint payments_not_self_reversal check (reversal_of is null or reversal_of <> id::text) not valid$q$);
select public._mig_try('0005','payments_date_iso',       $q$alter table public.payments add constraint payments_date_iso check (date is null or date = '' or date ~ '^\d{4}-\d{2}-\d{2}') not valid$q$);

select public._mig_try('0005','expenses_amount_nonneg',  $q$alter table public.expenses add constraint expenses_amount_nonneg check (amount >= 0) not valid$q$);
select public._mig_try('0005','expenses_date_iso',       $q$alter table public.expenses add constraint expenses_date_iso check (date is null or date = '' or date ~ '^\d{4}-\d{2}-\d{2}') not valid$q$);

select public._mig_try('0005','payslips_amount_nonneg',  $q$alter table public.payslips add constraint payslips_amount_nonneg check (amount is null or amount >= 0) not valid$q$);
select public._mig_try('0005','payslips_status_chk',     $q$alter table public.payslips add constraint payslips_status_chk check (status is null or status in ('pending','paid')) not valid$q$);

select public._mig_try('0005','students_fee_nonneg',     $q$alter table public.students add constraint students_fee_nonneg check (monthly_fee is null or monthly_fee >= 0) not valid$q$);

select public._mig_try('0005','journals_amount_pos',     $q$alter table public.journals add constraint journals_amount_pos check (amount > 0) not valid$q$);
select public._mig_try('0005','journals_dr_ne_cr',       $q$alter table public.journals add constraint journals_dr_ne_cr check (debit_account <> credit_account) not valid$q$);

select public._mig_try('0005','custom_roles_id_chk',     $q$alter table public.custom_roles add constraint custom_roles_id_chk check (id ~ '^[^[:space:]]{1,64}$' and id not in ('admin','branch_manager','accountant','fee_collector','teacher','none')) not valid$q$);

-- ---------- NOT NULL (only where no row is NULL today) ----------
do $$
declare
  spec text;
  tbl text; col text;
  has_nulls boolean;
begin
  foreach spec in array array[
    'invoices.amount','invoices.status',
    'payments.amount','payments.type','payments.account',
    'expenses.amount',
    'journals.amount','journals.debit_account','journals.credit_account',
    'branches.name','accounts.name','students.name','employees.name',
    'users.role','custom_roles.permissions'
  ] loop
    tbl := split_part(spec, '.', 1);
    col := split_part(spec, '.', 2);
    execute format('select exists (select 1 from public.%I where %I is null)', tbl, col) into has_nulls;
    if has_nulls then
      perform public._mig_log('0005', 'not_null_' || spec, 'skipped',
        'NULL values exist in ' || spec || '; fix them (README) and re-run this file');
    else
      perform public._mig_try('0005', 'not_null_' || spec,
        format('alter table public.%I alter column %I set not null', tbl, col));
    end if;
  end loop;
end $$;

-- ---------- unique keys (live rows only, case-insensitive) ----------
select public._mig_unique_index('0005','branches_name_live_uq',
  $q$select 1 from public.branches where deleted_at is null and name is not null group by lower(btrim(name)) having count(*) > 1$q$,
  $q$create unique index if not exists branches_name_live_uq on public.branches (lower(btrim(name))) where deleted_at is null$q$);

select public._mig_unique_index('0005','accounts_name_live_uq',
  $q$select 1 from public.accounts where deleted_at is null and name is not null group by lower(btrim(name)) having count(*) > 1$q$,
  $q$create unique index if not exists accounts_name_live_uq on public.accounts (lower(btrim(name))) where deleted_at is null$q$);

select public._mig_unique_index('0005','accounts_code_live_uq',
  $q$select 1 from public.accounts where deleted_at is null and coalesce(btrim(code),'') <> '' group by lower(btrim(code)) having count(*) > 1$q$,
  $q$create unique index if not exists accounts_code_live_uq on public.accounts (lower(btrim(code))) where deleted_at is null and coalesce(btrim(code),'') <> ''$q$);

select public._mig_unique_index('0005','students_admission_no_live_uq',
  $q$select 1 from public.students where deleted_at is null and coalesce(extra->>'historical','') <> 'true' and coalesce(btrim(student_id),'') <> '' group by lower(btrim(student_id)) having count(*) > 1$q$,
  $q$create unique index if not exists students_admission_no_live_uq on public.students (lower(btrim(student_id))) where deleted_at is null and coalesce(extra->>'historical','') <> 'true' and coalesce(btrim(student_id),'') <> ''$q$);
-- (imported Manager.io history rows carry extra.historical = true and may reuse old
--  admission codes, so they are outside this key; current students stay unique.)

-- A payment can be reversed at most once (ACC-14 race). Legacy double
-- reversals make this SKIP until they are reviewed.
select public._mig_unique_index('0005','payments_one_reversal_uq',
  $q$select 1 from public.payments where reversal_of is not null and deleted_at is null group by reversal_of having count(*) > 1$q$,
  $q$create unique index if not exists payments_one_reversal_uq on public.payments (reversal_of) where reversal_of is not null and deleted_at is null$q$);

-- Document numbers and idempotency keys (new columns: cannot have duplicates yet).
select public._mig_try('0005','payments_idem_uq',       $q$create unique index if not exists payments_idem_uq on public.payments (idempotency_key) where idempotency_key is not null$q$);
select public._mig_try('0005','payments_receipt_no_uq', $q$create unique index if not exists payments_receipt_no_uq on public.payments (receipt_no) where receipt_no is not null$q$);
select public._mig_try('0005','invoices_invoice_no_uq', $q$create unique index if not exists invoices_invoice_no_uq on public.invoices (invoice_no) where invoice_no is not null$q$);
select public._mig_try('0005','invoices_idem_uq',       $q$create unique index if not exists invoices_idem_uq on public.invoices (idempotency_key) where idempotency_key is not null$q$);

-- The old total, case-sensitive branch constraint blocks "trash Baneen then
-- re-create Baneen". Drop it only once the live-row index that replaces it exists.
do $$
begin
  if exists (select 1 from pg_indexes where schemaname='public' and indexname='branches_name_live_uq') then
    if exists (select 1 from pg_constraint where conname='branches_name_unique' and conrelid='public.branches'::regclass) then
      alter table public.branches drop constraint branches_name_unique;
      perform public._mig_log('0005','drop_branches_name_unique','ok','replaced by branches_name_live_uq');
    end if;
  else
    perform public._mig_log('0005','drop_branches_name_unique','skipped','kept: branches_name_live_uq does not exist yet');
  end if;
end $$;

select public._mig_log('0005', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0005'
  and at >= (select max(at) from public.migration_log where migration = '0005' and step = '_start')
  and (status <> 'ok' or step in ('_start','_done'))
order by id;
