-- ============================================================
-- ZMI School ERP — Backend security (RLS) v2
-- Run this AFTER schema.sql.
--
-- Goal: enforce the SAME permission model the app uses
-- (UserContext PERMISSIONS) at the DATABASE level, so a blocked
-- user cannot read/write data even if they bypass the UI or call
-- the REST API directly with their anon token.
--
-- Model (per the answered design question): a user's role and
-- branch are read from public.users, keyed by auth.uid().
-- ============================================================

-- ------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read users
-- without recursive RLS problems). Marked STABLE for caching.
-- ------------------------------------------------------------

create or replace function public.current_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role from public.users where id = auth.uid()), 'none');
$$;

create or replace function public.current_branch()
returns text
language sql stable security definer
set search_path = public
as $$
  select (select branch_id from public.users where id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_role() = 'admin';
$$;

-- Does the current user's role grant a named permission?
-- Built-in roles are hard-coded here to mirror UserContext.
-- Custom roles fall back to the custom_roles.permissions jsonb.
create or replace function public.has_perm(perm text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  r text := public.current_role();
  builtin jsonb;
  custom jsonb;
begin
  if r = 'admin' then
    return true;  -- admin can do everything
  end if;

  builtin := case r
    when 'branch_manager' then '{
      "canViewDashboard":true,"canViewStudents":true,"canEditStudents":true,
      "canViewEmployees":true,"canViewFees":true,"canEditFees":true,
      "canViewExpenses":true,"canEditExpenses":true,"canViewPayments":true,
      "canEditPayments":true,"canViewPayslips":true
    }'::jsonb
    when 'accountant' then '{
      "canViewDashboard":true,"canViewFees":true,"canEditFees":true,
      "canViewExpenses":true,"canEditExpenses":true,"canViewPayments":true,
      "canEditPayments":true,"canViewPayslips":true,"canEditPayslips":true,
      "canViewAccounting":true,"canEditAccounting":true,"canViewReports":true,
      "canViewAllBranches":true
    }'::jsonb
    when 'fee_collector' then '{
      "canViewStudents":true,"canViewFees":true,"canEditFees":true
    }'::jsonb
    else '{}'::jsonb
  end;

  if builtin ? perm and (builtin ->> perm)::boolean then
    return true;
  end if;

  -- custom role permissions
  select permissions into custom from public.custom_roles where id = r;
  if custom is not null and (custom ? perm) and (custom ->> perm)::boolean then
    return true;
  end if;

  return false;
end;
$$;

