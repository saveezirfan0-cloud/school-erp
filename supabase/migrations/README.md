# Database setup, migrations and runbook

Everything here is meant to be pasted into the **Supabase SQL Editor** (or run with
`psql -v ON_ERROR_STOP=1 -f file.sql`) against a database that may hold **real data**.
Every file is idempotent, non-destructive and wrapped in a transaction, so a failure
leaves the database exactly as it was and is easy to spot. The last query of each file
prints that run's log (`migration_log`): look for `failed` or `skipped`.

## 1. Pre-flight checklist (do this before anything else)

1. **Backup.** Dashboard, Database, Backups. On Pro, note the current PITR timestamp. On
   the free plan there is no restorable backup, so also take a logical dump:
   `pg_dump "$SUPABASE_DB_URL" -Fc -f pre-migration-$(date +%F).dump` (or
   `supabase db dump -f pre-migration.sql` plus `--data-only`). Keep it off the project.
   Storage objects (the `receipts` bucket) are **not** in database backups.
2. **Rehearse.** If you can, restore that dump into a second Supabase project (or use
   Supabase Branching) and run the whole sequence there first. The sequence below was run
   against a local PostgreSQL 16 only, never against Supabase itself.
3. **Confirm what is live right now** (read-only; keep the output):
   ```sql
   -- policies: is anything open? (expect no row with qual = 'true' or "auth all")
   select tablename, policyname, cmd, roles, qual, with_check
   from pg_policies where schemaname in ('public','storage') order by 1,2;
   -- which SQL files ran? (no record exists today; the migrations create one)
   select to_regclass('public.migration_log');
   -- who is admin? you need at least one before and after
   select id, email, role, branch_id from public.users order by role;
   -- auth accounts with no profile (they will see nothing)
   select u.id, u.email from auth.users u left join public.users p on p.id = u.id where p.id is null;
   -- realtime tables and storage policies
   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname='storage' and tablename='objects';
   ```
4. **Authentication settings.** Disable email signups (Authentication, Sign In / Providers,
   Email). With them on, anyone on the internet gets a signed-in session.
5. **Pick a quiet window** and tell users: some migrations change who can do what (section 4).
6. **Deploy the app and Edge Function changes that go with the "enforcing" files** (section 3)
   before applying those files.
7. Keep this session open: `migration_log` is your record, and the rollback notes below assume
   nothing else changed in between.

## 2. Apply order

### Existing production database (the normal case)

The baseline scripts (`schema.sql`, `accounting.sql`, `trash.sql`, `security.sql`,
`realtime.sql`) and main's module scripts (`attendance.sql`, `lms.sql`) are **already applied**.
Do not re-run them. (If `attendance.sql` / `lms.sql` were never run on this database, nothing breaks:
`0013` logs the missing tables as `skipped`; run those two files later, then run `0013` again.) Apply, in this order, one file at
a time, reading the result grid after each:

