-- ============================================================
-- Back-post double-entry journals for existing data.
--
-- The app now books these automatically (see src/utils/autoJournals.js):
--   paid expense      DR expense account        CR bank/cash account
--   salary paid       DR "Salaries" expense     CR bank/cash account
--   fee collected     DR bank/cash account      CR fee income account
--                     (one entry per invoice head, payment split pro rata)
-- Entries are tagged extra.source = 'expense' | 'payment' and extra.sourceId,
-- which is how reports skip them (they mirror rows already counted).
--
-- Safe to re-run: a source that already has a journal (even a trashed one) is
-- skipped, so this also fills gaps (e.g. a user without accounting permission
-- recorded a payment). Never guesses an account: rows whose accounts can't be
-- matched are left out.
-- ============================================================

-- 1. Paid expenses whose category is linked to an Expenses account.
insert into public.journals (date, reference, description, debit_account, credit_account, amount, notes, extra)
select e.date, 'EXP-' || left(e.id::text, 8), coalesce(nullif(e.description, ''), 'Expense'),
       d.name, c.name, e.amount, 'Auto-posted from Expenses',
       jsonb_build_object('branchId', coalesce(e.branch_id, ''), 'source', 'expense', 'sourceId', e.id::text)
from public.expenses e
join public.accounts d on d.id::text = e.extra->>'accountId' and d.deleted_at is null and d.type = 'Expenses'
join public.accounts c on c.id::text = e.extra->>'paidAccountId' and c.deleted_at is null
where e.deleted_at is null and e.amount > 0
  and not exists (select 1 from public.journals j
                  where j.extra->>'source' = 'expense' and j.extra->>'sourceId' = e.id::text);

-- 2. Paid salaries (payslip payments): DR Salaries, CR the account paid from.
insert into public.journals (date, reference, description, debit_account, credit_account, amount, notes, extra)
select p.date, 'SAL-' || left(p.id::text, 8), p.description, s.name, p.account, p.amount,
       'Auto-posted from Payslips',
       jsonb_build_object('branchId', coalesce(p.branch_id, ''), 'source', 'payment', 'sourceId', p.id::text)
from public.payments p
cross join lateral (
  select name from public.accounts
  where deleted_at is null and type = 'Expenses' and lower(trim(name)) = 'salaries' limit 1
) s
where p.deleted_at is null and p.source = 'payslip' and p.type = 'cash_out'
  and not coalesce(p.reversed, false) and p.reversal_of is null and p.amount > 0
  and not exists (select 1 from public.journals j
                  where j.extra->>'source' = 'payment' and j.extra->>'sourceId' = p.id::text);

-- 3. Fee collections (invoice payments): DR bank/cash, CR fee income by head.
--    Head -> income account: same name (ignoring case and a trailing "xN"),
--    else the generic "Fees" income account.
insert into public.journals (date, reference, description, debit_account, credit_account, amount, notes, extra)
with pay as (
  select p.id, p.date, p.description, p.account, p.branch_id, p.amount, i.extra->'lineItems' as li
  from public.payments p
  left join public.invoices i on i.id::text = p.source_id
  where p.deleted_at is null and p.source = 'invoice' and p.type = 'cash_in'
    and not coalesce(p.reversed, false) and p.reversal_of is null and p.amount > 0
    and not exists (select 1 from public.journals j
                    where j.extra->>'source' = 'payment' and j.extra->>'sourceId' = p.id::text)
),
items as (
  select pay.id as pid, k.ord,
         coalesce(nullif(trim(k.item->>'customDescription'), ''), nullif(trim(k.item->>'description'), ''), 'Tuition Fee') as head,
         (k.item->>'amount')::numeric as w
  from pay
  cross join lateral jsonb_array_elements(case when jsonb_typeof(pay.li) = 'array' then pay.li else '[]'::jsonb end)
       with ordinality as k(item, ord)
  where coalesce(k.item->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' and (k.item->>'amount')::numeric > 0
),
no_items as (  -- invoices with no usable line items: one "Tuition Fee" part
  select pay.id as pid, 1::bigint as ord, 'Tuition Fee' as head, 1::numeric as w
  from pay where not exists (select 1 from items where items.pid = pay.id)
),
cum as (  -- running share of the payment up to and including each head
  select u.pid, u.ord, u.head,
         round(pay.amount * sum(u.w) over (partition by u.pid order by u.ord) / sum(u.w) over (partition by u.pid), 2) as cum_amt
  from (select * from items union all select * from no_items) u
  join pay on pay.id = u.pid
),
parts as (  -- each head's part = its running share minus the previous one
  select pid, ord, head,
         cum_amt - coalesce(lag(cum_amt) over (partition by pid order by ord), 0) as part
  from cum
),
acct as (select name, lower(regexp_replace(trim(name), '\s+', ' ', 'g')) as key from public.accounts
         where deleted_at is null and type = 'Income')
select pay.date, 'FEE-' || left(pay.id::text, 8), pay.description, pay.account,
       coalesce(own.name, fb.name), parts.part, 'Auto-posted from Fees',
       jsonb_build_object('branchId', coalesce(pay.branch_id, ''), 'source', 'payment', 'sourceId', pay.id::text)
from parts
join pay on pay.id = parts.pid
left join acct own on own.key = regexp_replace(lower(regexp_replace(trim(parts.head), '\s+', ' ', 'g')), '\s*x\d+$', '')
left join acct fb on fb.key = 'fees'
where parts.part > 0 and coalesce(own.name, fb.name) is not null;
