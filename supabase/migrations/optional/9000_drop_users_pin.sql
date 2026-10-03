-- ============================================================
-- OPTIONAL 9000  Drop the plaintext PIN column (users.pin)
-- ------------------------------------------------------------
-- NOT part of the default apply order (it lives in migrations/optional/).
-- Audit: SEC-12 / DB-19 (PINs stored in plaintext and published), UX-015.
--
-- Run it only when ALL of these are true:
--   1. the deployed browser code no longer reads or writes users.pin
--      (the auth/UI change that removed PIN login is live), and
--   2. the create-user Edge Function no longer sends `pin`
--      (supabase/functions/create-user/index.ts in this repo no longer does;
--      redeploy it first, an old deployed copy would fail on insert), and
--   3. you have a fresh backup / PITR point (this DROP is irreversible).
--
-- Depends on : 0007 (its self-update guard compares rows as jsonb, so it keeps
--              working without the column), 0008
-- Idempotent : yes (drop column if exists; backup rows only inserted once)
-- Data change: DESTRUCTIVE for that one column. The existing values are first
--              copied to public.migration_backup (service-role-only table) so
--              the drop can be undone; delete those rows once you are sure:
--                  delete from public.migration_backup where migration = '9000';
-- App impact : none if conditions 1 and 2 hold.
-- Rollback   : alter table public.users add column pin text;
--              update public.users u set pin = b.old_value
--                from public.migration_backup b
--               where b.migration = '9000' and b.table_name = 'users'
--                 and b.column_name = 'pin' and b.row_id = u.id::text;
-- ============================================================
begin;
select public._mig_log('9000', '_start', 'info');

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'users' and column_name = 'pin') then
    insert into public.migration_backup (migration, table_name, row_id, column_name, old_value)
      select '9000', 'users', u.id::text, 'pin', u.pin
        from public.users u
       where u.pin is not null
         and not exists (select 1 from public.migration_backup b
                          where b.migration = '9000' and b.table_name = 'users'
                            and b.column_name = 'pin' and b.row_id = u.id::text);
    alter table public.users drop column pin;
    perform public._mig_log('9000', 'drop_users_pin', 'ok', 'column dropped; old values in migration_backup');
  else
    perform public._mig_log('9000', 'drop_users_pin', 'ok', 'column already absent');
  end if;
end $$;

select public._mig_log('9000', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '9000'
  and at >= (select max(at) from public.migration_log where migration = '9000' and step = '_start')
order by id;
