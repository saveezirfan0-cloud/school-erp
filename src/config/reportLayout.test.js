import {
  defaultLayout, normalizeLayout, isDefaultLayout, applyLayout, patchSection, patchHead, setOption,
  addCustomSection, removeCustomSection, addManualEntry, removeManualEntry, headId,
} from "./reportLayout";

const branches = [{ name: "Baneen", amount: 100 }];
const statement = {
  year: 2026, month: 9, from: "2026-09-01", to: "2026-09-30", openingBalance: 1000,
  income: {
    groups: [
      { key: "fees", label: "Fee Income", total: 700, heads: [{ label: "Tuition Fee", amount: 700, branches }] },
      { key: "loans", label: "Loans & Advances", total: 300, heads: [{ label: "Loan", amount: 300, branches }] },
    ], total: 1000,
  },
  expense: {
    groups: [
      { key: "rent", label: "Rent & Utilities", total: 400, heads: [{ label: "Utilities", amount: 400, branches }] },
      { key: "hospitality", label: "Meals & Hospitality", total: 100, heads: [{ label: "Lunch", amount: 100, branches }] },
    ], total: 500,
  },
};

test("default layout changes nothing", () => {
  const out = applyLayout(statement, null);
  expect(out.totalIncome).toBe(1000);
  expect(out.totalExpense).toBe(500);
  expect(out.closingBalance).toBe(1500);
  expect(out.income.groups.map((g) => g.label)).toEqual(["Fee Income", "Loans & Advances"]);
});

test("normalizeLayout survives junk and older shapes", () => {
  expect(normalizeLayout("nope")).toEqual(defaultLayout());
  expect(normalizeLayout({ options: { shareBars: false }, manual: [{ nope: 1 }] }).options.shareBars).toBe(false);
  expect(normalizeLayout({ manual: [{ nope: 1 }] }).manual).toEqual([]);
});

test("rename a section and a head", () => {
  let l = patchSection(defaultLayout(), "income:fees", { label: "School Fees" });
  l = patchHead(l, headId("income", "Tuition Fee"), { label: "Monthly Fee" });
  const g = applyLayout(statement, l).income.groups[0];
  expect(g.label).toBe("School Fees");
  expect(g.heads[0].label).toBe("Monthly Fee");
});

test("hidden sections and heads leave the totals and are reported", () => {
  let l = patchSection(defaultLayout(), "expense:hospitality", { hidden: true });
  l = patchHead(l, headId("income", "Loan"), { hidden: true });
  const out = applyLayout(statement, l);
  expect(out.totalExpense).toBe(400);
  expect(out.expense.hiddenAmount).toBe(100);
  expect(out.totalIncome).toBe(700);
  expect(out.income.hiddenAmount).toBe(300);
});

test("an excluded section stays visible but is not counted", () => {
  const out = applyLayout(statement, patchSection(defaultLayout(), "income:loans", { excluded: true }));
  expect(out.income.groups.map((g) => g.key)).toEqual(["fees", "loans"]);
  expect(out.income.groups[1].excluded).toBe(true);
  expect(out.totalIncome).toBe(700);
  expect(out.income.excludedAmount).toBe(300);
  expect(out.closingBalance).toBe(1000 + 700 - 500);
});

test("moving a head to another or a custom section", () => {
  let l = patchHead(defaultLayout(), headId("expense", "Lunch"), { group: "rent" });
  let out = applyLayout(statement, l);
  expect(out.expense.groups.map((g) => g.key)).toEqual(["rent"]);
  expect(out.expense.groups[0].total).toBe(500);

  l = addCustomSection(defaultLayout(), "expense", "Events");
  const key = l.custom[0].key;
  l = patchHead(l, headId("expense", "Lunch"), { group: key });
  out = applyLayout(statement, l);
  expect(out.expense.groups.find((g) => g.key === key).label).toBe("Events");
  // deleting the section sends its heads back home
  out = applyLayout(statement, removeCustomSection(l, "expense", key));
  expect(out.expense.groups.map((g) => g.key)).toEqual(["rent", "hospitality"]);
});

test("a head pointing at a section that no longer exists falls back to its own", () => {
  const l = patchHead(defaultLayout(), headId("expense", "Lunch"), { group: "custom-gone" });
  expect(applyLayout(statement, l).expense.groups.map((g) => g.key)).toEqual(["rent", "hospitality"]);
});

test("manual entries: one month or every month, add and remove", () => {
  let l = addManualEntry(defaultLayout(), { side: "income", group: "donations", label: "Cash box", amount: 250, month: "2026-09" });
  l = addManualEntry(l, { side: "expense", group: "other", label: "Petty", amount: 30, month: "" });
  l = addManualEntry(l, { side: "expense", group: "other", label: "Ignored", amount: 0 });
  expect(l.manual).toHaveLength(2);

  let out = applyLayout(statement, l);
  expect(out.totalIncome).toBe(1250);
  expect(out.totalExpense).toBe(530);
  expect(out.income.groups.find((g) => g.key === "donations").heads[0].manual).toBe(true);

  out = applyLayout({ ...statement, month: 10, from: "2026-10-01", to: "2026-10-31" }, l); // October: only the every-month line
  expect(out.totalIncome).toBe(1000);
  expect(out.totalExpense).toBe(530);

  out = applyLayout(statement, removeManualEntry(l, l.manual[0].id));
  expect(out.totalIncome).toBe(1000);
});

test("undoing every override returns to the default layout", () => {
  let l = patchSection(defaultLayout(), "income:fees", { label: "X", hidden: true });
  l = patchSection(l, "income:fees", { label: "", hidden: false });
  expect(isDefaultLayout(l)).toBe(true);
  expect(isDefaultLayout(setOption(l, "shareBars", false))).toBe(false);
});

test("over a quarter, every-month lines count once per month and a one-month line counts once", () => {
  let l = addManualEntry(defaultLayout(), { side: "income", group: "other", label: "Rent received", amount: 100, month: "" });
  l = addManualEntry(l, { side: "income", group: "other", label: "One-off", amount: 50, month: "2026-08" });
  l = addManualEntry(l, { side: "income", group: "other", label: "Outside", amount: 999, month: "2026-12" });
  const q3 = applyLayout({ ...statement, from: "2026-07-01", to: "2026-09-30" }, l);
  expect(q3.totalIncome).toBe(1000 + 300 + 50);
});
