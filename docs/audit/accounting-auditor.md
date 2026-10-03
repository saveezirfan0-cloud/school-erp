# Accounting audit: is the money right?

Agent: `accounting-auditor` · Date: 2026-10-03 · Scope: fees, payments, expenses, payroll, ledger, reports, import, trash.

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 9 |
| Medium | 11 |
| Low | 3 |
| Info | 1 |

**How money is actually modelled.** The app has no general ledger. It is a single-entry cash book (`payments` rows of `cash_in`/`cash_out` keyed by account **name**) next to source documents (`invoices`, `expenses`, `payslips`) that each keep their own `status`/`paidAmount`. `journals` is a free-standing list that no screen or balance reads. So "trial balance" does not exist and cannot be computed. Each screen derives its totals differently: Fees and Dashboard use invoice `status` and `amount`, Reports uses invoice `paidAmount`, Bank & Cash uses `payments`, and Student Ledger uses `payments` linked by `sourceId`. These can and do drift apart (reproduced, see ACC-04).

**`src/utils/invoiceGenerator.js`** has been empty (0 bytes) since the first commit and nothing imports it. Invoice creation is done inline in `Fees.jsx` (`handleCreate`, `handleBulkReceive`, `handleGenerateRecurring`), `QuickPayment.jsx` and `Import.jsx`. "Receipts" are WhatsApp text messages (`sendWhatsAppMessage`), and printing goes through `exportToPDF` (`utils/exportUtils.js`). There is no invoice or receipt numbering anywhere.

**Posting matrix (traced):**

| Event | Ledger row? | Source doc updated? | Reversed on delete? |
|---|---|---|---|
| Fees → Mark Paid (single/bulk) | yes, `recordPayment` cash_in | status/paidAmount | yes (`reverseSourcePayments`) |
| Fees → New Invoice + "Receive now" | only if user can see ≥1 asset account, and it goes to `payAccounts[0]` | status=paid | yes |
| Fees → Bulk Receive with "Paid" ticked | **no** | status=paid | n/a |
| Fees → Bulk Edit status=Paid | **no** | status=paid | n/a |
| QuickPayment | **no** | status=paid | n/a |
| Import invoices (status contains "paid") | **no** | status=paid | n/a |
| Concession | **no** (no income/discount entry) | concessionAmount, status=paid | n/a |
| Expense (single, with paid account) | yes cash_out | — | yes |
| Expense (bulk entry) | **no** | — | — |
| Payslip Pay (single/bulk) | yes cash_out | status=paid | yes |
| Payments page manual / bulk / import | yes, unlinked (`source` empty) | — | deleting is soft-delete, no reversal |
| Account transfer | 2 unlinked rows, non-atomic | — | — |
| Journal entry | **not read by any balance or report** | — | — |
| Trash restore of invoice/expense/payslip | **no re-post** | doc becomes live again with old status | — |

Reproduction scripts are in the session scratchpad (`.../scratchpad/acc/01_float.js` … `07_tz.js`). Each one copies the exact formulas from the cited lines and runs them under Node 22.

---

## Findings

### [ACC-01] Invoices are marked "paid" with no money in the books (six paths), and most non-admin roles can only use those paths
- Severity: Critical
- Effort: M
- Location: src/pages/QuickPayment.jsx:48-61; src/pages/Fees.jsx:145-155, 178-186, 626; src/pages/Import.jsx:76; supabase/security.sql:61-76, 243-245
- Evidence:
  - QuickPayment writes `status: "paid"`, `paidDate: date` to `invoices` and never calls `recordPayment`. No `paidAmount`, no `paidAccount`.
  - Bulk Receive: `status: s.paid ? "paid" : "pending"` with no `recordPayment` and no `paidAmount`.
  - Create with "Receive payment now": `const acct = payAccounts[0]?.name; if (acct) { await recordPayment(...) }`. When no account is visible, the invoice is still saved as `status: "paid"`, `paidAmount: amount`, and the code silently skips the posting.
  - Bulk Edit offers `{ key: "status", ... "paid" }` with the hint "Changes the label only — no money is recorded".
  - Import: `status: row.status?.toLowerCase()?.includes("paid") ? "paid" : "pending"`.
  - Roles: `branch_manager` and `fee_collector` have `canEditFees` but not `canViewAccounting`, so the `accounts_select` RLS returns zero rows. For them `payAccounts` is always empty. The Mark Paid modal is disabled for them (`disabled={payAccounts.length === 0 ...}` Fees.jsx:731), so the only working "collect fee" paths left are the unledgered ones above.
