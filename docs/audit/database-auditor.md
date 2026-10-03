# Database audit: schema, RLS, migrations, concurrency

Agent: `database-auditor` | Date: 2026-10-03 | Scope: `supabase/*.sql`, `supabase/functions/create-user`, `src/firebase.js` (the Firestore shim), `src/hooks/*`, `src/utils/accounting.js`, `src/utils/auditLog.js`, `src/context/*`, and every page that reads or writes data.

**Method and limits**
- I read all 7 SQL scripts and traced each table against every `addDoc / updateDoc / updateDocs / deleteDoc / onSnapshot / getDocs / supabase.from()` call site.
- No Supabase MCP connection was available in this session, so I read no advisors and listed no live tables. Nothing here comes from production data.
- I tried to start a throwaway local Postgres 16 to run the proposed SQL. The sandbox blocked a non-root data directory, so **none of the SQL below has been run**. Run it on `supabase start` or a branch database before using it.
- "Verified: yes" means I followed the code path end to end by reading it. "Verified: no" means the finding depends on platform behaviour or project settings I could not see.

## Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 6 | DB-1, DB-2, DB-3, DB-4, DB-5, DB-6 |
| Medium | 16 | DB-7 to DB-18, DB-20, DB-21, DB-23, DB-24 |
| Low | 4 | DB-19, DB-22, DB-25, DB-26 |
| **Total** | **26** | |

Main points:
1. The database has almost no integrity rules. Across 13 tables there is 1 foreign key, 0 CHECK constraints, 0 NOT NULL on business columns, and at most 1 unique constraint (`branches_name_unique`, which only exists if a fix script was run).
2. Every money flow is a series of separate browser writes. Nothing makes them atomic or idempotent.
3. The RLS permission model does not match those flows. Branch managers and fee collectors cannot see accounts or payments, so their "paid" invoices are created with no ledger row.
4. Every RLS helper call runs once per row, and every table read is silently capped by PostgREST's row limit.

### How much lives in jsonb vs real columns

Every table has an `extra jsonb` catch-all. `encode()` in `src/firebase.js:70-83` sends any camelCase key not listed in `COLUMNS` into `extra` without telling anyone.

| Table | Real business columns | App fields written into `extra` | Notes |
|---|---|---|---|
| users | 6 | 1 (`pagePermissions`) | RLS ignores `pagePermissions` (DB-26) |
| branches | 3 | 1 (`manager`) | |
| students | 11 | 0 | Best-mapped table |
| employees | 2 (`name`, `branch_id`) | **6** (`role, phone, email, salary, joinDate, recurringPayslip`) | Salary is in jsonb |
| invoices | 11 | **8** (`studentName, parentPhone, month, year, lineItems, notes, directPayment, receiptUrl`) | Billing period (`month`/`year`) is in jsonb. Column `date` is never written |
| expenses | 6 | 1 (`notes`) | |
| payments | 12 | 0 | |
| payslips | 8 | **8** (`year, employeeName, role, basicSalary, allowances, deductions, netPay, notes`) | **All payroll money is in jsonb.** Columns `amount` and `date` are never written |
| accounts | 5 | 1 (`description`) | |
| journals | 7 | 0 | |
| custom_roles | 1 (`permissions` jsonb) | 3 (`label, color, bg`) | |
| reminder_logs | 6 | unknown | The writer (`/api/send-reminders`) is not in the repo |
| audit_log | 5 | 0 | |

- **Total: 29 app fields live in jsonb**, including 5 money fields (all payroll amounts and employee salary) and 3 fields used for queries or dedupe (`invoices.month/year`, `payslips.year`).
- **There are about 19 reference columns**: `branch_id` on 7 tables, `student_id` ×2, `employee_id`, `account`/`paid_account` ×4 (stored by *name*), `debit_account`/`credit_account` (by name), `source_id`, `reversal_of`, and `users.role` (pointing at `custom_roles`).
- All of them are `text`, and **none has a foreign key**. The only FK in the schema is `users.id → auth.users`.

---

## Findings

### [DB-1] Re-running `schema.sql` silently turns off all row-level security
- Severity: High
- Effort: S
- Location: supabase/schema.sql:243-257; supabase/security.sql:125-135
- Evidence:
  - `schema.sql` ends with a loop over all 13 tables: `drop policy if exists "auth all" ... create policy "auth all" on public.%I for all to authenticated using (true) with check (true);`.
  - `security.sql` removes that policy and adds granular ones.
  - Postgres combines permissive policies with OR. If `schema.sql` is run again after `security.sql`, `"auth all"` comes back and every granular policy stops having any effect.
  - The scripts invite re-runs: they use `create table if not exists`, and the companion scripts say "Safe to re-run".
- Impact: After a routine re-run (for example, to add a table), every signed-in user, including a fee collector, can read and write every table: payslips, the users table with PINs, and journals. Nothing in the app shows that this happened.
- Fix:
  - Delete the "auth all" block from `schema.sql`.
  - Move to versioned migrations (see "Proposed migrations layout") so baseline scripts are never re-run by hand.
  - Add a CI check that fails if any policy has `qual = 'true'` on a business table (query in section A).
- Verified: yes (traced. Permissive-policy OR semantics are standard Postgres.)

### [DB-2] Almost no relational integrity: text references, no FKs, CHECKs or NOT NULL
- Severity: High
- Effort: L
- Location: supabase/schema.sql:25-219 (all tables); supabase/accounting.sql
- Evidence:
  - `student_id text`, `branch_id text`, `employee_id text`. Money columns are `numeric` with no checks.
  - `status text` has no enum.
  - `payments.account text` holds an account *name* (`src/utils/accounting.js:23` says "account NAME (matches accounts.name)").
  - Branch "Main" is the sentinel `''`/`'main'`/NULL, not a row (`src/utils/branchFilter.js:3`).
  - The only constraint beyond primary keys is `users.id references auth.users on delete cascade`.
- Impact. These orphan cases follow from code paths I traced:
  - A trashed student keeps live invoices. "Delete forever" in Trash then leaves invoices pointing at nothing, and `StudentLedger.jsx:19` shows a blank student.
  - `fix_duplicate_branches.sql` hard-deletes branches but does not repoint `users.branch_id` (see DB-8).
  - Renaming an account in Chart of Accounts (`ChartOfAccounts.jsx:41`) cuts it off from every historical payment. Its balance resets (`BankCash.jsx:24` matches `p.account === accountName`).
  - Negative amounts, unknown statuses (`Import.jsx:76`) and `type` values other than `cash_in`/`cash_out` are all accepted.
- Fix:
  - Phase 1 (no app change): run the orphan and value checks in section A, then add `CHECK ... NOT VALID` and partial unique indexes (section C), clean up, then `VALIDATE`.
  - Phase 2 (needs shim and app changes): make "Main" a real `branches` row, convert `branch_id`, `student_id`, `employee_id` to `uuid` with FKs (`on delete restrict`), and reference accounts by `account_id uuid` instead of name.
- Verified: yes

### [DB-3] Money flows are multi-step, non-transactional browser writes with no locking or idempotency
- Severity: High
- Effort: M
- Location:
  - src/pages/Fees.jsx:219-302 (`markPaid`/`confirmPay`), :126-170 (`handleCreate` direct payment), :361-399 (bulk mark paid)
  - src/pages/Payslips.jsx:66-93, :146-179
  - src/pages/Expenses.jsx:134-160
  - src/pages/AccountDetail.jsx:44-59
  - src/utils/accounting.js:101-135
- Evidence:
  - **Invoice payment.** `markPaid` reads `getSourcePaidTotal` when the modal opens and stores it in `alreadyPaid`. `confirmPay` later inserts a payment, then writes `paidAmount: newPaid` computed in the browser. Two collectors on the same invoice each see `alreadyPaid = 0`, each insert the full amount, and the second `updateDoc` overwrites the first. Result: 2× cash in the ledger, and the invoice shows 1×.
  - **Payslip payment.** `Payslips.confirmPay` has no `submitting` guard, so a double-click posts two salary `cash_out`s.
  - **Reversal.** `reversePayment` first `update ... set reversed=true`, then inserts the reversal as a separate request. If the second request fails, the original is marked reversed with no opposite entry. Two admins deleting the same invoice can each reverse it.
  - **Transfer.** `AccountDetail.handleTransfer` makes two independent inserts.
  - **Expense.** `Expenses.handleSingle` tells the user outright: "Expense saved, but payment not recorded".
- Impact: Bank and cash balances drift from invoice and payslip state in normal use. Retries on a flaky mobile connection double-post. Nothing in the database detects any of this.
- Fix:
  - Move each flow into one `SECURITY DEFINER` Postgres function that locks the source row (`select ... for update`), recomputes paid-so-far from `payments` on the server, inserts the payment and updates the source in one transaction, and takes an `idempotency_key` with a unique index.
  - Section F gives `record_invoice_payment`, `pay_payslip`, `reverse_source_payments`, `trash_invoice`/`restore_invoice`, and `transfer_funds`.
  - The browser then makes one `supabase.rpc(...)` call per action.
- Verified: yes (code paths traced. The races themselves were not executed.)

### [DB-4] RLS permissions don't match the fee workflow: branch managers and fee collectors create "paid" invoices with no ledger entry
- Severity: High
- Effort: M
- Location:
  - supabase/security.sql:60-78 (built-in permission matrix), :209-221 (payments), :243-249 (accounts)
  - src/pages/Fees.jsx:145-155, :718-731
  - src/pages/QuickPayment.jsx:48-61
