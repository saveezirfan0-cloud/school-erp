# UX, accessibility and compliance audit (ux-compliance-auditor)

Scope: React app in `/home/user/school-erp/src`, `public/`, and the `supabase/*.sql` policies where they change what a user experiences or what personal data is exposed. Source was read-only. The dev server was started with a placeholder Supabase URL; `/login`, `/quick-payment` and `/unauthorized` rendered and were screenshotted. Authenticated pages could not be rendered, so those findings come from reading the code and are marked accordingly.

Totals: 37 findings. Critical 0, High 8, Medium 23, Low 5, Info 1.

Not findings, worth keeping: soft delete with Trash and restore on 10 collections, confirm dialogs on most single and bulk deletes, double-submit guards on fee payment, bulk select with "select all N", pagination, a mobile card layout on Students/Fees/Payslips/ActivityLog, an immutable (no UPDATE/DELETE policy) audit table, and RLS that mirrors the role matrix.

Empty files that look like components but are not: `src/components/UI/Modal.jsx`, `src/components/UI/Table.jsx`, `src/components/UI/Badge.jsx`, `src/utils/invoiceGenerator.js` and `src/hooks/useFirestore.js` are all 0 bytes. No shared Modal or Table exists; every page re-implements both (see UX-010, UX-014).

---

## Role clarity and access

### [UX-001] Role resolution fails open to admin (no profile, load error, unknown or not-yet-loaded role)
- Severity: High
- Effort: S
- Location: `src/context/UserContext.jsx:139-158`, `:187-188`; `src/pages/Users.jsx:164-170`; `supabase/schema.sql:25-36`
- Evidence: A missing profile row sets `role: "admin"` ("First user / no profile — default to admin"). The profile-read error handler also sets `role: "admin"`. `const basePermissions = PERMISSIONS[role] || customRolePerms[role] || PERMISSIONS.admin;` falls back to the full admin set when a custom role is not yet loaded (customRoles loads in a separate effect, and `PrivateRoute` only waits on `loadingProfile`) or has been deleted. `Users.handleDeleteUser` calls `deleteDoc(doc(db,"users",id))`, which hard-deletes only the `public.users` profile row (users is not in `SOFT_DELETE_TABLES`). The `auth.users` account is untouched.
- Impact: "Remove user" does not remove anyone. The ex-employee can still sign in. Because their profile row is gone, the app treats them as admin: the full sidebar (Users, Activity Log, Import, Access Control), every admin-only screen, QuickAdd. RLS then returns `'none'` for their role so data lists come back empty, but the UI is a fully privileged shell, and any transient read error (network blip) does the same to a legitimate low-privilege user. Custom-role users briefly get admin UI at every page load until `customRoles` arrives.
- Fix: Fail closed. No profile, error or unknown role gives a "no access / contact admin" screen and no permissions. Block `PrivateRoute` until both profile and custom roles have loaded. Make user removal call the `create-user` edge function family (or a new `delete-user`) so the auth account is deleted or disabled, and keep a "deactivated" flag if history must be preserved.
- Verified: yes (traced in code and SQL)

### [UX-002] Custom role creation cannot succeed (primary key never supplied) and errors are swallowed
- Severity: High
- Effort: S
- Location: `src/pages/Users.jsx:172-184`; `supabase/schema.sql:182-188`; `src/firebase.js:199-208`
- Evidence: `handleSaveCustomRole` computes `const roleId = ...` and never uses it, then calls `addDoc(collection(db,"customRoles"), {...customRole})`. `addDoc` drops `id` and inserts. `custom_roles.id` is `text primary key` with no default. There is no try/catch in `handleSaveCustomRole`, `handleUpdateRole`, `handleSetPin` or `handleDeleteRole`.
- Impact: Creating a role, the headline "custom roles" feature, should fail with a not-null violation, and the admin sees nothing: no toast, the modal stays open, and an unhandled rejection is logged. Even if a role id were supplied, the label, colour and background are not columns and are stored in `extra`. The id has to be the key used in `users.role` and `has_perm`, so it must be generated deliberately.
- Fix: Pass an explicit id via `setDoc(doc(db,"customRoles",roleId), ...)` (slug of label plus a short random suffix) and wrap all four handlers in try/catch with a toast. Add a test that creates a role end to end.
- Verified: yes (traced to schema and shim; not executed against a live DB)

### [UX-003] Fee Collector (built-in role) lands on "Access Denied" after every login; the error page loops
- Severity: High
- Effort: S
- Location: `src/App.js:91-95`; `src/pages/Login.jsx:35`; `src/pages/Unauthorized.jsx:15-17`; `src/context/UserContext.jsx:93`
- Evidence: Index route `/` requires `canViewDashboard`; `fee_collector` has `canViewDashboard: false`. Login always does `navigate("/")`. `Unauthorized` shows a "Go to Dashboard" button that navigates to `/`.
- Impact: The role meant for front-desk staff signs in, is immediately redirected to "Access Denied", and the only button sends them back to the same denial. They must guess to click Students or Fees in the sidebar. The same applies to any custom role without dashboard access.
- Fix: Add a `HomeRedirect` that picks the first permitted route (Fees for collectors, Students, etc.). Make the Unauthorized button target that route, or "Sign out" if nothing is permitted.
- Verified: yes