- Impact: Cash a branch manager or fee collector physically takes never appears in any Bank/Cash account. The Dashboard shows it as collected. There is no ledger row to reconcile against the till, so skimming cannot be detected: mark an invoice paid, keep the cash, and nothing downstream disagrees except Reports (which then silently under-reports, see ACC-04). The Student Ledger shows the parent still owing money on an invoice marked "paid" (reproduced in 04_reports_disagree.js: "Balance Due 6000" for two "paid" invoices).
- Fix: Make "paid" derivable only from ledger rows. Route every collection path through one server-side RPC (`collect_fee(invoice_id, account_id, amount, date)`) that inserts the payment and updates `paid_amount`/`status` in one transaction. Remove `status` from Bulk Edit and from Import (import as pending plus a separate opening-receipts import). Make QuickPayment and Bulk Receive call the RPC with a required account. Give collectors read access to Bank & Cash accounts only (a view or a `canCollectInto` list). Add a DB check or trigger: `status='paid'` requires `paid_amount + concession_amount >= amount`, and `paid_amount` must equal the sum of live, non-reversed payments.
- Verified: yes (traced end to end; RLS matrix read; ledger effect reproduced in 04_reports_disagree.js)

### [ACC-02] Posted payments can be deleted, re-dated or moved between accounts directly, without reversal, and source documents are not updated
- Severity: High
- Effort: M
- Location: src/pages/Payments.jsx:108-146, 336-339; src/firebase.js:226-239; supabase/security.sql:215-221
- Evidence: `handleDelete` → `deleteDoc(doc(db, "payments", p.id))` (soft delete). `handleBulkEditApply` → `updateDocs("payments", ids, { date, category, account, branchId })`. Neither checks `p.source`/`p.reversalOf`, and neither touches the linked invoice/expense/payslip. Reversal rows appear in the same list and can be deleted the same way. RLS lets any `canEditPayments` user (including branch_manager) UPDATE or hard DELETE payment rows. The comment in accounting.js says "We never silently mutate a posted payment", but the Payments page does exactly that.
- Impact: Reproduced in 05_restore.js. Trashing a fee payment drops the bank balance by 4000 while the invoice stays `paid`/`paidAmount 4000`, and the Student Ledger shows 4000 owing. Trashing a reversal row puts the money back into the till balance while the invoice is gone. Bulk Edit can move a month of fee receipts from "Bank" to "Cash", or into a closed month, with only "N payments (bulk): account" in the audit log.
- Fix: Make `payments` append-only. Revoke UPDATE/DELETE in RLS (allow only `reversed=true` via an RPC). Replace Delete/Edit on Payments with "Reverse" (and "Reverse and re-post" for corrections) that calls `reversePayment`. Block reversing rows that have `source` set unless done through the source document. Remove `payments` from `SOFT_DELETE_TABLES`/Trash.
- Verified: yes (reproduced, 05_restore.js)

### [ACC-03] Restoring an invoice, expense or payslip from Trash brings it back with its old status but without its (already reversed) money
- Severity: High
- Effort: M
- Location: src/pages/Trash.jsx:44-52, 69-81; src/firebase.js:242-248; src/pages/StudentLedger.jsx:38-41
- Evidence: Delete reverses payments, then soft-deletes (`Fees.jsx:317-318`). Restore only runs `update({ deleted_at: null })`. The restored invoice keeps `status: "paid"`, `paidAmount: 5000`. Its original payment is `reversed: true` and its reversal row is live. StudentLedger excludes `reversed` originals but counts the reversal row as `-amount`: `.filter((p) => !p.reversed).reduce(... cash_in ? +amt : -amt)`.
- Impact: Reproduced in 05_restore.js. After restoring, the invoice says `paid` with paidAmount 5000, the bank shows 0, `getSourcePaidTotal` is 0, and the Student Ledger shows billed 5000, received **-5000**, balance due **10000**. Mark Paid is hidden because status is "paid", so the user cannot fix it from the UI. A restored expense reappears in Reports with no matching cash_out.
- Fix: Disable restore for documents that had payments reversed, or make restore re-post (create new payments mirroring the reversed ones, through the same RPC). In StudentLedger, exclude both `reversed` originals and rows with `reversalOf`, or include both. Better: compute received as the sum over all live rows, since reversal pairs net to zero.
- Verified: yes (reproduced, 05_restore.js)

