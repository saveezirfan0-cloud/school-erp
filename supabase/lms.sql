-- ============================================================
-- ZMI School ERP — LMS / Academics module
-- Run AFTER schema.sql, security.sql, trash.sql and realtime.sql.
-- Safe to re-run.
--
-- Adds: subjects, exams, exam_results, assignments, submissions,
--       materials, plus the `teacher` role and the academic permissions
--       (canView/EditAttendance, Exams, Learning).
--
-- ATTENDANCE uses the shared table from supabase/attendance.sql (one row
-- per student OR employee per day, keyed by subject_type + subject_id +
-- date). Run attendance.sql first; this file only widens its RLS so roles
-- with canView/EditAttendance (e.g. teachers) can read and mark student
-- attendance without needing canEditStudents.
--
-- Same conventions as the rest of the schema: real columns for
-- fields the app queries/filters on, everything else in `extra`
-- jsonb. branch_id is text and branch-scoped via branch_visible().
-- A student's class is `students.grade` (free text), so every table
-- that is class-scoped stores `grade` as text too.
-- ============================================================

-- ---------- permissions: re-declare has_perm with academic perms ----------
-- (Kept identical to the copy in security.sql; running either is fine.)
--
-- Once supabase/migrations/ has been applied (migration_log exists), has_perm()
-- is owned by migrations/0002 (per-user overrides, reserved canManageUsers,
-- the teacher role and these same academic permissions). Re-declaring the old
-- body here would silently switch those off, so it is skipped in that case.
do $lms_perm$
begin
  if to_regclass('public.migration_log') is not null then
    raise notice 'lms.sql: has_perm() left as defined by migrations/0002';
    return;
  end if;
  execute $fn$
create or replace function public.has_perm(perm text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $body$
declare
  r text := public.current_role();
  builtin jsonb;
  custom jsonb;
begin
  if r = 'admin' then
    return true;
  end if;

  builtin := case r
    when 'branch_manager' then '{
      "canViewDashboard":true,"canViewStudents":true,"canEditStudents":true,
      "canViewEmployees":true,"canViewFees":true,"canEditFees":true,
      "canViewExpenses":true,"canEditExpenses":true,"canViewPayments":true,
      "canEditPayments":true,"canViewPayslips":true,
      "canViewAttendance":true,"canEditAttendance":true,
      "canViewExams":true,"canEditExams":true,
      "canViewLearning":true,"canEditLearning":true
    }'::jsonb
    when 'accountant' then '{
      "canViewDashboard":true,"canViewFees":true,"canEditFees":true,
      "canViewExpenses":true,"canEditExpenses":true,"canViewPayments":true,
      "canEditPayments":true,"canViewPayslips":true,"canEditPayslips":true,
      "canViewAccounting":true,"canEditAccounting":true,"canViewReports":true,
      "canViewAllBranches":true
    }'::jsonb
    when 'fee_collector' then '{
      "canViewStudents":true,"canViewFees":true,"canEditFees":true
    }'::jsonb
    when 'teacher' then '{
      "canViewStudents":true,
      "canViewAttendance":true,"canEditAttendance":true,
      "canViewExams":true,"canEditExams":true,
      "canViewLearning":true,"canEditLearning":true
    }'::jsonb
    else '{}'::jsonb
  end;

  if builtin ? perm and (builtin ->> perm)::boolean then
    return true;
  end if;

  select permissions into custom from public.custom_roles where id = r;
  if custom is not null and (custom ? perm) and (custom ->> perm)::boolean then
    return true;
  end if;

  return false;
end;
$body$;
  $fn$;
end
$lms_perm$;

