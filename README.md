# ZMI School ERP

School management ERP (students, fees/invoices, payments, expenses,
employees, payslips, accounting, reports) built with React and
Supabase (Postgres + Auth + Storage + Realtime).

## Tech
- React (Create React App)
- Supabase backend via a Firestore-compatible shim (`src/firebase.js`)
- Real-time multi-session sync, role + branch permissions enforced
  in the database (Row-Level Security)

## Environment variables
This app needs two variables. **Do not commit real values.** Locally
copy `.env.example` to `.env`; on Vercel set them in
Settings → Environment Variables.

| Variable | Where it comes from |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |

Optional (WhatsApp reminders): `REACT_APP_WHATSAPP_API_URL`,
`REACT_APP_WHATSAPP_PHONE_ID`, `REACT_APP_WHATSAPP_TOKEN`.

> The Supabase **service_role** key is never used in this app or on
> Vercel. It only goes into the `create-user` Edge Function as a
> secret (`SERVICE_ROLE_KEY`). Never put it in a `REACT_APP_` variable.

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
- Create a `receipts` storage bucket for receipt uploads (public for now;
  `supabase/migrations/0012_storage_receipts.sql` creates it if missing and adds size,
  type and branch-folder rules; making it private with signed URLs is an optional later step)

## Run locally
```
npm install
npm start
```

## Deploy
Push to GitHub, import the repo in Vercel, set the two env vars, deploy.
