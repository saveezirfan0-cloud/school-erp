-- ============================================================
-- ZMI School ERP — Supabase schema
-- BASELINE script for a brand-new database. Do not re-run it on a
-- live database by hand: see supabase/migrations/README.md for the
-- full, ordered setup (schema -> accounting -> trash -> security ->
-- realtime -> migrations/0001...). It is idempotent and safe to
-- re-run, but it will never change columns of existing tables.
-- Mirrors the former Firestore collections as Postgres tables.
-- Every table keeps a flexible shape: known/queried fields are
-- real columns; everything else lives in `extra jsonb` so the
-- app's schemaless writes never fail.
-- ============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------- helper: auto-update updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- USERS  (profile rows; the auth account itself lives in auth.users)
-- id MUST equal the Supabase auth user id (uuid).
-- ============================================================
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  uid         uuid,                      -- legacy alias, = id
  name        text,
  email       text,
  role        text default 'none',   -- fail closed: new profiles have no access until an admin sets a role (DB-15)
  branch_id   text,
  pin         text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- BRANCHES
-- ============================================================
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  address     text,
  phone       text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- STUDENTS
-- ============================================================
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  student_id    text,
  grade         text,
  parent_name   text,
  parent_phone  text,
  email         text,
  branch_id     text,
  monthly_fee   numeric,
  address       text,
  dob           text,
  recurring_fee boolean default false,
  extra         jsonb default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- EMPLOYEES
-- ============================================================
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- FEES / INVOICES
-- ============================================================
create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  student_id  text,
  branch_id   text,
  amount      numeric,
  status      text,
  due_date    text,
  date        text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- EXPENSES
-- ============================================================
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  description text,
  category    text,
  amount      numeric,
  date        text,
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- PAYMENTS  (cash & bank)
-- ============================================================
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  type        text,
  account     text,
  description text,
  category    text,
  amount      numeric,
  date        text,
  reference   text,
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- PAYSLIPS
-- ============================================================
create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  employee_id text,
  branch_id   text,
  amount      numeric,
  month       text,
  date        text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- ACCOUNTS  (chart of accounts)
-- ============================================================
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text,
  name        text,
  type        text,
  sub_type    text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- JOURNALS  (double-entry)
-- ============================================================
create table if not exists public.journals (
  id             uuid primary key default gen_random_uuid(),
  date           text,
  reference      text,
  description    text,
  debit_account  text,
  credit_account text,
  amount         numeric,
  notes          text,
  extra          jsonb default '{}'::jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ============================================================
-- CUSTOM ROLES   (id is the role key, e.g. "site_supervisor")
-- ============================================================
create table if not exists public.custom_roles (
  id           text primary key default ('role_' || replace(gen_random_uuid()::text, '-', '')),  -- UX-002: inserts that omit id no longer fail
  permissions  jsonb default '{}'::jsonb,
  extra        jsonb default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ============================================================
-- REMINDER LOGS
-- ============================================================
create table if not exists public.reminder_logs (
  id          uuid primary key default gen_random_uuid(),
  student_id  text,
  phone       text,
  message     text,
  status      text,
  date        text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  -- the one ordered query in the app sorts by this:
  timestamp   timestamptz default now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  "user"      text,
  action      text,
  module      text,
  details     text,
  timestamp   timestamptz default now(),
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

-- ---------- attach updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'users','branches','students','employees','invoices','expenses',
    'payments','payslips','accounts','journals','custom_roles','reminder_logs'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on public.%1$s;
       create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ============================================================
-- ROW LEVEL SECURITY  (fail closed)
--
-- This script ONLY switches RLS on. It deliberately creates NO
-- policies: with RLS enabled and no policy, every table is denied
-- to anon/authenticated until security.sql (and migrations/) add
-- the real per-role policies.
--
-- History (audit DB-1 / SEC-05): this script used to end with a
-- loop that created an allow-all policy named "auth all" on every
-- table. Postgres ORs permissive policies together, so re-running
-- this file on a live database silently re-opened everything.
-- That block has been removed. Re-running this file is now safe:
-- it never creates, replaces or drops any policy.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'users','branches','students','employees','invoices','expenses',
    'payments','payslips','accounts','journals','custom_roles',
    'reminder_logs','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
