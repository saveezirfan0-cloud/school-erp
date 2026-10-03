-- ============================================================
-- 0002  RLS helper functions (once-per-statement, per-user overrides)
-- ------------------------------------------------------------
-- Audit: DB-6 (per-row helper cost), DB-25 (anon can call helpers,
--        current_role name), SEC-06/DB-26 (overrides not enforced),
--        SEC-07/UX-016 (canManageUsers == admin).
-- Depends on : 0001
-- Idempotent : yes (create or replace)
-- Data change: none
-- App impact : BEHAVIOUR CHANGE for users that have per-user overrides
--              (users.extra->'pagePermissions'): the database now honours
--              them, grants AND revocations, exactly as the UI does.
--              `canManageUsers` is now ADMIN-ONLY in the database whatever a
--              custom role or override says (see below).
-- Rollback   : re-run the function bodies from supabase/security.sql
--              (that file refuses to run once 0001 exists; set
--              app.allow_baseline_rerun = 'on' first, then re-run 0002+).
--
-- What changed vs security.sql
--  * has_perm() reads the user row ONCE (role + overrides), then the
--    custom role once, instead of 3-5 lookups.
--  * Per-user overrides from users.extra->'pagePermissions' win over the
--    role: {"canViewStudents": false} revokes, {"canEditFees": true} grants.
--    Admin is always full access. Only admins can write users.extra (0007).
--  * `canManageUsers` is a RESERVED permission: only role 'admin' has it.
--    Custom roles and overrides cannot grant it (the flag is ignored here
--    and stripped from custom_roles.permissions by a trigger in 0007).
--    Reason: whoever holds it can read every profile; promoting users is
--    admin-only anyway, so a "manager of users" that is not admin has no
--    safe meaning in this schema.
--  * New helpers sees_all_branches() and my_branch_key() are row-independent
--    so policies can call them as (select ...) and Postgres evaluates them
--    once per statement (InitPlan) instead of once per row.
--  * Every helper is revoked from PUBLIC and anon (Supabase's default
--    privileges would otherwise let anon call /rpc/has_perm etc.).
-- ============================================================
begin;
select public._mig_log('0002', '_start', 'info');

-- Built-in permission matrix (mirror of UserContext PERMISSIONS; unchanged
-- from security.sql). IMMUTABLE so Postgres can fold it.
create or replace function public.builtin_role_perms(r text)
returns jsonb language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case r
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
  end
$$;

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.role from public.users u where u.id = auth.uid()), 'none')
$$;

-- Kept for backward compatibility with security.sql and any caller.
-- NOTE: CURRENT_ROLE is also an SQL keyword, so always call it schema-qualified.
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public.app_role()
$$;

create or replace function public.current_branch()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select (select u.branch_id from public.users u where u.id = auth.uid())
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.app_role() = 'admin'
$$;

-- Normalised branch key of the current user: NULL / 'main' / '' => '' (the
-- main office), otherwise the branch id text. Compare it with
-- coalesce(nullif(branch_id,'main'),'') on the row side (that expression is
-- what the 0003 indexes are built on).
create or replace function public.my_branch_key()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif((select u.branch_id from public.users u where u.id = auth.uid()), 'main'), '')
$$;

create or replace function public.has_perm(perm text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r  text;
  ov jsonb;
  cp jsonb;
begin
  if auth.uid() is null then return false; end if;

  select u.role, u.extra -> 'pagePermissions' into r, ov
    from public.users u where u.id = auth.uid();

  if r is null or r = 'none' then return false; end if;
  if r = 'admin' then return true; end if;                       -- admin: everything

  -- Reserved: user administration is admin-only, never grantable.
  if perm = 'canManageUsers' then return false; end if;

  -- Per-user override (written by admins in Access Overview) beats the role.
  if jsonb_typeof(ov) = 'object' and ov ? perm then
    return coalesce((ov -> perm) = 'true'::jsonb, false);
  end if;

  if r in ('branch_manager','accountant','fee_collector') then
    return coalesce((public.builtin_role_perms(r) -> perm) = 'true'::jsonb, false);
  end if;

  select c.permissions into cp from public.custom_roles c where c.id = r;
  return coalesce(jsonb_typeof(cp) = 'object' and (cp -> perm) = 'true'::jsonb, false);
end $$;

-- Admins and roles holding canViewAllBranches see every branch.
create or replace function public.sees_all_branches()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or public.has_perm('canViewAllBranches')
$$;

-- Row-level check (kept for use inside functions / triggers; policies use
-- the (select sees_all_branches()) / my_branch_key() form instead).
create or replace function public.branch_visible(row_branch text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.sees_all_branches()
      or coalesce(nullif(row_branch, 'main'), '') = public.my_branch_key()
$$;

-- Lock the helpers down: signed-in users only (anon had EXECUTE via PUBLIC).
do $$
declare f text;
begin
  foreach f in array array[
    'public.builtin_role_perms(text)', 'public.app_role()', 'public.current_role()',
    'public.current_branch()', 'public.is_admin()', 'public.my_branch_key()',
    'public.has_perm(text)', 'public.sees_all_branches()', 'public.branch_visible(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select public._mig_log('0002', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0002'
  and at >= (select max(at) from public.migration_log where migration = '0002' and step = '_start')
order by id;
