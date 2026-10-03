-- Data shapes introduced by main (teacher role, LMS, attendance, left students, staged historical import).
-- Loaded AFTER seed_legacy.sql and BEFORE the migrations (existing-database scenario).
-- Everything new lives in its own branch "Newtown" (b..d) or in the LMS tables so the older assertions keep their counts.
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-00000000000a','teacher.baneen@school.test'),
 ('a0000000-0000-0000-0000-00000000000b','teacher.gulshan@school.test');

insert into public.branches (id, name, created_at) values ('b0000000-0000-0000-0000-00000000000d','Newtown','2024-03-01');

insert into public.users (id, uid, name, email, role, branch_id) values
 ('a0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Teacher Baneen','teacher.baneen@school.test','teacher','b0000000-0000-0000-0000-00000000000a'),
 ('a0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000b','Teacher Gulshan','teacher.gulshan@school.test','teacher','b0000000-0000-0000-0000-00000000000c');

-- a student who left (status lives in extra, written by utils/studentStatus.js) and numeric blanks stored as NULL
insert into public.students (id, name, student_id, grade, branch_id, monthly_fee, recurring_fee, extra) values
 ('d0000000-0000-0000-0000-000000000006','Left kid','S-6','3','b0000000-0000-0000-0000-00000000000d',null,false,'{"status":"left","leftDate":"2026-09-30"}');
insert into public.expenses (id, description, category, amount, date, branch_id) values
 ('70000000-0000-0000-0000-000000000002','blank amount legacy','x',null,'2026-01-01','b0000000-0000-0000-0000-00000000000d');

-- staged historical import (Manager.io): deleted_at set + extra.staged, reusing an existing admission code S-3
insert into public.students (id, name, student_id, grade, branch_id, monthly_fee, recurring_fee, extra, deleted_at) values
 ('d0000000-0000-0000-0000-000000000007','Historic kid','S-3',null,'b0000000-0000-0000-0000-00000000000d',1500,false,
  '{"historical":true,"source":"manager.io","status":"inactive","staged":true}', now());
insert into public.invoices (id, student_id, branch_id, amount, status, date, paid_amount, paid_account, paid_date, concession_amount, extra, deleted_at) values
 ('f0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-00000000000d',1500,'paid','2023-05-01',1500,'Cash','2023-05-03',0,
  '{"historical":true,"source":"manager.io","staged":true,"month":"May","year":2023}', now());
insert into public.payments (id, type, account, amount, date, category, source, source_id, branch_id, reversed, extra, deleted_at) values
 ('90000000-0000-0000-0000-000000000004','cash_in','Cash',1500,'2023-05-03','Fee Collection','invoice','f0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-00000000000d',false,
  '{"historical":true,"source":"manager.io","staged":true,"importBatchId":"x"}', now());
-- imported ledger row whose account does not exist in the chart (DBA import; not reference-checked)
insert into public.payments (id, type, account, amount, date, category, source, branch_id, extra) values
 ('90000000-0000-0000-0000-000000000005','cash_out','Imported Bank',10,'2023-06-01','Rent',null,'b0000000-0000-0000-0000-00000000000d','{"historical":true,"importBatch":"xlsx-2026-10-03-hist"}');

-- LMS + attendance
insert into public.subjects (id, name, code, grade, branch_id) values
 ('11000000-0000-0000-0000-000000000001','Maths','M1','5','b0000000-0000-0000-0000-00000000000a'),
 ('11000000-0000-0000-0000-000000000002','Maths G','M1','5','b0000000-0000-0000-0000-00000000000c');
insert into public.exams (id, name, grade, total_marks, branch_id) values
 ('12000000-0000-0000-0000-000000000001','Mid-term','5',100,'b0000000-0000-0000-0000-00000000000a'),
 ('12000000-0000-0000-0000-000000000002','Mid-term G','5',100,'b0000000-0000-0000-0000-00000000000c');
insert into public.exam_results (id, exam_id, student_id, subject_id, marks_obtained, max_marks, branch_id) values
 ('13000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',70,100,'b0000000-0000-0000-0000-00000000000a'),
 ('13000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002',80,100,'b0000000-0000-0000-0000-00000000000c');
insert into public.assignments (id, title, subject_id, grade, branch_id) values
 ('14000000-0000-0000-0000-000000000001','HW1','11000000-0000-0000-0000-000000000001','5','b0000000-0000-0000-0000-00000000000a');
insert into public.submissions (id, assignment_id, student_id, status, branch_id) values
 ('15000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','pending','b0000000-0000-0000-0000-00000000000a');
insert into public.materials (id, title, kind, grade, branch_id) values
 ('16000000-0000-0000-0000-000000000001','Notes','note','5','b0000000-0000-0000-0000-00000000000a');
insert into public.attendance (id, subject_type, subject_id, date, status, branch_id) values
 ('17000000-0000-0000-0000-000000000001','student','d0000000-0000-0000-0000-000000000001','2026-09-01','present','b0000000-0000-0000-0000-00000000000a'),
 ('17000000-0000-0000-0000-000000000002','student','d0000000-0000-0000-0000-000000000003','2026-09-01','absent','b0000000-0000-0000-0000-00000000000c'),
 ('17000000-0000-0000-0000-000000000003','employee','e0000000-0000-0000-0000-000000000001','2026-09-01','present','b0000000-0000-0000-0000-00000000000a');
