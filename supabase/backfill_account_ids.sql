-- ============================================================
-- Backfill chart-of-accounts links on existing rows.
--
-- New payments/expenses store the chart-of-accounts id in the
-- `extra` jsonb column (extra->>'accountId'). Rows created before
-- that only have the account/category NAME. This links them by
-- exact name match so balances survive renames. Safe to re-run;
-- it only touches rows that have no accountId yet, and rows whose
-- name matches exactly one live account.
-- ============================================================

-- payments: account name -> bank/cash account id
update public.payments p
set extra = coalesce(p.extra, '{}'::jsonb) || jsonb_build_object('accountId', a.id::text)
from (
  select name, min(id::text) as id
  from public.accounts
  where deleted_at is null
  group by name
  having count(*) = 1
) a
where p.deleted_at is null
  and p.account = a.name
  and coalesce(p.extra->>'accountId', '') = '';

-- expenses: category name -> "Expenses" account id (case/spacing-insensitive;
-- only accounts of type Expenses, so e.g. an Income account called "Welfare"
-- is never linked as an expense category)
update public.expenses e
set extra = coalesce(e.extra, '{}'::jsonb) || jsonb_build_object('accountId', a.id::text)
from (
  select lower(trim(name)) as name, min(id::text) as id
  from public.accounts
  where deleted_at is null and type = 'Expenses'
  group by lower(trim(name))
  having count(*) = 1
) a
where e.deleted_at is null
  and lower(trim(e.category)) = a.name
  and coalesce(e.extra->>'accountId', '') = '';

-- expenses: paid-from account name -> account id
update public.expenses e
set extra = coalesce(e.extra, '{}'::jsonb) || jsonb_build_object('paidAccountId', a.id::text)
from (
  select name, min(id::text) as id
  from public.accounts
  where deleted_at is null
  group by name
  having count(*) = 1
) a
where e.deleted_at is null
  and e.paid_account = a.name
  and coalesce(e.extra->>'paidAccountId', '') = '';
