-- Legacy-looking data, written by the superuser BEFORE the migrations (as the old app would have).
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-000000000001','admin@school.test'),
 ('a0000000-0000-0000-0000-000000000002','accountant@school.test'),
 ('a0000000-0000-0000-0000-000000000003','manager.x@school.test'),
 ('a0000000-0000-0000-0000-000000000004','collector.x@school.test'),
 ('a0000000-0000-0000-0000-000000000005','collector.y@school.test'),
 ('a0000000-0000-0000-0000-000000000006','custom@school.test'),
 ('a0000000-0000-0000-0000-000000000007','stranger@school.test'),
 ('a0000000-0000-0000-0000-000000000008','admin2@school.test'),
 ('a0000000-0000-0000-0000-000000000009','main.collector@school.test');

insert into public.branches (id, name, created_at) values
 ('b0000000-0000-0000-0000-00000000000a','Baneen','2024-01-01'),
 ('b0000000-0000-0000-0000-00000000000b','Baneen ','2024-02-01'),     -- duplicate (case/space)
 ('b0000000-0000-0000-0000-00000000000c','Gulshan','2024-01-01');

insert into public.custom_roles (id, permissions) values
 ('viewer_role','{"canViewStudents":true,"canManageUsers":true,"canViewFees":true}');

insert into public.users (id, uid, name, email, role, branch_id, pin, extra) values
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Admin','admin@school.test','admin',null,'1234','{}'),
 ('a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','Acct','accountant@school.test','accountant',null,null,'{}'),
 ('a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003','Mgr X','manager.x@school.test','branch_manager','b0000000-0000-0000-0000-00000000000b',null,'{}'),  -- on the DUPLICATE branch
 ('a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004','Coll X','collector.x@school.test','fee_collector','b0000000-0000-0000-0000-00000000000a',null,'{"pagePermissions":{"canViewStudents":false}}'),
 ('a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000005','Coll Y','collector.y@school.test','fee_collector','b0000000-0000-0000-0000-00000000000c',null,'{}'),
 ('a0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000006','Custom','custom@school.test','viewer_role',null,null,'{}'),
 ('a0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000008','Admin2','admin2@school.test','admin',null,null,'{}'),
 ('a0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000009','Main coll','main.collector@school.test','fee_collector','main',null,'{}');
-- 007 stranger: no profile row at all.

insert into public.accounts (id, code, name, type, sub_type, balance, created_at) values
 ('c0000000-0000-0000-0000-000000000001','1001','Cash','Assets','Bank & Cash',100,'2024-01-01'),
 ('c0000000-0000-0000-0000-000000000002','1001','Cash','Assets','Bank & Cash',100,'2024-03-01'),   -- exact duplicate, same balance: mergeable
 ('c0000000-0000-0000-0000-000000000003','1002','Bank','Assets','Bank & Cash',0,'2024-01-01'),
 ('c0000000-0000-0000-0000-000000000004','1100','Petty','Assets','Bank & Cash',50,'2024-01-01'),
 ('c0000000-0000-0000-0000-000000000005','1101','petty','Assets','Bank & Cash',70,'2024-01-02'),   -- dup name, different balance: manual review
 ('c0000000-0000-0000-0000-000000000006','4001','Tuition Income','Income','Fee Income',0,'2024-01-01'),
 ('c0000000-0000-0000-0000-000000000007','4001','Other Income','Income','Other Income',0,'2024-01-01'); -- same code, different name

insert into public.students (id, name, student_id, branch_id, monthly_fee, recurring_fee) values
 ('d0000000-0000-0000-0000-000000000001','Ali','S-1','b0000000-0000-0000-0000-00000000000b',5000,true),      -- on dup branch
 ('d0000000-0000-0000-0000-000000000002','Sara','S-1','b0000000-0000-0000-0000-00000000000a',5000,true),      -- duplicate admission no
 ('d0000000-0000-0000-0000-000000000003','Omar','S-3','b0000000-0000-0000-0000-00000000000c',4000,true),
 ('d0000000-0000-0000-0000-000000000004','Main kid','S-4','',3000,true),
 ('d0000000-0000-0000-0000-000000000005','Main kid 2','S-5',null,3000,false);

insert into public.employees (id, name, branch_id, extra) values
 ('e0000000-0000-0000-0000-000000000001','Teacher','b0000000-0000-0000-0000-00000000000a','{"salary":"25000"}');

insert into public.invoices (id, student_id, branch_id, amount, status, due_date, paid_amount, extra) values
 ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b',5000,'pending','2026-01-10',0,'{"studentName":"Ali","month":"January","year":2026}'),
 ('f0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-00000000000c',4000,'paid','2026-01-10',4000,'{"studentName":"Omar","month":"January","year":2026}'),
 ('f0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004','',3000,'pending','not a date',9000,'{"studentName":"Main kid","month":"January","year":"2026"}'),  -- overpaid + bad date
 ('f0000000-0000-0000-0000-000000000004','99999999-9999-9999-9999-999999999999','',100,'pending',null,0,'{"studentName":"Ghost"}');  -- orphan student

insert into public.payments (id, type, account, amount, date, category, source, source_id, branch_id, reversed) values
 ('90000000-0000-0000-0000-000000000001','cash_in','Cash',4000,'2026-01-11','Fee Collection','invoice','f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000c',false),
 ('90000000-0000-0000-0000-000000000002','cash_in','Cash',-5,'2026-01-11','Oops',null,null,'',false),            -- negative amount
 ('90000000-0000-0000-0000-000000000003','cash_in','Ghost Account',10,'2026-01-11','x',null,null,'',false);     -- orphan account name

insert into public.payslips (id, employee_id, branch_id, month, status, extra) values
 ('80000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a','January','pending','{"employeeName":"Teacher","year":2026,"netPay":"25000"}');

insert into public.expenses (id, description, category, amount, date, branch_id) values
 ('70000000-0000-0000-0000-000000000001','Chalk','Supplies',200,'2026-01-12','b0000000-0000-0000-0000-00000000000a');

insert into public.reminder_logs (id, student_id, phone, message) values
 ('60000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','0300','late'),
 ('60000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000004','0301','late');

insert into public.journals (id, date, debit_account, credit_account, amount) values
 ('50000000-0000-0000-0000-000000000001','2026-01-12','Cash','Bank',10);

insert into public.audit_log ("user", action, module, details) values ('someone', 'created', 'Fees', 'legacy row');
