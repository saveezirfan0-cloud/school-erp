// src/utils/learning.js
//
// Pure helpers for the Learning pages (Subjects, Homework, Materials).
// No React, no database: everything here is unit-testable (see
// learning.test.js) and safe to import from other pages later
// (e.g. a student academic profile).
//
// Dates are `yyyy-MM-dd` strings (the app-wide convention), so plain string
// comparison orders them correctly. "Today" is always passed in (or built
// from the local clock by todayStr) so the logic is deterministic in tests.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUBMISSION_STATUSES = ["pending", "submitted", "late", "graded", "missing"];

export const SUBMISSION_STATUS_LABELS = {
  pending: "Pending",
  submitted: "Submitted",
  late: "Late",
  graded: "Graded",
  missing: "Missing",
};

// Statuses that mean "the student handed something in".
export const HANDED_IN_STATUSES = ["submitted", "late", "graded"];

export const MATERIAL_KINDS = ["note", "link", "file", "video"];

export const MATERIAL_KIND_LABELS = {
  note: "Note",
  link: "Link",
  file: "File",
  video: "Video",
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// True for a real calendar date written as yyyy-MM-dd ("2026-02-30" is not).
export function isValidDateStr(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Local-clock yyyy-MM-dd (toISOString would shift the day for UTC+ zones).
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Past due = due date strictly before today. Due today is NOT overdue, and a
// missing/invalid due date is never overdue.
export function isOverdue(dueDate, today = todayStr()) {
  if (!isValidDateStr(dueDate) || !isValidDateStr(today)) return false;
  return dueDate < today;
}

// ---------------------------------------------------------------------------
// Branch / class helpers
// ---------------------------------------------------------------------------

// The app stores the main office as "" (sometimes "main", sometimes missing).
export function normalizeBranch(branchId) {
  const b = String(branchId ?? "").trim();
  return b === "main" ? "" : b;
}

export function sameBranch(a, b) {
  return normalizeBranch(a) === normalizeBranch(b);
}

const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Distinct, trimmed, non-blank `grade` values across any number of record
// lists (students first, then subjects/assignments/... that may use other
// classes), sorted naturally ("Grade 2" before "Grade 10").
export function deriveClasses(...lists) {
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const g = String(row?.grade ?? "").trim();
      if (g) seen.add(g);
    }
  }
  return [...seen].sort(naturalCompare);
}

// Does a row scoped to `rowGrade` apply to the chosen class filter?
// No filter selected -> everything; a blank row grade means "all classes".
export function appliesToClass(rowGrade, selectedGrade) {
  const sel = String(selectedGrade ?? "").trim();
  if (!sel) return true;
  const g = String(rowGrade ?? "").trim();
  return g === "" || g === sel;
}

// Subjects offered for a class (subjects with a blank grade apply to every
// class). When `branchId` is given, only subjects in the same branch.
export function subjectsForGrade(subjects, grade, branchId) {
  return (subjects || [])
    .filter((s) => appliesToClass(s.grade, grade))
    .filter((s) => branchId === undefined || sameBranch(s.branchId, branchId))
    .sort((a, b) => naturalCompare(String(a.name ?? ""), String(b.name ?? "")));
}

export function subjectLabel(subject) {
  if (!subject) return "";
  const name = String(subject.name ?? "").trim();
  const code = String(subject.code ?? "").trim();
  return code ? `${name} (${code})` : name;
}

// Same name + class + branch (case-insensitive) as another subject?
export function isDuplicateSubject(candidate, subjects, ignoreId = null) {
  const key = (s) => [
    String(s.name ?? "").trim().toLowerCase(),
    String(s.grade ?? "").trim().toLowerCase(),
    normalizeBranch(s.branchId),
  ].join("|");
  if (!String(candidate?.name ?? "").trim()) return false;
  const k = key(candidate);
  return (subjects || []).some((s) => s.id !== ignoreId && key(s) === k);
}

