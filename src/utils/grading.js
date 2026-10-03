// src/utils/grading.js
//
// Pure grading logic for exams, report cards and academic profiles.
// No React, no database — everything takes plain arrays/objects so it is
// unit-testable (see grading.test.js).
//
// Conventions
//  - A "result" is an examResults row (camelCase):
//      { examId, studentId, subjectId, marksObtained, maxMarks, absent, remarks }
//  - A cell is "absent" when result.absent is true (marks are ignored),
//    "blank" when no usable marks were entered (null / "" / non-numeric, or the
//    max marks are missing or <= 0) and "marked" otherwise.
//  - Absent and blank cells are EXCLUDED from both obtained and max marks, so
//    they never count as zero and never inflate the maximum. A student who was
//    absent for a paper is therefore judged on the papers they sat.
//  - Percentages and totals are rounded to 2 decimal places.
//  - Ranking is by percentage (so students who sat different numbers of papers
//    are comparable) using standard competition ranking: 1, 2, 2, 4.

// ---------------------------------------------------------------------------
// Configuration — change these to change the school's grading policy.
// Entries must be ordered from highest `min` to lowest, and the last entry
// should have min: 0 so every percentage maps to a grade.
// ---------------------------------------------------------------------------
export const DEFAULT_GRADING_SCALE = [
  { min: 90, grade: "A+", remark: "Outstanding" },
  { min: 80, grade: "A", remark: "Excellent" },
  { min: 70, grade: "B", remark: "Very good" },
  { min: 60, grade: "C", remark: "Good" },
  { min: 50, grade: "D", remark: "Satisfactory" },
  { min: 0, grade: "F", remark: "Needs improvement" },
];

// Percentage at or above which a student passes.
export const DEFAULT_PASS_MARK = 50;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Round to `dp` decimal places, avoiding float noise (0.1 + 0.2 -> 0.3).
export function roundTo(n, dp = 2) {
  if (!Number.isFinite(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Parse a value into a finite number, or null when blank / not numeric.
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

// Scale entry for a percentage ("" -> null when there is no percentage).
export function scaleEntryFor(percent, scale = DEFAULT_GRADING_SCALE) {
  const p = toNumber(percent);
  if (p === null) return null;
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const hit = sorted.find((s) => p >= s.min);
  // Below every threshold (negative input): fall to the lowest grade.
  return hit || sorted[sorted.length - 1] || null;
}

// Letter grade for a percentage. Returns "" when the percentage is missing.
export function gradeFor(percent, scale = DEFAULT_GRADING_SCALE) {
  const e = scaleEntryFor(percent, scale);
  return e ? e.grade : "";
}

// Short descriptive remark for a percentage ("Excellent", ...).
export function remarkFor(percent, scale = DEFAULT_GRADING_SCALE) {
  const e = scaleEntryFor(percent, scale);
  return e && e.remark ? e.remark : "";
}

// True when percentage >= pass mark. Missing percentage is not a pass.
export function isPass(percent, passMark = DEFAULT_PASS_MARK) {
  const p = toNumber(percent);
  return p !== null && p >= passMark;
}

// ---------------------------------------------------------------------------
// Percentages and single cells
// ---------------------------------------------------------------------------

// obtained / max as a percentage, or null when max is missing / <= 0.
export function percentOf(obtained, max, dp = 2) {
  const o = toNumber(obtained);
  const m = toNumber(max);
  if (o === null || m === null || m <= 0) return null;
  return roundTo((o / m) * 100, dp);
}

// "absent" | "blank" | "marked" for one result row (see header comment).
export function cellState(result, defaultMax = null) {
  if (!result) return "blank";
  if (result.absent === true) return "absent";
  const marks = toNumber(result.marksObtained);
  const max = toNumber(result.maxMarks) ?? toNumber(defaultMax);
  if (marks === null || max === null || max <= 0) return "blank";
  return "marked";
}

// Validate a raw input for a marks cell against a max.
// -> { ok, value, error }   value is a number, or null for an empty input.
export function validateMarks(raw, max) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, value: null, error: "" };
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, value: null, error: "Enter a number" };
  if (n < 0) return { ok: false, value: null, error: "Cannot be negative" };
  const m = toNumber(max);
  if (m !== null && n > m) return { ok: false, value: null, error: `Cannot exceed ${m}` };
  return { ok: true, value: n, error: "" };
}

