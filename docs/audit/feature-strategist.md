# Feature strategist report: ZMI School ERP

Agent: `feature-strategist` | Date: 2026-10-03 | Scope: `/home/user/school-erp` (read-only)

This report follows `docs/audit/README.md`, with these changes for feature work:
- The **Severity** field is replaced by **Value** (High / Med / Low).
- **Effort** uses the README scale (S <1h, M <1 day, L >1 day). Almost every new module is L, so L items also give a rough size in brackets, for example `L (~3d)`.
- Each finding also has **Bucket** (Now / Next / Later), **Depends on** (existing tables and other FEAT items) and **Risks**.
- **Verified** means I read the code that backs the "what exists today" claim. Value and effort are my estimates.

---

## 1. Executive summary

ZMI is a finance-first, multi-branch school back office. It covers students, invoices, payments, expenses, payslips, chart of accounts and journals, with role and branch RLS. It has **no academic layer** (no classes, sections, attendance, exams or academic year), **no parent-facing surface**, and **no server-side jobs**. The reminder screen says it runs automatically at 8am, but the endpoint it calls does not exist.

The data already in `invoices` (`amount`, `paid_amount`, `concession_amount`, `due_date`, `status`, `branch_id`) is enough for the reports that bring in the most money: aging, defaulters, and collection by branch. None of these exist today. The current Reports page also ignores the branch selector.

Top 5 picks:
1. **FEAT-001** Fee aging and defaulters list (Now)
2. **FEAT-004** Server-side automated reminders that replace the missing `/api/send-reminders` (Now)
3. **FEAT-003** Numbered, printable fee receipts and vouchers (Now)
4. **FEAT-017 + FEAT-018** Classes/sections, academic year, student status and promotion rollover (Next; the base for all academic features)
5. **FEAT-007 + FEAT-008** Fee structure templates with sibling and scholarship discounts (Next)

---

## 2. Inventory: what exists today

### 2.1 Pages and routes (`src/App.js`)
| Route | Page | Permission | Notes |
|---|---|---|---|
| `/` | Dashboard | canViewDashboard | Counts and a monthly chart. Downloads full tables on the client (`Dashboard.jsx:21-27`) |
| `/students`, `/students/:id/ledger` | Students, StudentLedger | canViewStudents | Free-text `grade`, `monthlyFee`, `recurringFee` flag. Ledger shows a per-student timeline |
| `/employees` | Employees | canViewEmployees | name, role, phone, email, salary, joinDate, recurringPayslip |
| `/fees` | Fees | canViewFees | Line items, bulk receive, recurring monthly generation, partial payments, concession, one-click WhatsApp "Remind", CSV/PDF list export |
| `/expenses` | Expenses | canViewExpenses | Hard-coded categories (`Expenses.jsx:16`) |
| `/payments` | Payments | canViewPayments | Cash in/out ledger, reversals (`utils/accounting.js`) |
| `/payslips` | Payslips | canViewPayslips | basic + allowances - deductions, recurring generation, print (`Payslips.jsx:233-241`), pay from account |
| `/chart-of-accounts`, `/bank-cash`, `/bank-cash/:id`, `/journals` | Accounting | canViewAccounting | Balances come from `payments` (`BankCash.jsx:22-28`) |
| `/reports` | Reports | canViewReports | P&L, Balance Sheet, Cash Flow, Fee Collection. **Ignores branch**: `activeBranch` is a dependency but is never used to filter (`Reports.jsx:9-49`) |
| `/reminder-logs` | ReminderLogs | canViewReports | Lists `reminder_logs`. "Send Reminders Now" calls `/api/send-reminders` (`ReminderLogs.jsx:71`) |
| `/import` | Import | canManageUsers | XLSX/CSV for students, employees, invoices, expenses, accounts, payments. Inserts one row at a time (`Import.jsx:260-275`) |
| `/users`, `/access` | Users, AccessOverview | canManageUsers | Custom roles and per-user permission overrides |
| `/activity-log` | ActivityLog | admin | Client-written text log, latest 500 entries (`ActivityLog.jsx:19`), CSV export |
| `/trash` | Trash | any | Soft delete via `deleted_at` (`supabase/trash.sql`) |
| `/settings` | Settings | any | WhatsApp test and a "Quick Payment Link" |
| `/quick-payment` | QuickPayment | **public route** | Unauthenticated form for staff to log a paid invoice (`App.js:82`, `Settings.jsx:7,79`) |

### 2.2 Tables (`supabase/schema.sql` plus `accounting.sql` and `trash.sql`)
`users`, `branches`, `students`, `employees`, `invoices`, `expenses`, `payments`, `payslips`, `accounts`, `journals`, `custom_roles`, `reminder_logs`, `audit_log`. Every table has an `extra jsonb` catch-all, and the shim in `src/firebase.js:46-60` folds unknown fields into it. Dates are stored as `text` (`invoices.due_date`, `payments.date`, and others).

There are no tables for: classes/sections/subjects, academic years, attendance, exams, guardians/families, fee structures, discounts, admissions, leave, messages/templates/consent, transport, inventory, or certificates.

### 2.3 Permissions
- Four built-in roles: `admin`, `branch_manager`, `accountant`, `fee_collector` (`UserContext.jsx:9-117`). These are mirrored in SQL `has_perm` (`security.sql:46-92`). Custom roles live in `custom_roles`.
- Branch scope comes from `branch_visible()` (`security.sql:96-114`).
- There is no teacher, parent or student role.
- `canExport` is defined but never checked anywhere outside the permission editors (grep: only `UserContext.jsx`, `AccessOverview.jsx`, `Users.jsx`).

### 2.4 Integrations and platform
- **WhatsApp** Cloud API is called from the browser with `REACT_APP_WHATSAPP_TOKEN` (`utils/whatsapp.js:15-21`). Free-text messages only work inside Meta's 24h window. Template support exists but only `hello_world` uses it.
- **No server jobs.** The repo has no `api/` directory, and `vercel.json` rewrites every path to `/index.html`. So `/api/send-reminders` returns HTML, and the "automatic 8am run" promised in `ReminderLogs.jsx:162` does not exist.
- **Only one Edge Function**: `create-user`.
- **PWA**: there is a manifest, and `public/sw.js ` is registered (the filename has a trailing space). It precaches CRA dev chunk names (`/static/js/main.chunk.js`) that a production build does not produce.
- **Auth**: email/password plus a "PIN login" that derives the password as `pin + "_zmi_pin"` (`Login.jsx:49`). There is no MFA or SSO.
- **Currency** is hard-coded as "Rs." and phone numbers as `92...`. The deployment is single-country (Pakistan).