// The students an assignment applies to: same class (a blank class means
// every class) in the same branch, sorted by name.
export function rosterFor(students, assignment) {
  const grade = String(assignment?.grade ?? "").trim();
  return (students || [])
    .filter((s) => (grade === "" || String(s.grade ?? "").trim() === grade))
    .filter((s) => sameBranch(s.branchId, assignment?.branchId))
    .sort((a, b) => naturalCompare(String(a.name ?? ""), String(b.name ?? "")));
}

// Slice a list for a Pagination component, clamping the page.
export function paginate(list, page, pageSize) {
  const total = list.length;
  const size = Math.max(1, Number(pageSize) || 25);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const start = (safePage - 1) * size;
  return { items: list.slice(start, start + size), page: safePage, pageCount, total };
}

// ---------------------------------------------------------------------------
// Submission status
// ---------------------------------------------------------------------------

export function normalizeStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  return SUBMISSION_STATUSES.includes(s) ? s : "pending";
}

// The status to SHOW for a submission. Only what the teacher set is stored;
// this adds the two automatic readings:
//   - stored "submitted" but handed in after the due date  -> "late"
//   - stored "pending" (or no row at all) and past due      -> "missing"
// `sub` may be null/undefined (the student has no row yet).
export function deriveSubmissionStatus(sub, dueDate, today = todayStr()) {
  const stored = normalizeStatus(sub?.status);
  if (stored === "graded" || stored === "late" || stored === "missing") return stored;
  if (stored === "submitted") {
    const when = sub?.submittedDate;
    if (isValidDateStr(dueDate) && isValidDateStr(when) && when > dueDate) return "late";
    return "submitted";
  }
  return isOverdue(dueDate, today) ? "missing" : "pending";
}

// When a teacher marks a submission as handed in, suggest "late" if the
// submitted date is after the due date; otherwise keep the status they chose.
// Only affects submitted/late and only when both dates are known.
export function suggestStatus(status, submittedDate, dueDate) {
  const s = normalizeStatus(status);
  if (s !== "submitted" && s !== "late") return s;
  if (!isValidDateStr(submittedDate) || !isValidDateStr(dueDate)) return s;
  return submittedDate > dueDate ? "late" : "submitted";
}

// Apply a status change to an editable row ({status, submittedDate, ...}):
// handing in defaults the submitted date to today, then re-suggests late;
// pending/missing clear the submitted date.
export function applyStatusChange(draft, newStatus, dueDate, today = todayStr()) {
  const status = normalizeStatus(newStatus);
  const next = { ...draft, status };
  if (HANDED_IN_STATUSES.includes(status)) {
    if (!isValidDateStr(next.submittedDate)) next.submittedDate = today;
    next.status = suggestStatus(status, next.submittedDate, dueDate);
  } else {
    next.submittedDate = "";
  }
  return next;
}

// Apply a submitted-date edit: re-suggest submitted/late against the due date.
export function applyDateChange(draft, newDate, dueDate) {
  const next = { ...draft, submittedDate: newDate || "" };
  next.status = suggestStatus(next.status, next.submittedDate, dueDate);
  return next;
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

// Validate a marks entry against an assignment's max marks.
// Blank is allowed (not graded yet) and returns value null.
export function validateMarks(value, maxMarks) {
  if (value === null || value === undefined) return { ok: true, value: null };
  const str = String(value).trim();
  if (str === "") return { ok: true, value: null };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(str)) return { ok: false, value: null, error: "Enter a number" };
  const n = Number(str);
  if (!Number.isFinite(n)) return { ok: false, value: null, error: "Enter a number" };
  if (n < 0) return { ok: false, value: null, error: "Marks cannot be negative" };
  const max = Number(maxMarks);
  if (maxMarks !== "" && maxMarks !== null && maxMarks !== undefined && Number.isFinite(max) && max > 0 && n > max) {
    return { ok: false, value: null, error: `Cannot exceed ${max}` };
  }
  return { ok: true, value: n };
}

// ---------------------------------------------------------------------------
// Submission rows
// ---------------------------------------------------------------------------

