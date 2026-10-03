# ZMI School ERP

School management ERP (students, fees/invoices, payments, expenses,
employees, payslips, accounting, reports) built with React and
Supabase (Postgres + Auth + Storage + Realtime).

## Tech
- React (Create React App), Node 20
- Supabase backend via a Firestore-compatible shim (`src/firebase.js`).
  Despite the file name, Firebase is not used. The shim maps camelCase
  app fields to snake_case columns; any field that is not listed in its
  `COLUMNS` map is stored in the table's `extra` jsonb column, so keep
  `COLUMNS` in sync with the SQL schema.
- Real-time multi-session sync; roles and branches are enforced in the
  database (Row-Level Security)

## Environment variables
Copy `.env.example` to `.env.local` and fill in the values; on Vercel set
them in Settings -> Environment Variables. **Do not commit real values.**

| Variable | Where it comes from |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase -> Settings -> API -> Project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase -> Settings -> API -> anon public |

The optional WhatsApp variables are listed in `.env.example` with a warning.

> **Every `REACT_APP_` variable is public.** Create React App compiles it
> into the JavaScript served to every visitor. Never put a secret there.

## Backend setup (Supabase dashboard)

### SQL order (Supabase SQL Editor)

**New database**, run these in this order, once:
1. `supabase/schema.sql` creates the tables (and turns RLS on with no policies, so it is closed until step 4)
2. `supabase/accounting.sql` ledger columns (reversals, paid amounts)
3. `supabase/trash.sql` the `deleted_at` columns the app filters on
4. `supabase/security.sql` baseline role and branch policies (includes the `teacher` role)
5. `supabase/realtime.sql` live updates (never publishes `users` or `audit_log`)
6. `supabase/attendance.sql` attendance table (profile pages and the Attendance page)
   `supabase/budgets.sql` budgets table + RLS (only for Reports -> Budget vs Actual; the rest of Reports works without it).
   It uses the `has_perm` / `branch_visible` helpers from `security.sql`, so run it after step 4.
7. `supabase/lms.sql` academic tables and teacher permissions (needs step 6; see *Academics / LMS* below)
8. `supabase/migrations/0001` to `0013`, in number order (hardening: policies, keys, audit triggers,
   money functions, storage, academic tables). Then create your first admin (see the runbook).

**Existing database** (steps 1 to 7 already applied): do **not** re-run them. Take a backup first, then
apply the files in `supabase/migrations/` in order, following `supabase/migrations/README.md`. It has the
pre-flight checklist, what each file changes, which ones must wait for an app change
(`0011`, `0012`), legacy-data check queries, rollback notes and backup advice. If `attendance.sql` /
`lms.sql` have not been run yet, run them later and then re-run `0013`: the migrations skip a missing
table and log it. After the migrations, `lms.sql` is safe to re-run (it no longer replaces the hardened
`has_perm`), but run `0013` again afterwards to put the hardened academic policies back.
The one-off data scripts (`fix_invoice_branch.sql`, `seed_chart_of_accounts.sql`,
`rollback_workbook_import.sql`, `scripts/activate_historical_import.sql`) work unchanged next to the
migrations; see the notes in the migrations README.

Never paste an old copy of `schema.sql` over a live database: the old version re-created an
allow-all policy. The current one cannot. `supabase/legacy/` holds old one-off scripts that must not be run.

### Then

- Disable signups: Authentication → Sign In/Providers → Email → off
- Deploy `supabase/functions/create-user/index.ts` as an Edge Function
  named `create-user`, and set its secrets `SERVICE_ROLE_KEY` and
  `PROJECT_URL`
- Create a `receipts` storage bucket for receipt uploads (the app limits uploads to JPG, PNG, WebP or PDF up to 5 MB; public for now;
  `supabase/migrations/0012_storage_receipts.sql` creates it if missing and adds size,
  type and branch-folder rules; making it private with signed URLs is an optional later step)

## Exports & printable documents
- Every list page (Fees, Payments, Expenses, Students, Employees,
  Payslips, Activity Log) has an **Export** menu: PDF, Excel (.xlsx) or
  CSV of the rows currently filtered on screen. Reports and the bank/cash
  account page export too.
