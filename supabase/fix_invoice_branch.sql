-- One-off data fix: make every invoice's branch match its student's CURRENT
-- branch. Invoices copy branch_id from the student when created, so invoices
-- raised before a student was moved to a branch stayed on "Main Office" (blank)
-- and showed up in that branch's fees. Safe to re-run.

-- 1) Preview what will change
select i.id, i.branch_id as invoice_branch, s.branch_id as student_branch, i.amount, i.status
from public.invoices i
join public.students s on s.id::text = i.student_id
where coalesce(i.branch_id, '') is distinct from coalesce(s.branch_id, '')
  and i.deleted_at is null;

-- 2) Apply
update public.invoices i
set branch_id = coalesce(s.branch_id, '')
from public.students s
where s.id::text = i.student_id
  and coalesce(i.branch_id, '') is distinct from coalesce(s.branch_id, '');

-- 3) Matching ledger entries created from those invoices
update public.payments p
set branch_id = coalesce(i.branch_id, '')
from public.invoices i
where p.source = 'invoice'
  and p.source_id = i.id::text
  and coalesce(p.branch_id, '') is distinct from coalesce(i.branch_id, '');
