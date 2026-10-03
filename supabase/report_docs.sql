-- ============================================================
-- ZMI School ERP — shared report data (Haji Sahab report)
-- Run once in the SQL Editor, AFTER schema.sql and security.sql.
-- Safe to re-run. The app works without it (shared presets and
-- month-close are simply unavailable until it exists).
--
--   kind 'preset'  shared report layouts      -> admin writes
--   kind 'close'   frozen month-end statement -> accountant / admin writes
-- Everyone who can view reports can read both.
-- ============================================================

create table if not exists public.report_docs (
  id          text primary key,            -- 'preset:abc123', 'close:2026-09:all'
  kind        text not null check (kind in ('preset', 'close')),
  data        jsonb not null default '{}'::jsonb,
  updated_by  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_report_docs_kind on public.report_docs (kind);

drop trigger if exists trg_report_docs_updated on public.report_docs;
create trigger trg_report_docs_updated before update on public.report_docs
  for each row execute function public.set_updated_at();

alter table public.report_docs enable row level security;

drop policy if exists report_docs_select on public.report_docs;
create policy report_docs_select on public.report_docs for select to authenticated
  using (public.has_perm('canViewReports'));

drop policy if exists report_docs_insert on public.report_docs;
create policy report_docs_insert on public.report_docs for insert to authenticated
  with check (
    (kind = 'preset' and public.is_admin()) or
    (kind = 'close'  and public.has_perm('canEditAccounting'))
  );

drop policy if exists report_docs_update on public.report_docs;
create policy report_docs_update on public.report_docs for update to authenticated
  using (
    (kind = 'preset' and public.is_admin()) or
    (kind = 'close'  and public.has_perm('canEditAccounting'))
  )
  with check (
    (kind = 'preset' and public.is_admin()) or
    (kind = 'close'  and public.has_perm('canEditAccounting'))
  );

drop policy if exists report_docs_delete on public.report_docs;
create policy report_docs_delete on public.report_docs for delete to authenticated
  using (
    (kind = 'preset' and public.is_admin()) or
    (kind = 'close'  and public.has_perm('canEditAccounting'))
  );
