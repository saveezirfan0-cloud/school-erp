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
import { attributePayments } from "./reporting";
import { isAutoJournal } from "./autoJournals";
import { invoiceCollected, invoicePaymentDate } from "./invoiceTotals";
import { isLedgerIncome } from "./ledgerIncome";
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
    // `item` describes the record behind the amount ({ date, text, source })
    // so a head can be drilled into.
    add(head, branch, amount, forcedGroup, item = {}) {
      if (!amount) return;
      const key = forcedGroup || classify(head);
      const heads = byGroup.get(key) || byGroup.get("other");
      const id = head.toLowerCase();
      const entry = heads.get(id) || { label: head, amount: 0, branches: new Map(), items: [] };
      entry.amount += amount;
      entry.branches.set(branch, (entry.branches.get(branch) || 0) + amount);
      entry.items.push({ date: item.date || "", text: item.text || head, source: item.source || "", branch, amount });
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
              items: h.items
                .map((i) => ({ ...i, amount: Math.round(i.amount) }))
                .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount)),
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
  from: fromOverride, to: toOverride, sources = null, account = "",
}) {
  // A custom range (quarter, custom dates…) overrides the calendar month.
  const { from, to } = fromOverride && toOverride ? { from: fromOverride, to: toOverride } : monthRange(year, month);
  // Filters: which kinds of record to include, and which Bank & Cash account
  // money moved through. `sources` is null (everything) or a list of
  // "fees" | "payments" | "expenses" | "payroll" | "journals".
  const use = (kind) => !sources || sources.includes(kind);
  const accOk = (name) => !account || clean(name, "") === account;
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
  (use("fees") ? invoices : []).filter(inScope).filter((inv) => accOk(inv.paidAccount)).forEach((inv) => {
    // Same definition of "collected" and its date as Dashboard / Reports / Fees.
    const paid = invoiceCollected(inv);
    const payDate = ymd(invoicePaymentDate(inv));
    if (!paid || !inMonth(payDate)) return;
    const who = clean(inv.studentName, "Fee invoice") + (inv.month ? ` — ${inv.month}` : "");
    const items = Array.isArray(inv.lineItems) && inv.lineItems.length ? inv.lineItems : null;
    const total = items ? items.reduce((s, li) => s + num(li.amount), 0) : 0;
    if (!items || !total) {
      incomeSection.add("Tuition Fee", branchOf(inv), paid, "fees", { date: payDate, text: who, source: "Fee invoice" });
      return;
    }
    // Split what was actually received across the line items pro rata, so a
    // part-paid invoice still lands in the right heads.
    items.forEach((li) => {
      const head = clean(li.customDescription || li.description, "Tuition Fee");
      incomeSection.add(head, branchOf(inv), (paid * num(li.amount)) / total, "fees", { date: payDate, text: who, source: "Fee invoice" });
    });
  });

  (use("payments") ? payments : []).filter(inScope).forEach((p) => {
    if (!accOk(p.account)) return;
    if (!isLedgerIncome(p) || !inMonth(p.date)) return;
    incomeSection.add(clean(p.category, "Miscellaneous"), branchOf(p), num(p.amount), undefined,
      { date: ymd(p.date), text: clean(p.description || p.reference, clean(p.category, "Payment")), source: `Payment · ${clean(p.account, "")}` });
  });

  // ---- Expenses ----
  (use("expenses") ? expenses : []).filter(inScope).forEach((e) => {
    if (!inMonth(e.date) || !accOk(e.paidAccount)) return;
    expenseSection.add(clean(e.category, "Other"), branchOf(e), num(e.amount), undefined,
      { date: ymd(e.date), text: clean(e.description, clean(e.category, "Expense")), source: "Expense" });
  });

  (use("payroll") ? payslips : []).filter(inScope).forEach((s) => {
    if (s.status !== "paid" || !inMonth(s.paidDate) || !accOk(s.paidAccount)) return;
    expenseSection.add("Staff Salaries (payroll)", branchOf(s), num(s.netPay), "salaries",
      { date: ymd(s.paidDate), text: clean(s.employeeName, "Payslip") + (s.month ? ` — ${s.month} ${s.year || ""}`.trimEnd() : ""), source: "Payslip" });
  });

  // ---- Journals: money booked straight to an Income / Expense account ----
  const typeByName = new Map(accounts.map((a) => [clean(a.name, "").toLowerCase(), a.type]));
  (use("journals") ? journals : []).filter(inScope).forEach((j) => {
    // Auto-posted journals (paid expenses, fee collections, salaries) mirror
    // rows already counted above; counting them again would double the figures.
    if (isAutoJournal(j)) return;
    if (!inMonth(j.date)) return;
    if (account && clean(j.debitAccount, "") !== account && clean(j.creditAccount, "") !== account) return;
    const amount = num(j.amount);
    const debit = clean(j.debitAccount, "");
    const credit = clean(j.creditAccount, "");
    const item = { date: ymd(j.date), text: clean(j.description || j.reference, "Journal entry"), source: "Journal" };
    if (typeByName.get(debit.toLowerCase()) === "Expenses") expenseSection.add(debit, branchOf(j), amount, undefined, item);
    if (typeByName.get(credit.toLowerCase()) === "Income") incomeSection.add(credit, branchOf(j), amount, undefined, item);
  });

  const income = incomeSection.result();
  const expense = expenseSection.result();

  // ---- Bank & Cash accounts: opening, movement in the month, closing ----
  const scopedPayments = payments.filter(inScope);
  // Same attribution as Bank & Cash / Books Check: by account id, name only as
  // a fallback, and duplicate account names never double count.
  const byAccount = attributePayments(accounts, scopedPayments).byAccount;
  const cashAccounts = accounts
    .filter((a) => a.subType === "Bank & Cash" && (!account || a.name === account))
    .map((a) => {
      const mine = (byAccount.get(a.id) || []).filter((p) => ymd(p.date) !== "");
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
    year: Number(from.slice(0, 4)), month: Number(from.slice(5, 7)), from, to,
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

// ---- ranges ----

const lastDayOf = (y, m) => new Date(y, m, 0).getDate();
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseIso = (s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));

// "YYYY-MM" for every calendar month the range touches.
export function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// True when the range is whole calendar months (1st to the last day).
export function isWholeMonths(from, to) {
  return from.slice(8, 10) === "01" && Number(to.slice(8, 10)) === lastDayOf(Number(to.slice(0, 4)), Number(to.slice(5, 7)));
}

export const isSingleMonth = (from, to) => isWholeMonths(from, to) && from.slice(0, 7) === to.slice(0, 7);

// The period just before `from..to`, of the same length: whole months step back
// by whole months; any other range by the same number of days.
export function previousRange(from, to) {
  if (isWholeMonths(from, to)) {
    const k = monthsBetween(from, to).length;
    const idx = Number(from.slice(0, 4)) * 12 + (Number(from.slice(5, 7)) - 1) - k;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return { from: `${y}-${pad(m)}-01`, to: isoDate(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 0))) };
  }
  const days = Math.round((parseIso(to) - parseIso(from)) / 86400000) + 1;
  const prevTo = new Date(parseIso(from).getTime() - 86400000);
  return { from: isoDate(new Date(prevTo.getTime() - (days - 1) * 86400000)), to: isoDate(prevTo) };
}

const SHORT = (s) => `${Number(s.slice(8, 10))} ${monthName(Number(s.slice(5, 7))).slice(0, 3)} ${s.slice(0, 4)}`;

// "1st September to 30th September 2026" for a month, "1 Jul 2026 to 30 Sep 2026" otherwise.
export function rangeLabel(from, to) {
  if (isSingleMonth(from, to)) return statementPeriodLabel(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
  return `${SHORT(from)} to ${SHORT(to)}`;
}

// "−Rs. 38,600" for a negative figure (a plain "Rs. -38,600" reads badly).
export const fmtMoney = (n) => `${Number(n) < 0 ? "−" : ""}Rs. ${fmtNum(Math.abs(Number(n) || 0))}`;

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
