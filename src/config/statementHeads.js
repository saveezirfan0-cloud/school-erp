// src/config/statementHeads.js
//
// How the Haji Sahab statement groups money. Heads themselves (e.g. "Utilities",
// "Donation") come straight from your data: expense categories, payment
// categories, fee line items and Income/Expense accounts in the Chart of
// Accounts. This file only decides which GROUP (section) a head belongs to
// and in which order the groups appear. Edit it to rename or re-route.
//
// A head is placed by, in order:
//   1. a Chart of Accounts Income/Expenses account with the same name -> its
//      sub-type (SUBTYPE_GROUP below)
//   2. the first keyword rule that matches its name
//   3. the "other" group
// so groups never need maintaining per head.

export const INCOME_GROUPS = [
  { key: "fees", label: "Fee Income" },
  { key: "donations", label: "Donations & Welfare" },
  { key: "loans", label: "Loans & Advances" },
  { key: "other", label: "Other Income" },
];

export const EXPENSE_GROUPS = [
  { key: "salaries", label: "Salaries & Staff" },
  { key: "rent", label: "Rent & Utilities" },
  { key: "maintenance", label: "Maintenance & Equipment" },
  { key: "supplies", label: "Supplies & Printing" },
  { key: "hospitality", label: "Meals & Hospitality" },
  { key: "transport", label: "Transport & Fuel" },
  { key: "welfare", label: "Welfare & Charity" },
  { key: "loans", label: "Loans & Advances" },
  { key: "other", label: "Other Expenses" },
];

// Chart of Accounts sub-type -> group key. Sub-types not listed here (such as
// "Other Expenses") fall through to the keyword rules.
export const INCOME_SUBTYPE_GROUP = {
  "Fee Income": "fees",
  "Grants & Donations": "donations",
};
export const EXPENSE_SUBTYPE_GROUP = {
  "Salaries & Wages": "salaries",
  "Rent & Utilities": "rent",
  "Maintenance": "maintenance",
  "Supplies": "supplies",
  "Transport": "transport",
};

// First match wins, so more specific rules come first (e.g. "Salary Advance"
// is a loan/advance, not a salary).
export const INCOME_RULES = [
  { group: "loans", match: /loan|advance/i },
  { group: "donations", match: /donat|welfare|zakat|sadaq|charity|grant/i },
  { group: "fees", match: /fee|tuition|tution|admission|registration|course|exam|tafseer/i },
];
export const EXPENSE_RULES = [
  { group: "loans", match: /loan|advance/i },
  { group: "salaries", match: /salar|wage|staff|bonus|allowance|payroll/i },
  { group: "welfare", match: /welfare|donat|gift|charity|zakat|sadaq/i },
  { group: "rent", match: /rent|utilit|electric|gas|water bill|internet|phone|mobile/i },
  { group: "maintenance", match: /maint|repair|fixture|furnit|equipment/i },
  { group: "supplies", match: /suppl|station|print|design|clean|laundry|drinking|water/i },
  { group: "hospitality", match: /entertain|refresh|guest|lunch|meal|food/i },
  { group: "transport", match: /fuel|transport|travel|petrol/i },
];

// Extra categories offered in the Expenses / Payments forms so the common
// heads can be recorded and reported consistently.
export const EXTRA_EXPENSE_CATEGORIES = [
  "Cleaning & Laundry", "Entertainment", "Lunch", "Furniture & Fixture", "Phone Package",
  "Drinking Water", "Printing & Designing", "Stationery", "Tuition Fee", "Fuel",
  "Salary Advance", "Loan Return", "Miscellaneous", "Welfare", "Gifts", "Suspense",
];
export const EXTRA_PAYMENT_CATEGORIES = [
  "Welfare", "Donation", "Loan", "Tafseer Course Fees", "Tuition Fee", "Miscellaneous",
];