### 2.5 Reports that exist
P&L (YTD, all branches, months not split by year), Balance Sheet (opening balances only), Cash Flow (the same monthly series), Fee Collection (collected, pending, rate). There is **no** aging, defaulters, collection-by-branch, collection-by-collector, concession/scholarship, payroll register, or date-range filter.

---

## 3. Cross-cutting constraints that shape the roadmap

1. **Aggregation runs in the browser.** Dashboard, Reports, ReminderLogs and StudentLedger all download whole tables. New reports should be SQL views or RPCs (FEAT-037). Otherwise they will slow down as the data grows, and branch filtering stays inconsistent.
2. **There is no student lifecycle.** Students have no status, admission date or leaving date. Recurring invoices go to every student with `recurringFee` set (`Fees.jsx:197-213`), including students who have left, unless someone clears the flag.
3. **KPIs disagree between screens.** Dashboard "Pending" counts only `status === "pending"` at face `amount` (`Dashboard.jsx:40`). Reports subtracts `paidAmount` and `concessionAmount` and includes `partial` (`Reports.jsx:32-34`). Dashboard "Collected" uses `amount` of paid invoices, while Reports uses `paidAmount`.
4. **Secrets in the client** (WhatsApp token, `REACT_APP_CRON_SECRET`) block any trustworthy messaging feature until messaging moves server-side. Other agents (security, devops) will report this. Here it is listed as a dependency.
5. **Text dates and the `extra` jsonb** make new reporting harder. New modules should use typed columns from the start.

---

## 4. Findings

### A. Quick wins and reporting (existing data)

### [FEAT-001] Fee aging report and defaulters list
- Value: High
- Effort: L (~1-2d)
- Bucket: Now
- Location: `src/pages/Reports.jsx:53-58` (no such tab); `invoices` table
- Evidence: Reports has only P&L, BS, CF and Fee Collection tabs. Overdue is counted only as a number in `ReminderLogs.jsx:57-60` (`i.status === "pending" && new Date(i.dueDate) < today`). It ignores `partial` invoices and lists no students.
- Impact (user value): Gives branch managers a daily call list: who owes what, for how long (0-30, 31-60, 61-90, 90+ days), by branch and grade. Lets them act on dues before they go stale.
- Fix: Add a SQL view `v_invoice_balance` with `balance = amount - paid_amount - concession_amount` and `days_overdue = current_date - due_date::date`. Add RPC `aging_summary(branch)` that respects RLS. Add a Reports tab "Aging and Defaulters" grouped by student, with total due, oldest due, parent phone, and bulk "Remind" through FEAT-004. Export to CSV, gated by `canExport`.
- Depends on: `invoices`, `students` (parent_phone, grade, branch_id); FEAT-037
- Risks: Text `due_date` values with bad formats need a safe cast (`nullif`, regex). Concession-closed invoices must be excluded.
- Verified: yes (no aging or defaulter code exists; fields confirmed in `accounting.sql:25-35`)

### [FEAT-002] Collection by branch, month, account and collector, and make Reports respect the branch
- Value: High
- Effort: M
- Bucket: Now
- Location: `src/pages/Reports.jsx:13-49`; `payments` table
- Evidence: `fetchAll` reads every invoice and never applies `activeBranch` (the variable is only listed in the effect dependencies). The monthly series groups by `getMonth()` only, so different years are merged. There is no "collected by" field: grep for `collectedBy|createdBy|created_by` finds nothing.
- Impact (user value): The owner can compare branches, see which bank or cash account received money, and spot a fee collector whose cash does not reconcile.
- Fix: Build from `payments where source='invoice' and not reversed and reversal_of is null`. Group by `branch_id`, `account`, `date_trunc('month', date::date)`. Add a `created_by uuid default auth.uid()` column on `payments` and `invoices` so collector reports work from now on. Add a date-range picker and apply the branch filter on all Reports tabs.
- Depends on: `payments` (source, reversed, reversal_of, branch_id, account), `branches`
- Risks: Historical rows have no collector. Payments created by QuickPayment have no `payments` row at all (QuickPayment writes only an invoice, `QuickPayment.jsx:48-61`), so they will be missing from account-based totals. The accounting auditor should confirm this.
- Verified: yes

### [FEAT-003] Numbered fee receipts and fee vouchers (print and WhatsApp PDF)
- Value: High
- Effort: L (~2d)
- Bucket: Now
- Location: `src/utils/invoiceGenerator.js` (0 bytes); `src/pages/Fees.jsx` (no print action)
- Evidence: `invoiceGenerator.js` is empty. The only print features are list exports (`exportUtils.js:15-37`) and payslips (`Payslips.jsx:233-241`). Invoices have no sequential number.
- Impact (user value): Parents get a proof of payment and a fee voucher (challan) they can take to the bank, which is standard for Pakistani private schools. Auditors get receipt-number continuity.
- Fix: Add `receipt_no` from a per-branch Postgres sequence (or a `counters` table updated in an RPC), assigned when a payment is posted. Add a printable receipt and voucher template that reuses the payslip print pattern. Put branch name, address and bank details from `branches.extra` on it. Add an option to send the PDF link over WhatsApp (FEAT-004). Replace the hard-coded "ZMI" header in `Sidebar.jsx` and `exportUtils.js:29` with branch and settings data.
- Depends on: `invoices`, `payments`, `branches`, Storage (bucket exists for receipts)
- Risks: Numbering must be gap-free and safe under concurrent use, so assign it server-side, never on the client. Receipts for reversed payments must be shown as void.
- Verified: yes

### [FEAT-006] Make Dashboard KPIs consistent and add collection rate, overdue and month-on-month
- Value: High
- Effort: M
- Bucket: Now
- Location: `src/pages/Dashboard.jsx:39-40,67`
- Evidence: `collected = fees.filter(f => f.status === "paid").reduce(... f.amount)` and `pending = fees.filter(f => f.status === "pending")...`. This ignores `partial`, `paid_amount` and concessions, so it disagrees with Reports. "Branches" shows `stats.branches + 1`.
- Impact (user value): Leaders trust one set of numbers. The dashboard becomes the morning check: collected today and this month, outstanding, overdue over 30 days, collection rate by branch.
- Fix: Read KPIs from the same views as FEAT-001 and FEAT-002 (FEAT-037). Add cards for "Collected this month", "Outstanding", "Overdue >30d" and "Collection rate". Add a per-branch table for users who can see all branches.
- Depends on: FEAT-037, `invoices`, `payments`
- Risks: Numbers will change for users. Add a short release note.
- Verified: yes

