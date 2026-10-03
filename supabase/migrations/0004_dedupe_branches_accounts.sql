-- ============================================================
-- 0004  Collapse duplicate branches and accounts (soft, reversible)
-- ------------------------------------------------------------
-- Audit: DB-7, DB-8 (replaces supabase/legacy/fix_duplicate_*.sql).
-- Depends on : 0001; trash.sql
-- Idempotent : yes. A second run finds no duplicates and changes nothing.
-- Data change: YES, but conservative:
--   * nothing is hard-deleted. Duplicates get deleted_at = now() (Trash).
--   * only LIVE rows are considered, matched case-insensitively and
--     ignoring surrounding spaces ("Baneen " = "baneen").
--   * keeper = oldest live row (created_at, then id). Rows that pointed at a
--     duplicate branch are repointed to the keeper, including users.branch_id
--     (the old script forgot users).
--   * duplicate ACCOUNTS are merged only when their opening balances agree.
--     Groups with different balances are SKIPPED and listed in the log for a
--     human decision (the keeper's balance would otherwise silently win).
--   * every value that is changed is copied to public.migration_backup first.
-- App impact : duplicate branch/account rows disappear from lists (they are
--              in Trash). Payments keep pointing at the same account NAME.
-- Rollback   : see "Rollback 0004" in migrations/README.md (restores
--              branch_id / account names / deleted_at from migration_backup).
-- Review first: run the preview queries in README (section 0004) before
--              applying this on production.
-- ============================================================
begin;
select public._mig_log('0004', '_start', 'info');

do $$
declare
  t text;
  n bigint;
  total_rows bigint := 0;
  grp record;
begin
  -- ---------- branches ----------
  create temp table _branch_map on commit drop as
  select b.id::text as dup_id, k.keeper_id::text as keeper_id, b.name as dup_name
  from public.branches b
  join (
    select distinct on (lower(btrim(name))) lower(btrim(name)) as nk, id as keeper_id
    from public.branches
    where deleted_at is null and name is not null
    order by lower(btrim(name)), created_at, id
  ) k on k.nk = lower(btrim(b.name))
  where b.deleted_at is null and b.id <> k.keeper_id;

  select count(*) into n from _branch_map;
  if n = 0 then
    perform public._mig_log('0004', 'branches', 'ok', 'no duplicate live branches');
  else
    foreach t in array array['students','employees','invoices','expenses','payments','payslips','users'] loop
      execute format($f$
        with c as (
          select x.id::text as rid, x.branch_id as old
          from public.%1$I x join _branch_map m on x.branch_id = m.dup_id),
        b as (
          insert into public.migration_backup (migration, table_name, row_id, column_name, old_value)
          select '0004', %1$L, rid, 'branch_id', old from c returning 1)
        update public.%1$I x set branch_id = m.keeper_id
        from _branch_map m where x.branch_id = m.dup_id$f$, t);
      get diagnostics n = row_count;
      total_rows := total_rows + n;
      perform public._mig_log('0004', 'branches_repoint_' || t, 'ok', n || ' rows repointed');
    end loop;

    insert into public.migration_backup (migration, table_name, row_id, column_name, old_value)
      select '0004', 'branches', dup_id, 'deleted_at', null from _branch_map;
    update public.branches b set deleted_at = now() from _branch_map m where b.id::text = m.dup_id;
    get diagnostics n = row_count;
    perform public._mig_log('0004', 'branches_soft_deleted', 'ok', n || ' duplicate branches moved to Trash; ' || total_rows || ' child rows repointed');
  end if;

  -- ---------- accounts ----------
  -- payments reference accounts by NAME, so the unit of duplication is the
  -- normalised name. Merge only groups whose opening balances agree.
  create temp table _acct_groups on commit drop as
  select lower(btrim(name)) as nk,
         count(*) as cnt,
         count(distinct coalesce(balance,0)) as balances
  from public.accounts
  where deleted_at is null and name is not null
  group by 1 having count(*) > 1;

  for grp in select * from _acct_groups where balances > 1 loop
    perform public._mig_log('0004', 'accounts_manual_review', 'skipped',
      'live accounts named "' || grp.nk || '" have different opening balances; merge by hand (see README)');
  end loop;

  create temp table _acct_map on commit drop as
  select a.id, a.name as dup_name, k.keeper_name
  from public.accounts a
  join _acct_groups g on g.nk = lower(btrim(a.name)) and g.balances = 1
  join (
    select distinct on (lower(btrim(name))) lower(btrim(name)) as nk, id as keeper_id, name as keeper_name
    from public.accounts
    where deleted_at is null and name is not null
    order by lower(btrim(name)), created_at, id
  ) k on k.nk = lower(btrim(a.name))
  where a.deleted_at is null and a.id <> k.keeper_id;

  select count(*) into n from _acct_map;
  if n = 0 then
    perform public._mig_log('0004', 'accounts', 'ok', 'no mergeable duplicate live accounts');
  else
    -- repoint text references that differ only by case/spacing from the keeper's name
    foreach t in array array['payments:account','invoices:paid_account','payslips:paid_account','expenses:paid_account'] loop
      execute format($f$
        with c as (
          select x.id::text as rid, x.%2$I as old
          from public.%1$I x join _acct_map m on x.%2$I = m.dup_name and x.%2$I <> m.keeper_name),
        b as (
          insert into public.migration_backup (migration, table_name, row_id, column_name, old_value)
          select '0004', %1$L, rid, %2$L, old from c returning 1)
        update public.%1$I x set %2$I = m.keeper_name
        from _acct_map m where x.%2$I = m.dup_name and x.%2$I <> m.keeper_name$f$,
        split_part(t, ':', 1), split_part(t, ':', 2));
      get diagnostics n = row_count;
      perform public._mig_log('0004', 'accounts_repoint_' || replace(t, ':', '_'), 'ok', n || ' rows renamed to the keeper account name');
    end loop;

    insert into public.migration_backup (migration, table_name, row_id, column_name, old_value)
      select '0004', 'accounts', id::text, 'deleted_at', null from _acct_map;
    update public.accounts a set deleted_at = now() from _acct_map m where a.id = m.id;
    get diagnostics n = row_count;
    perform public._mig_log('0004', 'accounts_soft_deleted', 'ok', n || ' duplicate accounts moved to Trash');
  end if;

  -- Same CODE on accounts with different names cannot be merged automatically.
  for grp in
    select lower(btrim(code)) as code, count(*) as cnt
    from public.accounts
    where deleted_at is null and coalesce(btrim(code),'') <> ''
    group by 1 having count(*) > 1
  loop
    perform public._mig_log('0004', 'accounts_code_manual_review', 'skipped',
      'account code "' || grp.code || '" is used by ' || grp.cnt || ' live accounts; re-code or merge by hand');
  end loop;
end $$;

select public._mig_log('0004', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0004'
  and at >= (select max(at) from public.migration_log where migration = '0004' and step = '_start')
order by id;
