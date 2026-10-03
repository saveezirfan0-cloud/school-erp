import { monthsInRange, lineStatus, computeBudget, editorRows, diffBudgets, statusText } from "./budgetData";
import { computeFinancials, prepareData, presetRange } from "./reportData";

const d = (y, m, day) => new Date(y, m - 1, day);
const endOf = (y, m, day) => new Date(y, m - 1, day, 23, 59, 59, 999);
const TODAY = new Date(2026, 5, 15); // 15 Jun 2026

describe("monthsInRange", () => {
  test("whole months count as one each", () => {
    expect(monthsInRange({ from: d(2026, 1, 1), to: endOf(2026, 3, 31) })).toBeCloseTo(3);
    expect(monthsInRange({ from: d(2026, 1, 1), to: endOf(2026, 12, 31) })).toBeCloseTo(12);
  });
  test("part months are pro-rated by days", () => {
    expect(monthsInRange({ from: d(2026, 6, 1), to: endOf(2026, 6, 15) })).toBeCloseTo(0.5);
    expect(monthsInRange({ from: d(2026, 1, 16), to: endOf(2026, 2, 28) })).toBeCloseTo(16 / 31 + 1);
  });
  test("empty or inverted ranges are zero", () => {
    expect(monthsInRange({ from: null, to: null })).toBe(0);
    expect(monthsInRange({ from: d(2026, 3, 1), to: endOf(2026, 2, 1) })).toBe(0);
  });
});

test("lineStatus", () => {
  expect(lineStatus("expense", 100, 120)).toBe("over");
  expect(lineStatus("expense", 100, 90)).toBe("near");
  expect(lineStatus("expense", 100, 50)).toBe("ok");
  expect(lineStatus("expense", 0, 10)).toBe("unbudgeted");
  expect(lineStatus("expense", 0, 0)).toBe("none");
  expect(lineStatus("income", 100, 100)).toBe("met");
  expect(lineStatus("income", 100, 90)).toBe("near");
  expect(lineStatus("income", 100, 10)).toBe("behind");
  expect(lineStatus("income", 0, 10)).toBe("none");
});

describe("computeBudget", () => {
  const data = prepareData({
    invoices: [{ id: "i", studentId: "s", branchId: "b1", amount: 5000, paidAmount: 5000, status: "paid", month: "March", year: 2026, paidDate: "2026-03-05" }],
    expenses: [
      { id: "e1", category: "Utilities", amount: 900, date: "2026-03-10", branchId: "b1" },
      { id: "e2", category: "Repairs", amount: 300, date: "2026-03-11", branchId: "b1" },
      { id: "e3", category: "Utilities", amount: 50, date: "2026-03-12", branchId: "b2" },
    ],
    payslips: [{ id: "p", role: "Teacher", netPay: 2000, month: "March", year: 2026, status: "paid", branchId: "b1" }],
  });
  const range = { from: d(2026, 3, 1), to: endOf(2026, 3, 31) };
  const budgets = [
    { id: "x1", kind: "income", category: "Fee income", amount: 6000, branchId: "b1" },
    { id: "x2", kind: "expense", category: "utilities ", amount: 1000, branchId: "b1" }, // case/space-insensitive match
    { id: "x3", kind: "payroll", category: "Salaries & payroll", amount: 1800, branchId: "b1" },
    { id: "x4", kind: "expense", category: "Utilities", amount: 500, branchId: "b2" },
  ];

  test("per-branch budget vs actual with statuses", () => {
    const fin = computeFinancials(data, { range, branch: "b1" });
    const r = computeBudget({ budgets, fin, range, branch: "b1", today: TODAY });
    expect(r.months).toBeCloseTo(1);
    const by = Object.fromEntries(r.lines.map(l => [l.label, l]));
    expect(by["Fee income"]).toMatchObject({ budget: 6000, actual: 5000, status: "behind" });
    expect(by.Utilities).toMatchObject({ budget: 1000, actual: 900, status: "near" });
    expect(by.Repairs).toMatchObject({ budget: 0, actual: 300, status: "unbudgeted" });
    expect(by["Salaries & payroll"]).toMatchObject({ budget: 1800, actual: 2000, status: "over", variance: 200 });
    expect(r.expenseBudget).toBe(2800);
    expect(r.expenseActual).toBe(900 + 300 + 2000);
    expect(r.netBudget).toBe(6000 - 2800);
    expect(r.netActual).toBe(5000 - 3200);
    expect(r.over.map(l => l.label).sort()).toEqual(["Repairs", "Salaries & payroll"]);
    expect(r.hasBudget).toBe(true);
  });

  test("all branches adds every branch's budget", () => {
    const fin = computeFinancials(data, { range, branch: "all" });
    const r = computeBudget({ budgets, fin, range, branch: "all", today: TODAY });
    expect(r.lines.find(l => l.label === "Utilities")).toMatchObject({ budget: 1500, actual: 950 });
  });

  test("budget is pro-rated only up to today", () => {
    const year = presetRange("thisYear", TODAY);
    const fin = computeFinancials(data, { range: year, branch: "b1" });
    const r = computeBudget({ budgets, fin, range: year, branch: "b1", today: TODAY });
    expect(r.months).toBeCloseTo(5.5); // Jan–May plus half of June
    expect(r.proRatedTo.getMonth()).toBe(5);
  });

  test("no budgets at all", () => {
    const fin = computeFinancials(data, { range, branch: "b1" });
    const r = computeBudget({ budgets: [], fin, range, branch: "b1", today: TODAY });
    expect(r.hasBudget).toBe(false);
    expect(r.expensePct).toBeNull();
  });
});