### [FEAT-037] Server-side reporting layer (SQL views and RPCs)
- Value: High
- Effort: L (~2d)
- Bucket: Now
- Location: `Dashboard.jsx:21-27`, `Reports.jsx:15-20`, `ReminderLogs.jsx:51`, `StudentLedger.jsx:22-28`
- Evidence: Each of these screens calls `getDocs(collection(db, "invoices"))` or `onSnapshot` on whole tables and aggregates in JS. StudentLedger subscribes to **all** invoices and payments and then filters to one student.
- Impact (user value): Reports load fast, branch scoping is consistent (RLS applies inside views when they are created with `security_invoker = on`), and scheduled reports (FEAT-036) can reuse the same queries.
- Fix: Create `v_invoice_balance`, `v_collections`, `v_student_balance`, `v_payroll_register` with `security_invoker`. Expose parameterised RPCs. Point Dashboard, Reports and the ledger at them.
- Depends on: all finance tables
- Risks: `security definer` functions would bypass RLS by mistake, so use invoker views. Text dates need casting.
- Verified: yes

### B. Finance extras

### [FEAT-004] Server-side automated fee reminders (scheduled job)
- Value: High
- Effort: L (~2-3d)
- Bucket: Now
- Location: `src/pages/ReminderLogs.jsx:68-89,162`; `src/utils/whatsapp.js:15-54`; `vercel.json`
- Evidence: The UI promises "Daily automatic fee reminders" and "the automatic 8am run". The button calls `fetch("/api/send-reminders")` with `REACT_APP_CRON_SECRET`, but no API route exists and `vercel.json` rewrites everything to `index.html`. Manual reminders send **free-text** messages (`Fees.jsx:307`), which Meta rejects outside the 24h window, as `Fees.jsx:310` admits.
- Impact (user value): Reminders go out daily without anyone clicking, which is the cheapest way to improve collections. Delivery status is logged.
- Fix: Add a Supabase Edge Function `send-reminders` triggered by `pg_cron` and `pg_net`. It reads overdue balances from FEAT-001's view, sends an **approved WhatsApp template** with variables (name, amount, month, due date, receipt or voucher link), writes `reminder_logs` (status, provider message id, invoice id), throttles to one reminder per invoice per N days, and respects opt-out (FEAT-005). Move the WhatsApp token to Edge Function secrets and remove the `REACT_APP_WHATSAPP_*` and `REACT_APP_CRON_SECRET` variables. Optionally add a Meta delivery webhook to update status. SMS fallback can come later.
- Depends on: `invoices`, `students.parent_phone`, `reminder_logs`; FEAT-001, FEAT-005
- Risks: Meta template approval lead time. Spamming parents creates a reputational risk. Messages must stop once a payment is recorded. Per-branch WhatsApp numbers may be needed.
- Verified: yes (no `api/` directory, rewrite confirmed)

### [FEAT-007] Fee structure templates (by grade, branch and year) and late fee rules
- Value: High
- Effort: L (~3d)
- Bucket: Next
- Location: `Fees.jsx:18-19` (`LINE_ITEM_PRESETS` hard-coded); `students.monthly_fee`
- Evidence: Recurring generation uses each student's own `monthlyFee` as a single "Tuition Fee" line (`Fees.jsx:207-209`). There is no concept of fee heads, a grade fee schedule, annual or admission fees, or late fees.
- Impact (user value): Raising fees for a grade or year becomes one edit instead of editing hundreds of students. It also gives consistent billing for exam, transport and admission fees, and automatic late fines.
- Fix: Add tables `fee_heads` (name, GL account, frequency) and `fee_structures` (academic_year, branch, grade/class, head, amount, due day). Add an optional `student_fee_overrides`. Generate invoices from the structure instead of `monthly_fee`. Add a late-fee rule (flat or per day after the due day) applied by the FEAT-004 job as a separate line or invoice.
- Depends on: `invoices`, `students`, `accounts`; FEAT-017 (class or grade master)
- Risks: Migrating `monthly_fee` values that differ per student needs a per-student override, otherwise families get rebilled at the wrong rate. Late fees need a clear waiver path.
- Verified: yes

### [FEAT-008] Scholarships and sibling discounts (planned, not ad hoc concessions)
- Value: High
- Effort: L (~2d)
- Bucket: Next
- Location: `Fees.jsx:244-279`; `invoices.concession_amount`, `concession_note`
- Evidence: The only discount is a payment-time "concession" that writes off the remaining balance (`Fees.jsx:245`). There is no family or guardian link between siblings (`students.parent_name` and `parent_phone` are free text).
- Impact (user value): Discounts are approved once and applied every month. The institute can report scholarship cost by type (merit, need, sibling, staff child), which matters for a non-profit institute.
- Fix: Add tables `families` (or `guardians`) with `student_guardians`, `discount_policies` (percent or fixed, head scope, sibling rank rule), and `student_discounts` (policy, start and end, approved_by). Apply them at invoice generation as negative line items. Keep `concession_amount` for one-off write-offs. Add a "Concessions and scholarships" report.
- Depends on: `students`, `invoices`; FEAT-007
- Risks: Grouping families from free-text phone numbers needs a deduplication step (`parent_phone` is a decent first key). Approval controls are needed to prevent abuse.
- Verified: yes

### [FEAT-009] Instalment plans for annual and admission fees
- Value: Med
- Effort: L (~2d)
- Bucket: Next
- Location: `invoices` (one row per month)
- Evidence: Monthly invoices already work as instalments, and partial payments exist (`status: partial`, `paid_amount`). No plan splits a lump sum (admission or annual charges) into scheduled parts.
- Impact (user value): Lets the school offer "pay admission in 3 parts" without tracking it by hand.
- Fix: Add an `instalment_plans` table (invoice_id or fee_head, n parts, schedule) that generates child invoices with their own due dates and links them back to a parent invoice.
- Depends on: `invoices`; FEAT-007
- Risks: Parent and child invoice totals must reconcile, and aging must use the child due dates.
- Verified: yes

