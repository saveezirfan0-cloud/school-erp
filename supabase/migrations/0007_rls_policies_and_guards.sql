-- ============================================================
-- 0007  Row-level security policies, user/role guards, delete permissions
-- ------------------------------------------------------------
-- Audit: DB-1/SEC-05, DB-4/ACC-01 (accounts for posting), DB-6, DB-13,
--        DB-15, DB-16, SEC-03/UX-004, SEC-06/07/UX-016/UX-006,
--        SEC-08, SEC-17, SEC-21, ACC-02 (hard delete), DB-26.
-- Depends on : 0001, 0002, 0005 (reminder_logs.branch_id, deleted_by)
-- Idempotent : yes. Re-running rebuilds the same policy set from scratch.
-- Data change: none (policies, triggers, grants only).
-- Atomic     : one transaction. If anything fails nothing changes and the
--              previous policies stay in place.
-- App impact : YES, intended. Read "What changes for each role" below, and
--              migrations/README.md before applying on production.
-- Rollback   : the inventory of every policy that existed before this file
--              ran (name, command, roles, USING, WITH CHECK) is written to
--              migration_log (step 'policy_before_*'). To undo, recreate
--              those, or re-run supabase/security.sql after
--              `set app.allow_baseline_rerun = 'on'`.
--
-- THE FINAL POLICY SET IS EXACTLY THE ONE BELOW. All pre-existing policies
-- on the 13 app tables are dropped first (and logged), whatever their name,
-- including any "auth all" / hand-made allow-all policy: Postgres ORs
-- permissive policies together, so one leftover open policy would void the
-- rest (audit DB-1).
--
-- What changes for each role
--  * Delete = trash or hard-delete is no longer implied by "edit":
--      - Moving a row to Trash (UPDATE deleted_at) needs the table's delete
--        permission, or admin:
--          students canDeleteStudents      employees canDeleteEmployees
--          expenses canDeleteExpenses      invoices  canDeleteFees
--          payslips canDeletePayslips      payments  canDeletePayments
--          journals canDeleteJournals      accounts  canEditAccounting
--          branches canManageBranches      reminder_logs canEditFees
--        (The canDelete* flags for fees/payslips/payments/journals are NEW
--        names: no built-in role has them, only admin, or a custom role /
--        override that sets them to true.)
--      - Permanent DELETE only works on rows ALREADY in Trash. For invoices,
--        payments, payslips, journals, accounts and reminder_logs it is
--        admin-only; for students/employees/expenses it needs the delete
--        permission; for branches canManageBranches.
--  * accounts: the Bank & Cash accounts (the ones fees/salaries/expenses are
--    posted into) are readable by roles that can post (canEditFees,
--    canEditPayslips, canEditExpenses or canEditPayments). Everything else on
--    accounts and journals needs canViewAccounting / canEditAccounting AND
--    canViewAllBranches (they have no branch column; SEC-17).
--    The `balance` column (opening balance) of those cash accounts is
--    visible to posting roles: RLS cannot hide a column. If that is not
--    acceptable, drop policy accounts_select_pay and use list_pay_accounts()
--    (0009), which returns only id/code/name.
--  * branches / custom_roles are no longer readable by profile-less or
--    role 'none' accounts; custom_roles only shows a user their own role
--    (admins see all).
--  * users: only admins can insert/delete users, change roles / branches /
--    permission overrides (users.extra) or read other users' rows. Every
--    other user can read their own row and change ONLY their own name. The
--    last admin cannot be demoted or deleted through the API.
--  * canManageUsers is admin-only (see 0002).
--  * audit_log is append-only for everybody (0008 stamps the author).
--  * reminder_logs are scoped to the student's branch.
-- ============================================================
begin;
select public._mig_log('0007', '_start', 'info');

