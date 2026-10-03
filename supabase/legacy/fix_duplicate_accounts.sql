-- ============================================================
-- Remove duplicate accounts (same code appearing multiple times)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Keeps the OLDEST row for each (code, name) and soft-deletes the
-- rest by stamping deleted_at, so they move to Trash rather than
-- being destroyed (you can restore if needed). Any payments already
-- linked by account NAME are unaffected, since the surviving row
-- keeps the same name.
-- ============================================================

with ranked as (
  select id, code, name,
         row_number() over (partition by code, name order by created_at asc) as rn
  from public.accounts
  where deleted_at is null
)
update public.accounts a
set deleted_at = now()
from ranked r
where a.id = r.id and r.rn > 1;

-- Verify: each code/name should now appear once among live rows.
--   select code, name, count(*) from public.accounts
--   where deleted_at is null group by code, name order by code;
