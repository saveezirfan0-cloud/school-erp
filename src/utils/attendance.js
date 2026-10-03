// src/utils/attendance.js
//
// Pure attendance logic (no React, no database) so it can be unit-tested.
//
// Row shape (app-side, camelCase — see docs/LMS_PLAN.md):
//   { studentId, date: "yyyy-MM-dd", status, grade, note, markedBy, branchId }
// `studentId` is the student's document id, not the human "Student ID".
//
// ---------------------------------------------------------------
// ATTENDANCE PERCENTAGE RULE (single source of truth — see
// attendancePercent below):
//
//     percent = (present + late) / (present + late + absent) * 100
//
//   * LATE counts as attended (the student was in school).
//   * LEAVE (approved absence) is EXCLUDED from the denominator, so an
//     approved leave neither helps nor hurts the percentage.
//   * Absent counts against the student.
//   * With no countable records (nothing marked, or only leave) the
//     percentage is `null` — "not applicable" — never 0, so such a
//     student is not flagged as low attendance.
//   * Rounded to 1 decimal place.
// ---------------------------------------------------------------

export const STATUSES = ["present", "absent", "late", "leave"];

export const STATUS_LABELS = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  leave: "Leave",
};

export const UNASSIGNED = "Unassigned";
export const DEFAULT_THRESHOLD = 75;

// ---------- classes ----------

// Display / grouping key for a class. Blank grades become "Unassigned".
export function gradeLabel(grade) {
  const g = String(grade ?? "").trim();
  return g || UNASSIGNED;
}

// Sorted unique class labels for a list of students (natural order, so
// "Grade 2" sorts before "Grade 10"; "Unassigned" always last).
export function gradeOptions(students) {
  const set = new Set((students || []).map((s) => gradeLabel(s.grade)));
  return [...set].sort((a, b) => {
    if (a === UNASSIGNED) return b === UNASSIGNED ? 0 : 1;
    if (b === UNASSIGNED) return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function sortStudents(students) {
  return [...(students || [])].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true, sensitivity: "base" })
  );
}

// ---------- counting & percentage ----------

export function emptyCounts() {
  return { present: 0, absent: 0, late: 0, leave: 0 };
}

export function isValidStatus(status) {
  return STATUSES.includes(status);
}

// Count rows by status. Rows with an unknown/blank status are ignored.
export function tally(rows) {
  const c = emptyCounts();
  for (const r of rows || []) {
    if (isValidStatus(r?.status)) c[r.status] += 1;
  }
  return c;
}

// Attendance % from status counts (rule documented at the top of the file).
// Returns a number rounded to 1 decimal, or null when nothing countable.
export function attendancePercent(counts) {
  const present = Number(counts?.present) || 0;
  const late = Number(counts?.late) || 0;
  const absent = Number(counts?.absent) || 0;
  const denominator = present + late + absent;
  if (denominator === 0) return null;
  // integer arithmetic first so 1/8 -> 12.5 and 2/3 -> 66.7 without float drift
  return Math.round(((present + late) * 1000) / denominator) / 10;
}

// True when a (possibly null) percentage is below the threshold.
// null (no data) is never "low".
export function isLowAttendance(percent, threshold = DEFAULT_THRESHOLD) {
  if (percent === null || percent === undefined) return false;
  return percent < Number(threshold);
}

export function formatPercent(percent) {
  return percent === null || percent === undefined ? "—" : `${percent}%`;
}

// ---------- per student ----------

// Map of studentId -> { present, absent, late, leave, total, percent }
// `total` is the number of valid records (including leave).
export function summarisePerStudent(rows) {
  const byStudent = {};
  for (const r of rows || []) {
    if (!r || !isValidStatus(r.status)) continue;
    const key = r.studentId;
    if (!byStudent[key]) byStudent[key] = emptyCounts();
    byStudent[key][r.status] += 1;
  }
  const out = {};
  for (const [id, counts] of Object.entries(byStudent)) {
    out[id] = {
      ...counts,
      total: counts.present + counts.absent + counts.late + counts.leave,
      percent: attendancePercent(counts),
    };
  }
  return out;
}

