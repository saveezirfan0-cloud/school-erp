// src/utils/monthlyStatement.js
//
// Builds the "Haji Sahab" monthly statement: opening balance, income by
// head, expense by head, and the closing balance for one calendar month.
//
// Everything is on a cash basis (money actually received / spent in the
// month), matching how the Bank & Cash balances are derived:
//   - Fee income      = invoice paid amounts, by paid date
//   - Other income    = cash_in payments that are not tied to an invoice
//                       (donations, welfare, loans, ...), grouped by category
//   - Expenses        = expense rows by date
//   - Salaries        = paid payslips by paid date
//
// Heads come from src/config/statementHeads.js so the statement reads like
// the manual sheet it replaces (every head prints, even at 0).

import { toDate } from "./dates";
import { BRANCH_GROUPS, INCOME_HEADS, EXPENSE_HEADS } from "../config/statementHeads";

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" for any date-ish value, without timezone drift for plain
// date strings. Returns "" when unparseable.
export function ymd(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = toDate(value);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
}

export function monthRange(year, month) {
  const last = new Date(year, month, 0).getDate(); // month is 1-12
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}`, last };
}

const num = (v) => Number(v || 0);

// Fee line items are routed by what they are called.
const isAdmission = (description = "") => /admission|registration/i.test(description);
const isTafseer = (description = "") => /tafseer|tafsir/i.test(description);

// Payments that are bookkeeping for a source document or a transfer between
// our own accounts — not income in their own right.
const TRANSFER_CATEGORIES = ["Bank Deposit", "Bank Withdrawal"];

function branchName(branchId, branches) {
  if (!branchId || branchId === "main") return "Main";
  return branches.find((b) => b.id === branchId)?.name || "Main";
}

// Which branch group ("baneen", "umer", ...) a branch name belongs to.
function branchGroup(name) {
  return Object.keys(BRANCH_GROUPS).find((k) => BRANCH_GROUPS[k].test(name)) || "";
}

// Fixed, ordered list of heads that also collects anything unmatched into an
// extra row, so totals always reconcile.
function makeLedger(heads, otherLabel) {
  const totals = new Map(heads.map((h) => [h.label, 0]));
  let other = 0;
  return {
    add(label, amount) {
      if (!amount) return;
      if (label && totals.has(label)) totals.set(label, totals.get(label) + amount);
      else other += amount;
    },
    rows() {
      const rows = [...totals.entries()].map(([label, amount]) => ({ label, amount }));
      if (other) rows.push({ label: otherLabel, amount: other });
      return rows;
    },
  };
}

// Income head for an invoice line item, or "" when no head fits.
function incomeHeadForLine(desc, group) {
  const kind = isTafseer(desc) ? "tafseer" : isAdmission(desc) ? "admission" : "fee";
  return INCOME_HEADS.find((h) => h.kind === kind && (kind === "tafseer" || h.branch === group))?.label || "";
}

function incomeHeadForPayment(category) {
  return INCOME_HEADS.find((h) => h.kind === "payment" && h.category.test(category))?.label || "";
}

// Expense head for a category spent in a branch group.
function expenseHead(category, group) {
  const wide = EXPENSE_HEADS.find((h) => h.anyBranch && h.category.test(category));
  if (wide) return wide.label;
  const lump = EXPENSE_HEADS.find((h) => h.branch && h.branch === group);
  if (lump) return lump.label;
  return EXPENSE_HEADS.find((h) => !h.anyBranch && !h.branch && h.category.test(category))?.label || "";
}

/**
 * @param {object} p
 * @param {number} p.year
 * @param {number} p.month        1-12
 * @param {Array}  p.invoices
 * @param {Array}  p.expenses
 * @param {Array}  p.payslips
 * @param {Array}  p.payments
 * @param {Array}  p.accounts     chart of accounts (for opening balances)
 * @param {Array}  p.branches
 * @param {(record) => boolean} [p.inScope]  branch filter, defaults to all
 * @param {boolean} [p.includeAccountOpening]  add the accounts' own opening
 *   balances. These are organisation-wide, so pass false for a single branch.
 */
export function buildMonthlyStatement({
  year, month, invoices = [], expenses = [], payslips = [], payments = [],
  accounts = [], branches = [], inScope = () => true, includeAccountOpening = true,
}) {
  const { from, to } = monthRange(year, month);
  const inMonth = (value) => {
    const d = ymd(value);
    return d !== "" && d >= from && d <= to;
  };
  const groupOf = (record) => branchGroup(branchName(record.branchId, branches));

  // ---- Income ----
  const income = makeLedger(INCOME_HEADS, "Other Income");

  invoices.filter(inScope).forEach((inv) => {
    const paid = num(inv.paidAmount);
    if (!paid || !inMonth(inv.paidDate)) return;
    const group = groupOf(inv);
    const items = Array.isArray(inv.lineItems) && inv.lineItems.length ? inv.lineItems : null;
    const total = items ? items.reduce((s, li) => s + num(li.amount), 0) : 0;
    if (!items || !total) {
      income.add(incomeHeadForLine("", group), paid);
      return;
    }
    // Split what was actually received across the line items pro rata, so a
    // part-paid invoice still lands in the right heads.
    items.forEach((li) => {
      const share = (paid * num(li.amount)) / total;
      income.add(incomeHeadForLine(li.customDescription || li.description || "", group), share);
    });
  });

  payments.filter(inScope).forEach((p) => {
    if (p.type !== "cash_in" || p.reversed === true || p.reversalOf) return;
    if (p.source === "invoice" || p.source === "expense" || p.source === "payslip") return;
    if (TRANSFER_CATEGORIES.includes(p.category)) return;
    if (!inMonth(p.date)) return;
    income.add(incomeHeadForPayment(p.category || ""), num(p.amount));
  });

  // ---- Expenses ----
  const expense = makeLedger(EXPENSE_HEADS, "Other Expense");

  expenses.filter(inScope).forEach((e) => {
    if (!inMonth(e.date)) return;
    expense.add(expenseHead(e.category || "", groupOf(e)), num(e.amount));
  });

  payslips.filter(inScope).forEach((s) => {
    if (s.status !== "paid" || !inMonth(s.paidDate)) return;
    expense.add(expenseHead("Salaries", groupOf(s)), num(s.netPay));
  });

  const incomeRows = income.rows();
  const expenseRows = expense.rows();
  const totalIncome = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);

  // ---- Opening balance: opening balances of Bank & Cash accounts plus all
  // net money movement before the 1st (same formula as the Bank & Cash page).
  const cashAccounts = accounts.filter((a) => a.subType === "Bank & Cash");
  const names = new Set(cashAccounts.map((a) => a.name));
  const opening =
    (includeAccountOpening ? cashAccounts.reduce((s, a) => s + num(a.balance), 0) : 0) +
    payments
      .filter(inScope)
      .filter((p) => names.has(p.account) && ymd(p.date) !== "" && ymd(p.date) < from)
      .reduce((s, p) => s + (p.type === "cash_in" ? num(p.amount) : -num(p.amount)), 0);

  return {
    year, month, from, to,
    openingBalance: Math.round(opening),
    income: incomeRows.map((r) => ({ ...r, amount: Math.round(r.amount) })),
    expense: expenseRows.map((r) => ({ ...r, amount: Math.round(r.amount) })),
    totalIncome: Math.round(totalIncome),
    totalExpense: Math.round(totalExpense),
    closingBalance: Math.round(opening + totalIncome - totalExpense),
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m) => MONTH_NAMES[m - 1];

export function statementPeriodLabel(year, month) {
  const { last } = monthRange(year, month);
  return `1st ${monthName(month)} to ${last}${[11, 12, 13].includes(last) ? "th" : { 1: "st", 2: "nd", 3: "rd" }[last % 10] || "th"} ${monthName(month)} ${year}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