describe("editor", () => {
  const budgets = [
    { id: "x1", kind: "income", category: "Fee income", amount: 6000 },
    { id: "x2", kind: "expense", category: "utilities", amount: 1000 },
  ];
  test("editorRows lists income, categories (budgeted + seen) and payroll, using the expenses' casing", () => {
    const rows = editorRows(budgets, ["Utilities", "Repairs", " "]);
    expect(rows.map(r => `${r.kind}:${r.category}`)).toEqual(["income:Fee income", "expense:Repairs", "expense:Utilities", "payroll:Salaries & payroll"]);
    expect(rows[0]).toMatchObject({ id: "x1", amount: "6000" });
    expect(rows[1]).toMatchObject({ id: "", amount: "" });
  });
  test("diffBudgets creates, updates, deletes and ignores no-ops", () => {
    const edited = [
      { kind: "income", category: "Fee income", id: "x1", amount: "6000" },        // unchanged
      { kind: "expense", category: "Utilities", id: "x2", amount: "1200" },        // update
      { kind: "expense", category: "Repairs", id: "", amount: "300" },             // create
      { kind: "expense", category: "Events", id: "", amount: "" },                 // blank new line: nothing
      { kind: "payroll", category: "Salaries & payroll", id: "", amount: "0" },    // zero new line: nothing
    ];
    expect(diffBudgets(budgets, edited)).toEqual({
      creates: [{ kind: "expense", category: "Repairs", amount: 300 }],
      updates: [{ id: "x2", amount: 1200 }],
      deletes: [],
    });
    expect(diffBudgets(budgets, [{ kind: "expense", category: "Utilities", id: "x2", amount: "" }]).deletes).toEqual(["x2"]);
  });
  test("statusText", () => {
    expect(statusText({ status: "over", kind: "expense", variance: 250 })).toBe("Over by Rs. 250");
    expect(statusText({ status: "ok", kind: "expense", variance: -400 })).toBe("Rs. 400 left");
    expect(statusText({ status: "met", kind: "income" })).toBe("Target met");
    expect(statusText({ status: "none", kind: "expense" })).toBe("");
  });
});