### [ACC-04] Dashboard, Fees, Reports, Bank & Cash and Student Ledger report different "collected" and "pending" figures for the same data
- Severity: High
- Effort: M
- Location: src/pages/Dashboard.jsx:38-40, 51; src/pages/Fees.jsx:90-91, 119-120, 466-469; src/pages/Reports.jsx:29-37; src/pages/BankCash.jsx:22-28; src/pages/Expenses.jsx:64
- Evidence:
  - Dashboard/Fees: `collected = status === "paid" ? amount`. This counts the full face value of concession-settled invoices and of unledgered paid invoices. `pending = status === "pending"` leaves out `partial` entirely.
  - Reports: `collected = Σ paidAmount` and `pending` includes partial minus concessions.
  - Bank: Σ payments.
  - Fees/Expenses branch filter `inv.branchId === activeBranch` never matches `""` (Main) when "main" is selected. Dashboard uses `matchesBranch`, which treats `""` as main.
  - The Fees status filter has no "partial" option.
- Impact: Reproduced in 04_reports_disagree.js. With 5 ordinary invoices: Fees/Dashboard collected **17,000**, pending **0**, rate **100%**. Reports collected **10,500**, pending **3,500**, rate **75%**. Bank **10,500**. Management and the board see different numbers depending on the screen, and a Rs 2,000 concession is reported as cash collected on the Dashboard.
- Fix: Use one shared selector module (`utils/feeMath.js`) for billed, collected (from the ledger), concession and outstanding (`amount - paid - concession` for every non-paid status), and use it on all screens. Use `matchesBranch` everywhere. Add "partial" to filters and summary cards.
- Verified: yes (reproduced, 04_reports_disagree.js)

### [ACC-05] Reports ignore the branch selector and any period, and the "year to date" P&L is actually all-time
- Severity: High
- Effort: M
- Location: src/pages/Reports.jsx:13-49, 82
- Evidence: `useEffect(..., [activeBranch])` re-fetches but never filters by `activeBranch`, unlike Dashboard which calls `matchesBranch`. There is no date filter. The header says "Current year to date". The monthly series buckets by `getMonth()` only, so different years merge (07_tz.js: Oct 2025 4,000 + Oct 2026 5,000 → "Oct" 9,000). Invoices with no `paidDate` fall into the current month via `toDate(inv.paidDate) || new Date()`. Expenses with no date do the same via `new Date(e.date || Date.now())`. Salaries are `Σ netPay` over all payslips, including unpaid ones, so cash-basis fees are mixed with accrual-basis payroll.
- Impact: A branch-filtered P&L shows the whole institute's numbers. The "Current year" surplus/deficit includes every prior year. Unpaid payslips reduce reported surplus as if paid. There is no academic-year or fiscal-year cut-over, so year-end figures cannot be produced from the app.
- Fix: Add from/to date (default: current fiscal or academic year) and apply `matchesBranch` to every collection. Bucket by `YYYY-MM`. Choose one basis: either cash (salaries from salary cash_out payments) or accrual (fees billed, payslips accrued) and label it.
- Verified: yes (traced; year-merge reproduced in 07_tz.js)

