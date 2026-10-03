-- ============================================================
-- 0013  LMS / academics and attendance tables (supabase/lms.sql, attendance.sql)
-- ------------------------------------------------------------
-- Tables: attendance, subjects, exams, exam_results, assignments, submissions, materials.
-- Depends on : 0001, 0002 (has_perm knows the teacher role and the academic
--              permissions), 0003, 0006 (reference triggers), 0008 (row_history)
-- Idempotent : yes. Every table is optional: if it does not exist (attendance.sql /
--              lms.sql not run yet) its steps are logged 'skipped' and nothing fails.
--              Run this file again after running lms.sql or attendance.sql later.
-- Data change: none.
-- App impact : permissions are UNCHANGED (same semantics as lms.sql / attendance.sql):
--                subjects, assignments, submissions, materials  view canViewLearning, write canEditLearning
--                exams, exam_results                            view canViewExams,    write canEditExams
--                attendance (student rows) view canViewStudents OR canViewAttendance,
--                                          write canEditStudents OR canEditAttendance
--                attendance (employee rows) canViewEmployees / canEditEmployees
--              all branch-scoped (a teacher sees and writes only the branch they are
--              assigned to; there is no class-level scoping in the database, `grade`
--              is only a filter). What changes: policies are re-created in the
--              once-per-statement form (DB-6), anon gets no privileges, references are
--              checked (a mark needs an existing exam, subject and student), a few
--              value CHECKs are added NOT VALID, exams/marks changes are recorded in
--              row_history, and Realtime uses the default replica identity.
-- Rollback   : policies: re-run supabase/lms.sql (its has_perm part is skipped once
--              migrations exist) to get the original policy set back;
--              triggers: drop trigger trg_ref_* / trg_restrict_* / trg_<t>_history on the table;
--              checks: alter table ... drop constraint ...;
--              alter table public.<t> replica identity full;
-- Note       : re-running lms.sql after this file puts back its (slower but equivalent)
--              policies and REPLICA IDENTITY FULL; re-run this file afterwards.
-- ============================================================
begin;
select public._mig_log('0013', '_start', 'info');

do $$
declare
  t text;
  p record;
  scope constant text :=
    $s$((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))$s$;
  spec text[];
  r record;