// ---------------------------------------------------------------------------
// Per-student totals
// ---------------------------------------------------------------------------

// Sum a student's results.
//  results      array of result rows (all for ONE student; may span several
//               exams — each row carries its own maxMarks)
//  options.subjectIds   optional whitelist; rows for other subjects are ignored
//  options.defaultMax   max to use when a row has no maxMarks
//  options.scale        grading scale for the overall grade
// -> { obtained, max, percentage, grade, marked, absent, blank, complete }
//    percentage/grade are null/"" when nothing has been marked.
//    `complete` is true when no considered cell is blank or absent.
export function studentTotals(results, options = {}) {
  const { subjectIds = null, defaultMax = null, scale = DEFAULT_GRADING_SCALE } = options;
  const allow = subjectIds ? new Set(subjectIds.map(String)) : null;
  let obtained = 0;
  let max = 0;
  let marked = 0;
  let absent = 0;
  let blank = 0;
  for (const r of results || []) {
    if (allow && !allow.has(String(r.subjectId))) continue;
    const state = cellState(r, defaultMax);
    if (state === "absent") absent++;
    else if (state === "blank") blank++;
    else {
      obtained += toNumber(r.marksObtained);
      max += toNumber(r.maxMarks) ?? toNumber(defaultMax);
      marked++;
    }
  }
  obtained = roundTo(obtained);
  max = roundTo(max);
  const percentage = marked > 0 ? percentOf(obtained, max) : null;
  return {
    obtained,
    max,
    percentage,
    grade: percentage === null ? "" : gradeFor(percentage, scale),
    marked,
    absent,
    blank,
    complete: marked > 0 && absent === 0 && blank === 0,
  };
}

