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
4. `supabase/security.sql` baseline role and branch policies
5. `supabase/realtime.sql` live updates (never publishes `users` or `audit_log`)
6. `supabase/migrations/0001` to `0012`, in number order (hardening: policies, keys,
   audit triggers, money functions, storage). Then create your first admin (see the runbook).

**Existing database**: do **not** re-run steps 1 to 5. Take a backup first, then apply the files in
`supabase/migrations/` in order, following `supabase/migrations/README.md`. It has the
pre-flight checklist, what each file changes, which ones must wait for an app change
(`0011`, `0012`), legacy-data check queries, rollback notes and backup advice.

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
