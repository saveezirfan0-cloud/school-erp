import { defaultFilters, periodRange, activeFilterCount, filterStatement, SOURCES } from "./reportFilters";

test("period ranges: month, quarter, custom, and a bad custom range falls back", () => {
  const f = defaultFilters();
  expect(periodRange(f, 2026, 9)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  expect(periodRange({ ...f, mode: "quarter", quarter: 3 }, 2026, 1)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  expect(periodRange({ ...f, mode: "quarter", quarter: 1 }, 2028, 5)).toEqual({ from: "2028-01-01", to: "2028-03-31" });
  expect(periodRange({ ...f, mode: "custom", from: "2026-08-15", to: "2026-09-20" }, 2026, 1)).toEqual({ from: "2026-08-15", to: "2026-09-20" });
  expect(periodRange({ ...f, mode: "custom", from: "2026-09-20", to: "2026-08-15" }, 2026, 9)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  expect(periodRange({ ...f, mode: "custom", from: "", to: "" }, 2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
});

test("activeFilterCount ignores the period and 'all kinds'", () => {
  const f = defaultFilters();
  expect(activeFilterCount(f)).toBe(0);
  expect(activeFilterCount({ ...f, mode: "quarter" })).toBe(0);
  expect(activeFilterCount({ ...f, sources: SOURCES.map((s) => s.id) })).toBe(0);
  expect(activeFilterCount({ ...f, branches: ["b1"], sources: ["fees"], account: "Cash", search: " x ", minAmount: "100" })).toBe(5);
});

const item = (text, amount, branch = "Baneen", source = "Expense") => ({ date: "2026-09-01", text, amount, branch, source });
const st = {
  openingBalance: 1000,
  income: { total: 500, hiddenAmount: 0, excludedAmount: 0, budgetTotal: 0, groups: [
    { key: "fees", label: "Fee Income", total: 500, budget: 0, heads: [{ label: "Tuition Fee", amount: 500, branches: [{ name: "Baneen", amount: 500 }], items: [item("Ali — September", 300, "Baneen", "Fee invoice"), item("Sara — September", 200, "Banaat", "Fee invoice")] }] },
  ] },
  expense: { total: 450, hiddenAmount: 0, excludedAmount: 0, budgetTotal: 0, groups: [
    { key: "rent", label: "Rent & Utilities", total: 400, budget: 0, heads: [
      { label: "Utilities", amount: 300, branches: [{ name: "Baneen", amount: 300 }], items: [item("Gas bill", 100), item("Electricity bill", 200)] },
      { label: "Rent", amount: 100, branches: [{ name: "Baneen", amount: 100 }], items: [item("Building rent", 100)] },
    ] },
    { key: "supplies", label: "Supplies & Printing", total: 50, budget: 0, heads: [{ label: "Stationery", amount: 50, branches: [{ name: "Baneen", amount: 50 }], items: [item("Markers", 50)] }] },
  ] },
};

test("no search or minimum leaves the statement untouched", () => {
  expect(filterStatement(st, defaultFilters())).toBe(st);
});

test("search matches heads (whole head) or records (only matching records count)", () => {
  const byHead = filterStatement(st, { ...defaultFilters(), search: "rent" });
  // "Rent & Utilities" section name matches, so both its heads stay whole; Stationery has no match
  expect(byHead.expense.groups.map((g) => g.key)).toEqual(["rent"]);
  expect(byHead.totalExpense).toBe(400);

  const byRecord = filterStatement(st, { ...defaultFilters(), search: "gas" });
  expect(byRecord.expense.groups[0].heads).toHaveLength(1);
  expect(byRecord.expense.groups[0].heads[0].amount).toBe(100); // only the gas bill
  expect(byRecord.totalExpense).toBe(100);
  expect(byRecord.totalIncome).toBe(0);
  expect(byRecord.closingBalance).toBe(1000 + 0 - 100);

  const byBranch = filterStatement(st, { ...defaultFilters(), search: "banaat" });
  expect(byBranch.income.groups[0].heads[0].amount).toBe(200);
  expect(byBranch.income.groups[0].heads[0].branches).toEqual([{ name: "Banaat", amount: 200 }]);
});

test("minimum amount hides small heads and drops empty sections", () => {
  const out = filterStatement(st, { ...defaultFilters(), minAmount: "100" });
  expect(out.expense.groups.map((g) => g.key)).toEqual(["rent"]); // Stationery (50) gone
  expect(out.totalExpense).toBe(400);
});