// Per-subject breakdown for one student (for a report card).
// When a subject has several results (a whole-term report), they are summed.
// -> [{ subjectId, obtained, max, percentage, grade, state, remarks }]
//    in the order of `subjectIds`. state: "absent" | "blank" | "marked"
//    ("absent" only when every result for the subject is absent).
export function subjectBreakdown(results, subjectIds, options = {}) {
  const { defaultMax = null, scale = DEFAULT_GRADING_SCALE } = options;
  return subjectIds.map((subjectId) => {
    const rows = (results || []).filter((r) => String(r.subjectId) === String(subjectId));
    const t = studentTotals(rows, { defaultMax, scale });
    let state = "blank";
    if (t.marked > 0) state = "marked";
    else if (t.absent > 0) state = "absent";
    const remarks = rows.map((r) => (r.remarks || "").trim()).filter(Boolean).join("; ");
    return {
      subjectId,
      obtained: t.obtained,
      max: t.max,
      percentage: t.percentage,
      grade: t.grade,
      state,
      remarks,
    };
  });
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

// Standard competition ranking (1, 2, 2, 4). Highest value ranks first.
//  items      array of objects
//  valueOf    (item) => number | null     (default: item.percentage)
//  idOf       (item) => key               (default: item.id)
// -> { [id]: rank | null }   entries with a null / non-numeric value are unranked.
export function rankStudents(items, valueOf = (i) => i.percentage, idOf = (i) => i.id) {
  const ranked = [];
  const out = {};
  for (const item of items || []) {
    const v = toNumber(valueOf(item));
    if (v === null) out[idOf(item)] = null;
    else ranked.push({ id: idOf(item), v: roundTo(v) });
  }
  ranked.sort((a, b) => b.v - a.v);
  let rank = 0;
  let prev = null;
  ranked.forEach((r, i) => {
    if (prev === null || r.v !== prev) rank = i + 1;
    out[r.id] = rank;
    prev = r.v;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Class level
// ---------------------------------------------------------------------------

// Totals + rank for every student of a class.
//  students    [{ id, ... }]
//  results     result rows for the exam(s) being reported (any students)
//  options     { subjectIds, defaultMax, scale, passMark }
// -> [{ student, totals, rank, pass }]  in the order of `students`.
//    pass is null when the student has no marks.
export function classResults(students, results, options = {}) {
  const { passMark = DEFAULT_PASS_MARK, ...totalOpts } = options;
  const byStudent = new Map();
  for (const r of results || []) {
    const k = String(r.studentId);
    if (!byStudent.has(k)) byStudent.set(k, []);
    byStudent.get(k).push(r);
  }
  const rows = (students || []).map((student) => {
    const totals = studentTotals(byStudent.get(String(student.id)) || [], totalOpts);
    return { student, totals };
  });
  const ranks = rankStudents(rows, (r) => r.totals.percentage, (r) => r.student.id);
  return rows.map((r) => ({
    ...r,
    rank: ranks[r.student.id] ?? null,
    pass: r.totals.percentage === null ? null : isPass(r.totals.percentage, passMark),
  }));
}

// Summary of a class. Only students with at least one marked cell count.
//  rows   output of classResults (or any [{ totals: { percentage } }])
// -> { count, average, highest, lowest, passCount, failCount, passPercent,
//      gradeCounts }
//    average/highest/lowest/passPercent are null when count is 0.
export function classStats(rows, passMark = DEFAULT_PASS_MARK, scale = DEFAULT_GRADING_SCALE) {
  const pcts = (rows || [])
    .map((r) => (r.totals ? r.totals.percentage : r.percentage))
    .filter((p) => p !== null && p !== undefined && Number.isFinite(p));
  const gradeCounts = {};
  scale.forEach((s) => { gradeCounts[s.grade] = 0; });
  if (pcts.length === 0) {
    return { count: 0, average: null, highest: null, lowest: null, passCount: 0, failCount: 0, passPercent: null, gradeCounts };
  }
  pcts.forEach((p) => {
    const g = gradeFor(p, scale);
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });
  const passCount = pcts.filter((p) => isPass(p, passMark)).length;
  return {
    count: pcts.length,
    average: roundTo(pcts.reduce((a, b) => a + b, 0) / pcts.length),
    highest: Math.max(...pcts),
    lowest: Math.min(...pcts),
    passCount,
    failCount: pcts.length - passCount,
    passPercent: roundTo((passCount / pcts.length) * 100),
    gradeCounts,
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

// A student's percentage in each exam, oldest first (by exam.date, then name).
//  exams       [{ id, name, date, ... }]
//  results     result rows (may include other students / other exams)
//  studentId   whose results to use
// -> [{ exam, percentage }]  exams where the student has no marks are skipped.
export function trendFor(exams, results, studentId, options = {}) {
  const mine = (results || []).filter((r) => String(r.studentId) === String(studentId));
  const sorted = [...(exams || [])].sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const out = [];
  for (const exam of sorted) {
    const t = studentTotals(
      mine.filter((r) => String(r.examId) === String(exam.id)),
      { defaultMax: exam.totalMarks, ...options }
    );
    if (t.percentage !== null) out.push({ exam, percentage: t.percentage });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Class / subject / branch matching (shared by the Exams and Report Cards pages)
// ---------------------------------------------------------------------------

const norm = (s) => String(s ?? "").trim().toLowerCase();
const branchKey = (b) => (!b || b === "main" ? "" : String(b));

// Case/whitespace-insensitive class (grade) comparison.
export function sameClass(a, b) {
  return norm(a) === norm(b);
}

// Students that sit an exam: same class, same branch (blank = main office),
// sorted by name.
export function studentsForExam(students, exam) {
  if (!exam) return [];
  return (students || [])
    .filter((s) => sameClass(s.grade, exam.grade) && branchKey(s.branchId) === branchKey(exam.branchId))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

// Subjects taught in the exam's class: subject.grade equals the exam's class or
// is blank (all classes); and the subject is shared (no branch) or belongs to
// the exam's branch. Sorted by name.
export function subjectsForExam(subjects, exam) {
  if (!exam) return [];
  return (subjects || [])
    .filter((s) => {
      const gradeOk = norm(s.grade) === "" || sameClass(s.grade, exam.grade);
      const sb = branchKey(s.branchId);
      return gradeOk && (sb === "" || sb === branchKey(exam.branchId));
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

// Max marks for a result row, falling back to the exam's total (then 100).
export function effectiveMax(result, exam) {
  return toNumber(result && result.maxMarks) ?? toNumber(exam && exam.totalMarks) ?? 100;
}