- Single documents open in a viewer with **Print** and **PDF** download:
  invoices and fee receipts (Fees → View, or select rows → *Invoices PDF* /
  *Receipts*), payslips (Payslips → View), payment receipts/vouchers
  (Payments). A student's ledger exports to PDF/Excel/CSV from its Export menu.
  Selecting several rows produces one combined PDF, one document per page.
- PDFs are built in the browser (jsPDF, loaded on demand). Text outside
  Latin characters (e.g. Urdu) can't be drawn by jsPDF's built-in fonts, so
  those documents open in the print dialog instead — choose "Save as PDF".
- Layouts live in `src/utils/documents.js`; table export helpers in
  `src/utils/exportUtils.js`.

## Academics / LMS
Staff-side learning features: attendance, exams and report cards,
subjects, homework and learning materials, plus a per-student academic
profile. There is no student or parent login yet.

**Setup:** after `schema.sql`, `security.sql`, `attendance.sql`,
`trash.sql` and `realtime.sql`, run `supabase/lms.sql` once in the SQL
Editor (safe to re-run; it stops with a clear error if `attendance.sql`
hasn't been run). It creates the academic tables with RLS and realtime,
adds the `teacher` role and the academic permissions, and widens the
`attendance` policies so teachers can mark student attendance. Attendance
itself lives in the shared table from `attendance.sql` (students and
employees, one row per person per day), so the profile-page attendance
and the Attendance page always agree. To get the teacher
role in `has_perm`, either re-run the updated `security.sql` or run
`lms.sql` once (it redeclares the same function). On a database where `supabase/migrations/`
has been applied, `has_perm` already knows the teacher role (migration 0002) and `lms.sql`
leaves it alone.

**Teacher role:** create teachers from Users with the `teacher` role and
a branch. Teachers can view students and use attendance, exams and
learning (view and edit); they get no finance access. Admins and branch
managers get the same academic permissions; accountants and fee
collectors get none. Permissions are `canViewAttendance` /
`canEditAttendance`, `canViewExams` / `canEditExams` and
`canViewLearning` / `canEditLearning`.

**Features**
- Attendance: daily marking by class, late/leave, history, monthly
  summary and %, low-attendance list, CSV/PDF export
- Exams: marks grid, grading scale, class ranking, publish toggle,
  printable report cards (single or whole class)
- Subjects, homework with per-student submission tracking and grading,
  learning materials library
- Student academic profile (`/students/:id/academics`, linked from
  Students): attendance %, exam history and trend, homework status
- Dashboard "Academics today" card: present/absent/late, classes
  marked, homework due this week

Attendance % is (present + late) / (present + late + absent); approved
leave is left out.

**Known limitation:** homework attachments and material file uploads
reuse the `receipts` storage bucket (via `src/lib/storage.js`), so that
bucket must exist and be public. Pasting a link works without it.

## Scripts
```
npm start           # dev server
npm run lint        # ESLint (react-app rules)
npm run test:ci     # unit tests once (npm test for watch mode)
npm run test:tz     # date utils under two timezones
npm run build       # production build (no source maps, external runtime chunk)
```
CI (`.github/workflows/ci.yml`) runs lint, tests, build, `npm audit` (not
blocking yet) and a secret scan on every push and pull request.

## Deploy
Push to GitHub, import the repo in Vercel and set the env vars. Use separate
Supabase projects for Preview and Production. `vercel.json` sets security
headers; the Content-Security-Policy is shipped as **report-only** until it has
been checked against the live app, then rename the header to
`Content-Security-Policy` to enforce it.

## Security notes
- Public signups must stay **off**. Staff accounts are created by an admin
  through the `create-user` Edge Function.
- The Supabase **service_role** key lives only in that Edge Function's secrets.
  It must never be in a `REACT_APP_` variable, in Vercel's client env, or in git.
- The browser is untrusted. Permissions that matter must be enforced by
  database policies; UI checks only hide buttons.
- The in-app activity log is written by the browser and is best-effort. Do not
  treat it as tamper-proof evidence until it is backed by database triggers.
- If a `.env` file was ever committed or shared, treat every key in it as
  leaked: rotate the Supabase keys and any WhatsApp token, and remove them from
  git history.
- Exports escape HTML and neutralise spreadsheet formulas, but data entered by
  staff is still untrusted input everywhere else it is rendered.