### [UX-004] Edit, delete and export permissions are never enforced in the UI; only "View" gates pages
- Severity: High
- Effort: M
- Location: `grep "can("` across `src/pages` finds none. Only `QuickAdd.jsx:15-16` and `Sidebar.jsx` use `can`. Examples: `src/pages/Students.jsx:140-147`, `:188-190`, `:269-270`; `src/pages/Fees.jsx:431-437`; `src/pages/Employees.jsx`; `Users.jsx:45` (`canExport` defined)
- Evidence: Students shows Add, Edit, Delete, bulk Edit/Delete, and CSV/PDF buttons to everyone who can view the page. `canExport`, `canDeleteStudents`, `canDeleteEmployees`, `canDeleteExpenses`, `canEditEmployees` are never read outside the role tables. Separately, deletes are implemented as `UPDATE deleted_at` (`src/firebase.js:226-239`), which RLS authorises with the Edit permission, not the Delete permission (`security.sql:148-153`), so `branch_manager` (`canDeleteStudents:false`) can still "delete" students.
- Impact: The permission names promise things that are not true. A fee collector (view students only) sees Add/Edit/Delete buttons that fail with a raw Postgres message. A "no export" role (every non-admin) can still download the full student list with parent names and phones as CSV, a privacy leak the permission was meant to prevent. Admins configuring roles cannot trust the matrix.
- Fix: Wrap action buttons in `can("canEditX")` / `can("canDeleteX")` / `can("canExport")`. Make the soft-delete path check the Delete permission in RLS (a trigger that rejects `deleted_at` changes without `canDeleteX`). Hide CSV/PDF behind `canExport`.
- Verified: yes

### [UX-005] Per-user overrides in Access Overview are UI-only and use the wrong baseline for custom roles
- Severity: High
- Effort: M
- Location: `src/pages/AccessOverview.jsx:37-41`, `:73-85`, `:156-166`; `src/context/UserContext.jsx:192-196`; `supabase/security.sql:46-92`
- Evidence: Overrides are stored as `users.pagePermissions` (in `extra`) and merged by `can()` client-side. `has_perm()` in Postgres never reads them. `rolePermission(role,key)` uses only the built-in `PERMISSIONS` table, so for a custom role every row shows "Hidden". `toggle` sets `!current` from that wrong value and saves it. The optimistic `setSelected` is never rolled back on error.
- Impact: Granting "View Payments" via override shows the menu and then an empty page, because RLS refuses. Revoking an override hides the menu but leaves the REST API wide open, so the admin believes access was removed when it was not. For custom-role users the screen displays the opposite of reality. No audit entry is written for any change (see UX-008).
- Fix: Either enforce overrides in `has_perm()` (read `extra->'pagePermissions'`) or remove the feature. Compute the baseline from `customRolePerms` as well. Roll back on error. Log every change.
- Verified: yes

### [UX-006] An admin can demote themselves or delete the last admin; nothing prevents total lock-out
- Severity: High
- Effort: S
- Location: `src/pages/Users.jsx:119-127`, `:365`, `:369`, `:164-170`; `supabase/security.sql:309-314`, `:322`
- Evidence: The Edit button is shown on every row including your own, and the form allows changing Role. The Delete button is hidden only for your own row; any other admin can be deleted. There is no "at least one admin" check in the UI or in the `guard_user_self_update` trigger (it only blocks non-admins). Admin role changes are permitted for anyone with `canManageUsers`, which a custom role can hold (UX-016).
- Impact: A single mis-click on "Role" while editing yourself, or deleting the other admin, leaves the school with no one able to open Users, Access Control or Activity Log. Recovery needs SQL access to the database.
- Fix: Disable the role dropdown on your own row. Refuse (UI and trigger) any change that would leave zero admins. Require a typed confirmation to delete an admin.
- Verified: yes

### [UX-007] Permission names do not match what they gate; several pages have no gate at all
- Severity: Medium
- Effort: S
- Location: `src/App.js:161-185`; `src/components/Layout/Sidebar.jsx:112-141`; `src/pages/Users.jsx:25-49`
- Evidence: "Manage Users" also guards Import Data (bulk create students/employees) and Access Control. "View Reports" guards Reminder Logs and its "Send Reminders Now" button. "Edit Accounting" and "View Accounting" cover Chart of Accounts, Journals and Bank & Cash with no distinction. Trash and Settings are `<PrivateRoute>` with no permission, so every signed-in user sees Trash (and, per UX-018, can permanently delete from it) and Settings (which shows the quick-pay link and can send a WhatsApp test). `AccessOverview` labels every permission as "Can see / Hidden", including "Delete Students" and "Add Payments". The "Admin" group lists `canViewAllBranches` next to "Manage Users".
- Impact: An admin cannot predict what ticking a box grants. Giving someone "Manage Users" to reset a PIN also lets them bulk-import records and, as the role editor shows, effectively administer permissions.
- Fix: Add `canImportData`, `canSendReminders`, `canViewTrash`, `canPurgeTrash`; one-line help text under each permission; "Allowed / Not allowed" rather than "Can see / Hidden" for action permissions.
- Verified: yes

