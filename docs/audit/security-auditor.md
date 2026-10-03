# Security audit: ZMI School ERP

Agent: `security-auditor` | Date: 2026-10-03 | Scope: `supabase/*.sql`, `supabase/functions/create-user`, `src/**`, `vercel.json`, `README.md`, git history, `npm audit`.

Question answered: *can someone read or change data they shouldn't?*

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 8 |
| Low | 6 |
| Info | 3 |
| **Total** | **22** |

The design is sound: RLS in Postgres, with helpers that are `SECURITY DEFINER` and set a `search_path`. The weak points are:
1. A secret is shipped to every browser.
2. A stored XSS can turn any data-entry role into an admin.
3. Financial rows can be hard-deleted using only "edit" rights.
4. The audit trail can be forged and skipped.
5. Re-running `schema.sql` quietly turns all RLS off.

All of this comes from reading the code. No live Supabase project or Vercel deployment was available. Anything that depends on dashboard configuration (whether signups are enabled, storage policies, which env vars are set, whether `security.sql` has been applied) is marked `Verified: no`.

### Table x operation x role matrix (after `security.sql`)

Legend: Y = allowed, B = allowed only for the user's own branch (or every branch when the role has `canViewAllBranches`), - = denied. Soft-delete and restore are UPDATEs, so they follow the U column.