- Evidence:
  - `branch_manager` and `fee_collector` do not have `canViewAccounting`, so `accounts_select` returns nothing. `fee_collector` also lacks `canViewPayments`/`canEditPayments`.
  - In `Fees.jsx`, `payAccounts` comes back empty, so the "Confirm Payment" button is disabled ("No Bank & Cash accounts yet").
  - "Receive payment now" runs `const acct = payAccounts[0]?.name; if (acct) { await recordPayment(...) }`. The invoice is still inserted with `status: "paid", paidAmount: amount`.
  - `QuickPayment.jsx` always inserts `status: "paid"` invoices and never writes a payment row or `paidAmount`.
  - Even when a payment is attempted, `getSourcePaidTotal` reads `payments`, which `fee_collector` cannot select, so `alreadyPaid` is always 0.
- Impact:
  - For the two roles that collect fees, money taken at the counter never reaches Bank & Cash.
  - Reports count "collected" as `sum(paidAmount)` (`Reports.jsx:29`). QuickPayment invoices have no `paidAmount`, so they count as 0. Dashboard counts `status==='paid'` at face value. The two screens disagree.
- Fix:
  - Do not grant payments or accounts table access to these roles.
  - Expose `record_invoice_payment` (section F) as a `SECURITY DEFINER` RPC. It checks `has_perm('canEditFees')` and `branch_visible`, and writes the payment and invoice together.
  - Add a narrow `list_pay_accounts()` RPC that returns Bank & Cash account names only.
  - Change QuickPayment and direct payment to call the RPC.
- Verified: yes (policy matrix traced against page code)

### [DB-5] PostgREST's row cap silently truncates every full-table read, which breaks balances, reports and dedupe at scale
- Severity: High
- Effort: M
- Location: src/firebase.js:365-371 (`getDocs`), :439-451 (`onSnapshot` fullFetch); src/hooks/useCollection.js:9-12
- Evidence:
  - Every read is `supabase.from(table).select("*")` with no `.range()`.
  - Supabase's API caps responses at "Max rows" (default 1000) and returns no error when it does.
  - Pages then compute in the browser:
    - account balances (`BankCash.jsx:22-28`)
    - P&L (`Reports.jsx:15-37`)
    - the recurring-invoice "already exists" set (`Fees.jsx:200-201`)
    - the per-student ledger (`StudentLedger.jsx:22-27`)
- Impact:
  - Once a table passes about 1000 live rows (roughly 85 students × 12 months of invoices), the following become silently wrong:
    - Balances and reports.
    - Recurring generation, which creates duplicate invoices for students whose existing invoice fell outside the first 1000 rows.
    - The student ledger.
  - At 10k students the Students list shows 10%.
- Fix:
  - Do not just raise Max rows.
  - Move aggregates into SQL views or RPCs: `account_balances`, `student_balance(student_id)`, `pl_summary(from, to, branch)` (section F).
  - Paginate lists with `.range()` and server-side `.eq()` filters.
  - Push filters such as `student_id`, `branch_id`, `status`, `month` into the query. They are currently applied in `useCollection.js` in the browser.
