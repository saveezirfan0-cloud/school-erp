import { buildMonthlyStatement, statementPeriodLabel, percentChange, statementCsvRows } from "./monthlyStatement";

const branches = [{ id: "b1", name: "Baneen" }, { id: "b2", name: "Banaat" }];
const accounts = [
  { name: "Cash", subType: "Bank & Cash", type: "Assets", balance: 1000 },
  { name: "Donation", type: "Income", subType: "Grants & Donations" },
  { name: "Repairs and maintenance", type: "Expenses", subType: "Maintenance" },
  { name: "Cleaning Expense", type: "Expenses", subType: "Supplies" },
];

const base = {
  year: 2026, month: 9, branches, accounts,
  invoices: [
    // Paid in September, split pro rata across two line items
    { branchId: "b1", paidAmount: 1000, paidDate: "2026-09-10", lineItems: [{ description: "Tuition Fee", amount: 800 }, { description: "Registration Fee", amount: 200 }] },
    { branchId: "b2", paidAmount: 500, paidDate: "2026-09-30", lineItems: [{ description: "Tuition Fee", amount: 500 }] },
    // Other month: ignored
    { branchId: "b1", paidAmount: 999, paidDate: "2026-08-31", lineItems: [] },
  ],
  expenses: [
    { branchId: "b1", category: "Utilities", amount: 300, date: "2026-09-02" },
    { branchId: "b2", category: "Utilities", amount: 100, date: "2026-09-03" },
    { branchId: "b1", category: "Utilities", amount: 100, date: "2026-10-01" },
    { branchId: "b1", category: "Lunch", amount: 40, date: "2026-09-04" },
  ],
  payslips: [
    { branchId: "b1", status: "paid", paidDate: "2026-09-05", netPay: 400 },
    { branchId: "b1", status: "pending", paidDate: "", netPay: 777 },
  ],
  payments: [
    { type: "cash_in", account: "Cash", amount: 250, category: "Donation", date: "2026-09-15" },
    { type: "cash_in", account: "Cash", amount: 500, category: "Fee Collection", source: "invoice", date: "2026-09-10" },
    { type: "cash_in", account: "Cash", amount: 90, category: "Bank Deposit", date: "2026-09-11" },
    { type: "cash_in", account: "Cash", amount: 60, category: "Welfare", date: "2026-09-12", reversed: true },
    // Before the month: feeds the opening balance (1000 + 200 - 50)
    { type: "cash_in", account: "Cash", amount: 200, category: "Donation", date: "2026-08-20" },
    { type: "cash_out", account: "Cash", amount: 50, category: "Rent", date: "2026-08-21" },
  ],
  journals: [],
};

const head = (section, group, label) => section.groups.find((g) => g.key === group)?.heads.find((h) => h.label === label);

test("fee income is split by line item, with a branch breakdown", () => {
  const s = buildMonthlyStatement(base);
  expect(head(s.income, "fees", "Tuition Fee").amount).toBe(1300); // 800 + 500
  expect(head(s.income, "fees", "Tuition Fee").branches).toEqual([
    { name: "Baneen", amount: 800 }, { name: "Banaat", amount: 500 },
  ]);
  expect(head(s.income, "fees", "Registration Fee").amount).toBe(200);
});

// DEFINITION CHANGE (audit ACC-04, utils/reporting.js): this used to expect
// 900, i.e. an invoice marked paid with no recorded amount was treated as
// collected in full less concession. Income is now cash actually recorded
// against the invoice; "marked paid, no money" is reported separately
// (Books Check) and is not income.
test("an invoice marked paid with no recorded amount is NOT income", () => {
  const s = buildMonthlyStatement({
    ...base, expenses: [], payslips: [], payments: [], journals: [],
    invoices: [{ branchId: "b1", status: "paid", amount: 1000, concessionAmount: 100, createdAt: "2026-09-12T08:00:00Z", lineItems: [{ description: "Tuition Fee", amount: 1000 }] }],
  });
  expect(s.totalIncome).toBe(0);
});

test("an invoice with money recorded is income by its paid date, concession excluded", () => {
  const s = buildMonthlyStatement({
    ...base, expenses: [], payslips: [], payments: [], journals: [],
    invoices: [{ branchId: "b1", status: "paid", amount: 1000, paidAmount: 900, concessionAmount: 100, createdAt: "2026-09-12T08:00:00Z", lineItems: [{ description: "Tuition Fee", amount: 1000 }] }],
  });
  expect(s.totalIncome).toBe(900);
});

