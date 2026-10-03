import { buildMonthlyStatement, statementPeriodLabel } from "./monthlyStatement";

const branches = [{ id: "b1", name: "Baneen" }, { id: "b2", name: "Banaat" }];
const accounts = [{ name: "Cash", subType: "Bank & Cash", balance: 1000 }];

const base = {
  year: 2026, month: 9, branches, accounts,
  invoices: [
    // Paid in September: split pro rata across fee + admission
    { branchId: "b1", paidAmount: 1000, paidDate: "2026-09-10", lineItems: [{ description: "Tuition Fee", amount: 800 }, { description: "Registration Fee", amount: 200 }] },
    { branchId: "b2", paidAmount: 500, paidDate: "2026-09-30", lineItems: [] },
    // Other month: ignored
    { branchId: "b1", paidAmount: 999, paidDate: "2026-08-31", lineItems: [] },
  ],
  expenses: [
    { branchId: "b1", category: "Utilities", amount: 300, date: "2026-09-02" },
    { branchId: "b1", category: "Utilities", amount: 100, date: "2026-10-01" },
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
};

const rowMap = (rows) => Object.fromEntries(rows.map((r) => [r.label, r.amount]));

test("prints every sheet head, in sheet order, including zero rows", () => {
  const s = buildMonthlyStatement({ year: 2026, month: 9, branches, accounts });
  expect(s.income.map((r) => r.label).slice(0, 4)).toEqual(["Baneen Fees", "Welfare", "Donation", "Admission Fees"]);
  expect(s.expense[0].label).toBe("Utility Baneen");
  expect(s.expense.at(-1).label).toBe("Suspense");
  expect(s.income.every((r) => r.amount === 0)).toBe(true);
});

test("routes income to the matching heads for the month", () => {
  const s = buildMonthlyStatement(base);
  expect(rowMap(s.income)).toMatchObject({
    "Baneen Fees": 800, "Admission Fees": 200, "Banaat Fees": 500, Donation: 250, Welfare: 0,
  });
  expect(s.totalIncome).toBe(1750);
});

test("routes expenses: category heads for Baneen, lumps for other branches", () => {
  const s = buildMonthlyStatement({
    ...base,
    expenses: [
      { branchId: "b1", category: "Utilities", amount: 300, date: "2026-09-02" },
      { branchId: "b1", category: "Welfare", amount: 70, date: "2026-09-03" },
      { branchId: "b2", category: "Utilities", amount: 120, date: "2026-09-04" }, // Banaat lump
      { branchId: "b1", category: "Utilities", amount: 100, date: "2026-10-01" }, // other month
    ],
  });
  expect(rowMap(s.expense)).toMatchObject({
    "Utility Baneen": 300, Welfare: 70, "Banaat Expense": 120, "Baneen Staff Salary": 400,
  });
  expect(s.totalExpense).toBe(890);
});

test("unmatched money lands in an Other row so totals still reconcile", () => {
  const s = buildMonthlyStatement({
    ...base,
    payments: [{ type: "cash_in", account: "Cash", amount: 40, category: "Mystery", date: "2026-09-15" }],
    expenses: [{ branchId: "b1", category: "Zakat run", amount: 55, date: "2026-09-02" }],
  });
  expect(s.income.at(-1)).toEqual({ label: "Other Income", amount: 40 });
  expect(s.expense.at(-1)).toEqual({ label: "Other Expense", amount: 55 });
});

test("opening balance carries prior movements; closing = opening + income - expense", () => {
  const s = buildMonthlyStatement(base);
  expect(s.openingBalance).toBe(1150);
  expect(s.closingBalance).toBe(s.openingBalance + s.totalIncome - s.totalExpense);
});

test("single-branch view leaves out organisation-wide account opening balances", () => {
  const s = buildMonthlyStatement({ ...base, includeAccountOpening: false });
  expect(s.openingBalance).toBe(150);
});

test("branch scope filter applies", () => {
  const s = buildMonthlyStatement({ ...base, inScope: (r) => r.branchId === "b2" });
  expect(s.totalIncome).toBe(500);
  expect(s.totalExpense).toBe(0);
  expect(rowMap(s.income)["Banaat Fees"]).toBe(500);
});

test("period label", () => {
  expect(statementPeriodLabel(2026, 9)).toBe("1st September to 30th September 2026");
  expect(statementPeriodLabel(2026, 2)).toBe("1st February to 28th February 2026");
});