### [UX-008] Audit trail has large gaps and relies on client-supplied, fire-and-forget entries
- Severity: High
- Effort: M
- Location: `src/utils/auditLog.js:41-69`; `supabase/security.sql:341-347`; no `logActivity` calls in `AccessOverview.jsx`, `Branches.jsx`, `ChartOfAccounts.jsx`, `AccountDetail.jsx`, `Import.jsx`, `QuickPayment.jsx`, `QuickAdd.jsx`, `ReminderLogs.jsx`, `Login.jsx`, `exportUtils.js`
- Evidence: `logActivity` is called in 9 files (Employees, Expenses, Fees, Journals, Payments, Payslips, Students, Trash, Users). Not logged: permission overrides, branch create/delete, chart-of-account changes, imports, public Quick Payment, QuickAdd, "Send Reminders Now", sign-in/out, and every CSV/PDF export. Entries are `{user: email, action, module, details}` free text with no record id, no before/after values and no user id. The `user` field is whatever the client sends and the insert policy is `with check (true)`; errors are swallowed (`console.error`). Bulk payment and Trash actions write one summary line rather than per-record rows.
- Impact: The most sensitive actions (granting access, exporting student data, importing hundreds of records, creating money records through the public link) leave no trace, and any signed-in user can insert fake entries attributed to someone else. For a school holding children's data and money, the log cannot answer "who exported the student list" or "who gave this person access".
- Fix: Log the missing actions. Add `actor_id uuid default auth.uid()` plus `record_id`/`table` columns, set the user server-side by trigger, restrict insert to `actor_id = auth.uid()`, and write audit rows from database triggers on the sensitive tables so they cannot be skipped. Retry or queue when the insert fails.
- Verified: yes

### [UX-016] Anyone with `canManageUsers` is effectively an administrator but is not presented that way
- Severity: Medium
- Effort: S
- Location: `supabase/security.sql:304-314`; `src/App.js:161-180`
- Evidence: RLS lets any holder of `canManageUsers` insert, update and delete every `users` row (including role). The guard trigger only restricts `auth.uid() = new.id` for non-admins. The Users page can hand out `canManageUsers` through a custom role or Access Overview override.
- Impact: A "Receptionist" custom role with "Manage Users" ticked can promote a colleague or another account to admin, defeating the UI statement "Admins always have full access".
- Fix: Make role and `branch_id` changes admin-only in the trigger regardless of who is editing. Show a warning when ticking `canManageUsers`.
- Verified: yes (traced in SQL)

---

## Workflow friction

### [UX-009] Common tasks: click counts and the missing shortcuts
- Severity: Info
- Effort: S
- Location: `src/pages/Fees.jsx`, `Students.jsx`, `Payslips.jsx`, `Layout/QuickAdd.jsx`
- Evidence (clicks after landing on the page, desktop): Add student 1 + 4 typed fields + submit (QuickAdd: FAB + switch + fields + submit, but QuickAdd omits Student ID, DOB, email, address, auto-fee, see UX-023). Collect a fee on an existing invoice: search, "Mark Paid", Confirm = 3 clicks (account and amount are pre-filled, good). Collect a fee with no invoice yet: New Invoice, search student, pick month, tick "Receive payment now", Create = about 6 interactions. Generate monthly invoices: "Recurring", pick month, Generate = 3 clicks but no preview (UX-017). Run payroll: "Recurring", month, Generate, select all, Bulk pay, pick account, Confirm = about 7 clicks over two screens; no single "Run payroll for October" summary (UX-018). There is no quick action for "collect fee" in the navbar or FAB; the only fast path is the public `/quick-payment` form (UX-012).
- Impact: Counts are acceptable, but the front-desk path is Sidebar, Fees, search. Nothing is reachable from the keyboard other than Tab.
- Fix: Add "Collect fee" to the FAB and a global search (student by name/ID/phone) on the Navbar. Make a payroll run one wizard (month, preview totals, confirm).
- Verified: yes

### [UX-017] Bulk generate and bulk receive have no preview, confirm, error handling or progress
- Severity: Medium
- Effort: M
- Location: `src/pages/Fees.jsx:172-195` (bulk receive), `:197-217` (recurring), `src/pages/Payslips.jsx:200-225`
- Evidence: Both loops are plain sequential `await addDoc` inside `for`, with no try/catch (a failed row aborts the loop and leaves a partial batch and an unhandled rejection), no confirmation, no progress and no count of what will be created. `handleBulkReceive` sets `paidDate: serverTimestamp()` and never calls `recordPayment`, so those "paid" invoices do not touch the cash/bank ledger, unlike the single and bulk Mark-Paid paths (accounting-auditor should confirm). Recurring generation creates zero-amount invoices for students with an empty `monthlyFee`.
- Impact: One click can create hundreds of invoices (and for bulk receive, WhatsApp messages) with no way to review them, and no "undo batch". A network error midway leaves some students invoiced and some not, with no report of which.
- Fix: Show "Will create N invoices (M skipped as already existing, K have no fee set)" with a confirm; run through the existing `runBulk` helper with progress and a failure list; tag the batch so it can be reverted from one place.
- Verified: yes

### [UX-018] Payroll: payslip form has no error handling, no duplicate guard, no run summary
- Severity: Medium
- Effort: M
- Location: `src/pages/Payslips.jsx:181-198`, `:140-175`
- Evidence: `handleSubmit` awaits `addDoc` with no try/catch, so a failure shows no message, and nothing stops a second payslip for the same employee and month (only the recurring generator checks). The bulk pay modal needs no confirmation of total outflow. Net pay is computed as `Number(basicSalary)+allowances-deductions` with no check for negative results.
- Impact: Duplicate payslips are easy to create and then pay twice. A failed save looks like the click did nothing.
- Fix: try/catch with toast; refuse duplicate (employee, month, year) unless confirmed; show total payout and account balance before the bulk payment; block negative net pay.
- Verified: yes

### [UX-019] Data import: no duplicate detection, row-level errors, batch undo or audit entry
- Severity: Medium
- Effort: M
- Location: `src/pages/Import.jsx:253-283`; route gate `src/App.js:176-180`
- Evidence: Rows are inserted one by one with `addDoc`. Re-importing the same sheet creates every student again (no match on `studentId`). Failures are collected as "Skipped — missing: ..." with no row number. There is no `logActivity` call, and the whole feature requires `canManageUsers`, which is unrelated to student or employee editing.
- Impact: A double-click on "Import" or re-uploading a corrected file doubles the student register, which then flows into recurring invoices. An admin cannot find the offending row in a 400-row file.
- Fix: Upsert on (`branch`, `studentId`) or at least warn about existing IDs; include row numbers in errors and offer an error CSV; tag rows with an `import_batch_id` so a batch can be moved to Trash; log the import.
- Verified: yes