-- ------------------------------------------------------------
-- 0. Inventory and drop every existing policy on the app tables
-- ------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users','branches','students','employees','invoices','expenses','payments',
                        'payslips','accounts','journals','custom_roles','reminder_logs','audit_log')
  loop
    perform public._mig_log('0007', 'policy_before_' || p.tablename || '.' || p.policyname, 'info',
      format('cmd=%s roles=%s using=%s with_check=%s', p.cmd, p.roles, coalesce(p.qual,'-'), coalesce(p.with_check,'-')));
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.users         enable row level security;
alter table public.branches      enable row level security;
alter table public.students      enable row level security;
alter table public.employees     enable row level security;
alter table public.invoices      enable row level security;
alter table public.expenses      enable row level security;
alter table public.payments      enable row level security;
alter table public.payslips      enable row level security;
alter table public.accounts      enable row level security;
alter table public.journals      enable row level security;
alter table public.custom_roles  enable row level security;
alter table public.reminder_logs enable row level security;
alter table public.audit_log     enable row level security;

-- ------------------------------------------------------------
-- 1. Branch-scoped tables: students, employees, invoices, expenses,
--    payments, payslips, reminder_logs
--    Every helper is wrapped in (select ...) so it runs once per statement.
-- ------------------------------------------------------------
do $$
declare
  r record;
  scope constant text :=
    $s$((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))$s$;
  del_using text;
begin
  for r in select * from (values
      -- table,          view perm,          edit perm,           hard-delete perm ('' = admin only)
      ('students',      'canViewStudents',  'canEditStudents',   'canDeleteStudents'),
      ('employees',     'canViewEmployees', 'canEditEmployees',  'canDeleteEmployees'),
      ('expenses',      'canViewExpenses',  'canEditExpenses',   'canDeleteExpenses'),
      ('invoices',      'canViewFees',      'canEditFees',       ''),
      ('payments',      'canViewPayments',  'canEditPayments',   ''),
      ('payslips',      'canViewPayslips',  'canEditPayslips',   ''),
      ('reminder_logs', 'canViewFees',      'canEditFees',       '')
    ) as v(t, pv, pe, pd)
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select public.has_perm(%2$L)) and %3$s)',
                   r.t, r.pv, scope);
    -- reminder_logs: reports viewers can read too (as before)
    if r.t = 'reminder_logs' then
      execute 'drop policy reminder_logs_select on public.reminder_logs';
      execute format('create policy reminder_logs_select on public.reminder_logs for select to authenticated using (((select public.has_perm(%L)) or (select public.has_perm(%L))) and %s)',
                     'canViewReports', 'canViewFees', scope);
    end if;

    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select public.has_perm(%2$L)) and %3$s)',
                   r.t, r.pe, scope);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select public.has_perm(%2$L)) and %3$s) with check ((select public.has_perm(%2$L)) and %3$s)',
                   r.t, r.pe, scope);

    if r.pd = '' then
      del_using := '(select public.is_admin()) and deleted_at is not null';
    else
      del_using := format('(select public.has_perm(%L)) and %s and deleted_at is not null', r.pd, scope);
    end if;
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (%2$s)', r.t, del_using);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. accounts and journals (no branch column: require all-branch visibility, SEC-17)
-- ------------------------------------------------------------
create policy accounts_select on public.accounts for select to authenticated
  using ((select public.has_perm('canViewAccounting')) and (select public.sees_all_branches()));

-- DB-4 / ACC-01: roles that post fees, salaries and expenses must be able to
-- see the cash/bank accounts they post into, and nothing else of the chart.
create policy accounts_select_pay on public.accounts for select to authenticated
  using (
    deleted_at is null
    and (sub_type = 'Bank & Cash' or type = 'Assets')
    and ((select public.has_perm('canEditFees'))
      or (select public.has_perm('canEditPayslips'))
      or (select public.has_perm('canEditExpenses'))
      or (select public.has_perm('canEditPayments')))
  );

create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()));
create policy accounts_update on public.accounts for update to authenticated
  using ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()))
  with check ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()));
