// src/config/statementHeads.js
//
// The fixed heads of the Haji Sahab monthly statement, in the same order as
// the manual sheet. Edit this file to rename, reorder, add or re-route a head;
// nothing else needs to change. A head always prints (as 0 when empty).
//
// Anything that matches no head is shown in an extra "Other ..." row, so the
// totals always reconcile with the money that actually moved.

// Branch groups are matched against the branch NAME (case-insensitive).
// Records with no branch are the "Main" branch and count as Baneen.
export const BRANCH_GROUPS = {
  baneen: /baneen|^main$/i,
  banaat: /banaat|banat/i,
  umer: /umer/i,
  school: /school/i,
};

// ---- Income ----
// kind "fee" / "admission" / "tafseer" = invoice line items (by branch group).
// kind "payment" = cash_in payments that aren't tied to an invoice, matched on
// the payment category.
export const INCOME_HEADS = [
  { label: "Baneen Fees", kind: "fee", branch: "baneen" },
  { label: "Welfare", kind: "payment", category: /welfare/i },
  { label: "Donation", kind: "payment", category: /donat/i },
  { label: "Admission Fees", kind: "admission", branch: "baneen" },
  { label: "Banaat Fees", kind: "fee", branch: "banaat" },
  { label: "School Fees", kind: "fee", branch: "school" },
  { label: "Umer Colony Fees", kind: "fee", branch: "umer" },
  { label: "Loan", kind: "payment", category: /^loan/i },
  { label: "Tafseer Course Fees", kind: "tafseer" },
  { label: "Banaat Admission Fees", kind: "admission", branch: "banaat" },
  { label: "Umer Colony Admission Fees", kind: "admission", branch: "umer" },
  { label: "Miscellaneous", kind: "payment", category: /misc|^other$/i },
  { label: "Tution Fee", kind: "payment", category: /tuition|tution/i },
];

// ---- Expenses ----
// Evaluated in this order, first match wins:
//  1. heads with anyBranch: true (organisation-wide, whatever the branch)
//  2. branch lumps — everything spent by Banaat / Umer Colony / School
//  3. the remaining category heads (Baneen / Main branch)
// A payslip counts as category "Salaries".
export const EXPENSE_HEADS = [
  { label: "Utility Baneen", category: /utilit|electric|gas|water bill/i },
  { label: "Cleaning & Laundry", category: /clean|laundry/i },
  { label: "Baneen Entertainment", category: /entertain|refresh|guest/i },
  { label: "Baneen Staff Salary", category: /^(?!.*advance)(.*salar|.*staff)/i },
  { label: "Lunch Exp", category: /lunch/i },
  { label: "Maintenance and Repairing", category: /maint|repair/i },
  { label: "Furniture + Fixture", category: /furnit|fixture|equipment/i },
  { label: "Phone Package", category: /phone/i },
  { label: "Drinking Water", category: /drinking|^water$/i },
  { label: "Baneen Printing & Designing", category: /print|design/i },
  { label: "Baneen Stanationery", category: /station|suppl/i },
  { label: "Tution Fee", category: /tuition|tution/i, anyBranch: true },
  { label: "Fuel Expense", category: /fuel|transport/i },
  { label: "Salary Advance", category: /advance/i, anyBranch: true },
  { label: "Loan Return", category: /loan/i, anyBranch: true },
  { label: "Baneen Misc Exp", category: /misc|^other$/i },
  { label: "Baneen Rent", category: /rent/i },
  { label: "Welfare", category: /welfare/i, anyBranch: true },
  { label: "School Expense", branch: "school" },
  { label: "Umer Colony Expense", branch: "umer" },
  { label: "Banaat Expense", branch: "banaat" },
  { label: "Gifts", category: /gift/i, anyBranch: true },
  { label: "Suspense", category: /suspense/i, anyBranch: true },
];

// Categories offered in the Expenses / Payments forms so every head above can
// actually be recorded. Existing categories are kept first.
export const EXTRA_EXPENSE_CATEGORIES = [
  "Cleaning & Laundry", "Entertainment", "Lunch", "Furniture & Fixture", "Phone Package",
  "Drinking Water", "Printing & Designing", "Stationery", "Tuition Fee", "Fuel",
  "Salary Advance", "Loan Return", "Miscellaneous", "Welfare", "Gifts", "Suspense",
];
export const EXTRA_PAYMENT_CATEGORIES = [
  "Welfare", "Donation", "Loan", "Tafseer Course Fees", "Tuition Fee", "Miscellaneous",
];
