-- ============================================================
-- ZMI School ERP — Attendance (student + employee profiles)
-- Run once in the SQL Editor, AFTER schema.sql and security.sql.
-- Safe to re-run.
--
-- One row per person per day. `subject_type` is 'student' or
-- 'employee' and `subject_id` is that record's id, so a single table
-- serves both profile pages.
-- ============================================================

create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('student', 'employee')),
  subject_id    text not null,
  date          text not null,              -- YYYY-MM-DD
  status        text not null,              -- present | absent | late | leave
  branch_id     text,
  extra         jsonb default '{}'::jsonb,  -- note, markedBy, ...
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- A person can only have one attendance mark per day.
create unique index if not exists attendance_subject_date_key
  on public.attendance (subject_type, subject_id, date);

drop trigger if exists trg_attendance_updated on public.attendance;
create trigger trg_attendance_updated before update on public.attendance
  for each row execute function public.set_updated_at();

-- ---------- Row-level security ----------
-- Students' attendance follows canViewStudents / canEditStudents;
-- employees' follows canViewEmployees / canEditEmployees. Both are
-- branch-scoped exactly like the people they belong to.
alter table public.attendance enable row level security;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and public.has_perm('canViewStudents')) or
      (subject_type = 'employee' and public.has_perm('canViewEmployees'))
    )
  );

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and public.has_perm('canEditStudents')) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and public.has_perm('canEditStudents')) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  )
  with check (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and public.has_perm('canEditStudents')) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated
  using (
    public.branch_visible(branch_id) and (
      (subject_type = 'student'  and public.has_perm('canEditStudents')) or
      (subject_type = 'employee' and public.has_perm('canEditEmployees'))
    )
  );

-- ---------- Realtime ----------
alter table public.attendance replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.attendance;
exception
  when duplicate_object then null;
  when others then null;
end $$;
