// src/utils/budgetData.js
//
// Budget vs actual. A budget row is a MONTHLY amount for one line:
//   { id, kind: "income" | "payroll" | "expense", category, amount, branchId }
// kind "income" is the fee-collection target, "payroll" the salary budget and
// "expense" one operating-expense category. Rows with branchId "" belong to
// the Main Office. For a period, the budget is the monthly amount times the
// months covered (part months pro-rated by days), and only up to today — a
// full-year budget set against nine months of actuals would always look
// "under budget".

import { matchesBranch } from "./branchFilter";
import { startOfDay, endOfDay, formatRs } from "./reportData";

const num = (v) => Number(v) || 0;
const norm = (s) => (s || "").toString().trim().replace(/\s+/g, " ");
const keyOf = (s) => norm(s).toLowerCase();
const dayCount = (a, b) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;

export const INCOME_LABEL = "Fee income";
export const PAYROLL_LABEL = "Salaries & payroll";

// Calendar months covered by [from, to], pro-rating part months by days.
export function monthsInRange(range) {
  if (!range?.from || !range?.to || range.to < range.from) return 0;
  let total = 0;
  for (let m = new Date(range.from.getFullYear(), range.from.getMonth(), 1); m <= range.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const monthEnd = endOfDay(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    const start = m < range.from ? startOfDay(range.from) : m;
    const end = monthEnd > range.to ? range.to : monthEnd;
    total += dayCount(start, end) / monthEnd.getDate();
  }
  return total;
}

// "over" / "near" / "ok" for spending lines; "met" / "near" / "behind" for income.
export function lineStatus(kind, budget, actual) {
  if (budget <= 0) return actual > 0 && kind !== "income" ? "unbudgeted" : "none";
  const ratio = actual / budget;
  if (kind === "income") return ratio >= 1 ? "met" : ratio >= 0.85 ? "near" : "behind";
  return ratio > 1 ? "over" : ratio >= 0.85 ? "near" : "ok";
}

// fin: computeFinancials() result for the same period/branch.
export function computeBudget({ budgets, fin, range, branch = "all", today = new Date() }) {
  const effective = { from: range.from, to: range.to > endOfDay(today) ? endOfDay(today) : range.to };
  const months = monthsInRange(effective);
  const rows = (budgets || []).filter(b => matchesBranch(b, branch));
  const monthly = (kind, category) => rows
    .filter(b => b.kind === kind && (category === undefined || keyOf(b.category) === keyOf(category)))
    .reduce((s, b) => s + num(b.amount), 0);

  const lines = [];
  const add = (key, label, kind, monthlyAmount, actual) => {
    const budget = monthlyAmount * months;
    lines.push({
      key, label, kind, monthly: monthlyAmount, budget, actual,
      variance: actual - budget,
      pct: budget > 0 ? actual / budget : null,
      status: lineStatus(kind, budget, actual),
    });
  };

  add("income", INCOME_LABEL, "income", monthly("income"), fin.collected);

  // every budgeted category plus every category that actually had spend
  const cats = new Map();
  for (const b of rows) if (b.kind === "expense" && norm(b.category)) cats.set(keyOf(b.category), norm(b.category));
  for (const c of fin.byCategory) cats.set(keyOf(c.label), c.label); // show the casing used on the expenses
  const actualOf = (label) => fin.byCategory.find(c => keyOf(c.label) === keyOf(label))?.amount || 0;
  [...cats.values()].sort((a, b) => a.localeCompare(b)).forEach(label => add(`expense:${keyOf(label)}`, label, "expense", monthly("expense", label), actualOf(label)));
  add("payroll", PAYROLL_LABEL, "payroll", monthly("payroll"), fin.payroll);

  const spend = lines.filter(l => l.kind !== "income");
  const expenseBudget = spend.reduce((s, l) => s + l.budget, 0);
  const expenseActual = spend.reduce((s, l) => s + l.actual, 0);
  const incomeLine = lines[0];
  return {
    months, proRatedTo: effective.to, lines,
    expenseBudget, expenseActual,
    expensePct: expenseBudget > 0 ? expenseActual / expenseBudget : null,
    netBudget: incomeLine.budget - expenseBudget,
    netActual: incomeLine.actual - expenseActual,
    hasBudget: lines.some(l => l.budget > 0),
    over: spend.filter(l => l.status === "over" || l.status === "unbudgeted"),
  };
}

// Rows for the editor: fee target, payroll and each expense category (the
// ones already budgeted plus any categories seen in the data).
export function editorRows(budgets, categories) {
  const find = (kind, category) => budgets.find(b => b.kind === kind && keyOf(b.category) === keyOf(category));
  const row = (kind, category) => {
    const b = find(kind, category);
    return { kind, category, id: b?.id || "", amount: b ? String(num(b.amount)) : "" };
  };
  const cats = new Map();
  for (const b of budgets) if (b.kind === "expense" && norm(b.category)) cats.set(keyOf(b.category), norm(b.category));
  for (const c of categories || []) if (norm(c)) cats.set(keyOf(c), norm(c)); // prefer the casing used on the expenses
  return [
    row("income", INCOME_LABEL),
    ...[...cats.values()].sort((a, b) => a.localeCompare(b)).map(c => row("expense", c)),
    row("payroll", PAYROLL_LABEL),
  ];
}

// Turn edited rows into the writes needed. A blank / zero amount removes
// an existing budget line; unchanged lines are left alone.
export function diffBudgets(existing, edited) {
  const byId = new Map(existing.map(b => [b.id, b]));
  const creates = [], updates = [], deletes = [];
  for (const r of edited) {
    const amount = num(r.amount);
    const category = norm(r.category);
    if (!category) continue;
    if (r.id && byId.has(r.id)) {
      if (amount <= 0) deletes.push(r.id);
      else if (amount !== num(byId.get(r.id).amount)) updates.push({ id: r.id, amount });
    } else if (amount > 0) {
      creates.push({ kind: r.kind, category, amount });
    }
  }
  return { creates, updates, deletes };
}

export const statusText = (line) => {
  if (line.status === "none") return "";
  if (line.status === "unbudgeted") return "No budget";
  if (line.kind === "income") return line.status === "met" ? "Target met" : line.status === "near" ? "Close" : "Behind";
  const gap = formatRs(Math.abs(line.variance));
  return line.status === "over" ? `Over by ${gap}` : line.status === "near" ? "Nearly used" : `${gap} left`;
};
