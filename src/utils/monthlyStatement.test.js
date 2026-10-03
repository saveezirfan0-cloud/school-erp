import {
  buildMonthlyStatement, statementPeriodLabel, percentChange, statementCsvRows,
  monthsBetween, isSingleMonth, previousRange, rangeLabel, fmtMoney,
} from "./monthlyStatement";

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

test("an invoice marked paid with no recorded amount counts in full, less concession, by created date", () => {
  const s = buildMonthlyStatement({
    ...base, expenses: [], payslips: [], payments: [], journals: [],
    invoices: [{ branchId: "b1", status: "paid", amount: 1000, concessionAmount: 100, createdAt: "2026-09-12T08:00:00Z", lineItems: [{ description: "Tuition Fee", amount: 1000 }] }],
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

test("journals auto-posted from expenses are not counted twice", () => {
  const s = buildMonthlyStatement({
    ...base, payslips: [], payments: [], invoices: [],
    expenses: [{ branchId: "b1", category: "Repairs and maintenance", amount: 120, date: "2026-09-20" }],
    journals: [
      { date: "2026-09-20", debitAccount: "Repairs and maintenance", creditAccount: "Cash", amount: 120, source: "expense", sourceId: "e1" },
    ],
  });
  expect(head(s.expense, "maintenance", "Repairs and maintenance").amount).toBe(120);
});

test("journals auto-posted from fee and salary payments are not counted twice", () => {
  const s = buildMonthlyStatement({
    ...base, expenses: [], payslips: [], payments: [], invoices: [],
    journals: [
      { date: "2026-09-20", debitAccount: "Repairs and maintenance", creditAccount: "Cash", amount: 50, source: "payment", sourceId: "p1" },
      { date: "2026-09-21", debitAccount: "Cash", creditAccount: "Donation", amount: 70, source: "payment", sourceId: "p2" },
    ],
  });
  expect(s.totalExpense).toBe(0);
  expect(s.totalIncome).toBe(0);
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

test("a custom range replaces the calendar month", () => {
  const s = buildMonthlyStatement({ ...base, from: "2026-08-25", to: "2026-09-12", payments: [], invoices: [] });
  // expenses on 09-02, 09-03, 09-04 are inside; 10-01 is outside
  expect(s.totalExpense).toBe(300 + 100 + 40 + 400);
  expect(s.month).toBe(8);
  expect(s.from).toBe("2026-08-25");
});

test("source filter keeps only the chosen kinds of record", () => {
  const onlyExpenses = buildMonthlyStatement({ ...base, sources: ["expenses"] });
  expect(onlyExpenses.totalIncome).toBe(0);
  expect(onlyExpenses.totalExpense).toBe(440); // no payroll
  const feesAndPayroll = buildMonthlyStatement({ ...base, sources: ["fees", "payroll"] });
  expect(feesAndPayroll.totalIncome).toBe(1500);
  expect(feesAndPayroll.totalExpense).toBe(400);
});

test("account filter keeps money that moved through that account", () => {
  const s = buildMonthlyStatement({
    ...base,
    accounts: [...accounts, { name: "Meezan", subType: "Bank & Cash", type: "Assets", balance: 0 }],
    invoices: [{ branchId: "b1", paidAmount: 300, paidAccount: "Meezan", paidDate: "2026-09-10", lineItems: [] },
               { branchId: "b1", paidAmount: 700, paidAccount: "Cash", paidDate: "2026-09-10", lineItems: [] }],
    expenses: [{ branchId: "b1", category: "Rent", amount: 50, date: "2026-09-02", paidAccount: "Meezan" },
               { branchId: "b1", category: "Rent", amount: 80, date: "2026-09-02", paidAccount: "Cash" }],
    payslips: [], payments: [], account: "Meezan",
  });
  expect(s.totalIncome).toBe(300);
  expect(s.totalExpense).toBe(50);
  expect(s.cashAccounts.map((a) => a.name)).toEqual([]); // Meezan has no movements in this fixture
});

test("range helpers", () => {
  expect(monthsBetween("2026-07-01", "2026-09-30")).toEqual(["2026-07", "2026-08", "2026-09"]);
  expect(monthsBetween("2026-11-15", "2027-01-02")).toEqual(["2026-11", "2026-12", "2027-01"]);
  expect(isSingleMonth("2026-09-01", "2026-09-30")).toBe(true);
  expect(isSingleMonth("2026-09-01", "2026-10-31")).toBe(false);
  expect(previousRange("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  expect(previousRange("2026-01-01", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  expect(previousRange("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  expect(previousRange("2026-09-11", "2026-09-20")).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  expect(rangeLabel("2026-09-01", "2026-09-30")).toBe("1st September to 30th September 2026");
  expect(rangeLabel("2026-07-01", "2026-09-30")).toBe("1 Jul 2026 to 30 Sep 2026");
  expect(fmtMoney(-38600)).toBe("−Rs. 38,600");
  expect(fmtMoney(1200)).toBe("Rs. 1,200");
});