### [FEAT-013] Refunds and credit notes
- Value: Med
- Effort: L (~2d)
- Bucket: Next
- Location: `src/utils/accounting.js:103-135`
- Evidence: The only way to return money is to delete the source document, which posts reversals (`reverseSourcePayments`). There is no refund document, reason or approval, and no carry-forward credit for overpayment.
- Impact (user value): Correctly handles withdrawals mid-term, security deposit returns and overpayments, with an audit trail.
- Fix: Add a `credit_notes` table (student, amount, reason, approved_by, applied_to_invoice or refunded_via_account). A refund posts a `cash_out` payment with `source='refund'`. Student balance shows available credit, and new invoices can use it.
- Depends on: `payments`, `invoices`, `accounts`
- Risks: Refunds are a fraud vector, so use maker-checker approval (FEAT-040 logs it).
- Verified: yes

### [FEAT-012] Payment instructions and QR on vouchers (before a full gateway)
- Value: Med
- Effort: M
- Bucket: Next
- Location: `Settings.jsx:76-88` (the existing "Quick Payment Link" is for staff only)
- Evidence: The "Quick Payment Link" is a public, unauthenticated staff entry form (`/quick-payment`). It is not a parent payment link. There is no QR code, bank detail block or payer reference.
- Impact (user value): Parents can pay by bank transfer, Raast or wallet using a per-invoice reference on the voucher, so manual matching gets easier.
- Fix: Store branch bank details and a static QR image in `branches.extra`. Print a unique payer reference (receipt or voucher number from FEAT-003) on vouchers and WhatsApp messages. Reconcile by reference in FEAT-014.
- Depends on: FEAT-003, `branches`
- Risks: Manual confirmation is still needed. The public `/quick-payment` route should be reviewed by the security auditor and is not a model to extend.
- Verified: yes

### [FEAT-011] Online payment gateway (JazzCash / Easypaisa / 1Bill / card)
- Value: High (long term)
- Effort: L (~2-3 weeks including merchant onboarding)
- Bucket: Later
- Location: none
- Evidence: There is no gateway, webhook endpoint or payment-intent table. Pakistani competitors advertise JazzCash, Easypaisa and 1Bill as table stakes (see Sources).
- Impact (user value): Parents can pay 24/7. Payments post automatically and reconcile with no data entry, which shortens debtor days.
- Fix: Add a `payment_intents` table (invoice, amount, provider, status, provider_ref). Add an Edge Function to create the intent or redirect and another for the **signed webhook**. On success, call `recordPayment` server-side (`source='gateway'`) and update the invoice. Start with 1Bill voucher numbers (they fit FEAT-003 vouchers).
- Depends on: FEAT-003, FEAT-004, FEAT-028 (or WhatsApp links); `invoices`, `payments`
- Risks: Webhook spoofing, double posting (needs idempotency keys), merchant KYC and fees, refunds through the provider.
- Verified: yes (absence)

### [FEAT-014] Bank reconciliation
- Value: Med
- Effort: L (~3d)
- Bucket: Next
- Location: `BankCash.jsx:22-28`, `AccountDetail.jsx`; `payments`
- Evidence: Account balances are computed as opening balance plus or minus payments. There is no reconciled flag, statement import or matching.
- Impact (user value): The accountant can prove that the system's bank balance matches the bank statement, and catch missing deposits from fee collectors.
- Fix: Add `payments.reconciled_at` and `statement_line_id`. Add a `bank_statement_lines` table imported via the existing `xlsx` dependency (Import.jsx pattern). Auto-match on amount, date (±3 days) and reference, then confirm manually. Add a reconciliation summary per account and month.
- Depends on: `payments`, `accounts`; FEAT-003 references
- Risks: Every bank uses a different CSV format, so add per-bank column mapping (Import's alias mapper can be reused).
- Verified: yes

### [FEAT-015] Budgets per branch and expense category
- Value: Low
- Effort: L (~2d)
- Bucket: Later
- Location: `Expenses.jsx:16` (categories hard-coded)
- Evidence: Categories are a constant array. There is no budget table or budget-vs-actual report.
- Impact (user value): Branch spending control and annual planning.
- Fix: Move categories to a table (or map them to `accounts`). Add `budgets` (year, branch, category, amount) and a budget-vs-actual report from `expenses` and `payslips`.
- Depends on: `expenses`, `payslips`, `branches`
- Risks: Low adoption if categories stay loose.
- Verified: yes

### [FEAT-016] Tax handling (withholding on fees and payroll income tax)
- Value: Low
- Effort: L (~2d)
- Bucket: Later
- Location: none
- Evidence: There are no tax fields on invoices or payslips.
- Impact (user value): Compliance support if the institute must collect advance tax on high annual fees or withhold salary tax. This has to be confirmed with the institute's tax advisor. I have not checked current law.
- Fix: Add an optional tax line rule in fee structures (FEAT-007) and tax slabs for payroll (FEAT-025), plus a tax summary report. E-invoicing is not in scope.
- Depends on: FEAT-007, FEAT-025
- Risks: Legal correctness. Treat this as configuration, not hard-coded rates.
- Verified: no (legal applicability not verified)

### B-skip. Multi-currency: skipped
Every amount is hard-coded "Rs." and phone numbers assume `92`. A single-country, multi-branch school gains nothing from multi-currency, so formatting is better handled as part of FEAT-045 (locale).

### C. Academic

### [FEAT-017] Classes, sections, subjects and academic years (master data)
- Value: High
- Effort: L (~3d)
- Bucket: Next (start of Phase 2)
- Location: `students.grade` (free text, `schema.sql:58`); `Students.jsx:56`
- Evidence: Grades are taken from whatever text exists (`[...new Set(rows.map(s => s.grade))]`). There are no section, subject or academic-year tables.
- Impact (user value): The base for attendance, exams, timetable, promotion, fee structures and teacher assignment. It also gives clean grade-level reporting right away.
- Fix: Add tables `academic_years` (name, start, end, is_current), `classes` (branch, name, order), `sections` (class, name, class_teacher employee_id), `subjects`, `class_subjects`, and `enrollments` (student, academic_year, section, roll_no, status). Backfill from `students.grade`.
- Depends on: `students`, `branches`, `employees`
- Risks: Backfilling messy grade strings needs a mapping UI. RLS must follow the same `branch_visible` pattern.
- Verified: yes

### [FEAT-018] Student lifecycle status and academic-year promotion/rollover
- Value: High
- Effort: L (~2d)
- Bucket: Next
- Location: `Fees.jsx:197-213`; `students` table
- Evidence: Students have no status (active, left, graduated, transferred) and no admission or leaving date. Recurring billing includes every `recurringFee` student. The only "removal" is Trash (soft delete), which also hides history.
- Impact (user value): Year-end becomes one guided action: promote passing students, mark leavers, archive the year. Billing stops automatically for leavers.
- Fix: Add `students.status`, `admission_date`, `leaving_date`, `leaving_reason`. Add a promotion wizard per section that creates next-year `enrollments` rows in bulk, with detain and leave exceptions. Filter recurring generation to `status='active'`. TC issue (FEAT-031) sets the status to left.
- Depends on: FEAT-017; `students`, `invoices`
- Risks: Irreversible bulk changes need a dry-run preview and an undo window. Outstanding dues must be shown before marking a student as left.
- Verified: yes

### [FEAT-019] Student attendance (daily, per section) with absence alerts
- Value: High
- Effort: L (~3d)
- Bucket: Next
- Location: none
- Evidence: There is no attendance table or page, and no teacher role exists (`UserContext.jsx:9-14`).
- Impact (user value): Parents ask for this most often, and it improves safety (same-day absence WhatsApp). It also feeds report cards and lets the school spot dropout risk.
- Fix: Add an `attendance` table (date, section, student, status P/A/L/Leave, marked_by) with a unique index on (date, student). Add a mobile-first marking screen (all present by default, tap exceptions), a `teacher` role scoped to assigned sections (FEAT-026), a monthly register report, and an absence template through FEAT-004/005.
- Depends on: FEAT-017, FEAT-026; `students`, `users`
- Risks: RLS needs a new per-section scope, not only per-branch. High write volume needs indexes. Marking must work on poor connections (a small offline queue could help).
- Verified: yes (absence)

### [FEAT-020] Admissions funnel (enquiry, test, offer, admitted)
- Value: Med
- Effort: L (~3d)
- Bucket: Next
- Location: `Fees.jsx:19` ("Registration Fee" preset exists)
- Evidence: Students are created directly. There is no enquiry or applicant stage, source tracking, or conversion reporting.
- Impact (user value): Branch-level admission pipeline, follow-ups and conversion rate, which is revenue planning for a private school. It also auto-raises the registration fee invoice.
- Fix: Add an `admissions` table (branch, applicant details, guardian, class sought, stage, source, test score, follow_up_at). A public enquiry form (rate-limited, captcha) can come later. A "Convert to student" action creates the `students`, `enrollments` and registration invoice.
- Depends on: `students`, `invoices`; FEAT-017
- Risks: A public form is an abuse and spam vector. Applicant personal data needs a retention policy.
- Verified: yes (absence)

### [FEAT-021] Exams, marks entry and report cards
- Value: Med
- Effort: L (~1-2 weeks)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Term results, printable report cards, grade analytics per branch. Competitors list this as standard.
- Fix: Add tables `exams` (year, term, class), `exam_subjects` (max marks), `marks` (student, subject, marks, grade), and a grading scale. Add a report card template (reuse the FEAT-003 print engine) and publish to the parent portal (FEAT-028).
- Depends on: FEAT-017, FEAT-026
- Risks: Grading schemes vary by branch or class. Results must be locked after publishing.
- Verified: yes (absence)

### [FEAT-022] Timetable
- Value: Low
- Effort: L (~1 week)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): A period grid per section and teacher, with clash detection. Useful but not urgent for a finance-led product.
- Fix: Add `periods` and `timetable_slots` (section, day, period, subject, teacher). Start with manual entry and a clash check. Auto-scheduling is out of scope.
- Depends on: FEAT-017, FEAT-026
- Risks: Scope creep (auto-generation).
- Verified: yes (absence)

