-- ============================================================
-- 0011  Ledger guards: posted money cannot be edited, relabelled or trashed
--       outside the money RPCs   *** ENFORCING: APPLY AFTER THE APP CHANGE ***
-- ------------------------------------------------------------
-- Audit: ACC-01, ACC-02, ACC-03, ACC-14, ACC-18, DB-13, DB-21, SEC-03.
-- Depends on : 0009 (the RPCs set the app.money_rpc flag these triggers look for)
-- Idempotent : yes
-- Data change: none
-- App impact : HIGH. Do NOT apply until the browser code uses the 0009
--              RPCs for every money flow. Today's pages break on purpose:
--                * Fees: confirmPay / bulk receive / quick payment / "receive now"
--                  write status, paid_amount, paid_account directly  -> refused
--                * Fees "Bulk Edit -> status"                        -> refused
--                * Payments: bulk edit of account/date, edit amount,
--                  Delete of a live (un-reversed) payment            -> refused
--                * Payslips: marking status 'paid' directly          -> refused
--                * Trashing an invoice/payslip/expense that still has live
--                  payments (reverse first, or use trash_invoice)    -> refused
--              Reads, creating pending invoices, expenses, payslips, editing
--              descriptions/categories/notes keep working.
-- Rollback   : drop trigger trg_payments_immutable on public.payments;
--              drop trigger trg_invoices_money_guard on public.invoices;
--              drop trigger trg_payslips_money_guard on public.payslips;
--              drop trigger trg_expenses_money_guard on public.expenses;
-- Break-glass: the SQL editor / service role (auth.uid() IS NULL) is not
--              restricted, so a DBA can correct a posting by hand. Every such
--              change is still recorded in row_history (0008).
-- ============================================================
begin;
select public._mig_log('0011', '_start', 'info');

create or replace function public._in_money_rpc()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.money_rpc', true), '') = 'on'
$$;
revoke all on function public._in_money_rpc() from public, anon, authenticated;

-- True when a document still has money posted that nobody has reversed.
create or replace function public._has_live_payments(p_source text, p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.payments
                  where source = p_source and source_id = p_id::text
                    and deleted_at is null and not coalesce(reversed, false) and reversal_of is null)
$$;
revoke all on function public._has_live_payments(text, uuid) from public, anon, authenticated;

-- ---------- payments: append-only ledger ----------
create or replace function public.guard_payment_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;               -- service role / SQL editor

  if (new.amount, new.type, new.account, new.source, new.source_id, new.reversal_of, new.date, new.branch_id)
     is distinct from
     (old.amount, old.type, old.account, old.source, old.source_id, old.reversal_of, old.date, old.branch_id) then
    raise exception 'Posted payments are immutable: post a reversal and a new entry instead'
      using errcode = '55000';
  end if;
  if old.receipt_no is not null and new.receipt_no is distinct from old.receipt_no then
    raise exception 'receipt_no cannot be changed' using errcode = '55000';
  end if;

  if coalesce(old.reversed, false) and not coalesce(new.reversed, false) then
    raise exception 'A reversed payment cannot be un-reversed' using errcode = '55000';
  end if;
  -- "reversed" may only be switched on by the RPCs, or once the reversing row exists
  if not coalesce(old.reversed, false) and coalesce(new.reversed, false)
     and not public._in_money_rpc()
     and not exists (select 1 from public.payments r where r.reversal_of = old.id::text and r.deleted_at is null) then
    raise exception 'Use reverse_source_payments() to reverse a payment' using errcode = '55000';
  end if;

  -- trash only what is already reversed (or is itself a reversal)
  if old.deleted_at is null and new.deleted_at is not null
     and not coalesce(old.reversed, false) and old.reversal_of is null then
    raise exception 'Reverse this payment instead of deleting it' using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_immutable on public.payments;
create trigger trg_payments_immutable before update on public.payments
  for each row execute function public.guard_payment_update();

-- ---------- invoices: "paid" can only come from the ledger ----------
create or replace function public.guard_invoice_money()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public._in_money_rpc() then return new; end if;

  if tg_op = 'INSERT' then
    if new.status in ('paid','partial') or coalesce(new.paid_amount, 0) <> 0
       or coalesce(new.concession_amount, 0) <> 0 or new.paid_account is not null then
      raise exception 'Invoices are created unpaid. Record the payment with record_invoice_payment() / post_invoice().'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if (new.status, new.paid_amount, new.paid_date, new.paid_account, new.concession_amount, new.concession_note)
     is distinct from
     (old.status, old.paid_amount, old.paid_date, old.paid_account, old.concession_amount, old.concession_note)
     and not (new.status = 'void' and old.status = 'pending' and coalesce(old.paid_amount, 0) = 0) then
    raise exception 'Payment state of an invoice is derived from the ledger. Use record_invoice_payment().'
      using errcode = '55000';
  end if;

  if old.deleted_at is null and new.deleted_at is not null and public._has_live_payments('invoice', old.id) then
    raise exception 'This invoice has live payments. Use trash_invoice() so they are reversed first.'
      using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_money_guard on public.invoices;
create trigger trg_invoices_money_guard before insert or update on public.invoices
  for each row execute function public.guard_invoice_money();

-- ---------- payslips ----------
create or replace function public.guard_payslip_money()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public._in_money_rpc() then return new; end if;

  if tg_op = 'INSERT' then
    if new.status = 'paid' or new.paid_account is not null then
      raise exception 'Payslips are created unpaid. Use pay_payslip().' using errcode = '55000';
    end if;
    return new;
  end if;

  if (new.status, new.paid_date, new.paid_account) is distinct from (old.status, old.paid_date, old.paid_account) then
    raise exception 'Payslip payment state changes only through pay_payslip() / reverse_source_payments().'
      using errcode = '55000';
  end if;
  -- a paid payslip's amounts are frozen (ACC-18); free-text notes stay editable
  if old.status = 'paid'
     and ((new.amount, new.month, new.employee_id) is distinct from (old.amount, old.month, old.employee_id)
          or (coalesce(new.extra,'{}'::jsonb) - 'notes') is distinct from (coalesce(old.extra,'{}'::jsonb) - 'notes')) then
    raise exception 'A paid payslip cannot be changed. Reverse the payment first.' using errcode = '55000';
  end if;
  if old.deleted_at is null and new.deleted_at is not null and public._has_live_payments('payslip', old.id) then
    raise exception 'This payslip has live payments. Reverse them first (reverse_source_payments).' using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists trg_payslips_money_guard on public.payslips;
create trigger trg_payslips_money_guard before insert or update on public.payslips
  for each row execute function public.guard_payslip_money();

-- ---------- expenses ----------
create or replace function public.guard_expense_money()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public._in_money_rpc() then return new; end if;
  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount and public._has_live_payments('expense', old.id) then
      raise exception 'This expense has a posted payment; reverse it before changing the amount.' using errcode = '55000';
    end if;
    if old.deleted_at is null and new.deleted_at is not null and public._has_live_payments('expense', old.id) then
      raise exception 'This expense has a live payment. Reverse it first (reverse_source_payments).' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_expenses_money_guard on public.expenses;
create trigger trg_expenses_money_guard before update on public.expenses
  for each row execute function public.guard_expense_money();

select public._mig_log('0011', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0011'
  and at >= (select max(at) from public.migration_log where migration = '0011' and step = '_start')
order by id;
