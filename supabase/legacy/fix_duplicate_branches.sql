-- ============================================================
-- Fix duplicate branches (Main / Baneen appearing twice)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- What it does:
--   1. For each branch NAME, keeps the oldest row as the "keeper".
--   2. Repoints any students/employees/etc. that referenced a
--      duplicate over to the keeper (so no records are orphaned).
--   3. Deletes the duplicate branch rows.
--   4. Adds a UNIQUE constraint on name so it can't happen again.
-- ============================================================

-- 1) + 2) Repoint child records from duplicates to the keeper.
--    The keeper is the earliest-created row for each name.
do $$
declare
  dup record;
  keeper_id uuid;
begin
  for dup in
    select name, min(created_at) as first_created
    from public.branches
    group by name
    having count(*) > 1
  loop
    -- find the keeper (oldest) for this name
    select id into keeper_id
    from public.branches
    where name = dup.name
    order by created_at asc
    limit 1;

    -- repoint every table that stores a branch_id (text) to the keeper,
    -- for all the duplicate (non-keeper) ids of this name.
    update public.students  set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);
    update public.employees set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);
    update public.invoices  set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);
    update public.expenses  set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);
    update public.payments  set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);
    update public.payslips  set branch_id = keeper_id::text
      where branch_id in (select id::text from public.branches where name = dup.name and id <> keeper_id);

    -- 3) delete the duplicates (keep only the keeper)
    delete from public.branches
    where name = dup.name and id <> keeper_id;
  end loop;
end $$;

-- 4) Prevent future duplicates.
--    (If this errors saying the constraint exists, you can ignore it.)
do $$
begin
  alter table public.branches add constraint branches_name_unique unique (name);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

-- Verify: should now show each name once.
--   select name, count(*) from public.branches group by name order by name;