### [FEAT-023] Homework and class diary
- Value: Low
- Effort: L (~3d)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Daily diary for parents. It only matters once a parent channel exists.
- Fix: Add a `diary_entries` table (section, subject, date, text, attachment) published to the portal or WhatsApp digest.
- Depends on: FEAT-017, FEAT-028
- Risks: Teacher adoption.
- Verified: yes (absence)

### D. People

### [FEAT-024] Staff attendance and leave management
- Value: Med
- Effort: L (~3d)
- Bucket: Next
- Location: `employees` (name, role, salary, joinDate in `extra`)
- Evidence: There are no attendance or leave tables. Payslip deductions are typed by hand (`Payslips.jsx:18,185`).
- Impact (user value): Correct leave balances and unpaid-leave deductions fed into payroll, plus visibility of staff absence per branch.
- Fix: Add tables `staff_attendance` (date, employee, status, in and out times), `leave_types`, `leave_requests` (approval by branch manager), `leave_balances`. A monthly summary feeds FEAT-025.
- Depends on: `employees`, `payslips`, `users`
- Risks: Staff need a login or kiosk to self-mark. Biometric integration is Later.
- Verified: yes

### [FEAT-025] Payroll automation (salary structure, leave-linked deductions, bank advice)
- Value: Med
- Effort: L (~3d)
- Bucket: Next
- Location: `Payslips.jsx:185,205-215`
- Evidence: Recurring payslips copy `emp.salary` into `basicSalary` with `allowances: 0, deductions: 0`. There are no structured heads (house rent, conveyance, advances, loan recovery, tax) and no bank transfer file or payroll register report.
- Impact (user value): Month-end payroll goes from manual edits to a single run. Staff loan and advance recovery is tracked. A bank advice sheet is produced for bulk transfer.
- Fix: Add `salary_components` and `employee_salary_structure`, plus `staff_advances` with recovery schedule. The run applies the leave deductions from FEAT-024. Export a payroll register and bank advice (xlsx). Post to accounts through `recordPayment`.
- Depends on: `employees`, `payslips`, `payments`, `accounts`; FEAT-024
- Risks: Payroll errors are sensitive, so keep a draft, review and approve flow. Store salary data in typed columns, not `extra`.
- Verified: yes

### [FEAT-026] Teacher assignments and a teacher role
- Value: Med
- Effort: M
- Bucket: Next (with FEAT-019)
- Location: `UserContext.jsx:9-14`, `security.sql:60-78`
- Evidence: There is no teacher role, and employees are not linked to users or sections.
- Impact (user value): Teachers can mark attendance and enter marks for their own sections only.
- Fix: Add `employees.user_id` and `section_teachers` (section, subject, employee). Add a `teacher` built-in role and an RLS helper `teaches_section(section_id)`.
- Depends on: FEAT-017; `employees`, `users`
- Risks: The RLS helper must stay cheap (indexed lookup) because it runs on every attendance row.
- Verified: yes

