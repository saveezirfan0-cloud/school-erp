# LMS / Academics — build plan

Adds school-side learning features to the ERP: **attendance, exams & test
reports (report cards), subjects, homework, learning materials**, and a
per-student academic profile.

## Scope of this phase

Staff-facing only (admin, branch manager, new **teacher** role). There is no
student/parent login yet — that is a separate phase (needs a student auth
model, see "Later" below). Everything is branch-scoped and permission-gated
the same way as the rest of the app.

## Already in place (foundation)

| Piece | Where |
|---|---|
| Tables, indexes, RLS, realtime, Trash columns | `supabase/lms.sql` (run after schema/security/trash/realtime) |
| `teacher` role + permissions in `has_perm` | `supabase/security.sql`, `supabase/lms.sql` |
| Client permissions + role | `src/context/UserContext.jsx`, perm catalogs in `Users.jsx` / `AccessOverview.jsx` |
| Collections registered in the shim | `src/firebase.js` (`TABLE_MAP`, `COLUMNS`, `SOFT_DELETE_TABLES`) |
| Bulk keyed upsert helper | `upsertDocs(name, rows, conflictKeys)` in `src/firebase.js` |
| Menu entries (Academics section) | `src/config/menu.js` |
| Routes + placeholder pages | `src/App.js`, `src/pages/*.jsx` |
| Trash support for subjects/exams/homework/materials | `src/pages/Trash.jsx` |

### Permissions

`canViewAttendance` / `canEditAttendance`, `canViewExams` / `canEditExams`,
`canViewLearning` / `canEditLearning` (learning = subjects, homework,
materials). Admin and branch manager get all; teacher gets all of these plus
`canViewStudents`; accountant and fee collector get none.

### Data contract (collection → table, camelCase in the app)

A student's class is `student.grade` (free text, already in the app). All
class-scoped rows store `grade` as text and a `branchId` (blank = main office).
Dates are `yyyy-MM-dd` strings. `studentId` on these tables is the student's
document **`id`** (uuid), *not* the human "Student ID" field — same as
`invoices.studentId`.

| Collection | Key fields | Unique on |
|---|---|---|
| `subjects` | name, code, grade, teacher, branchId | — |
| `attendance` | studentId, date, status (`present`/`absent`/`late`/`leave`), grade, note, markedBy, branchId | studentId + date |
| `exams` | name, term, examType (`test`/`quiz`/`midterm`/`final`/`other`), grade, date, totalMarks, published, branchId | — |
| `examResults` | examId, studentId, subjectId, marksObtained, maxMarks, absent, remarks, branchId | examId + studentId + subjectId |
| `assignments` | title, description, subjectId, grade, assignedDate, dueDate, maxMarks, attachmentUrl, branchId | — |
| `submissions` | assignmentId, studentId, status (`pending`/`submitted`/`late`/`graded`/`missing`), submittedDate, marks, feedback, branchId | assignmentId + studentId |
| `materials` | title, description, kind (`note`/`link`/`file`/`video`), url, subjectId, grade, branchId | — |

Soft-delete (Trash): `subjects`, `exams`, `assignments`, `materials`.
Attendance, results and submissions are rewritten in place (use `upsertDocs`).

## Work packages

Wave 1 runs in parallel; each package owns its files exclusively.

| # | Package | Owns |
|---|---|---|
| A | **Attendance** — daily marking by class, bulk "mark all present", late/leave, history, monthly summary + % per student, low-attendance list, CSV/PDF export | `src/pages/Attendance.jsx`, `src/utils/attendance.js` (+ test) |
| B | **Exams & Report Cards** — exam CRUD, marks-entry grid (student × subject), grading scale, class ranking, printable report card (single + whole class), publish toggle | `src/pages/Exams.jsx`, `src/pages/ReportCards.jsx`, `src/utils/grading.js` (+ test) |
| C | **Learning** — subjects CRUD, homework with per-student submission tracking + grading, learning materials library | `src/pages/Subjects.jsx`, `Homework.jsx`, `Materials.jsx`, `src/utils/learning.js` (+ test) |

Wave 2 (after A–C land):

| # | Package | Owns |
|---|---|---|
| D | **Student academic profile** (`/students/:id/academics`, linked from Students) combining attendance %, exam history/trend, homework status; Dashboard academic widgets; README/setup docs | `src/pages/StudentAcademics.jsx`, small edits to `Students.jsx`/`Dashboard.jsx`/`README.md` |

## Conventions every package follows

- Copy the patterns in `src/pages/Students.jsx`: `useCollection` for live
  lists, `useBranch()` for the active branch, `ListToolbar`, `Pagination`,
  `logActivity()` for every write, `react-hot-toast` for feedback, inline
  styles with the CSS variables (`--primary`, `--border`, `--text-muted`),
  mobile layout at ≤768px.
- Writes go through `src/firebase.js` only (`addDoc`, `updateDoc`,
  `deleteDoc`, `updateDocs`, `upsertDocs`). Never call `supabase` directly.
- Gate edit controls with `useUser().can("canEdit…")`; the route already
  gates viewing. The database RLS is the real boundary.
- Respect branch scope: write the row's `branchId` from the student/exam it
  belongs to; filter lists with `matchesBranch` (`useCollection` does it).
- Exports reuse `src/utils/exportUtils.js`.
- Put pure logic (percentages, grades, ranking, summaries) in a `utils/`
  file with a Jest test so it is verifiable without a database.
- Don't edit files you don't own. If you need a change to a shared file
  (`firebase.js`, `menu.js`, `App.js`, `lms.sql`), report it instead.

## Later (not in this phase)

- Student / parent portal (login, read-only view of own attendance, results,
  homework). Needs a student auth model and tighter RLS (a row-level
  "own child" policy), so it is deliberately separate.
- Timetable, announcements, online quizzes, SMS/WhatsApp absence alerts
  (the WhatsApp util already exists).