### [UX-020] Reminder "Send Reminders Now" messages every overdue parent with no preview or confirmation
- Severity: Medium
- Effort: S
- Location: `src/pages/ReminderLogs.jsx:68-89`, `:101-113`; log query `:19`
- Evidence: The button posts to `/api/send-reminders` immediately. There is no recipient count, no sample message and no confirm. The page title says "Daily automatic fee reminders" but the log list is capped at 30 rows. The request sends `x-cron-secret` from `process.env.REACT_APP_CRON_SECRET`, which is compiled into the public JS bundle (SEC-owned, but it makes this endpoint callable by anyone who opens the site's JS).
- Impact: A mis-click messages the whole parent body about fees. Staff cannot see what was sent beyond 30 entries.
- Fix: Confirm dialog with count and sample text; page through the log with a date filter; keep the secret server-side.
- Verified: yes

### [UX-021] Deleting a branch is one unconfirmed click and leaves orphans mislabelled "Main Office"
- Severity: Medium
- Effort: S
- Location: `src/pages/Branches.jsx:72`; `src/pages/Students.jsx:233`, `:200`
- Evidence: `onClick={() => deleteDoc(doc(db,"branches",b.id))}` runs immediately: no confirm, no toast, no try/catch, no `logActivity`. Students, fees and users keep the old `branchId`; all list pages render `branches.find(...)?.name || "Main Office"`.
- Impact: After a click, every student of that branch appears to belong to "Main Office", and branch managers assigned there lose all data (RLS `branch_visible`). Restoring from Trash works but nobody is told.
- Fix: Confirm with the count of linked students/users, block deletion while records exist (or reassign), and log it.
- Verified: yes

### [UX-022] Trash: any signed-in user can permanently delete or empty it; no retention policy
- Severity: Medium
- Effort: S
- Location: `src/pages/Trash.jsx:26-27`, `:53-61`, `:98-103`; `src/App.js:186-190`; `src/firebase.js:250-261`; `supabase/trash.sql:31-33`
- Evidence: `isAdmin` is read but never used. The route has no permission. Per-row "Delete forever", bulk delete and "Empty Trash" run `DELETE` (RLS permits it for roles with the delete permission, and see UX-004 on how weak that is). Nothing purges old trash automatically. Hard-deleting a student leaves invoices with `student_id` pointing at nothing, and the Trash tab for payments does not mention the reversal entries.
- Impact: Undo is only as good as the least-trusted user. Conversely, deleted student records (children's personal data) stay forever, which is a compliance problem (UX-025).
- Fix: Admin-only purge; an automatic purge job after N days; block hard delete of students that still have invoices (or keep a minimal tombstone for the ledger).
- Verified: yes

### [UX-023] QuickAdd is inconsistent with the full forms and can crash the app when permissions change
- Severity: Medium
- Effort: S
- Location: `src/components/Layout/QuickAdd.jsx:15-25`, `:34-53`
- Evidence: `if (!canStudent && !canEmployee) return null;` runs before the `useState` calls. When permissions change while the user is signed in (a live `onSnapshot` on their profile, or an admin editing their override), the hook count changes and React throws "Rendered more hooks than during the previous render", taking the whole layout down. QuickAdd also skips the Student ID that the full form requires, writes with `addDoc` directly, bypasses `logActivity`, has no duplicate check, and has no email, DOB or address.
- Impact: Students created here have no student ID and cannot be found by ID in Quick Payment; they are invisible in the audit log; a permission change can white-screen a user.
- Fix: Move the early return below all hooks; require the same fields; call the shared save and `logActivity`.
- Verified: yes (hooks order is a static read)

---

## Public quick-payment and WhatsApp

### [UX-012] The "Quick Payment" link is public by route but cannot work logged out; for a logged-in user it skips permission checks, the ledger and the audit log
- Severity: Medium
- Effort: M
- Location: `src/App.js:82`; `src/pages/Settings.jsx:77`; `src/pages/QuickPayment.jsx:26-30`, `:48-61`; `supabase/security.sql:142-153`, `:175-186`
- Evidence: Settings tells staff: "Share this link with staff to log fee payments without logging in." The route is outside `PrivateRoute`, but all reads and writes go through the Supabase client with RLS requiring an authenticated user with `canViewStudents` and `canEditFees`. Logged out, `getDocs(students)` returns nothing (or throws, uncaught: there is no `.catch`), so the search box simply never shows a student and nothing explains why. When a staff member is logged in the form creates an invoice marked `paid` directly: no `recordPayment` (cash/bank balances do not move), no `paidAccount`, `lineItems` amount is a string, no `logActivity`, no duplicate check for the same student and month, and no confirm.
- Impact: Staff following the in-app instructions find a form that silently does nothing. The cases where it does work create a paid invoice that is missing from the ledger and the audit trail (accounting-auditor to quantify).
- Fix: Put it behind `PrivateRoute` (permission `canEditFees`) inside the Layout, reuse `Fees` `confirmPay`/`recordPayment`, show "sign in to use this", and correct the Settings text.
- Verified: yes (code); not exercised with a real DB

### [UX-013] WhatsApp messages about children's fees are sent automatically to guardians with no consent record or opt-out
- Severity: High
- Effort: M
- Location: `src/utils/whatsapp.js:49-54`; `src/pages/Fees.jsx:157`, `:188`, `:291`, `:307`, `:389`; `src/pages/QuickPayment.jsx:62-67`; `src/pages/ReminderLogs.jsx:68`; schema `students.parent_phone`
- Evidence: Every payment path and the bulk reminder run call `sendWhatsAppMessage(student.parentPhone, ...)` with the child's name, month and amount. No `whatsapp_consent` / opt-out field exists in `students` or `COLUMNS` (`src/firebase.js:48`); the UI never asks. The bulk-pay modal has a "send WhatsApp" checkbox but bulk receive and recurring do not. Messages are English only. The sender is a client-side token (`REACT_APP_WHATSAPP_TOKEN`, SEC-owned).
- Impact: Messaging parents without recorded opt-in breaches WhatsApp Business policy (the number can be banned), and for a school processing children's data it also creates a lawful-basis and unsubscribe gap. A wrong number leaks one child's fee status to a stranger, with no confirmation of the recipient.
- Fix: Add `guardian_whatsapp_consent` (+ date, source) and `whatsapp_opt_out` to students; send only when consented; show the recipient (masked) in each confirmation; include "reply STOP" text in templates; use approved templates for first contact.
- Verified: yes

### [UX-014] WhatsApp status claims are wrong, and local-format phone numbers fail silently
- Severity: Medium
- Effort: S
- Location: `src/pages/QuickPayment.jsx:97-99`; `src/utils/whatsapp.js:49`; `src/pages/Fees.jsx:157-158`, `:188`, `:291`
- Evidence: The success screen always says "WhatsApp receipt sent to parent ✓", even when no phone exists or the send returned `{ok:false}` (the result is never inspected). `clean()` only removes non-digits, so a number saved the common Pakistani way (`0300 1234567`, the form placeholder says `+92...` but does not enforce it) is sent as `03001234567`, which the Cloud API rejects. In `Fees.jsx` the failure result is ignored on all payment paths; only the manual "Remind" button reports errors.
- Impact: Staff tell parents "you will get a receipt" and none arrives; there is no way to see failures except the manual path. The reminder log table is not written by the payment paths.
- Fix: Check the result and show "Receipt not sent: reason" with a retry; normalise to E.164 using the school's default country code on save; validate phone input.
- Verified: yes

---

## Privacy and compliance

### [UX-025] Student and guardian PII inventory, minimisation and retention are undefined
- Severity: Medium
- Effort: M
- Location: `src/pages/Students.jsx:17`, `:303-307`; `supabase/schema.sql:54-70`; `src/pages/Employees.jsx:17`; `src/pages/Trash.jsx`
- Evidence: Student record: full name, student ID, grade, date of birth (`dob text`, free text), home address, guardian name, guardian phone, guardian email, branch, monthly fee, concession notes (e.g. "financial hardship" in `invoices.concession_note`). Employee record: name, phone, email, salary, join date, role. Reminder log stores the full message text and phone. Receipt photos upload to storage (`src/lib/storage.js`) and the URL is stored on the invoice. DOB and address are collected but not used anywhere in the app (no age or address output). There is no privacy notice, no field marked optional, no retention rule (students never expire, trashed rows never purge, audit log grows forever), and `ActivityLog` details contain student names.
- Impact: Child data is held with no documented purpose, retention or deletion path. Concession notes about hardship are sensitive and are visible to everyone with Fees access.
- Fix: Produce a one-page data map; make DOB and address optional or drop them; set retention (e.g. leaver plus N years) with a scheduled purge; restrict concession notes to a role; add a short privacy notice in the login or settings area.
- Verified: yes (inventory from code and schema)

### [UX-026] No data-subject tools: no export of one person's data, no erasure, no anonymise-on-leaving
- Severity: Medium
- Effort: M
- Location: whole app (absence); `src/pages/Trash.jsx`; `src/utils/exportUtils.js`
- Evidence: There is no "export this student/guardian's data" or "erase / anonymise" action. Hard delete is available only from Trash and breaks the ledger (UX-022). `StudentLedger.jsx` shows fees but has no print/export. Exports are page-wide lists (current filter).
- Impact: A parent's access, correction or deletion request has to be fulfilled by hand in SQL. Anonymising a leaver while keeping their fee history intact (needed for accounts) is not possible from the UI.
- Fix: A "Leave school" action that anonymises name/guardian/phone/address/DOB while keeping invoice totals; a per-student export (JSON/PDF) including audit entries about them.
- Verified: yes

### [UX-027] Exports (CSV/PDF) are open to every viewer, unlogged, and the PDF export injects raw HTML
- Severity: Medium
- Effort: S
- Location: `src/utils/exportUtils.js:1-37`; callers in `Students.jsx:125-132`, `Employees.jsx:119-125`, `Fees.jsx:401-409`, `Payslips.jsx`, `Expenses.jsx`, `Payments.jsx`, `ActivityLog.jsx:100`
- Evidence: `exportToCSV`/`exportToPDF` check nothing (see UX-004 for `canExport`). `exportToPDF` interpolates `title`, headers and every cell into a template literal with no escaping: `<td>${cell ?? ""}</td>`. A student named `<img src=x onerror=...>` (typed by anyone with Add Student, or imported from a spreadsheet) runs script in the print window. `exportToCSV` does not neutralise leading `=`, `+`, `-`, `@`, so a name like `=HYPERLINK(...)` becomes a live formula in Excel. If the pop-up is blocked `window.open` returns `null` and `w.document` throws; `w.print()` is called synchronously after `document.close()`, often before layout finishes.
- Impact: Stored XSS and spreadsheet formula injection through ordinary data fields; a privacy leak per UX-004; unreliable printing.
- Fix: Escape HTML in the PDF generator; prefix risky CSV cells with `'`; gate with `canExport`; log each export (module, row count, filter); use `w.onload = () => w.print()` and handle `null`.
- Verified: yes (code); XSS not exercised in a browser

### [UX-015] PIN login does not work and the PIN design is weak
- Severity: Medium
- Effort: M
- Location: `src/pages/Login.jsx:22-28`, `:42-58`; `src/pages/Users.jsx:153-162`; `supabase/security.sql:302-304`
- Evidence: The PIN tab loads `getDocs(collection(db,"users"))` before sign-in; RLS only lets authenticated users read the `users` table, so the list is always empty and the screen reads "No PIN users set up yet" (confirmed in the browser). If it did load, `signInWithEmailAndPassword` and `auth` are not imported in `Login.jsx` (ReferenceError, caught). The `catch` then calls `navigate("/")` with no session, which bounces back to `/login`. PINs are stored as plaintext in `users.pin` and compared client-side; minimum 4 digits.
- Impact: A feature admins are told to set up (Users, "PIN") can never sign anyone in, which wastes staff time and teaches them PINs are accepted. If ever fixed as written it would expose every PIN-enabled user's name, role and plaintext PIN to the public internet.
- Fix: Remove the tab or implement PIN as a second factor on a device already signed in; hash PINs server-side; do not list users before sign-in.
- Verified: yes (rendered; code traced)

### [UX-024] Shared-device and session hygiene: no password reset, idle timeout or logout confirmation
- Severity: Low
- Effort: M
- Location: `src/pages/Login.jsx`; `src/context/BranchContext.jsx:14-16`, `:48-51`; `src/components/Layout/Navbar.jsx:31`
- Evidence: Login has no "Forgot password". Sessions persist indefinitely (`persistSession: true`). The selected branch is stored in `localStorage` and survives logout, so the next user on a front-desk PC starts in the previous person's branch view. The signed-in email is always shown in the navbar.
- Impact: Front-desk machines are typically shared; staff who forget a password need an admin to reset it by SQL or the dashboard.
- Fix: Add Supabase password reset; clear `activeBranch` on sign-out; optional idle timeout.
- Verified: yes

---

## Accessibility

### [UX-010] Every modal is hand-rolled with no dialog semantics, focus management or Escape; the shared Modal.jsx is empty
- Severity: Medium
- Effort: M
- Location: `src/components/UI/Modal.jsx` (0 bytes); 19 `position: "fixed", inset: 0` overlays across `Students.jsx:291`, `Fees.jsx:636-979`, `Users.jsx:489-655`, `Payslips.jsx`, `QuickAdd.jsx:77`, `BulkEditModal.jsx`, etc.
- Evidence: No `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, initial focus, focus return or Escape handler (grep for `role=`/`aria-`/`Escape` finds only `Pagination`, `BulkBar`, `ListToolbar`, `SearchableSelect`, one FAB label). Several close on backdrop click while others (Students, Users) do not, so behaviour differs by page. The close "X" buttons (30 occurrences of `<X size`) are unlabelled icon buttons.
- Impact: A keyboard or screen-reader user opens "Record Fee Payment", Tab continues into the page behind it, Escape does nothing, and the reader announces nothing. This also makes it easy for staff to type into the wrong form.
- Fix: Implement `Modal.jsx` once (portal, `role="dialog"`, `aria-modal`, labelled title, trap focus, Esc to close, return focus, scroll lock) and replace the 19 copies.
- Verified: yes

### [UX-028] Viewport zoom is disabled
- Severity: Medium
- Effort: S
- Location: `public/index.html:6`
- Evidence: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />` (confirmed in the rendered page).
- Impact: Low-vision users on phones cannot pinch-zoom the fee tables; fails WCAG 1.4.4 (resize text).
- Fix: Remove `maximum-scale` and `user-scalable=no`; the global `input {font-size:16px}` rule already prevents the iOS focus-zoom.
- Verified: yes

### [UX-029] Colour contrast failures on status text, muted text and the sidebar footer
- Severity: Medium
- Effort: S
- Location: `src/index.css:19-23`; `src/pages/Students.jsx:201`, `:235`; `src/pages/ActivityLog.jsx:32-46`; `src/components/Layout/Sidebar.jsx:300`, `:172`; `src/pages/Login.jsx:154`; disabled buttons `background: "#c4a0a8"` throughout
- Evidence (computed ratios): success green `#10b981` on `#ecfdf5` 2.41:1 and on white 2.54:1; amber `#f59e0b` on `#fffbeb` 2.07:1; red `#ef4444` on `#fef2f2` 3.44:1 (used at 11-13px); grey `#94a3b8` on white 2.56:1; white on disabled `#c4a0a8` 2.35:1; Sidebar footer 25% white on `#4a1520` 2.17:1 and sub-title 40% white 3.49:1; Login footer `#cbd5e1` on white 1.48:1; white on teal `#2a8c7a` buttons 4.09:1. Requirement for body text is 4.5:1.
- Impact: Paid/pending/overdue status badges, the core signal of the fee screens, are hard to read in sunlight or for colour-weak users. Status is also communicated by colour alone in several places (green/red "Can see/Hidden" is accompanied by an icon, good, but invoice badges rely on colour plus the word).
- Fix: Darken text tokens (e.g. `#047857`, `#b45309`, `#b91c1c`, `#64748b` minimum) and define them once in `:root`; give disabled buttons a visible text colour.
- Verified: yes (ratios computed)

### [UX-030] Icon-only buttons have no accessible names; clickable divs are not keyboard-operable; tables lack semantics
- Severity: Medium
- Effort: M
- Location: `Students.jsx:188-190`, `:241-243`; `Fees.jsx:583`; `Users.jsx:365-373`, `:234-237`; `AccessOverview.jsx:156`; `Layout/Navbar.jsx:18-21`; `Layout/Sidebar.jsx:175-192`; `QuickPayment.jsx:138-148`; table headers across pages
- Evidence: Edit/Delete/close/menu buttons contain only a Lucide icon, with at most a `title` (Students edit/delete have none). The Navbar menu toggle has no label or `aria-expanded`. The Accounting group toggle has no `aria-expanded`. Access Overview toggles and the Users permission-group headers are `<div onClick>` with no role, tabindex or key handler. Quick Payment search results are `<div onClick>` entries. Tables use `<th>` without `scope`, sorting is a separate dropdown (fine), and the password show/hide button has no name. Login mode toggle uses plain buttons without `aria-pressed`/tablist.
- Impact: Screen-reader users hear "button" for edit/delete and cannot operate the Access Overview or the student picker with the keyboard, so they cannot do the main security task.
- Fix: Add `aria-label` to every icon button; switch the permission rows to real checkboxes/`role="switch"`; make result lists `role="listbox"` with arrow-key handling (the existing `SearchableSelect` already does this and could replace the custom list); add `scope="col"`.
- Verified: yes

### [UX-031] Form labels are not associated with inputs and validation feedback is toast-only
- Severity: Medium
- Effort: M
- Location: `Students.jsx:309-313`, `QuickAdd.jsx:111-165`, `Users.jsx:498-545`, `Login.jsx:90-100`, `QuickPayment.jsx:121-247`; only 3 `htmlFor` exist in the codebase
- Evidence: Labels are `<label>` siblings without `htmlFor`/`id` or wrapping, so screen readers announce "edit text" with no name and clicking the label does not focus the field. Required fields use native `required` only (no `aria-required`, no inline error text); errors from the database are shown by `toast.error(err?.message)`, which is raw Postgres text (for example a row-level security violation) and disappears after about 4 seconds. Phone and email use no `type`/`inputMode` hints (`parentPhone` is `type="text"`).
- Impact: Forms are announced as unlabeled; users who miss a toast do not know why a save failed.
- Fix: A small `<Field label error>` component that generates the id, links `aria-describedby`, and renders inline errors; map known database errors to plain language ("You do not have permission to do this").
- Verified: yes

---

## States, resilience and layout

### [UX-032] Loading and error states are missing: lists claim "No students found" while loading or after failure
- Severity: Medium
- Effort: M
- Location: `src/pages/Students.jsx:45-57`, `:205`, `:251`; `src/hooks/useCollection.js:31-45`; `src/context/BranchContext.jsx:60`; `src/pages/Payslips.jsx:42-52` and similar raw `onSnapshot` pages
- Evidence: `useCollection` returns `loading` but `Students`/`Employees` do not destructure it, so the empty message "No students found" is shown while data is still loading and also when the query errored (the error is only `console.error`). Pages with their own `onSnapshot(...)` have no error callback at all. `BranchProvider` renders `null` (a blank page) until branches load. Only Trash, ActivityLog and Dashboard show "Loading...". There are no skeletons.
- Impact: On a slow connection staff see a confident empty list, may re-import or re-add students, and a permissions failure (RLS returns no rows) looks identical to "no data".
- Fix: Use `loading` and an `error` state in every list; show skeleton rows and a retry button; distinguish "no results for this filter" from "nothing exists yet" (with an "Add your first student" call to action).
- Verified: yes

### [UX-033] Offline/PWA support is non-functional and the install icon is wrong
- Severity: Low
- Effort: S
- Location: `public/sw.js` (file name has a trailing space in git); `public/manifest.json:4-8`; `src/index.js:13-19`
- Evidence: The service worker precaches `/static/js/main.chunk.js` and `/static/css/main.chunk.css`; Create React App 5 emits hashed names (`main.<hash>.js`), so `cache.addAll` should reject and the worker never installs (not checked against a production build). If it did install, the fetch handler is cache-first for everything with no versioning, so after a deploy users could keep an old shell. There is no offline banner and Supabase calls fail with generic toasts. The manifest declares one 205x246 PNG as both 192x192 and 512x512 `maskable`.
- Impact: Fee desks that lose connectivity get blank loading states instead of a clear "offline" message; installing to the home screen shows a distorted or rejected icon.
- Fix: Use CRA's `service-worker.js` (workbox) or remove the worker; add an online/offline indicator and disable payment buttons when offline; supply proper 192/512 square icons.
- Verified: no (build not produced)

### [UX-034] Mobile: floating buttons overlap, exports hidden, the sidebar lacks focus handling
- Severity: Low
- Effort: S
- Location: `Layout/QuickAdd.jsx:66`; `UI/BulkBar.jsx:36-40`; `Students.jsx:139`, `Fees.jsx:429-434`; `Layout/Layout.jsx:36-66`
- Evidence: The QuickAdd FAB (fixed bottom-right, z-index 900) and the BulkBar (fixed bottom-centre, z-index 900, up to full width) occupy the same corner on a phone, so a selected row set covers the FAB or the bar's last button. CSV/PDF buttons are removed entirely on mobile (`!isMobile`). Only Students, Fees, Payslips and ActivityLog have a mobile card layout; the other tables (Expenses, Payments, Users, Journals, Reports) rely on horizontal scroll with `minWidth`. The mobile sidebar slides in but focus stays on the page, Escape does not close it, and the closed drawer is only translated, so its links remain tabbable. The mobile app width mixes `window.innerWidth` resize handlers in at least six pages.
- Impact: Moderate on phones; the main path (fee collection on a phone) works, but selection-mode and exports are awkward.
- Fix: Raise the BulkBar above the FAB or hide the FAB while a selection is active; add `inert`/`aria-hidden` to the closed drawer and close on Escape; share one `useIsMobile` hook; offer CSV on mobile.
- Verified: yes (static read; not rendered with data)

### [UX-035] No printable fee receipt, invoice or student statement; payslip print works only through a pop-up
- Severity: Medium
- Effort: M
- Location: `src/utils/invoiceGenerator.js` (0 bytes); `src/pages/Fees.jsx:944-985` (Invoice Detail); `src/pages/StudentLedger.jsx`; `src/pages/Payslips.jsx:233-241`, `:613`; no `@media print` anywhere (`src/index.css`)
- Evidence: Only payslips can be printed, via `window.open` plus `document.write` of a fixed-width HTML string. The invoice detail modal and the student ledger have no Print or PDF action, and `Reports.jsx` has no export. The payslip popup opens with an inline stylesheet but not the logo, no `@page` size and no page-break control; it contains the employee's salary in a new window and uses the browser default font, so Urdu names print in a fallback font. If the browser blocks the popup, `w` is `null` and the button throws.
- Impact: The only receipt a parent gets is a WhatsApp text (and only if UX-013/014 work). A school cannot hand over a paper receipt or an annual statement, an everyday requirement.
- Fix: Implement the receipt/invoice/statement templates (A5 or thermal width, with school header, receipt number, paid date, account, signature), add `@media print` styles and print the current page via `window.print()` instead of a pop-up.
- Verified: yes

### [UX-036] No multi-language or RTL support; currency and date formats depend on each browser
- Severity: Medium
- Effort: L
- Location: `public/index.html:3`; `src/index.css`; `Rs.` literals in `Fees.jsx`, `Payments.jsx`, `Payslips.jsx` etc. (about 90 `toLocaleString()` calls); `src/utils/dates.js:29-37`; `ActivityLog.jsx:54`; `exportUtils.js:29`; `src/utils/whatsapp.js`
- Evidence: `<html lang="en">`, no `dir`, all strings hard-coded in English, WhatsApp texts English only. Money is formatted with `Number(x).toLocaleString()` with no locale, so a browser set to en-US prints `1,000,000` and one set to en-IN prints `10,00,000`, and the receipt and the PDF can disagree. Dates mix `toLocaleDateString()` (browser locale) with `formatDate()` (en-GB) and raw `YYYY-MM-DD`. `dob` is a free-text column. The login logo itself contains Urdu script, and teachers and parents are likely Urdu readers.
- Impact: Parents receive English-only messages; two staff on different machines see different number and date formats; any future Urdu UI would need a layout rewrite because spacing, icons and table alignment use left/right values everywhere.
- Fix: One `formatMoney`/`formatDate` helper with a fixed `en-PK` (or configurable) locale; translate strings through a small i18n layer; use logical CSS properties (`padding-inline-start`) now to keep RTL possible; supply Urdu WhatsApp templates; use a Nastaliq-capable font in print.
- Verified: yes

### [UX-037] Toast and error messaging: raw system errors, and one-click flows that go quiet
- Severity: Low
- Effort: S
- Location: `Fees.jsx` (28 toast calls), `Payslips.jsx` (18), `Users.jsx:147-149`; `<Toaster position="top-right">` `App.js:77`
- Evidence: Many catch blocks show `toast.error(err?.message)` verbatim. Success toasts are fired for every small action ("Student updated", "Copied") while some state-changing actions are silent (Branches delete, role create failure, Access Overview save, deletion of a user). Default toast lifetime is used with no dismiss or "view" link, and the long reminder error (`duration: 7000`) mixes instructions into the toast.
- Impact: Messages are either technical or missing; the important failures are the ones with no message.
- Fix: Central `notifyError(err)` that maps common cases; stop toasting for trivial successes; always toast on failure; use an inline banner for errors that need action.
- Verified: yes

### [UX-038] Branding and navigation inconsistencies
- Severity: Low
- Effort: S
- Location: `Layout/Sidebar.jsx:172` ("Zohra Majeed Institute"); `Login.jsx:71`, `exportUtils.js:29`, `Payslips.jsx:621` ("Zohra Majeed Islamic Institute"); `Sidebar.jsx:112-123`
- Evidence: The school name differs between the sidebar and every printed or login surface. Two sidebar entries use the same shield icon ("Users" and "Access Control") and sit apart from each other with "Import Data" between them. "Reminder Logs" is nested under Accounting. The empty-state copy is the same grey "No X found" on every page.
- Impact: Cosmetic but visible on printed documents.
- Fix: One `SCHOOL_NAME` constant; group Users, Access Control, Import under an "Admin" section; give each a distinct icon.
- Verified: yes

---

## Summary of high-severity items to schedule first

1. UX-001 fail-open admin role and "remove user" that does not remove.
2. UX-002 custom role creation fails silently.
3. UX-003 Fee Collector lands on Access Denied.
4. UX-004 / UX-005 / UX-006 permission matrix is not enforced in the UI, overrides are not enforced in the database, and admins can lock themselves out.
5. UX-008 audit gaps, UX-013 WhatsApp consent.