// A blank, editable row for a student with no stored submission.
export function blankDraft() {
  return { status: "pending", submittedDate: "", marks: "", feedback: "" };
}

// Editable draft from a stored submission (or blank).
export function draftFromSubmission(sub) {
  if (!sub) return blankDraft();
  return {
    status: normalizeStatus(sub.status),
    submittedDate: isValidDateStr(sub.submittedDate) ? sub.submittedDate : "",
    marks: sub.marks === null || sub.marks === undefined ? "" : String(sub.marks),
    feedback: sub.feedback || "",
  };
}

// "8" and "8.0" are the same mark.
function comparableMarks(value) {
  const r = validateMarks(value);
  return r.ok ? r.value : String(value ?? "").trim();
}

// Has the teacher actually changed anything relative to what is stored?
export function draftChanged(sub, draft) {
  const a = draftFromSubmission(sub);
  const b = { ...blankDraft(), ...(draft || {}) };
  return (
    a.status !== normalizeStatus(b.status) ||
    a.submittedDate !== (b.submittedDate || "") ||
    comparableMarks(a.marks) !== comparableMarks(b.marks) ||
    a.feedback.trim() !== String(b.feedback ?? "").trim()
  );
}

// The row to pass to upsertDocs("submissions", rows, ["assignmentId","studentId"]).
// branchId comes from the student ("" for main). Throws nothing: marks that
// fail validation come back as null, so validate with validateMarks first.
export function buildSubmissionRow({ assignmentId, student, draft, maxMarks }) {
  const d = { ...blankDraft(), ...(draft || {}) };
  const marks = validateMarks(d.marks, maxMarks);
  return {
    assignmentId,
    studentId: student.id,
    status: normalizeStatus(d.status),
    submittedDate: isValidDateStr(d.submittedDate) ? d.submittedDate : "",
    marks: marks.ok ? marks.value : null,
    feedback: String(d.feedback ?? "").trim(),
    branchId: normalizeBranch(student.branchId),
  };
}

// ---------------------------------------------------------------------------
// Completion stats
// ---------------------------------------------------------------------------

// Counts by DISPLAY status for a roster against its submissions.
//   handedIn = submitted + late + graded;  percent is 0 for an empty roster.
// `submissions` is an array of rows with studentId (later rows win on dupes);
// rows for students not on the roster are ignored.
export function completionStats(roster, submissions, dueDate, today = todayStr()) {
  const bySid = new Map();
  for (const s of submissions || []) bySid.set(String(s.studentId), s);

  const counts = { pending: 0, submitted: 0, late: 0, graded: 0, missing: 0 };
  for (const student of roster || []) {
    counts[deriveSubmissionStatus(bySid.get(String(student.id)), dueDate, today)] += 1;
  }
  const total = (roster || []).length;
  const handedIn = counts.submitted + counts.late + counts.graded;
  return {
    total,
    ...counts,
    handedIn,
    percent: total === 0 ? 0 : Math.round((handedIn / total) * 100),
    complete: total > 0 && handedIn === total,
  };
}

// Assignment-level state for badges/filters: "complete" (everyone handed in),
// "overdue" (past due with work outstanding), otherwise "open".
export function assignmentState(assignment, stats, today = todayStr()) {
  if (stats && stats.complete) return "complete";
  if (isOverdue(assignment?.dueDate, today) && stats && stats.total > 0) return "overdue";
  return "open";
}

