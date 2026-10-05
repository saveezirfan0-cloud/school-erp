-- ============================================================
-- Repair: invoices marked paid by hand (bulk status edit, since removed from
-- the app) with no payment row at all and no paid-from account.
-- Sets them back to pending, so no unbacked "paid" claim remains. Receive the
-- money afterwards through Fees -> Mark Paid for each fee that WAS collected:
-- that posts the Bank & Cash entry and journal the proper way.
-- Run AFTER repair_restore_trashed_receipt.sql.
-- SQL Editor (service role). One transaction; re-runnable; backs rows up first.
-- Undo: update public.invoices i set status = b.status, paid_amount = b.paid_amount,
--         paid_date = b.paid_date, paid_account = b.paid_account
--         from public.invoices_unbacked_paid_backup b where b.id = i.id;
-- Zero-amount paid invoices are ignored (the Books check does not flag them).
-- ============================================================
begin;

create table if not exists public.invoices_unbacked_paid_backup as
  select * from public.invoices where false;

insert into public.invoices_unbacked_paid_backup
select i.* from public.invoices i
where i.deleted_at is null and i.status = 'paid' and i.amount > 0 and i.paid_account is null
  and not exists (select 1 from public.payments p where p.source = 'invoice' and p.source_id = i.id::text)
  and not exists (select 1 from public.invoices_unbacked_paid_backup b where b.id = i.id);

update public.invoices i
set status = 'pending', paid_amount = 0, paid_date = null, paid_account = null, updated_at = now()
where i.id in (select id from public.invoices_unbacked_paid_backup)
  and i.status = 'paid'
  and not exists (select 1 from public.payments p where p.source = 'invoice' and p.source_id = i.id::text);

-- Expect: 6 rows, total 39500, all now pending
select i.extra->>'studentName' as student, i.amount, i.status
from public.invoices i
where i.id in (select id from public.invoices_unbacked_paid_backup)
order by 1;

commit;