create policy accounts_delete on public.accounts for delete to authenticated
  using ((select public.is_admin()) and deleted_at is not null);

create policy journals_select on public.journals for select to authenticated
  using ((select public.has_perm('canViewAccounting')) and (select public.sees_all_branches()));
create policy journals_insert on public.journals for insert to authenticated
  with check ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()));
create policy journals_update on public.journals for update to authenticated
  using ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()))
  with check ((select public.has_perm('canEditAccounting')) and (select public.sees_all_branches()));
create policy journals_delete on public.journals for delete to authenticated
  using ((select public.is_admin()) and deleted_at is not null);

-- ------------------------------------------------------------
-- 3. branches, custom_roles (SEC-21)
-- ------------------------------------------------------------
create policy branches_select on public.branches for select to authenticated
  using ((select public.app_role()) <> 'none');
create policy branches_insert on public.branches for insert to authenticated
  with check ((select public.has_perm('canManageBranches')));
create policy branches_update on public.branches for update to authenticated
  using ((select public.has_perm('canManageBranches')))
  with check ((select public.has_perm('canManageBranches')));
create policy branches_delete on public.branches for delete to authenticated
  using ((select public.has_perm('canManageBranches')) and deleted_at is not null);

create policy custom_roles_select on public.custom_roles for select to authenticated
  using ((select public.is_admin()) or id = (select public.app_role()));
create policy custom_roles_insert on public.custom_roles for insert to authenticated
  with check ((select public.is_admin()));
create policy custom_roles_update on public.custom_roles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy custom_roles_delete on public.custom_roles for delete to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------
-- 4. users (SEC-06, SEC-07, UX-006, DB-15, DB-26)
-- ------------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy users_insert on public.users for insert to authenticated
  with check ((select public.is_admin()));
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));
create policy users_delete on public.users for delete to authenticated
  using ((select public.is_admin()));

-- Column rules RLS cannot express. Compares OLD (never NEW) to auth.uid(), so
-- changing the row id in the same statement cannot slip past it (SEC-07).
-- auth.uid() is NULL for the service role, the SQL editor and migrations:
-- those are trusted and skip the guard (that is how the first admin is set).
create or replace function public.guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'users.id cannot be changed' using errcode = '42501';
  end if;

  if public.is_admin() then return new; end if;     -- admins: any other column

  if old.id is distinct from auth.uid() then
    raise exception 'Only an admin can edit other users' using errcode = '42501';
  end if;

  -- non-admin editing their own row: only `name` (and the updated_at stamp).
  -- Compared as jsonb so EVERY other column is frozen, including any column
  -- added later and including `pin` (which the optional migration
  -- optional/9000_drop_users_pin.sql may remove).
  if (to_jsonb(new) - 'name' - 'updated_at') is distinct from (to_jsonb(old) - 'name' - 'updated_at') then
    raise exception 'You can only change your own name. Role, branch and permissions are set by an admin.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_users_guard on public.users;
create trigger trg_users_guard before update on public.users
  for each row execute function public.guard_user_self_update();

-- UX-006: never leave the school without an admin (API callers only).
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and old.role = 'admin'
     and (tg_op = 'DELETE' or new.role is distinct from 'admin')
     and not exists (select 1 from public.users u where u.role = 'admin' and u.id <> old.id) then
    raise exception 'Cannot demote or remove the last admin' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_users_last_admin on public.users;
create trigger trg_users_last_admin before update of role or delete on public.users
  for each row execute function public.guard_last_admin();

-- DB-15: role must be a built-in role, 'none', or an existing custom role.
create or replace function public.validate_user_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
  if new.role is null then new.role := 'none'; end if;
  if new.role not in ('none','admin','branch_manager','accountant','fee_collector')
     and not exists (select 1 from public.custom_roles c where c.id = new.role) then
    raise exception 'Unknown role "%"', new.role using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_users_role_valid on public.users;
create trigger trg_users_role_valid before insert or update of role on public.users
  for each row execute function public.validate_user_role();

