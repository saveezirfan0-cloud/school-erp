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

test("groups income and expenses by branch head for the month", () => {
  const s = buildMonthlyStatement(base);
  expect(s.income).toEqual([
    { label: "Banaat Fees", amount: 500 },
    { label: "Baneen Admission Fees", amount: 200 },
    { label: "Baneen Fees", amount: 800 },
    { label: "Donation", amount: 250 },
  ]);
  expect(s.expense).toEqual([
    { label: "Salaries — Baneen", amount: 400 },
    { label: "Utilities — Baneen", amount: 300 },
  ]);
  expect(s.totalIncome).toBe(1750);
  expect(s.totalExpense).toBe(700);
});

test("opening balance carries prior movements; closing = opening + income - expense", () => {
  const s = buildMonthlyStatement(base);
  expect(s.openingBalance).toBe(1150);
  expect(s.closingBalance).toBe(1150 + 1750 - 700);
});

test("branch scope filter applies", () => {
  const s = buildMonthlyStatement({ ...base, inScope: (r) => r.branchId === "b2" });
  expect(s.totalIncome).toBe(500);
  expect(s.totalExpense).toBe(0);
});

test("period label", () => {
  expect(statementPeriodLabel(2026, 9)).toBe("1st September to 30th September 2026");
  expect(statementPeriodLabel(2026, 2)).toBe("1st February to 28th February 2026");
});
