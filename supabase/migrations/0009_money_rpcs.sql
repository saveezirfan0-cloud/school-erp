-- ============================================================
-- 0009  Transactional money RPCs, document numbers, account_balances view
-- ------------------------------------------------------------
-- Audit: DB-3, DB-4/ACC-01, DB-9/ACC-20, DB-10/ACC-19, DB-12, DB-5, ACC-03,
--        ACC-09, ACC-13, ACC-14, ACC-17.
-- Depends on : 0001, 0002, 0005 (columns + unique keys), 0007
-- Idempotent : yes (create or replace / if not exists)
-- Data change: none to existing rows. New table document_counters.
-- App impact : purely additive. Nothing calls these until the app is changed
--              to (see README "RPC reference"). Two triggers start giving new
--              invoices an invoice_no and new fee receipts a receipt_no
--              automatically, whatever code inserts them.
-- Rollback   : drop function ... ; drop trigger trg_invoices_number /
--              trg_payments_number; drop view account_balances;
--              drop table document_counters;  (list in README)
--
-- Design (the ten drafts in the database audit, reduced to one coherent set)
--   Every function is SECURITY DEFINER with a fixed search_path, checks the
--   caller's permission AND branch inside, runs as ONE transaction, locks the
--   source row (SELECT ... FOR UPDATE) so two collectors cannot both see the
--   same "already paid", recomputes "paid so far" from the ledger on the
--   server, and accepts an optional idempotency key (a client-generated uuid
--   created when the dialog opens): a retry or double click with the same key
--   returns the first result instead of posting twice.
--
--   list_pay_accounts()              Bank & Cash accounts, for any posting role
--   invoice_balance(invoice)         amount / concession / paid / remaining
--   post_invoice(...)                create an invoice (+ optional immediate payment)
--   record_invoice_payment(...)      collect a fee (partial, full, concession)
--   pay_payslip(...)                 pay one payslip
--   pay_expense(...)                 post the cash-out of an expense
--   transfer_funds(...)              move money between two accounts (2 legs, atomic)
--   reverse_source_payments(...)     reverse every live payment of a document, atomically
--   trash_document / restore_document  (invoices, expenses, payslips) Trash + reversal in one
--                                    step; restore RE-POSTS the reversed money (extra.repostOf), like
--                                    utils/accounting.js; trash_invoice / restore_invoice are wrappers
--   reverse_payment(id, date)        reverse ONE payment and update its source document
--   edit_invoice(...)                the Fees 'Edit Invoice' save: branch, period, due date, notes,
--                                    line items, total; payments follow the invoice's branch
--   post_unposted_invoice(...)       post the cash of a 'paid but unposted' receipt (extra.ledgerPosted=false)
--   generate_recurring_invoices(...) month's tuition invoices, race-free, no duplicates
--   patch_extra(...)                 merge keys into extra jsonb without clobbering (SECURITY INVOKER)
--   view account_balances            opening balance + live payments per account
--   (internal) next_document_number, _apply_invoice_payment, _reverse_source
--
--   Not included on purpose: promote_students / academic years (DB-24, a
--   product feature), column promotion of jsonb fields (needs the app's
--   COLUMNS map changed first).
-- ============================================================
begin;
select public._mig_log('0009', '_start', 'info');

-- ------------------------------------------------------------
-- Document numbers: gapless, per kind and year (DB-9). The counter row is
-- locked by the inserting transaction, so numbers are never skipped on
-- commit and roll back cleanly with it.
-- ------------------------------------------------------------
create table if not exists public.document_counters (
  kind       text   not null check (kind in ('invoice','receipt')),
  period     int    not null,
  last_value bigint not null default 0,
  primary key (kind, period)
);
alter table public.document_counters enable row level security;      -- no policies: definer functions only
revoke all on public.document_counters from anon, authenticated;

create or replace function public.next_document_number(p_kind text, p_period int)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  insert into public.document_counters as c (kind, period, last_value)
  values (p_kind, p_period, 1)
  on conflict (kind, period) do update set last_value = c.last_value + 1
  returning last_value into v;
  return format('%s-%s-%s', case p_kind when 'invoice' then 'INV' else 'RCP' end, p_period, lpad(v::text, 6, '0'));
end $$;

create or replace function public.assign_invoice_no()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.invoice_no is null and coalesce(new.extra->>'historical', '') <> 'true' then
    new.invoice_no := public.next_document_number('invoice', extract(year from now())::int);
  end if;
  return new;
