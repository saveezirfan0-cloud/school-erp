// src/utils/monthlyStatement.js
//
// Builds the "Haji Sahab" monthly statement for one calendar month: opening
// balance, income and expenses grouped into sections, closing balance, and the
// position of each Bank & Cash account.
//
// Everything is on a cash basis (money actually received / spent in the month):
//   - Fee income      = invoice collected amounts (utils/invoiceTotals), by payment
//                       date, per fee line item
//   - Other income    = cash_in payments not tied to an invoice, by category
//   - Expenses        = expense rows by date, by category
//   - Salaries        = paid payslips by paid date
//   - Journals        = entries that debit an Expense account / credit an
//                       Income account in the Chart of Accounts
//
// Heads are taken from the data itself; src/config/statementHeads.js decides
// which section each head sits in.

import { toDate } from "./dates";
import { paymentInAccount } from "./accounting";
import { invoiceCollected, invoicePaymentDate } from "./invoiceTotals";
import {
  INCOME_GROUPS, EXPENSE_GROUPS, INCOME_SUBTYPE_GROUP, EXPENSE_SUBTYPE_GROUP,
  INCOME_RULES, EXPENSE_RULES,
} from "../config/statementHeads";

const pad = (n) => String(n).padStart(2, "0");
const num = (v) => Number(v || 0);
const clean = (s, fallback) => String(s ?? "").replace(/\s+/g, " ").trim() || fallback;

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

function branchName(branchId, branches) {
  if (!branchId || branchId === "main") return "Main";
  return branches.find((b) => b.id === branchId)?.name || "Main";
}

// Payments that are transfers between our own accounts, not income.
const TRANSFER_CATEGORIES = ["Bank Deposit", "Bank Withdrawal"];

// Picks the section for a head: chart-of-accounts sub-type, then keywords.
function makeClassifier(chart, subtypeMap, rules) {
  return (name) => {
    const acct = chart.get(name.toLowerCase());
    if (acct && subtypeMap[acct.subType]) return subtypeMap[acct.subType];
    return rules.find((r) => r.match.test(name))?.group || "other";
  };
}

// Collects amounts by section -> head -> branch.
function makeSection(groups, classify) {
  const byGroup = new Map(groups.map((g) => [g.key, new Map()]));
  return {
    add(head, branch, amount, forcedGroup) {
      if (!amount) return;
      const key = forcedGroup || classify(head);
      const heads = byGroup.get(key) || byGroup.get("other");
      const id = head.toLowerCase();
      const entry = heads.get(id) || { label: head, amount: 0, branches: new Map() };
      entry.amount += amount;
      entry.branches.set(branch, (entry.branches.get(branch) || 0) + amount);
      heads.set(id, entry);
    },
    result() {
      const out = groups
        .map((g) => {
          const heads = [...byGroup.get(g.key).values()]
            .map((h) => ({
              label: h.label,
              amount: Math.round(h.amount),
              branches: [...h.branches.entries()]
                .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
                .sort((a, b) => b.amount - a.amount),
            }))
            .filter((h) => h.amount !== 0)
            .sort((a, b) => b.amount - a.amount);
          return { key: g.key, label: g.label, total: heads.reduce((s, h) => s + h.amount, 0), heads };
        })
        .filter((g) => g.heads.length > 0);
      return { groups: out, total: out.reduce((s, g) => s + g.total, 0) };
    },
  };
}

/**
 * @param {object} p
 * @param {number} p.year
 * @param {number} p.month        1-12
 * @param {Array}  p.invoices
 * @param {Array}  p.expenses
 * @param {Array}  p.payslips
 * @param {Array}  p.payments
 * @param {Array}  p.journals
 * @param {Array}  p.accounts     chart of accounts
 * @param {Array}  p.branches
 * @param {(record) => boolean} [p.inScope]  branch filter, defaults to all
 * @param {boolean} [p.includeAccountOpening]  add the accounts' own opening
 *   balances. These are organisation-wide, so pass false for a single branch.
 */
