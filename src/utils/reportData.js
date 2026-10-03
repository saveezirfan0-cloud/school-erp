// src/utils/reportData.js
//
// Pure functions behind the Reports page: date ranges, bucketing and the
// aggregations for each report. No React, no Supabase — everything takes
// plain arrays (already decoded to camelCase by the firebase shim) so it
// can be unit-tested and reused (e.g. by the Dashboard later).
//
// Accounting conventions (kept from the original Reports page):
//   * Income is cash-basis: money actually received (invoice.paidAmount),
//     dated by the invoice's paid date.
//   * Billed / outstanding are dated by the billing period (invoice
//     month + year, falling back to date / due date / created).
//   * Operating expenses are dated by expense.date.
//   * Payroll is dated by the payslip period (month + year).

import { toDate } from "./dates";
import { matchesBranch } from "./branchFilter";
// Same definitions of "collected" / "outstanding" as Dashboard and Fees & Invoices.
import { invoiceCollected, invoiceOutstanding, invoicePaymentDate } from "./invoiceTotals";

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
export const recordDate = {
  invoiceBilled(inv) {
    const mi = monthIndex(inv.month);
    const y = Number(inv.year);
    if (mi >= 0 && y) return new Date(y, mi, 1);
    return parseDay(inv.date) || parseDay(inv.dueDate) || parseDay(inv.createdAt);
  },
  invoiceCollected(inv) {
    return parseDay(inv.paidDate) || invoicePaymentDate(inv);
  },
  expense(e) {
    return parseDay(e.date) || parseDay(e.createdAt);
  },
  payslip(p) {
    const mi = monthIndex(p.month);
    const y = Number(p.year);
    if (mi >= 0 && y) return new Date(y, mi, 1);
    return parseDay(p.date) || parseDay(p.paidDate) || parseDay(p.createdAt);
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
      _amount: num(i.amount),
      _paid: invoiceCollected(i),
      _concession: num(i.concessionAmount),
      _outstanding: invoiceOutstanding(i),
      _grade: norm(st?.grade) || "Unassigned",
      _student: norm(i.studentName) || norm(st?.name) || "Unknown student",
      _studentCode: st?.studentId || "",
    };
  });
  return {
    invoices,
    expenses: (raw.expenses || []).map(e => ({ ...e, _on: recordDate.expense(e), _amount: num(e.amount) })),
    payslips: (raw.payslips || []).map(p => ({ ...p, _on: recordDate.payslip(p), _amount: num(p.netPay ?? p.amount) })),
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

export function computeFinancials(d, { range, branch = "all" }) {
  const invoices = d.invoices.filter(i => matchesBranch(i, branch));
  const expenses = d.expenses.filter(e => matchesBranch(e, branch) && inRange(e._on, range));
  const payslips = d.payslips.filter(p => matchesBranch(p, branch) && inRange(p._on, range));

  let billed = 0, collected = 0, concessions = 0, pending = 0;
  const heads = new Map();
  for (const i of invoices) {
    if (inRange(i._billedOn, range)) {
      billed += i._amount;
      pending += i._outstanding;
    }
    // A concession is agreed when the invoice is settled, so it follows the paid date.
    if (i._concession > 0 && inRange(i._collectedOn || i._billedOn, range)) concessions += i._concession;
    if (i._paid > 0 && inRange(i._collectedOn, range)) {
      collected += i._paid;
      for (const a of allocateByHead(i, i._paid)) tally(heads, a.head, a.amount);
    }
  }

  const categories = new Map();
  let opex = 0;
  for (const e of expenses) {
    opex += e._amount;
    tally(categories, uncategorised(e.category, "Uncategorised"), e._amount);
  }

  const roles = new Map();
  let payroll = 0, payrollUnpaid = 0;
  for (const p of payslips) {
    payroll += p._amount;
    if (p.status !== "paid") payrollUnpaid += p._amount;
    tally(roles, uncategorised(p.role, "Unspecified role"), p._amount);
  }

  const totalExpenses = opex + payroll;
  const income = collected;
  const net = income - totalExpenses;
  return {
    billed, collected, concessions, pending, income,
    opex, payroll, payrollUnpaid, totalExpenses, net,
    margin: income > 0 ? net / income : null,
    byHead: withShare(sortDesc([...heads.values()])),
    byCategory: withShare(sortDesc([...categories.values()])),
    byRole: withShare(sortDesc([...roles.values()])),
    counts: { expenses: expenses.length, payslips: payslips.length },
  };
}

// Income / expense / net per time bucket.
export function buildSeries(d, { range, branch = "all", granularity }) {
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
    if (i._paid > 0) add(i._collectedOn, "income", i._paid);
  }
  for (const e of d.expenses) if (matchesBranch(e, branch)) add(e._on, "expenses", e._amount);
  for (const p of d.payslips) if (matchesBranch(p, branch)) add(p._on, "payroll", p._amount);
  for (const b of buckets) { b.outflow = b.expenses + b.payroll; b.net = b.income - b.outflow; }
  return { granularity: g, buckets };
}

