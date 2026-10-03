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
- Impact: One routine re-run means every logged-in user (fee collectors, and strangers if signups are on) can read and modify all students, salaries, payments and users rows. Because the permissive `auth all` policy also applies to `users`, the users UPDATE policy no longer limits which rows a user can touch, so a non-admin can rewrite other users' profiles, including promoting a second account to `admin`. The self-update trigger blocks only a user's own row. Nothing in the app would show any of this.
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
- Impact:
  - When an admin *revokes* something in Access Overview (for example, turns off `canViewStudents` for a branch manager), the user loses the menu item. The database still grants the role's full permission, so the user can keep reading and writing that data through the REST API, or through public routes such as `/quick-payment`.
  - When an admin *grants* an override, the UI shows the page but the DB refuses, so the admin assumes the user has access they do not have.
  - Any user can edit their own `extra.pagePermissions` and unlock every menu in the UI. The DB still applies the role, so this does not leak data, but it makes the UI an unreliable view of who can do what.
  - Anyone who can see data can export it to CSV or PDF, whatever "Export" is set to.
- Fix: Store overrides in a dedicated `user_permissions` table, or a `users.permissions jsonb` column that the user cannot write. Have `has_perm()` apply them (deny overrides first). Extend the guard trigger, or a column-level `REVOKE UPDATE`, so a non-admin can change only `name` on their own row. Check `can("canExport")` around every export button.
- Verified: yes

### [SEC-07] `canManageUsers` is effectively admin, and the self-update guard depends on the row id staying fixed
- Severity: Medium
- Effort: S
- Location: supabase/security.sql:302-314, 318-333; src/pages/Users.jsx:172-185; supabase/schema.sql:182-188
- Evidence:
  - The users policies let anyone with `has_perm('canManageUsers')` insert, update and delete any profile row, including setting `role='admin'` on other users.
  - The guard only fires when `auth.uid() = new.id`. For a `canManageUsers` holder, the UPDATE `with check` also accepts rows whose `id` differs from `auth.uid()`. So the guard checks the *new* id rather than the row being edited, and changing the id on the same statement takes the row out of its scope.
  - Custom roles can grant `canManageUsers` through `custom_roles.permissions`, which `has_perm()` reads.
  - Custom-role creation is broken today. `addDoc` omits `id`, and `custom_roles.id` is a text primary key with no default; the computed `roleId` is never used. So this is latent until that bug is fixed.
