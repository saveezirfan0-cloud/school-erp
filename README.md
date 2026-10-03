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
3. `supabase/attendance.sql` — attendance table + RLS + realtime
   (needed for the Attendance tab on student / employee profiles)

Then:
- Disable signups: Authentication → Sign In/Providers → Email → off
- Deploy `supabase/functions/create-user/index.ts` as an Edge Function
  named `create-user`, and set its secrets `SERVICE_ROLE_KEY` and
  `PROJECT_URL`
- Create a `receipts` storage bucket (public) for receipt uploads

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
`lms.sql` once (it redeclares the same function).

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

## Run locally
```
npm install
npm start
```

## Deploy
Push to GitHub, import the repo in Vercel, set the two env vars, deploy.