// Opens a print window laid out like the manual sheet (black section bars,
// bold figures). The browser's "Save as PDF" produces the PDF.
export function printMonthlyStatement(statement, { orgName = "Zohra Majeed Islamic Institute", scopeLabel = "" } = {}) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const rows = (list) => list.map((r) => `<tr><td class="l">${esc(r.label)}</td><td class="n">${fmt(r.amount)}</td></tr>`).join("");
  const period = statementPeriodLabel(statement.year, statement.month);
  w.document.write(`<html><head><title>Haji Sahab Report — ${esc(monthName(statement.month))} ${statement.year}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; }
    .head { text-align: center; margin-bottom: 14px; }
    .head h1 { font-size: 16px; margin: 0; font-style: italic; }
    .head p { font-size: 11px; margin: 3px 0 0; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
    td { border: 1px solid #000; padding: 4px 8px; }
    td.n { text-align: right; width: 34%; }
    td.l { font-weight: 700; }
    tr.bar td { background: #000; color: #fff; font-weight: 700; }
    tr.bar td.c { text-align: center; font-size: 15px; }
    tr.bar td.n { text-align: right; }
    .foot { font-size: 10px; color: #555; text-align: center; margin-top: 10px; }
    tr { page-break-inside: avoid; }
  </style></head><body>
  <div class="head">
    <h1>${esc(orgName)} — Monthly Statement</h1>
    <p>${esc(period)}${scopeLabel ? ` · ${esc(scopeLabel)}` : ""}</p>
  </div>
  <table>
    <tr class="bar"><td>Opening Balance</td><td class="n">${fmt(statement.openingBalance)}</td></tr>
    <tr class="bar"><td class="c" colspan="2">Income</td></tr>
    ${rows(statement.income)}
    <tr class="bar"><td>Total — Income</td><td class="n">${fmt(statement.totalIncome)}</td></tr>
  </table>
  <table>
    <tr class="bar"><td class="c" colspan="2">Expense</td></tr>
    ${rows(statement.expense)}
    <tr class="bar"><td>Total — Expense</td><td class="n">${fmt(statement.totalExpense)}</td></tr>
  </table>
  <table>
    <tr class="bar"><td>Closing Balance</td><td class="n">${fmt(statement.closingBalance)}</td></tr>
  </table>
  <div class="foot">Generated ${esc(new Date().toLocaleDateString("en-GB"))} — ZMI School Management System</div>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