| # | File | Kind | What it does |
|---|---|---|---|
| 1 | `0001_migration_log.sql` | safe | Log table and helpers. Run first. |
| 2 | `0002_rls_helpers.sql` | **behaviour** | `has_perm()` now honours per-user overrides; `canManageUsers` becomes admin-only; helpers once-per-statement; anon locked out of helpers. |
| 3 | `0003_indexes.sql` | safe | Indexes for policies and common queries. |
| 4 | `0004_dedupe_branches_accounts.sql` | data (soft) | Merges duplicate branches/accounts into Trash; backs up every changed value. **Review the preview queries in section 6 first.** |
| 5 | `0005_columns_defaults_constraints.sql` | **behaviour** | New columns, defaults, CHECKs (NOT VALID), NOT NULL, unique keys. Bad legacy data is skipped and logged, never fatal. |
| 6 | `0006_referential_integrity.sql` | **behaviour** | Trigger-based foreign keys and delete restrictions for the text reference columns. |
| 7 | `0007_rls_policies_and_guards.sql` | **behaviour** | The real policy set; replaces every existing policy on the 13 tables (inventory logged); users, roles, delete permissions. |
| 8 | `0008_audit_trail.sql` | safe | Server-side `row_history`, stamped and append-only `audit_log`. |
| 9 | `0009_money_rpcs.sql` | safe (additive) | Transactional money functions, invoice/receipt numbers, `account_balances`. |
| 10 | `0010_realtime_scope.sql` | behaviour (minor) | Stops publishing `users` and `audit_log`; default replica identity. |
| 11 | `0011_ledger_guards.sql` | **ENFORCING** | Posted money cannot be edited/relabelled outside the RPCs. **Only after the app uses the 0009 RPCs.** |
| 12 | `0012_storage_receipts.sql` | **ENFORCING** | Storage policies for `receipts`. **Only together with the `storage.js` path change.** |
| 13 | `0013_academic_tables.sql` | safe, can run any time after `0008` | Same permissions for attendance / subjects / exams / marks / assignments / submissions / materials, in the fast form; references, value checks, audit of exams and marks. Skips tables that do not exist yet. Re-run it after `lms.sql` or `attendance.sql`. |
| 14 | `0020_validate_constraints.sql` | later | `VALIDATE` the NOT VALID checks once the data is clean. Re-runnable. |
| - | `optional/9000_drop_users_pin.sql` | optional, irreversible | Drops `users.pin`. Not in the default order. |

`0011` and `0012` are last on purpose: they can wait, and nothing else depends on them.

After `0008` the minimum safe state is reached (policies, guards, audit). `0011` and `0012` are
the ones that can break today's screens if applied early.

### Brand-new database

```
1 schema.sql   2 accounting.sql   3 trash.sql   4 security.sql   5 realtime.sql
6 attendance.sql   7 lms.sql          (academic module; lms.sql needs attendance.sql first)
then migrations/0001 ... 0013 in order, then 0020 (optional on an empty database)
```
`schema.sql` enables RLS and creates **no** policies, so a half-finished setup is closed, not
open. Then bootstrap the first admin (section 8).

### If a baseline script is ever re-run by mistake

`schema.sql`, `accounting.sql`, `trash.sql` and `realtime.sql` are safe to re-run: they create
no policy and never change data. `security.sql` refuses to run once `migration_log` exists
(it would put the old, weaker policies back). If you override that
(`set app.allow_baseline_rerun = 'on';`) or restore an old copy of `schema.sql` that still has
the `auth all` block, **re-run `0002` and `0007`** (all migrations are idempotent) and the
database is closed again. Check at any time:

```sql
select tablename, policyname from pg_policies
where schemaname='public' and (policyname='auth all' or qual='true' or with_check='true');  -- must be empty
```

## 3. Which files need an app change

| File | App must first... | If applied too early |
|---|---|---|
| `0011_ledger_guards.sql` | call the 0009 RPCs for every money flow (Fees confirm/bulk/quick payment, Payslips pay, Expenses pay, transfers, invoice trash/restore, payment reversal) | Collecting a fee, marking paid, bulk edit of payment account/date, deleting a live payment, trashing a paid invoice all fail with SQLSTATE 55000 and a message naming the RPC to use |
| `0012_storage_receipts.sql` | upload to `<branchId or 'main'>/<uuid>.<ext>` with a `.jpg/.jpeg/.png/.webp/.pdf` name | Receipt photo upload fails (RLS) |
| `0007` | hide Trash / delete buttons the user cannot use; use `canDelete*` flags | Buttons fail with 42501 (permission denied) instead of working |
| `0005` | normalise Import values (ISO dates `YYYY-MM-DD`, positive amounts, status `pending/partial/paid`, payment type `cash_in/cash_out`) | Those import rows are rejected, row by row |
| `0006` | nothing | "Delete forever" of a referenced student/branch/account/invoice fails with 23503 |
| `0010` | nothing (live role changes now need a reload) | - |
| `0013` | nothing | Marks, assignments or attendance that point at a missing exam/subject/student/branch, negative marks, or an attendance status other than present/absent/late/leave are rejected |