end $$;

create or replace function public.assign_receipt_no()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- a receipt is a fee collection: money in against an invoice
  if new.receipt_no is null and new.type = 'cash_in' and new.source = 'invoice' and new.reversal_of is null
     and coalesce(new.extra->>'historical', '') <> 'true' then   -- imported history is not numbered
    new.receipt_no := public.next_document_number('receipt', extract(year from now())::int);
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_number on public.invoices;
create trigger trg_invoices_number before insert on public.invoices
  for each row execute function public.assign_invoice_no();
drop trigger if exists trg_payments_number on public.payments;
create trigger trg_payments_number before insert on public.payments
  for each row execute function public.assign_receipt_no();

-- ------------------------------------------------------------
-- Small internal helpers (not callable by API roles)
-- ------------------------------------------------------------
create or replace function public._invoice_status(p_amount numeric, p_paid numeric, p_conc numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when coalesce(p_paid,0) + coalesce(p_conc,0) >= coalesce(p_amount,0) - 0.005 then 'paid'
    when coalesce(p_paid,0) > 0 then 'partial'
    else 'pending' end
$$;

create or replace function public._assert_authenticated()
returns void language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
end $$;

create or replace function public._assert_pay_account(p_account text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_account is null or not exists (
       select 1 from public.accounts a
        where a.name = p_account and a.deleted_at is null
          and (a.sub_type = 'Bank & Cash' or a.type = 'Assets')) then
    raise exception 'unknown or non-cash account "%"', coalesce(p_account, '')
      using errcode = '23503', hint = 'choose a Bank & Cash account';
  end if;
end $$;

-- Net money posted for an invoice: live, non-reversed originals only.
create or replace function public._invoice_paid(p_invoice_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when type = 'cash_in' then amount else -amount end), 0)
    from public.payments
   where source = 'invoice' and source_id = p_invoice_id::text
     and deleted_at is null and not coalesce(reversed, false) and reversal_of is null
$$;

-- Post a payment against an invoice that the CALLER HAS ALREADY LOCKED and
-- authorised. Updates the invoice in the same transaction.
create or replace function public._apply_invoice_payment(
  inv public.invoices, p_amount numeric, p_account text, p_date date,
  p_concession boolean, p_note text, p_key uuid)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_paid numeric := public._invoice_paid(inv.id);
  v_rem  numeric := coalesce(inv.amount,0) - coalesce(inv.concession_amount,0) - v_paid;
  v_conc numeric := 0;
begin
  if p_amount > v_rem + 0.005 then
    raise exception 'amount % exceeds the remaining balance %', p_amount, greatest(v_rem, 0)
      using errcode = '23514';
  end if;

  if p_amount > 0 then
    perform public._assert_pay_account(p_account);
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, idempotency_key)
    values ('cash_in', p_account, p_amount, 'Fee Collection',
            format('Fee — %s (%s)', coalesce(inv.extra->>'studentName', 'student'), coalesce(inv.extra->>'month', '')),
            inv.id::text, coalesce(inv.branch_id, ''), to_char(p_date, 'YYYY-MM-DD'),
            'invoice', inv.id::text, false, p_key);
  end if;

  v_paid := v_paid + p_amount;
  if p_concession then v_conc := greatest(0, v_rem - p_amount); end if;

  update public.invoices set
    paid_amount       = v_paid,
    paid_date         = case when p_amount > 0 then to_char(p_date, 'YYYY-MM-DD') else paid_date end,
    paid_account      = case when p_amount > 0 then p_account else paid_account end,
    concession_amount = coalesce(concession_amount, 0) + v_conc,
    concession_note   = case when p_concession then coalesce(nullif(p_note, ''), 'Concession') else concession_note end,
    status            = public._invoice_status(amount, v_paid, coalesce(concession_amount, 0) + v_conc)
  where id = inv.id
  returning * into inv;
  return inv;
end $$;

