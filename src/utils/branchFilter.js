// Does `record` belong to the branch the user is viewing?
//   "all"  -> everything
//   "main" -> records with no branch, an empty branch or "main"
//   other  -> records of exactly that branch
// A null/undefined record never matches (instead of throwing).
export function matchesBranch(record, activeBranch) {
  if (activeBranch === "all") return true;
  if (!record) return false;
  if (activeBranch === "main") return !record.branchId || record.branchId === "main";
  return record.branchId === activeBranch;
}

// Branch a record effectively belongs to. Invoices copy `branchId` from the
// student when they are created, so the copy goes stale if the student is later
// moved to another branch. When the record is linked to a student, trust the
// student's current branch; otherwise fall back to the record's own branchId.
export function effectiveBranchId(record, studentsById) {
  const student = record?.studentId ? studentsById?.get(record.studentId) : null;
  const id = student ? student.branchId : record?.branchId;
  return !id || id === "main" ? "" : id;
}

export function matchesBranchResolved(record, activeBranch, studentsById) {
  return matchesBranch({ branchId: effectiveBranchId(record, studentsById) }, activeBranch);
}