`0011` and the browser code in `src/utils/accounting.js` / `Fees.jsx` / `InvoiceEditModal.jsx`: the browser currently
posts payments itself (claims `reversed` before writing the reversal, re-posts after a restore, updates
`status`/`paid_amount` directly, moves payment branches directly). All of that is refused by `0011` until
each call is replaced by its RPC:

| Browser code today | RPC |
|---|---|
| `collectInvoicePayment`, `createInvoiceAndCollect` (Receive now, QuickPayment, bulk receive, paid rows of the Excel import) | `post_invoice` / `record_invoice_payment` |
| `postUnpostedInvoice` (`ledgerPosted:false`) | `post_unposted_invoice` |
| `payPayslip`, `createExpenseAndPost` | `pay_payslip`, `pay_expense` |
| `reversePayment` (Payments page) | `reverse_payment` |
| `reverseSourcePayments` + `deleteDoc` on invoices / expenses / payslips | `trash_document` |
| `restoreWithLedger` / `repostReversedPayments` | `restore_document` (re-posts exactly what the trash step reversed) |
| `InvoiceEditModal` save (including moving its payments to the new branch) | `edit_invoice` |
| `AccountDetail` transfer | `transfer_funds` |

## 4. What changes for each role (after 0002 + 0005 + 0006 + 0007)

* **admin**: everything, as before. Hard DELETE still only on rows already in Trash.
* **Delete permissions.** Moving a row to Trash (or restoring it) needs the table's delete flag
  or admin: `canDeleteStudents`, `canDeleteEmployees`, `canDeleteExpenses`, and the **new**
  `canDeleteFees` (invoices), `canDeletePayslips`, `canDeletePayments`, `canDeleteJournals`;
  accounts use `canEditAccounting`, branches `canManageBranches`, reminder logs `canEditFees`.
  No built-in role has the new flags, so today only admin can trash invoices, payslips,
  payments and journals. Grant a flag through a custom role or an override (Access Overview).
  Permanent delete: admin only for invoices, payments, payslips, journals, accounts and
  reminder logs; the delete flag for students, employees, expenses; `canManageBranches` for branches.
* **Per-user overrides** (`users.extra.pagePermissions`) are enforced by the database, both
  grants and revocations. Only admins can write them.
* **`canManageUsers`** is admin-only in the database, whatever a custom role or override says
  (the flag is also stripped from `custom_roles.permissions`). Reason: it exposes every profile
  and has no safe meaning below admin. The UI should not offer it for custom roles.
* **users table.** Admin: full. Everyone else: read own row, change **only their own `name`**.
  Role, branch, overrides, id, email are admin-only. Changing `id` is refused for everyone.
  The last admin cannot be demoted or deleted through the API (the SQL editor and service role
  are exempt, which is the escape hatch). `users.role` defaults to `'none'` (no access) and must
  be a built-in role, `none`, or an existing custom role.
* **branch_manager / fee_collector** can read the Bank & Cash / Assets accounts (rows only; the
  opening `balance` column is visible too, RLS cannot hide a column). `list_pay_accounts()` is the
  alternative that returns only id/code/name; drop policy `accounts_select_pay` to use only that.
* **accounts / journals** need `canViewAccounting` (or edit) **and** `canViewAllBranches`.
* **branches** are readable by any user with a role; **custom_roles**: admin sees all, others
  only their own role.
* **reminder_logs** are scoped to the student's branch (`branch_id` is filled automatically).
* **audit_log**: append-only for everybody; the database stamps author and time. Non-admins can
  read back only their own rows.

## 5. RPC reference (0009), for the app changes

