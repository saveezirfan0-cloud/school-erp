-- Assertion harness + policy matrix. Run against a migrated database (live-sim seed ids).
\set ON_ERROR_STOP off

drop schema if exists t cascade;
create schema t;
create table t.results (grp text, name text, ok boolean, got text, expected text);
grant usage on schema t to public;
grant all on t.results to public;
create table t.ctx (grp text);
insert into t.ctx values ('?');
grant all on t.ctx to public;

create function t.login(u uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'email', (select email from auth.users where id = u))::text, true);
  set local role authenticated;
end $$;
create function t.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $$;
create function t.logout() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function t.grp(g text) returns void language sql as $$ update t.ctx set grp = g $$;

-- expect: 'ok' | 'rows=N' | 'err' | 'err=SQLSTATE'
create function t.chk(nm text, q text, expect text) returns void language plpgsql as $$
declare n bigint; got text; good boolean; g text;
begin
  begin
    execute q; get diagnostics n = row_count; got := 'ok:' || n;
  exception when others then got := 'err:' || sqlstate;
  end;
  good := case
    when expect = 'ok' then got like 'ok:%'
    when expect like 'rows=%' then got = 'ok:' || substr(expect, 6)
    when expect = 'err' then got like 'err:%'
    when expect like 'err=%' then got = 'err:' || substr(expect, 5)
    else false end;
  select grp into g from t.ctx;
  raise notice 'RES|%|%|%|%|%', g, case when good then 'PASS' else 'FAIL' end, nm, got, expect;
end $$;

-- compare a scalar (run as whatever role is current)
create function t.eq(nm text, q text, expect text) returns void language plpgsql as $$
declare got text; g text;
begin
  begin execute q into got; exception when others then got := 'err:' || sqlstate; end;
  select grp into g from t.ctx;
  raise notice 'RES|%|%|%|%|%', g, case when got is not distinct from expect then 'PASS' else 'FAIL' end, nm, got, expect;
end $$;

