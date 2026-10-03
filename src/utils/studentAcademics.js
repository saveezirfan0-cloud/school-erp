// src/utils/studentAcademics.js
//
// Pure helpers for the per-student academic profile and the Dashboard
// "Academics today" widget. No React, no database. Everything here composes
// the finished modules (attendance.js, grading.js, learning.js) instead of
// re-implementing their rules:
//   - attendance % rule        -> attendancePercent / tally   (attendance.js)
//   - grades, totals, ranking  -> studentTotals / classResults (grading.js)
//   - homework status          -> deriveSubmissionStatus       (learning.js)

import {
  tally,
  emptyCounts,
  attendancePercent,
  isValidStatus,
  parseISODate,
  addDays,
  gradeLabel,
} from "./attendance";
import {
  DEFAULT_GRADING_SCALE,
  DEFAULT_PASS_MARK,
  classResults,
  studentsForExam,
  subjectsForExam,
  subjectBreakdown,
  isPass,
} from "./grading";
import {
  HANDED_IN_STATUSES,
  deriveSubmissionStatus,
  deriveClasses,
  isValidDateStr,
  rosterFor,
  todayStr,
} from "./learning";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// "2026-03" -> "Mar 2026" (falls back to the input when malformed).
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ""));
  if (!m) return String(key ?? "");
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${m[1]}` : String(key);
}

// "2026-03-05" -> "05 Mar 2026"; blank / malformed -> "—". Built from the
// parts so there is no UTC day drift.
export function formatDay(iso) {
  const d = parseISODate(iso);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

// Rows that belong to one student (compares ids as strings).
export function rowsForStudent(rows, studentId) {
  return (rows || []).filter((r) => r && String(r.studentId) === String(studentId));
}

// One bucket per calendar month that has at least one valid record, oldest
// first: { key: "yyyy-MM", label, present, absent, late, leave, total, percent }.
// Rows with an unknown status or an invalid date are ignored. `percent` uses
// the shared attendance rule (null when nothing countable in that month).
export function monthlyAttendance(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || !isValidStatus(r.status) || !parseISODate(r.date)) continue;
    const key = r.date.slice(0, 7);
    if (!map.has(key)) map.set(key, emptyCounts());
    map.get(key)[r.status] += 1;
  }
  return [...map.keys()]
    .sort()
    .map((key) => {
      const c = map.get(key);
      return {
        key,
        label: monthLabel(key),
        ...c,
        total: c.present + c.absent + c.late + c.leave,
        percent: attendancePercent(c),
      };
    });
}

// The student's absences, newest first (leave is NOT an absence).
export function recentAbsences(rows, limit = 10) {
  return (rows || [])
    .filter((r) => r && r.status === "absent" && parseISODate(r.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, Math.max(0, limit));
}

// Overall counts + percent for one student's rows.
export function attendanceOverview(rows) {
  const counts = tally(rows);
  return {
    ...counts,
    total: counts.present + counts.absent + counts.late + counts.leave,
    percent: attendancePercent(counts),
  };
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

const normGrade = (g) => String(g ?? "").trim();

// Exams a student sits: same class and same branch (via studentsForExam),
// and only published ones unless `includeUnpublished`. A student with a blank
// class sits no exams (exams are always class-scoped). Newest first.
export function examsForStudent(student, exams, { includeUnpublished = false } = {}) {
  if (!student || normGrade(student.grade) === "") return [];
  return (exams || [])
    .filter((e) => includeUnpublished || e.published === true)
    .filter((e) => studentsForExam([student], e).length === 1)
    .sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return da < db ? 1 : -1;
      return String(b.name || "").localeCompare(String(a.name || ""));
    });
}

// Assemble the student's exam history, newest exam first.
//   student   the student doc (needs id, grade, branchId)
//   exams     all exams (any class)
//   results   all examResults rows (any student) — needed for class ranking
//   students  all students (the class roster used for ranking); the student
//             is added if missing so they always rank against themselves
//   options   { includeUnpublished, scale, passMark }
// -> [{ exam, totals, percentage, grade, rank, classSize, pass, hasMarks }]
//    `percentage`/`pass`/`rank` are null and `grade` "" when the student has
//    no marks for the exam. `classSize` counts classmates WITH marks.
export function examHistory({ student, exams, results, students, includeUnpublished = false, scale = DEFAULT_GRADING_SCALE, passMark = DEFAULT_PASS_MARK }) {
  const mine = examsForStudent(student, exams, { includeUnpublished });
  return mine.map((exam) => {
    const resultsForExam = (results || []).filter((r) => String(r.examId) === String(exam.id));
    let roster = studentsForExam(students, exam);
    if (!roster.some((s) => String(s.id) === String(student.id))) roster = [...roster, student];
    const rows = classResults(roster, resultsForExam, { defaultMax: exam.totalMarks, scale, passMark });
    const line = rows.find((r) => String(r.student.id) === String(student.id));
    const totals = line.totals;
    const hasMarks = totals.percentage !== null;
    return {
      exam,
      totals,
      percentage: totals.percentage,
      grade: totals.grade,
      rank: line.rank,
      classSize: rows.filter((r) => r.totals.percentage !== null).length,
      pass: hasMarks ? isPass(totals.percentage, passMark) : null,
      hasMarks,
    };
  });
}

// Per-subject rows for one exam of one student, with subject names.
//   subjects  all subjects (may be empty when the user cannot view them)
// Subjects come from the exam's class (subjectsForExam) plus any subject the
// student has a result for that is not in that list, so no marks are hidden.
// -> [{ subjectId, name, obtained, max, percentage, grade, state, remarks }]
//    Subjects with no result at all (state "blank" and no remarks) are dropped.
export function examSubjectRows({ exam, results, subjects, studentId, scale = DEFAULT_GRADING_SCALE }) {
  if (!exam) return [];
  const mine = (results || []).filter(
    (r) => String(r.studentId) === String(studentId) && String(r.examId) === String(exam.id)
  );
  const nameById = new Map((subjects || []).map((s) => [String(s.id), s.name || ""]));
  const ids = subjectsForExam(subjects, exam).map((s) => String(s.id));
  for (const r of mine) {
    const sid = String(r.subjectId);
    if (!ids.includes(sid)) ids.push(sid);
  }
  const have = new Set(mine.map((r) => String(r.subjectId)));
  return subjectBreakdown(mine, ids, { defaultMax: exam.totalMarks, scale })
    .filter((b) => have.has(String(b.subjectId)))
    .map((b) => ({ ...b, name: nameById.get(String(b.subjectId)) || "Subject" }));
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

// Assignments that apply to a student (same class — blank = all classes — and
// same branch), each with the student's submission and the DISPLAY status.
// Newest due date first; assignments without a due date go last.
// -> [{ assignment, submission, status, overdue }]
//    `overdue` = outstanding (pending/missing) and past due.
export function homeworkForStudent({ student, assignments, submissions, today = todayStr() }) {
  if (!student) return [];
  const mine = new Map();
  for (const s of submissions || []) {
    if (s && String(s.studentId) === String(student.id)) mine.set(String(s.assignmentId), s);
  }
  return (assignments || [])
    .filter((a) => rosterFor([student], a).length === 1)
    .map((assignment) => {
      const submission = mine.get(String(assignment.id)) || null;
      const status = deriveSubmissionStatus(submission, assignment.dueDate, today);
      const outstanding = status === "pending" || status === "missing";
      const overdue = outstanding && isValidDateStr(assignment.dueDate) && assignment.dueDate < today;
      return { assignment, submission, status, overdue };
    })
    .sort((a, b) => {
      const da = isValidDateStr(a.assignment.dueDate) ? a.assignment.dueDate : "";
      const db = isValidDateStr(b.assignment.dueDate) ? b.assignment.dueDate : "";
      if (da === db) return String(a.assignment.title || "").localeCompare(String(b.assignment.title || ""));
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? 1 : -1;
    });
}

// Completion summary for homeworkForStudent output.
// percent = handed in (submitted + late + graded) / total, whole number, 0 when empty.
export function homeworkSummary(items) {
  const counts = { pending: 0, submitted: 0, late: 0, graded: 0, missing: 0 };
  for (const it of items || []) counts[it.status] += 1;
  const total = (items || []).length;
  const handedIn = HANDED_IN_STATUSES.reduce((n, s) => n + counts[s], 0);
  return { total, ...counts, handedIn, percent: total === 0 ? 0 : Math.round((handedIn / total) * 100) };
}

// ---------------------------------------------------------------------------
// Dashboard widget
// ---------------------------------------------------------------------------

// Today's attendance across whatever rows/students are passed in (the caller
// scopes them to the active branch).
//   attendanceRows  all attendance rows
//   students        optional — when given, classes are counted
//   today           yyyy-MM-dd
// -> { present, absent, late, leave, marked, classesMarked, classesTotal }
//    classesTotal is null when `students` is not supplied. Classes are the
//    distinct non-blank student grades; a class is "marked" when any row dated
//    today carries that grade.
export function attendanceToday(attendanceRows, students, today = todayStr()) {
  const rows = (attendanceRows || []).filter((r) => r && r.date === today && isValidStatus(r.status));
  const counts = tally(rows);
  let classesMarked = 0;
  let classesTotal = null;
  if (students) {
    const classes = deriveClasses(students);
    const marked = new Set(rows.map((r) => gradeLabel(r.grade)));
    classesTotal = classes.length;
    classesMarked = classes.filter((c) => marked.has(c)).length;
  }
  return {
    ...counts,
    marked: rows.length,
    classesMarked,
    classesTotal,
  };
}

// Assignments due from today through today + `days` (inclusive), soonest
// first. Assignments without a valid due date are ignored.
export function homeworkDueSoon(assignments, today = todayStr(), days = 7) {
  const end = addDays(today, days);
  return (assignments || [])
    .filter((a) => a && isValidDateStr(a.dueDate) && a.dueDate >= today && a.dueDate <= end)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}