-- ------------------------------------------------------------
-- 5. custom_roles: no canManageUsers, and no deleting a role that is in use
-- ------------------------------------------------------------
create or replace function public.custom_roles_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    -- reserved permission, never grantable through a role (see 0002)
    if jsonb_typeof(new.permissions) = 'object' then
      new.permissions := new.permissions - 'canManageUsers';
    end if;
  end if;
  if (tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.id is distinct from old.id))
     and exists (select 1 from public.users u where u.role = old.id) then
    raise exception 'Role "%" is assigned to users; reassign them first', old.id using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_custom_roles_guard on public.custom_roles;
create trigger trg_custom_roles_guard before insert or update or delete on public.custom_roles
  for each row execute function public.custom_roles_guard();

-- ------------------------------------------------------------
-- 6. Moving a row to / from Trash requires the delete permission (SEC-03, DB-13)
-- ------------------------------------------------------------
create or replace function public.guard_soft_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.deleted_at is not distinct from old.deleted_at then return new; end if;
  if auth.uid() is not null and not public.has_perm(tg_argv[0]) then   -- has_perm() is true for admin
    raise exception 'permission denied: % is required to move records to or from Trash', tg_argv[0]
      using errcode = '42501';
  end if;
  new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('students','canDeleteStudents'), ('employees','canDeleteEmployees'),
    ('expenses','canDeleteExpenses'), ('invoices','canDeleteFees'),
    ('payslips','canDeletePayslips'), ('payments','canDeletePayments'),
    ('journals','canDeleteJournals'), ('accounts','canEditAccounting'),
    ('branches','canManageBranches'), ('reminder_logs','canEditFees')
  ) as v(t, perm) loop
    execute format('drop trigger if exists trg_%1$s_soft_delete on public.%1$I', r.t);
    execute format('create trigger trg_%1$s_soft_delete before update of deleted_at on public.%1$I
                      for each row execute function public.guard_soft_delete(%2$L)', r.t, r.perm);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. reminder_logs: always carry the student's branch (SEC-08)
--    (the writer, /api/send-reminders, is not in this repo and does not send it)
-- ------------------------------------------------------------
create or replace function public.reminder_logs_set_branch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.branch_id is null and new.student_id is not null then
    select s.branch_id into new.branch_id from public.students s where s.id::text = new.student_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_reminder_logs_branch on public.reminder_logs;
create trigger trg_reminder_logs_branch before insert on public.reminder_logs
  for each row execute function public.reminder_logs_set_branch();

-- ------------------------------------------------------------
-- 8. audit_log policies (stamping and append-only triggers are in 0008)
-- ------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check ((select public.app_role()) <> 'none');
-- Users can read back the rows THEY wrote (actor_id is stamped by the trigger in
-- 0008). The browser inserts with 'return=representation', which needs a
-- SELECT policy to pass: without this every non-admin audit insert is
-- refused with an RLS error.
create policy audit_log_select_own on public.audit_log for select to authenticated
  using (actor_id = (select auth.uid()));
-- no UPDATE / DELETE policies: denied for every API caller

-- ------------------------------------------------------------
-- 9. Privileges: defence in depth on top of RLS
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke update, delete, truncate on public.audit_log from authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- ------------------------------------------------------------
-- 10. Final assertion: no open policy may exist on an app table
-- ------------------------------------------------------------
do $$
declare bad int;
begin
  select count(*) into bad from pg_policies
   where schemaname = 'public'
     and tablename in ('users','branches','students','employees','invoices','expenses','payments',
                       'payslips','accounts','journals','custom_roles','reminder_logs','audit_log')
     and (policyname = 'auth all' or qual = 'true' or with_check = 'true');
  if bad > 0 then
    raise exception 'open policy still present (% found); aborting', bad;
  end if;
end $$;

select public._mig_log('0007', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0007'
  and at >= (select max(at) from public.migration_log where migration = '0007' and step = '_start')
order by id;