All are `SECURITY DEFINER`, check permission **and** branch inside, run in one transaction,
lock the source row, and take an optional **idempotency key**: generate one `crypto.randomUUID()`
when the dialog opens and send it with every attempt; a retry returns the first result.
Call with `supabase.rpc(name, { p_param: value })`. Errors are raised with these SQLSTATEs:
`42501` not allowed, `P0002` not found, `22023` bad argument, `23514` rule violated (for example
overpayment), `23503` unknown account/student.

| RPC | Replaces | Notes |
|---|---|---|
| `list_pay_accounts()` | reading `accounts` for the "paid into" list | rows: id, code, name, type, sub_type |
| `invoice_balance(p_invoice_id)` | `getSourcePaidTotal` | amount, concession, paid, remaining, status |
| `post_invoice(p_student_id, p_amount, p_month, p_year, p_due_date, p_line_items, p_notes, p_pay_account, p_pay_date, p_idempotency_key)` | create invoice + "Receive payment now", QuickPayment | set `p_pay_account` to take the money in the same transaction; returns the invoice |
| `record_invoice_payment(p_invoice_id, p_amount, p_account, p_date, p_concession, p_concession_note, p_idempotency_key)` | `Fees.confirmPay`, bulk receive | amount 0 + concession closes the balance; overpay refused; assigns a receipt number |
| `pay_payslip(p_payslip_id, p_account, p_date, p_idempotency_key)` | `payPayslip` / bulk pay | already paid returns unchanged (double click safe); net pay from `extra.netPay`, else the `amount` column (imports) |
| `pay_expense(p_expense_id, p_account, p_date, p_idempotency_key)` | `Expenses` recordPayment | already paid is a no-op |
| `transfer_funds(p_from_account, p_to_account, p_amount, p_date, p_description, p_idempotency_key)` | `AccountDetail.handleTransfer` | both legs or neither; needs `canEditAccounting`; returns the transfer id |
| `reverse_source_payments(p_source, p_source_id)` | `utils/accounting.js` reversal loop | source is `invoice`, `payslip`, `expense` or `transfer`; also resets the source document |
| `trash_document(p_table, p_id)` / `restore_document(p_table, p_id)` (`invoices`, `expenses`, `payslips`) | `reverseSourcePayments` + `deleteDoc` / `restoreWithLedger` | need `canDeleteFees` / `canDeleteExpenses` / `canDeletePayslips`; trash reverses the money (tagged), restore re-posts exactly that money (tagged `extra.repostOf`) and recomputes paid/status; returns `{"reposted": n}`. `trash_invoice` / `restore_invoice` are wrappers |
| `reverse_payment(p_payment_id, p_date)` | `reversePayment` | reverses one payment, returns the reversal id (NULL if already reversed), updates the source document; transfers use `reverse_source_payments` |
| `edit_invoice(p_id, p_branch_id, p_month, p_year, p_due_date, p_notes, p_line_items, p_amount)` | `InvoiceEditModal` | total cannot drop below received + conceded; re-derives status like the browser; payments follow the new branch; `main` means the main office |
| `post_unposted_invoice(p_invoice_id, p_account, p_date, p_idempotency_key)` | `postUnpostedInvoice` | posts the cash of a `ledgerPosted:false` receipt; `record_invoice_payment` refuses such invoices until then |
| `generate_recurring_invoices(p_year, p_month)` | `Fees.handleGenerateRecurring` | month is the English name; a second run creates nothing |
| `patch_extra(p_table, p_id, p_patch)` | whole-object `extra` overwrite | merges keys; invoker rights, so RLS applies; not for users/custom_roles |
| view `account_balances` | balance sums in `BankCash.jsx` | opening balance + live payments; honours the caller's RLS |

Manager.io / workbook history (`extra.historical = true`) gets **no** invoice or receipt number, so the gapless
sequence stays for real documents.