- Impact: A non-admin who is given "Manage Users" (for example an office manager) can promote any other account to admin, demote or delete the real admins' profiles, and lock the school out. The UI presents this as a lesser permission than admin.
- Fix:
  - Make users writes (other than a user's own `name`) `is_admin()` only. Alternatively, forbid setting `role='admin'` unless `is_admin()`.
  - In the guard, compare `old.id` (not `new.id`) to `auth.uid()`, and reject any change to `id`.
  - Add a check that an admin cannot be demoted or deleted by a non-admin.
  - Fix the custom-role insert (pass `roleId` as `id`).
- Verified: no (traced in SQL; not executed against a database)

### [SEC-08] `reminder_logs` has no branch scope: branch-limited staff can read and change every branch's parent phone numbers and messages
- Severity: Medium
- Effort: S
- Location: supabase/security.sql:277-283; supabase/schema.sql:193-205
- Evidence: `reminder_select ... using (public.has_perm('canViewReports') or public.has_perm('canViewFees'))` and `reminder_write ... for all ... using (public.has_perm('canEditFees'))`. Neither calls `branch_visible()`, and the table has no `branch_id` column.
- Impact: A fee_collector or branch_manager limited to one branch can list every reminder sent school-wide. Each reminder holds a parent's phone number, the student's name, the amount owed, and the month. They can also edit or hard-delete those rows, removing evidence that a reminder was sent. This is a cross-branch PII leak.
- Fix: Add `branch_id` to `reminder_logs` (fill it from the student when written), and add `branch_visible(branch_id)` to both policies. Split `for all` into separate select, insert, update and delete policies, with delete limited to admin.
- Verified: yes

### [SEC-09] Removing a user leaves their login working; users without a profile see the admin UI
- Severity: Medium
- Effort: S
- Location: src/pages/Users.jsx:164-170; src/context/UserContext.jsx:133-160, 187-188; supabase/functions/create-user/index.ts:57-75; README.md:36
- Evidence:
  - `handleDeleteUser` deletes only the `public.users` row. The `auth.users` account, its password and its refresh tokens are kept.
  - `UserContext` falls back to `role: "admin"` when the profile is missing or the query fails, and again with `userProfile?.role || "admin"`.
  - The Edge Function creates the auth user before the profile row and does not roll back if the profile insert fails, which leaves profile-less accounts behind.
  - If email signups are enabled (the README says to disable them; I cannot verify that), anyone on the internet gets an authenticated, profile-less session.
- Impact: A dismissed employee can still sign in. The DB treats them as role `none`, but every `using (true)` or `with check (true)` policy still applies to them: they can read `branches` and `custom_roles`, insert into `audit_log` (SEC-04), and use any storage policies granted to `authenticated`. The UI shows them the full admin navigation, which is confusing and invites social engineering. If RLS is ever loosened (SEC-05), they have full access.
- Fix:
  - Remove users through an admin Edge Function that calls `auth.admin.deleteUser` (or bans the account) and signs out every session.
  - In `UserContext`, treat a missing profile or an error as no permissions and sign the user out.
  - Change `users.role` to `default 'none'` (see SEC-14).
  - Roll back the auth user in `create-user` when the profile insert fails.
  - Confirm in the dashboard that signups are disabled.
- Verified: yes for the code paths; no for the signup setting

### [SEC-10] Public `receipts` bucket with no versioned storage policies and no upload validation
- Severity: Medium
- Effort: M
- Location: src/lib/storage.js:12-21; README.md:40; src/pages/QuickPayment.jsx:44-58, 240-246
- Evidence:
  - The README says to create the bucket as **public**. `uploadReceipt` stores files at a path built from a millisecond timestamp and the user-supplied file name, and saves `getPublicUrl()` permanently in `invoices.extra.receiptUrl`.
  - The only type check is `accept="image/*"` on the input, which the browser enforces and an attacker can skip. There is no size limit.
  - No `storage.objects` policies exist anywhere in the repo, so whatever INSERT, SELECT or DELETE rules were set up by hand in the dashboard are unknown and unreviewed.
- Impact:
  - Receipt photos (names, amounts, sometimes bank details) can be fetched by anyone who has or guesses the URL, with no login and no expiry. Filenames from phone cameras follow predictable patterns, so the names are not secret.
  - Depending on the hand-written policies, any authenticated user, or `anon`, may be able to upload arbitrary or large files (storage abuse) or list and overwrite receipts.
- Fix:
  - Make the bucket private. Store the object path, not a public URL, and serve receipts with short-lived `createSignedUrl`.
  - Generate the path on the client as `<branch_id>/<uuid>.<ext>` and never use `file.name`.
  - Add versioned SQL policies on `storage.objects`: insert only for `has_perm('canEditFees')` into the user's own branch prefix, select by branch, no update or delete except admin.
  - Set the bucket's `allowed_mime_types` (image/jpeg, image/png, application/pdf) and `file_size_limit`.
- Verified: yes for the client code; no for the live bucket and policy configuration

### [SEC-11] No security headers on the Vercel deployment, and source maps are published
- Severity: Medium
- Effort: S
- Location: vercel.json:1-3; package.json:24 (`build` script)
- Evidence: `vercel.json` has only an SPA rewrite and no `headers` block, so there is no Content-Security-Policy, X-Frame-Options or `frame-ancestors`, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. Vercel adds HSTS by default on its own domains; whether the custom domain is covered is unverified. CRA writes source maps by default; the scratch build produced 28 `.map` files under `build/static/js/`, and nothing disables them.
- Impact:
  - With no CSP, nothing limits the XSS in SEC-02 or stops tokens being sent to arbitrary hosts.
  - With no frame protection, the admin UI can be framed for clickjacking (for example, tricking an admin into clicking delete or role buttons).
  - The published source maps give attackers readable source, which makes finding issues like SEC-01 trivial.
- Fix: Add a `headers` block in `vercel.json` for `/(.*)` with:
  - a CSP limiting `script-src 'self'`, `connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co`, `img-src 'self' data: https://<ref>.supabase.co`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`;
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self)`, and HSTS for the custom domain.
  
  Build with `GENERATE_SOURCEMAP=false`.
- Verified: yes for the config and the source maps; no for the live response headers

### [SEC-12] PINs are stored in plaintext and checked in the browser; PIN login is client-side authentication
- Severity: Medium
- Effort: M
- Location: supabase/schema.sql:32; src/pages/Login.jsx:22-28, 42-58; src/pages/Users.jsx:153-161; supabase/functions/create-user/index.ts:73
- Evidence:
  - `users.pin` is plain `text`, and the Edge Function and the Set-PIN modal write the raw PIN. The minimum length is 4 digits.
  - The PIN login screen loads the whole `users` table into the browser and compares `user.pin !== pin` there. On success it tries to sign in with a password derived from the PIN plus a fixed suffix. The error path calls `navigate("/")` when the client-side comparison matched.
  - Today this flow is broken: `signInWithEmailAndPassword` and `auth` are not imported (the production build still emits the call), and `anon` cannot read `users` under RLS, so the list is empty.
- Impact:
  - Every admin, and anyone with `canManageUsers`, can read every staff member's PIN in plaintext. Every user can read their own.
  - If someone "fixes" PIN login the obvious way, by letting `anon` read `users`, every email address and PIN becomes public. Any account whose password follows the PIN-derived scheme has only 10,000 possible values.
  - The `navigate("/")` fallback shows the intent to authenticate on the client side.
- Fix: Drop the `pin` column and the PIN login, or replace them with a server-side Edge Function that keeps a salted hash (bcrypt or argon2) of the PIN, rate-limits and locks out per user and IP, and issues the session itself. Never send PINs to the client. Remove the derived-password scheme and the success-on-match fallback.
- Verified: yes (code traced; the build output still contains the undefined call)

### [SEC-13] `xlsx` 0.18.5 (prototype pollution and ReDoS) parses files from outside the school
- Severity: Medium
- Effort: S
- Location: package.json:21; package-lock.json:17616-17620; src/pages/Import.jsx:152-166, 224-236; src/App.js:176-180
- Evidence: `npm audit --omit=dev` reports two high-severity advisories for `xlsx` 0.18.5 (direct dependency): GHSA-4r6h-8v6p-xvw6 (prototype pollution when reading crafted files) and GHSA-5pgg-2g8v-p4x9 (ReDoS). `parseFile` calls `XLSX.read` and then `sheet_to_json` on any file the user picks. The page tells admins to export the file from Manager.io, so the input often comes from a third party. The route is gated on `canManageUsers` in the UI only. npm has no fixed version; SheetJS publishes fixes only on its own CDN.
- Impact: An admin who imports a malicious workbook (for example, sent as a "Manager.io export") can have the prototype polluted in their browser session or the tab frozen. In an admin session with the token in `localStorage`, prototype pollution is a possible stepping stone to logic bypass or XSS. Note also that `transform` (Import.jsx:30-37) throws away all mapped fields, so imports are broken anyway.
- Fix: Upgrade to SheetJS ≥ 0.20.2 from `https://cdn.sheetjs.com/` (pinned by integrity hash), or switch to a maintained parser. Parse in a Web Worker, limit file size and row count, and copy only the allow-listed columns into fresh objects created with `Object.create(null)`.
- Verified: yes for the version and reachability; the exploit itself was not reproduced

---

## Low

### [SEC-14] `create-user` Edge Function: no input validation or role allow-list, defaults to admin, no rollback, raw errors returned
- Severity: Low
- Effort: S
- Location: supabase/functions/create-user/index.ts:17-22, 55-75, 80-84; supabase/schema.sql:30
- Evidence:
  - `name, email, password, role, branchId, pin` are taken from the body unchecked. If `role` is missing, the insert falls back to the column default `role text default 'admin'`.
  - Any string is accepted as a role. Password strength is left to Supabase's default minimum.
  - The profile insert failing leaves the auth user behind.
  - `catch` returns `String(e.message)` to the caller, and CORS is `*`.
  - Only callers whose role is `admin` are allowed, so exposure is limited to admins.
- Impact: An admin's mistake or a malformed request silently creates a new **admin**. Orphaned auth users accumulate (see SEC-09). Raw Postgres or Auth error messages reveal schema details. CORS `*` matters little with bearer-token auth, but it is broader than needed.
- Fix:
  - Validate with a schema (zod): an email format; `role` in the built-in roles or an existing `custom_roles.id`; `branchId` an existing branch; password ≥ 12 chars or a passphrase policy; PIN removed (SEC-12).
  - Require an explicit extra confirmation, or a second admin, to create an `admin`.
  - Change the column default to `'none'`.
  - Delete the auth user if the profile insert fails.
  - Return generic error messages and log details server-side.
  - Restrict `Access-Control-Allow-Origin` to the app's domain.
- Verified: yes

### [SEC-15] CSV export does not neutralise spreadsheet formulas
- Severity: Low
- Effort: S
- Location: src/utils/exportUtils.js:1-13; callers in Students.jsx:125, Fees.jsx:401, Expenses.jsx:182, Payments.jsx:153, Payslips.jsx:243, Employees.jsx:118, ActivityLog.jsx:100
- Evidence: Cells are wrapped in quotes and `"` is doubled, but values starting with `=`, `+`, `-`, `@`, tab or CR are not prefixed. Lower-privileged roles write the source fields, and anyone signed in can write `audit_log` rows (SEC-04).
- Impact: A fee collector or branch manager can store a value that Excel treats as a formula when an admin opens the export. For example, a hyperlink formula can send other cells' contents to an external site after one click. This is cross-role data leakage through the admin's spreadsheet.
- Fix: In `exportToCSV`, prefix any cell starting with `= + - @ \t \r` with a single quote (`'`). Keep numbers numeric by checking for a number type first.
- Verified: yes (code); not opened in Excel

### [SEC-16] `/quick-payment` skips the route permission gate and is advertised as a shareable link
- Severity: Low
- Effort: S
- Location: src/App.js:82; src/pages/QuickPayment.jsx:26-30, 39-67; src/pages/Settings.jsx:7, 66-80
- Evidence: The route sits outside `PrivateRoute`, so neither login nor `canEditFees` is checked in the UI. It loads the entire `students` table and filters it in the browser. It creates invoices with `status: "paid"` and sends WhatsApp messages. Settings offers a "copy link" for it. Without a session RLS returns nothing, so today it only works for signed-in users, within their DB permissions.
- Impact: Any signed-in user can open a fee-entry screen their role was meant to hide (for example an accountant with an Access Overview override). The page invites the "fix" of granting `anon` read on `students` and insert on `invoices` so the shared link works, which would expose all student PII and allow anonymous creation of fake "paid" invoices.
- Fix: Wrap the route in `PrivateRoute permission="canEditFees"`. Search students server-side (an RPC with a minimum query length and branch scope) instead of loading every row. Record a matching payment through the same path as Fees. Remove the "share link" wording, or document that it needs a login.
- Verified: yes

### [SEC-17] Accounting tables (`accounts`, `journals`) are not branch-scoped
- Severity: Low
- Effort: M
- Location: supabase/security.sql:243-260; supabase/schema.sql:151-177
- Evidence: The accounting policies check only `canViewAccounting` or `canEditAccounting`. `journals` and `accounts` have no `branch_id`, and the policies are `for all`.
- Impact: The built-in roles holding these permissions (admin, accountant) already see every branch, so today there is no leak. Any custom or overridden role given accounting access but not `canViewAllBranches` would see and edit the whole school's ledger, contrary to the branch model.
- Fix: Add `branch_id` to `journals` (and to accounts if they are branch-specific) and apply `branch_visible()`, or require `canViewAllBranches` alongside `canViewAccounting` in these policies. Split `for all` into per-operation policies, with no hard delete (see SEC-03).
- Verified: yes

### [SEC-18] Firebase project configuration is in git history; the old Firestore project may still hold data
- Severity: Low
- Effort: S
- Location: git history: `.env` added in f4fb20a, removed in 6720150; `.env` inside `school-erp-supabase.zip` added in 311d0cf, removed in 2c04b9f
- Evidence: History holds the full `REACT_APP_FIREBASE_*` web config for project `skofi-36707`. Both copies of the WhatsApp values were the placeholder `leave_blank_for_now`. No Supabase keys, JWTs or `service_role` values were found anywhere in history (`git log -p --all` grep). There is no `.gitignore` in the tree (it was deleted in da6c1ab), so a future `.env` or `node_modules/` could be committed by accident; `node_modules/` is currently untracked.
- Impact: Firebase web keys are not secret by themselves. But the app's earlier Firestore rules relied on client-side checks (schema.sql:238-241 says the old rules gave every authenticated user full access). If the legacy project still holds student or fee data, anyone with this config who can register or sign in there may be able to read it.
- Fix: Confirm the legacy Firebase project is deleted, or that its Firestore and Storage are emptied and rules set to deny all. Restrict or delete the API key in Google Cloud. Restore a `.gitignore` with `.env*`, `node_modules/` and `build/`. Optionally purge history with `git filter-repo`.
- Verified: yes for history contents; no for the state of the Firebase project

### [SEC-19] Authentication hardening: no MFA, no reset flow, only Supabase's default brute-force limits
- Severity: Low
- Effort: M
- Location: src/context/AuthContext.jsx:54-59; src/pages/Login.jsx:30-40; src/lib/supabaseClient.js:13-19
- Evidence:
  - Login is a plain `signInWithPassword`, with no CAPTCHA or lockout in the app and no MFA enrolment for admins.
  - The app has no password-reset or change-password flow, so admins cannot rotate a compromised staff password from the UI.
  - Sessions persist in `localStorage` (which raises the impact of SEC-02).
  - `activeBranch` stays in `localStorage` across users on shared machines.
  - `signOut()` uses supabase-js v2's default global scope, which is good.
- Impact: Admin accounts that control payroll and student PII are protected only by a password. Brute-force protection depends on the project's Auth rate-limit settings, which I could not verify.
- Fix:
  - Enforce TOTP MFA for `admin` and `accountant`; check `aal2` in `is_admin()` or in sensitive policies.
  - Turn on Supabase Auth CAPTCHA and review its rate limits.
  - Add an admin "reset password" through an Edge Function and a self-service change-password screen.
  - Clear `activeBranch` on logout.
- Verified: yes for the code; no for the Auth dashboard settings

---

## Info

### [SEC-20] Realtime publishes every table, including `users` and `audit_log`, with REPLICA IDENTITY FULL
- Severity: Info
- Effort: S
- Location: supabase/realtime.sql:98-117; src/firebase.js:412-415, 464-513
- Evidence: All 13 tables are added to `supabase_realtime` with `replica identity full`. Supabase applies RLS to INSERT and UPDATE change events, but DELETE events are not RLS-filtered; with RLS enabled they carry only the primary key.
- Impact: Small. Subscribers can see the ids of deleted rows in tables they cannot read. Adding `users` (which has plaintext `pin`) and `audit_log` to the publication increases what a future RLS mistake would broadcast live.
- Fix: Publish only the tables the UI subscribes to. Leave `users` (beyond the user's own row) and `audit_log` out of realtime, and use default replica identity where full old rows are not needed.
- Verified: no (based on Supabase's documented behaviour; not tested)

### [SEC-21] `branches` and `custom_roles` are readable by any authenticated session
- Severity: Info
- Effort: S
- Location: supabase/security.sql:266-268, 288-290
- Evidence: Both use `using (true)`.
- Impact: Any session, including profile-less or orphaned accounts (SEC-09), can list branch names, addresses and phone numbers, and the full permission map. This data is low-sensitivity but helps with reconnaissance.
- Fix: Change to `using (public.current_role() <> 'none')`.
- Verified: yes

### [SEC-22] Dependency advisories are almost all in build tooling
- Severity: Info
- Effort: M
- Location: package.json:15-23
- Evidence: `npm audit --omit=dev` reports 95 advisories (2 critical, 74 high, 13 moderate, 6 low). `react-scripts` is listed under `dependencies`, so its whole toolchain counts. Of the code that ships to browsers, only `xlsx` (SEC-13) and `react-router-dom` (moderate open-redirect advisories) are affected. The app does not navigate to user-controlled URLs, so the router issues are not reachable today.
- Impact: Little runtime risk beyond SEC-13. The build-time issues (webpack-dev-server, etc.) affect developer machines.
- Fix: Move `react-scripts` to `devDependencies` and plan a migration off CRA (Vite). Update `react-router-dom` to the latest 6.x. Hand the details to `devops-deps-auditor`.
- Verified: yes (npm audit run)

---

## The 5 fixes to do first

1. **SEC-01:** Revoke and reissue the WhatsApp token in Meta. Move sending into an authenticated Edge Function. Delete `REACT_APP_WHATSAPP_TOKEN` from Vercel and redeploy.
2. **SEC-02 + SEC-11:** HTML-escape everything in `exportToPDF` (or render it with `textContent`), add a strict CSP with `frame-ancestors 'none'`, and turn off source maps. This closes the path from a low-privilege user to an admin session.
3. **SEC-05:** Remove the `auth all` block from `schema.sql`, move to ordered migrations, and run `select * from pg_policies where schemaname='public'` in production to confirm only the granular policies exist.
4. **SEC-03 + SEC-04:** Remove DELETE rights on invoices, payments, payslips and journals for non-admins, enforce `canDelete*` on soft-delete with triggers, and replace the client-written audit log with DB triggers that record `auth.uid()`.
5. **SEC-06 + SEC-07 + SEC-09:** Make the DB the only source of permissions. Apply per-user overrides in `has_perm()`, block self-edits beyond `name`, make users writes and role promotion admin-only with the guard checking `old.id`, delete the auth account when removing a user, and change `users.role` to default `'none'`.