### [FEAT-027] Staff performance reviews
- Value: Low
- Effort: L (~2d)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Appraisal records tied to increments. Low priority for this product stage.
- Fix: Add a `reviews` table (employee, period, rubric jsonb, reviewer, outcome) linked to salary-structure changes.
- Depends on: FEAT-025
- Risks: Confidentiality, so it needs a separate permission.
- Verified: yes (absence)

### E. Communication

### [FEAT-005] Message templates, parent consent/opt-out and bulk messaging
- Value: High
- Effort: L (~2d)
- Bucket: Next
- Location: `Fees.jsx:157,188,286-290,307`; `QuickPayment.jsx:63-66`
- Evidence: Message text is hard-coded in several places, in English only, as free text. There is no consent or opt-out record, and no way to message a class, grade or branch.
- Impact (user value): One place to edit wording, including Urdu versions. The school can prove consent, honour opt-outs, and send notices (closures, events) to selected groups.
- Fix: Add `message_templates` (key, channel, language, body, Meta template name, variables), `contact_preferences` (guardian or phone, channel, opted_in, opted_in_at, source), and a `messages` outbox processed by the FEAT-004 function with rate limiting. Add a bulk-send UI that filters by branch, class, section or defaulters.
- Depends on: `students`, `reminder_logs`; FEAT-004, FEAT-008 (families)
- Risks: Meta policy on marketing versus utility templates. Data-protection obligations (the ux-compliance agent covers this). Cost per message.
- Verified: yes

### [FEAT-029] Notices and circulars
- Value: Med
- Effort: M
- Bucket: Next
- Location: none
- Evidence: Absent.
- Impact (user value): Staff and parent announcements with a history ("what did we send about exams?").
- Fix: Add a `notices` table (audience scope, title, body, attachment, publish_at). Deliver through FEAT-005 now and show in the portal later.
- Depends on: FEAT-005
- Risks: Low.
- Verified: yes (absence)

### [FEAT-028] Parent portal (PWA) with read-only fees, receipts, attendance and results
- Value: High (long term)
- Effort: L (~2-3 weeks)
- Bucket: Later
- Location: none; auth is staff-only (`create-user` requires admin, signups disabled per README)
- Evidence: There is no parent role or guardian table, and RLS is purely role plus branch (`security.sql:96-114`).
- Impact (user value): Parents can see dues, download receipts, pay online (FEAT-011), and see attendance and report cards. This cuts front-desk calls and is the main differentiator against local competitors.
- Fix: Add guardian accounts (magic link or WhatsApp OTP login) linked through `student_guardians`, a `parent` role, and RLS `is_guardian_of(student_id)` on invoices, payments, attendance and marks. Build a separate lightweight route tree. Never expose staff tables.
- Depends on: FEAT-008 (families), FEAT-003, FEAT-019, FEAT-021, FEAT-011
- Risks: A brand-new RLS scope where one policy mistake leaks other children's data. Needs a dedicated security review and tests. Support load for parent logins.
- Verified: yes (absence)

### F. Operations

### [FEAT-031] Certificates: transfer/leaving (TC), bonafide, character, fee clearance
- Value: Med
- Effort: L (~1-2d)
- Bucket: Next
- Location: none; ledger balance available (`StudentLedger.jsx:36-41`)
- Evidence: Absent.
- Impact (user value): Front-office paperwork in a few clicks with serial numbers. A TC is blocked when dues are outstanding, which protects revenue.
- Fix: Add `certificates` (type, student, serial_no, issued_by, data jsonb) and printable templates (FEAT-003 engine). TC issue checks the balance view and sets student status (FEAT-018).
- Depends on: `students`; FEAT-003, FEAT-018, FEAT-037
- Risks: Forgery, so add a serial and a verification QR. Wording may be regulated by the board.
- Verified: yes (absence)

### [FEAT-032] Student and staff ID cards
- Value: Med
- Effort: M
- Bucket: Next
- Location: none; Storage is already used for receipts (`src/lib/storage.js`)
- Evidence: There is no photo field or card layout.
- Impact (user value): Batch-print cards per section with photo, ID and guardian phone. A QR on the card can later drive attendance (FEAT-019).
- Fix: Add `students.photo_url` and `employees.photo_url` (private bucket with signed URLs) and a CR80 print layout per section.
- Depends on: `students`, `employees`; FEAT-017
- Risks: Photos of minors: use a private bucket, not the public receipts bucket.
- Verified: yes

### [FEAT-030] Transport (routes, stops, vehicles, student assignment, auto fee)
- Value: Med
- Effort: L (~3d)
- Bucket: Later
- Location: `Fees.jsx:19` ("Transport Fee" preset); `Expenses.jsx:16` ("Transport" category)
- Evidence: Transport exists only as a fee label and an expense category.
- Impact (user value): Route-wise student lists, driver contact, transport fee generated from route or stop, and transport cost versus revenue per route.
- Fix: Add `routes`, `stops`, `vehicles`, `student_transport` (student, stop, from, to). Fee structures (FEAT-007) pick up the transport head.
- Depends on: FEAT-007; `students`, `expenses`
- Risks: GPS tracking is out of scope.
- Verified: yes

### [FEAT-035] Inventory and sales (uniforms, books, stationery)
- Value: Low
- Effort: L (~3d)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Many private schools sell books and uniforms. Stock and sales would post as invoice lines.
- Fix: Add `items`, `stock_moves`, and an invoice line referencing an item.
- Depends on: `invoices`, `expenses`
- Risks: Stock accuracy needs discipline.
- Verified: yes (absence)

### [FEAT-034] Library
- Value: Low
- Effort: L (~3d)
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Catalogue, issue/return, fines.
- Fix: Add `books`, `book_copies`, `loans`. Fines become invoice lines.
- Depends on: `students`, `invoices`
- Risks: Low value relative to effort.
- Verified: yes (absence)

### [FEAT-033] Student health records
- Value: Low
- Effort: M
- Bucket: Later
- Location: none
- Evidence: Absent.
- Impact (user value): Allergies, conditions and emergency contacts available to staff during incidents.
- Fix: Add a `student_health` table with its own permission (`canViewHealth`) and audit-on-read.
- Depends on: `students`
- Risks: Special-category personal data about minors. Do not put it in `extra` jsonb, which is visible to anyone with `canViewStudents`.
- Verified: yes (absence)