\echo ===== 1. branch isolation / role matrix (reads)
begin; select t.grp('1 reads');
select t.login('a0000000-0000-0000-0000-000000000005');
select t.chk('CY(branch Gulshan) sees only its invoices', 'select * from public.invoices', 'rows=1');
select t.chk('CY students (no canViewStudents? collector has it) own branch only', 'select * from public.students', 'rows=1');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('CX (branch Baneen) invoices incl. repointed dup-branch invoice', 'select * from public.invoices', 'rows=1');
select t.chk('CX override canViewStudents=false is enforced by DB', 'select * from public.students', 'rows=0');
select t.chk('CX cannot read payments', 'select * from public.payments', 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('MGR students: Baneen only (2, after dedupe repoint)', 'select * from public.students', 'rows=2');
select t.chk('MGR payments scoped to branch (none for Baneen)', 'select * from public.payments', 'rows=0');
select t.chk('MGR cannot read journals', 'select * from public.journals', 'rows=0');
select t.chk('MGR cannot read payslips of other branch? (canViewPayslips, own branch has 1)', 'select * from public.payslips', 'rows=1');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000009');
select t.chk('MAIN collector sees only main-office students', 'select * from public.students', 'rows=2');
select t.chk('MAIN invoices (main office only)', 'select * from public.invoices', 'rows=2');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('ACC sees invoices of all branches', 'select * from public.invoices', 'rows=4');
select t.chk('ACC has no canViewStudents', 'select * from public.students', 'rows=0');
select t.chk('ACC sees whole chart of accounts (6 live)', 'select * from public.accounts where deleted_at is null', 'rows=6');
select t.chk('ACC journals', 'select * from public.journals', 'rows=1');
select t.chk('ACC cannot read audit_log', 'select * from public.audit_log', 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin sees all users', 'select * from public.users', 'rows=8');
select t.chk('admin sees audit_log', 'select * from public.audit_log', 'ok');
select t.chk('admin sees all invoices', 'select * from public.invoices', 'rows=4');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000007');
select t.chk('profile-less user: branches', 'select * from public.branches', 'rows=0');
select t.chk('profile-less user: custom_roles', 'select * from public.custom_roles', 'rows=0');
select t.chk('profile-less user: invoices', 'select * from public.invoices', 'rows=0');
select t.chk('profile-less user: users', 'select * from public.users', 'rows=0');
select t.chk('profile-less user cannot insert audit_log', $q$insert into public.audit_log(action) values ('x')$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000006');
select t.chk('custom role sees only its own custom_roles row', 'select * from public.custom_roles', 'rows=1');
select t.chk('custom role (canManageUsers ignored) sees only itself in users', 'select * from public.users', 'rows=1');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('branches readable by users with a role', 'select * from public.branches', 'rows=3');
select t.logout(); select t.anon();
select t.chk('anon cannot read invoices (no grant)', 'select * from public.invoices', 'err=42501');
select t.chk('anon cannot call has_perm', $q$select public.has_perm('canViewFees')$q$, 'err=42501');
select t.chk('anon cannot call list_pay_accounts', 'select * from public.list_pay_accounts()', 'err=42501');
select t.logout();
rollback;

\echo ===== 2. users: no self-promotion, admin-only role changes, last admin
begin; select t.grp('2 users');
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('MGR cannot promote self', $q$update public.users set role='admin' where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'err=42501');
select t.chk('MGR can rename self', $q$update public.users set name='Manager X2' where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'rows=1');
select t.chk('MGR cannot edit own extra (overrides)', $q$update public.users set extra='{"pagePermissions":{"canEditPayslips":true}}' where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'err=42501');
select t.chk('MGR cannot change own branch', $q$update public.users set branch_id='' where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'err=42501');
select t.chk('MGR cannot change own id', $q$update public.users set id=gen_random_uuid() where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'err');
select t.chk('MGR cannot change own pin', $q$update public.users set pin='9999' where id = 'a0000000-0000-0000-0000-000000000003'$q$, 'err=42501');
select t.chk('MGR cannot touch another user (RLS)', $q$update public.users set name='hacked' where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'rows=0');
select t.chk('MGR cannot insert a user', $q$insert into public.users(id,name,role) values (gen_random_uuid(),'x','admin')$q$, 'err=42501');
select t.chk('MGR cannot delete a user', $q$delete from public.users where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000006');
select t.chk('custom role w/ canManageUsers cannot edit another user', $q$update public.users set role='admin' where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'rows=0');
select t.chk('custom role w/ canManageUsers: has_perm false', $q$select 1 where public.has_perm('canManageUsers')$q$, 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin can set a known role', $q$update public.users set role='accountant' where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'rows=1');
select t.chk('admin cannot set an unknown role', $q$update public.users set role='wizard' where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'err=23514');
select t.chk('admin cannot change a user id', $q$update public.users set id=gen_random_uuid() where id = 'a0000000-0000-0000-0000-000000000004'$q$, 'err=42501');
select t.chk('admin can demote another admin when a 2nd admin remains', $q$update public.users set role='accountant' where id = 'a0000000-0000-0000-0000-000000000008'$q$, 'rows=1');
select t.chk('last admin cannot demote self', $q$update public.users set role='accountant' where id = 'a0000000-0000-0000-0000-000000000001'$q$, 'err=23514');
select t.chk('last admin cannot be deleted', $q$delete from public.users where id = 'a0000000-0000-0000-0000-000000000001'$q$, 'err=23514');
select t.logout();
select t.eq('role default is none', $q$select (select column_default from information_schema.columns where table_name='users' and column_name='role')$q$, '''none''::text');
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin insert user without role -> none', $q$insert into public.users(id,name,email) values ('a0000000-0000-0000-0000-0000000000aa','New','n@x') $q$, 'err');   -- fk auth.users missing is expected
rollback;
begin; select t.grp('2b users');
insert into auth.users(id,email) values ('a0000000-0000-0000-0000-0000000000aa','n@x');
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin insert user without role', $q$insert into public.users(id,name,email) values ('a0000000-0000-0000-0000-0000000000aa','New','n@x') $q$, 'ok');
select t.eq('...gets role none', $q$select role from public.users where id='a0000000-0000-0000-0000-0000000000aa'$q$, 'none');
select t.chk('admin insert user with unknown role', $q$insert into public.users(id,name,email,role) values (gen_random_uuid(),'New','n2@x','nope')$q$, 'err');
select t.logout();
rollback;

\echo ===== 3. custom_roles
begin; select t.grp('3 roles');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector cannot create role', $q$insert into public.custom_roles(permissions) values ('{}')$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin creates role without id (UX-002)', $q$insert into public.custom_roles(permissions, extra) values ('{"canViewFees":true,"canManageUsers":true}', '{"label":"Clerk"}')$q$, 'ok');
select t.eq('canManageUsers stripped from custom role', $q$select count(*)::text from public.custom_roles where id like 'role\_%' and permissions ? 'canManageUsers'$q$, '0');
select t.eq('generated id is role_<hex>', $q$select count(*)::text from public.custom_roles where id ~ '^role_[0-9a-f]{32}$'$q$, '1');
select t.chk('cannot delete a role that is in use', $q$delete from public.custom_roles where id='viewer_role'$q$, 'err=23503');
select t.chk('role id may not equal a built-in name', $q$insert into public.custom_roles(id) values ('admin')$q$, 'err');
select t.logout();
rollback;

\echo ===== 4. delete permissions / trash
begin; select t.grp('4 delete');
select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('ACC cannot trash an invoice (no canDeleteFees)', $q$update public.invoices set deleted_at = now() where id='f0000000-0000-0000-0000-000000000001'$q$, 'err=42501');
select t.chk('ACC cannot hard delete a live payment', $q$delete from public.payments where id='90000000-0000-0000-0000-000000000001'$q$, 'rows=0');
select t.chk('ACC cannot delete journals', $q$delete from public.journals$q$, 'rows=0');
select t.chk('ACC cannot trash a payslip', $q$update public.payslips set deleted_at = now()$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('MGR cannot trash a student (canDeleteStudents false)', $q$update public.students set deleted_at = now() where id='d0000000-0000-0000-0000-000000000001'$q$, 'err=42501');
select t.chk('MGR cannot trash an expense', $q$update public.expenses set deleted_at = now()$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector cannot trash invoice', $q$update public.invoices set deleted_at = now()$q$, 'err=42501');
select t.chk('collector cannot hard delete invoice', $q$delete from public.invoices$q$, 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin cannot hard delete a LIVE invoice (must be in Trash first)', $q$delete from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'rows=0');
select t.chk('admin can trash a pending invoice', $q$update public.invoices set deleted_at = now() where id='f0000000-0000-0000-0000-000000000001'$q$, 'rows=1');
select t.eq('deleted_by is stamped', $q$select (deleted_by = 'a0000000-0000-0000-0000-000000000001')::text from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'true');
select t.chk('admin can hard delete a trashed invoice with no payments', $q$delete from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'rows=1');
select t.chk('trashing legacy invoice with bad data fails on NOT VALID check (documented)', $q$update public.invoices set deleted_at = now() where id='f0000000-0000-0000-0000-000000000003'$q$, 'err=23514');
select t.chk('trash invoice that has live payment is refused (ledger guard)', $q$update public.invoices set deleted_at = now() where id='f0000000-0000-0000-0000-000000000002'$q$, 'err=55000');
select t.chk('admin cannot trash an un-reversed payment', $q$update public.payments set deleted_at = now() where id='90000000-0000-0000-0000-000000000001'$q$, 'err=55000');
select t.logout();
-- explicit flag: ACC gets canDeleteFees through an override written by the admin
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin grants ACC canDeleteFees via override', $q$update public.users set extra = '{"pagePermissions":{"canDeleteFees":true}}' where id = 'a0000000-0000-0000-0000-000000000002'$q$, 'rows=1');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('ACC with canDeleteFees flag may trash a pending invoice', $q$update public.invoices set deleted_at = now() where id='f0000000-0000-0000-0000-000000000004'$q$, 'rows=1');
select t.logout();
-- referential restrict (trashed student that still has invoices)
update public.students set deleted_at = now() where id='d0000000-0000-0000-0000-000000000003';
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('hard delete of referenced student refused', $q$delete from public.students where id='d0000000-0000-0000-0000-000000000003'$q$, 'err=23503');
select t.logout();
rollback;

\echo ===== 5. audit trail
begin; select t.grp('5 audit');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('client can append an audit row', $q$insert into public.audit_log("user", action, module, details, "timestamp") values ('principal@school.test','forged','Fees','x','2001-01-01')$q$, 'ok');
select t.chk('client insert ... RETURNING works for non-admin (shim uses return=representation)', $q$insert into public.audit_log(action) values ('ret') returning *$q$, 'rows=1');
select t.chk('client reads back only its own audit rows', 'select * from public.audit_log', 'rows=2');
select t.chk('client cannot update audit_log', $q$update public.audit_log set action='y'$q$, 'err=42501');
select t.chk('client cannot delete audit_log', $q$delete from public.audit_log$q$, 'err=42501');
select t.logout();
select t.eq('author is stamped from the login, not the client', $q$select "user" from public.audit_log where action='forged'$q$, 'collector.x@school.test');
select t.eq('timestamp is server time', $q$select (extract(year from "timestamp") >= 2024)::text from public.audit_log where action='forged'$q$, 'true');
select t.eq('actor_id stamped', $q$select actor_id::text from public.audit_log where action='forged'$q$, 'a0000000-0000-0000-0000-000000000004');
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin cannot delete audit_log (privilege)', $q$delete from public.audit_log$q$, 'err=42501');
select t.logout();
select t.chk('even the superuser is blocked by the append-only trigger', $q$delete from public.audit_log$q$, 'err=55000');
select t.chk('truncate blocked', $q$truncate public.audit_log$q$, 'err=55000');
-- row_history
select t.login('a0000000-0000-0000-0000-000000000001');
update public.expenses set amount = 250 where id='70000000-0000-0000-0000-000000000001';
update public.users set name = 'Admin Renamed' where id = 'a0000000-0000-0000-0000-000000000001';
select t.logout();
select t.eq('row_history records actor on expenses UPDATE', $q$select actor::text || ':' || array_to_string(changed, ',') from public.row_history where table_name='expenses' and op='UPDATE'$q$, 'a0000000-0000-0000-0000-000000000001:amount');
select t.eq('row_history stores old and new', $q$select (old_row->>'amount') || '>' || (new_row->>'amount') from public.row_history where table_name='expenses' and op='UPDATE'$q$, '200>250');
select t.eq('PIN never copied to history', $q$select count(*)::text from public.row_history where table_name='users' and (old_row ? 'pin' or new_row ? 'pin')$q$, '0');
select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('non-admin cannot read row_history', 'select * from public.row_history', 'rows=0');
select t.chk('non-admin cannot write row_history', $q$insert into public.row_history(table_name,op) values ('x','INSERT')$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin can read row_history', 'select * from public.row_history', 'ok');
select t.chk('admin cannot update row_history', $q$update public.row_history set op='DELETE'$q$, 'err=42501');
select t.logout();
rollback;

\echo ===== 6. accounts for posting, journals, reminder_logs scope
begin; select t.grp('6 accounts/reminders');
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('MGR reads only Bank&Cash/Assets accounts (4 live)', 'select * from public.accounts', 'rows=4');
select t.chk('MGR sees no income accounts', $q$select * from public.accounts where type='Income'$q$, 'rows=0');
select t.chk('MGR cannot insert accounts', $q$insert into public.accounts(name,type) values ('x','Assets')$q$, 'err=42501');
select t.chk('MGR cannot update accounts', $q$update public.accounts set name='z'$q$, 'rows=0');
select t.chk('MGR list_pay_accounts', 'select * from public.list_pay_accounts()', 'rows=4');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector reads cash accounts (4)', 'select * from public.accounts', 'rows=4');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000006');
select t.chk('viewer-only custom role: no accounts', 'select * from public.accounts', 'rows=0');
select t.chk('viewer-only custom role: list_pay_accounts denied', 'select * from public.list_pay_accounts()', 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin chart (6 live)', $q$select * from public.accounts where deleted_at is null$q$, 'rows=6');
select t.logout();
-- reminder_logs
select t.login('a0000000-0000-0000-0000-000000000005');
select t.chk('CY sees reminders of its branch only', 'select * from public.reminder_logs', 'rows=1');
select t.chk('CY cannot update other branch reminder', $q$update public.reminder_logs set message='x' where id='60000000-0000-0000-0000-000000000002'$q$, 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('CX (Baneen) sees none', 'select * from public.reminder_logs', 'rows=0');
select t.chk('CX cannot log a reminder for a main-office student', $q$insert into public.reminder_logs(student_id,phone,message) values ('d0000000-0000-0000-0000-000000000004','1','m')$q$, 'err=42501');
select t.chk('CX can log reminder for own branch student; branch auto-filled', $q$insert into public.reminder_logs(student_id,phone,message) values ('d0000000-0000-0000-0000-000000000002','1','m')$q$, 'ok');
select t.chk('CX cannot hard delete reminder logs', 'delete from public.reminder_logs', 'rows=0');
select t.logout();
select t.eq('trigger filled reminder_logs.branch_id', $q$select branch_id from public.reminder_logs where phone='1'$q$, 'b0000000-0000-0000-0000-00000000000a');
select t.login('a0000000-0000-0000-0000-000000000009');
select t.chk('main office user sees main reminders only', 'select * from public.reminder_logs', 'rows=1');
select t.logout();
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin sees all reminders (2 legacy + 1 inserted above)', 'select * from public.reminder_logs', 'rows=3');
select t.logout();
rollback;

\echo ===== 7. money RPCs
begin; select t.grp('7 rpc');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector pays 2000 on invoice f01', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 2000, 'Cash', '2026-01-15', false, null, '11111111-1111-1111-1111-111111111111')$q$, 'rows=1');
select t.chk('same idempotency key replays, no second payment', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 2000, 'Cash', '2026-01-15', false, null, '11111111-1111-1111-1111-111111111111')$q$, 'rows=1');
select t.logout();
select t.eq('exactly one payment posted', $q$select count(*)::text from public.payments where source='invoice' and source_id='f0000000-0000-0000-0000-000000000001'$q$, '1');
select t.eq('invoice partial 2000', $q$select status || ':' || paid_amount from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'partial:2000');
select t.eq('receipt number assigned', $q$select receipt_no from public.payments where idempotency_key='11111111-1111-1111-1111-111111111111'$q$, 'RCP-' || extract(year from now())::int || '-000001');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('overpay refused', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 3500, 'Cash', current_date, false, null, null)$q$, 'err=23514');
select t.chk('payment into a non-cash account refused', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 100, 'Tuition Income', current_date, false, null, null)$q$, 'err=23503');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('same key on another invoice refused', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000003', 1, 'Cash', current_date, false, null, '11111111-1111-1111-1111-111111111111')$q$, 'err=22023');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector pays the remaining 3000', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 3000, 'Bank', '2026-01-16', false, null, '22222222-2222-2222-2222-222222222222')$q$, 'rows=1');
select t.logout();
select t.eq('invoice fully paid', $q$select status || ':' || paid_amount from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'paid:5000');
select t.eq('receipt numbers are sequential', $q$select string_agg(right(receipt_no,6), ',' order by receipt_no) from public.payments where source='invoice' and source_id='f0000000-0000-0000-0000-000000000001'$q$, '000001,000002');
select t.login('a0000000-0000-0000-0000-000000000005');
select t.chk('collector of ANOTHER branch cannot pay it', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 1, 'Cash', current_date, false, null, null)$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000007');
select t.chk('profile-less user cannot call RPC', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 1, 'Cash', current_date, false, null, null)$q$, 'err=42501');
select t.logout(); select t.anon();
select t.chk('anon cannot call RPC (no EXECUTE)', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 1, 'Cash', current_date, false, null, null)$q$, 'err=42501');
select t.logout();
-- concession
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('part payment + concession closes the invoice', $q$select public.record_invoice_payment('f0000000-0000-0000-0000-000000000001', 0, 'Cash', current_date, true, 'waived', null)$q$, 'rows=1');  -- already paid: no-op
select t.chk('post_invoice for Ali with immediate payment', $q$select public.post_invoice('d0000000-0000-0000-0000-000000000001', 4000, 'February', 2026, '2026-02-10', null, 'n', 'Cash', '2026-02-01', '33333333-3333-3333-3333-333333333333')$q$, 'rows=1');
select t.chk('post_invoice replay returns the same invoice', $q$select public.post_invoice('d0000000-0000-0000-0000-000000000001', 4000, 'February', 2026, '2026-02-10', null, 'n', 'Cash', '2026-02-01', '33333333-3333-3333-3333-333333333333')$q$, 'rows=1');
select t.chk('post_invoice for a student of another branch refused', $q$select public.post_invoice('d0000000-0000-0000-0000-000000000003', 100, 'February', 2026)$q$, 'err=42501');
select t.logout();
select t.eq('replay did not create a second invoice', $q$select count(*)::text from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, '1');
select t.eq('that invoice is paid and numbered', $q$select status || ':' || (invoice_no like 'INV-%')::text from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'paid:true');
select t.eq('student name copied to extra', $q$select extra->>'studentName' from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'Ali');
-- payslip
select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('pay payslip', $q$select public.pay_payslip('80000000-0000-0000-0000-000000000001', 'Bank', '2026-02-01', '44444444-4444-4444-4444-444444444444')$q$, 'rows=1');
select t.chk('pay payslip twice (double click)', $q$select public.pay_payslip('80000000-0000-0000-0000-000000000001', 'Bank', '2026-02-01', '55555555-5555-5555-5555-555555555555')$q$, 'rows=1');
select t.logout();
select t.eq('only one salary payment', $q$select count(*)::text from public.payments where source='payslip'$q$, '1');
select t.eq('salary amount from extra.netPay', $q$select amount::text from public.payments where source='payslip'$q$, '25000');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector cannot pay payslips', $q$select public.pay_payslip('80000000-0000-0000-0000-000000000001', 'Bank')$q$, 'err=42501');
select t.logout();
-- expense + transfer
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('pay expense', $q$select public.pay_expense('70000000-0000-0000-0000-000000000001', 'Cash', '2026-02-02', null)$q$, 'rows=1');
select t.chk('pay expense again is a no-op', $q$select public.pay_expense('70000000-0000-0000-0000-000000000001', 'Cash', '2026-02-02', null)$q$, 'rows=1');
select t.chk('MGR cannot transfer funds', $q$select public.transfer_funds('Cash','Bank',10)$q$, 'err=42501');
select t.logout();
select t.eq('expense posted once', $q$select count(*)::text from public.payments where source='expense'$q$, '1');
select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('transfer funds', $q$select public.transfer_funds('Cash','Bank',500,'2026-02-03','move', '66666666-6666-6666-6666-666666666666')$q$, 'rows=1');
select t.chk('transfer replay', $q$select public.transfer_funds('Cash','Bank',500,'2026-02-03','move', '66666666-6666-6666-6666-666666666666')$q$, 'rows=1');
select t.chk('transfer to same account refused', $q$select public.transfer_funds('Cash','Cash',5)$q$, 'err=22023');
select t.chk('ACC reads account_balances', 'select * from public.account_balances', 'rows=6');
select t.logout();
select t.eq('transfer = two legs, once', $q$select count(*)::text from public.payments where source='transfer'$q$, '2');
select t.eq('balance Cash = 100 +4000 -5 +2000 +4000 -200 -500', $q$select balance::text from public.account_balances where name='Cash'$q$, '9395');
-- reversal + trash/restore
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('reverse invoice payments', $q$select public.reverse_source_payments('invoice','f0000000-0000-0000-0000-000000000001')$q$, 'rows=1');
select t.chk('reverse again: nothing left (idempotent)', $q$select public.reverse_source_payments('invoice','f0000000-0000-0000-0000-000000000001')$q$, 'rows=1');
select t.logout();
select t.eq('reversal rows exist, invoice reset', $q$select status || ':' || paid_amount from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'pending:0');
select t.eq('2 originals marked reversed + 2 reversal rows', $q$select (select count(*) from public.payments where source='invoice' and source_id='f0000000-0000-0000-0000-000000000001' and reversed)::text || ':' || (select count(*) from public.payments where source='invoice' and source_id='f0000000-0000-0000-0000-000000000001' and reversal_of is not null)::text$q$, '2:2');
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('trash_invoice (Ali Feb invoice)', $q$select public.trash_invoice(id) from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'rows=1');
select t.logout();
select t.eq('trashed with payments reversed', $q$select (deleted_at is not null)::text || ':' || status || ':' || paid_amount from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'true:pending:0');
select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('restore_invoice', $q$select public.restore_invoice(id) from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'rows=1');
select t.logout();
select t.eq('restored unpaid (ledger says 0)', $q$select (deleted_at is null)::text || ':' || status || ':' || paid_amount from public.invoices where idempotency_key='33333333-3333-3333-3333-333333333333'$q$, 'true:pending:0');
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('MGR cannot trash_invoice (no canDeleteFees)', $q$select public.trash_invoice('f0000000-0000-0000-0000-000000000003')$q$, 'err=42501');
-- recurring
select t.chk('generate recurring (Baneen: Ali has Jan only in extra, Sara none)', $q$select public.generate_recurring_invoices(2026, 'March')$q$, 'rows=1');
select t.logout();
select t.eq('recurring created for the 2 Baneen students', $q$select count(*)::text from public.invoices where extra->>'month'='March' and extra->>'kind'='recurring'$q$, '2');
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('recurring again creates nothing', $q$select public.generate_recurring_invoices(2026, 'March')$q$, 'rows=1');
select t.logout();
select t.eq('still 2 March invoices', $q$select count(*)::text from public.invoices where extra->>'month'='March'$q$, '2');
select t.login('a0000000-0000-0000-0000-000000000003');
select t.chk('patch_extra merges', $q$select public.patch_extra('invoices','f0000000-0000-0000-0000-000000000001','{"note":"hi"}')$q$, 'rows=1');
select t.chk('patch_extra refuses users', $q$select public.patch_extra('users','a0000000-0000-0000-0000-000000000003','{"x":1}')$q$, 'err=42501');
select t.logout();
select t.eq('patch kept other keys', $q$select (extra->>'studentName') || ':' || (extra->>'note') from public.invoices where id='f0000000-0000-0000-0000-000000000001'$q$, 'Ali:hi');
rollback;

\echo ===== 8. ledger guards (0010)
begin; select t.grp('8 ledger');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('collector cannot mark invoice paid by hand', $q$update public.invoices set status='paid', paid_amount=5000 where id='f0000000-0000-0000-0000-000000000001'$q$, 'err=55000');
select t.chk('collector cannot insert a pre-paid invoice (QuickPayment path)', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000a',10,'paid')$q$, 'err=55000');
select t.chk('collector can create a pending invoice', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000a',10,'pending')$q$, 'ok');
select t.chk('collector cannot insert for another branch', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-00000000000c',10,'pending')$q$, 'err=42501');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000002');
select t.chk('payment amount immutable', $q$update public.payments set amount=1 where id='90000000-0000-0000-0000-000000000001'$q$, 'err=55000');
select t.chk('payment account immutable', $q$update public.payments set account='Bank' where id='90000000-0000-0000-0000-000000000001'$q$, 'err=55000');
select t.chk('payment description editable', $q$update public.payments set description='note' where id='90000000-0000-0000-0000-000000000001'$q$, 'rows=1');
select t.chk('cannot flag reversed without a reversal', $q$update public.payments set reversed=true where id='90000000-0000-0000-0000-000000000001'$q$, 'err=55000');
select t.chk('payment insert (cash_in) with unknown account refused', $q$insert into public.payments(type,account,amount,date) values ('cash_in','Nope',5,'2026-01-01')$q$, 'err=23503');
select t.chk('payment insert negative amount refused', $q$insert into public.payments(type,account,amount,date) values ('cash_in','Cash',-5,'2026-01-01')$q$, 'err=23514');
select t.chk('payment insert bad type refused', $q$insert into public.payments(type,account,amount,date) values ('transfer','Cash',5,'2026-01-01')$q$, 'err=23514');
select t.chk('payment insert bad date refused', $q$insert into public.payments(type,account,amount,date) values ('cash_in','Cash',5,'01/02/2026')$q$, 'err=23514');
select t.chk('payment insert ok', $q$insert into public.payments(type,account,amount,date,branch_id) values ('cash_in','Cash',5,'2026-01-01','')$q$, 'ok');
select t.chk('invoice with unknown student refused', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('11111111-0000-0000-0000-000000000000','',10,'pending')$q$, 'err=23503');
select t.chk('invoice with unknown branch refused', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000004','b9999999-0000-0000-0000-000000000000',10,'pending')$q$, 'err=23503');
select t.chk('invoice bad status refused', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000004','',10,'weird')$q$, 'err=23514');
select t.chk('invoice negative amount refused', $q$insert into public.invoices(student_id,branch_id,amount,status) values ('d0000000-0000-0000-0000-000000000004','',-1,'pending')$q$, 'err=23514');
select t.logout();
rollback;

\echo ===== 9. storage receipts
begin; select t.grp('9 storage');
select t.login('a0000000-0000-0000-0000-000000000004');
select t.chk('upload into own branch folder', $q$insert into storage.objects(bucket_id,name) values ('receipts','b0000000-0000-0000-0000-00000000000a/abc.jpg')$q$, 'ok');
select t.chk('upload at bucket root refused', $q$insert into storage.objects(bucket_id,name) values ('receipts','abc.jpg')$q$, 'err=42501');
select t.chk('upload into another branch folder refused', $q$insert into storage.objects(bucket_id,name) values ('receipts','b0000000-0000-0000-0000-00000000000c/abc.jpg')$q$, 'err=42501');
select t.chk('upload .exe refused', $q$insert into storage.objects(bucket_id,name) values ('receipts','b0000000-0000-0000-0000-00000000000a/a.exe')$q$, 'err=42501');
select t.chk('nested path refused', $q$insert into storage.objects(bucket_id,name) values ('receipts','b0000000-0000-0000-0000-00000000000a/x/a.png')$q$, 'err=42501');
select t.chk('collector can read own branch receipt', 'select * from storage.objects', 'rows=1');
select t.chk('collector cannot delete', 'delete from storage.objects', 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000009');
select t.chk('main-office user uploads to main/', $q$insert into storage.objects(bucket_id,name) values ('receipts','main/m.pdf')$q$, 'ok');
select t.chk('main-office user cannot read branch receipts', $q$select * from storage.objects where name like 'b0000000%'$q$, 'rows=0');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000001');
select t.chk('admin can delete', 'delete from storage.objects', 'rows=2');
select t.logout(); select t.login('a0000000-0000-0000-0000-000000000007');
select t.chk('stranger cannot upload', $q$insert into storage.objects(bucket_id,name) values ('receipts','main/z.jpg')$q$, 'err=42501');
select t.logout(); select t.anon();
select t.chk('anon cannot upload', $q$insert into storage.objects(bucket_id,name) values ('receipts','main/z.jpg')$q$, 'err=42501');
select t.logout();
select t.eq('bucket size limit set', $q$select file_size_limit::text from storage.buckets where id='receipts'$q$, '5242880');
rollback;

\echo ===== 10. structural assertions
begin; select t.grp('10 structure');
select t.eq('no open policy on public tables', $q$select count(*)::text from pg_policies where schemaname='public' and (qual='true' or with_check='true' or policyname='auth all')$q$, '0');
select t.eq('anon has no table privileges', $q$select count(*)::text from information_schema.role_table_grants where grantee='anon' and table_schema='public'$q$, '0');
select t.eq('users not in realtime publication', $q$select count(*)::text from pg_publication_tables where pubname='supabase_realtime' and tablename in ('users','audit_log')$q$, '0');
select t.eq('no REPLICA IDENTITY FULL', $q$select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relreplident='f'$q$, '0');
select t.eq('invoice_no unique index exists', $q$select count(*)::text from pg_indexes where indexname='invoices_invoice_no_uq'$q$, '1');
select t.eq('has_perm not executable by anon', $q$select has_function_privilege('anon','public.has_perm(text)','execute')::text$q$, 'false');
select t.eq('has_perm executable by authenticated', $q$select has_function_privilege('authenticated','public.has_perm(text)','execute')::text$q$, 'true');
select t.eq('record_invoice_payment not executable by anon', $q$select has_function_privilege('anon','public.record_invoice_payment(uuid,numeric,text,date,boolean,text,uuid)','execute')::text$q$, 'false');
select t.eq('internal _apply_invoice_payment not executable by authenticated', $q$select has_function_privilege('authenticated','public._apply_invoice_payment(public.invoices,numeric,text,date,boolean,text,uuid)','execute')::text$q$, 'false');
select t.eq('document_counters unreadable by authenticated', $q$select has_table_privilege('authenticated','public.document_counters','select')::text$q$, 'false');
select t.eq('migration_log unreadable by authenticated', $q$select has_table_privilege('authenticated','public.migration_log','select')::text$q$, 'false');
select t.eq('security.sql refuses to re-run (guard present)', $q$select (to_regclass('public.migration_log') is not null)::text$q$, 'true');
rollback;