-- Reverse every live payment of one source document (no permission check:
-- callers check). Also resets the source document so it never claims money
-- that is no longer in the books (ACC-02, ACC-03).
create or replace function public._reverse_source(p_source text, p_source_id text, p_reason text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payments; n int := 0;
begin
  for p in
    select * from public.payments
     where source = p_source and source_id = p_source_id
       and deleted_at is null and not coalesce(reversed, false) and reversal_of is null
     order by created_at, id
     for update
  loop
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, reversal_of, extra)
    values (case p.type when 'cash_in' then 'cash_out' else 'cash_in' end, p.account, p.amount,
            coalesce(p.category, '') || ' (reversal)', 'Reversal: ' || coalesce(p.description, ''),
            p.id::text, p.branch_id, to_char(current_date, 'YYYY-MM-DD'), p.source, p.source_id, false, p.id::text,
            case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);
    update public.payments set reversed = true where id = p.id;
    n := n + 1;
  end loop;

  if n > 0 then
    if p_source = 'invoice' then
      update public.invoices
         set paid_amount = 0, paid_date = null, paid_account = null,
             status = public._invoice_status(amount, 0, concession_amount)
       where id::text = p_source_id;
    elsif p_source = 'payslip' then
      update public.payslips set status = 'pending', paid_date = null, paid_account = null
       where id::text = p_source_id;
    elsif p_source = 'expense' then
      update public.expenses set paid_account = null where id::text = p_source_id;
    end if;
  end if;
  return n;
end $$;

-- ------------------------------------------------------------
-- Public RPCs
-- ------------------------------------------------------------

