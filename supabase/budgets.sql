-- ============================================================
-- ZMI School ERP — Budgets (Reports → Budget vs Actual)
-- Run once in the SQL Editor, AFTER schema.sql and security.sql.
-- Safe to re-run.
--
-- One row per budget line, as a MONTHLY amount:
--   kind     'income'  -> fee-collection target
--            'payroll' -> salaries budget
--            'expense' -> one operating-expense category
--   category the expense category name (or a fixed label for the others)
--   branch_id '' / null = Main Office, otherwise a branches.id
-- ============================================================

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('income', 'payroll', 'expense')),
  category    text not null,
  amount      numeric not null default 0,   -- per month
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

drop trigger if exists trg_budgets_updated on public.budgets;
create trigger trg_budgets_updated before update on public.budgets
  for each row execute function public.set_updated_at();

-- ---------- Row-level security ----------
-- Seen by anyone who can view reports, changed by anyone who can edit
-- accounting; both limited to the branches the user can see.
alter table public.budgets enable row level security;

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using (public.has_perm('canViewReports') and public.branch_visible(branch_id));

drop policy if exists budgets_insert on public.budgets;
create policy budgets_insert on public.budgets for insert to authenticated
  with check (public.has_perm('canEditAccounting') and public.branch_visible(branch_id));

drop policy if exists budgets_update on public.budgets;
create policy budgets_update on public.budgets for update to authenticated
  using (public.has_perm('canEditAccounting') and public.branch_visible(branch_id))
  with check (public.has_perm('canEditAccounting') and public.branch_visible(branch_id));

drop policy if exists budgets_delete on public.budgets;
create policy budgets_delete on public.budgets for delete to authenticated
  using (public.has_perm('canEditAccounting') and public.branch_visible(branch_id));
