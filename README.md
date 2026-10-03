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

## Backend setup
Database setup (SQL files, their order and how to apply them) is described
in [`supabase/migrations/README.md`](supabase/migrations/README.md). Follow
that file; do not run the SQL in a different order.

Also in the Supabase dashboard:
- Disable signups: Authentication -> Sign In / Providers -> Email -> off
- Deploy `supabase/functions/create-user/index.ts` as an Edge Function
  named `create-user` and set its secrets `SERVICE_ROLE_KEY` and `PROJECT_URL`
- Create the `receipts` storage bucket and review its policies (uploads are
  limited client-side to JPG, PNG, WebP or PDF up to 5 MB; also set the same
  limits on the bucket itself)

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