export function buildMonthlyStatement({
  year, month, invoices = [], expenses = [], payslips = [], payments = [], journals = [],
  accounts = [], branches = [], inScope = () => true, includeAccountOpening = true,
}) {
  const { from, to } = monthRange(year, month);
  const inMonth = (value) => {
    const d = ymd(value);
    return d !== "" && d >= from && d <= to;
  };
  const branchOf = (record) => branchName(record.branchId, branches);

  const chartOf = (type) => new Map(
    accounts.filter((a) => a.type === type).map((a) => [clean(a.name, "").toLowerCase(), a]),
  );
  const incomeSection = makeSection(INCOME_GROUPS, makeClassifier(chartOf("Income"), INCOME_SUBTYPE_GROUP, INCOME_RULES));
  const expenseSection = makeSection(EXPENSE_GROUPS, makeClassifier(chartOf("Expenses"), EXPENSE_SUBTYPE_GROUP, EXPENSE_RULES));

  // ---- Income ----
  invoices.filter(inScope).forEach((inv) => {
    // Same definition of "collected" and its date as Dashboard / Reports / Fees.
    const paid = invoiceCollected(inv);
    if (!paid || !inMonth(invoicePaymentDate(inv))) return;
    const items = Array.isArray(inv.lineItems) && inv.lineItems.length ? inv.lineItems : null;
    const total = items ? items.reduce((s, li) => s + num(li.amount), 0) : 0;
    if (!items || !total) {
      incomeSection.add("Tuition Fee", branchOf(inv), paid, "fees");
      return;
    }
    // Split what was actually received across the line items pro rata, so a
    // part-paid invoice still lands in the right heads.
    items.forEach((li) => {
      const head = clean(li.customDescription || li.description, "Tuition Fee");
      incomeSection.add(head, branchOf(inv), (paid * num(li.amount)) / total, "fees");
    });
  });

  payments.filter(inScope).forEach((p) => {
    if (p.type !== "cash_in" || p.reversed === true || p.reversalOf) return;
    if (p.source === "invoice" || p.source === "expense" || p.source === "payslip") return;
    if (TRANSFER_CATEGORIES.includes(p.category)) return;
    if (!inMonth(p.date)) return;
    incomeSection.add(clean(p.category, "Miscellaneous"), branchOf(p), num(p.amount));
  });

  // ---- Expenses ----
  expenses.filter(inScope).forEach((e) => {
    if (!inMonth(e.date)) return;
    expenseSection.add(clean(e.category, "Other"), branchOf(e), num(e.amount));
  });

  payslips.filter(inScope).forEach((s) => {
    if (s.status !== "paid" || !inMonth(s.paidDate)) return;
    expenseSection.add("Staff Salaries (payroll)", branchOf(s), num(s.netPay), "salaries");
  });

  // ---- Journals: money booked straight to an Income / Expense account ----
  const typeByName = new Map(accounts.map((a) => [clean(a.name, "").toLowerCase(), a.type]));
  journals.filter(inScope).forEach((j) => {
    if (!inMonth(j.date)) return;
    const amount = num(j.amount);
    const debit = clean(j.debitAccount, "");
    const credit = clean(j.creditAccount, "");
    if (typeByName.get(debit.toLowerCase()) === "Expenses") expenseSection.add(debit, branchOf(j), amount);
    if (typeByName.get(credit.toLowerCase()) === "Income") incomeSection.add(credit, branchOf(j), amount);
  });

  const income = incomeSection.result();
  const expense = expenseSection.result();

  // ---- Bank & Cash accounts: opening, movement in the month, closing ----
  const scopedPayments = payments.filter(inScope);
  const cashAccounts = accounts
    .filter((a) => a.subType === "Bank & Cash")
    .map((a) => {
      const mine = scopedPayments.filter((p) => paymentInAccount(p, a) && ymd(p.date) !== "");
      const signed = (p) => (p.type === "cash_in" ? num(p.amount) : -num(p.amount));
      const before = mine.filter((p) => ymd(p.date) < from).reduce((s, p) => s + signed(p), 0);
      const during = mine.filter((p) => inMonth(p.date));
      const moneyIn = during.filter((p) => p.type === "cash_in").reduce((s, p) => s + num(p.amount), 0);
      const moneyOut = during.filter((p) => p.type !== "cash_in").reduce((s, p) => s + num(p.amount), 0);
      const opening = (includeAccountOpening ? num(a.balance) : 0) + before;
      return {
        name: a.name,
        opening: Math.round(opening),
        moneyIn: Math.round(moneyIn),
        moneyOut: Math.round(moneyOut),
        closing: Math.round(opening + moneyIn - moneyOut),
      };
    })
    .filter((a) => a.opening || a.moneyIn || a.moneyOut);

  const openingBalance = cashAccounts.reduce((s, a) => s + a.opening, 0);
  return {
    year, month, from, to,
    openingBalance,
    income,
    expense,
    totalIncome: income.total,
    totalExpense: expense.total,
    net: income.total - expense.total,
    closingBalance: openingBalance + income.total - expense.total,
    cashAccounts,
    // What the Bank & Cash ledger actually holds at month end. It differs from
    // closingBalance when income/expenses were recorded without a cash/bank
    // account, so the screen can point that out.
    ledgerClosing: cashAccounts.reduce((s, a) => s + a.closing, 0),
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m) => MONTH_NAMES[m - 1];

export function statementPeriodLabel(year, month) {
  const { last } = monthRange(year, month);
  const suffix = [11, 12, 13].includes(last) ? "th" : { 1: "st", 2: "nd", 3: "rd" }[last % 10] || "th";
  return `1st ${monthName(month)} to ${last}${suffix} ${monthName(month)} ${year}`;
}

// Percentage change vs a previous figure; null when there is nothing to compare.
export function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");

// Flat rows for CSV export: section, group, head, branch split, amount.
export function statementCsvRows(s) {
  const rows = [["Opening Balance", "", "", "", s.openingBalance]];
  const push = (label, section) => {
    section.groups.forEach((g) => {
      g.heads.forEach((h) => rows.push([label, g.label, h.label, h.branches.map((b) => `${b.name} ${fmtNum(b.amount)}`).join("; "), h.amount]));
    });
    rows.push([`Total ${label}`, "", "", "", section.total]);
  };
  push("Income", s.income);
  push("Expense", s.expense);
  rows.push(["Closing Balance", "", "", "", s.closingBalance]);
  return rows;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function sectionTable(title, section, tone, emptyText) {
  const body = section.groups.length === 0
    ? `<tr><td colspan="2" class="empty">${esc(emptyText)}</td></tr>`
    : section.groups.map((g) => `
        <tr class="g"><td>${esc(g.label)}</td><td class="n">${fmtNum(g.total)}</td></tr>
        ${g.heads.map((h) => `
        <tr><td class="h">${esc(h.label)}${h.branches.length > 1 ? `<span class="br">${h.branches.map((b) => `${esc(b.name)} ${fmtNum(b.amount)}`).join(" · ")}</span>` : ""}</td><td class="n">${fmtNum(h.amount)}</td></tr>`).join("")}`).join("");
  return `<h3 class="sec ${tone}">${esc(title)}</h3>
  <table>${body}<tr class="total ${tone}"><td>Total ${esc(title)}</td><td class="n">Rs. ${fmtNum(section.total)}</td></tr></table>`;
}

// Opens a print window in the app's theme; "Save as PDF" in the print dialog
// produces the PDF. Printing waits for the logo so it is not missing.
export function printMonthlyStatement(s, { orgName = "Zohra Majeed Islamic Institute", scopeLabel = "" } = {}) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const kpi = (label, value, cls = "") => `<div class="kpi ${cls}"><div class="k">${esc(label)}</div><div class="v">Rs. ${fmtNum(value)}</div></div>`;
  const accounts = s.cashAccounts.length === 0 ? "" : `
  <h3 class="sec">Bank &amp; Cash accounts</h3>
  <table>
    <tr class="g"><td>Account</td><td class="n">Opening</td><td class="n">In</td><td class="n">Out</td><td class="n">Closing</td></tr>
    ${s.cashAccounts.map((a) => `<tr><td class="h">${esc(a.name)}</td><td class="n">${fmtNum(a.opening)}</td><td class="n">${fmtNum(a.moneyIn)}</td><td class="n">${fmtNum(a.moneyOut)}</td><td class="n">${fmtNum(a.closing)}</td></tr>`).join("")}
  </table>`;
  w.document.write(`<html><head><title>Haji Sahab Report — ${esc(monthName(s.month))} ${s.year}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Inter, Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; font-size: 12px;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .band { background: #4a1520; color: #fff; border-radius: 10px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
    .band img { width: 46px; height: 46px; object-fit: contain; background: #fff; border-radius: 8px; padding: 3px; }
    .band .org { font-size: 16px; font-weight: 700; }
    .band .sub { font-size: 11px; opacity: .8; margin-top: 3px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 4px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
    .kpi .k { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
    .kpi .v { font-size: 14px; font-weight: 700; margin-top: 3px; }
    .kpi.in .v { color: #047857; } .kpi.out .v { color: #b91c1c; } .kpi.close { background: #f5eaec; border-color: #e8cfd4; } .kpi.close .v { color: #7a2535; }
    h3.sec { font-size: 13px; margin: 14px 0 6px; color: #7a2535; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 9px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    td.h { padding-left: 22px; }
    .br { display: block; font-size: 10px; color: #64748b; margin-top: 1px; }
    tr.g td { background: #f5eaec; font-weight: 700; color: #4a1520; }
    tr.total td { font-weight: 700; font-size: 13px; border-bottom: none; color: #fff; background: #7a2535; }
    tr.total.in td { background: #047857; } tr.total.out td { background: #b91c1c; }
    td.empty { color: #64748b; text-align: center; padding: 12px; }
    tr { page-break-inside: avoid; }
    .foot { margin-top: 14px; font-size: 10px; color: #94a3b8; text-align: center; }
  </style></head><body>
  <div class="band">
    <img src="${esc(window.location.origin)}/zmi_logo.png" alt="" />
    <div><div class="org">${esc(orgName)}</div>
    <div class="sub">Monthly Statement · ${esc(statementPeriodLabel(s.year, s.month))}${scopeLabel ? ` · ${esc(scopeLabel)}` : ""}</div></div>
  </div>
  <div class="kpis">
    ${kpi("Opening balance", s.openingBalance)}${kpi("Total income", s.totalIncome, "in")}${kpi("Total expense", s.totalExpense, "out")}${kpi("Closing balance", s.closingBalance, "close")}
  </div>
  ${sectionTable("Income", s.income, "in", "No income recorded this month")}
  ${sectionTable("Expense", s.expense, "out", "No expenses recorded this month")}
  ${accounts}
  <div class="foot">Generated ${esc(new Date().toLocaleDateString("en-GB"))} — ZMI School Management System</div>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
  </body></html>`);
  w.document.close();
  return true;
}