New invoices and fee receipts get `invoice_no` (`INV-2026-000001`) and `receipt_no`
(`RCP-2026-000001`) automatically, gapless, by trigger, even from today's client.

## 6. Legacy data checks (run before applying; re-run before `0020`)

All read-only. Each should return **no rows** (or zero) before you validate the matching constraint.

```sql
-- 0004 preview: what would be merged (live rows, case/space-insensitive)
select lower(btrim(name)) k, count(*), array_agg(id) from public.branches where deleted_at is null group by 1 having count(*)>1;
select lower(btrim(name)) k, count(*), array_agg(balance) from public.accounts where deleted_at is null group by 1 having count(*)>1;

-- unique keys (0005): any row returned means that index was SKIPPED
select lower(btrim(code)) k, count(*) from public.accounts where deleted_at is null and coalesce(btrim(code),'')<>'' group by 1 having count(*)>1;
select lower(btrim(student_id)) k, count(*), array_agg(name) from public.students where deleted_at is null and coalesce(btrim(student_id),'')<>'' group by 1 having count(*)>1;
select reversal_of, count(*) from public.payments where reversal_of is not null and deleted_at is null group by 1 having count(*)>1;

-- CHECK constraints (0005 / 0020)
select id, amount from public.invoices where amount < 0;                                                  -- invoices_amount_nonneg
select id, paid_amount, concession_amount from public.invoices where coalesce(paid_amount,0)<0 or coalesce(concession_amount,0)<0;  -- invoices_paid_nonneg
select id, amount, paid_amount, concession_amount from public.invoices
 where coalesce(paid_amount,0)+coalesce(concession_amount,0) > coalesce(amount,0)+0.01;                 -- invoices_not_overpaid
select status, count(*) from public.invoices group by 1;                                                  -- invoices_status_chk: pending/partial/paid/void
select id, due_date from public.invoices where due_date is not null and due_date<>'' and due_date !~ '^\d{4}-\d{2}-\d{2}';  -- invoices_due_date_iso
select id, amount from public.payments where amount <= 0;                                                 -- payments_amount_pos
select type, count(*) from public.payments group by 1;                                                    -- payments_type_chk: cash_in/cash_out
select source, count(*) from public.payments group by 1;                                                  -- payments_source_chk
select id, date from public.payments where date is not null and date<>'' and date !~ '^\d{4}-\d{2}-\d{2}'; -- payments_date_iso
select id, date from public.expenses where date is not null and date<>'' and date !~ '^\d{4}-\d{2}-\d{2}'; -- expenses_date_iso
select id from public.expenses where amount < 0;                                                          -- expenses_amount_nonneg
select id, amount from public.payslips where amount < 0;                                                  -- payslips_amount_nonneg
select status, count(*) from public.payslips group by 1;                                                  -- payslips_status_chk: pending/paid
select id, monthly_fee from public.students where monthly_fee < 0;                                        -- students_fee_nonneg
select id from public.journals where amount <= 0 or debit_account = credit_account;                       -- journals_*
select id from public.custom_roles where id ~ '\s' or length(id) > 64 or id in ('admin','branch_manager','accountant','fee_collector','none');

-- NOT NULL (0005): any row returned means that column was SKIPPED
select 'invoices.amount' c, count(*) from public.invoices where amount is null union all
select 'invoices.status', count(*) from public.invoices where status is null union all
select 'payments.amount', count(*) from public.payments where amount is null union all
select 'payments.type', count(*) from public.payments where type is null union all
select 'payments.account', count(*) from public.payments where account is null union all
select 'expenses.amount', count(*) from public.expenses where amount is null union all
select 'journals.amount/debit/credit', count(*) from public.journals where amount is null or debit_account is null or credit_account is null union all
select 'branches/accounts/students/employees.name', (select count(*) from public.branches where name is null)+(select count(*) from public.accounts where name is null)+(select count(*) from public.students where name is null)+(select count(*) from public.employees where name is null) union all
select 'users.role', count(*) from public.users where role is null;

-- 0006 orphans (existing ones are left alone; they only block NEW writes that reference them)
select 'invoices->students' rel, count(*) from public.invoices i where i.student_id is not null and i.student_id <> '' and not exists (select 1 from public.students s where s.id::text = i.student_id)
union all select 'payslips->employees', count(*) from public.payslips p where p.employee_id is not null and not exists (select 1 from public.employees e where e.id::text = p.employee_id)
union all select 'payments->accounts(name)', count(*) from public.payments p where p.account is not null and not exists (select 1 from public.accounts a where a.name = p.account and a.deleted_at is null)
union all select 'users->roles', count(*) from public.users u where u.role not in ('none','admin','branch_manager','accountant','fee_collector') and not exists (select 1 from public.custom_roles r where r.id = u.role)
union all select t || '->branches', n from (
  select 'students' t, count(*) n from public.students x where coalesce(x.branch_id,'') not in ('','main') and not exists (select 1 from public.branches b where b.id::text = x.branch_id)
  union all select 'invoices', count(*) from public.invoices x where coalesce(x.branch_id,'') not in ('','main') and not exists (select 1 from public.branches b where b.id::text = x.branch_id)
  union all select 'payments', count(*) from public.payments x where coalesce(x.branch_id,'') not in ('','main') and not exists (select 1 from public.branches b where b.id::text = x.branch_id)
  union all select 'users', count(*) from public.users x where coalesce(x.branch_id,'') not in ('','main') and not exists (select 1 from public.branches b where b.id::text = x.branch_id)) z;

-- ledger vs invoice drift (informational; fix by reversing/re-posting through the RPCs)
with ledger as (
  select source_id, sum(case when type='cash_in' then amount else -amount end) net
  from public.payments where source='invoice' and deleted_at is null and not coalesce(reversed,false) and reversal_of is null group by 1)
select i.id, i.status, i.amount, i.paid_amount, coalesce(l.net,0) ledger_net
from public.invoices i left join ledger l on l.source_id = i.id::text
where i.deleted_at is null and (abs(coalesce(i.paid_amount,0)-coalesce(l.net,0))>0.01 or (i.status='paid' and l.net is null));
```