-- DB-4: posting roles can pick an account without reading the chart of accounts.
create or replace function public.list_pay_accounts()
returns table (id uuid, code text, name text, type text, sub_type text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._assert_authenticated();
  if not (public.has_perm('canEditFees') or public.has_perm('canEditPayslips')
       or public.has_perm('canEditExpenses') or public.has_perm('canEditPayments')
       or public.has_perm('canViewAccounting')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select a.id, a.code, a.name, a.type, a.sub_type
      from public.accounts a
     where a.deleted_at is null and (a.sub_type = 'Bank & Cash' or a.type = 'Assets')
     order by a.code, a.name;
end $$;

create or replace function public.invoice_balance(p_invoice_id uuid)
returns table (amount numeric, concession numeric, paid numeric, remaining numeric, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inv public.invoices; v_paid numeric;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canViewFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into inv from public.invoices i where i.id = p_invoice_id;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(inv.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  v_paid := public._invoice_paid(inv.id);
  return query select coalesce(inv.amount,0), coalesce(inv.concession_amount,0), v_paid,
                      greatest(0, coalesce(inv.amount,0) - coalesce(inv.concession_amount,0) - v_paid), inv.status;
end $$;

create or replace function public.post_invoice(
  p_student_id      uuid,
  p_amount          numeric,
  p_month           text,
  p_year            int,
  p_due_date        date    default null,
  p_line_items      jsonb   default null,
  p_notes           text    default null,
  p_pay_account     text    default null,     -- set it to receive the money now
  p_pay_date        date    default current_date,
  p_idempotency_key uuid    default null)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.students; inv public.invoices;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  perform set_config('app.money_rpc', 'on', true);

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    select * into inv from public.invoices where idempotency_key = p_idempotency_key;
    if found then return inv; end if;
  end if;

  select * into s from public.students where id = p_student_id and deleted_at is null;
  if not found then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(s.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;

  insert into public.invoices (student_id, branch_id, amount, status, due_date, paid_amount, idempotency_key, extra)
  values (s.id::text, coalesce(s.branch_id, ''), p_amount, 'pending',
          to_char(p_due_date, 'YYYY-MM-DD'), 0, p_idempotency_key,
          jsonb_strip_nulls(jsonb_build_object(
            'studentName', s.name, 'parentPhone', s.parent_phone,
            'month', p_month, 'year', p_year, 'notes', p_notes,
            'lineItems', coalesce(p_line_items,
                           jsonb_build_array(jsonb_build_object('description', 'Fee', 'amount', p_amount))))))
  returning * into inv;

  if p_pay_account is not null and p_pay_account <> '' then
    inv := public._apply_invoice_payment(inv, p_amount, p_pay_account, p_pay_date, false, null, null);
  end if;
  return inv;
end $$;

create or replace function public.record_invoice_payment(
  p_invoice_id      uuid,
  p_amount          numeric,
  p_account         text,
  p_date            date    default current_date,
  p_concession      boolean default false,
  p_concession_note text    default null,
  p_idempotency_key uuid    default null)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.invoices; v_src text;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_amount = 0 and not coalesce(p_concession, false) then
    raise exception 'enter an amount or mark the balance as concession' using errcode = '22023';
  end if;
  perform set_config('app.money_rpc', 'on', true);

  select * into inv from public.invoices where id = p_invoice_id and deleted_at is null for update;   -- serialises collectors
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(inv.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if inv.status = 'void' then raise exception 'invoice is void' using errcode = '23514'; end if;
  if coalesce(inv.extra->>'ledgerPosted', '') = 'false' then
    raise exception 'this invoice has a receipt that was never posted to the books; use post_unposted_invoice() first' using errcode = '23514';
  end if;

  if p_idempotency_key is not null then
    select source_id into v_src from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_src is distinct from inv.id::text then
        raise exception 'idempotency key was already used for another document' using errcode = '22023';
      end if;
      return inv;                                            -- replay: nothing posted twice
    end if;
  end if;

  return public._apply_invoice_payment(inv, p_amount, p_account, p_date, coalesce(p_concession, false), p_concession_note, p_idempotency_key);
end $$;

create or replace function public.pay_payslip(
  p_payslip_id      uuid,
  p_account         text,
  p_date            date default current_date,
  p_idempotency_key uuid default null)
returns public.payslips language plpgsql security definer set search_path = public, pg_temp as $$
declare ps public.payslips; v_amount numeric;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditPayslips') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);

  select * into ps from public.payslips where id = p_payslip_id and deleted_at is null for update;
  if not found then raise exception 'payslip not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(ps.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if ps.status = 'paid' then return ps; end if;               -- double click / retry: already paid

  -- net pay: extra->netPay (what the app shows; string or number), else the amount column (imports)
  v_amount := coalesce(
                case when ps.extra->>'netPay' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ps.extra->>'netPay')::numeric end,
                ps.amount);
  if v_amount is null or v_amount <= 0 then
    raise exception 'payslip has no positive net pay' using errcode = '23514';
  end if;
  perform public._assert_pay_account(p_account);

  insert into public.payments (type, account, amount, category, description, reference, branch_id,
                               date, source, source_id, reversed, idempotency_key)
  values ('cash_out', p_account, v_amount, 'Salary',
          format('Salary — %s (%s %s)', coalesce(ps.extra->>'employeeName', ''), coalesce(ps.month, ''), coalesce(ps.extra->>'year', '')),
          ps.id::text, coalesce(ps.branch_id, ''), to_char(p_date, 'YYYY-MM-DD'), 'payslip', ps.id::text, false, p_idempotency_key);

  update public.payslips set status = 'paid', paid_date = to_char(p_date, 'YYYY-MM-DD'), paid_account = p_account
   where id = ps.id returning * into ps;
  return ps;
end $$;

create or replace function public.pay_expense(
  p_expense_id      uuid,
  p_account         text,
  p_date            date default current_date,
  p_idempotency_key uuid default null)
returns public.expenses language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.expenses;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditExpenses') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);

  select * into e from public.expenses where id = p_expense_id and deleted_at is null for update;
  if not found then raise exception 'expense not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(e.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if e.amount is null or e.amount <= 0 then raise exception 'expense has no positive amount' using errcode = '23514'; end if;

  if exists (select 1 from public.payments p
              where p.source = 'expense' and p.source_id = e.id::text
                and p.deleted_at is null and not coalesce(p.reversed, false) and p.reversal_of is null) then
    return e;                                                -- already paid: idempotent
  end if;
  perform public._assert_pay_account(p_account);

  insert into public.payments (type, account, amount, category, description, reference, branch_id,
                               date, source, source_id, reversed, idempotency_key)
  values ('cash_out', p_account, e.amount, coalesce(nullif(e.category, ''), 'Expense'),
          coalesce(nullif(e.description, ''), 'Expense'), e.id::text, coalesce(e.branch_id, ''),
          to_char(p_date, 'YYYY-MM-DD'), 'expense', e.id::text, false, p_idempotency_key);

  update public.expenses set paid_account = p_account where id = e.id returning * into e;
  return e;
end $$;

-- Returns the transfer id (the shared source_id of both legs).
create or replace function public.transfer_funds(
  p_from_account    text,
  p_to_account      text,
  p_amount          numeric,
  p_date            date default current_date,
  p_description     text default null,
  p_idempotency_key uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := gen_random_uuid()::text; v_prev text;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditAccounting') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_from_account is null or p_to_account is null or p_from_account = p_to_account then
    raise exception 'choose two different accounts' using errcode = '22023';
  end if;
  perform set_config('app.money_rpc', 'on', true);

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    select source_id into v_prev from public.payments where idempotency_key = p_idempotency_key;
    if found then return v_prev; end if;
  end if;
  perform public._assert_pay_account(p_from_account);
  perform public._assert_pay_account(p_to_account);

  insert into public.payments (type, account, amount, category, description, branch_id, date, source, source_id, reversed, idempotency_key)
  values ('cash_out', p_from_account, p_amount, 'Bank Transfer',
          format('Transfer to %s: %s', p_to_account, coalesce(p_description, '')), '',
          to_char(p_date, 'YYYY-MM-DD'), 'transfer', v_id, false, p_idempotency_key);
  insert into public.payments (type, account, amount, category, description, branch_id, date, source, source_id, reversed)
  values ('cash_in', p_to_account, p_amount, 'Bank Transfer',
          format('Transfer from %s: %s', p_from_account, coalesce(p_description, '')), '',
          to_char(p_date, 'YYYY-MM-DD'), 'transfer', v_id, false);
  return v_id;
end $$;

create or replace function public.reverse_source_payments(p_source text, p_source_id text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare perm text; v_branch text; v_n int;
begin
  perform public._assert_authenticated();
  perm := case p_source when 'invoice' then 'canEditFees' when 'payslip' then 'canEditPayslips'
                        when 'expense' then 'canEditExpenses' when 'transfer' then 'canEditAccounting'
                        else null end;
  if perm is null then raise exception 'unknown source "%"', p_source using errcode = '22023'; end if;
  if not public.has_perm(perm) then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);

  -- every branch touched must be visible to the caller
  for v_branch in select distinct coalesce(branch_id, '') from public.payments
                   where source = p_source and source_id = p_source_id
                     and deleted_at is null and not coalesce(reversed, false) and reversal_of is null loop
    if not public.branch_visible(v_branch) then raise exception 'permission denied' using errcode = '42501'; end if;
  end loop;

  v_n := public._reverse_source(p_source, p_source_id, 'manual');   -- an explicit reversal: never re-posted by a restore
  return v_n;
end $$;

-- Move a document to Trash. Money posted for it is reversed first (one
-- transaction); the document's paid state is reset to match the ledger.
create or replace function public.trash_document(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare perm text; src text; v_branch text; n bigint;
begin
  perform public._assert_authenticated();
  select x.perm, x.src into perm, src from (values
    ('invoices','canDeleteFees','invoice'), ('expenses','canDeleteExpenses','expense'),
    ('payslips','canDeletePayslips','payslip')) as x(t, perm, src) where x.t = p_table;
  if perm is null then raise exception 'table "%" not supported', p_table using errcode = '22023'; end if;
  if not public.has_perm(perm) then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);

  execute format('select branch_id from public.%I where id = $1 and deleted_at is null for update', p_table)
    into v_branch using p_id;
  get diagnostics n = row_count;
  if n = 0 then return; end if;                                   -- already trashed: nothing to do
  if not public.branch_visible(v_branch) then raise exception 'permission denied' using errcode = '42501'; end if;

  perform public._reverse_source(src, p_id::text, 'trash');     -- tagged: restore_document re-posts exactly these
  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end $$;

-- Restore from Trash. Payments that the trash step reversed are RE-POSTED
-- (a new entry tagged extra.repostOf, like utils/accounting.js does), so the
-- restored document and the ledger agree again. Only payments reversed by the trash step
-- are re-posted. Idempotent.
create or replace function public.restore_document(p_table text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare perm text; src text; v_branch text; v_del timestamptz; n bigint; v_re int := 0; r public.payments; last_re public.payments;
begin
  perform public._assert_authenticated();
  select x.perm, x.src into perm, src from (values
    ('invoices','canDeleteFees','invoice'), ('expenses','canDeleteExpenses','expense'),
    ('payslips','canDeletePayslips','payslip')) as x(t, perm, src) where x.t = p_table;
  if perm is null then raise exception 'table "%" not supported', p_table using errcode = '22023'; end if;
  if not public.has_perm(perm) then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);

  execute format('select branch_id, deleted_at from public.%I where id = $1 and deleted_at is not null for update', p_table)
    into v_branch, v_del using p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'record is not in Trash' using errcode = 'P0002'; end if;
  if not public.branch_visible(v_branch) then raise exception 'permission denied' using errcode = '42501'; end if;

  for r in
    select * from public.payments o
     where o.source = src and o.source_id = p_id::text
       and o.deleted_at is null and coalesce(o.reversed, false) and o.reversal_of is null
       -- reversed BY THE TRASH STEP: tagged by trash_document, or (payments reversed by the old
       -- browser code, which carries no tag) reversed in the minutes just before the document was trashed.
       -- A payment the user reversed on purpose earlier is NOT brought back.
       and exists (select 1 from public.payments x
                    where x.reversal_of = o.id::text and x.deleted_at is null
                      and (x.extra->>'reason' = 'trash'
                           or (x.extra->>'reason' is null     -- untagged = reversed by the old browser code
                               and x.created_at between v_del - interval '2 minutes' and v_del + interval '10 seconds')))
       and not exists (select 1 from public.payments y where y.extra->>'repostOf' = o.id::text and y.deleted_at is null)
     order by o.created_at, o.id
     for update
  loop
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, extra)
    values (r.type, r.account, r.amount, r.category, 'Re-posted after restore: ' || coalesce(r.description, ''),
            r.id::text, r.branch_id, to_char(current_date, 'YYYY-MM-DD'), r.source, r.source_id, false,
            jsonb_build_object('repostOf', r.id::text))
    returning * into last_re;
    v_re := v_re + 1;
  end loop;

  if p_table = 'invoices' then
    update public.invoices i set deleted_at = null,
           paid_amount  = case when v_re > 0 then public._invoice_paid(i.id) else i.paid_amount end,
           paid_account = case when v_re > 0 then last_re.account else i.paid_account end,
           paid_date    = case when v_re > 0 then last_re.date else i.paid_date end,
           status       = case when v_re > 0
                               then public._invoice_status(i.amount, public._invoice_paid(i.id), i.concession_amount)
                               else i.status end
     where i.id = p_id;
  elsif p_table = 'payslips' then
    update public.payslips s set deleted_at = null,
           status       = case when v_re > 0 then 'paid' else s.status end,
           paid_account = case when v_re > 0 then last_re.account else s.paid_account end,
           paid_date    = case when v_re > 0 then last_re.date else s.paid_date end
     where s.id = p_id;
  else
    update public.expenses e set deleted_at = null,
           paid_account = case when v_re > 0 then last_re.account else e.paid_account end
     where e.id = p_id;
  end if;
  return jsonb_build_object('reposted', v_re);
end $$;

create or replace function public.trash_invoice(p_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public.trash_document('invoices', p_id)
$$;

create or replace function public.restore_invoice(p_id uuid)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.invoices;
begin
  perform public.restore_document('invoices', p_id);
  select * into inv from public.invoices where id = p_id;
  return inv;
end $$;

-- Reverse ONE payment (Payments page "Reverse"). Returns the reversal row id,
-- or NULL when it was already reversed. Updates the source document too.
create or replace function public.reverse_payment(p_payment_id uuid, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payments; perm text; rid uuid;
begin
  perform public._assert_authenticated();
  select * into p from public.payments where id = p_payment_id and deleted_at is null for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.reversal_of is not null then raise exception 'a reversal entry cannot itself be reversed' using errcode = '22023'; end if;
  if p.source = 'transfer' then raise exception 'reverse both legs with reverse_source_payments(''transfer'', id)' using errcode = '22023'; end if;
  perm := case coalesce(p.source, '') when 'invoice' then 'canEditFees' when 'payslip' then 'canEditPayslips'
                                       when 'expense' then 'canEditExpenses' else 'canEditPayments' end;
  if not public.has_perm(perm) then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.branch_visible(p.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(p.reversed, false) then return null; end if;
  perform set_config('app.money_rpc', 'on', true);

  insert into public.payments (type, account, amount, category, description, reference, branch_id,
                               date, source, source_id, reversed, reversal_of, extra)
  values (case p.type when 'cash_in' then 'cash_out' else 'cash_in' end, p.account, p.amount,
          coalesce(p.category, '') || ' (reversal)', 'Reversal: ' || coalesce(p.description, ''),
          p.id::text, p.branch_id, to_char(coalesce(p_date, current_date), 'YYYY-MM-DD'), p.source, p.source_id, false, p.id::text,
          '{"reason":"manual"}'::jsonb)
  returning id into rid;
  update public.payments set reversed = true where id = p.id;

  if p.source = 'invoice' then
    update public.invoices i set paid_amount = public._invoice_paid(i.id),
           status = public._invoice_status(i.amount, public._invoice_paid(i.id), i.concession_amount)
     where i.id::text = p.source_id;
  elsif p.source = 'payslip' then
    update public.payslips set status = 'pending', paid_date = null, paid_account = null where id::text = p.source_id;
  elsif p.source = 'expense' then
    update public.expenses set paid_account = null where id::text = p.source_id;
  end if;
  return rid;
end $$;

-- Invoice edit (Fees "Edit Invoice"): branch, period, due date, notes, line items, total.
-- Money already received is never changed here. The total cannot drop below
-- received + conceded. Payments of the invoice follow it to the new branch.
create or replace function public.edit_invoice(
  p_id uuid, p_branch_id text, p_month text, p_year int, p_due_date date,
  p_notes text, p_line_items jsonb, p_amount numeric)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invoices; v_new_branch text; v_received numeric; v_conc numeric; v_status text; v_paid numeric;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invoice total must be greater than 0' using errcode = '22023'; end if;
  perform set_config('app.money_rpc', 'on', true);

  select * into inv from public.invoices where id = p_id and deleted_at is null for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(inv.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;

  v_new_branch := case when coalesce(p_branch_id, '') in ('', 'main') then '' else p_branch_id end;
  if not public.branch_visible(v_new_branch) then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_new_branch <> '' and not exists (select 1 from public.branches b where b.id::text = v_new_branch and b.deleted_at is null) then
    raise exception 'branch "%" does not exist', v_new_branch using errcode = '23503';
  end if;

  v_conc := coalesce(inv.concession_amount, 0);
  v_paid := coalesce(inv.paid_amount, 0);
  v_received := case when v_paid > 0 then v_paid when inv.status = 'paid' then coalesce(inv.amount, 0) else 0 end;
  if p_amount + 0.001 < v_received + v_conc then
    raise exception 'total cannot be below what is already received/conceded (%)', v_received + v_conc using errcode = '23514';
  end if;

  v_status := inv.status;
  if abs(p_amount - coalesce(inv.amount, 0)) > 0.001 and inv.status <> 'void' then
    v_status := public._invoice_status(p_amount, v_received, v_conc);
  end if;

  update public.invoices set
    branch_id   = v_new_branch,
    due_date    = coalesce(to_char(p_due_date, 'YYYY-MM-DD'), due_date),
    amount      = p_amount,
    status      = v_status,
    paid_amount = case when v_received > 0 and v_paid = 0 then v_received else paid_amount end,
    extra       = coalesce(extra, '{}'::jsonb)
                  || jsonb_strip_nulls(jsonb_build_object('month', p_month, 'year', p_year, 'notes', p_notes,
                                                          'lineItems', p_line_items))
  where id = p_id
  returning * into inv;

  update public.payments set branch_id = v_new_branch
   where source = 'invoice' and source_id = p_id::text and coalesce(branch_id, '') <> v_new_branch;
  return inv;
end $$;

-- Receipts saved earlier as "paid but unposted" (extra.ledgerPosted = false):
-- post the missing cash into a chosen account. Idempotent via the key.
create or replace function public.post_unposted_invoice(
  p_invoice_id uuid, p_account text, p_date date default current_date, p_idempotency_key uuid default null)
returns public.invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.invoices; v_ledger numeric; v_cash numeric;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform set_config('app.money_rpc', 'on', true);
  select * into inv from public.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not public.branch_visible(inv.branch_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(inv.extra->>'ledgerPosted', '') <> 'false' then return inv; end if;      -- already posted

  v_ledger := public._invoice_paid(inv.id);
  v_cash := coalesce(inv.paid_amount, 0) - v_ledger;
  if v_cash > 0 then
    perform public._assert_pay_account(p_account);
    insert into public.payments (type, account, amount, category, description, reference, branch_id,
                                 date, source, source_id, reversed, idempotency_key)
    values ('cash_in', p_account, v_cash, 'Fee Collection',
            format('Fee — %s (%s)', coalesce(inv.extra->>'studentName', 'student'), coalesce(inv.extra->>'month', '')),
            inv.id::text, coalesce(inv.branch_id, ''), to_char(p_date, 'YYYY-MM-DD'), 'invoice', inv.id::text, false, p_idempotency_key);
  end if;
  update public.invoices
     set paid_account = case when v_cash > 0 then p_account else paid_account end,
         extra = coalesce(extra, '{}'::jsonb) || '{"ledgerPosted":true,"unpostedReason":""}'::jsonb
   where id = inv.id returning * into inv;
  return inv;
end $$;

create or replace function public.generate_recurring_invoices(p_year int, p_month text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public._assert_authenticated();
  if not public.has_perm('canEditFees') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_month not in ('January','February','March','April','May','June','July','August',
                     'September','October','November','December') then
    raise exception 'bad month "%"', p_month using errcode = '22023';
  end if;
  perform set_config('app.money_rpc', 'on', true);
  -- one generator per month at a time: a second tab waits, then finds the invoices already there
  perform pg_advisory_xact_lock(hashtextextended('recurring:' || p_year || ':' || p_month, 0));

  insert into public.invoices (student_id, branch_id, amount, status, paid_amount, extra)
  select s.id::text, coalesce(s.branch_id, ''), s.monthly_fee, 'pending', 0,
         jsonb_strip_nulls(jsonb_build_object(
           'studentName', s.name, 'parentPhone', s.parent_phone, 'month', p_month, 'year', p_year,
           'kind', 'recurring',
           'lineItems', jsonb_build_array(jsonb_build_object('description', 'Tuition Fee', 'amount', s.monthly_fee))))
    from public.students s
   where s.recurring_fee and s.deleted_at is null and coalesce(s.monthly_fee, 0) > 0
     and public.branch_visible(s.branch_id)
     and not exists (select 1 from public.invoices i
                      where i.student_id = s.id::text and i.deleted_at is null
                        and i.extra->>'month' = p_month and i.extra->>'year' = p_year::text);
  get diagnostics n = row_count;
  return n;
end $$;

-- DB-12: merge keys into `extra` instead of replacing it. SECURITY INVOKER:
-- normal RLS and triggers apply. users / custom_roles are excluded on purpose
-- (their `extra` holds permission data that only admins may write).
create or replace function public.patch_extra(p_table text, p_id text, p_patch jsonb)
returns int language plpgsql security invoker set search_path = public, pg_temp as $$
declare n int;
begin
  if p_table not in ('students','employees','invoices','expenses','payments','payslips','accounts','journals','branches') then
    raise exception 'table "%" not allowed', p_table using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'patch must be a json object' using errcode = '22023';
  end if;
  execute format('update public.%I set extra = coalesce(extra, ''{}''::jsonb) || $1 where id::text = $2', p_table)
    using p_patch, p_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- DB-5: balances computed in SQL (security_invoker: the caller's RLS applies).
-- A reversal is a second live row of the opposite type, so summing all live
-- rows nets reversed money out, exactly like BankCash.jsx does today.
create or replace view public.account_balances with (security_invoker = on) as
select a.id, a.code, a.name,
       coalesce(a.balance, 0)
       + coalesce(sum(case p.type when 'cash_in' then p.amount when 'cash_out' then -p.amount end), 0) as balance
  from public.accounts a
  left join public.payments p on p.account = a.name and p.deleted_at is null
 where a.deleted_at is null
 group by a.id, a.code, a.name, a.balance;

-- ------------------------------------------------------------
-- Grants: signed-in users only; internals are not callable at all.
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.list_pay_accounts()',
    'public.invoice_balance(uuid)',
    'public.post_invoice(uuid,numeric,text,int,date,jsonb,text,text,date,uuid)',
    'public.record_invoice_payment(uuid,numeric,text,date,boolean,text,uuid)',
    'public.pay_payslip(uuid,text,date,uuid)',
    'public.pay_expense(uuid,text,date,uuid)',
    'public.transfer_funds(text,text,numeric,date,text,uuid)',
    'public.reverse_source_payments(text,text)',
    'public.trash_invoice(uuid)',
    'public.restore_invoice(uuid)',
    'public.trash_document(text,uuid)',
    'public.restore_document(text,uuid)',
    'public.reverse_payment(uuid,date)',
    'public.edit_invoice(uuid,text,text,int,date,text,jsonb,numeric)',
    'public.post_unposted_invoice(uuid,text,date,uuid)',
    'public.generate_recurring_invoices(int,text)',
    'public.patch_extra(text,text,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  foreach f in array array[
    'public.next_document_number(text,int)', 'public.assign_invoice_no()', 'public.assign_receipt_no()',
    'public._invoice_status(numeric,numeric,numeric)', 'public._assert_authenticated()',
    'public._assert_pay_account(text)', 'public._invoice_paid(uuid)',
    'public._apply_invoice_payment(public.invoices,numeric,text,date,boolean,text,uuid)',
    'public._reverse_source(text,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

revoke all on public.account_balances from anon;

select public._mig_log('0009', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0009'
  and at >= (select max(at) from public.migration_log where migration = '0009' and step = '_start')
order by id;
