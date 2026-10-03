-- ============================================================
-- 0008  Server-side audit trail
-- ------------------------------------------------------------
-- Audit: SEC-04, UX-008, DB-22, ACC-11/12 (before/after values), DEP-16
--        (audit_log append-only).
-- Depends on : 0001, 0002, 0007
-- Idempotent : yes
-- Data change: none to existing rows. New table row_history; new column
--              audit_log.actor_id.
-- App impact : none required. audit_log inserts from the browser keep
--              working, but "user", "timestamp", created_at and actor_id are
--              now stamped by the database from the login (auth.uid() /
--              JWT email), whatever the client sends. UPDATE and DELETE on
--              audit_log are refused for everyone (see retention note).
--              The authoritative record of "who changed what" is the new
--              public.row_history table (admin read-only). The Activity Log
--              page can be pointed at it later; nothing breaks if it is not.
-- Rollback   : drop trigger trg_*_history / trg_audit_log_* ...;
--              drop table public.row_history;  (list in README)
--
-- row_history: one row per INSERT/UPDATE/DELETE on invoices, payments,
-- payslips, expenses, journals, accounts, employees, branches, users and
-- custom_roles, with auth.uid(), the JWT email, table, op, the old and new
-- row as jsonb and the list of changed columns. users.pin is never copied.
-- Writes by the service role / SQL editor are recorded with actor NULL.
--
-- Retention / purge of audit_log or row_history (statutory period): the
-- append-only trigger blocks everyone, including admins and the SQL editor.
-- A deliberate purge must be a conscious two-step action by the DBA:
--     alter table public.audit_log disable trigger trg_audit_log_append_only;
--     delete from public.audit_log where created_at < now() - interval '7 years';
--     alter table public.audit_log enable trigger trg_audit_log_append_only;
-- ============================================================
begin;
select public._mig_log('0008', '_start', 'info');

-- ---------- audit_log: server-stamped identity, append-only ----------
create or replace function public.stamp_audit_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.actor_id   := auth.uid();
  new."user"     := coalesce(nullif(auth.jwt() ->> 'email', ''),
                             (select u.email from public.users u where u.id = auth.uid()),
                             auth.uid()::text,
                             'system');
  new."timestamp" := now();
  new.created_at  := now();
  return new;
end $$;

drop trigger if exists trg_audit_log_stamp on public.audit_log;
create trigger trg_audit_log_stamp before insert on public.audit_log
  for each row execute function public.stamp_audit_log();

create or replace function public.block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op using errcode = '55000';
end $$;

drop trigger if exists trg_audit_log_append_only on public.audit_log;
create trigger trg_audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.block_mutation();
drop trigger if exists trg_audit_log_no_truncate on public.audit_log;
create trigger trg_audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.block_mutation();

-- ---------- row_history ----------
create table if not exists public.row_history (
  id          bigserial primary key,
  at          timestamptz not null default clock_timestamp(),
  actor       uuid,                     -- auth.uid(); NULL = service role / SQL editor
  actor_email text,
  table_name  text        not null,
  row_id      text,
  op          text        not null check (op in ('INSERT','UPDATE','DELETE')),
  changed     text[],                   -- columns that differ (UPDATE only)
  old_row     jsonb,
  new_row     jsonb
);
create index if not exists row_history_row_idx on public.row_history (table_name, row_id, at desc);
create index if not exists row_history_at_idx  on public.row_history (at desc);

alter table public.row_history enable row level security;
drop policy if exists row_history_select on public.row_history;
create policy row_history_select on public.row_history for select to authenticated
  using ((select public.is_admin()));
revoke all on public.row_history from anon;
revoke insert, update, delete, truncate on public.row_history from authenticated, service_role;
revoke all on sequence public.row_history_id_seq from anon, authenticated;

drop trigger if exists trg_row_history_append_only on public.row_history;
create trigger trg_row_history_append_only before update or delete on public.row_history
  for each row execute function public.block_mutation();
drop trigger if exists trg_row_history_no_truncate on public.row_history;
create trigger trg_row_history_no_truncate before truncate on public.row_history
  for each statement execute function public.block_mutation();

create or replace function public.capture_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb;
  n jsonb;
  ch text[];
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;

  if tg_table_name = 'users' then          -- never copy PINs into history
    o := o - 'pin';
    n := n - 'pin';
  end if;

  if tg_op = 'UPDATE' then
    if (o - 'updated_at') = (n - 'updated_at') then return null; end if;   -- no real change
    select coalesce(array_agg(k order by k), '{}') into ch
      from jsonb_object_keys(n) k
     where k <> 'updated_at' and (n -> k) is distinct from (o -> k);
  end if;

  insert into public.row_history (actor, actor_email, table_name, row_id, op, changed, old_row, new_row)
  values (auth.uid(), nullif(auth.jwt() ->> 'email', ''), tg_table_name,
          coalesce(n ->> 'id', o ->> 'id'), tg_op, ch, o, n);
  return null;
end $$;

revoke all on function public.capture_history(), public.stamp_audit_log(), public.block_mutation()
  from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['invoices','payments','payslips','expenses','journals','accounts',
                           'employees','branches','users','custom_roles'] loop
    execute format('drop trigger if exists trg_%1$s_history on public.%1$I', t);
    execute format('create trigger trg_%1$s_history after insert or update or delete on public.%1$I
                      for each row execute function public.capture_history()', t);
  end loop;
end $$;

select public._mig_log('0008', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0008'
  and at >= (select max(at) from public.migration_log where migration = '0008' and step = '_start')
order by id;