// Stats for many assignments at once: Map(assignmentId -> completionStats).
export function buildAssignmentStats(assignments, students, submissions, today = todayStr()) {
  const subsByAssignment = new Map();
  for (const s of submissions || []) {
    const key = String(s.assignmentId);
    if (!subsByAssignment.has(key)) subsByAssignment.set(key, []);
    subsByAssignment.get(key).push(s);
  }
  const out = new Map();
  for (const a of assignments || []) {
    out.set(
      a.id,
      completionStats(rosterFor(students, a), subsByAssignment.get(String(a.id)) || [], a.dueDate, today)
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

// Whitespace or ASCII control characters anywhere in the string.
function hasWhitespaceOrControl(str) {
  if (/\s/.test(str)) return true;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// Validate and normalise a user-entered link. Only http/https are allowed;
// `javascript:`, `data:`, `mailto:` etc. and anything with whitespace or
// control characters (used to smuggle "java\tscript:") are rejected. A bare
// "example.com/page" gets https:// prepended. Returns { ok, url, error }.
// With { required: false } a blank value is ok and yields url "".
export function validateUrl(input, { required = true } = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return required
      ? { ok: false, url: "", error: "A link is required" }
      : { ok: true, url: "", error: null };
  }
  if (hasWhitespaceOrControl(raw)) {
    return { ok: false, url: "", error: "Link cannot contain spaces" };
  }

  let candidate = raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) {
      return { ok: false, url: "", error: "Only http:// and https:// links are allowed" };
    }
  } else if (raw.startsWith("//")) {
    candidate = `https:${raw}`;
  } else {
    candidate = `https://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, url: "", error: "Enter a valid link" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url: "", error: "Only http:// and https:// links are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, url: "", error: "Link must not contain a username or password" };
  }
  const host = parsed.hostname;
  if (!host || !(host === "localhost" || host.includes("."))) {
    return { ok: false, url: "", error: "Enter a valid link" };
  }
  return { ok: true, url: parsed.href, error: null };
}

// Normalised URL or "" if it is not acceptable.
export function sanitizeUrl(input) {
  return validateUrl(input, { required: false }).url;
}

// For rendering a stored URL as an href: strict (must already carry
// http/https), so a bad value that got into the database can never become a
// clickable javascript: link. Returns "" when unsafe.
export function safeHref(url) {
  const raw = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return validateUrl(raw).url;
}

// A storage-safe filename for uploads (keeps the extension).
export function safeFileName(name) {
  const base = String(name ?? "file").split(/[\\/]/).pop() || "file";
  const cleaned = base.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (cleaned || "file").slice(-120);
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

const positiveNumber = (v) => {
  const s = String(v ?? "").trim();
  if (s === "") return { blank: true };
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? { value: n } : { invalid: true };
};

// Validate the assignment form. Returns { ok, errors: {field: message},
// values } where values holds the cleaned numbers/links to save.
export function validateAssignmentForm(form) {
  const errors = {};
  if (!String(form?.title ?? "").trim()) errors.title = "Title is required";
  if (!String(form?.grade ?? "").trim()) errors.grade = "Choose a class";

  const assigned = form?.assignedDate || "";
  const due = form?.dueDate || "";
  if (assigned && !isValidDateStr(assigned)) errors.assignedDate = "Invalid date";
  if (due && !isValidDateStr(due)) errors.dueDate = "Invalid date";
  if (!errors.assignedDate && !errors.dueDate && assigned && due && due < assigned) {
    errors.dueDate = "Due date cannot be before the assigned date";
  }

  const max = positiveNumber(form?.maxMarks);
  if (max.invalid) errors.maxMarks = "Max marks must be a number above 0";

  const link = validateUrl(form?.attachmentUrl, { required: false });
  if (!link.ok) errors.attachmentUrl = link.error;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: { maxMarks: max.value ?? null, attachmentUrl: link.url },
  };
}

// Validate the learning-material form. Links/videos/files need a valid URL
// (an uploaded file supplies one); notes may have none.
export function validateMaterialForm(form) {
  const errors = {};
  const kind = MATERIAL_KINDS.includes(form?.kind) ? form.kind : "";
  if (!String(form?.title ?? "").trim()) errors.title = "Title is required";
  if (!kind) errors.kind = "Choose a type";

  const needsUrl = kind !== "note";
  const link = validateUrl(form?.url, { required: needsUrl });
  if (!link.ok) errors.url = link.error;

  return { ok: Object.keys(errors).length === 0, errors, values: { kind, url: link.url } };
}