// One row per branch, for side-by-side comparison.
export function branchBreakdown(d, branchList, { range }) {
  const list = [{ id: "main", name: "Main Office" }, ...branchList.map(b => ({ id: b.id, name: b.name }))];
  return list.map(b => {
    const f = computeFinancials(d, { range, branch: b.id });
    const students = d.students.filter(s => matchesBranch(s, b.id)).length;
    const fee = f.billed - f.concessions;
    return {
      id: b.id, name: b.name, students,
      billed: f.billed, income: f.income, concessions: f.concessions, pending: f.pending,
      expenses: f.opex, payroll: f.payroll, net: f.net,
      collectionRate: fee > 0 ? Math.min(1, f.income / fee) : null,
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

export function computeCashFlow(d, { range, branch = "all", account = "", granularity }) {
  const cashAccounts = d.accounts.filter(isCashAccount);
  const scoped = liveLedger(d.payments).filter(p => matchesBranch(p, branch));
  const ledger = scoped.filter(p => !account || p.account === account);
  const wholeOrg = branch === "all";

  // Opening = accounts' own opening balances (org-wide, so only when the
  // branch filter is "all") + everything posted before the range starts.
  const openingBase = (name) => (wholeOrg ? num(cashAccounts.find(a => a.name === name)?.balance) : 0);
  const before = (p) => range.from && p._on && p._on < range.from;

  const names = new Set([...cashAccounts.map(a => a.name), ...scoped.map(p => p.account).filter(Boolean)]);
  const perAccount = [...names].filter(n => !account || n === account).map(name => {
    const rows = ledger.filter(p => p.account === name);
    const opening = openingBase(name) + rows.filter(before).reduce((s, p) => s + signed(p), 0);
    const inflow = rows.filter(p => p.type === "cash_in" && inRange(p._on, range)).reduce((s, p) => s + p._amount, 0);
    const outflow = rows.filter(p => p.type === "cash_out" && inRange(p._on, range)).reduce((s, p) => s + p._amount, 0);
    return { name, opening, inflow, outflow, closing: opening + inflow - outflow };
  }).filter(a => a.opening || a.inflow || a.outflow || cashAccounts.some(c => c.name === a.name));

  const inCat = new Map(), outCat = new Map();
  const inPeriod = ledger.filter(p => inRange(p._on, range));
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
    accountNames: [...names].sort(),
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
    return opening + ledger.filter(p => p.account === a.name).reduce((s, p) => s + signed(p), 0);
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
    const s = owing.get(key) || { key, student: i._student, code: i._studentCode, grade: i._grade, phone: i.parentPhone || "", outstanding: 0, invoices: 0, oldestDue: null };
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
export function buildHighlights({ cur, prev, fees, branches, only = "" }) {
  const out = [];
  if (only !== "fees" && prev) {
    const inc = change(cur.income, prev.income);
    if (inc?.pct !== null && inc?.pct !== undefined && Math.abs(inc.pct) >= 0.05)
      out.push({ tone: inc.pct > 0 ? "good" : "bad", text: `Income is ${inc.pct > 0 ? "up" : "down"} ${pctText(inc.pct)} on the previous period (${rs(Math.abs(inc.amount))}).` });
    const exp = change(cur.totalExpenses, prev.totalExpenses);
    if (exp?.pct !== null && exp?.pct !== undefined && Math.abs(exp.pct) >= 0.05)
      out.push({ tone: exp.pct > 0 ? "bad" : "good", text: `Total expenses are ${exp.pct > 0 ? "up" : "down"} ${pctText(exp.pct)} on the previous period.` });
  }
  const topCat = only === "fees" ? null : cur.byCategory[0];
  if (topCat && cur.totalExpenses > 0)
    out.push({ tone: "info", text: `Biggest operating expense: ${topCat.label} — ${rs(topCat.amount)} (${pctText(topCat.share)} of operating spend).` });
  if (only !== "fees" && cur.income > 0 && cur.payroll > 0)
    out.push({ tone: cur.payroll / cur.income > 0.7 ? "bad" : "info", text: `Payroll takes ${pctText(cur.payroll / cur.income)} of fee income.` });
  if (only !== "fees" && cur.payrollUnpaid > 0) out.push({ tone: "warn", text: `${rs(cur.payrollUnpaid)} of payroll in this period is still unpaid.` });
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