### F-skip. Hostel: skipped unless ZMI runs boarding
Nothing in the code suggests boarding. If the institute has a boarding section, treat it as Later and model it like transport (rooms, beds, allocation, hostel fee head).

### G. Platform

### [FEAT-039] 2FA for staff and retire PIN login; optional Google SSO
- Value: High
- Effort: L (~1-2d)
- Bucket: Now
- Location: `src/pages/Login.jsx:23-55`; `users.pin` column
- Evidence: PIN mode loads users that have a PIN, compares the PIN in the browser, then signs in with `user.pin + "_zmi_pin"` as the password (`Login.jsx:49`). There is no MFA anywhere.
- Impact (user value): Fee and payroll data protected by a second factor, and admins get TOTP. Google Workspace SSO is an option if the school uses it.
- Fix: Turn on Supabase Auth MFA (TOTP) and require it for admin and accountant (check `aal2` in RLS for sensitive writes). Replace PIN login with remembered-device or passkey login, or remove it. Drop `users.pin`.
- Depends on: `users`, Supabase Auth
- Risks: Locked-out users need an admin reset flow. This overlaps with the security-auditor findings; defer to them on severity.
- Verified: yes

### [FEAT-040] Granular audit (server-side triggers with before/after diff)
- Value: Med
- Effort: L (~1-2d)
- Bucket: Next
- Location: `src/utils/auditLog.js:41-55`; `security.sql:341-347`
- Evidence: Audit rows are written by the client (`logActivity`), are fire-and-forget, take `user` from the client, and store free-text `details`. Any write made directly through the API skips logging. The view shows the latest 500 rows.
- Impact (user value): Answers "who changed this invoice amount and from what" with confidence, including after-the-fact fraud checks.
- Fix: Add a generic `audit_trigger()` on finance tables that writes `table, row_id, op, old jsonb, new jsonb, actor auth.uid(), at`. Keep `logActivity` for human-readable events. Add server-side paging and filtering by record.
- Depends on: `audit_log` and all finance tables
- Risks: Storage growth, so partition or archive by month. PII in diffs.
- Verified: yes

### [FEAT-036] Scheduled reports (daily collection summary, weekly defaulters to owners and branch heads)
- Value: Med
- Effort: M
- Bucket: Next
- Location: none
- Evidence: There is no scheduler. Every report is on-screen only.
- Impact (user value): The owner gets "Yesterday: Rs X collected per branch, Rs Y overdue" on WhatsApp or email without logging in.
- Fix: Reuse the FEAT-004 cron and Edge Function to query FEAT-037 views, add a `report_subscriptions` table (user, report, schedule, channel), and send through email (Resend or SMTP) or a WhatsApp template.
- Depends on: FEAT-004, FEAT-037
- Risks: Sending financial data over WhatsApp or email, so keep summaries aggregate.
- Verified: yes (absence)

### [FEAT-041] Import/export hardening: dry-run validation, upsert by key, enforce `canExport`
- Value: Med
- Effort: M
- Bucket: Now (enforcing `canExport` is part S)
- Location: `src/pages/Import.jsx:253-275`; `canExport` unused
- Evidence: Import inserts rows one at a time with `addDoc`, with no duplicate detection (for example the same `student_id`) and no update mode. `canExport` is editable in AccessOverview and Users but never checked, so CSV/PDF buttons show for everyone with view access.
- Impact (user value): Safe bulk onboarding of a new branch (no duplicates), annual fee updates through spreadsheet, and real control over who can take data out.
- Fix: Add a validation pass (required fields, duplicates against the DB, branch exists), a batch `upsert` on a natural key, and an error file download. Wrap every `exportToCSV` and `exportToPDF` call in `can("canExport")` and log exports to the audit log.
- Depends on: all imported tables
- Risks: Upsert by a free-text key can overwrite the wrong record, so show a preview diff first.
- Verified: yes

### [FEAT-042] Backups and restore drill, plus "export my data"
- Value: High
- Effort: M
- Bucket: Now
- Location: README (no backup section)
- Evidence: The README covers setup and deploy but says nothing about backups. Trash only covers soft deletes, and "Empty trash" hard-deletes.
- Impact (user value): Recovery from a bad bulk delete, a bad import or an account compromise. This is basic diligence for financial records.
- Fix: Confirm the Supabase plan's PITR and daily backups. Add a weekly scheduled `pg_dump` to off-platform storage, a documented quarterly restore test, and an admin "Full export (xlsx)" built on the existing `xlsx` dependency.
- Depends on: all tables
- Risks: Backups contain PII, so encrypt them and restrict access. Overlaps with devops-deps-auditor.
- Verified: yes (absence in repo; Supabase project settings not checked)

### [FEAT-043] Fix the PWA service worker; offline fee entry later
- Value: Med (fix) / Low (offline)
- Effort: M (fix) / L (~1 week, offline)
- Bucket: Now (fix) / Later (offline)
- Location: `public/sw.js ` (trailing space in filename), `src/index.js:13-18`
- Evidence: The SW precaches `"/static/js/main.chunk.js"` and `"/static/css/main.chunk.css"`, which are CRA dev names. Production emits hashed `main.<hash>.js`. With the catch-all rewrite, those URLs return `index.html`. The fetch handler is cache-first for everything, including `/` and Supabase API GETs, so users may keep getting a stale shell after deploys. `CACHE_NAME` is fixed at `zmi-v1`.
- Impact (user value): Reliable installs on staff phones and no "old version" bugs. Real offline fee entry would help collectors in branches with poor connectivity.
- Fix: Replace it with CRA's Workbox `service-worker.js` or a network-first strategy for navigation, never cache API calls, and version the cache per build. Offline (Later): an IndexedDB queue for attendance and fee receipts, with server-side idempotency keys.
- Depends on: none (fix); FEAT-003 numbering and idempotency (offline)
- Risks: Offline money entry risks double posting. Do not attempt it without server-generated receipt numbers.
- Verified: no (stale-cache behaviour inferred from the code, not reproduced in a browser)

### [FEAT-038] In-app notifications
- Value: Low
- Effort: M
- Bucket: Later
- Location: Realtime is already enabled for all tables (`supabase/realtime.sql`)
- Evidence: Only toasts for the user's own actions.
- Impact (user value): "Leave request awaiting approval", "Refund needs approval", "Import finished".
- Fix: Add a `notifications` table (user, type, payload, read_at) plus a bell in `Navbar.jsx`, using the existing realtime channel.
- Depends on: FEAT-024, FEAT-013 (sources of events)
- Risks: Low.
- Verified: yes