| Table | Op | admin | accountant (all branches) | branch_manager | fee_collector | profile-less / signed-up user |
|---|---|---|---|---|---|---|
| students | S/I/U/D | Y/Y/Y/Y | -/-/-/- | B/B/B/- | B/-/-/- | - |
| employees | S/I/U/D | Y | - | B/-/-/- | - | - |
| invoices | S/I/U/D | Y | Y/Y/Y/**Y** | B/B/B/**B** | B/B/B/**B** | - |
| expenses | S/I/U/D | Y | Y/Y/Y/- | B/B/B/- | - | - |
| payments | S/I/U/D | Y | Y/Y/Y/**Y** | B/B/B/**B** | - | - |
| payslips | S/I/U/D | Y | Y/Y/Y/**Y** | B/-/-/- | - | - |
| accounts | S / write | Y | Y / Y (no branch scope) | - | - | - |
| journals | S / write | Y | Y / **Y incl. hard delete** (no branch scope) | - | - | - |
| branches | S / write | Y | Y / - | Y / - | Y / - | **Y / -** |
| reminder_logs | S / write | Y | Y / Y | **all branches** / **all branches** | **all branches** / **all branches** | - |
| custom_roles | S / write | Y | Y / - | Y / - | Y / - | **Y / -** |
| users | S / I / U / D | Y | own row / - / **own row except role,branch_id** / - | same | same | - |
| audit_log | S / I | Y / Y | - / **Y (any content)** | - / **Y** | - / **Y** | - / **Y** |

Bold cells are where the DB lets a user do more than the UI suggests. Each one has a finding below.

---

## Critical

### [SEC-01] WhatsApp Cloud API token is compiled into the public JS bundle
- Severity: Critical
- Effort: M
- Location: src/utils/whatsapp.js:15-21, src/utils/whatsapp.js:31-34; src/pages/Settings.jsx:11-15; README.md:23-24
- Evidence: `token: process.env.REACT_APP_WHATSAPP_TOKEN` is read in browser code and sent as `Authorization: Bearer ${token}` straight to `graph.facebook.com`. CRA inlines every `REACT_APP_*` value into the static JS at build time. I ran a scratch build with a canary token (`REACT_APP_WHATSAPP_TOKEN=CANARYTOKEN_EAAB_test`). The literal showed up in **4** chunks under `build/static/js/` (140, 708, 726, 975). Those are static files that anyone can download from Vercel without logging in.
- Impact: Anyone can `curl` the site's chunks and pull the school's permanent Meta token (the code comment says "a permanent access token"). With it they can send WhatsApp messages from the school's verified business number to any phone, for example fake fee-payment links sent to parents. Depending on the token's scopes they may also be able to read or manage the WhatsApp Business Account. Message costs are billed to the school. Rotating the token does not fix this, because the next build leaks the new one.
- Fix: Move sending to a Supabase Edge Function, e.g. `send-whatsapp`, that keeps the token as a function secret. Have it check the caller's JWT and `has_perm('canEditFees')`, accept only a template name and parameters or a `student_id` (not free-form text or arbitrary numbers), and rate-limit per user. Then delete `REACT_APP_WHATSAPP_TOKEN` from Vercel, **revoke and reissue the token in Meta Business Manager**, and rebuild. Remove the token check in Settings.jsx (it can ask the function for a "configured" flag).
- Verified: yes (canary build). Whether a real token is set in Vercel today: no. The committed `.env` had only `leave_blank_for_now`, but the Settings "Connected" badge and the Fees and ReminderLogs features suggest it is meant to be set.

---

## High

### [SEC-02] Stored XSS in "PDF" export lets any data-entry user steal an admin session
- Severity: High
- Effort: S
- Location: src/utils/exportUtils.js:15-36. Callers: src/pages/Students.jsx:129, Fees.jsx:406, Expenses.jsx:187, Payments.jsx:158, Payslips.jsx:248, Employees.jsx:123
- Evidence:
  ```js
  const w = window.open("", "_blank");
  w.document.write(`...<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? ""}</td>`)...`);
  ```
  Cell values (student `name`, `parentName`, invoice `studentName`, expense `description`, payslip `employeeName`, ...) go into the HTML without escaping. A `window.open("")` popup is `about:blank` and **inherits the opener's origin**, so any script in it runs with the app's origin. supabase-js keeps the session, including the refresh token, in `localStorage` (src/lib/supabaseClient.js:13-19, `persistSession: true`).
- Impact: A fee_collector can write invoices for their branch. They set `studentName` (stored in `extra` jsonb) to an HTML string containing an inline event handler that reads the Supabase session from `localStorage` and sends it to an external host (payload deliberately omitted from this report). When an admin clicks **PDF** on Fees, the payload runs and sends the admin's refresh token to the attacker, who now has full admin rights. That includes the `create-user` Edge Function, so they can mint their own admin. React escapes the normal page render, so the payload sits unnoticed until someone exports.
- Fix: HTML-escape every cell and the title in `exportToPDF` (`& < > " '`), or build the table with DOM APIs and `textContent`. Better: open the popup with `noopener`, or render the print view in a sandboxed iframe or a React print route. Add a CSP (SEC-11) as defence in depth. The Payslips print at src/pages/Payslips.jsx:233-241 reuses React-escaped `innerHTML`, so it is safe today. Keep it that way.
- Verified: yes (traced from DB field to `document.write`; not executed in a browser)

### [SEC-03] Invoices, payments, payslips and journals can be permanently deleted with only "edit" rights; delete permissions are unenforced
- Severity: High
- Effort: M
- Location: supabase/security.sql:185-187 (invoices_delete uses `canEditFees`), 219-221 (payments_delete uses `canEditPayments`), 236-238 (payslips_delete uses `canEditPayslips`), 257-260 (journals_write `for all` uses `canEditAccounting`); src/firebase.js:226-261; src/pages/Trash.jsx:27,98-112; src/components/Layout/Sidebar.jsx:131-134
- Evidence:
  - The hard-delete policies reuse the *edit* permission. `deleteDoc` soft-deletes with an UPDATE (`update({ deleted_at: ... })`), so the `canDeleteStudents`, `canDeleteEmployees` and `canDeleteExpenses` checks in `students_delete`, `employees_delete` and `expenses_delete` are never involved when an item is moved to Trash.
  - No page checks `can("canDelete…")` (grep finds them only in the permission editors).
  - The Trash route and sidebar entry are shown to everyone (`show: true`). `Trash.jsx` reads `isAdmin` and then ignores it. "Empty trash" runs `delete().not("deleted_at","is",null)`.
- Impact:
  - A fee_collector can collect cash, then trash and permanently delete the invoice. Via PostgREST they can skip the Trash and send `DELETE` straight away.
  - An accountant or branch manager can hard-delete `payments` rows. That defeats the reversal-entry design in `accounting.sql` ("instead of silently mutating the ledger").
  - An accountant can delete journal entries.
  - A branch_manager, whose `canDeleteStudents` is false, can still move students to Trash.
  - Nothing server-side records any of this (SEC-04).
- Fix:
  - Give financial tables **no** DELETE policy at all, or `is_admin()` only.
  - Make "delete" a reversal or void, or soft-delete through a `SECURITY DEFINER` RPC that checks `canDelete*`.
  - Add `BEFORE UPDATE` triggers that only allow `deleted_at` to change when `has_perm('canDelete<Entity>')` is true.
  - Gate the Trash page and "Empty trash" behind `isAdmin`.
  - Consider making invoices with `status='paid'` and their payments immutable except through reversals.
- Verified: yes (policy text + client path traced)

### [SEC-04] The audit trail is written by the client, so it can be forged and skipped
- Severity: High
- Effort: M
- Location: supabase/security.sql:341-343; src/utils/auditLog.js:41-54; supabase/schema.sql:210-219
- Evidence: `create policy audit_insert ... with check (true);`. The browser sets the `user` column (`user: email || "unknown"`), and nothing ties it to `auth.uid()`. Every audit row comes from a voluntary `logActivity()` call after the real write, and the logger swallows its own errors. There are no DB triggers on the data tables.
- Impact:
  - Anyone who calls the REST API directly (any role, or a signed-up stranger if signups are on) changes data and leaves no trace.
  - They can also insert fake rows blaming another staff member (`user: "principal@..."`) or flood the log.
  - In a fee or payroll fraud investigation, the Activity Log cannot be trusted as evidence.
  - The forged rows also feed SEC-15 (CSV injection into the admin's Excel).
- Fix:
  - Add `AFTER INSERT OR UPDATE OR DELETE` triggers (a `SECURITY DEFINER` audit function) on every data table. Record `auth.uid()`, the JWT email, the operation, the table, the row id, and `old`/`new` jsonb.
  - Revoke INSERT on `audit_log` from `authenticated`, or keep client inserts in a separate `activity_notes` table.
  - Set `"user"` with a column default or trigger from `auth.uid()`, never from the client.
- Verified: yes

### [SEC-05] Re-running `schema.sql` (or never running `security.sql`) turns all row-level authorisation off, and the UI's branch scoping is cosmetic
- Severity: High
- Effort: S
- Location: supabase/schema.sql:243-257; supabase/security.sql:125-135; README.md:30-40; src/context/UserContext.jsx:207; src/components/Layout/Navbar.jsx:22; src/utils/branchFilter.js:1-4
- Evidence: `schema.sql` ends by recreating `create policy "auth all" ... for all to authenticated using (true) with check (true)` on all 13 tables. Postgres ORs permissive policies together, so if that one exists next to the granular policies, the granular ones have no effect. `security.sql` drops it, but `schema.sql` presents itself as idempotent ("Run this ... one shot", `if not exists`). So anyone who re-runs it, for example to pick up a schema change, silently restores full access. The README does not mention `accounting.sql`, `trash.sql` or `realtime.sql`, or where they go in the order. On the client, `assignedBranchId` is computed and never used. Any user can pick "All branches" in the Navbar, and `matchesBranch` only filters rows the DB already returned.
- Impact: One routine re-run means every logged-in user (fee collectors, and strangers if signups are on) can read and modify all students, salaries, payments and users rows. That includes setting their own `role='admin'`, because the guard trigger only blocks non-admins and everyone looks like an admin to `is_admin()`... strictly, `is_admin()` still reads the real role, but with `auth all` present the users UPDATE policy no longer limits the row. Nothing in the app would show it.
- Fix:
  - Remove the "auth all" block from `schema.sql`, keeping only `enable row level security`.
  - Move to numbered migrations (`supabase/migrations/0001_schema.sql`, `0002_security.sql`, ...) applied with `supabase db push`.
  - Add a CI or SQL check that fails if any policy named `auth all` exists, or any policy has `qual = 'true'` on a data table (`select * from pg_policies where schemaname='public' and qual='true'`).
  - Document the full run order in the README.
- Verified: yes for the SQL behaviour; no for which policies are live in production

---

## Medium

### [SEC-06] Per-user permission overrides and `canExport` are only enforced in the UI; users can rewrite their own overrides
- Severity: Medium
- Effort: M
- Location: src/context/UserContext.jsx:186-196; src/pages/AccessOverview.jsx:73-85; supabase/security.sql:46-92, 308-311, 318-329
- Evidence: Access Overview writes `pagePermissions` into `users.extra`. `UserContext` merges it on top of the role's permissions. `has_perm()` never reads `pagePermissions`, so the DB enforces only the role. `canExport` is defined but no page checks it. The `users_update` policy lets a user update their own row, and the guard trigger only blocks changes to `role` and `branch_id`, so `extra` (overrides) and `pin` can be changed freely.
- Impact: When an admin *revokes* something in Access Overview (e.g. turns off `canViewStudents` for a branch manager), the user loses the menu item but can