// One report line per student (students with no records are included with
// zero counts and a null percent). Low flag uses `threshold`.
export function buildStudentReport(students, rows, threshold = DEFAULT_THRESHOLD) {
  const summary = summarisePerStudent(rows);
  return (students || []).map((s) => {
    const sm = summary[s.id] || { ...emptyCounts(), total: 0, percent: null };
    return {
      id: s.id,
      studentId: s.studentId || "",
      name: s.name || "",
      grade: gradeLabel(s.grade),
      ...sm,
      low: isLowAttendance(sm.percent, threshold),
    };
  });
}

// Whole-group figure (e.g. overall class %) from report lines.
export function overallPercent(reportLines) {
  const c = emptyCounts();
  for (const l of reportLines || []) {
    c.present += l.present || 0;
    c.absent += l.absent || 0;
    c.late += l.late || 0;
    c.leave += l.leave || 0;
  }
  return attendancePercent(c);
}

// ---------- daily class-wise summary ----------

// One line per (date, class): counts, total marked and class %.
// Sorted newest date first, then class name. `gradeOf(row)` can override how
// a row's class is determined (default: the grade stored on the row).
export function dailyClassSummary(rows, gradeOf = (r) => r.grade) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || !isValidStatus(r.status) || !r.date) continue;
    const grade = gradeLabel(gradeOf(r));
    const key = `${r.date}\u0000${grade}`;
    if (!map.has(key)) map.set(key, { date: r.date, grade, ...emptyCounts() });
    map.get(key)[r.status] += 1;
  }
  return [...map.values()]
    .map((l) => ({
      ...l,
      total: l.present + l.absent + l.late + l.leave,
      percent: attendancePercent(l),
    }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.grade.localeCompare(b.grade, undefined, { numeric: true, sensitivity: "base" });
    });
}

// ---------- date helpers (all yyyy-MM-dd, local time, no UTC drift) ----------

const pad = (n) => String(n).padStart(2, "0");

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

// Parse "yyyy-MM-dd" to a local Date, or null if malformed / impossible (e.g. 2026-02-30).
export function parseISODate(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function startOfMonth(iso) {
  const d = parseISODate(iso);
  return d ? toISODate(new Date(d.getFullYear(), d.getMonth(), 1)) : iso;
}

export function endOfMonth(iso) {
  const d = parseISODate(iso);
  return d ? toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) : iso;
}

// Inclusive range check; an empty bound is open-ended.
export function isInRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

// Ensure from <= to (swaps if reversed).
export function normaliseRange(from, to) {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

// Quick ranges for the report filter. `today` is a yyyy-MM-dd string.
export function presetRange(name, today = todayISO()) {
  switch (name) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: addDays(today, -6), to: today };
    case "month":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const prevEnd = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prevEnd), to: prevEnd };
    }
    default:
      return { from: startOfMonth(today), to: today };
  }
}

// ---------- marking helpers ----------

// Effective { status, note } for one student: an unsaved draft edit wins over
// the saved row; `status` is "" when the student has not been marked.
export function effectiveEntry(draftEntry, savedRow) {
  const status = draftEntry && "status" in draftEntry ? draftEntry.status : savedRow?.status;
  const note = draftEntry && "note" in draftEntry ? draftEntry.note : savedRow?.note;
  return {
    status: isValidStatus(status) ? status : "",
    note: note || "",
  };
}

// Live counts for the roster (+ how many are still unmarked).
export function rosterCounts(students, draft, savedByStudent) {
  const counts = { ...emptyCounts(), unmarked: 0, total: (students || []).length };
  for (const s of students || []) {
    const { status } = effectiveEntry(draft?.[s.id], savedByStudent?.[s.id]);
    if (status) counts[status] += 1;
    else counts.unmarked += 1;
  }
  return counts;
}

// Rows to upsert: only students touched in `draft` that end up with a valid
// status. Complete rows (the upsert replaces the whole row).
export function buildMarkRows({ students, draft, savedByStudent, date, markedBy }) {
  const rows = [];
  for (const s of students || []) {
    if (!draft || !(s.id in draft)) continue;
    const { status, note } = effectiveEntry(draft[s.id], savedByStudent?.[s.id]);
    if (!status) continue;
    rows.push({
      studentId: s.id,
      date,
      status,
      grade: String(s.grade ?? "").trim(),
      note: note.trim(),
      markedBy: markedBy || "",
      branchId: s.branchId && s.branchId !== "main" ? s.branchId : "",
    });
  }
  return rows;
}

// Escape text for the HTML-based PDF export.
export function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
