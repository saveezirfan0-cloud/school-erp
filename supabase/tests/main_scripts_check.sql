-- Runs main's own operational scripts AFTER the migrations (as a DBA in the SQL editor),
-- cleans the legacy data the way the README says, re-runs 0005 / 0013 / 0020 and asserts.
-- Expects the variables  :supa  (path of supabase/) and  :scripts  (path of scripts/).
\set ON_ERROR_STOP off
create or replace function pg_temp.chk(nm text, q text, expect text) returns void language plpgsql as $f$
declare got text;
begin
  begin execute q into got; exception when others then got := 'err:' || sqlstate; end;
  raise notice 'RES|post|%|%|%|%', case when got is not distinct from expect then 'PASS' else 'FAIL' end, nm, got, expect;
end $f$;

\echo --- 1. historical import scripts
\i :scripts/activate_historical_import.sql
select pg_temp.chk('activation ran: staged student is live', $q$select (deleted_at is null)::text from public.students where id='d0000000-0000-0000-0000-000000000007'$q$, 'true');
select pg_temp.chk('activation ran: staged invoice live and still historical', $q$select (deleted_at is null)::text || ':' || (extra->>'historical') from public.invoices where id='f0000000-0000-0000-0000-000000000005'$q$, 'true:true');
select pg_temp.chk('imported history has no invoice number', $q$select coalesce(invoice_no,'none') from public.invoices where id='f0000000-0000-0000-0000-000000000005'$q$, 'none');
select pg_temp.chk('activation is recorded in row_history (actor NULL = DBA)', $q$select (count(*) > 0)::text from public.row_history where table_name='payments' and row_id='90000000-0000-0000-0000-000000000004' and actor is null$q$, 'true');
insert into public.invoices (id, student_id, branch_id, amount, status, extra)
values ('f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-00000000000d',9,'pending','{"historical":true,"source":"manager.io"}');
select pg_temp.chk('new imported historical invoice (DBA, student already exists) gets no number', $q$select coalesce(invoice_no,'none') from public.invoices where id='f0000000-0000-0000-0000-0000000000a1'$q$, 'none');
insert into public.payments (id, type, account, amount, date, source, source_id, branch_id, extra)
values ('90000000-0000-0000-0000-0000000000a1','cash_in','Cash',9,'2023-05-04','invoice','f0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-00000000000d','{"historical":true}');
select pg_temp.chk('imported historical receipt gets no receipt number', $q$select coalesce(receipt_no,'none') from public.payments where id='90000000-0000-0000-0000-0000000000a1'$q$, 'none');
insert into public.payments (id, type, account, amount, date, source, source_id, branch_id)
values ('90000000-0000-0000-0000-0000000000a2','cash_in','Cash',9,'2026-05-04','invoice','f0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-00000000000d');
select pg_temp.chk('a normal receipt does', $q$select (receipt_no is not null)::text from public.payments where id='90000000-0000-0000-0000-0000000000a2'$q$, 'true');
select pg_temp.chk('imported ledger rows for accounts not in the chart are accepted from the editor', $q$select count(*)::text from public.payments where account='Imported Bank'$q$, '1');
\i :supa/rollback_workbook_import.sql
select pg_temp.chk('rollback_workbook_import.sql removed the batch', $q$select count(*)::text from public.payments where extra->>'importBatch' like 'xlsx-2026-10-03-%'$q$, '0');

\echo --- 2. fix_invoice_branch.sql and the chart seed
update public.students set branch_id = 'b0000000-0000-0000-0000-00000000000c' where id = 'd0000000-0000-0000-0000-000000000001';
\i :supa/fix_invoice_branch.sql
select pg_temp.chk('fix_invoice_branch moved the invoice to the student branch', $q$select branch_id from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'b0000000-0000-0000-0000-00000000000c');
select count(*) as accounts_before from public.accounts where deleted_at is null \gset
\i :supa/seed_chart_of_accounts.sql
select pg_temp.chk('chart seed inserted accounts without hitting the unique keys', $q$select (count(*) > 60)::text from public.accounts where deleted_at is null$q$, 'true');
\i :supa/seed_chart_of_accounts.sql
select pg_temp.chk('chart seed is re-runnable (same count)', $q$select (count(*) = (select count(*) from public.accounts where deleted_at is null))::text from public.accounts where deleted_at is null$q$, 'true');

\echo --- 3. main's lms.sql / attendance.sql re-run on top of the migrations
\i :supa/lms.sql
select pg_temp.chk('lms.sql re-run left the hardened has_perm in place', $q$select (pg_get_functiondef('public.has_perm(text)'::regprocedure) like '%pagePermissions%')::text$q$, 'true');
select pg_temp.chk('...it re-created its own simple policies (4 per table)', $q$select count(*)::text from pg_policies where schemaname='public' and tablename='exams'$q$, '4');
\i :supa/migrations/0013_academic_tables.sql
select pg_temp.chk('0013 re-run restores the once-per-statement form', $q$select count(*)::text from pg_policies where schemaname='public' and tablename='exams' and cmd='SELECT' and qual like '%SELECT has_perm%'$q$, '1');
select pg_temp.chk('...and the default replica identity', $q$select relreplident::text from pg_class where oid='public.exams'::regclass$q$, 'd');

\echo --- 4. cleanup the legacy data, re-run 0005 and 0020
update public.students set student_id = 'S-2' where id = 'd0000000-0000-0000-0000-000000000002';
update public.expenses set amount = 1 where amount is null;
update public.payments set amount = 5 where amount <= 0;
update public.accounts set deleted_at = now() where id = 'c0000000-0000-0000-0000-000000000005';
update public.accounts set code = '4002' where id = 'c0000000-0000-0000-0000-000000000007';
-- one statement: a row that breaks two NOT VALID checks cannot be fixed one rule at a time
update public.invoices set due_date = '2026-01-10', paid_amount = 3000 where id = 'f0000000-0000-0000-0000-000000000003';
\i :supa/migrations/0005_columns_defaults_constraints.sql
\i :supa/migrations/0020_validate_constraints.sql
select pg_temp.chk('no constraint is left NOT VALID', $q$select count(*)::text from pg_constraint where connamespace='public'::regnamespace and contype='c' and not convalidated$q$, '0');
select pg_temp.chk('expenses.amount is NOT NULL after cleanup', $q$select is_nullable from information_schema.columns where table_name='expenses' and column_name='amount'$q$, 'NO');
select pg_temp.chk('admission-number key exists after cleanup', $q$select count(*)::text from pg_indexes where indexname='students_admission_no_live_uq'$q$, '1');
select pg_temp.chk('a second live student with an existing admission number is refused', $q$insert into public.students(id, name, student_id, branch_id) values ('d0000000-0000-0000-0000-0000000000f1','Dup of Omar','S-3','b0000000-0000-0000-0000-00000000000c') returning 'x'$q$, 'err:23505');
select pg_temp.chk('an imported historical student may reuse an old admission number', $q$insert into public.students(id, name, student_id, branch_id, extra) values ('d0000000-0000-0000-0000-0000000000f2','Hist dup','S-3','b0000000-0000-0000-0000-00000000000d','{"historical":true}') returning 'x'$q$, 'x');
select pg_temp.chk('blank expense amount is now refused', $q$insert into public.expenses(description,category,amount,date,branch_id) values ('x','y',null,'2026-01-01','') returning 'x'$q$, 'err:23502');