test("non-invoice cash-in lands in a section by chart of accounts / keywords; transfers and reversals are skipped", () => {
  const s = buildMonthlyStatement(base);
  expect(head(s.income, "donations", "Donation").amount).toBe(250);
  expect(s.income.groups.flatMap((g) => g.heads.map((h) => h.label))).not.toContain("Bank Deposit");
  expect(s.income.groups.flatMap((g) => g.heads.map((h) => h.label))).not.toContain("Welfare");
  expect(s.totalIncome).toBe(1750);
});

test("expenses are grouped by section, payroll goes to Salaries, other months are ignored", () => {
  const s = buildMonthlyStatement(base);
  expect(head(s.expense, "rent", "Utilities").amount).toBe(400);
  expect(head(s.expense, "hospitality", "Lunch").amount).toBe(40);
  expect(head(s.expense, "salaries", "Staff Salaries (payroll)").amount).toBe(400);
  expect(s.totalExpense).toBe(840);
});

test("chart of accounts sub-type decides the section before keywords", () => {
  const s = buildMonthlyStatement({
    ...base,
    expenses: [
      { branchId: "b1", category: "Repairs and maintenance", amount: 70, date: "2026-09-03" },
      { branchId: "b1", category: "Cleaning Expense", amount: 30, date: "2026-09-03" },
    ],
    payslips: [], payments: [], invoices: [],
  });
  expect(head(s.expense, "maintenance", "Repairs and maintenance").amount).toBe(70);
  expect(head(s.expense, "supplies", "Cleaning Expense").amount).toBe(30);
});

test("unknown categories go to Other; empty sections are omitted; groups keep config order", () => {
  const s = buildMonthlyStatement({
    ...base,
    expenses: [
      { branchId: "b1", category: "Zakat run", amount: 55, date: "2026-09-02" },
      { branchId: "b1", category: "Wages", amount: 5, date: "2026-09-02" },
    ],
    payslips: [], payments: [], invoices: [],
  });
  expect(s.expense.groups.map((g) => g.key)).toEqual(["salaries", "welfare"]); // "Zakat" is welfare by keyword
  const o = buildMonthlyStatement({ ...base, expenses: [{ branchId: "b1", category: "Mystery", amount: 9, date: "2026-09-02" }], payslips: [] });
  expect(head(o.expense, "other", "Mystery").amount).toBe(9);
});

test("journals to Income/Expense accounts are included", () => {
  const s = buildMonthlyStatement({
    ...base, expenses: [], payslips: [], payments: [], invoices: [],
    journals: [
      { date: "2026-09-20", debitAccount: "Repairs and maintenance", creditAccount: "Cash", amount: 120 },
      { date: "2026-09-21", debitAccount: "Cash", creditAccount: "Donation", amount: 80 },
      { date: "2026-09-22", debitAccount: "Cash", creditAccount: "Petty Cash", amount: 999 }, // asset move
    ],
  });
  expect(head(s.expense, "maintenance", "Repairs and maintenance").amount).toBe(120);
  expect(head(s.income, "donations", "Donation").amount).toBe(80);
});

test("opening balance carries prior movements; closing = opening + income - expense", () => {
  const s = buildMonthlyStatement(base);
  expect(s.openingBalance).toBe(1150);
  expect(s.closingBalance).toBe(s.openingBalance + s.totalIncome - s.totalExpense);
  expect(s.net).toBe(s.totalIncome - s.totalExpense);
});

test("bank & cash accounts show opening, in, out and ledger closing", () => {
  // Every posted payment counts here (like the Bank & Cash page), including the
  // flagged-reversed row: 250 + 500 + 90 + 60 = 900 in during September.
  const s = buildMonthlyStatement(base);
  expect(s.cashAccounts).toEqual([{ name: "Cash", opening: 1150, moneyIn: 900, moneyOut: 0, closing: 2050 }]);
  expect(s.ledgerClosing).toBe(2050);
});

test("single-branch view leaves out organisation-wide account opening balances", () => {
  const s = buildMonthlyStatement({ ...base, includeAccountOpening: false });
  expect(s.openingBalance).toBe(150);
});

test("branch scope filter applies", () => {
  const s = buildMonthlyStatement({ ...base, inScope: (r) => r.branchId === "b2" });
  expect(s.totalIncome).toBe(500);
  expect(s.totalExpense).toBe(100);
});

test("helpers", () => {
  expect(statementPeriodLabel(2026, 9)).toBe("1st September to 30th September 2026");
  expect(statementPeriodLabel(2026, 2)).toBe("1st February to 28th February 2026");
  expect(percentChange(150, 100)).toBe(50);
  expect(percentChange(50, 0)).toBeNull();
  const rows = statementCsvRows(buildMonthlyStatement(base));
  expect(rows[0]).toEqual(["Opening Balance", "", "", "", 1150]);
  expect(rows.at(-1)[0]).toBe("Closing Balance");
});
