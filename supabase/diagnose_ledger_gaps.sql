-- ============================================================
-- READ-ONLY diagnostic for the two failing "Books check" blocks:
--   A. Reversals are paired            (payment flagged reversed, no reversing row)
--   B. Invoices marked paid, no ledger (paid invoice with no live Bank & Cash receipt)
-- Changes nothing. Paste into the Supabase SQL Editor of the SCHOOL ERP project
-- and send back the three result grids.
-- ============================================================

-- A. Payments flagged reversed with no live reversing row.
--    If the same source invoice/expense/payslip has other rows, they show how it ended up.
select p.id, p.date, p.account, p.type, p.amount, p.source, p.source_id,
       p.description, p.created_at, p.updated_at,
       (select count(*) from public.payments x
         where x.source = p.source and x.source_id = p.source_id and x.id <> p.id) as sibling_rows,
       (select count(*) from public.payments r where r.reversal_of = p.id::text) as reversing_rows_any_state
from public.payments p
where p.deleted_at is null
  and coalesce(p.reversed, false)
  and not exists (select 1 from public.payments r where r.reversal_of = p.id::text and r.deleted_at is null)
order by p.date;

-- B. Paid invoices with no effective ledger receipt, and what exists for them.
select i.id, i.extra->>'studentName' as student, i.status, i.amount, i.paid_amount,
       i.paid_date, i.paid_account, i.updated_at,
       coalesce(sum(p.amount) filter (where p.deleted_at is null and p.type = 'cash_in'
                 and not coalesce(p.reversed, false) and p.reversal_of is null), 0) as live_ledger,
       count(p.id)                                                   as ledger_rows,
       count(p.id) filter (where coalesce(p.reversed, false))        as reversed_rows,
       count(p.id) filter (where p.deleted_at is not null)           as trashed_rows
from public.invoices i
left join public.payments p on p.source = 'invoice' and p.source_id = i.id::text
where i.deleted_at is null and i.status = 'paid'
group by i.id
having coalesce(sum(p.amount) filter (where p.deleted_at is null and p.type = 'cash_in'
                 and not coalesce(p.reversed, false) and p.reversal_of is null), 0) = 0
order by i.paid_date;

-- C. Do the two lists overlap? (invoice receipts flagged reversed without a reversing row)
select p.id as payment_id, p.source_id as invoice_id, p.amount, p.date
from public.payments p
where p.deleted_at is null and p.source = 'invoice' and coalesce(p.reversed, false)
  and not exists (select 1 from public.payments r where r.reversal_of = p.id::text and r.deleted_at is null);
