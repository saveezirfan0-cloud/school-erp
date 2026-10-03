// src/utils/reportFilters.js
//
// Filters for the Haji Sahab report. Some narrow what goes INTO the statement
// (period, branches, kinds of record, Bank & Cash account — handled by the
// builder), others narrow what is SHOWN (search, minimum amount — handled by
// filterStatement below, on top of the report layout).

import { monthRange } from "./monthlyStatement";

export const SOURCES = [
  { id: "fees", label: "Fee invoices" },
  { id: "payments", label: "Other receipts" },
  { id: "expenses", label: "Expenses" },
  { id: "payroll", label: "Payroll" },
  { id: "journals", label: "Journals" },
];

export const QUARTERS = [
  { id: 1, label: "Q1 · Jan–Mar", months: [1, 3] },
  { id: 2, label: "Q2 · Apr–Jun", months: [4, 6] },
  { id: 3, label: "Q3 · Jul–Sep", months: [7, 9] },
  { id: 4, label: "Q4 · Oct–Dec", months: [10, 12] },
];

export const defaultFilters = () => ({
  mode: "month", quarter: 1, from: "", to: "",
  branches: [],        // [] = every branch in scope
  sources: [],         // [] = every kind of record
  account: "",         // "" = any Bank & Cash account
  search: "", minAmount: "",
});

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// The date range for the chosen period mode. A bad custom range falls back to
// the selected month so the report never goes blank.
export function periodRange(f, year, month) {
  if (f.mode === "quarter") {
    const q = QUARTERS.find((x) => x.id === Number(f.quarter)) || QUARTERS[0];
    return { from: monthRange(year, q.months[0]).from, to: monthRange(year, q.months[1]).to };
  }
  if (f.mode === "custom" && isDate(f.from) && isDate(f.to) && f.from <= f.to) return { from: f.from, to: f.to };
  const { from, to } = monthRange(year, month);
  return { from, to };
}

// How many filters narrow the data (the period isn't counted — it's always set).
export function activeFilterCount(f) {
  return (f.branches.length ? 1 : 0)
    + (f.sources.length && f.sources.length < SOURCES.length ? 1 : 0)
    + (f.account ? 1 : 0)
    + (f.search.trim() ? 1 : 0)
    + (Number(f.minAmount) > 0 ? 1 : 0);
}

const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);

function filterSide(section, q, min) {
  const groups = section.groups
    .map((g) => {
      const heads = g.heads
        .map((h) => {
          if (!q) return h;
          const headHit = `${h.label} ${h.labelUr || ""} ${g.label}`.toLowerCase().includes(q);
          if (headHit) return h;
          const items = (h.items || []).filter((i) => `${i.text} ${i.source} ${i.branch}`.toLowerCase().includes(q));
          if (!items.length) return null;
          const byBranch = new Map();
          items.forEach((i) => byBranch.set(i.branch, (byBranch.get(i.branch) || 0) + i.amount));
          return {
            ...h, items, amount: sum(items, "amount"),
            branches: [...byBranch.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
          };
        })
        .filter((h) => h && h.amount >= min);
      return { ...g, heads, total: sum(heads, "amount") };
    })
    .filter((g) => g.heads.length > 0);
  const counted = groups.filter((g) => !g.excluded);
  return {
    ...section, groups,
    total: sum(counted, "total"),
    excludedAmount: sum(groups.filter((g) => g.excluded), "total"),
    budgetTotal: sum(counted, "budget"),
  };
}

// Applies the "view" filters to a layout-applied statement and recomputes totals.
export function filterStatement(st, f) {
  const q = f.search.trim().toLowerCase();
  const min = Number(f.minAmount) > 0 ? Number(f.minAmount) : 0;
  if (!q && !min) return st;
  const income = filterSide(st.income, q, min);
  const expense = filterSide(st.expense, q, min);
  return {
    ...st, income, expense,
    totalIncome: income.total, totalExpense: expense.total, net: income.total - expense.total,
    closingBalance: st.openingBalance + income.total - expense.total,
  };
}
