// src/utils/reportData.js
//
// Pure functions behind the Reports page: date ranges, bucketing and the
// aggregations for each report. No React, no Supabase — everything takes
// plain arrays (already decoded to camelCase by the firebase shim) so it
// can be unit-tested and reused (e.g. by the Dashboard later).
//
// Accounting conventions (kept from the original Reports page):
// Money definitions are NOT made here: they live in utils/reporting.js
// (via utils/invoiceTotals.js for per-invoice figures) so Dashboard,
// Reports, Bank & Cash and the Student Ledger can never disagree
// (audit ACC-04):
//   * Income is cash-basis: money actually recorded against invoices
//     (paidAmount), dated by paid date. An invoice marked "paid" with no
//     money recorded is NOT income; it is reported as `unverified`.
//   * Concessions are reported on their own line, never as collected.
//   * Outstanding (`pending`) is a balance as of today for the branch; it
//     is not cut by the period. (The Fee Collection tab is a labelled
//     per-period cohort of invoices billed in the period.)
//   * Billed is dated by the billing period (month + year) when present.
//   * Operating expenses are dated by expense.date.
//   * Payroll is cash-basis too: only PAID payslips are an expense, dated
//     by paid date. Unpaid payslips are a memo (`payrollUnpaid`).

import { toDate } from "./dates";
import { matchesBranch } from "./branchFilter";
// Same definitions of "collected" / "outstanding" as Dashboard and Fees & Invoices.
import { invoiceCollected, invoiceConcession, invoiceOutstanding, invoiceUnverified } from "./invoiceTotals";
import { invoiceDate, invoicePaidDate, expenseDate, payslipPaidDate, payslipPeriodDate } from "./reporting";
// Matches a payment to a chart account by id (survives renames), else by name.
// Same rule as reporting.attributePayments.
import { paymentInAccount } from "./paymentAccount";
// Income recorded straight in the payments ledger (imported workbook months,
// welfare, donations...). The Dashboard reads it through the same rule.
import { isLedgerIncome } from "./ledgerIncome";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = MONTH_NAMES.map(m => m.slice(0, 3));
const DAY_MS = 86400000;
const num = (v) => Number(v) || 0;

