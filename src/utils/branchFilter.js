export function matchesBranch(record, activeBranch) {
  if (activeBranch === "all") return true;
  if (activeBranch === "main") return !record.branchId || record.branchId === "" || record.branchId === "main";
  return record.branchId === activeBranch;
}