begin
  -- ---------- which tables exist ----------
  foreach t in array array['attendance','subjects','exams','exam_results','assignments','submissions','materials'] loop
    if to_regclass('public.' || t) is null then
      perform public._mig_log('0013', 'table_' || t, 'skipped', 'table does not exist (run supabase/attendance.sql / lms.sql, then re-run 0013)');
    end if;
  end loop;

  -- ---------- policies: inventory, drop, re-create (same semantics, wrapped helpers) ----------
  foreach t in array array['attendance','subjects','exams','exam_results','assignments','submissions','materials'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname, cmd, roles::text as roles, qual, with_check
               from pg_policies where schemaname = 'public' and tablename = t loop
      perform public._mig_log('0013', 'policy_before_' || t || '.' || p.policyname, 'info',
        format('cmd=%s roles=%s using=%s with_check=%s', p.cmd, p.roles, coalesce(p.qual,'-'), coalesce(p.with_check,'-')));
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('alter table public.%I replica identity default', t);
  end loop;

  foreach spec slice 1 in array array[
    array['subjects',     'canViewLearning', 'canEditLearning'],
    array['assignments',  'canViewLearning', 'canEditLearning'],
    array['submissions',  'canViewLearning', 'canEditLearning'],
    array['materials',    'canViewLearning', 'canEditLearning'],
    array['exams',        'canViewExams',    'canEditExams'],
    array['exam_results', 'canViewExams',    'canEditExams']
  ] loop
    continue when to_regclass('public.' || spec[1]) is null;
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select public.has_perm(%2$L)) and %3$s)', spec[1], spec[2], scope);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select public.has_perm(%2$L)) and %3$s)', spec[1], spec[3], scope);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select public.has_perm(%2$L)) and %3$s) with check ((select public.has_perm(%2$L)) and %3$s)', spec[1], spec[3], scope);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select public.has_perm(%2$L)) and %3$s)', spec[1], spec[3], scope);
  end loop;

  if to_regclass('public.attendance') is not null then
    -- student rows: canViewStudents OR canViewAttendance (write: canEditStudents OR canEditAttendance);
    -- employee rows: canViewEmployees / canEditEmployees
    create policy attendance_select on public.attendance for select to authenticated
      using (((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))
        and ((subject_type = 'student'  and ((select public.has_perm('canViewStudents'))  or (select public.has_perm('canViewAttendance'))))
          or (subject_type = 'employee' and  (select public.has_perm('canViewEmployees')))));
    create policy attendance_insert on public.attendance for insert to authenticated
      with check (((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))
        and ((subject_type = 'student'  and ((select public.has_perm('canEditStudents'))  or (select public.has_perm('canEditAttendance'))))
          or (subject_type = 'employee' and  (select public.has_perm('canEditEmployees')))));
    create policy attendance_update on public.attendance for update to authenticated
      using (((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))
        and ((subject_type = 'student'  and ((select public.has_perm('canEditStudents'))  or (select public.has_perm('canEditAttendance'))))
          or (subject_type = 'employee' and  (select public.has_perm('canEditEmployees')))))
      with check (((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))
        and ((subject_type = 'student'  and ((select public.has_perm('canEditStudents'))  or (select public.has_perm('canEditAttendance'))))
          or (subject_type = 'employee' and  (select public.has_perm('canEditEmployees')))));
    create policy attendance_delete on public.attendance for delete to authenticated
      using (((select public.sees_all_branches()) or coalesce(nullif(branch_id,'main'),'') = (select public.my_branch_key()))
        and ((subject_type = 'student'  and ((select public.has_perm('canEditStudents'))  or (select public.has_perm('canEditAttendance'))))
          or (subject_type = 'employee' and  (select public.has_perm('canEditEmployees')))));
  end if;

  -- ---------- indexes ----------
  foreach t in array array['attendance','exam_results','submissions'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('create index if not exists %1$s_branch_key_idx on public.%1$I ((coalesce(nullif(branch_id,''main''),'''')))', t);
  end loop;

  -- ---------- reference checks (insert / change of the column only; DBA writes exempt) ----------
  for r in select * from (values
      ('exam_results','exam_id',      'exams',       'id', 'any'),
      ('exam_results','subject_id',   'subjects',    'id', 'any'),
      ('exam_results','student_id',   'students',    'id', 'any'),
      ('submissions', 'assignment_id','assignments', 'id', 'any'),
      ('submissions', 'student_id',   'students',    'id', 'any'),
      ('attendance',  'branch_id',    'branches',    'id', 'branch'),
      ('subjects',    'branch_id',    'branches',    'id', 'branch'),
      ('exams',       'branch_id',    'branches',    'id', 'branch'),
      ('exam_results','branch_id',    'branches',    'id', 'branch'),
      ('assignments', 'branch_id',    'branches',    'id', 'branch'),
      ('submissions', 'branch_id',    'branches',    'id', 'branch'),
      ('materials',   'branch_id',    'branches',    'id', 'branch')
    ) as v(tbl, col, target, tcol, mode)
  loop
    continue when to_regclass('public.' || r.tbl) is null;
    execute format('drop trigger if exists trg_ref_%1$s_%2$s on public.%1$I', r.tbl, r.col);
    execute format('create trigger trg_ref_%1$s_%2$s before insert or update of %2$I on public.%1$I
                      for each row execute function public.trg_check_ref(%2$L, %3$L, %4$L, %5$L)',
                   r.tbl, r.col, r.target, r.tcol, r.mode);
  end loop;

  -- ---------- hard-delete restrictions ----------
  for r in select * from (values
      ('exams',       'exam_results','exam_id',       'id'),
      ('subjects',    'exam_results','subject_id',    'id'),
      ('assignments', 'submissions', 'assignment_id', 'id'),
      ('students',    'exam_results','student_id',    'id'),
      ('students',    'submissions', 'student_id',    'id'),
      ('branches',    'attendance',  'branch_id',     'id'),
      ('branches',    'subjects',    'branch_id',     'id'),
      ('branches',    'exams',       'branch_id',     'id'),
      ('branches',    'assignments', 'branch_id',     'id'),
      ('branches',    'materials',   'branch_id',     'id')
    ) as v(tbl, reftbl, refcol, mycol)
  loop
    continue when to_regclass('public.' || r.reftbl) is null;
    execute format('drop trigger if exists trg_restrict_%1$s_%2$s_%3$s on public.%1$I', r.tbl, r.reftbl, r.refcol);
    execute format('create trigger trg_restrict_%1$s_%2$s_%3$s before delete on public.%1$I
                      for each row execute function public.trg_restrict_delete(%2$L, %3$L, %4$L, '''')',
                   r.tbl, r.reftbl, r.refcol, r.mycol);
  end loop;

  -- ---------- audit: who changed exams and marks ----------
  foreach t in array array['exams','exam_results'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop trigger if exists trg_%1$s_history on public.%1$I', t);
    execute format('create trigger trg_%1$s_history after insert or update or delete on public.%1$I
                      for each row execute function public.capture_history()', t);
  end loop;

  -- ---------- value checks (NOT VALID: new and changed rows only) ----------
  if to_regclass('public.attendance') is not null then
    perform public._mig_try('0013', 'attendance_status_chk',
      $q$alter table public.attendance add constraint attendance_status_chk check (status in ('present','absent','late','leave')) not valid$q$);
    perform public._mig_try('0013', 'attendance_date_iso',
      $q$alter table public.attendance add constraint attendance_date_iso check (date ~ '^\d{4}-\d{2}-\d{2}') not valid$q$);
  end if;
  if to_regclass('public.exam_results') is not null then
    perform public._mig_try('0013', 'exam_results_marks_chk',
      $q$alter table public.exam_results add constraint exam_results_marks_chk check (coalesce(marks_obtained,0) >= 0 and coalesce(max_marks,0) >= 0) not valid$q$);
  end if;
  if to_regclass('public.exams') is not null then
    perform public._mig_try('0013', 'exams_total_chk',
      $q$alter table public.exams add constraint exams_total_chk check (coalesce(total_marks,0) >= 0) not valid$q$);
  end if;
  if to_regclass('public.submissions') is not null then
    perform public._mig_try('0013', 'submissions_status_chk',
      $q$alter table public.submissions add constraint submissions_status_chk check (status is null or status in ('pending','submitted','late','graded','missing')) not valid$q$);
  end if;
end $$;

select public._mig_log('0013', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0013'
  and at >= (select max(at) from public.migration_log where migration = '0013' and step = '_start')
  and (status <> 'info' or step in ('_start','_done'))
order by id;