// ---------------------------------------------------------------- dates

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Parse 'YYYY-MM-DD' as a *local* date (new Date("2026-03-05") is UTC and
// can land on the previous day in some timezones); anything else goes
// through the shared toDate() (ISO timestamps, legacy Firestore shapes).
export function parseDay(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = DAY_RE.exec(value.trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return toDate(value);
}

const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);

// "January" / "Jan" / 1 -> 0-based month index, or -1.
export function monthIndex(m) {
  if (m === null || m === undefined || m === "") return -1;
  if (typeof m === "number" || /^\d+$/.test(String(m))) {
    const n = Number(m);
    return n >= 1 && n <= 12 ? n - 1 : -1;
  }
  const s = String(m).trim().toLowerCase().slice(0, 3);
  return MONTH_SHORT.findIndex(x => x.toLowerCase() === s);
}

// The date each kind of record is reported against (see header).
// All of these go through utils/reporting.js so a record lands in the same
// period on every screen.
export const recordDate = {
  invoiceBilled(inv) {
    return parseDay(invoiceDate(inv));
  },
  invoiceCollected(inv) {
    return parseDay(invoicePaidDate(inv));
  },
  expense(e) {
    return parseDay(expenseDate(e));
  },
  // Paid payslips sit on their paid date (cash basis); unpaid ones on
  // their pay period, for the "not yet paid" memo.
  payslip(p) {
    return parseDay(String(p.status || "").toLowerCase() === "paid" ? payslipPaidDate(p) : payslipPeriodDate(p));
  },
  payment(p) {
    return parseDay(p.date) || parseDay(p.createdAt);
  },
};

// ---------------------------------------------------------------- ranges

export const DATE_PRESETS = [
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "lastQuarter", label: "Last quarter" },
  { id: "thisYear", label: "This year (Jan–Dec)" },
  { id: "ytd", label: "Year to date" },
  { id: "lastYear", label: "Last year" },
  { id: "thisFY", label: "Financial year (Jul–Jun)" },
  { id: "lastFY", label: "Last financial year" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom range…" },
];

// A range is { from: Date|null, to: Date|null }; null on both = unbounded.
export function presetRange(id, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const monthSpan = (fromY, fromM, months) => ({
    from: new Date(fromY, fromM, 1),
    to: endOfDay(new Date(fromY, fromM + months, 0)),
  });
  switch (id) {
    case "thisMonth": return monthSpan(y, m, 1);
    case "lastMonth": return monthSpan(y, m - 1, 1);
    case "thisQuarter": return monthSpan(y, m - (m % 3), 3);
    case "lastQuarter": return monthSpan(y, m - (m % 3) - 3, 3);
    case "thisYear": return monthSpan(y, 0, 12);
    case "ytd": return { from: new Date(y, 0, 1), to: endOfDay(today) };
    case "lastYear": return monthSpan(y - 1, 0, 12);
    case "thisFY": return monthSpan(m >= 6 ? y : y - 1, 6, 12);
    case "lastFY": return monthSpan(m >= 6 ? y - 1 : y - 2, 6, 12);
    case "last30": return { from: startOfDay(addDays(today, -29)), to: endOfDay(today) };
    case "last90": return { from: startOfDay(addDays(today, -89)), to: endOfDay(today) };
    case "all":
    default: return { from: null, to: null };
  }
}

// Build a range from two <input type="date"> values; either may be empty.
export function customRange(fromStr, toStr) {
  const from = parseDay(fromStr);
  const to = parseDay(toStr);
  return { from: from ? startOfDay(from) : null, to: to ? endOfDay(to) : null };
}

export function inRange(date, range) {
  if (!range || (!range.from && !range.to)) return true;
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

// The equally long period just before `range` — whole calendar months
// stay whole months (March -> February, a quarter -> the quarter
// before), anything else shifts back by its length in days.
export function previousRange(range) {
  if (!range || !range.from || !range.to) return null;
  const { from, to } = range;
  const lastDayOfMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
  const wholeMonths = from.getDate() === 1 && to.getDate() === lastDayOfMonth;
  const prevTo = endOfDay(addDays(from, -1));
  if (wholeMonths) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1;
    return { from: new Date(from.getFullYear(), from.getMonth() - months, 1), to: prevTo };
  }
  const days = daysBetween(from, to) + 1;
  return { from: addDays(from, -days), to: prevTo };
}

// Same dates one year earlier. A range ending on the last day of a month
// keeps ending on the last day (so Feb 2025 compares with the whole of Feb 2024).
export function yearAgoRange(range) {
  if (!range || !range.from || !range.to) return null;
  const shift = (d, endOfMonthAware) => {
    const y = d.getFullYear() - 1;
    const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
    const wasLast = d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const day = endOfMonthAware && wasLast ? lastDay : Math.min(d.getDate(), lastDay);
    return new Date(y, d.getMonth(), day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  };
  return { from: shift(range.from, false), to: shift(range.to, true) };
}

export const COMPARE_MODES = [
  { id: "prev", label: "Previous period", short: "Previous" },
  { id: "yoy", label: "Same period last year", short: "Last year" },
  { id: "none", label: "No comparison", short: "" },
];
export function comparisonRange(range, mode) {
  if (mode === "yoy") return yearAgoRange(range);
  if (mode === "none") return null;
  return previousRange(range);
}

export function rangeLabel(range) {
  const fmt = (d) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (!range || (!range.from && !range.to)) return "All time";
  if (range.from && range.to) return `${fmt(range.from)} – ${fmt(range.to)}`;
  return range.from ? `From ${fmt(range.from)}` : `Up to ${fmt(range.to)}`;
}

// An unbounded range is only used for filtering; charts need real ends,
// so close it using the earliest/latest dates actually present.
export function resolveRange(range, dates, today = new Date()) {
  const known = (dates || []).filter(Boolean);
  const from = range?.from || (known.length ? startOfDay(new Date(Math.min(...known))) : startOfDay(today));
  const latest = known.length ? new Date(Math.max(...known, today)) : today;
  const to = range?.to || endOfDay(latest);
  return { from, to };
}

// ------------------------------------------------------------- bucketing

export const GRANULARITIES = [
  { id: "auto", label: "Auto" },
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Yearly" },
];
const ORDER = ["day", "week", "month", "quarter", "year"];
const MAX_BUCKETS = 120;

function bucketStart(date, g) {
  switch (g) {
    case "day": return startOfDay(date);
    case "week": { const d = startOfDay(date); return addDays(d, -((d.getDay() + 6) % 7)); } // Monday
    case "month": return new Date(date.getFullYear(), date.getMonth(), 1);
    case "quarter": return new Date(date.getFullYear(), date.getMonth() - (date.getMonth() % 3), 1);
    default: return new Date(date.getFullYear(), 0, 1);
  }
}
function nextBucketStart(start, g) {
  switch (g) {
    case "day": return addDays(start, 1);
    case "week": return addDays(start, 7);
    case "month": return new Date(start.getFullYear(), start.getMonth() + 1, 1);
    case "quarter": return new Date(start.getFullYear(), start.getMonth() + 3, 1);
    default: return new Date(start.getFullYear() + 1, 0, 1);
  }
}
function bucketKey(start, g) {
  switch (g) {
    case "day": case "week": return isoDay(start);
    case "month": return `${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
    case "quarter": return `${start.getFullYear()}-Q${Math.floor(start.getMonth() / 3) + 1}`;
    default: return String(start.getFullYear());
  }
}
function bucketLabel(start, g) {
  const yy = `’${String(start.getFullYear()).slice(2)}`;
  switch (g) {
    case "day": case "week": return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`;
    case "month": return `${MONTH_SHORT[start.getMonth()]} ${yy}`;
    case "quarter": return `Q${Math.floor(start.getMonth() / 3) + 1} ${yy}`;
    default: return String(start.getFullYear());
  }
}

// Pick a sensible bucket size for the span; honour an explicit choice
// unless it would draw an unreadable number of bars.
export function resolveGranularity(range, requested = "auto") {
  const days = daysBetween(range.from, range.to) + 1;
  let g = requested;
  if (g === "auto" || !ORDER.includes(g)) g = days <= 31 ? "day" : days <= 120 ? "week" : days <= 800 ? "month" : "quarter";
  while (g !== "year" && countBuckets(range, g) > MAX_BUCKETS) g = ORDER[ORDER.indexOf(g) + 1];
  return g;
}
function countBuckets(range, g) {
  let n = 0;
  for (let s = bucketStart(range.from, g); s <= range.to; s = nextBucketStart(s, g)) n++;
  return n;
}

// Empty ordered buckets covering `range` (so quiet periods show as zero).
export function makeBuckets(range, g, template = {}) {
  const out = [];
  for (let s = bucketStart(range.from, g); s <= range.to; s = nextBucketStart(s, g)) {
    out.push({ key: bucketKey(s, g), label: bucketLabel(s, g), start: s, ...template });
  }
  return out;
}
export const keyFor = (date, g) => bucketKey(bucketStart(date, g), g);

// --------------------------------------------------------- data shaping

const norm = (s) => (s || "").toString().trim().replace(/\s+/g, " ");
const uncategorised = (s, fallback) => norm(s) || fallback;

// pending / partial / paid, plus "overdue" for anything unpaid past its
// due date (the app never writes an overdue status itself).
export function effectiveStatus(inv, today = new Date()) {
  if (inv.status === "paid") return "paid";
  if (invoiceOutstanding(inv) <= 0) return "paid";
  const due = parseDay(inv.dueDate);
  if (due && endOfDay(due) < today) return "overdue";
  return inv.status === "partial" ? "partial" : "pending";
}

// Spread an amount over an invoice's line items in proportion to their
// value, so "collected" can be reported per fee type (tuition, transport…).
export function allocateByHead(inv, total) {
  const items = (Array.isArray(inv.lineItems) ? inv.lineItems : []).filter(l => num(l.amount) > 0);
  const sum = items.reduce((s, l) => s + num(l.amount), 0);
  if (!items.length || !sum) return [{ head: "Fees", amount: total }];
  return items.map(l => ({ head: uncategorised(l.description, "Fees"), amount: (total * num(l.amount)) / sum }));
}

// Attach the derived fields every report needs, once.
export function prepareData(raw) {
  const studentsById = new Map((raw.students || []).map(s => [s.id, s]));
  const invoices = (raw.invoices || []).map(i => {
    const st = studentsById.get(i.studentId);
    return {
      ...i,
      _billedOn: recordDate.invoiceBilled(i),
      _collectedOn: invoiceCollected(i) > 0 ? recordDate.invoiceCollected(i) : null,
      _settledOn: recordDate.invoiceCollected(i),
      _amount: num(i.amount),
      _paid: invoiceCollected(i),
      _concession: invoiceConcession(i),
      _outstanding: invoiceOutstanding(i),
      _unverified: invoiceUnverified(i),
      _grade: norm(st?.grade) || "Unassigned",
      _student: norm(i.studentName) || norm(st?.name) || "Unknown student",
      _studentCode: st?.studentId || "",
    };
  });
  return {
    invoices,
    expenses: (raw.expenses || []).map(e => ({ ...e, _on: recordDate.expense(e), _amount: num(e.amount) })),
    payslips: (raw.payslips || []).map(p => ({ ...p, _on: recordDate.payslip(p), _amount: num(p.netPay ?? p.amount), _isPaid: String(p.status || "").toLowerCase() === "paid" })),
    payments: (raw.payments || []).map(p => ({ ...p, _on: recordDate.payment(p), _amount: num(p.amount) })),
    students: raw.students || [],
    accounts: raw.accounts || [],
  };
}

// Every dated record, for closing an "All time" range.
export function allRecordDates(d) {
  return [
    ...d.invoices.map(i => i._billedOn), ...d.invoices.map(i => i._collectedOn),
    ...d.expenses.map(e => e._on), ...d.payslips.map(p => p._on), ...d.payments.map(p => p._on),
  ].filter(Boolean);
}

const sortDesc = (rows) => rows.sort((a, b) => b.amount - a.amount);
function tally(map, label, amount) {
  const row = map.get(label) || { label, amount: 0, count: 0 };
  row.amount += amount;
  row.count += 1;
  map.set(label, row);
}
const withShare = (rows) => {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.map(r => ({ ...r, share: total > 0 ? r.amount / total : 0 }));
};

// ------------------------------------------------------- profit & loss

// basis: "cash"    income = money received in the period (by paid date)
//        "accrual" income = fees billed in the period less concessions (by invoice month)
// Expenses are dated by expense.date; payroll is cash-basis on BOTH bases
// (only paid payslips, by paid date; unpaid ones are the `payrollUnpaid` memo).
export function computeFinancials(d, { range, branch = "all", basis = "cash" }) {
  const invoices = d.invoices.filter(i => matchesBranch(i, branch));
  const allExpenses = d.expenses.filter(e => matchesBranch(e, branch));
  const allPayslips = d.payslips.filter(p => matchesBranch(p, branch));
  const expenses = allExpenses.filter(e => inRange(e._on, range));
  const payslips = allPayslips.filter(p => inRange(p._on, range));
  const bounded = Boolean(range && (range.from || range.to));

  // Every per-invoice figure below (_paid, _concession, _outstanding, _unverified)
  // comes from reporting.invoiceFacts, so both bases share one definition of
  // collected / pending / unverified.
  //   cash:    income = collected (money recorded against invoices, by paid date)
  //   accrual: income = billed in the period less concessions on those invoices
  //            ("earned"). It is a labelled view for budgeting / year-over-year;
  //            `collected`, `pending` and `unverified` keep their shared meaning
  //            and an invoice marked paid with no money is still `unverified`.
  const accrual = basis === "accrual";
  let billed = 0, collected = 0, concessions = 0, pending = 0, earned = 0;
  let unverified = 0, unverifiedCount = 0, unverifiedAllTime = 0, unverifiedAllTimeCount = 0, undated = 0;
  const heads = new Map();
  for (const i of invoices) {
    const billedHere = inRange(i._billedOn, range);
    if (billedHere) {
      billed += i._amount;
      if (accrual) {
        const net = Math.max(0, i._amount - i._concession);
        earned += net;
        for (const a of allocateByHead(i, net)) tally(heads, a.head, a.amount);
      }
    } else if (bounded && !i._billedOn) undated++;
    // Outstanding is a balance as of today: branch-scoped, not cut by the period.
    pending += i._outstanding;
    // Cash basis: concessions and unverified "paid" claims follow the settlement
    // date. Accrual basis: a concession reduces the invoice it belongs to, so it
    // follows the billing period.
    const settled = i._settledOn || i._billedOn;
    if (i._concession > 0 && inRange(accrual ? i._billedOn : settled, range)) concessions += i._concession;
    if (i._unverified > 0) {
      unverifiedAllTime += i._unverified; unverifiedAllTimeCount++;
      if (inRange(settled, range)) { unverified += i._unverified; unverifiedCount++; }
    }
    if (i._paid > 0) {
      if (inRange(i._collectedOn, range)) {
        collected += i._paid;
        if (!accrual) for (const a of allocateByHead(i, i._paid)) tally(heads, a.head, a.amount);
      } else if (bounded && !i._collectedOn) undated++;
    }
  }
  if (bounded) undated += allExpenses.filter(e => !e._on).length + allPayslips.filter(p => !p._on).length;

  const categories = new Map();
  let opex = 0;
  for (const e of expenses) {
    opex += e._amount;
    tally(categories, uncategorised(e.category, "Uncategorised"), e._amount);
  }

  // Payroll is cash-basis on both bases: only PAID payslips are an expense. Unpaid ones are a memo.
  const roles = new Map();
  let payroll = 0, payrollUnpaid = 0, paidSlips = 0;
  for (const p of payslips) {
    if (p._isPaid) {
      payroll += p._amount;
      paidSlips += 1;
      tally(roles, uncategorised(p.role, "Unspecified role"), p._amount);
    } else {
      payrollUnpaid += p._amount;
    }
  }

  // Ledger income: cash_in receipts that are NOT the receipt side of an invoice,
  // expense or payslip (those are already counted above), reversals or transfers.
  // It is cash received, so it is dated by payment date on both bases.
  let otherIncome = 0;
  for (const p of d.payments || []) {
    if (!isLedgerIncome(p) || p._amount <= 0 || !matchesBranch(p, branch) || !inRange(p._on, range)) continue;
    otherIncome += p._amount;
    tally(heads, uncategorised(p.category, "Other income"), p._amount);
  }

  const totalExpenses = opex + payroll;
  const income = (accrual ? earned : collected) + otherIncome;
  const net = income - totalExpenses;
  return {
    basis, billed, collected, concessions, pending, income, otherIncome,
    unverified, unverifiedCount, unverifiedAllTime, unverifiedAllTimeCount, undated,
    opex, payroll, payrollUnpaid, totalExpenses, net,
    margin: income > 0 ? net / income : null,
    byHead: withShare(sortDesc([...heads.values()])),
    byCategory: withShare(sortDesc([...categories.values()])),
    byRole: withShare(sortDesc([...roles.values()])),
    counts: { expenses: expenses.length, payslips: paidSlips },
  };
}

// Income / expense / net per time bucket.
export function buildSeries(d, { range, branch = "all", granularity, basis = "cash" }) {
  const g = resolveGranularity(range, granularity);
  const buckets = makeBuckets(range, g, { income: 0, billed: 0, expenses: 0, payroll: 0, outflow: 0, net: 0 });
  const byKey = new Map(buckets.map(b => [b.key, b]));
  const add = (date, field, amount) => {
    if (!date || date < range.from || date > range.to) return;
    const b = byKey.get(keyFor(date, g));
    if (b) b[field] += amount;
  };
  for (const i of d.invoices) {
    if (!matchesBranch(i, branch)) continue;
    add(i._billedOn, "billed", i._amount);
    if (basis === "accrual") add(i._billedOn, "income", Math.max(0, i._amount - i._concession));
    else if (i._paid > 0) add(i._collectedOn, "income", i._paid);
  }
  for (const p of d.payments || []) if (isLedgerIncome(p) && p._amount > 0 && matchesBranch(p, branch)) add(p._on, "income", p._amount);
  for (const e of d.expenses) if (matchesBranch(e, branch)) add(e._on, "expenses", e._amount);
  for (const p of d.payslips) if (p._isPaid && matchesBranch(p, branch)) add(p._on, "payroll", p._amount);
  for (const b of buckets) { b.outflow = b.expenses + b.payroll; b.net = b.income - b.outflow; }
  return { granularity: g, buckets };
}

// One row per branch, for side-by-side comparison.
export function branchBreakdown(d, branchList, { range, basis = "cash" }) {
  const list = [{ id: "main", name: "Main Office" }, ...branchList.map(b => ({ id: b.id, name: b.name }))];
  return list.map(b => {
    const f = computeFinancials(d, { range, branch: b.id, basis });
    const students = d.students.filter(s => matchesBranch(s, b.id)).length;
    const fee = f.billed - f.concessions;
    return {
      id: b.id, name: b.name, students,
      billed: f.billed, income: f.income, concessions: f.concessions, pending: f.pending,
      expenses: f.opex, payroll: f.payroll, net: f.net,
      collectionRate: fee > 0 ? Math.min(1, f.collected / fee) : null,
    };
  });
}

// { amount, pct } vs the previous period; pct is null when there is no
// base to compare with.
export function change(current, previous) {
  if (previous === null || previous === undefined) return null;
  const amount = current - previous;
  return { amount, pct: previous !== 0 ? amount / Math.abs(previous) : null };
}

// ------------------------------------------------------------ cash flow

const isCashAccount = (a) => a.subType === "Bank & Cash" || a.type === "Assets";
// Reversals post an equal-and-opposite row and flag the original; drop
// both so the ledger nets to zero exactly as the Bank & Cash page does.
const liveLedger = (payments) => payments.filter(p => !p.reversed && !p.reversalOf);
const signed = (p) => (p.type === "cash_in" ? p._amount : -p._amount);

// Which account a payment belongs to: the matching chart account's id, or
// a name-based key for postings that match no cash account (e.g. deleted).
const accountKeyOf = (cashAccounts, p) => {
  const a = cashAccounts.find(c => paymentInAccount(p, c));
  return a ? a.id : `name:${p.account || "Unlinked"}`;
};

export function computeCashFlow(d, { range, branch = "all", account = "", granularity }) {
  const cashAccounts = d.accounts.filter(isCashAccount);
  const scoped = liveLedger(d.payments).filter(p => matchesBranch(p, branch)).map(p => ({ p, key: accountKeyOf(cashAccounts, p) }));
  const wholeOrg = branch === "all";

  // One bucket per account (even with no postings) plus any unlinked names.
  const accounts = new Map(cashAccounts.map(a => [a.id, { key: a.id, name: a.name, base: wholeOrg ? num(a.balance) : 0, rows: [] }]));
  for (const { p, key } of scoped) {
    if (!accounts.has(key)) accounts.set(key, { key, name: p.account || "Unlinked", base: 0, rows: [] });
    accounts.get(key).rows.push(p);
  }

  // Opening = accounts' own opening balances (org-wide, so only when the
  // branch filter is "all") + everything posted before the range starts.
  const before = (p) => range.from && p._on && p._on < range.from;
  const perAccount = [...accounts.values()].filter(a => !account || a.key === account).map(a => {
    const opening = a.base + a.rows.filter(before).reduce((s, p) => s + signed(p), 0);
    const inflow = a.rows.filter(p => p.type === "cash_in" && inRange(p._on, range)).reduce((s, p) => s + p._amount, 0);
    const outflow = a.rows.filter(p => p.type === "cash_out" && inRange(p._on, range)).reduce((s, p) => s + p._amount, 0);
    return { key: a.key, name: a.name, opening, inflow, outflow, closing: opening + inflow - outflow };
  }).filter(a => a.opening || a.inflow || a.outflow || cashAccounts.some(c => c.id === a.key));

  const inPeriod = scoped.filter(({ p, key }) => (!account || key === account) && inRange(p._on, range)).map(x => x.p);
  const inCat = new Map(), outCat = new Map();
  for (const p of inPeriod) tally(p.type === "cash_in" ? inCat : outCat, uncategorised(p.category, "Uncategorised"), p._amount);

  const opening = perAccount.reduce((s, a) => s + a.opening, 0);
  const inflow = perAccount.reduce((s, a) => s + a.inflow, 0);
  const outflow = perAccount.reduce((s, a) => s + a.outflow, 0);

  const g = resolveGranularity(range, granularity);
  const buckets = makeBuckets(range, g, { inflow: 0, outflow: 0, net: 0, balance: 0 });
  const byKey = new Map(buckets.map(b => [b.key, b]));
  for (const p of inPeriod) {
    const b = byKey.get(keyFor(p._on, g));
    if (b) b[p.type === "cash_in" ? "inflow" : "outflow"] += p._amount;
  }
  let running = opening;
  for (const b of buckets) { b.net = b.inflow - b.outflow; running += b.net; b.balance = running; }

  return {
    opening, inflow, outflow, net: inflow - outflow, closing: opening + inflow - outflow,
    inByCategory: withShare(sortDesc([...inCat.values()])),
    outByCategory: withShare(sortDesc([...outCat.values()])),
    perAccount, granularity: g, buckets,
    transactions: inPeriod.slice().sort((a, b) => a._on - b._on),
    accountOptions: [...accounts.values()].map(a => ({ value: a.key, label: a.name })).sort((a, b) => a.label.localeCompare(b.label)),
    openingExcluded: !wholeOrg,
  };
}

// -------------------------------------------------------- balance sheet

// Asset accounts show their live balance as at a date (opening balance +
// ledger postings, the same sum the Bank & Cash page uses); liabilities
// and equity have no ledger behind them, so they show the stored balance.
export function computeBalanceSheet(d, { asAt, branch = "all" }) {
  const wholeOrg = branch === "all";
  const ledger = liveLedger(d.payments).filter(p => matchesBranch(p, branch) && (!asAt || (p._on && p._on <= asAt)));
  const live = (a) => {
    const opening = wholeOrg ? num(a.balance) : 0;
    return opening + ledger.filter(p => paymentInAccount(p, a)).reduce((s, p) => s + signed(p), 0);
  };
  const side = (types, computed) => {
    const rows = d.accounts.filter(a => types.includes(a.type)).map(a => ({
      id: a.id, code: a.code, name: a.name, balance: computed ? live(a) : num(a.balance),
    }));
    return { rows, total: rows.reduce((s, r) => s + r.balance, 0) };
  };
  return { assets: side(["Assets"], true), liabilitiesEquity: side(["Liabilities", "Equity"], false), branchScoped: !wholeOrg };
}

// ------------------------------------------------------------- fee report

export const AGING_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "90+ days"];
function agingBucket(inv, today) {
  const due = parseDay(inv.dueDate) || inv._billedOn;
  if (!due) return AGING_BUCKETS[0];
  const late = daysBetween(due, today);
  if (late <= 0) return AGING_BUCKETS[0];
  if (late <= 30) return AGING_BUCKETS[1];
  if (late <= 60) return AGING_BUCKETS[2];
  if (late <= 90) return AGING_BUCKETS[3];
  return AGING_BUCKETS[4];
}

// Filters for the fee report. The date range is applied separately
// (see summarizeFees) because billed-in-period and received-in-period
// select different invoices.
export function filterFeeRows(invoices, { branch = "all", grade = "", status = "", account = "", search = "", today = new Date() }) {
  const q = search.trim().toLowerCase();
  return invoices.filter(i =>
    matchesBranch(i, branch)
    && (!grade || i._grade === grade)
    && (!status || effectiveStatus(i, today) === status)
    && (!account || i.paidAccount === account)
    && (!q || i._student.toLowerCase().includes(q) || i._studentCode.toLowerCase().includes(q))
  );
}

export function summarizeFees(rows, { range, granularity, today = new Date() }) {
  const cohort = rows.filter(i => inRange(i._billedOn, range));
  const received = rows.filter(i => i._paid > 0 && inRange(i._collectedOn, range));

  const sum = (list, f) => list.reduce((s, i) => s + f(i), 0);
  const billed = sum(cohort, i => i._amount);
  const collected = sum(cohort, i => i._paid);
  const concessions = sum(cohort, i => i._concession);
  const outstanding = sum(cohort, i => i._outstanding);
  const overdue = sum(cohort.filter(i => effectiveStatus(i, today) === "overdue"), i => i._outstanding);
  const unverifiedRows = cohort.filter(i => i._unverified > 0);
  const unverified = sum(unverifiedRows, i => i._unverified);
  const payable = billed - concessions;

  const statusCounts = { paid: 0, partial: 0, pending: 0, overdue: 0 };
  for (const i of cohort) statusCounts[effectiveStatus(i, today)] += 1;

  const grades = new Map();
  for (const i of cohort) {
    const g = grades.get(i._grade) || { grade: i._grade, students: new Set(), billed: 0, collected: 0, concessions: 0, outstanding: 0 };
    g.students.add(i.studentId || i._student);
    g.billed += i._amount; g.collected += i._paid; g.concessions += i._concession; g.outstanding += i._outstanding;
    grades.set(i._grade, g);
  }
  const byGrade = [...grades.values()].map(g => ({
    ...g, students: g.students.size,
    rate: g.billed - g.concessions > 0 ? Math.min(1, g.collected / (g.billed - g.concessions)) : null,
  })).sort((a, b) => b.outstanding - a.outstanding);

  const heads = new Map();
  for (const i of cohort) {
    for (const a of allocateByHead(i, i._amount)) {
      const h = heads.get(a.head) || { head: a.head, billed: 0, collected: 0 };
      h.billed += a.amount;
      heads.set(a.head, h);
    }
    for (const a of allocateByHead(i, i._paid)) heads.get(a.head).collected += a.amount;
  }
  const byHead = [...heads.values()].map(h => ({ ...h, outstanding: Math.max(0, h.billed - h.collected) })).sort((a, b) => b.billed - a.billed);

  const aging = AGING_BUCKETS.map(label => ({ label, amount: 0, count: 0 }));
  for (const i of cohort) {
    if (i._outstanding <= 0) continue;
    const row = aging[AGING_BUCKETS.indexOf(agingBucket(i, today))];
    row.amount += i._outstanding; row.count += 1;
  }

  const owing = new Map();
  for (const i of cohort) {
    if (i._outstanding <= 0) continue;
    const key = i.studentId || i._student;
    const s = owing.get(key) || { key, studentId: i.studentId || "", student: i._student, code: i._studentCode, grade: i._grade, phone: i.parentPhone || "", outstanding: 0, invoices: 0, oldestDue: null };
    s.outstanding += i._outstanding; s.invoices += 1;
    const due = parseDay(i.dueDate) || i._billedOn;
    if (due && (!s.oldestDue || due < s.oldestDue)) s.oldestDue = due;
    owing.set(key, s);
  }
  const defaulters = [...owing.values()].sort((a, b) => b.outstanding - a.outstanding);

  const accounts = new Map();
  for (const i of received) tally(accounts, uncategorised(i.paidAccount, "Not recorded"), i._paid);

  // billed (by billing period) vs received (by paid date) over time
  const bucketRange = resolveRange(range, rows.flatMap(i => [i._billedOn, i._collectedOn]), today);
  const g = resolveGranularity(bucketRange, granularity);
  const buckets = makeBuckets(bucketRange, g, { billed: 0, received: 0 });
  const byKey = new Map(buckets.map(b => [b.key, b]));
  for (const i of rows) {
    if (i._billedOn && inRange(i._billedOn, bucketRange)) { const b = byKey.get(keyFor(i._billedOn, g)); if (b) b.billed += i._amount; }
    if (i._paid > 0 && i._collectedOn && inRange(i._collectedOn, bucketRange)) { const b = byKey.get(keyFor(i._collectedOn, g)); if (b) b.received += i._paid; }
  }

  return {
    cohort, received,
    billed, collected, concessions, outstanding, overdue,
    unverified, unverifiedCount: unverifiedRows.length,
    receivedInPeriod: sum(received, i => i._paid),
    rate: payable > 0 ? Math.min(1, collected / payable) : null,
    statusCounts, byGrade, byHead, aging, defaulters,
    byAccount: withShare(sortDesc([...accounts.values()])),
    granularity: g, buckets,
  };
}

// ------------------------------------------------------------ highlights

const pctText = (v) => `${Math.abs(Math.round(v * 100))}%`;
const rs = (n) => `Rs. ${Math.round(n).toLocaleString()}`;

// Plain-English call-outs for the top of the P&L and Fee tabs.
export function buildHighlights({ cur, prev, fees, branches, only = "", vs = "the previous period" }) {
  const out = [];
  if (only !== "fees" && prev) {
    const inc = change(cur.income, prev.income);
    if (inc?.pct !== null && inc?.pct !== undefined && Math.abs(inc.pct) >= 0.05)
      out.push({ tone: inc.pct > 0 ? "good" : "bad", text: `Income is ${inc.pct > 0 ? "up" : "down"} ${pctText(inc.pct)} on ${vs} (${rs(Math.abs(inc.amount))}).` });
    const exp = change(cur.totalExpenses, prev.totalExpenses);
    if (exp?.pct !== null && exp?.pct !== undefined && Math.abs(exp.pct) >= 0.05)
      out.push({ tone: exp.pct > 0 ? "bad" : "good", text: `Total expenses are ${exp.pct > 0 ? "up" : "down"} ${pctText(exp.pct)} on ${vs}.` });
  }
  const topCat = only === "fees" ? null : cur.byCategory[0];
  if (topCat && cur.totalExpenses > 0)
    out.push({ tone: "info", text: `Biggest operating expense: ${topCat.label} — ${rs(topCat.amount)} (${pctText(topCat.share)} of operating spend).` });
  if (only !== "fees" && cur.income > 0 && cur.payroll > 0)
    out.push({ tone: cur.payroll / cur.income > 0.7 ? "bad" : "info", text: `Payroll takes ${pctText(cur.payroll / cur.income)} of fee income.` });
  if (only !== "fees" && cur.payrollUnpaid > 0) out.push({ tone: "warn", text: `${rs(cur.payrollUnpaid)} of payroll for this period is not yet paid, so it is not counted as an expense.` });
  if (only !== "fees" && cur.unverified > 0) out.push({ tone: "warn", text: `${rs(cur.unverified)} of invoices are marked paid with no money recorded. They are not counted as income (see Books Check).` });
  if (fees) {
    if (fees.overdue > 0) out.push({ tone: "bad", text: `${rs(fees.overdue)} of fees is overdue.` });
    const worst = fees.byGrade.find(g => g.outstanding > 0);
    if (worst) out.push({ tone: "warn", text: `${worst.grade} has the most unpaid fees: ${rs(worst.outstanding)}.` });
  }
  if (branches && branches.length > 1) {
    const best = [...branches].sort((a, b) => b.net - a.net)[0];
    if (best && best.net > 0) out.push({ tone: "info", text: `${best.name} has the highest surplus: ${rs(best.net)}.` });
  }
  return out;
}

export const formatRs = (n) => `Rs. ${Math.round(num(n)).toLocaleString()}`;
export const formatPct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

// ------------------------------------------------------------ class view

// Every student in a class with what they were billed and still owe for
// the invoices billed in `range`, worst balance first.
export function classDetail(rows, grade, { range, today = new Date() }) {
  const byStudent = new Map();
  for (const i of rows) {
    if (i._grade !== grade || !inRange(i._billedOn, range)) continue;
    const key = i.studentId || i._student;
    const s = byStudent.get(key) || {
      key, studentId: i.studentId || "", student: i._student, code: i._studentCode, phone: i.parentPhone || "",
      billed: 0, collected: 0, concessions: 0, outstanding: 0, invoices: 0, unpaid: 0, overdue: false, oldestDue: null,
    };
    s.billed += i._amount; s.collected += i._paid; s.concessions += i._concession; s.outstanding += i._outstanding;
    s.invoices += 1;
    if (i._outstanding > 0) {
      s.unpaid += 1;
      if (effectiveStatus(i, today) === "overdue") s.overdue = true;
      const due = parseDay(i.dueDate) || i._billedOn;
      if (due && (!s.oldestDue || due < s.oldestDue)) s.oldestDue = due;
    }
    byStudent.set(key, s);
  }
  return [...byStudent.values()].map(s => ({
    ...s,
    status: s.outstanding <= 0 ? "paid" : s.overdue ? "overdue" : s.collected > 0 ? "partial" : "pending",
  })).sort((a, b) => b.outstanding - a.outstanding || a.student.localeCompare(b.student));
}

// Teachers who teach a class, from the Subjects list (subject.teacher is
// free text; subjects with no grade apply to every class and are skipped).
export function teachersForGrade(subjects, grade, branch = "all") {
  const byTeacher = new Map();
  for (const sub of subjects || []) {
    const teacher = norm(sub.teacher);
    if (!teacher || norm(sub.grade) !== grade || !matchesBranch(sub, branch)) continue;
    const t = byTeacher.get(teacher) || { teacher, subjects: [] };
    if (sub.name) t.subjects.push(norm(sub.name));
    byTeacher.set(teacher, t);
  }
  return [...byTeacher.values()].sort((a, b) => a.teacher.localeCompare(b.teacher));
}

// ------------------------------------------------------- shareable summary

// Plain-text summary for pasting into an email: heading, scope, a list of
// "label: value" lines and optional highlights.
export function buildSummaryText({ title, scope, lines, highlights = [] }) {
  const out = [title, scope, ""];
  for (const [label, value] of lines) out.push(`${label}: ${value}`);
  if (highlights.length) { out.push("", "Highlights:"); highlights.forEach(h => out.push(`- ${h.text}`)); }
  out.push("", "Generated from ZMI School ERP");
  return out.join("\n");
}