### [FEAT-044] API and webhooks for integrations
- Value: Low
- Effort: L (~2d)
- Bucket: Later
- Location: none (PostgREST is implicitly available)
- Evidence: There are no outbound webhooks or service accounts.
- Impact (user value): Lets the school connect accounting software, a biometric device or a website enquiry form.
- Fix: Inbound: dedicated Edge Functions per integration (gateway in FEAT-011, enquiry form in FEAT-020, biometric). Outbound: Supabase Database Webhooks on `payments` inserts. Do not hand out the anon key as an "API".
- Depends on: FEAT-011, FEAT-020
- Risks: Secret management and replay protection.
- Verified: yes (absence)

### [FEAT-045] Multi-language (Urdu, RTL) and locale formatting
- Value: Med (parent-facing) / Low (staff UI)
- Effort: L (~1 week for staff UI); M for message templates only
- Bucket: Later (templates in Urdu come earlier through FEAT-005)
- Location: every page has inline English strings; `index.html` `lang="en"`
- Evidence: There is no i18n library. "Rs." and `toLocaleString()` are spread across pages.
- Impact (user value): Urdu messages and receipts for parents. Staff UI translation matters less.
- Fix: Do Urdu message templates and receipts first (FEAT-005, FEAT-003). Later add `react-i18next` with an RTL stylesheet and a central `formatMoney()`.
- Depends on: FEAT-005, FEAT-003
- Risks: Inline styles make RTL harder.
- Verified: yes

---

## 5. Three quick wins using existing data

These need **no new modules**, only views and UI over `invoices`, `payments`, `students` and `branches`:

1. **Aging and defaulters list (FEAT-001).** Group `invoices` balance (`amount - paid_amount - concession_amount`) by student and `due_date` bucket, filtered by branch and grade, with parent phone and one-click remind. This gives a daily collection call list.
2. **Collection by branch, month and account (FEAT-002).** Group `payments` (`source='invoice'`, net of reversals) by `branch_id`, `account` and month. Also fix the Reports page so it actually applies the branch selector and splits months by year.
3. **Numbered printable receipts (FEAT-003).** Use the existing invoice and payment rows and the payslip print pattern. Parents get proof of payment, and receipt-number continuity gives a basic fraud control.

Runner-up: a **concession and scholarship cost report** from `invoices.concession_amount` and `concession_note` (the data already exists; Reports only shows the total).

---

## 6. Recommended 3-phase roadmap

### Phase 1: "Collect what is owed, trust the numbers" (Now, about 4-6 weeks)
- FEAT-037 reporting views, then FEAT-001 aging and defaulters, FEAT-002 collection by branch, FEAT-006 consistent KPIs
- FEAT-003 numbered receipts and vouchers
- FEAT-004 server-side reminder job (moves the WhatsApp token off the client)
- FEAT-039 MFA and retiring PIN login; FEAT-041 enforce `canExport` plus import validation
- FEAT-042 backups and restore drill; FEAT-043 service-worker fix

Exit criteria: owners see branch-level outstanding and collections every morning, reminders send themselves, and every rupee has a receipt number.

### Phase 2: "Academic backbone and smarter billing" (Next, about 1 quarter)
- FEAT-017 classes, sections and academic years, then FEAT-018 status and promotion, then FEAT-026 teacher role
- FEAT-007 fee structures and late fees, FEAT-008 sibling and scholarship discounts (with families), FEAT-009 instalments, FEAT-013 refunds
- FEAT-019 student attendance with absence alerts; FEAT-024 staff attendance and leave, then FEAT-025 payroll automation
- FEAT-005 templates, consent and bulk messaging; FEAT-029 notices; FEAT-036 scheduled reports
- FEAT-031 certificates, FEAT-032 ID cards, FEAT-020 admissions funnel
- FEAT-012 payment references and QR on vouchers, then FEAT-014 bank reconciliation; FEAT-040 trigger-based audit

Exit criteria: year-end rollover takes one guided step, invoices come from fee structures, and attendance runs daily in every branch.

### Phase 3: "Parents online" (Later, 2 quarters or more)
- FEAT-028 parent portal (PWA) with FEAT-011 online payments (1Bill, JazzCash, Easypaisa)
- FEAT-021 exams and report cards, FEAT-022 timetable, FEAT-023 diary
- FEAT-030 transport, FEAT-035 inventory, FEAT-034 library, FEAT-033 health records
- FEAT-015 budgets, FEAT-016 tax configuration, FEAT-044 webhooks, FEAT-045 Urdu UI, FEAT-038 notifications, offline mode (FEAT-043 later part), FEAT-027 reviews

Skipped: multi-currency (single country), e-invoicing, hostel (unless boarding is confirmed).

---

## 7. Notes for other auditors (observed while inventorying, not deep-dived)
- `/quick-payment` is a **public** route that reads `students` and inserts `invoices` (`App.js:82`, `QuickPayment.jsx:26-61`). It also writes no `payments` row, so account balances miss these collections. Security and accounting auditors should check this.
- WhatsApp token and `REACT_APP_CRON_SECRET` are bundled into client JS (`whatsapp.js:17-19`, `ReminderLogs.jsx:74`).
- `UserContext.jsx:139-158` falls back to role `admin` when the profile is missing or fails to load (the UI only; RLS still applies).
- StudentLedger balance ignores `concession_amount` (`StudentLedger.jsx:36-41`).

## Sources (comparables, used sparingly)
- [Student Care: School Management and Fee System (1Bill partner)](https://www.studentcare.pk/)
- [Smart Campus: Fee Management Software in Pakistan](https://smartcampuspk.com/fee-management-software)
- [Skoo: Pakistan school ERP (WhatsApp reminders, JazzCash/Easypaisa, offline sync)](https://skoo.pk/)
- [SchoolDost.Cloud: attendance, online fees, report cards, ID cards, parent app](https://schooldost.cloud/)
- [EduSuite: Best School Management Software in Pakistan 2026](https://www.edusuite.pk/blog/best-school-management-software-in-pakistan/)
- [Fedena: School Fees Management (defaulters report, reminders, discounts)](https://fedena.com/feature-tour/school-fees-management-system)
- [Fuzen: Fedena alternative (sibling discount limitations)](https://www.fuzen.io/posts/best-fedena-alternative-for-school-management-in-2026)