-- Branch scope: admins + roles with canViewAllBranches see every
-- branch. Others are limited to their own branch (and "main"/blank).
create or replace function public.branch_visible(row_branch text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  r text := public.current_role();
  ub text := public.current_branch();
begin
  if r = 'admin' or public.has_perm('canViewAllBranches') then
    return true;
  end if;
  if ub is null then
    -- user has no branch assigned -> treat as main office only
    return row_branch is null or row_branch = '' or row_branch = 'main';
  end if;
  return coalesce(row_branch, '') = ub;
end;
$$;

grant execute on function public.current_role, public.current_branch,
  public.is_admin, public.has_perm, public.branch_visible to authenticated;

-- ------------------------------------------------------------
-- Replace the broad "auth all" policies from schema.sql with
-- granular per-table policies.
-- ------------------------------------------------------------

-- helper to drop the old broad policy on a table
do $$
declare t text;
begin
  foreach t in array array[
    'users','branches','students','employees','invoices','expenses',
    'payments','payslips','accounts','journals','custom_roles',
    'reminder_logs','audit_log'
  ] loop
    execute format('drop policy if exists "auth all" on public.%I;', t);
  end loop;
end $$;

-- ============================================================
-- STUDENTS  (view: canViewStudents, write: canEditStudents,
--            delete: canDeleteStudents, scoped by branch)
-- ============================================================
drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (public.has_perm('canViewStudents') and public.branch_visible(branch_id));
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert to authenticated
  with check (public.has_perm('canEditStudents') and public.branch_visible(branch_id));
drop policy if exists students_update on public.students;
create policy students_update on public.students for update to authenticated
  using (public.has_perm('canEditStudents') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditStudents') and public.branch_visible(branch_id));
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete to authenticated
  using (public.has_perm('canDeleteStudents') and public.branch_visible(branch_id));

-- ============================================================
-- EMPLOYEES
-- ============================================================
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (public.has_perm('canViewEmployees') and public.branch_visible(branch_id));
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated
  with check (public.has_perm('canEditEmployees') and public.branch_visible(branch_id));
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using (public.has_perm('canEditEmployees') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditEmployees') and public.branch_visible(branch_id));
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated
  using (public.has_perm('canDeleteEmployees') and public.branch_visible(branch_id));

-- ============================================================
-- INVOICES / FEES  (view+edit: canViewFees/canEditFees)
-- ============================================================
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using (public.has_perm('canViewFees') and public.branch_visible(branch_id));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check (public.has_perm('canEditFees') and public.branch_visible(branch_id));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (public.has_perm('canEditFees') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditFees') and public.branch_visible(branch_id));
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated
  using (public.has_perm('canEditFees') and public.branch_visible(branch_id));

-- ============================================================
-- EXPENSES
-- ============================================================
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.has_perm('canViewExpenses') and public.branch_visible(branch_id));
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_perm('canEditExpenses') and public.branch_visible(branch_id));
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_perm('canEditExpenses') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditExpenses') and public.branch_visible(branch_id));
drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.has_perm('canDeleteExpenses') and public.branch_visible(branch_id));

-- ============================================================
-- PAYMENTS
-- ============================================================
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.has_perm('canViewPayments') and public.branch_visible(branch_id));
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check (public.has_perm('canEditPayments') and public.branch_visible(branch_id));
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using (public.has_perm('canEditPayments') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditPayments') and public.branch_visible(branch_id));
drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete to authenticated
  using (public.has_perm('canEditPayments') and public.branch_visible(branch_id));

-- ============================================================
-- PAYSLIPS
-- ============================================================
drop policy if exists payslips_select on public.payslips;
create policy payslips_select on public.payslips for select to authenticated
  using (public.has_perm('canViewPayslips') and public.branch_visible(branch_id));
drop policy if exists payslips_insert on public.payslips;
create policy payslips_insert on public.payslips for insert to authenticated
  with check (public.has_perm('canEditPayslips') and public.branch_visible(branch_id));
drop policy if exists payslips_update on public.payslips;
create policy payslips_update on public.payslips for update to authenticated
  using (public.has_perm('canEditPayslips') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditPayslips') and public.branch_visible(branch_id));
drop policy if exists payslips_delete on public.payslips;
create policy payslips_delete on public.payslips for delete to authenticated
  using (public.has_perm('canEditPayslips') and public.branch_visible(branch_id));

-- ============================================================
-- ACCOUNTS (chart of accounts) — accounting perms, not branch-scoped
-- ============================================================
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
  using (public.has_perm('canViewAccounting'));
drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all to authenticated
  using (public.has_perm('canEditAccounting'))
  with check (public.has_perm('canEditAccounting'));

-- ============================================================
-- JOURNALS — accounting perms
-- ============================================================
drop policy if exists journals_select on public.journals;
create policy journals_select on public.journals for select to authenticated
  using (public.has_perm('canViewAccounting'));
drop policy if exists journals_write on public.journals;
create policy journals_write on public.journals for all to authenticated
  using (public.has_perm('canEditAccounting'))
  with check (public.has_perm('canEditAccounting'));

-- ============================================================
-- BRANCHES — everyone signed in can read (needed for dropdowns);
-- only admins (canManageBranches) can modify.
-- ============================================================
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (true);
drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches for all to authenticated
  using (public.has_perm('canManageBranches'))
  with check (public.has_perm('canManageBranches'));

-- ============================================================
-- REMINDER LOGS — tied to reports/fees visibility
-- ============================================================
drop policy if exists reminder_select on public.reminder_logs;
create policy reminder_select on public.reminder_logs for select to authenticated
  using (public.has_perm('canViewReports') or public.has_perm('canViewFees'));
drop policy if exists reminder_write on public.reminder_logs;
create policy reminder_write on public.reminder_logs for all to authenticated
  using (public.has_perm('canEditFees'))
  with check (public.has_perm('canEditFees'));

-- ============================================================
-- CUSTOM ROLES — admin only
-- ============================================================
drop policy if exists customroles_select on public.custom_roles;
create policy customroles_select on public.custom_roles for select to authenticated
  using (true);  -- UserContext needs to read these to resolve perms
drop policy if exists customroles_write on public.custom_roles;
create policy customroles_write on public.custom_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- USERS  (profile rows)
--  - a user can always read their OWN row (UserContext needs it)
--  - admins (canManageUsers) can read/write everyone
--  - nobody can change their own role/branch to escalate (guarded
--    by a trigger below, since column-level checks in RLS are clumsy)
-- ============================================================
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users for select to authenticated
  using (id = auth.uid() or public.has_perm('canManageUsers'));
drop policy if exists users_insert_admin on public.users;
create policy users_insert_admin on public.users for insert to authenticated
  with check (public.has_perm('canManageUsers'));
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or public.has_perm('canManageUsers'))
  with check (id = auth.uid() or public.has_perm('canManageUsers'));
drop policy if exists users_delete_admin on public.users;
create policy users_delete_admin on public.users for delete to authenticated
  using (public.has_perm('canManageUsers'));

-- Prevent privilege escalation: a non-admin editing their own row
-- cannot change their role or branch_id.
create or replace function public.guard_user_self_update()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() = new.id and not public.is_admin() then
    if new.role is distinct from old.role
       or new.branch_id is distinct from old.branch_id then
      raise exception 'Not allowed to change your own role or branch';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_users_guard on public.users;
create trigger trg_users_guard before update on public.users
  for each row execute function public.guard_user_self_update();

-- ============================================================
-- AUDIT LOG
--  - any authenticated user may INSERT (append-only logging)
--  - only admins may READ
--  - nobody may UPDATE or DELETE (immutable trail)
-- ============================================================
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (true);
drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log for select to authenticated
  using (public.is_admin());
-- no update/delete policies => those operations are denied for all.

-- ============================================================
-- Done. Every table now enforces role + branch in Postgres.
-- The app's client-side checks become a UX convenience; the
-- database is the real boundary.
-- ============================================================
