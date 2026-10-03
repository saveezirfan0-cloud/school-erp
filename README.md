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
Run in the SQL Editor, in order:
1. `supabase/schema.sql` — creates the tables
2. `supabase/security.sql` — enables Row-Level Security policies

Then:
- Disable signups: Authentication → Sign In/Providers → Email → off
- Deploy `supabase/functions/create-user/index.ts` as an Edge Function
  named `create-user`, and set its secrets `SERVICE_ROLE_KEY` and
  `PROJECT_URL`
- Create a `receipts` storage bucket (public) for receipt uploads

## Exports & printable documents
- Every list page (Fees, Payments, Expenses, Students, Employees,
  Payslips, Activity Log) has an **Export** menu: PDF, Excel (.xlsx) or
  CSV of the rows currently filtered on screen. Reports and the bank/cash
  account page export too.
- Single documents open in a viewer with **Print** and **PDF** download:
  invoices and fee receipts (Fees → View, or select rows → *Invoices PDF* /
  *Receipts*), payslips (Payslips → View), payment receipts/vouchers
  (Payments), and a student fee statement (Students → Ledger → Statement).
  Selecting several rows produces one combined PDF, one document per page.
- PDFs are built in the browser (jsPDF, loaded on demand). Text outside
  Latin characters (e.g. Urdu) can't be drawn by jsPDF's built-in fonts, so
  those documents open in the print dialog instead — choose "Save as PDF".
- Layouts live in `src/utils/documents.js`; table export helpers in
  `src/utils/exportUtils.js`.

## Run locally
```
npm install
npm start
```

## Deploy
Push to GitHub, import the repo in Vercel, set the two env vars, deploy.
