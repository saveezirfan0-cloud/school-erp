// src/utils/reportViews.js
//
// Extra views over the monthly statement: the year at a glance, a branch
// comparison, what is still outstanding, and a plain-text summary to share.
// All pure — they work on statements that already have the layout applied.

import { invoiceOutstanding } from "./invoiceTotals";
import { monthRange, ymd, fmtNum, monthName, statementPeriodLabel } from "./monthlyStatement";
import { pick, tr, MONTHS_UR } from "../config/reportI18n";

const num = (v) => Number(v || 0);

// ---- Year ----

// statements: 12 layout-applied statements, January first.
// Rows are sections (sorted by yearly total); each has a value per month.
export function buildYearTable(statements) {
  const side = (name) => {
    const rows = new Map();
    statements.forEach((st, mi) => {
      st[name].groups.forEach((g) => {
        if (!g.heads.length) return;
        const row = rows.get(g.key) || { key: g.key, label: g.label, labelUr: g.labelUr, excluded: g.excluded, values: new Array(12).fill(0), total: 0 };
        row.values[mi] = g.total;
        row.total += g.total;
        rows.set(g.key, row);
      });
    });
    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    const totals = statements.map((st) => st[name === "income" ? "totalIncome" : "totalExpense"]);
    return { rows: list, totals, total: totals.reduce((s, v) => s + v, 0) };
  };
  const income = side("income");
  const expense = side("expense");
  const net = statements.map((st) => st.net);
  // Balances roll forward from the first month's opening, so each closing is the
  // next opening and the year adds up. (Per-month statements take their opening
  // from the Bank & Cash accounts, which can differ if entries weren't posted.)
  const opening = [];
  const closing = [];
  net.forEach((n, i) => {
    opening.push(i === 0 ? statements[0].openingBalance : closing[i - 1]);
    closing.push(opening[i] + n);
  });
  return {
    income, expense, net,
    netTotal: net.reduce((s, v) => s + v, 0),
    opening, closing,
    monthsWithActivity: statements.filter((st) => st.totalIncome || st.totalExpense).length,
  };
}

export function yearCsvRows(table, year) {
  const head = ["", ...Array.from({ length: 12 }, (_, i) => monthName(i + 1)), `Total ${year}`];
  const rows = [head, ["Opening balance", ...table.opening, ""]];
  const sideRows = (label, s) => {
    s.rows.forEach((r) => rows.push([`${label}: ${r.label}`, ...r.values, r.total]));
    rows.push([`Total ${label}`, ...s.totals, s.total]);
  };
  sideRows("Income", table.income);
  sideRows("Expense", table.expense);
  rows.push(["Net", ...table.net, table.netTotal]);
  rows.push(["Closing balance", ...table.closing, ""]);
  return rows;
}

// ---- Branch comparison ----

// byBranch: [{ id, name, statement }] with the layout applied.
export function buildBranchMatrix(byBranch) {
  const side = (name) => {
    const rows = new Map();
    byBranch.forEach((b, bi) => {
      b.statement[name].groups.forEach((g) => {
        if (!g.heads.length) return;
        const row = rows.get(g.key) || { key: g.key, label: g.label, labelUr: g.labelUr, excluded: g.excluded, values: new Array(byBranch.length).fill(0), total: 0 };
        row.values[bi] = g.total;
        row.total += g.total;
        rows.set(g.key, row);
      });
    });
    const totals = byBranch.map((b) => b.statement[name === "income" ? "totalIncome" : "totalExpense"]);
    return { rows: [...rows.values()].sort((a, b) => b.total - a.total), totals, total: totals.reduce((s, v) => s + v, 0) };
  };
  const nets = byBranch.map((b) => b.statement.net);
  return {
    branches: byBranch.map((b) => ({ id: b.id, name: b.name })),
    income: side("income"),
    expense: side("expense"),
    nets,
    netTotal: nets.reduce((s, v) => s + v, 0),
  };
}

// ---- Outstanding (as of today's invoice / payslip status) ----

const MONTH_INDEX = Object.fromEntries(
  ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].map((m, i) => [m, i + 1]),
);

export function buildOutstanding({ invoices = [], payslips = [], branches = [], inScope = () => true, year, month, to: toOverride }) {
  const to = toOverride || monthRange(year, month).to;
  const branchOf = (r) => (!r.branchId || r.branchId === "main" ? "Main" : branches.find((b) => b.id === r.branchId)?.name || "Main");

  const byBranch = new Map();
  let feesTotal = 0;
  let feesCount = 0;
  invoices.filter(inScope).forEach((inv) => {
    const owed = invoiceOutstanding(inv);
    if (owed <= 0) return;
    const issued = ymd(inv.date || inv.dueDate || inv.createdAt);
    if (issued && issued > to) return; // not issued yet at month end
    feesTotal += owed;
    feesCount += 1;
    byBranch.set(branchOf(inv), (byBranch.get(branchOf(inv)) || 0) + owed);
  });

  let salTotal = 0;
  let salCount = 0;
  payslips.filter(inScope).forEach((p) => {
    if (p.status === "paid") return;
    const m = MONTH_INDEX[String(p.month || "").toLowerCase()];
    const y = num(p.year);
    if (m && y && (y > year || (y === year && m > month))) return; // a later month
    salTotal += num(p.netPay);
    salCount += 1;
  });

  return {
    fees: {
      total: Math.round(feesTotal), count: feesCount,
      byBranch: [...byBranch.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
    },
    salaries: { total: Math.round(salTotal), count: salCount },
  };
}

// ---- Share text ----

export function summaryText(st, { scopeLabel = "", outstanding = null, lang = "en", orgName = "Zohra Majeed Islamic Institute" } = {}) {
  const n = (v) => `Rs. ${fmtNum(v)}`;
  const top = (section) => section.groups.filter((g) => !g.excluded).slice(0, 4)
    .map((g) => `  • ${pick(lang, g.label, g.labelUr)}: ${fmtNum(g.total)}`).join("\n");
  const period = lang === "en" ? statementPeriodLabel(st.year, st.month)
    : lang === "ur" ? `${MONTHS_UR[st.month - 1]} ${st.year}` : `${statementPeriodLabel(st.year, st.month)} · ${MONTHS_UR[st.month - 1]} ${st.year}`;
  const lines = [
    `*${orgName}*`,
    `${tr(lang, "title")} — ${period}${scopeLabel ? ` (${scopeLabel})` : ""}`,
    "",
    `${tr(lang, "opening")}: ${n(st.openingBalance)}`,
    `${tr(lang, "totalIncome")}: ${n(st.totalIncome)}`,
    top(st.income),
    `${tr(lang, "totalExpense")}: ${n(st.totalExpense)}`,
    top(st.expense),
    `${tr(lang, st.net >= 0 ? "surplus" : "deficit")}: ${n(Math.abs(st.net))}`,
    `*${tr(lang, "closing")}: ${n(st.closingBalance)}*`,
  ];
  if (outstanding && (outstanding.fees.total || outstanding.salaries.total)) {
    lines.push("", `${tr(lang, "outstanding")}: ${tr(lang, "pendingFees")} ${n(outstanding.fees.total)}, ${tr(lang, "unpaidSalaries")} ${n(outstanding.salaries.total)}`);
  }
  return lines.filter((l) => l !== undefined && l !== "").join("\n").replace(/\n(?=\n)/g, "\n");
}