Note on NOT VALID checks: they are enforced on every new row **and on every UPDATE of an existing row**.
A legacy row that already breaks a rule cannot be edited at all (even moved to Trash) until it is corrected.
That is why you fix the rows, then run `0020`.

## 7. Rollback notes (per migration)

Nothing here deletes your business data; rollback is mostly dropping what was added. Take a backup
first, and remember that rolling back a security file re-opens what it closed.

* **0001** `drop table public.migration_log, public.migration_backup cascade; drop function public._mig_log, public._mig_try, public._mig_unique_index;` Do this last: later files use them.
* **0002** Restore the old function bodies from `supabase/security.sql` (lines 19-114): run that
  file with `set app.allow_baseline_rerun = 'on';` in the same session. `has_perm` then ignores
  overrides again.
* **0003** `drop index if exists <name>;` for the `*_branch_key_idx`, `invoices_student_idx`, `payslips_employee_idx`,
  `invoices_status_due_idx`, `payments_account_date_idx`, `payments_source_live_idx`, `reminder_logs_ts_idx`, `audit_log_created_idx`, `*_trashed_idx`.
* **0004** every value it changed is in `migration_backup`. Undo:
  ```sql
  update public.students s set branch_id = b.old_value from public.migration_backup b
   where b.migration='0004' and b.table_name='students' and b.column_name='branch_id' and b.row_id = s.id::text;
  -- repeat for employees, invoices, expenses, payments, payslips, users (branch_id) and for
  -- payments.account, invoices.paid_account, payslips.paid_account, expenses.paid_account.
  update public.branches set deleted_at = null where id::text in
    (select row_id from public.migration_backup where migration='0004' and table_name='branches' and column_name='deleted_at');
  update public.accounts set deleted_at = null where id::text in
    (select row_id from public.migration_backup where migration='0004' and table_name='accounts' and column_name='deleted_at');
  ```
  (Restoring a duplicate branch/account will make the unique index in 0005 skip or fail: that is expected.)
