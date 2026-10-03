-- ============================================================
-- 0006  Referential integrity for the text reference columns (trigger-based "FKs")
-- ------------------------------------------------------------
-- Audit: DB-2 (phase 1: no app change, no column type change).
-- Depends on : 0001, 0003
-- Idempotent : yes (create or replace function; drop trigger if exists + create)
-- Data change: none. Existing rows are never scanned or rejected: a reference
--              is checked only when it is INSERTed or when the referencing
--              column itself CHANGES. Orphans that already exist stay as they
--              are (find them with the queries in migrations/README.md).
-- App impact : writing a row that points at a student / employee / branch /
--              account that does not exist now fails with SQLSTATE 23503
--              ("foreign_key_violation"). Permanently deleting ("Delete
--              forever" / "Empty trash") a student, employee, branch, account,
--              invoice, payslip or expense that is still referenced now fails
--              with 23503 instead of leaving orphans.
-- Rollback   : drop trigger trg_ref_* / trg_restrict_* (list in README), and
--              drop function public.trg_check_ref(), public.trg_restrict_delete().
--
-- Why triggers and not real FOREIGN KEYs: the columns are TEXT holding uuids
-- (or '' / 'main' for the main office, or an account NAME), so real FKs need
-- the phase-2 column conversion that also changes the app (DB-2). These
-- triggers give the same insert-time check and ON DELETE RESTRICT today.
-- ============================================================
begin;
select public._mig_log('0006', '_start', 'info');

-- BEFORE INSERT OR UPDATE: the referenced row must exist.
--   tg_argv: 0 = referencing column, 1 = target table, 2 = target column,
--            3 = mode: 'any' (any row, trashed or not)
--                      'branch' ('' / 'main' / NULL are allowed: the main office)
--                      'live'  (target must not be in Trash)
create or replace function public.trg_check_ref() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v  text := to_jsonb(new) ->> tg_argv[0];
  ok boolean;
begin
  if v is null or v = '' then return new; end if;
  if tg_argv[3] = 'branch' and v = 'main' then return new; end if;
  if tg_op = 'UPDATE' and v is not distinct from (to_jsonb(old) ->> tg_argv[0]) then
    return new;                                   -- unchanged: legacy orphans stay editable
  end if;
  execute format('select exists (select 1 from public.%I where %I::text = $1 %s)',
                 tg_argv[1], tg_argv[2],
                 case when tg_argv[3] = 'live' then 'and deleted_at is null' else '' end)
    into ok using v;
  if not ok then
    raise exception '% "%" does not exist in %', tg_argv[0], v, tg_argv[1]
      using errcode = '23503', hint = 'create the referenced record first';
  end if;
  return new;
end $$;

-- BEFORE DELETE: refuse to hard-delete a row that is still referenced.
--   tg_argv: 0 = referencing table, 1 = referencing column, 2 = my column,
--            3 = optional extra filter on the referencing table (constant SQL written below)
create or replace function public.trg_restrict_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v  text := to_jsonb(old) ->> tg_argv[2];
  ok boolean;
begin
  if v is null or v = '' then return old; end if;
  execute format('select exists (select 1 from public.%I where %I::text = $1 %s)',
                 tg_argv[0], tg_argv[1],
                 case when coalesce(tg_argv[3], '') <> '' then 'and ' || tg_argv[3] else '' end)
    into ok using v;
  if ok then
    raise exception 'cannot delete % % : still referenced by %.%', tg_table_name, v, tg_argv[0], tg_argv[1]
      using errcode = '23503',
            hint = 'move it to Trash instead, or remove/repoint the referencing rows first';
  end if;
  return old;
end $$;

revoke all on function public.trg_check_ref(), public.trg_restrict_delete() from public, anon, authenticated;

-- ---------- insert/update checks ----------
do $$
declare r record;
begin
  for r in select * from (values
    ('invoices',  'student_id', 'students',  'id',   'any'),
    ('payslips',  'employee_id','employees', 'id',   'any'),
    ('payments',  'account',    'accounts',  'name', 'live'),
    ('students',  'branch_id',  'branches',  'id',   'branch'),
    ('employees', 'branch_id',  'branches',  'id',   'branch'),
    ('invoices',  'branch_id',  'branches',  'id',   'branch'),
    ('expenses',  'branch_id',  'branches',  'id',   'branch'),
    ('payments',  'branch_id',  'branches',  'id',   'branch'),
    ('payslips',  'branch_id',  'branches',  'id',   'branch'),
    ('users',     'branch_id',  'branches',  'id',   'branch'),
    ('reminder_logs','branch_id','branches', 'id',   'branch')
  ) as v(tbl, col, target, tcol, mode)
  loop
    execute format('drop trigger if exists trg_ref_%1$s_%2$s on public.%1$I', r.tbl, r.col);
    execute format(
      'create trigger trg_ref_%1$s_%2$s before insert or update of %2$I on public.%1$I
         for each row execute function public.trg_check_ref(%2$L, %3$L, %4$L, %5$L)',
      r.tbl, r.col, r.target, r.tcol, r.mode);
  end loop;
end $$;

-- ---------- delete restrictions ----------
do $$
declare r record;
begin
  for r in select * from (values
    ('students',  'invoices',  'student_id',  'id',   ''),
    ('employees', 'payslips',  'employee_id', 'id',   ''),
    ('invoices',  'payments',  'source_id',   'id',   $f$source = 'invoice'$f$),
    ('payslips',  'payments',  'source_id',   'id',   $f$source = 'payslip'$f$),
    ('expenses',  'payments',  'source_id',   'id',   $f$source = 'expense'$f$),
    ('accounts',  'payments',  'account',     'name', ''),
    ('accounts',  'journals',  'debit_account',  'name', ''),
    ('accounts',  'journals',  'credit_account', 'name', ''),
    ('branches',  'students',  'branch_id',   'id',   ''),
    ('branches',  'employees', 'branch_id',   'id',   ''),
    ('branches',  'invoices',  'branch_id',   'id',   ''),
    ('branches',  'expenses',  'branch_id',   'id',   ''),
    ('branches',  'payments',  'branch_id',   'id',   ''),
    ('branches',  'payslips',  'branch_id',   'id',   ''),
    ('branches',  'users',     'branch_id',   'id',   '')
  ) as v(tbl, reftbl, refcol, mycol, extra)
  loop
    execute format('drop trigger if exists trg_restrict_%1$s_%2$s_%3$s on public.%1$I', r.tbl, r.reftbl, r.refcol);
    execute format(
      'create trigger trg_restrict_%1$s_%2$s_%3$s before delete on public.%1$I
         for each row execute function public.trg_restrict_delete(%2$L, %3$L, %4$L, %5$L)',
      r.tbl, r.reftbl, r.refcol, r.mycol, r.extra);
  end loop;
end $$;

select public._mig_log('0006', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0006'
  and at >= (select max(at) from public.migration_log where migration = '0006' and step = '_start')
order by id;