### [ACC-06] No double-entry ledger exists: journals are disconnected, the "Balance Sheet" lists only opening balances, and trial balance is undefined
- Severity: High
- Effort: L
- Location: src/pages/Journals.jsx:32-40; src/pages/Reports.jsx:151-157; src/pages/BankCash.jsx:22-28; supabase/schema.sql:165-177
- Evidence: Journals save `{ debitAccount, creditAccount, amount }` names. No screen, balance or report reads `journals`. BankCash and AccountDetail compute from `payments` only. The Balance Sheet uses `Σ Number(a.balance)` (the opening balance field) for Assets vs Liabilities+Equity, with no retained earnings and no movements. Fee income, expenses and salaries never hit Income/Expense accounts. Concessions are not booked as a discount or contra-revenue.
- Impact: A journal "Dr Cash / Cr Fee Income 50,000" changes nothing anywhere. The Balance Sheet does not balance and does not change when money moves. Nobody can produce a trial balance, so an external auditor cannot tie the books.
- Fix: Introduce `ledger_entries(id, txn_id, account_id, debit, credit, date, branch_id, source, source_id)` with a deferred constraint `Σdebit = Σcredit per txn_id`. Post every invoice (Dr Receivable / Cr Fee Income), collection (Dr Bank / Cr Receivable), concession (Dr Concessions / Cr Receivable), expense, payroll and transfer through a single SQL function. Derive Bank & Cash, Balance Sheet, P&L and Trial Balance from it, and keep `payments` as a view.
- Verified: yes (traced)

### [ACC-07] Accounts are identified by name: renaming one wipes its history, and duplicate names double-count in the total
- Severity: High
- Effort: M
- Location: src/pages/ChartOfAccounts.jsx:40-41; src/pages/BankCash.jsx:22-30; src/pages/AccountDetail.jsx:30; src/utils/accounting.js:23; supabase/fix_duplicate_accounts.sql
- Evidence: `payments.account` stores `accounts.name`. Balances are `payments.filter(p => p.account === accountName)`. ChartOfAccounts edit runs `updateDoc(... { ...form })`, which includes `name`, with no cascade. `totalBalance = accounts.reduce((s, a) => s + getAccountBalance(a.name), 0)`, so two live accounts with the same name each count every payment. The dedupe script only collapses identical (code, name) pairs.
- Impact: Fixing a typo ("Meezan Bank" → "Meezan Bank Ltd") makes the account show only its opening balance, and all its receipts and payments drop out of Bank & Cash and AccountDetail. Duplicate-named accounts inflate "Total Balance" by the full transaction volume.
- Fix: Store `account_id` (FK) on payments, backfill from name, and make name purely a label. Add a unique index on `lower(name)` among live accounts. Block deleting accounts that have transactions.
- Verified: yes (traced)

### [ACC-08] Fees and salaries can be posted into non-cash asset accounts, and "Receive now" picks an arbitrary account
- Severity: Medium
- Effort: S
- Location: src/utils/accounting.js:58-60; src/pages/Fees.jsx:146; src/pages/BankCash.jsx:14
- Evidence: `accounts.filter(a => a.subType === "Bank & Cash" || a.type === "Assets")` includes Fixed Assets and Accounts Receivable. Direct payment on invoice creation uses `payAccounts[0]?.name`, which is the first row returned by an unordered `select *`, with no user choice.
- Impact: Fee cash may be posted to "Fixed Assets" or "Accounts Receivable". It then appears on the Bank & Cash page as cash and is missing from the real till account, so cash reconciliation fails.
- Fix: Filter strictly on `subType === "Bank & Cash"`. Require an explicit account selection in the create-and-receive form.
- Verified: yes (traced)

