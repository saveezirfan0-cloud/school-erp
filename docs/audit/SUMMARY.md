# School ERP audit summary

Merged from seven agent reports in this folder (about 200 findings in total). Nothing was run against the live Supabase project, so anything that depends on its dashboard settings is marked "check live".

## Verdict

The app works as a convenient fee-collection screen but is **not safe to hold real student, fee and payroll data in its current state**. Three problems dominate:

1. **Authorization is mostly cosmetic.** The browser decides who can do what, a missing profile makes you an admin, and the database policies are weaker than the UI implies (and can be switched off by re-running `schema.sql`).
2. **The money trail is not trustworthy.** There is no real double-entry ledger. Several screens mark invoices "paid" without any ledger entry, writes are not transactional, and Dashboard and Reports disagree on the same data.
3. **Secrets and data exposure.** The WhatsApp token and a cron secret are compiled into the public JS, the PDF export is open to script injection, and a `.env` was committed.

On the positive side, the foundation (React plus Supabase with role policies) is sound enough to fix incrementally rather than rewrite.

## Spot checks I made against the code

| Claim | Result |
|---|---|
| ACC-01: QuickPayment creates a "paid" invoice with no ledger entry | Confirmed: `QuickPayment.jsx:48-62` is a single `addDoc` with `status: "paid"` |
| SEC-05 / DB-1: `schema.sql` recreates an allow-all policy | Confirmed: `schema.sql:252-254` |
| CODE-01 / UX-001 / SEC-09: role falls back to admin | Confirmed: `UserContext.jsx:139-155, 187-188` |
| SEC-01 / DEP-10: WhatsApp token in the bundle | Confirmed by source: `whatsapp.js:19` reads `REACT_APP_WHATSAPP_TOKEN` |
| SEC-18: `.env` in git history | Confirmed: added in the first commit with Firebase keys and a WhatsApp token. The token value is only 19 characters, so it may be a placeholder, but check |

## Critical and High findings

| ID(s) | Finding | Effort |
|---|---|---|
| ACC-01, DB-4 | Invoices become "paid" with no ledger entry via six paths; branch staff cannot see accounts so ledger posting fails for them | M |
| SEC-01, DEP-10, CODE-26 | WhatsApp token (and `REACT_APP_CRON_SECRET`, DEP-11) in the public bundle and in git history | S |
| SEC-02, CODE-16 | PDF export injects unescaped HTML, so a data-entry user can run script in an admin's session; CSV export has formula injection (SEC-15) | S |
| SEC-05, DB-1 | Re-running `schema.sql` re-enables an allow-all policy | S |
| CODE-01, UX-001, SEC-09 | Missing profile, error or unknown role gives admin; removed users keep a working login | M |
| SEC-03, UX-004 | Delete and export permissions unenforced; financial records can be permanently deleted by non-admins | M |
| SEC-04, UX-008 | Audit log written by the browser; permission changes, imports and exports not logged | M |
| SEC-06, SEC-07, UX-005 | Permission overrides are UI-only; users can edit their own; role promotion guard is weak | M |
| ACC-06, ACC-04 | No double-entry ledger or trial balance; Dashboard (17,000) and Reports (10,500) disagree on the same data | L |
| CODE-09 to 14, DB-3, ACC-03, ACC-09 | Money writes are separate browser calls (no transaction, locking or idempotency): double-click pays a payslip twice, trash restore leaves the ledger reversed | M to L |
| DB-5, CODE-02, ACC-21 | Reads capped at 1000 rows with no pagination, so balances and reports go silently wrong at scale (ACC-21 unverified) | M |
| DB-2 | About 19 table references are plain text with no foreign keys, no CHECK or NOT NULL rules; 29 fields (all payroll amounts) in jsonb | L |
| DB-6 | RLS helper functions run about 5 lookups per row | S |
| DEP-1, SEC-13 | `xlsx` 0.18.5 has two high advisories and parses uploaded files | S to M |
| DEP-15, DEP-16 | Single environment, no migrations, README SQL order incomplete (`trash.sql` missing), no evidence of backups or restore tests | M |
| UX-002, UX-003, UX-006 | Custom role creation fails; `fee_collector` login lands on Access Denied; an admin can demote themselves or delete the last admin | S |
| UX-013 | WhatsApp messages about children's fees sent with no consent record | M |
| CODE-15, SEC-12 | PIN login is broken, and PINs are stored in plaintext | S to M |

## Themes found by several agents

- **Fail-open permissions:** security, code quality, UX and database all hit the same root cause. Fix the database as the single source of truth for permissions, then make the UI follow it.
- **Money correctness:** accounting, database and code quality agree the posting logic needs to move server-side as database functions (the database report includes ten draft RPCs).
- **Secrets in the client:** WhatsApp token, cron secret and Firebase keys in history. The reminders feature calls `/api/send-reminders`, which does not exist in the repo.
- **No safety net:** no tests, CI, `.gitignore` (added in this branch), environments, backups or monitoring.
- **Dead and empty code:** `invoiceGenerator.js`, `Modal.jsx` and `Table.jsx` are empty; `date-fns` and `react-hook-form` unused; the service worker has a trailing space in its filename and never registers.

## Prioritized backlog

### Wave 1: this week (stop the bleeding)
1. Rotate the WhatsApp token and any keys that were in the committed `.env`, remove `REACT_APP_WHATSAPP_TOKEN` and `REACT_APP_CRON_SECRET` from Vercel, and move sending into an authenticated Edge Function.
2. In production run `select * from pg_policies where schemaname='public'` and confirm no `auth all` policy exists; remove that block from `schema.sql` (check live).
3. Escape the PDF export HTML; neutralize CSV formulas; add security headers and a CSP; turn off source maps.
4. Make roles default to `none`, not admin; delete the auth account when removing a user; block self-promotion and last-admin removal.
5. Remove non-admin DELETE on invoices, payments, payslips and journals.
6. Turn on backups or point-in-time recovery and do one restore test (check live). Confirm signups are disabled.
7. Add a double-submit guard to payments and payslips.

### Wave 2: this month (make the numbers trustworthy)
1. Introduce ordered migrations, keys, constraints and indexes (database report has the SQL to review).
2. Build the money RPCs so invoice, payment and ledger writes are one transaction; route QuickPayment, Bulk Receive, Import and concessions through them.
3. Replace the client-side audit log with database triggers.
4. Apply per-user overrides inside `has_perm()` and enforce delete and export permissions in the database.
5. Add server-side pagination and fix the 1000-row cap; reconcile Dashboard and Reports from one source.
6. Replace `xlsx`; add CI (lint, build, tests, `npm audit`, secret scan); write tests for the 10 targets in CODE-47.
7. Create a staging Supabase project.

### Wave 3: later
Vite migration (about 4 to 6 hours), splitting the large page files, MFA and password reset, consent records and retention rules, accessibility fixes, branch-scoping the accounting tables.

## Feature roadmap highlights

- **Now:** fee aging and defaulters list; scheduled server-side reminders with approved WhatsApp templates; numbered printable receipts. All use data you already have.
- **Next:** classes, sections, academic years and year-end promotion; fee structure templates with sibling and scholarship discounts.
- **Later:** parent portal, attendance, exams and report cards, transport.

## Not covered by any agent

- The live Supabase and Vercel configuration (signup setting, storage policies, deployed headers, whether the token is real).
- Any real data volume, performance under load, and real-user testing.
- Legal advice on student-data rules in your jurisdiction.
- Authenticated pages were not rendered in a browser.
- The old Firebase project referenced in git history (SEC-18) may still hold data.
