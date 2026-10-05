-- ============================================================
-- Repair: a live (never reversed) invoice receipt that was soft-deleted while
-- its invoice stayed paid (Arish Junaid, August fee, Rs. 3,500, Cash).
-- Un-trashes that one payment so the ledger agrees with the invoice again.
-- SQL Editor (service role). One transaction; re-runnable; backs the row up first.
-- Undo: update public.payments p set deleted_at = b.deleted_at
--         from public.payments_restore_backup b where b.id = p.id;
-- ============================================================
begin;

create table if not exists public.payments_restore_backup as
  select * from public.payments where false;

insert into public.payments_restore_backup
select p.* from public.payments p
where p.id = '56e03d60-63ef-40a6-af10-3f0c31e24911'
  and p.deleted_at is not null
  and not exists (select 1 from public.payments_restore_backup b where b.id = p.id);

update public.payments p
set deleted_at = null, updated_at = now()
where p.id = '56e03d60-63ef-40a6-af10-3f0c31e24911'
  and p.deleted_at is not null
  and p.source = 'invoice' and p.source_id = 'af4dd0c2-3ce8-4b41-8e29-bdd476985438'
  and p.type = 'cash_in' and not coalesce(p.reversed, false) and p.reversal_of is null;

-- Expect: 1 row, deleted_at null
select id, date, account, amount, description, deleted_at
from public.payments where id = '56e03d60-63ef-40a6-af10-3f0c31e24911';

commit;
