import { buildYearTable, yearCsvRows, buildBranchMatrix, buildOutstanding, summaryText } from "./reportViews";
import { applyLayout, defaultLayout } from "../config/reportLayout";
import { buildMonthlyStatement, monthRange } from "./monthlyStatement";

const branches = [{ id: "b1", name: "Baneen" }, { id: "b2", name: "Banaat" }];
const accounts = [{ name: "Cash", subType: "Bank & Cash", type: "Assets", balance: 1000 }];
const raw = {
  accounts, journals: [], payments: [], payslips: [],
  invoices: [
    { branchId: "b1", paidAmount: 500, paidDate: "2026-01-10", lineItems: [] },
    { branchId: "b2", paidAmount: 300, paidDate: "2026-03-10", lineItems: [] },
  ],
  expenses: [{ branchId: "b1", category: "Utilities", amount: 200, date: "2026-02-05" }],
};
const month = (m, extra = {}) => {
  const r = monthRange(2026, m);
  return applyLayout(buildMonthlyStatement({ year: 2026, month: m, from: r.from, to: r.to, ...raw, branches, ...extra }), defaultLayout());
};

test("year table: sections by month, totals, and balances that roll forward", () => {
  const t = buildYearTable(Array.from({ length: 12 }, (_, i) => month(i + 1)));
  const fees = t.income.rows.find((r) => r.key === "fees");
  expect(fees.values.slice(0, 3)).toEqual([500, 0, 300]);
  expect(fees.total).toBe(800);
  expect(t.income.total).toBe(800);
  expect(t.expense.total).toBe(200);
  expect(t.net.slice(0, 3)).toEqual([500, -200, 300]);
  expect(t.netTotal).toBe(600);
  expect(t.opening[0]).toBe(1000);
  expect(t.closing[0]).toBe(1500);
  expect(t.opening[1]).toBe(1500);
  expect(t.closing[11]).toBe(1600);
  expect(t.monthsWithActivity).toBe(3);
  const csv = yearCsvRows(t, 2026);
  expect(csv[0][0]).toBe("");
  expect(csv[0]).toHaveLength(14);
  expect(csv.at(-1)[0]).toBe("Closing balance");
});

test("branch matrix puts each branch in its own column", () => {
  const scoped = (id) => month(1, { inScope: (r) => (r.branchId || "") === id });
  const m = buildBranchMatrix([{ id: "b1", name: "Baneen", statement: scoped("b1") }, { id: "b2", name: "Banaat", statement: scoped("b2") }]);
  expect(m.branches.map((b) => b.name)).toEqual(["Baneen", "Banaat"]);
  expect(m.income.rows[0].values).toEqual([500, 0]);
  expect(m.income.totals).toEqual([500, 0]);
  expect(m.nets).toEqual([500, 0]);
});

test("outstanding: pending fees by branch up to the period end, and unpaid payslips up to that month", () => {
  const o = buildOutstanding({
    branches, year: 2026, month: 9,
    invoices: [
      { branchId: "b1", status: "pending", amount: 1000, paidAmount: 0, date: "2026-08-01" },
      { branchId: "b2", status: "partial", amount: 800, paidAmount: 300, date: "2026-09-01" },
      { branchId: "b1", status: "pending", amount: 999, paidAmount: 0, date: "2026-10-05" }, // issued after the period
      { branchId: "b1", status: "paid", amount: 100, paidAmount: 100, date: "2026-08-01" },
    ],
    payslips: [
      { status: "pending", netPay: 400, month: "August", year: 2026 },
      { status: "pending", netPay: 777, month: "November", year: 2026 }, // a later month
      { status: "paid", netPay: 50, month: "August", year: 2026 },
    ],
  });
  expect(o.fees.total).toBe(1500);
  expect(o.fees.count).toBe(2);
  expect(o.fees.byBranch).toEqual([{ name: "Baneen", amount: 1000 }, { name: "Banaat", amount: 500 }]);
  expect(o.salaries).toEqual({ total: 400, count: 1 });
  // a custom range end
  expect(buildOutstanding({ ...{ branches, invoices: [{ branchId: "b1", status: "pending", amount: 10, paidAmount: 0, date: "2026-09-20" }], payslips: [] }, year: 2026, month: 9, to: "2026-09-10" }).fees.total).toBe(0);
});

test("summary text for sharing", () => {
  const st = month(1);
  const txt = summaryText(st, { scopeLabel: "All branches", outstanding: { fees: { total: 900 }, salaries: { total: 0 } } });
  expect(txt).toContain("Zohra Majeed Islamic Institute");
  expect(txt).toContain("1st January to 31st January 2026");
  expect(txt).toContain("Total income: Rs. 500");
  expect(txt).toContain("Closing balance: Rs. 1,500");
  expect(txt).toContain("Pending fees Rs. 900");
  expect(summaryText(st, { lang: "ur" })).toContain("کل آمدن");
});