### [ACC-09] Double-clicking "Pay" on a payslip pays the salary twice, and no posting path is idempotent
- Severity: High
- Effort: S
- Location: src/pages/Payslips.jsx:66-91, 591; src/pages/Payslips.jsx:146-178; src/utils/accounting.js:33-55; src/pages/Payslips.jsx:181-198
- Evidence: `confirmPay` has no `submitting` flag, and the button is `disabled={payAccounts.length === 0}` only. Each click awaits `recordPayment` (cash_out) and then sets `status: "paid"`. `recordPayment` never checks for an existing live payment for the same `source/sourceId`. Bulk Pay filters `status !== "paid"` from the local snapshot, so another tab that has not received the realtime update can pay the same payslips again. Manual "Generate Payslip" has no duplicate check per employee and month.
- Impact: Two salary cash_outs for one payslip (bank understated by one month's salary). Duplicate payslips for the same month can both be paid.
- Fix: Add a `submitting` guard and disable the button while in flight. Server side: unique partial index `payments(source, source_id) where source in ('payslip') and reversal_of is null and not reversed`, or an RPC that locks the payslip row (`select ... for update`) and checks status. Add a unique (employee_id, month, year) constraint on live payslips.
- Verified: yes (traced end to end)

### [ACC-10] Excel import misreads money: "Unpaid" becomes paid, Dr/Cr is ignored, Credit columns are dropped, and monthly fee is taken from Balance
- Severity: High
- Effort: M
- Location: src/pages/Import.jsx:28, 68-79, 131-145, 171-199
- Evidence (reproduced with the real `xlsx` package in 06_import.js):
  - `includes("paid")`: "Unpaid", "Not paid" and "Partially paid" all become **paid**.
  - Payment type: "Dr", "Cr", "Withdrawal", "Payment" all become **cash_in**. Only "Debit"/"…out" become cash_out.
  - A sheet with separate Debit and Credit columns maps `amount` to Debit only. The Credit (receipt) row is skipped for missing amount, and the Debit (rent 20,000) row is imported as **cash_in**.
  - Student `monthlyFee` aliases start with `"balance"`. A sheet with both "Monthly Fee 3000" and "Balance 18000" imports monthlyFee **18000**.
  - Values are imported as `String(row[h]).trim()`. "Rs 5,000.00" and "(1,200)" pass through as text and the numeric insert fails per row.
  - There is no dedupe, so re-importing doubles everything.
- Impact: Migrating from Manager.io gives wrong receivables (unpaid invoices shown paid and never chased), inverted bank balances, and recurring invoices billed at the parent's outstanding balance rather than the monthly fee.
- Fix: Use explicit status mapping (exact match on paid / unpaid / partial / overdue, and reject anything else). Support Debit/Credit or Received/Spent pairs, and signed amounts with explicit sign rules. Parse numbers with a locale-aware parser (strip currency and thousands separators, handle parentheses as negative) and validate. Put `monthlyFee` aliases in the order `["monthly fee","fee"]` and never use balance. Add a preview totals check and an `import_batch_id` for dedupe and rollback.
- Verified: yes (reproduced, 06_import.js); DB rejection of "5,000" for numeric: no (not run against Postgres)

### [ACC-11] Opening balances and account definitions can be changed at any time with no audit trail
- Severity: High
- Effort: S
- Location: src/pages/ChartOfAccounts.jsx:35-70, 190; src/pages/AccountDetail.jsx:44-58
- Evidence: ChartOfAccounts and AccountDetail contain zero `logActivity` calls (grep count 0). The edit form exposes `balance` (opening balance) as a free number input that is saved via `updateDoc` with no history. Delete and restore are unlogged too. Fund transfers are also unlogged.
- Impact: Anyone with `canEditAccounting` can raise or lower a cash or bank balance by editing "Opening Balance", which is the classic way to hide a shortage. Nothing records who did it or what the old value was.
- Fix: Lock the opening balance after the first transaction, or post changes as an adjusting journal. Log old and new values for every account create, edit, delete or restore and every transfer. Better: a DB trigger writing to `audit_log`, so the client cannot skip it.
- Verified: yes (traced)

### [ACC-12] No financial controls: no period close, no approval or maker-checker, and the audit log can be spoofed and has no before/after values
- Severity: Medium
- Effort: L
- Location: src/utils/auditLog.js:43-55; supabase/security.sql:341-347; all money pages
- Evidence: There is no closed-period concept anywhere (grep for lock/closed/approv finds nothing). Any back-dated payment, expense or journal is accepted, and Bulk Edit can re-date posted payments. Audit rows are written by the client with `user: email || "unknown"`, and RLS `audit_insert ... with check (true)` lets a user insert rows under any name. `logActivity` is fire-and-forget, so a failed log never blocks the money action. Details are prose with no before/after values and no record id. There is no bank-statement reconciliation.
- Impact: Months that have already been reported can be changed silently. The audit trail is not evidential. One person can create, approve and pay their own expense or salary.
- Fix: Add a `periods(closed_at)` table plus a trigger rejecting inserts or updates with `date <= last_closed`. Fill `audit_log.user` server-side (`default auth.uid()`, ignore the client value) using triggers on money tables that store the old and new row as jsonb. Add a status workflow (draft → approved → paid) for expenses and payslips over a threshold, with approver ≠ creator. Add a reconciliation screen that marks payments as cleared against the bank statement.
- Verified: yes (traced)

### [ACC-13] Two users can collect the same invoice twice, and a failed lookup pre-fills the full amount again
- Severity: Medium
- Effort: M
- Location: src/pages/Fees.jsx:219-280
- Evidence: `alreadyPaid` is read once when the modal opens. `confirmPay` checks overpayment against that stale value, then writes `paidAmount: newPaid` (absolute overwrite). On lookup failure: `catch { setAlreadyPaid(0); setPayAmount(String(inv.amount || "")); }`.
- Impact: Two cashiers (or two tabs) open the same invoice: both see a balance of 5,000, both post 5,000, and the second write sets `paidAmount` to 5,000 while the ledger holds 10,000. A transient network error makes the modal suggest the full fee for an invoice that is already partly paid.
- Fix: Do the check and update in a server-side transaction (row lock on the invoice, recompute paid from the ledger). On lookup error, block the payment instead of assuming 0.
- Verified: yes (traced)

### [ACC-14] Reversals are not atomic and concurrent deletes double-reverse
- Severity: Medium
- Effort: S
- Location: src/utils/accounting.js:101-135
- Evidence: `reversePayment` first `update({ reversed: true })`, then inserts the opposite row in a separate request. If the insert fails, the original is flagged reversed but still counts in BankCash (which sums all live rows), while `getSourcePaidTotal`/StudentLedger exclude it. A retry then finds nothing to reverse and deletes the document, leaving the money in the bank. Two users deleting at once both read `!r.reversed` and both post reversals. The reversal `reference: payment.reversalOf || ""` is always empty (originals have no `reversalOf`).
- Impact: Orphaned cash, or a negative double reversal on the bank balance. Reversal rows cannot be traced back by reference.
- Fix: One SQL function that does `update ... set reversed = true where id = $1 and not reversed returning *` and inserts the reversal only if a row was returned, in a single transaction. Set `reference` to the original payment id.
- Verified: yes (traced)

### [ACC-15] Negative and zero amounts are accepted in several places, and an invoice is saved before its payment is validated
- Severity: Medium
- Effort: S
- Location: src/pages/Payments.jsx:85-106, 393; src/pages/Journals.jsx:32-40; src/pages/Fees.jsx:133-155, 805; src/pages/Expenses.jsx:134-155; src/pages/AccountDetail.jsx:44-58
- Evidence: Amount inputs are `type="number"` with no `min`, and handlers do no validation (`addDoc(... { ...form })`). Invoice line items can be negative: `5000 + -6000 = -1000` (01_float.js, case E). `handleCreate` inserts the invoice as `paid` first; then `recordPayment` throws "Invalid amount", leaving a paid invoice of -1,000 with no payment. A negative expense is saved and lowers Reports expenses. A negative `cash_in` in Payments acts as an unlabelled cash_out.
- Impact: Fake negative transactions and "discounts" without a trail, and orphaned paid invoices.
- Fix: Validate `amount > 0` and finite, rounded to 2 dp, in a shared helper and in DB `check (amount > 0)` constraints on payments, journals, expenses and invoice amounts. Model discounts explicitly. Create the invoice and payment in one transaction.
- Verified: yes (reproduced arithmetic, 01_float.js; persistence traced)

### [ACC-16] Expense flows leave expense and cash out of step
- Severity: Medium
- Effort: S
- Location: src/pages/Expenses.jsx:134-175, 118-132, 370-374
- Evidence: Single entry saves the expense first. If `recordPayment` fails, it shows "Expense saved, but payment not recorded" and keeps the expense. Bulk entry never asks for a paid account and never posts. Bulk Edit changes the expense `date`/`branchId` but not the linked payment.
- Impact: Expenses appear in Reports with no cash movement, or in a different month or branch from the cash movement. Bank and the P&L cannot be reconciled.
- Fix: Add a `paid_status` (unpaid/paid) and an explicit "Pay" action, as for payslips. Propagate date or branch edits by reversing and re-posting. Make bulk entry take a paid-from account.
- Verified: yes (traced)

### [ACC-17] Fund transfers are two independent, unvalidated inserts
- Severity: Medium
- Effort: S
- Location: src/pages/AccountDetail.jsx:44-58
- Evidence: Two sequential `addDoc` calls with no try/catch, no `submitting` guard, no amount validation, no `branchId`, no shared transfer id, and no audit log.
- Impact: If the second insert fails (network or RLS), money leaves one account and never arrives at the other. A double-click creates two transfers. A negative amount reverses the direction.
- Fix: A single RPC inserting both legs in one transaction with a shared `transfer_id`. Validate the amount, guard the button, and log the transfer.
- Verified: yes (traced)

### [ACC-18] The payroll model is thin and unsafe: no gross/tax/advance handling, negative net pay is allowed, and paid payslips can be relabelled
- Severity: Medium
- Effort: L
- Location: src/pages/Payslips.jsx:181-221, 132-144, 408-417; src/firebase.js:53
- Evidence: `netPay = basic + allowances - deductions` with no lower bound (01_float.js case F: -5,000). There are no tax, EOBI or provident fund lines, no advances or loans with recovery, and no separate gross. Recurring payslips use `basicSalary: emp.salary`, `netPay: Number(emp.salary || 0)`; with salary unset the payslip is 0 and "Pay" throws "Invalid amount". Bulk Edit can change `month`/`year` on a **paid** payslip, after which recurring generation creates a new payslip for the vacated month. The `payslips.amount` column is never written (netPay lives in `extra`), so SQL-side reporting sees NULL.
- Impact: Double salary for a month via relabel-and-regenerate. Negative payslips reduce reported payroll. No statutory deductions record.
- Fix: Lock paid payslips (no edits; reverse to correct). Add structured earnings and deductions lines including tax and advances. Validate `netPay > 0`. Write `amount = netPay`. Add a unique (employee, month, year) constraint.
- Verified: yes (traced; arithmetic reproduced)

### [ACC-19] Recurring fee generation can create duplicates and silently null amounts
- Severity: Medium
- Effort: S
- Location: src/pages/Fees.jsx:197-217, 935; src/pages/Payslips.jsx:200-221
- Evidence: There is no busy flag on "Generate Now". Dedupe is `existingIds` computed once from the local snapshot, so a double-click or two admins both generate. `amount: Number(s.monthlyFee)` gives `NaN` when monthlyFee is unset, which JSON serialises as `null`. Generation covers students of every branch regardless of the active branch.
- Impact: Duplicate monthly invoices for the whole school, which parents receive as WhatsApp dues reminders. Invoices with null amount.
- Fix: Add a busy guard and a unique index on live `(student_id, extra->>'month', extra->>'year')` (promote month and year to columns). Skip or flag students with no fee.
- Verified: yes (traced)

### [ACC-20] No invoice or receipt numbering; the receipt is a WhatsApp message and `invoiceGenerator.js` is empty
- Severity: Medium
- Effort: M
- Location: src/utils/invoiceGenerator.js (0 bytes); src/pages/Fees.jsx:157, 286-291; src/pages/QuickPayment.jsx:62-67, 97-99
- Evidence: Documents are identified only by UUID. Receipts are free-text WhatsApp messages. QuickPayment's success screen always says "WhatsApp receipt sent to parent ✓", even when there is no phone or the send failed.
- Impact: No sequential, gap-checkable receipt series, so cash receipts cannot be audited and duplicate or missing receipts cannot be detected. Parents get no printable receipt.
- Fix: Add a per-branch, per-year receipt sequence allocated in the collection RPC (`receipt_no`, unique), and a printable receipt. Show the real send result.
- Verified: yes (traced)

### [ACC-21] Every total is computed from a client-side `select *`, likely capped at the PostgREST row limit
- Severity: Medium
- Effort: M
- Location: src/firebase.js:365-371, 439-446; Reports.jsx:15-20; Dashboard.jsx:21-27; BankCash.jsx:16; AccountDetail.jsx:23
- Evidence: There is no `.range()` and no pagination. Supabase's default API `max_rows` is 1000. Payments grow by roughly students × 12 per year.
- Impact: Once a table passes the cap, balances, P&L and the Dashboard silently sum an arbitrary subset (no `order`), so numbers change from refresh to refresh.
- Fix: Compute aggregates in SQL views or RPCs (`sum(...) group by account, month, branch`) and paginate lists.
- Verified: no (depends on project `max_rows` setting; code path traced)

### [ACC-22] Floating-point currency with no rounding stores non-paisa amounts
- Severity: Low
- Effort: S
- Location: src/pages/Fees.jsx:118, 133, 227-228, 247, 269, 374
- Evidence (01_float.js, 02_residual.js, 03_bulk_residual.js): line items 100.10 + 200.20 store an invoice amount of **300.29999999999995**. After a partial, the modal pre-fills **"200.19999999999996"** and posts it. In bulk Mark Paid, `remaining = total - already` has no tolerance (unlike the 0.001 in `confirmPay`), so line items 1.20 + 50.10 (=51.300000000000004) with 51.30 already received post a payment of **7.1e-15**.
- Impact: Ledger rows with junk decimals, totals that print as "1,800.3" but compare unequal, and spurious micro-payments. Low practical impact for whole-rupee fees.
- Fix: Work in integer paisa (or round with `Math.round(x*100)/100` at every boundary). Use `numeric(12,2)` columns. Use a tolerance or rounding in every comparison.
- Verified: yes (reproduced)

### [ACC-23] Default dates are UTC, not local, so early-morning entries land on the previous day or month
- Severity: Low
- Effort: S
- Location: src/utils/accounting.js:48, 118; src/pages/Fees.jsx:40, 139, 222, 610; src/pages/Payslips.jsx:38; src/pages/QuickPayment.jsx:21; src/pages/Dashboard.jsx:51; src/pages/Reports.jsx:42
- Evidence: `new Date().toISOString().slice(0, 10)`. With TZ=Asia/Karachi at 03:30 on 1 Nov 2026 the stored date is **2026-10-31** (07_tz.js). Month bucketing uses `new Date("YYYY-MM-DD").getMonth()`, which parses as UTC; in a negative-offset zone "2026-10-01" buckets to September. The Payslips `payDate` is initialised at mount and not reset when the modal opens.
- Impact: Receipts taken between 00:00 and 05:00 PKT (and every reversal posted then) are dated the previous day, and the previous month on the 1st. A stale payslip pay date persists if the tab is left open.
- Fix: Add a `todayLocal()` helper (`toLocaleDateString('en-CA')`), parse `YYYY-MM-DD` as a local date for bucketing, and reset dates when modals open.
- Verified: yes (reproduced)

### [ACC-24] The role matrix blocks the accountant from billing
- Severity: Low
- Effort: S
- Location: src/context/UserContext.jsx:67-90; supabase/security.sql:67-73, 141-143; src/pages/Fees.jsx:129-130, 198
- Evidence: `accountant` has `canEditFees` but not `canViewStudents`, so the `students` RLS returns zero rows. `handleCreate` → "Student not found", and recurring generation → "No students have auto-recurring fees enabled". The Student Ledger route requires `canViewStudents`.
- Impact: The finance role cannot raise invoices or view a student's balance. Billing falls to roles that cannot post to the ledger (see ACC-01).
- Fix: Grant accountants read access to the student fields billing needs (id, name, branch, fee, phone), or provide a `students_billing` view.
- Verified: yes (traced)

### [ACC-25] Common school-finance features are missing
- Severity: Info
- Effort: L
- Location: whole app (grep for discount/sibling/late/advance/tax/academic returns nothing relevant)
- Evidence: No invoice-level discounts or scholarships (only after-the-fact "concession"), no sibling concessions, no late-fee rules, no advance or credit balance (overpayment is rejected at Fees.jsx:247), no refund flow (only delete-and-reverse), no academic-year entity, and no withholding tax on payroll.
- Impact: Staff work around the gaps with negative line items, manual Payments-page entries (unlinked to invoices) and concessions, all of which bypass the reconciliation the app does have.
- Fix: Plan these on top of the ledger from ACC-06: fee structures with discount rules, an advance-liability account for overpayments, refund documents, and an academic-year table referenced by invoices.
- Verified: yes (traced)