* **0005** constraints: `select format('alter table %s drop constraint %I;', conrelid::regclass, conname) from pg_constraint
  where connamespace='public'::regnamespace and contype='c' and conname ~ '^(invoices|payments|expenses|payslips|students|journals|custom_roles)_';`
  unique indexes: `drop index if exists branches_name_live_uq, accounts_name_live_uq, accounts_code_live_uq, students_admission_no_live_uq, payments_one_reversal_uq, payments_idem_uq, payments_receipt_no_uq, invoices_invoice_no_uq, invoices_idem_uq;`
  NOT NULL: `alter table ... alter column ... drop not null;` Defaults: `alter table public.users alter column role set default 'admin';` (not recommended).
  New columns can stay (they are nullable) or `alter table ... drop column`.
* **0006** `select format('drop trigger %I on %s;', tgname, tgrelid::regclass) from pg_trigger where tgname like 'trg\_ref\_%' or tgname like 'trg\_restrict\_%';`
* **0007** the exact policies that existed before are in `migration_log` (`step like 'policy_before_%'`: command, roles, USING, WITH CHECK).
  Triggers: `drop trigger trg_users_guard, trg_users_last_admin, trg_users_role_valid on public.users;` plus `trg_custom_roles_guard`, `trg_*_soft_delete`, `trg_reminder_logs_branch`.
* **0008** `drop trigger trg_<table>_history on public.<table>;` for the ten tables; `drop trigger trg_audit_log_stamp, trg_audit_log_append_only, trg_audit_log_no_truncate on public.audit_log;` `row_history` can be kept (it is only evidence).
* **0009** `drop view public.account_balances;` drop the functions listed in the file header; `drop trigger trg_invoices_number on public.invoices; drop trigger trg_payments_number on public.payments;`. Issued numbers stay on the rows.
* **0011** `drop trigger trg_payments_immutable on public.payments; drop trigger trg_invoices_money_guard on public.invoices; drop trigger trg_payslips_money_guard on public.payslips; drop trigger trg_expenses_money_guard on public.expenses;`
* **0010** `alter publication supabase_realtime add table public.users, public.audit_log;`
* **0012** `drop policy receipts_insert on storage.objects;` (and `receipts_select`, `receipts_delete`); `update storage.buckets set file_size_limit=null, allowed_mime_types=null where id='receipts';`
* **0020** nothing to undo.
* **9000** `alter table public.users add column pin text;` and restore from `migration_backup` (see the file header).

## 8. Operations

**First admin / lock-out recovery.** The SQL editor and the service role have no `auth.uid()`, so
the guards do not apply to them:
```sql
insert into public.users (id, uid, name, email, role)
select id, id, email, email, 'admin' from auth.users where email = 'owner@yourschool.example'
on conflict (id) do update set role = 'admin';
```
**A person leaves.** Delete or ban the auth account (Edge Function or Dashboard, Authentication,
Users), not just the profile row: without a profile they get role `none` and see nothing, but the
login still works. Their data and history stay.

**Who changed what.** `select * from public.row_history where table_name='payments' and row_id='<uuid>' order by at;`
(admin only; actor is `auth.uid()`; PINs are never recorded). `audit_log` keeps the app's activity text,
now stamped with the real login.

**Retention.** `audit_log` and `row_history` are append-only, even for admins. To purge after your statutory
period, a DBA disables the trigger deliberately (command in the 0008 header) and re-enables it.
Receipts bucket and Trash have no retention job: decide a policy; never auto-purge payments/journals.