-- ============================================================
-- SUBJECTS  (a subject taught in a class/grade)
-- ============================================================
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  code        text,
  grade       text,            -- class it belongs to; blank = all classes
  teacher     text,            -- free-text teacher name (employee link lives in extra)
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- EXAMS  (a test / term exam for a class)
-- ============================================================
create table if not exists public.exams (
  id          uuid primary key default gen_random_uuid(),
  name        text,            -- e.g. "Mid-term 2026", "Weekly Test 3"
  term        text,            -- e.g. "Term 1"
  exam_type   text,            -- test | midterm | final | quiz | other
  grade       text,            -- class it is for
  date        text,
  total_marks numeric,         -- default max marks per subject
  published   boolean default false,  -- results visible on report cards
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_exams_grade on public.exams (grade);

-- ============================================================
-- EXAM RESULTS  (one row per exam x student x subject)
-- ============================================================
create table if not exists public.exam_results (
  id              uuid primary key default gen_random_uuid(),
  exam_id         text not null,
  student_id      text not null,
  subject_id      text not null,
  marks_obtained  numeric,     -- null = not entered; absent flag lives in `absent`
  max_marks       numeric,
  absent          boolean default false,
  remarks         text,
  branch_id       text,
  extra           jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create unique index if not exists uq_exam_results_key
  on public.exam_results (exam_id, student_id, subject_id);
create index if not exists idx_exam_results_student on public.exam_results (student_id);

-- ============================================================
-- ASSIGNMENTS  (homework / classwork)
-- ============================================================
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  description text,
  subject_id  text,
  grade       text,
  assigned_date text,
  due_date    text,
  max_marks   numeric,
  attachment_url text,
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_assignments_grade on public.assignments (grade);

-- ============================================================
-- SUBMISSIONS  (a student's status on an assignment)
-- status: pending | submitted | late | graded | missing
-- ============================================================
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id text not null,
  student_id    text not null,
  status        text default 'pending',
  submitted_date text,
  marks         numeric,
  feedback      text,
  attachment_url text,
  branch_id     text,
  extra         jsonb default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create unique index if not exists uq_submissions_key
  on public.submissions (assignment_id, student_id);

-- ============================================================
-- MATERIALS  (notes, links, files shared with a class)
-- ============================================================
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  description text,
  kind        text,            -- note | link | file | video
  url         text,
  subject_id  text,
  grade       text,
  branch_id   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_materials_grade on public.materials (grade);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'subjects','exams','exam_results','assignments','submissions','materials'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on public.%1$s;
       create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ---------- soft delete (Trash) ----------
-- attendance / exam_results / submissions are record-keeping rows that are
-- rewritten in place, so only the "document-like" tables get a Trash.
do $$
declare t text;
begin
  foreach t in array array['subjects','exams','assignments','materials'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz;', t);
    execute format('create index if not exists idx_%1$s_deleted_at on public.%1$s (deleted_at);', t);
  end loop;
end $$;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array[
    'subjects','exams','exam_results','assignments','submissions','materials'
  ] loop
    execute format('alter table public.%I replica identity full;', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end $$;

-- ---------- row level security ----------
-- Pattern per area:  select = canView<Area> + branch,
--                    insert/update/delete = canEdit<Area> + branch.
do $$
declare
  spec text[];
  t text; v text; e text;
begin
  foreach spec slice 1 in array array[
    array['subjects',     'canViewLearning',   'canEditLearning'],
    array['assignments',  'canViewLearning',   'canEditLearning'],
    array['submissions',  'canViewLearning',   'canEditLearning'],
    array['materials',    'canViewLearning',   'canEditLearning'],
    array['exams',        'canViewExams',      'canEditExams'],
    array['exam_results', 'canViewExams',      'canEditExams']
  ] loop
    t := spec[1]; v := spec[2]; e := spec[3];
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "auth all" on public.%I;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.has_perm(%L) and public.branch_visible(branch_id));',
      t || '_select', t, v);

    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.has_perm(%L) and public.branch_visible(branch_id));',
      t || '_insert', t, e);

    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.has_perm(%L) and public.branch_visible(branch_id))
         with check (public.has_perm(%L) and public.branch_visible(branch_id));',
      t || '_update', t, e, e);

    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_perm(%L) and public.branch_visible(branch_id));',
      t || '_delete', t, e);
  end loop;
end $$;

-- ---------- attendance (shared table from attendance.sql) ----------
-- Same policies as attendance.sql, except student rows are also open to
-- canView/EditAttendance. Employee rows are unchanged (employee perms).
do $$
begin
  if to_regclass('public.attendance') is null then
    raise exception 'public.attendance not found - run supabase/attendance.sql first';
  end if;
end $$;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and (public.has_perm('canViewStudents') or public.has_perm('canViewAttendance'))) or
      (subject_type = 'employee' and public.has_perm('canViewEmployees'))
    )
  );

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and (public.has_perm('canEditStudents') or public.has_perm('canEditAttendance'))) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and (public.has_perm('canEditStudents') or public.has_perm('canEditAttendance'))) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  )
  with check (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and (public.has_perm('canEditStudents') or public.has_perm('canEditAttendance'))) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and (public.has_perm('canEditStudents') or public.has_perm('canEditAttendance'))) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );
