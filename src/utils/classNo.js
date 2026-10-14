// A student's number within their class (roll no.), as opposed to the
// school-wide Reg No. (`studentId`). A "class" is one grade within one
// branch. Stored as `classNo` on the student (it lives in the `extra` jsonb).

const sameClass = (s, grade, branchId) =>
  (s?.grade || "") === (grade || "") && (s?.branchId || "") === (branchId || "");

const asNumber = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// Next free class number in a class: one past the highest number used there.
// `excludeIds` leaves out students who are about to move away.
export function nextClassNo(students, grade, branchId, { excludeIds = [] } = {}) {
  if (!grade) return "";
  const skip = new Set(excludeIds);
  let max = 0;
  for (const s of students || []) {
    if (skip.has(s.id) || !sameClass(s, grade, branchId)) continue;
    const n = asNumber(s.classNo);
    if (n != null && n > max) max = n;
  }
  return String(max + 1);
}

// The other student (if any) already holding `classNo` in that class.
export function classNoHolder(students, grade, branchId, classNo, excludeId) {
  const want = String(classNo ?? "").trim();
  if (!grade || !want) return null;
  return (students || []).find((s) =>
    s.id !== excludeId && sameClass(s, grade, branchId) && String(s.classNo ?? "").trim() === want
  ) || null;
}

// Plan moving `moving` students into a class. Students already in that class
// keep their number; the rest get the next free numbers in their current
// class-number order (then name), so a whole class moves across in order.
// `toBranchId` undefined keeps each student's own branch.
export function planTransfer(students, moving, toGrade, toBranchId) {
  const ordered = [...(moving || [])].sort((a, b) => {
    const an = asNumber(a.classNo), bn = asNumber(b.classNo);
    if (an != null && bn != null && an !== bn) return an - bn;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const movingIds = ordered.map((s) => s.id);
  const next = {}; // branchId -> next number to hand out
  return ordered.map((s) => {
    const branchId = toBranchId === undefined ? (s.branchId || "") : (toBranchId || "");
    if (sameClass(s, toGrade, branchId)) {
      return { student: s, grade: toGrade, branchId, classNo: s.classNo || "", unchanged: true };
    }
    if (next[branchId] == null) next[branchId] = Number(nextClassNo(students, toGrade, branchId, { excludeIds: movingIds }));
    // Students staying put in the target class still hold their numbers.
    const stayers = ordered.filter((o) => sameClass(o, toGrade, branchId)).map((o) => asNumber(o.classNo));
    while (stayers.includes(next[branchId])) next[branchId] += 1;
    const classNo = String(next[branchId]);
    next[branchId] += 1;
    return { student: s, grade: toGrade, branchId, classNo, unchanged: false };
  });
}

// Number students who have a class but no class number yet, alphabetically,
// after the highest number already used in their class.
export function planNumbering(students, targets) {
  const next = {}; // "grade|branchId" -> next number
  return [...(targets || [])]
    .filter((s) => s.grade && !String(s.classNo ?? "").trim())
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((s) => {
      const key = `${s.grade}|${s.branchId || ""}`;
      if (next[key] == null) next[key] = Number(nextClassNo(students, s.grade, s.branchId));
      const classNo = String(next[key]);
      next[key] += 1;
      return { student: s, classNo };
    });
}