**Break-glass.** To correct a posted payment by hand, use the SQL editor (guards skip it, `row_history` records it).
To suspend a trigger temporarily: `alter table public.payments disable trigger trg_payments_immutable;` ... then enable it again.

**Historical import (Manager.io) next to the migrations.** The scripts in `scripts/` insert as the SQL editor (no
`auth.uid()`), so they are not blocked by the guards or the reference checks, and imported rows are not numbered.
Two things to know: (1) a row that breaks a NOT VALID check (negative or zero amount, non-ISO date, unknown
status) makes `activate_historical_import.sql` fail as a whole, because its UPDATE touches the row; run the section 6
checks on the staged rows (`where extra->>'staged' = 'true'`) first, and fix them in a single UPDATE per row;
(2) to undo an import with `delete ... where extra->>'source' = 'manager.io'`, delete in dependency order,
because hard deletes of referenced rows are refused: `payments`, `expenses`, `payslips`, `invoices`, `students`, `employees`.
Imported students are outside the admission-number unique key (`extra.historical = true`), current ones are not.
`fix_invoice_branch.sql`, `seed_chart_of_accounts.sql` and `rollback_workbook_import.sql` run unchanged.
(`seed_chart_of_accounts.sql` fails on a duplicate account code like `C-01` if a different live account already uses it.)

**Making the receipts bucket private** (optional, later): see the bottom of `0012_storage_receipts.sql`; needs signed URLs in the app.

## 9. Backups and restore (audit DB-23, DEP-16)

* Use a plan with **PITR** for a financial system, or at least daily backups; the free plan has no restorable backup.
* Add a nightly off-site logical dump from CI (`supabase db dump` for schema and data) and a copy of the `receipts` bucket.
* Do a **restore drill** once per term into a second project and write down the time it took.
* Trash and "Empty trash" are permanent deletes; after 0007 only people with the delete flag (admin for money rows) can do it, and money rows must be reversed first (0011).
* This repo cannot verify any of this; check the dashboard.

## 10. Not done here (needs the app, or a decision)

* Converting `branch_id` / `student_id` / `employee_id` text columns to uuid with real foreign keys, and referencing accounts by id instead of name (DB-2 phase 2). The 0006 triggers give the insert-time check and delete restriction meanwhile.
* Promoting jsonb fields to typed columns (`invoices.month/year`, payslip amounts, employee salary): needs the `COLUMNS` map in `src/firebase.js` changed in the same release (DB-11). `generate_recurring_invoices` and `pay_payslip` read the jsonb keys directly until then.
* Numeric precision (paisa rounding, ACC-22), text dates to `date` (DB-14), `created_at` from the server clock, academic years, `promote_students`, header/line journals (DB-21), PINs moved to a hashed table (SEC-12; the column can be dropped with `optional/9000`).
* WhatsApp, reminder sending and `/api/send-reminders` (out of scope). Only the `reminder_logs` branch scoping is here.
* A custom access-token hook that puts role and branch in the JWT (would remove the per-statement user lookup entirely).

## 11. Tests

`supabase/tests/run_tests.sh [dbname]` rebuilds a **local** scratch PostgreSQL from the baseline scripts (including
`attendance.sql` and `lms.sql`), a Supabase stub and legacy-looking seed data (duplicates, orphans, a teacher in two
branches, LMS rows, a student with status `left`, a staged Manager.io history import), applies every migration and runs
about 325 assertions: policy matrix per role, branch isolation, no self-promotion, delete rules, audit stamping, RPC
results, idempotency, storage rules, teacher / attendance / marks scope, fee collector locked out of the LMS tables.
It then runs main's own scripts (`activate_historical_import.sql`, `rollback_workbook_import.sql`,
`fix_invoice_branch.sql`, `seed_chart_of_accounts.sql`, `lms.sql` again), cleans the legacy data and re-runs
`0005`, `0013`, `0020`. `BASELINE_DIR=<dir>` runs it with older copies of the baseline files. It never touches Supabase.
