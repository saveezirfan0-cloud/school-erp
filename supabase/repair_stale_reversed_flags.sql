-- ============================================================
-- Repair: invoice receipts flagged `reversed` but with no reversing row.
--
-- Cause: an older reversePayment() set reversed = true and then failed (or
-- was interrupted) before the offsetting row was written. The invoice stayed
-- paid, so the receipt is still real money: this clears the stale flag, the
-- same fix the app applies to "legacy half-finished reversals" on restore
-- (repostReversedPayments in src/utils/accounting.js).
--
-- Run in the Supabase SQL Editor (service role: the ledger guard in 0011 does
-- not apply there). One transaction; re-runnable (backs up each row once).
-- Undo: update public.payments p set reversed = true
--         from public.payments_reversed_fix_backup b where b.id = p.id;
-- Scope: source = 'invoice' only. Expense / payslip rows are left alone.
-- ============================================================
begin;

create table if not exists public.payments_reversed_fix_backup as
  select * from public.payments where false;

insert into public.payments_reversed_fix_backup
select p.* from public.payments p
where p.deleted_at is null and p.source = 'invoice' and coalesce(p.reversed, false)
  and not exists (select 1 from public.payments r where r.reversal_of = p.id::text and r.deleted_at is null)
  and not exists (select 1 from public.payments_reversed_fix_backup b where b.id = p.id);

update public.payments p
set reversed = false, updated_at = now()
where p.id in (select id from public.payments_reversed_fix_backup)
  and p.deleted_at is null and coalesce(p.reversed, false)
  and not exists (select 1 from public.payments r where r.reversal_of = p.id::text and r.deleted_at is null);

-- Expect: 7 rows backed up, 0 payments still flagged without a reversing row.
select (select count(*) from public.payments_reversed_fix_backup) as backed_up,
       (select count(*) from public.payments p
         where p.deleted_at is null and coalesce(p.reversed, false)
           and not exists (select 1 from public.payments r where r.reversal_of = p.id::text and r.deleted_at is null)) as still_unpaired;

commit;