- Verified: no (depends on the project's Max rows setting. The default is 1000.)

### [DB-6] RLS helper functions run once per row with 3-5 lookups each; this gets expensive at 10k+ students
- Severity: High
- Effort: M
- Location: supabase/security.sql:19-114 (helpers), :141-238 (policies)
- Evidence:
  - Policies call `public.has_perm('canViewStudents') and public.branch_visible(branch_id)` without wrapping them in `(select ...)`.
  - Both are `SECURITY DEFINER` plpgsql/sql functions. Postgres cannot inline them and does not cache STABLE results across rows.
  - For a `branch_manager`, each row costs:
    - `has_perm` → `current_role()`: 1 `users` lookup, plus parsing a jsonb literal.
    - `branch_visible` → `current_role()` + `current_branch()`: 2 `users` lookups.
    - `branch_visible` → `has_perm('canViewAllBranches')`: another `current_role()` lookup, plus a `custom_roles` lookup, because that permission is not in the built-in map.
    - That is about 5 index probes and 3 plpgsql calls per row. Admins pay about 3 per row.
  - Realtime runs the same SELECT policy for every subscriber on every change.
  - No `branch_id` index exists, so the branch filter always scans the whole table.
- Impact (estimated, not benchmarked):
  - 10k students: about 50k probes per Students load.
  - At 100k+ invoices per year, an Invoices or Reports load takes seconds and gets worse with each open tab.
  - Bulk updates fan out per-row RLS work to every realtime subscriber.
- Fix:
  - Wrap every call in a scalar subquery so it becomes a once-per-statement InitPlan.
  - Split the branch check into row-independent parts, `(select sees_all_branches())` and `(select my_branch_key())`, compared against an indexed expression.
  - Section E has the full rewrite and section D the matching indexes.
  - Longer term, put `app_role`/`branch_id` into JWT claims with a Custom Access Token hook so policies read `auth.jwt()` and do no table lookup at all.
- Verified: no (cost traced from code. Not benchmarked.)

### [DB-7] Root cause of duplicate branches and accounts: no unique keys, no double-submit guard, an import that is not idempotent, and ledger links by name
- Severity: Medium
- Effort: M
- Location:
  - src/pages/Branches.jsx:13-20
  - src/pages/Import.jsx:253-275
  - src/pages/ChartOfAccounts.jsx:35-55
  - supabase/schema.sql:41-49, :151-160
  - src/context/BranchContext.jsx:28-38
- Evidence:
  - **Branches.** `Branches.handleSubmit` has no `submitting` flag and no try/catch. It checks "max 4 branches" in the browser against a *deduplicated* list. Nothing in the database stops a double-click or two tabs from inserting "Main" twice.
  - **Accounts.** `Import.jsx` does `addDoc` row by row with no upsert or dedupe, so importing the Manager.io chart twice duplicates every account. `accounts.code` and `accounts.name` have no unique constraint.
  - **Masking.** `BranchContext` hides duplicate names in the UI ("Safety net"), which hides the problem rather than preventing it.
  - **Existing constraint.** `branches_name_unique` from the fix script is total (not limited to live rows) and case-sensitive.
- Impact:
  - Because payments reference accounts by *name*, two live "Cash" accounts each add every "Cash" payment into their own balance. Bank & Cash total double-counts (`BankCash.jsx:30`).
  - With the total unique constraint on branches, trashing "Baneen" and then re-creating "Baneen" fails with 23505. There is no catch, so the user sees nothing.
- Fix:
  - Partial, case-insensitive unique indexes on live rows only: `branches(lower(btrim(name)))`, `accounts(lower(btrim(code)))`, `accounts(lower(btrim(name)))`, `students(lower(btrim(student_id)))`, all `where deleted_at is null` (section C).
  - Make Import upsert on the natural key.
  - Add a `submitting` guard and error handling to `Branches.jsx`.
- Verified: no (root cause inferred from the only code paths that can create these rows. No production data seen.)

### [DB-8] `fix_duplicate_*.sql` are incomplete and depend on run order
- Severity: Medium
- Effort: S
- Location: supabase/fix_duplicate_branches.sql:15-62; supabase/fix_duplicate_accounts.sql:12-21
- Evidence. `fix_duplicate_branches.sql`:
  - repoints 6 tables but not `users.branch_id`;
  - picks the oldest row as the keeper even if it is soft-deleted (`order by created_at asc` with no `deleted_at` filter), so children can be repointed to a trashed branch and the live duplicate hard-deleted;
  - hard-deletes, unlike the Trash model everywhere else;
  - adds a total, case-sensitive `unique(name)`.
- Evidence. `fix_duplicate_accounts.sql`:
  - references `deleted_at`, so it fails unless `trash.sql` ran first, and the README does not list `trash.sql` (DB-18);
  - only collapses exact `(code, name)` pairs, so "Cash" with code `1001` and "Cash" with a blank code both survive;
  - adds no constraint, so duplicates come back on the next import.
  - `created_at` is set by the browser (`createdAt: serverTimestamp()` is the browser clock, `firebase.js:76`), so "oldest" is not reliable.
- Impact:
  - Users assigned to a deleted duplicate branch see no rows at all (`branch_visible` compares against a non-existent id).
  - Account duplicates persist and keep double-counting balances.
- Fix:
  - Replace both scripts with one migration (section B) that only considers live rows, repoints `users`, soft-deletes instead of hard-deleting, normalises case and whitespace, and creates the partial unique indexes in the same transaction.
  - Move the old scripts to `supabase/legacy/`.
- Verified: yes

### [DB-9] No invoice or receipt numbers, and admission numbers are not unique
- Severity: Medium
- Effort: M
- Location: src/utils/invoiceGenerator.js (0 bytes); supabase/schema.sql:54-70, :87-131
- Evidence:
  - Invoices and payments are identified only by UUID.
  - `invoiceGenerator.js` and `useFirestore.js` are empty.
  - `students.student_id` is marked `required` in the form (`Students.jsx:301`) but has no unique constraint.
  - Imports map any "code/id/ref" column into it (`Import.jsx:27`).
- Impact:
  - Parents get WhatsApp "receipts" with no receipt number.
  - Auditors cannot check for gaps in a sequence.
  - Two students can share an admission number, and search by ID returns either.
  - Any future browser-side "max+1" numbering would race (two tabs get the same number).
- Fix:
  - Add a `document_counters` table and a `next_document_number(kind, scope, period)` function using `insert ... on conflict do update ... returning`. The counter row is locked inside the caller's transaction, so numbers have no gaps on commit and roll back cleanly. A `sequence` would leave gaps.
  - Add `invoices.invoice_no`, `payments.receipt_no`, and partial unique indexes.
  - Assign numbers only inside the RPCs (section F).
- Verified: yes

### [DB-10] Recurring invoice and payslip generation checks then inserts in the browser, with no unique period key
- Severity: Medium
- Effort: M
- Location: src/pages/Fees.jsx:197-217; src/pages/Payslips.jsx:200-221
- Evidence:
  - The code builds `existingIds` from the invoices loaded in the browser, then `addDoc`s in a loop.
  - `month` and `year` live in `extra` (see the jsonb table), so the database cannot index or constrain them.
  - Payslip generation works the same way.
- Impact:
  - Two staff (or two tabs) generating the same month both insert. Parents are billed twice.
  - Combined with DB-5, the duplicate check itself is incomplete past 1000 rows.
- Fix:
  - Promote `invoices.month/year` and `payslips.year` to columns.
  - Add `invoices.kind`.
  - Add the unique indexes `invoices(student_id, year, month) where kind='recurring' and deleted_at is null` and `payslips(employee_id, year, month) where deleted_at is null`.
  - Replace the loop with `generate_recurring_invoices(year, month)` using `on conflict do nothing` (section F).
- Verified: yes (traced. Race not executed.)

### [DB-11] The document-in-table shim keeps money and query keys in untyped jsonb
- Severity: Medium
- Effort: M
- Location: src/firebase.js:45-83; supabase/schema.sql:75-82, :136-146
- Evidence:
  - 29 app fields go into `extra` (see the jsonb table), including every payroll amount (`basicSalary`, `allowances`, `deductions`, `netPay`) and `employees.salary`.
  - Form values arrive as strings (`Payslips.jsx:18`: `basicSalary: ""`), so jsonb holds a mix of `"25000"` and `25000`.
  - `payslips.amount` and `invoices.date` exist as columns but nothing writes them.
  - `Reports.jsx:37` sums `p.netPay` from jsonb.
- Impact:
  - No CHECK, type or NOT NULL can protect payroll.
  - Payroll totals cannot be computed or indexed in SQL.
  - Typos in field names (`netpay` vs `netPay`) silently create new keys.
- Fix:
  - Promote these fields to typed columns, named as the snake_case of the app key so the shim maps them automatically: `invoices.month/year/kind`, `payslips.year/net_pay/basic_salary/allowances/deductions`, `employees.salary/role/phone/email/recurring_payslip`.
  - Backfill from `extra` and strip the keys (section C2).
  - Update `COLUMNS` in `firebase.js` in the same release, then run the backfill again to catch rows written in between.
  - Have `encode()` warn in development when a key goes to `extra`.
- Verified: yes

### [DB-12] `updateDoc` overwrites the whole `extra` object; `updateDocs` merges with a lost-update race
- Severity: Medium
- Effort: S
- Location: src/firebase.js:220-224, :303-322
- Evidence:
  - `updateDoc` calls `encode()`, which builds `row.extra = {only the keys in this call}` and sends `update(row)`. Any other `extra` keys are wiped.
  - It is masked today because most edit forms resend every extra key (Employees, custom roles). Any partial update that touches one jsonb field would lose the rest. Example: a future `updateDoc(invoice, { notes })` would erase `studentName`, `lineItems`, `month` and `year`.
  - `updateDocs` does read, merge in the browser, then write. Two concurrent bulk edits lose one side.
- Impact: Silent data loss on invoices and payslips, which are the tables with the most jsonb.
- Fix:
  - Add an RPC `patch_extra(table, id, patch jsonb)` that does `update ... set extra = coalesce(extra,'{}') || patch` on the server. It must use a fixed table allow-list and be `SECURITY INVOKER` so RLS applies.
  - Use it from both `updateDoc` and `updateDocs` whenever `extra` keys are present.
  - Promoting columns (DB-11) shrinks the problem.
- Verified: yes (traced. No data loss observed today.)

### [DB-13] Soft delete bypasses delete permissions, and Trash can permanently erase ledger rows and restore inconsistent state
- Severity: Medium
- Effort: M
- Location:
  - src/firebase.js:226-261
  - supabase/security.sql:147-153, :219-221, :257-260
  - src/pages/Trash.jsx:53-103
  - src/App.js:186-190
  - src/pages/Fees.jsx:313-322
- Evidence:
  - **Soft delete is just an UPDATE.** `deleteDoc` is `update({deleted_at})`, so only the `*_update` policy (`canEdit*`) applies. `branch_manager` has `canEditStudents` but `canDeleteStudents:false`, and can still trash students.
  - **Trash is open to everyone.** The route is only wrapped in `PrivateRoute`, with no admin check.
  - **Hard delete of ledger rows.** `payments_delete` only needs `canEditPayments` (which `branch_manager` has), and `journals_write` is `for all`. These roles can "Delete forever" or "Empty trash" on payments and journals, permanently removing ledger rows and reversal pairs.
  - **Restore is inconsistent.** Trashing an invoice reverses its payments (`Fees.jsx:317`). `restoreDoc` only clears `deleted_at`, so the invoice comes back `status:'paid'` with its money reversed.
  - **Unique keys ignore trash.** The branch unique constraint (DB-7) covers trashed rows too.
  - **No audit or retention.** There is no `deleted_by` and no Trash retention or purge.
- Impact:
  - The delete permissions mean nothing.
  - Accounting history can be destroyed by non-admins.
  - Restored invoices misstate receivables.
- Fix:
  - Add a trigger `guard_soft_delete(perm)` on `deleted_at` changes (section E).
  - Restrict hard DELETE on `payments`, `journals` and `invoices` to admins, or block it entirely for posted rows.
  - Add a `restore_invoice` RPC that recomputes `paid_amount`/`status` from live payments.
  - Add `deleted_by uuid default auth.uid()`.
  - Make every unique index partial (`where deleted_at is null`).
- Verified: yes

### [DB-14] Dates and periods are free text in mixed formats; `created_at` comes from the browser
- Severity: Medium
- Effort: M
- Location: supabase/schema.sql:65, :93-94, :110, :125, :141-142, :167; src/pages/Fees.jsx:184; src/firebase.js:76
- Evidence:
  - `dob`, `due_date`, `date`, `paid_date` and `month` are all `text`.
  - `handleBulkReceive` writes `paidDate: serverTimestamp()`, which is the full ISO timestamp from the browser clock. Other paths write `YYYY-MM-DD`.
  - Expense and payment range filters compare strings (`Expenses.jsx:66-67`).
  - Payslip `month` is an English month name.
  - `createdAt: serverTimestamp()` is the browser clock and overrides the column default.
- Impact:
  - Date filters and sorting break on mixed formats.
  - Malformed dates are accepted.
  - The "keep oldest" logic in the fix scripts and invoice ordering trust the browser clock.
- Fix:
  - Add typed `date` columns: backfill with `to_date` behind a regex guard, then swap.
  - Add `CHECK (due_date >= issue_date)`.
  - Store the period as `smallint month check (month between 1 and 12)`.
  - Add a `BEFORE INSERT` trigger forcing `created_at = now()`.
  - In the meantime, add CHECKs that the text matches `^\d{4}-\d{2}-\d{2}$` (`NOT VALID`).
- Verified: yes

### [DB-15] `users.role` defaults to `'admin'` and is not validated
- Severity: Medium
- Effort: S
- Location: supabase/schema.sql:30; supabase/functions/create-user/index.ts:55-74; src/context/UserContext.jsx:139-158
- Evidence:
  - `role text default 'admin'`.
  - The edge function inserts `role` straight from the request body. If `role` is missing, the JSON omits it, the default applies, and the new user is an **admin**.
  - Nothing checks that `role` is one of the 4 built-in roles or an existing `custom_roles.id`.
  - Deleting a custom role in use is only blocked in the browser (`Users.jsx:202`).
- Impact:
  - A malformed create-user call creates an admin.
  - A typo in a role leaves a user with no permissions in the database, while the browser falls back to admin-shaped UI (`UserContext.jsx:188`).
- Fix:
  - Change the default to `'none'`.
  - Add a trigger that validates the role against built-ins and `custom_roles`.
  - Add a trigger on `custom_roles` that blocks deleting a role still in use.
  - Make the edge function reject a missing or unknown role.
- Verified: yes

### [DB-16] Creating a custom role always fails (text primary key with no default, and no id sent)
- Severity: Medium
- Effort: S
- Location: supabase/schema.sql:182-188; src/pages/Users.jsx:172-184
- Evidence:
  - `custom_roles.id text primary key` has no default.
  - `handleSaveCustomRole` builds `roleId` and then never uses it. It calls `addDoc(collection(db,"customRoles"), {...customRole})`, and `encode()` drops `id` (`firebase.js:75`).
  - The insert therefore violates NOT NULL on `id`.
  - The call is not wrapped in try/catch, so the user sees nothing.
- Impact: The custom-roles feature cannot create roles on Supabase. Only roles carried over from the Firestore migration exist.
- Fix:
  - Use `setDoc(doc(db,"customRoles", roleId), {...})`, or give the column a default (`default gen_random_uuid()::text`).
  - Add a `check (id ~ '^[a-z0-9_]+$')`.
- Verified: yes (traced. Not executed.)

### [DB-17] Empty strings and formatted numbers are sent to numeric columns
- Severity: Medium
- Effort: S
- Location: src/pages/Students.jsx:17, :307; src/pages/Import.jsx:195, :28; src/firebase.js:70-83
- Evidence:
  - `emptyStudent.monthlyFee = ""` and the field is optional. `encode()` passes `""` to `monthly_fee numeric`.
  - Import maps spreadsheet cells with `String(...).trim()`, so `"5,000.00"` or `"Rs 5000"` go straight to numeric columns.
- Impact:
  - Saving a student without a fee, or importing formatted amounts, probably fails with `22P02 invalid input syntax for type numeric`. Each row in a 500-row import fails separately.
  - Without CHECKs, values that do parse but are negative are accepted.
- Fix:
  - In `encode()`, coerce `""` to `null` for numeric and date columns. This needs a small column-type map next to `COLUMNS`.
  - Strip thousands separators in Import.
  - Add `CHECK (... >= 0)`.
- Verified: no (PostgREST casting behaviour inferred. Not executed.)

### [DB-18] Migrations are unordered and unversioned, and the README's setup steps produce a broken database
- Severity: Medium
- Effort: M
- Location: README.md "Backend setup"; supabase/*.sql; supabase/realtime.sql:27-32
- Evidence:
  - The README tells operators to run only `schema.sql` and `security.sql`.
  - The shim filters every soft-delete table with `deleted_at is null` (`firebase.js:189-192`) and writes `source`/`source_id`/`reversed`/`paid_amount` (from `accounting.sql`). On a database built from the README, every list query fails and every payment insert fails.
  - There is no `supabase/migrations/`, no record of which scripts ran, and the scripts have hidden dependencies (`fix_duplicate_accounts` needs `trash`).
  - `realtime.sql` swallows every error (`when others then null`).
  - `create table if not exists` never changes columns, so schema drift is invisible.
- Impact:
  - A fresh environment or disaster-recovery rebuild does not match production.
  - There is no reliable way to know what production contains, which is exactly how DB-1 happens.
- Fix: Adopt Supabase CLI migrations as laid out in "Proposed migrations layout", with a baseline pulled from production.
- Verified: yes

### [DB-19] Realtime publishes every table with full replica identity
- Severity: Low
- Effort: S
- Location: supabase/realtime.sql:15-34; src/firebase.js:464-513
- Evidence:
  - All 13 tables are in `supabase_realtime`, including `audit_log`, `users` (which has the `pin` column) and `custom_roles`.
  - All use `REPLICA IDENTITY FULL`.
  - The script's own reason ("delete can arrive without an id") is wrong. The default replica identity already includes the primary key.
  - The app uses soft delete (an UPDATE) almost everywhere.
  - Every `onSnapshot` opens an unfiltered, table-wide channel (Fees opens 3).
- Impact:
  - FULL writes the entire old row, including the jsonb `extra`, to the write-ahead log on every UPDATE. That bloats the log and raises Realtime CPU for no benefit.
  - With RLS on, Supabase does not apply RLS to DELETE events and sends only the primary key. Every subscriber therefore receives the ids of hard-deleted rows from any published table (users, emptied trash). That is a small metadata leak.
- Fix:
  - Return to `replica identity default`.
  - Drop `audit_log`, `reminder_logs` and `custom_roles` from the publication, or keep `custom_roles` only if live role edits matter.
  - Move `users.pin` to a separate table that is not published (section H).
  - Filter channels by `branch_id` where possible.
- Verified: no (Realtime RLS and DELETE behaviour taken from Supabase documentation. Not tested.)

### [DB-20] Indexes don't match the actual filters, RLS, or ledger lookups
- Severity: Medium
- Effort: S
- Location: supabase/trash.sql:27; supabase/accounting.sql:20
- Evidence:
  - The only secondary indexes are 10 single-column `deleted_at` btrees and `idx_payments_source(source, source_id)`.
  - The `deleted_at` btrees do not help: nearly all rows are NULL and the filter is `IS NULL`.
  - There are no indexes on `branch_id` (used by every RLS policy), `invoices.student_id`, `invoices(status, due_date)` (reminders and overdue), `payments.account` (balances), `payslips.employee_id`, `reminder_logs.timestamp` (`ReminderLogs.jsx:19` orders by it), or `audit_log.created_at` (`ActivityLog.jsx:71`).
- Impact: Every RLS-filtered read and every server-side aggregate proposed in DB-5 scans the whole table.
- Fix: Use partial indexes `where deleted_at is null` that match the rewritten policy expressions (section D), and drop the single-column `deleted_at` indexes.
- Verified: yes (by schema reading. No EXPLAIN available.)

### [DB-21] The ledger can be edited: posted payments and journals can be updated or deleted, and journals are free text
- Severity: Medium
- Effort: M
- Location:
  - supabase/accounting.sql:1-12 (stated intent)
  - supabase/security.sql:215-221, :257-260
  - src/pages/Payments.jsx:108-146, :335-340
  - src/pages/Journals.jsx:12, :32-40
- Evidence:
  - `accounting.sql` says "never silently mutate the ledger", but nothing in the database enforces it.
  - Payments bulk edit can change `account` and `date` on posted rows.
  - `Payments.handleDelete` soft-deletes without posting a reversal.
  - Journals store `debit_account`/`credit_account` as free-text names, with no FK, no `amount > 0` check, and no balancing (single-line entries only).
- Impact: Balances can be changed with no reversal trail. This is the reconciliation problem that `accounting.sql` set out to prevent.
- Fix:
  - Add a `guard_payment_update` trigger (section G) that allows only `reversed` false→true and description edits.
  - Block soft delete of unreversed payments, and route deletes through `reverse_source_payments`.
  - Change journals to a header/lines model with a deferred balancing constraint (the accounting auditor may give more detail).
- Verified: yes

### [DB-22] The audit log is written by the browser, can be forged, and grows without limit
- Severity: Low
- Effort: S
- Location: supabase/security.sql:341-347; src/utils/auditLog.js:41-54
- Evidence:
  - `audit_insert ... with check (true)`.
  - The `user` and `timestamp` values come from the browser (`user: email || "unknown"`).
  - Logging is fire-and-forget and only covers actions the UI chooses to log.
  - There are no server-side triggers and no retention rule.
- Impact:
  - Any signed-in user can insert entries attributed to someone else, or perform actions through the API without logging them.
  - The table grows without bound.
- Fix:
  - Add a `BEFORE INSERT` trigger that stamps `user` from `auth.jwt()->>'email'` and sets `timestamp = now()`.
  - Add a generic `row_history` trigger on the financial tables (section G).
  - Add a retention job, `pg_cron` deleting rows older than N years, sized to your statutory record-keeping period.
- Verified: yes

### [DB-23] No documented backups, PITR, restore drill or retention policy
- Severity: Medium
- Effort: S
- Location: README.md (no mention); src/firebase.js:256-261 (`emptyTrash`); src/lib/storage.js:3-20
- Evidence:
  - The repository has no mention of plan tier, daily backups, PITR, `pg_dump` or a restore test.
  - "Empty trash" deletes permanently.
  - Receipt photos go to a *public* bucket with no lifecycle rule.
- Impact:
  - A mistaken "Empty trash" on payments, or a bad bulk edit, cannot be undone without PITR.
  - On the Free tier there may be no restorable backup at all.
- Fix:
  - Use Pro tier with PITR for a financial system.
  - Add a nightly `supabase db dump` (schema + data) to encrypted off-site storage from CI.
  - Run a restore drill each quarter into a branch project.
  - Write down retention for `audit_log`, Trash (for example, auto-purge non-financial trash after 90 days and never hard-delete financial rows) and the receipts bucket.
- Verified: no (project plan and settings not visible)

### [DB-24] No seed data and no academic-year model or rollover
- Severity: Medium
- Effort: L
- Location: supabase/ (no seed.sql); supabase/schema.sql:54-70; src/pages/Fees.jsx:197-217
- Evidence:
  - The chart of accounts and branches are created by hand or by Import (the source of DB-7).
  - "Main" is a sentinel string, not a row.
  - There is no `academic_years` table.
  - `students.grade` is free text with no history.
  - Invoices carry a calendar `year` and an English `month` in jsonb, and do not record the grade at billing time.
  - Year-end promotion means bulk-editing `grade`, which overwrites history.
  - Fee amounts are per student (`monthly_fee`), with no per-grade fee structure.
- Impact:
  - Last year's class lists and grade-level reports cannot be reproduced.
  - Each new environment starts with an inconsistent chart of accounts.
- Fix:
  - Add an idempotent `supabase/seed.sql` for the chart of accounts and the Main branch.
  - Add `academic_years` and `enrollments(student_id, academic_year_id, grade, section, branch_id)` with `unique(student_id, academic_year_id)`.
  - Add `invoices.academic_year_id`.
  - Add a `promote_students(from_year, to_year, grade_map)` RPC (section I).
- Verified: yes

### [DB-25] `public.current_role()` shadows the SQL keyword, and helper RPCs are callable by anon
- Severity: Low
- Effort: S
- Location: supabase/security.sql:19-25, :116-117
- Evidence:
  - `CURRENT_ROLE` is a reserved SQL keyword that returns the Postgres role.
  - `public.current_role()` only works when schema-qualified. A future policy written as `current_role = 'admin'` would compare against `'authenticated'` and silently return false.
  - Functions get `EXECUTE` for `PUBLIC` by default, and the script only adds a grant for `authenticated`. So `anon` can call `/rpc/has_perm` and the other helpers.
- Impact: Maintenance trap and a small API surface. Not exploitable today.
- Fix:
  - Rename to `app_role()`, keeping a wrapper during the transition.
  - Run `revoke execute on function ... from public, anon` for every helper and RPC.
- Verified: yes

### [DB-26] Per-user permission overrides in Access Overview are not enforced by RLS
- Severity: Low
- Effort: M
- Location: src/pages/AccessOverview.jsx:73-85; src/context/UserContext.jsx:192-196; supabase/security.sql:46-92
- Evidence:
  - Overrides are stored in `users.extra.pagePermissions` and merged only in the browser.
  - `has_perm` reads the role only.
  - `users_update` lets users update their own row, including `extra`, and the guard trigger only protects `role`/`branch_id`.
- Impact:
  - Overrides that grant access show pages whose queries RLS then rejects, which looks like a broken app.
  - Overrides that revoke access hide UI but leave API access intact.
  - Users can edit their own overrides (UI only).
- Fix:
  - Move overrides to a typed `user_permission_overrides(user_id, perm, allowed)` table that only admins can write.
  - Have `has_perm` check it first.
  - Alternatively, drop the feature.
- Verified: yes

---

## Proposed migrations layout

There is no migrations folder today. Proposed structure:

```
supabase/
  config.toml                         # supabase init
  migrations/
    20261005000000_baseline.sql       # from `supabase db pull` on prod, minus the "auth all" block (DB-1)
    20261005000100_dedupe_branches_accounts.sql   # section B
    20261005000200_constraints_not_valid.sql      # section C
    20261005000250_promote_jsonb_columns.sql      # section C2 (ship with shim COLUMNS change)
    20261005000300_indexes.sql                    # section D
    20261005000400_rls_initplan.sql               # section E
    20261005000500_money_rpcs.sql                 # section F
    20261005000600_ledger_guards_audit.sql        # section G
    20261005000700_realtime_scope.sql             # section H
    20261005000800_academic_years.sql             # section I
    20261012000000_validate_constraints.sql       # after cleanup: ALTER ... VALIDATE CONSTRAINT
  seed.sql                                        # section J (idempotent)
  tests/                                          # pgTAP: RLS per role, RPC invariants
  legacy/                                         # old schema/security/... scripts + README "do not run"
  functions/create-user/
```

Process:
1. Run `supabase db pull`, then `supabase migration repair --status applied 20261005000000` so production does not re-run the baseline.
2. From then on, only `supabase db push` from CI. Nobody pastes SQL into the editor.
3. CI runs `supabase start && supabase db reset && supabase test db && supabase db lint`. It also fails the build if any business-table policy has `qual='true'`.
4. One migration per change. No "safe to re-run" scripts.
5. For large tables, create indexes `CONCURRENTLY` in their own migration, which cannot run inside a transaction. At today's sizes, plain `create index` is fine.

---

## Ready-to-review SQL (NOT applied, NOT executed)

> Run on a local `supabase start` or a branch database first. Section order matches the migration order above. Every section assumes `trash.sql` and `accounting.sql` are already applied in production.

### A. Pre-flight checks (read-only)

```sql
-- A1. Is any table wide open? (DB-1)
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true')
  and tablename not in ('branches','custom_roles','audit_log');

-- A2. Duplicates on natural keys (live rows)
select lower(btrim(name)) k, count(*) from public.branches where deleted_at is null group by 1 having count(*) > 1;
select lower(btrim(code)) k, count(*) from public.accounts where deleted_at is null and coalesce(btrim(code),'') <> '' group by 1 having count(*) > 1;
select lower(btrim(name)) k, count(*) from public.accounts where deleted_at is null group by 1 having count(*) > 1;
select lower(btrim(student_id)) k, count(*) from public.students where deleted_at is null and coalesce(btrim(student_id),'') <> '' group by 1 having count(*) > 1;
select student_id, extra->>'year' y, extra->>'month' m, count(*)
from public.invoices where deleted_at is null group by 1,2,3 having count(*) > 1;

-- A3. Orphans (text references)
select 'invoices->students' rel, count(*) from public.invoices i
 where not exists (select 1 from public.students s where s.id::text = i.student_id)
union all
select 'payslips->employees', count(*) from public.payslips p
 where not exists (select 1 from public.employees e where e.id::text = p.employee_id)
union all
select 'payments->accounts(name)', count(*) from public.payments p
 where not exists (select 1 from public.accounts a where a.name = p.account and a.deleted_at is null)
union all
select 'users->branches', count(*) from public.users u
 where coalesce(u.branch_id,'') not in ('','main')
   and not exists (select 1 from public.branches b where b.id::text = u.branch_id and b.deleted_at is null)
union all
select 'users->roles', count(*) from public.users u
 where u.role not in ('admin','branch_manager','accountant','fee_collector')
   and not exists (select 1 from public.custom_roles r where r.id = u.role);
-- repeat 'X->branches' for students, employees, invoices, expenses, payments, payslips

-- A4. Value checks
select count(*) filter (where amount < 0) neg_amount,
       count(*) filter (where coalesce(paid_amount,0) + coalesce(concession_amount,0) > amount + 0.01) overpaid,
       count(*) filter (where status not in ('pending','partial','paid')) bad_status
from public.invoices;
select type, count(*) from public.payments group by 1;
select count(*) from public.invoices where paid_date is not null and paid_date !~ '^\d{4}-\d{2}-\d{2}$';

-- A5. Ledger vs invoice drift (DB-3 / DB-4)
with ledger as (
  select source_id, sum(case when type = 'cash_in' then amount else -amount end) net
  from public.payments
  where source = 'invoice' and deleted_at is null and not coalesce(reversed,false) and reversal_of is null
  group by 1)
select i.id, i.status, i.amount, i.paid_amount, coalesce(l.net,0) ledger_net
from public.invoices i left join ledger l on l.source_id = i.id::text
where i.deleted_at is null
  and (abs(coalesce(i.paid_amount,0) - coalesce(l.net,0)) > 0.01
       or (i.status = 'paid' and l.net is null));
```

### B. Dedupe branches and accounts (replaces both `fix_duplicate_*.sql`)

```sql
begin;

-- B1. Branches: keeper = oldest LIVE row per normalised name
create temp table branch_map on commit drop as
select b.id::text as dup_id, k.keeper_id::text as keeper_id
from public.branches b
join (
  select distinct on (lower(btrim(name))) lower(btrim(name)) nk, id as keeper_id
  from public.branches where deleted_at is null
  order by lower(btrim(name)), created_at, id
) k on k.nk = lower(btrim(b.name))
where b.deleted_at is null and b.id <> k.keeper_id;

do $$
declare t text;
begin
  foreach t in array array['students','employees','invoices','expenses','payments','payslips','users'] loop
    execute format('update public.%I x set branch_id = m.keeper_id from branch_map m where x.branch_id = m.dup_id', t);
  end loop;
end $$;

update public.branches b set deleted_at = now()
from branch_map m where b.id::text = m.dup_id;

alter table public.branches drop constraint if exists branches_name_unique;
create unique index if not exists branches_name_live_uq
  on public.branches (lower(btrim(name))) where deleted_at is null;

-- B2. Accounts: payments reference by NAME, so dedupe by normalised name.
-- Keeper = oldest live row; renormalise payment.account to keeper's exact name.
create temp table account_map on commit drop as
select a.id, a.name as dup_name, k.keeper_name
from public.accounts a
join (
  select distinct on (lower(btrim(name))) lower(btrim(name)) nk, id keeper_id, name keeper_name
  from public.accounts where deleted_at is null
  order by lower(btrim(name)), created_at, id
) k on k.nk = lower(btrim(a.name))
where a.deleted_at is null and a.id <> k.keeper_id;

update public.payments p set account = m.keeper_name
from account_map m where p.account = m.dup_name and p.account <> m.keeper_name;
update public.invoices x set paid_account = m.keeper_name from account_map m where x.paid_account = m.dup_name;
update public.payslips x set paid_account = m.keeper_name from account_map m where x.paid_account = m.dup_name;
update public.expenses x set paid_account = m.keeper_name from account_map m where x.paid_account = m.dup_name;
update public.accounts a set deleted_at = now() from account_map m where a.id = m.id;

create unique index if not exists accounts_name_live_uq
  on public.accounts (lower(btrim(name))) where deleted_at is null;
create unique index if not exists accounts_code_live_uq
  on public.accounts (lower(btrim(code))) where deleted_at is null and coalesce(btrim(code),'') <> '';

commit;
-- NOTE: if two duplicate accounts had different opening `balance`, decide manually
-- BEFORE running B2 (the keeper's balance wins).
```

### C. Constraints (add NOT VALID now, VALIDATE after cleanup)

```sql
-- money
alter table public.invoices  add constraint invoices_amount_nonneg   check (amount >= 0) not valid;
alter table public.invoices  add constraint invoices_paid_nonneg     check (coalesce(paid_amount,0) >= 0 and coalesce(concession_amount,0) >= 0) not valid;
alter table public.invoices  add constraint invoices_not_overpaid    check (coalesce(paid_amount,0) + coalesce(concession_amount,0) <= amount + 0.01) not valid;
alter table public.payments  add constraint payments_amount_pos      check (amount > 0) not valid;
alter table public.expenses  add constraint expenses_amount_nonneg   check (amount >= 0) not valid;
alter table public.payslips  add constraint payslips_amount_nonneg   check (amount is null or amount >= 0) not valid;
alter table public.students  add constraint students_fee_nonneg      check (monthly_fee is null or monthly_fee >= 0) not valid;
alter table public.journals  add constraint journals_amount_pos      check (amount > 0) not valid;
alter table public.journals  add constraint journals_dr_ne_cr        check (debit_account <> credit_account) not valid;

-- enums
alter table public.invoices add constraint invoices_status_chk check (status in ('pending','partial','paid','void')) not valid;
alter table public.payslips add constraint payslips_status_chk check (status in ('pending','paid')) not valid;
alter table public.payments add constraint payments_type_chk   check (type in ('cash_in','cash_out')) not valid;
alter table public.payments add constraint payments_source_chk check (source in ('','invoice','payslip','expense','transfer')) not valid;
alter table public.accounts add constraint accounts_type_chk   check (type in ('Assets','Liabilities','Equity','Income','Expenses')) not valid;
alter table public.payments add constraint payments_not_self_reversal check (reversal_of is null or reversal_of <> id::text) not valid;

-- text dates must at least be ISO dates until converted to `date` (DB-14)
alter table public.invoices add constraint invoices_due_date_iso check (due_date is null or due_date = '' or due_date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.payments add constraint payments_date_iso     check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.expenses add constraint expenses_date_iso     check (date is null or date = '' or date ~ '^\d{4}-\d{2}-\d{2}$') not valid;

-- NOT NULL on business keys (run after A3/A4 are clean)
-- alter table public.invoices alter column amount set not null, alter column student_id set not null, alter column status set not null;
-- alter table public.payments alter column amount set not null, alter column type set not null, alter column account set not null;

-- natural keys (live rows only, case-insensitive) — in addition to B
create unique index if not exists students_admission_no_live_uq
  on public.students (lower(btrim(student_id))) where deleted_at is null and coalesce(btrim(student_id),'') <> '';
create unique index if not exists payments_one_reversal_uq
  on public.payments (reversal_of) where reversal_of is not null and deleted_at is null;

-- idempotency + document numbers (DB-3, DB-9)
alter table public.payments add column if not exists idempotency_key uuid;
alter table public.payments add column if not exists receipt_no text;
alter table public.invoices add column if not exists invoice_no text;
create unique index if not exists payments_idem_uq      on public.payments (idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_receipt_no_uq on public.payments (receipt_no) where receipt_no is not null;
create unique index if not exists invoices_invoice_no_uq on public.invoices (invoice_no) where invoice_no is not null;

-- roles (DB-15)
alter table public.users alter column role set default 'none';
create or replace function public.validate_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role not in ('none','admin','branch_manager','accountant','fee_collector')
     and not exists (select 1 from public.custom_roles where id = new.role) then
    raise exception 'Unknown role %', new.role using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_users_role_valid on public.users;
create trigger trg_users_role_valid before insert or update of role on public.users
  for each row execute function public.validate_user_role();

create or replace function public.block_role_delete_in_use() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.users where role = old.id) then
    raise exception 'Role % is assigned to users', old.id using errcode = '23503';
  end if;
  return old;
end $$;
drop trigger if exists trg_custom_roles_in_use on public.custom_roles;
create trigger trg_custom_roles_in_use before delete on public.custom_roles
  for each row execute function public.block_role_delete_in_use();

-- custom_roles id (DB-16) — either fix the app (setDoc with roleId) or:
alter table public.custom_roles alter column id set default ('role_' || replace(gen_random_uuid()::text,'-',''));

-- created_at is server time, not client time (DB-14)
create or replace function public.force_created_at() returns trigger language plpgsql as $$
begin new.created_at := now(); return new; end $$;
-- attach per table: create trigger trg_<t>_created before insert on public.<t> for each row execute function public.force_created_at();

-- Later migration, after A-queries return 0:
-- alter table public.invoices validate constraint invoices_amount_nonneg;  (repeat for each)
```

### C2. Promote the important jsonb fields to columns (ship together with the shim `COLUMNS` update)

```sql
alter table public.invoices
  add column if not exists month text,
  add column if not exists year  int,
  add column if not exists kind  text not null default 'adhoc' check (kind in ('adhoc','recurring','import'));
alter table public.payslips
  add column if not exists year int,
  add column if not exists net_pay numeric(14,2),
  add column if not exists basic_salary numeric(14,2),
  add column if not exists allowances numeric(14,2),
  add column if not exists deductions numeric(14,2);
alter table public.employees
  add column if not exists salary numeric(14,2),
  add column if not exists role text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists recurring_payslip boolean not null default false;

-- backfill (guarded casts); run again after the app release
update public.invoices set
  month = coalesce(month, nullif(extra->>'month','')),
  year  = coalesce(year, case when extra->>'year' ~ '^\d{4}$' then (extra->>'year')::int end),
  extra = extra - 'month' - 'year'
where extra ?| array['month','year'];

update public.payslips set
  year         = coalesce(year, case when extra->>'year' ~ '^\d{4}$' then (extra->>'year')::int end),
  net_pay      = coalesce(net_pay,      case when extra->>'netPay'      ~ '^-?\d+(\.\d+)?$' then (extra->>'netPay')::numeric end),
  basic_salary = coalesce(basic_salary, case when extra->>'basicSalary' ~ '^-?\d+(\.\d+)?$' then (extra->>'basicSalary')::numeric end),
  allowances   = coalesce(allowances,   case when extra->>'allowances'  ~ '^-?\d+(\.\d+)?$' then (extra->>'allowances')::numeric end),
  deductions   = coalesce(deductions,   case when extra->>'deductions'  ~ '^-?\d+(\.\d+)?$' then (extra->>'deductions')::numeric end),
  extra = extra - 'year' - 'netPay' - 'basicSalary' - 'allowances' - 'deductions'
where extra ?| array['year','netPay','basicSalary','allowances','deductions'];

update public.employees set
  salary = coalesce(salary, case when extra->>'salary' ~ '^\d+(\.\d+)?$' then (extra->>'salary')::numeric end),
  role   = coalesce(role, extra->>'role'),
  phone  = coalesce(phone, extra->>'phone'),
  email  = coalesce(email, extra->>'email'),
  recurring_payslip = coalesce((extra->>'recurringPayslip')::boolean, recurring_payslip),
  extra = extra - 'salary' - 'role' - 'phone' - 'email' - 'recurringPayslip'
where extra ?| array['salary','role','phone','email','recurringPayslip'];

-- mark historical single-line "Tuition Fee" invoices as recurring so the unique index protects them
update public.invoices set kind = 'recurring'
where kind = 'adhoc'
  and jsonb_typeof(extra->'lineItems') = 'array' and jsonb_array_length(extra->'lineItems') = 1
  and extra->'lineItems'->0->>'description' = 'Tuition Fee';

-- after deduping A2's invoice query:
create unique index if not exists invoices_recurring_period_uq
  on public.invoices (student_id, year, month) where kind = 'recurring' and deleted_at is null;
create unique index if not exists payslips_period_uq
  on public.payslips (employee_id, year, month) where deleted_at is null;

alter table public.payslips add constraint payslips_net_pay_nonneg check (net_pay is null or net_pay >= 0) not valid;
alter table public.employees add constraint employees_salary_nonneg check (salary is null or salary >= 0) not valid;
```

Matching `src/firebase.js` `COLUMNS` additions:
- `invoices`: `"month","year","kind","invoice_no"`
- `payslips`: `"year","net_pay","basic_salary","allowances","deductions"`
- `employees`: `"salary","role","phone","email","recurring_payslip"`
- `payments`: `"idempotency_key","receipt_no"`

### D. Indexes (partial on live rows, matching the rewritten policies)

```sql
-- branch scope key used by RLS (must match the expression in section E exactly)
create index if not exists students_branch_key_idx  on public.students  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists employees_branch_key_idx on public.employees ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists invoices_branch_key_idx  on public.invoices  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;
create index if not exists expenses_branch_key_idx  on public.expenses  ((coalesce(nullif(branch_id,'main'),'')), date) where deleted_at is null;
create index if not exists payments_branch_key_idx  on public.payments  ((coalesce(nullif(branch_id,'main'),'')), date) where deleted_at is null;
create index if not exists payslips_branch_key_idx  on public.payslips  ((coalesce(nullif(branch_id,'main'),''))) where deleted_at is null;

-- foreign-key-like lookups
create index if not exists invoices_student_idx        on public.invoices (student_id) where deleted_at is null;
create index if not exists invoices_status_due_idx     on public.invoices (status, due_date) where deleted_at is null;
create index if not exists invoices_period_idx         on public.invoices (year, month) where deleted_at is null;
create index if not exists payslips_employee_idx       on public.payslips (employee_id) where deleted_at is null;
create index if not exists payments_account_date_idx   on public.payments (account, date) where deleted_at is null;
create index if not exists payments_source_live_idx    on public.payments (source, source_id) where deleted_at is null;
drop index if exists public.idx_payments_source;

-- ordered feeds
create index if not exists reminder_logs_ts_idx on public.reminder_logs (timestamp desc) where deleted_at is null;
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- Trash view: small partial indexes instead of the 10 low-selectivity btrees
do $$
declare t text;
begin
  foreach t in array array['students','employees','invoices','expenses','payments','payslips','accounts','journals','branches','reminder_logs'] loop
    execute format('drop index if exists public.idx_%1$s_deleted_at', t);
    execute format('create index if not exists %1$s_trashed_idx on public.%1$I (deleted_at desc) where deleted_at is not null', t);
  end loop;
end $$;
```

### E. RLS rewrite: helpers evaluated once per statement, plus soft-delete permission guard

```sql
create or replace function public.sees_all_branches() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role() = 'admin' or public.has_perm('canViewAllBranches')
$$;

create or replace function public.my_branch_key() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select branch_id from public.users where id = auth.uid()), 'main'), '')
$$;

revoke execute on function public.current_role(), public.current_branch(), public.is_admin(),
  public.has_perm(text), public.branch_visible(text), public.sees_all_branches(), public.my_branch_key()
  from public, anon;
grant execute on function public.current_role(), public.current_branch(), public.is_admin(),
  public.has_perm(text), public.branch_visible(text), public.sees_all_branches(), public.my_branch_key()
  to authenticated;

-- Branch-scoped tables. Each (select fn()) becomes a one-time InitPlan; the row-side
-- expression matches the indexes in section D.
do $$
declare r record;
  scope text := $s$((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))$s$;
begin
  for r in select * from (values
      ('students',  'canViewStudents',  'canEditStudents',  'canDeleteStudents'),
      ('employees', 'canViewEmployees', 'canEditEmployees', 'canDeleteEmployees'),
      ('invoices',  'canViewFees',      'canEditFees',      'canEditFees'),
      ('expenses',  'canViewExpenses',  'canEditExpenses',  'canDeleteExpenses'),
      ('payments',  'canViewPayments',  'canEditPayments',  NULL),            -- hard delete: admin only
      ('payslips',  'canViewPayslips',  'canEditPayslips',  'canEditPayslips')
    ) v(t, pv, pe, pd)
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', r.t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select public.has_perm(%2$L)) and %3$s)', r.t, r.pv, scope);
    execute format('drop policy if exists %1$s_insert on public.%1$I', r.t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select public.has_perm(%2$L)) and %3$s)', r.t, r.pe, scope);
    execute format('drop policy if exists %1$s_update on public.%1$I', r.t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select public.has_perm(%2$L)) and %3$s) with check ((select public.has_perm(%2$L)) and %3$s)', r.t, r.pe, scope);
    execute format('drop policy if exists %1$s_delete on public.%1$I', r.t);
    if r.pd is null then
      execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select public.is_admin()))', r.t);
    else
      execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select public.has_perm(%2$L)) and %3$s)', r.t, r.pd, scope);
    end if;
  end loop;
end $$;

-- Non-branch tables: same wrapping
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated using ((select public.has_perm('canViewAccounting')));
drop policy if exists accounts_write on public.accounts;
create policy accounts_insert on public.accounts for insert to authenticated with check ((select public.has_perm('canEditAccounting')));
create policy accounts_update on public.accounts for update to authenticated using ((select public.has_perm('canEditAccounting'))) with check ((select public.has_perm('canEditAccounting')));
create policy accounts_delete on public.accounts for delete to authenticated using ((select public.is_admin()));

drop policy if exists journals_select on public.journals;
create policy journals_select on public.journals for select to authenticated using ((select public.has_perm('canViewAccounting')));
drop policy if exists journals_write on public.journals;
create policy journals_insert on public.journals for insert to authenticated with check ((select public.has_perm('canEditAccounting')));
create policy journals_update on public.journals for update to authenticated using ((select public.has_perm('canEditAccounting'))) with check ((select public.has_perm('canEditAccounting')));
create policy journals_delete on public.journals for delete to authenticated using ((select public.is_admin()));

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users for select to authenticated
  using (id = (select auth.uid()) or (select public.has_perm('canManageUsers')));
-- (repeat the same wrapping for users_update / reminder_* / customroles_* / audit_select_admin)

-- Soft delete must require the DELETE permission, not just EDIT (DB-13)
create or replace function public.guard_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and not public.has_perm(tg_argv[0]) then
    raise exception 'permission denied: % required to trash/restore', tg_argv[0] using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('students','canDeleteStudents'), ('employees','canDeleteEmployees'),
    ('expenses','canDeleteExpenses'), ('invoices','canEditFees'),
    ('payslips','canEditPayslips'),   ('payments','canManageUsers'),   -- admin-equivalent
    ('journals','canEditAccounting'), ('accounts','canEditAccounting'),
    ('branches','canManageBranches'), ('reminder_logs','canEditFees')
  ) v(t, perm) loop
    execute format('drop trigger if exists trg_%1$s_soft_delete on public.%1$I', r.t);
    execute format('create trigger trg_%1$s_soft_delete before update of deleted_at on public.%1$I for each row execute function public.guard_soft_delete(%2$L)', r.t, r.perm);
  end loop;
end $$;

alter table public.students  add column if not exists deleted_by uuid;
-- (repeat deleted_by for every soft-delete table; set it in the same trigger: new.deleted_by := auth.uid())
```

### F. RPCs for money flows (atomic, locked, idempotent)

```sql
-- F0. gapless document numbers (DB-9)
create table if not exists public.document_counters (
  kind       text   not null check (kind in ('invoice','receipt','payslip','voucher')),
  scope      text   not null default '',          -- branch key ('' = main / whole school)
  period     int    not null,                     -- fiscal or academic year
  prefix     text   not null default '',
  last_value bigint not null default 0,
  primary key (kind, scope, period)
);
alter table public.document_counters enable row level security;   -- no policies: definer-only

create or replace function public.next_document_number(p_kind text, p_scope text, p_period int)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint; pfx text;
begin
  insert into public.document_counters as c (kind, scope, period, prefix, last_value)
  values (p_kind, coalesce(p_scope,''), p_period,
          case p_kind when 'invoice' then 'INV' when 'receipt' then 'RCP' when 'payslip' then 'PAY' else 'JV' end, 1)
  on conflict (kind, scope, period) do update set last_value = c.last_value + 1
  returning last_value, prefix into v, pfx;
  return format('%s-%s-%s', pfx, p_period, lpad(v::text, 6, '0'));
end $$;
revoke all on function public.next_document_number(text,text,int) from public, anon, authenticated;

-- F1. Record a fee payment (replaces Fees.confirmPay, QuickPayment, direct payment, bulk mark-paid)
create or replace function public.record_invoice_payment(
  p_invoice_id      uuid,
  p_amount          numeric,
  p_account         text,
  p_date            date    default current_date,
  p_concession      boolean default false,
  p_concession_note text    default null,
  p_idempotency_key uuid    default null
) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  inv        public.invoices;
  v_paid     numeric;
  v_conc     numeric := 0;
  v_branch   text;
  v_receipt  text;
begin
  if not public.has_perm('canEditFees') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  -- idempotent replay: same key already posted -> return current state
  if p_idempotency_key is not null
     and exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    select * into inv from public.invoices where id = p_invoice_id;
    return inv;
  end if;

  select * into inv from public.invoices
   where id = p_invoice_id and deleted_at is null
   for update;                                        -- serialises concurrent collectors
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(inv.branch_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_amount > 0 and not exists (
       select 1 from public.accounts
        where name = p_account and deleted_at is null
          and (sub_type = 'Bank & Cash' or type = 'Assets')) then
    raise exception 'unknown pay account %', p_account using errcode = '23503';
  end if;

  select coalesce(sum(case when type = 'cash_in' then amount else -amount end), 0) into v_paid
    from public.payments
   where source = 'invoice' and source_id = inv.id::text
     and deleted_at is null and not coalesce(reversed,false) and reversal_of is null;

  if v_paid + p_amount > inv.amount - coalesce(inv.concession_amount,0) + 0.005 then
    raise exception 'amount exceeds remaining balance %', inv.amount - coalesce(inv.concession_amount,0) - v_paid
      using errcode = '23514';
  end if;
  if p_amount = 0 and not p_concession then
    raise exception 'nothing to record' using errcode = '22023';
  end if;

  v_branch := coalesce(nullif(inv.branch_id,'main'),'');
  if p_amount > 0 then
    v_receipt := public.next_document_number('receipt', v_branch, extract(year from p_date)::int);
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, idempotency_key, receipt_no)
    values ('cash_in', p_account, p_amount, 'Fee Collection',
            format('Fee — %s (%s)', coalesce(inv.extra->>'studentName','student'), coalesce(inv.month, inv.extra->>'month','')),
            inv.id::text, coalesce(inv.branch_id,''), to_char(p_date,'YYYY-MM-DD'),
            'invoice', inv.id::text, false, p_idempotency_key, v_receipt);
  end if;

  v_paid := v_paid + p_amount;
  if p_concession then
    v_conc := greatest(0, inv.amount - coalesce(inv.concession_amount,0) - v_paid);
  end if;

  update public.invoices set
    paid_amount       = v_paid,
    paid_date         = to_char(p_date,'YYYY-MM-DD'),
    paid_account      = coalesce(nullif(p_account,''), paid_account),
    concession_amount = coalesce(concession_amount,0) + v_conc,
    concession_note   = case when p_concession then coalesce(p_concession_note,'Concession') else concession_note end,
    status = case
               when v_paid + coalesce(concession_amount,0) + v_conc >= amount - 0.005 then 'paid'
               when v_paid > 0 then 'partial'
               else 'pending' end
  where id = inv.id
  returning * into inv;

  return inv;
end $$;
revoke all on function public.record_invoice_payment(uuid,numeric,text,date,boolean,text,uuid) from public, anon;
grant execute on function public.record_invoice_payment(uuid,numeric,text,date,boolean,text,uuid) to authenticated;

-- F2. Pay a payslip (replaces Payslips.confirmPay / handleBulkPay)
create or replace function public.pay_payslip(
  p_payslip_id uuid, p_account text, p_date date default current_date, p_idempotency_key uuid default null
) returns public.payslips
language plpgsql security definer set search_path = public as $$
declare ps public.payslips; v_amount numeric;
begin
  if not public.has_perm('canEditPayslips') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into ps from public.payslips where id = p_payslip_id and deleted_at is null for update;
  if not found then raise exception 'payslip not found' using errcode='P0002'; end if;
  if not public.branch_visible(ps.branch_id) then raise exception 'permission denied' using errcode='42501'; end if;
  if ps.status = 'paid' then return ps; end if;                    -- idempotent on double click
  v_amount := coalesce(ps.net_pay, ps.amount);
  if v_amount is null or v_amount <= 0 then raise exception 'payslip has no net pay' using errcode='23514'; end if;

  insert into public.payments (type, account, amount, category, description, reference, branch_id,
                               date, source, source_id, reversed, idempotency_key)
  values ('cash_out', p_account, v_amount, 'Salary',
          format('Salary — %s (%s %s)', coalesce(ps.extra->>'employeeName',''), coalesce(ps.month,''), coalesce(ps.year::text,'')),
          ps.id::text, coalesce(ps.branch_id,''), to_char(p_date,'YYYY-MM-DD'), 'payslip', ps.id::text, false, p_idempotency_key);

  update public.payslips set status='paid', paid_date=to_char(p_date,'YYYY-MM-DD'), paid_account=p_account
   where id = ps.id returning * into ps;
  return ps;
end $$;
revoke all on function public.pay_payslip(uuid,text,date,uuid) from public, anon;
grant execute on function public.pay_payslip(uuid,text,date,uuid) to authenticated;

-- F3. Reverse every live payment of a source document, atomically (replaces utils/accounting.js reversePayment loop)
create or replace function public.reverse_source_payments(p_source text, p_source_id text)
returns int language plpgsql security definer set search_path = public as $$
declare p public.payments; n int := 0;
  perm text := case p_source when 'invoice' then 'canEditFees' when 'payslip' then 'canEditPayslips'
                             when 'expense' then 'canEditExpenses' else 'canEditPayments' end;
begin
  if not public.has_perm(perm) then raise exception 'permission denied' using errcode='42501'; end if;
  for p in
    select * from public.payments
     where source = p_source and source_id = p_source_id
       and deleted_at is null and not coalesce(reversed,false) and reversal_of is null
     for update
  loop
    if not public.branch_visible(p.branch_id) then raise exception 'permission denied' using errcode='42501'; end if;
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, reversal_of)
    values (case p.type when 'cash_in' then 'cash_out' else 'cash_in' end, p.account, p.amount,
            coalesce(p.category,'') || ' (reversal)', 'Reversal: ' || coalesce(p.description,''),
            p.id::text, p.branch_id, to_char(current_date,'YYYY-MM-DD'), p.source, p.source_id, false, p.id::text);
    update public.payments set reversed = true where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reverse_source_payments(text,text) from public, anon;
grant execute on function public.reverse_source_payments(text,text) to authenticated;

-- F4. Trash / restore an invoice consistently (DB-13)
create or replace function public.trash_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_branch text;
begin
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode='42501'; end if;
  select branch_id into v_branch from public.invoices where id = p_id and deleted_at is null for update;
  if not found then return; end if;
  if not public.branch_visible(v_branch) then raise exception 'permission denied' using errcode='42501'; end if;
  perform public.reverse_source_payments('invoice', p_id::text);
  update public.invoices set deleted_at = now(), paid_amount = 0,
         status = case when status = 'void' then status else 'pending' end
   where id = p_id;
end $$;

create or replace function public.restore_invoice(p_id uuid) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode='42501'; end if;
  update public.invoices set deleted_at = null
   where id = p_id and deleted_at is not null and public.branch_visible(branch_id)
  returning * into inv;
  -- payments were reversed on trash; invoice comes back unpaid and must be re-collected
  return inv;
end $$;
-- (revoke/grant as above)

-- F5. Recurring invoices, race-free (DB-10)
create or replace function public.generate_recurring_invoices(p_year int, p_month text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_month not in ('January','February','March','April','May','June','July','August',
                     'September','October','November','December') then
    raise exception 'bad month %', p_month using errcode='22023';
  end if;
  insert into public.invoices (student_id, branch_id, amount, status, month, year, kind, extra)
  select s.id::text, coalesce(s.branch_id,''), s.monthly_fee, 'pending', p_month, p_year, 'recurring',
         jsonb_build_object('studentName', s.name, 'parentPhone', s.parent_phone,
           'lineItems', jsonb_build_array(jsonb_build_object('description','Tuition Fee','amount', s.monthly_fee)))
    from public.students s
   where s.recurring_fee and s.deleted_at is null and coalesce(s.monthly_fee,0) > 0
     and ((select public.sees_all_branches()) or coalesce(nullif(s.branch_id,'main'),'') = (select public.my_branch_key()))
  on conflict (student_id, year, month) where kind = 'recurring' and deleted_at is null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
-- (revoke/grant as above)

-- F6. Server-side balances (DB-5) — security_invoker so normal RLS applies
create or replace view public.account_balances with (security_invoker = on) as
select a.id, a.code, a.name,
       coalesce(a.balance,0)
       + coalesce(sum(case p.type when 'cash_in' then p.amount when 'cash_out' then -p.amount end), 0) as balance
  from public.accounts a
  left join public.payments p on p.account = a.name and p.deleted_at is null
 where a.deleted_at is null
 group by a.id, a.code, a.name, a.balance;

-- F7. jsonb patch without clobbering (DB-12) — invoker, so RLS applies
create or replace function public.patch_extra(p_table text, p_id uuid, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_table not in ('students','employees','invoices','expenses','payments','payslips','accounts','journals','branches','users','custom_roles') then
    raise exception 'table not allowed' using errcode='42501';
  end if;
  execute format('update public.%I set extra = coalesce(extra, ''{}''::jsonb) || $1 where id = $2', p_table)
    using p_patch, p_id;
end $$;
-- NOTE: custom_roles.id is text; add a text overload if needed.
```

### G. Ledger immutability, server-side audit

```sql
create or replace function public.guard_payment_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;              -- service role / migrations
  if (new.amount, new.type, new.account, new.source, new.source_id, new.reversal_of, new.date)
     is distinct from
     (old.amount, old.type, old.account, old.source, old.source_id, old.reversal_of, old.date) then
    raise exception 'Posted payments are immutable; post a reversal instead' using errcode = '55000';
  end if;
  if old.reversed and not new.reversed then
    raise exception 'A reversed payment cannot be un-reversed' using errcode = '55000';
  end if;
  if old.deleted_at is null and new.deleted_at is not null
     and not old.reversed and old.reversal_of is null then
    raise exception 'Reverse this payment instead of deleting it' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_immutable on public.payments;
create trigger trg_payments_immutable before update on public.payments
  for each row execute function public.guard_payment_update();
-- App impact: Payments bulk-edit of `account`/`date` and Payments.handleDelete must change
-- to "post correcting entry" / reverse_source_payments.

-- audit_log: server-stamped identity and time (DB-22)
create or replace function public.stamp_audit_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new."user"     := coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
  new.timestamp  := now();
  new.created_at := now();
  new.extra      := coalesce(new.extra, '{}'::jsonb) || jsonb_build_object('uid', auth.uid());
  return new;
end $$;
drop trigger if exists trg_audit_log_stamp on public.audit_log;
create trigger trg_audit_log_stamp before insert on public.audit_log
  for each row execute function public.stamp_audit_log();

-- generic row history for financial tables
create table if not exists public.row_history (
  id bigserial primary key,
  table_name text not null,
  row_id uuid,
  op text not null,
  actor uuid default auth.uid(),
  at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
alter table public.row_history enable row level security;
create policy row_history_admin on public.row_history for select to authenticated using ((select public.is_admin()));

create or replace function public.capture_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.row_history (table_name, row_id, op, old_row, new_row)
  values (tg_table_name,
          case when tg_op = 'DELETE' then old.id else new.id end,
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['invoices','payments','payslips','expenses','journals','accounts'] loop
    execute format('drop trigger if exists trg_%1$s_history on public.%1$I', t);
    execute format('create trigger trg_%1$s_history after insert or update or delete on public.%1$I for each row execute function public.capture_history()', t);
  end loop;
end $$;
```

### H. Realtime scope

```sql
do $$
declare t text;
begin
  foreach t in array array['users','branches','students','employees','invoices','expenses',
                           'payments','payslips','accounts','journals','custom_roles','reminder_logs','audit_log'] loop
    execute format('alter table public.%I replica identity default', t);
  end loop;
  foreach t in array array['audit_log','reminder_logs'] loop
    if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- move PINs out of the published, self-readable users row
create table if not exists public.user_pins (
  user_id uuid primary key references public.users(id) on delete cascade,
  pin_hash text not null,                       -- crypt(pin, gen_salt('bf'))
  updated_at timestamptz not null default now()
);
alter table public.user_pins enable row level security;   -- no policies; verify via definer RPC only
```

### I. Academic years and enrollments (skeleton)

```sql
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                    -- '2026-27'
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  check (ends_on > starts_on)
);
create unique index if not exists academic_years_one_current on public.academic_years (is_current) where is_current;

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  grade text not null,
  section text,
  branch_id text,
  status text not null default 'active' check (status in ('active','promoted','retained','left','graduated')),
  created_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);
alter table public.invoices add column if not exists academic_year_id uuid references public.academic_years(id);

create or replace function public.promote_students(p_from uuid, p_to uuid, p_grade_map jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  insert into public.enrollments (student_id, academic_year_id, grade, section, branch_id)
  select e.student_id, p_to, coalesce(p_grade_map ->> e.grade, e.grade), e.section, e.branch_id
    from public.enrollments e
    join public.students s on s.id = e.student_id and s.deleted_at is null
   where e.academic_year_id = p_from and e.status = 'active'
  on conflict (student_id, academic_year_id) do nothing;
  get diagnostics n = row_count;
  update public.enrollments set status = 'promoted' where academic_year_id = p_from and status = 'active';
  update public.students s set grade = e.grade
    from public.enrollments e where e.student_id = s.id and e.academic_year_id = p_to;
  return n;
end $$;
-- RLS for both tables: mirror students_* policies.
```

### J. `supabase/seed.sql` (idempotent)

```sql
insert into public.branches (name, address)
select 'Main', 'Headquarters'
where not exists (select 1 from public.branches where lower(btrim(name)) = 'main' and deleted_at is null);

insert into public.accounts (code, name, type, sub_type, balance)
select v.code, v.name, v.type, v.sub_type, 0
from (values
  ('1001','Cash in Hand','Assets','Bank & Cash'),
  ('1002','Bank Account','Assets','Bank & Cash'),
  ('1100','Fees Receivable','Assets','Accounts Receivable'),
  ('4001','Tuition Fee Income','Income','Fee Income'),
  ('4100','Concessions Given','Income','Fee Income'),
  ('5001','Salaries','Expenses','Salaries & Wages'),
  ('5100','Rent & Utilities','Expenses','Rent & Utilities')
) v(code, name, type, sub_type)
where not exists (select 1 from public.accounts a
                  where a.deleted_at is null
                    and (lower(btrim(a.code)) = v.code or lower(btrim(a.name)) = lower(v.name)));
```

---

## Rollout order and app changes each step needs

1. **This week (S effort):**
   - Remove the "auth all" block from `schema.sql` and run A1 (DB-1).
   - Fix the README script order (DB-18).
   - Fix the `custom_roles` insert (DB-16).
   - Change the `users.role` default (DB-15).
2. **Data cleanup:** run A2-A5 and section B. Settle account balances by hand where duplicates differ.
3. **Guard rails:** sections C and D, plus the section E RLS rewrite. No app change except the soft-delete guard, which removes Trash buttons for roles that lack delete permission.
4. **Money RPCs:** section F, plus app changes:
   - `Fees.jsx` confirmPay, bulk pay, direct payment; `QuickPayment.jsx`; `Payslips.jsx` pay; `Expenses.jsx` and `Payments.jsx` delete. Each becomes one `supabase.rpc()` call with a `crypto.randomUUID()` idempotency key generated when the modal opens.
   - `BankCash`/`AccountDetail` read `account_balances`.
5. **Column promotion:** section C2 together with the `COLUMNS` update, then run the backfill again. Then add the period unique indexes.
6. **Ledger guards:** sections G and H after the UI stops editing or deleting posted payments.
7. **Later:** academic years (section I), JWT-claim RLS, uuid FK conversion (DB-2 phase 2).
