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
