-- ============================================================
-- Accounting integrity columns for ZMI School ERP
-- Run once in the SQL Editor, AFTER schema.sql. Safe to re-run.
--
-- Adds reversal tracking to payments so financial edits/deletes are
-- handled by posting equal-and-opposite reversing entries instead of
-- silently mutating the ledger (preserves the audit trail).
--
-- Also adds source linkage columns used to trace a payment back to
-- the invoice / payslip / expense that created it, and a `paid`
-- running-total concept for partial payments on invoices.
-- ============================================================

-- payments: reversal + source tracking
alter table public.payments add column if not exists source        text;
alter table public.payments add column if not exists source_id     text;
alter table public.payments add column if not exists reversed       boolean default false;
alter table public.payments add column if not exists reversal_of    text;

create index if not exists idx_payments_source on public.payments (source, source_id);

-- invoices: support partial payments
--   paid_amount = how much has been received so far
--   status: 'pending' | 'partial' | 'paid'
alter table public.invoices add column if not exists paid_amount   numeric default 0;
alter table public.invoices add column if not exists paid_account  text;
alter table public.invoices add column if not exists paid_date     text;

-- invoices: concession tracking (non-profit "forgiven" amount).
-- The invoice keeps its full amount; concession_amount records how
-- much was waived so it can be reported as the institute's
-- contribution. discount_at_invoice is an optional concession set
-- when the invoice is created.
alter table public.invoices add column if not exists concession_amount  numeric default 0;
alter table public.invoices add column if not exists concession_note    text;

-- payslips: paid tracking (already written by the app; ensure columns)
alter table public.payslips add column if not exists status        text default 'pending';
alter table public.payslips add column if not exists paid_account  text;
alter table public.payslips add column if not exists paid_date     text;

-- expenses: which account paid it (if any)
alter table public.expenses add column if not exists paid_account  text;

-- accounts: opening balance as a real column (was stored in extra jsonb).
-- Migrate any existing value out of extra into the column.
alter table public.accounts add column if not exists balance numeric default 0;
update public.accounts
  set balance = coalesce((extra->>'balance')::numeric, balance, 0)
  where extra ? 'balance';
