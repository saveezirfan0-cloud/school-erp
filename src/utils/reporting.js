// src/utils/reporting.js
//
// ONE set of money definitions for every screen that reports on the
// books (Dashboard, Reports, Bank & Cash, Student Ledger, Aging,
// Collections, Books Check). Before this file each page had its own
// formula, so the same data produced 17,000 on the Dashboard and 10,500
// on Reports (audit ACC-04). Everything here is pure (no I/O) so it can
// be unit-tested.
//
// DEFINITIONS
// -----------
// Scope        Trashed records (deletedAt set) are never counted. The
//              shim already hides them; isLive() is a second guard.
//              Branch filtering is always matchesBranch() ("main" matches
//              rows with an empty branchId).
// Invoice      billed      = amount
//              concession  = concessionAmount
//              paid        = paidAmount (cash recorded against the invoice)
//              outstanding = 0 when status is "paid", otherwise
//                            max(0, amount - paid - concession). This
//                            covers pending, partial, overdue and any
//                            other non-paid status (the old Dashboard
//                            ignored "partial").
//              unverified  = status is "paid" but paid + concession is
//                            less than amount, i.e. someone marked it
//                            paid without recording the money. It is NOT
//                            counted as collected and NOT as outstanding;
//                            it is reported on its own line so it can be
//                            chased (this is the ACC-01 gap).
// Collected    sum of paid, dated by paid date (paidDate, falling back to
//              the invoice date, then createdAt). Never the face value.
// Billed       sum of amount, dated by the billing period (month + year of
//              the invoice) when it has one, else invoice date, else
//              createdAt. Reports' fee cohorts and the Dashboard's
//              collection rate therefore cut the same invoices.
// Outstanding  a point-in-time balance "as of today"; it is not cut by
//              the date range, only by branch.
// Collection   collected / (billed - concessions) over the invoices that
//   rate       were billed inside the range.
// Expenses     sum of expense amount by expense date.
// Salaries     sum of netPay (falls back to amount) of PAID payslips only,
//              dated by paid date (paidDate, then date, then the payslip's
//              month + year). Unpaid payslips are not cash and are not
//              counted (Reports shows them as a separate memo line).
// Net          collected - expenses - salaries (cash basis).
// Dates        All dates are handled as local "YYYY-MM-DD" strings and
//              compared as strings, never through new Date("YYYY-MM-DD")
//              (which is UTC and shifts the day/month).

import { matchesBranch } from "./branchFilter";
import { toDate } from "./dates";

// Platform (PostgREST) row cap. A query that returns exactly this many
// rows has almost certainly been truncated.
export const ROW_CAP = 1000;
export const isCapped = (count) => Number(count) === ROW_CAP;

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export const isLive = (r) => !!r && (r.deletedAt === null || r.deletedAt === undefined || r.deletedAt === "");

// ------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const ymdFromParts = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function validYmd(s) {
  const m = YMD.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function todayLocal(now = new Date()) {
  return ymdFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Normalise a date-ish value (YYYY-MM-DD string, ISO timestamp, Date,
// Firestore-style Timestamp) to a local "YYYY-MM-DD", or "" if unusable.
export function toYmd(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (validYmd(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
      const head = s.slice(0, 10);
      if (!validYmd(head)) return "";
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? "" : todayLocal(d);
    }
    return "";
  }
  const d = toDate(value);
  return d ? todayLocal(d) : "";
}

export const monthKey = (value) => toYmd(value).slice(0, 7);

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || "");
  return m ? `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : key || "";
}

// Whole days between two YMD strings (b - a), DST-proof.
export function daysBetween(a, b) {
  const pa = YMD.exec(a), pb = YMD.exec(b);
  if (!pa || !pb) return NaN;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((tb - ta) / 86400000);
}

export const DATE_PRESETS = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "ytd", label: "Year to date" },
  { id: "last_year", label: "Last year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

// Inclusive { from, to } in local YMD. "" means unbounded.
export function presetRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const today = todayLocal(now);
  switch (preset) {
    case "this_month":
      return { from: ymdFromParts(y, m, 1), to: today };
    case "last_month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
      return { from: ymdFromParts(ly, lm, 1), to: ymdFromParts(ly, lm, last) };
    }
    case "ytd":
      return { from: ymdFromParts(y, 1, 1), to: today };
    case "last_year":
      return { from: ymdFromParts(y - 1, 1, 1), to: ymdFromParts(y - 1, 12, 31) };
    default:
      return { from: "", to: "" };
  }
}

export function rangeLabel(range) {
  const { from, to } = range || {};
  if (!from && !to) return "All time";
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : `Up to ${to}`;
}

export const isUnbounded = (range) => !range || (!range.from && !range.to);

// ymd must already be normalised. Undated rows only fall inside an
// unbounded range (callers count them separately as "undated").
export function inRange(ymd, range) {
  if (isUnbounded(range)) return true;
  if (!ymd) return false;
  if (range.from && ymd < range.from) return false;
  if (range.to && ymd > range.to) return false;
  return true;
}

// ------------------------------------------------------------------
// Invoices
// ------------------------------------------------------------------
// "January" / "Jan" / 1 -> 1..12, or 0 when unusable.
export function monthNumber(m) {
  if (m === null || m === undefined || m === "") return 0;
  if (typeof m === "number" || /^\d+$/.test(String(m).trim())) {
    const n = Number(m);
    return n >= 1 && n <= 12 ? n : 0;
  }
  const i = MONTH_NAMES.findIndex((x) => x.toLowerCase() === String(m).trim().slice(0, 3).toLowerCase());
  return i + 1;
}
// First day of a record's month + year, as YMD, or "".
export function periodYmd(rec) {
  const mo = monthNumber(rec?.month);
  const y = Number(rec?.year);
  return mo && y >= 1900 && y <= 2200 ? ymdFromParts(y, mo, 1) : "";
}

export const invoiceDate = (inv) => periodYmd(inv) || toYmd(inv.date) || toYmd(inv.createdAt);
export const invoicePaidDate = (inv) => toYmd(inv.paidDate) || toYmd(inv.date) || toYmd(inv.createdAt);

export function invoiceFacts(inv) {
  const status = String(inv.status || "pending").toLowerCase();
  const billed = num(inv.amount);
  const concession = Math.max(0, num(inv.concessionAmount));
  const paid = Math.max(0, num(inv.paidAmount));
  const isPaid = status === "paid";
  const gap = round2(billed - paid - concession);
  return {
    status,
    billed,
    concession,
    paid,
    outstanding: isPaid ? 0 : Math.max(0, gap),
    unverified: isPaid ? Math.max(0, gap) : 0,
  };
}

export function summarizeInvoices(invoices, { branch = "all", range, today = todayLocal() } = {}) {
  const out = {
    billed: 0, collected: 0, concessions: 0,
    outstanding: 0, outstandingCount: 0, overdue: 0, overdueCount: 0,
    unverified: 0, unverifiedCount: 0, unverifiedAllTime: 0, unverifiedAllTimeCount: 0,
    collectionRate: 0, undated: 0, invoiceCount: 0,
  };
  let cohortNet = 0;
  let cohortPaid = 0;
  for (const inv of invoices || []) {
    if (!isLive(inv) || !matchesBranch(inv, branch)) continue;
    out.invoiceCount++;
    const f = invoiceFacts(inv);
    const billedOn = invoiceDate(inv);
    const settledOn = invoicePaidDate(inv);

    if (inRange(billedOn, range)) {
      out.billed += f.billed;
      cohortNet += f.billed - f.concession;
      cohortPaid += f.paid;
    } else if (!billedOn && !isUnbounded(range)) {
      out.undated++;
    }
    if ((f.paid > 0 || f.concession > 0 || f.unverified > 0) && inRange(settledOn, range)) {
      out.collected += f.paid;
      out.concessions += f.concession;
      out.unverified += f.unverified;
      if (f.unverified > 0) out.unverifiedCount++;
    } else if ((f.paid > 0 || f.unverified > 0) && !settledOn && !isUnbounded(range)) {
      out.undated++;
    }
    if (f.unverified > 0) {
      out.unverifiedAllTime += f.unverified;
      out.unverifiedAllTimeCount++;
    }
    if (f.outstanding > 0) {
      out.outstanding += f.outstanding;
      out.outstandingCount++;
      const due = toYmd(inv.dueDate);
      if (due && due < today) {
        out.overdue += f.outstanding;
        out.overdueCount++;
      }
    }
  }
  out.collectionRate = cohortNet > 0 ? Math.round((cohortPaid / cohortNet) * 100) : 0;
  for (const k of ["billed", "collected", "concessions", "outstanding", "overdue", "unverified", "unverifiedAllTime"]) {
    out[k] = round2(out[k]);
  }
  return out;
}

// ------------------------------------------------------------------
// Expenses, payroll, profit & loss
// ------------------------------------------------------------------
export const expenseDate = (e) => toYmd(e.date) || toYmd(e.createdAt);
export const payslipPaidDate = (p) => toYmd(p.paidDate) || toYmd(p.date) || periodYmd(p);
// Where an UNPAID payslip sits (its pay period); used for memo lines only.
export const payslipPeriodDate = (p) => periodYmd(p) || toYmd(p.date) || toYmd(p.createdAt);
export const payslipAmount = (p) => num(p.netPay ?? p.amount);

export function sumExpenses(expenses, { branch = "all", range } = {}) {
  let total = 0, undated = 0;
  for (const e of expenses || []) {
    if (!isLive(e) || !matchesBranch(e, branch)) continue;
    const d = expenseDate(e);
    if (!d && !isUnbounded(range)) { undated++; continue; }
    if (inRange(d, range)) total += num(e.amount);
  }
  return { total: round2(total), undated };
}

export function sumSalaries(payslips, { branch = "all", range } = {}) {
  let total = 0, undated = 0;
  for (const p of payslips || []) {
    if (!isLive(p) || !matchesBranch(p, branch)) continue;
    if (String(p.status || "").toLowerCase() !== "paid") continue;
    const d = payslipPaidDate(p);
    if (!d && !isUnbounded(range)) { undated++; continue; }
    if (inRange(d, range)) total += payslipAmount(p);
  }
  return { total: round2(total), undated };
}

export function profitAndLoss({ invoices, expenses, payslips }, opts = {}) {
  const inv = summarizeInvoices(invoices, opts);
  const exp = sumExpenses(expenses, opts);
  const sal = sumSalaries(payslips, opts);
  return {
    ...inv,
    expenses: exp.total,
    salaries: sal.total,
    net: round2(inv.collected - exp.total - sal.total),
    undated: inv.undated + exp.undated + sal.undated,
  };
}

// Months covered by a range; for an unbounded range, the span of the data.
function monthSpan(range, dataMonths) {
  let from = range?.from ? range.from.slice(0, 7) : "";
  let to = range?.to ? range.to.slice(0, 7) : "";
  const sorted = [...dataMonths].filter(Boolean).sort();
  if (!from) from = sorted[0] || "";
  if (!to) to = sorted[sorted.length - 1] || "";
  if (!from || !to || from > to) return [];
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Month-by-month income / expenses / salaries, keyed YYYY-MM so that
// different years never merge.
export function monthlySeries({ invoices, expenses, payslips }, { branch = "all", range } = {}) {
  const income = new Map(), exp = new Map(), sal = new Map();
  const add = (map, key, v) => { if (key) map.set(key, (map.get(key) || 0) + v); };
  for (const i of invoices || []) {
    if (!isLive(i) || !matchesBranch(i, branch)) continue;
    const f = invoiceFacts(i);
    const d = invoicePaidDate(i);
    if (f.paid > 0 && inRange(d, range)) add(income, d.slice(0, 7), f.paid);
  }
  for (const e of expenses || []) {
    if (!isLive(e) || !matchesBranch(e, branch)) continue;
    const d = expenseDate(e);
    if (d && inRange(d, range)) add(exp, d.slice(0, 7), num(e.amount));
  }
  for (const p of payslips || []) {
    if (!isLive(p) || !matchesBranch(p, branch)) continue;
    if (String(p.status || "").toLowerCase() !== "paid") continue;
    const d = payslipPaidDate(p);
    if (d && inRange(d, range)) add(sal, d.slice(0, 7), payslipAmount(p));
  }
  const keys = monthSpan(range, [...income.keys(), ...exp.keys(), ...sal.keys()]);
  return keys.map((key) => ({
    key,
    month: monthLabel(key),
    income: round2(income.get(key) || 0),
    expenses: round2(exp.get(key) || 0),
    salaries: round2(sal.get(key) || 0),
    outflow: round2((exp.get(key) || 0) + (sal.get(key) || 0)),
  }));
}

// ------------------------------------------------------------------
// Payments and accounts
// ------------------------------------------------------------------
export const paymentAccountId = (p) => p.accountId || p.account_id || "";

// A "fee receipt" is a live cash_in tied to an invoice that has not been
// reversed and is not itself a reversal. Reversal pairs are excluded
// entirely (the pair nets to zero and the invoice goes back to unpaid).
export function isEffectiveInvoiceReceipt(p) {
  return isLive(p) && p.source === "invoice" && p.type === "cash_in" && !p.reversed && !p.reversalOf;
}

// Assign every payment to exactly one account. Id wins; the account
// NAME is only a fallback for rows that predate account ids. When two
// live accounts share a name, name-keyed payments go to the first of
// them (by code) so a duplicate never doubles the total (ACC-07).
export function attributePayments(accounts, payments) {
  const live = (accounts || []).filter(isLive).slice()
    .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
  const byId = new Map(live.map((a) => [a.id, a]));
  const byName = new Map();
  const duplicateNames = new Set();
  for (const a of live) {
    const key = String(a.name || "").trim();
    if (!key) continue;
    if (byName.has(key)) duplicateNames.add(key);
    else byName.set(key, a);
  }
  const byAccount = new Map(live.map((a) => [a.id, []]));
  const unmatched = [];
  for (const p of payments || []) {
    if (!isLive(p)) continue;
    const id = paymentAccountId(p);
    let acc = id ? byId.get(id) : null;
    if (!acc) acc = byName.get(String(p.account || "").trim()) || null;
    if (acc) byAccount.get(acc.id).push(p);
    else unmatched.push(p);
  }
  return { byAccount, unmatched, duplicateNames: [...duplicateNames] };
}

// Opening balance plus every live row (reversal pairs net to zero).
export function accountTotals(account, rows) {
  let inflow = 0, outflow = 0;
  for (const p of rows || []) {
    if (p.type === "cash_in") inflow += num(p.amount);
    else if (p.type === "cash_out") outflow += num(p.amount);
  }
  const opening = num(account?.balance);
  return {
    opening,
    inflow: round2(inflow),
    outflow: round2(outflow),
    balance: round2(opening + inflow - outflow),
    count: (rows || []).length,
  };
}

// ------------------------------------------------------------------
// "Paid" claims versus ledger rows (detects ACC-01)
// ------------------------------------------------------------------
// Net ledger money per invoice: effective receipts only.
export function ledgerPaidByInvoice(payments) {
  const m = new Map();
  for (const p of payments || []) {
    if (!isEffectiveInvoiceReceipt(p)) continue;
    m.set(p.sourceId, (m.get(p.sourceId) || 0) + num(p.amount));
  }
  return m;
}

// Invoices whose paid/partial status is not backed by ledger rows.
//   kind "no_ledger": nothing posted at all
//   kind "short":     ledger holds less than the invoice claims
//   kind "excess":    ledger holds more than the invoice claims
export function invoicesWithoutLedger(invoices, payments, { branch = "all", tolerance = 0.5 } = {}) {
  const ledger = ledgerPaidByInvoice(payments);
  const out = [];
  for (const inv of invoices || []) {
    if (!isLive(inv) || !matchesBranch(inv, branch)) continue;
    const f = invoiceFacts(inv);
    if (f.status !== "paid" && f.paid <= 0) continue;
    // What the invoice claims was received in cash.
    const claimed = f.status === "paid" ? Math.max(f.paid, f.billed - f.concession) : f.paid;
    const posted = round2(ledger.get(inv.id) || 0);
    const diff = round2(claimed - posted);
    if (Math.abs(diff) <= tolerance) continue;
    out.push({
      id: inv.id,
      studentName: inv.studentName || "",
      studentId: inv.studentId || "",
      branchId: inv.branchId || "",
      status: f.status,
      claimed,
      posted,
      diff,
      date: invoicePaidDate(inv),
      kind: posted === 0 ? "no_ledger" : diff > 0 ? "short" : "excess",
    });
  }
  return out.sort((a, b) => b.diff - a.diff);
}

// Paid payslips/expenses with a paid account but no live ledger row.
export function docsWithoutLedger(docs, payments, source, isClaimed, amountOf) {
  const posted = new Map();
  for (const p of payments || []) {
    if (!isLive(p) || p.source !== source || p.type !== "cash_out" || p.reversed || p.reversalOf) continue;
    posted.set(p.sourceId, (posted.get(p.sourceId) || 0) + num(p.amount));
  }
  const out = [];
  for (const d of docs || []) {
    if (!isLive(d) || !isClaimed(d)) continue;
    const amount = amountOf(d);
    const got = round2(posted.get(d.id) || 0);
    if (Math.abs(amount - got) > 0.5) out.push({ id: d.id, amount, posted: got, doc: d });
  }
  return out;
}

// Every reversed original needs a live reversal row and vice versa.
export function reversalIntegrity(payments) {
  const live = (payments || []).filter(isLive);
  const reversalTargets = new Set(live.filter((p) => p.reversalOf).map((p) => p.reversalOf));
  const originals = new Map(live.map((p) => [p.id, p]));
  const problems = [];
  for (const p of live) {
    if (p.reversed && !reversalTargets.has(p.id)) problems.push({ id: p.id, issue: "Marked reversed but no reversing entry exists", payment: p });
    if (p.reversalOf) {
      const o = originals.get(p.reversalOf);
      if (!o) problems.push({ id: p.id, issue: "Reversing entry points at a missing or deleted original", payment: p });
      else if (!o.reversed) problems.push({ id: p.id, issue: "Reversing entry exists but the original is not marked reversed", payment: p });
    }
  }
  return problems;
}

// Transfers are two legs; in must equal out across live, non-reversed rows.
export function transferBalance(payments) {
  let inn = 0, out = 0;
  for (const p of payments || []) {
    if (!isLive(p) || p.category !== "Bank Transfer" || p.reversed) continue;
    if (p.type === "cash_in") inn += num(p.amount);
    else if (p.type === "cash_out") out += num(p.amount);
  }
  return { in: round2(inn), out: round2(out), diff: round2(inn - out) };
}

// ------------------------------------------------------------------
// Chart of accounts: trial balance and balance sheet
// ------------------------------------------------------------------
const DEBIT_TYPES = new Set(["Assets", "Expenses"]);
export const normalSide = (type) => (DEBIT_TYPES.has(type) ? "debit" : "credit");
const KNOWN_TYPES = new Set(["Assets", "Liabilities", "Equity", "Income", "Expenses"]);

function resolveAccount(accounts, id, name) {
  if (id) {
    const a = accounts.find((x) => x.id === id);
    if (a) return a;
  }
  const n = String(name || "").trim();
  return n ? accounts.find((x) => String(x.name || "").trim() === n) || null : null;
}

// Journals as double entries. Returns the problems it could not post.
export function checkJournals(accounts, journals) {
  const live = (accounts || []).filter(isLive);
  const posted = [];
  const problems = [];
  for (const j of (journals || []).filter(isLive)) {
    const amount = num(j.amount);
    const dr = resolveAccount(live, j.debitAccountId, j.debitAccount);
    const cr = resolveAccount(live, j.creditAccountId, j.creditAccount);
    let issue = "";
    if (!(amount > 0)) issue = "Amount is zero or negative";
    else if (!dr || !cr) issue = "Debit or credit account not found (renamed or deleted?)";
    else if (dr.id === cr.id) issue = "Debit and credit are the same account";
    if (issue) problems.push({ id: j.id, issue, journal: j });
    else posted.push({ id: j.id, amount, debit: dr.id, credit: cr.id });
  }
  return { posted, problems };
}

// Net debit minus credit per account from opening balances, journals and
// cash movements. Also returns the one number that tells you whether
// the books tie: opening balances must satisfy Dr = Cr.
export function trialBalance({ accounts, journals, payments }) {
  const live = (accounts || []).filter(isLive);
  // The cash_out / cash_in payment is the ledger entry for money. The app also
  // writes an informational journal next to some payments, and that journal must
  // not be posted on top of its payment or the money is counted twice:
  //  - source "expense": a paid expense's journal, keyed by the expense id. A
  //    duplicate while the expense's cash_out payment stands.
  //  - source "payment": a fee collection's (invoice cash_in) or salary's
  //    (payslip cash_out) journal, keyed by the PAYMENT id. It mirrors that
  //    payment whether it still stands or has been reversed (a reversed payment
  //    nets to zero cash, so its journal must not survive it either).
  // A journal whose payment cannot be found is a standalone entry and is posted.
  const paidExpenses = new Set();
  const journaledPayments = new Set();
  for (const p of payments || []) {
    if (!isLive(p)) continue;
    if (p.source === "expense" && p.type === "cash_out" && !p.reversed && !p.reversalOf) paidExpenses.add(p.sourceId);
    if ((p.source === "invoice" && p.type === "cash_in") || (p.source === "payslip" && p.type === "cash_out")) {
      if (!p.reversalOf) journaledPayments.add(p.id);
    }
  }
  const mirrorsPayment = (j) =>
    (j.source === "expense" && paidExpenses.has(j.sourceId)) ||
    (j.source === "payment" && journaledPayments.has(j.sourceId));
  const { posted, problems } = checkJournals(live, (journals || []).filter((j) => !mirrorsPayment(j)));
  const attributed = attributePayments(live, payments);

  const rows = live.map((a) => {
    const open = num(a.balance);
    const openNet = normalSide(a.type) === "debit" ? open : -open;
    return { account: a, openNet, journalNet: 0, cashNet: 0 };
  });
  const byId = new Map(rows.map((r) => [r.account.id, r]));
  for (const j of posted) {
    byId.get(j.debit).journalNet += j.amount;
    byId.get(j.credit).journalNet -= j.amount;
  }
  let cashNet = 0;
  for (const [id, list] of attributed.byAccount) {
    const r = byId.get(id);
    for (const p of list) {
      const v = p.type === "cash_in" ? num(p.amount) : p.type === "cash_out" ? -num(p.amount) : 0;
      r.cashNet += v;
      cashNet += v;
    }
  }
  const unknownType = [];
  let openingDebit = 0, openingCredit = 0, journalDebit = 0, journalCredit = 0;
  for (const r of rows) {
    r.net = round2(r.openNet + r.journalNet + r.cashNet);
    if (!KNOWN_TYPES.has(r.account.type)) unknownType.push(r.account);
    if (r.openNet >= 0) openingDebit += r.openNet; else openingCredit -= r.openNet;
  }
  for (const j of posted) { journalDebit += j.amount; journalCredit += j.amount; }
  const openingDiff = round2(openingDebit - openingCredit);
  return {
    rows,
    journalProblems: problems,
    postedJournals: posted.length,
    openingDebit: round2(openingDebit),
    openingCredit: round2(openingCredit),
    openingDiff,
    journalDebit: round2(journalDebit),
    journalCredit: round2(journalCredit),
    cashNet: round2(cashNet),
    unmatchedPayments: attributed.unmatched,
    duplicateNames: attributed.duplicateNames,
    unknownType,
    balanced: openingDiff === 0 && problems.length === 0,
  };
}

// Balance sheet derived from opening balances + journals + cash
// movements. Fees receivable, unpaid payslips and unpaid expenses are
// not accounts in this system, so they are not on it. Cash movements
// have no counter account (single entry), so they appear as one derived
// line on the equity side; "difference" is then exactly the opening
// balance imbalance and is shown, never hidden.
export function balanceSheet({ accounts, journals, payments }) {
  const tb = trialBalance({ accounts, journals, payments });
  const section = (types, sign) => {
    const items = tb.rows
      .filter((r) => types.includes(r.account.type))
      .map((r) => ({ account: r.account, value: round2(sign * r.net) }));
    return { items, total: round2(items.reduce((s, i) => s + i.value, 0)) };
  };
  const assets = section(["Assets"], 1);
  const liabilities = section(["Liabilities"], -1);
  const equity = section(["Equity"], -1);
  const income = section(["Income"], -1);
  const expenses = section(["Expenses"], 1);
  const earnings = round2(income.total - expenses.total);
  const unbooked = tb.cashNet;
  const rightTotal = round2(liabilities.total + equity.total + earnings + unbooked);
  return {
    assets, liabilities, equity, income, expenses, earnings,
    unbookedCash: unbooked,
    rightTotal,
    difference: round2(assets.total - rightTotal),
    tb,
  };
}

// ------------------------------------------------------------------
// Aging / defaulters
// ------------------------------------------------------------------
export const AGING_BUCKETS = [
  { key: "current", label: "Not yet due" },
  { key: "d0_30", label: "0-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "d90plus", label: "90+ days" },
];

// days = how many days past due (negative = not yet due)
export function bucketForDays(days) {
  if (days < 0) return "current";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));

// One row per student with money outstanding. Invoices with no due date
// age from their invoice date and the row is flagged.
export function buildAging(invoices, students, { branch = "all", today = todayLocal() } = {}) {
  const studentById = new Map((students || []).map((s) => [s.id, s]));
  const rowsByKey = new Map();
  const totals = emptyBuckets();
  let grand = 0, invoiceCount = 0;
  for (const inv of invoices || []) {
    if (!isLive(inv) || !matchesBranch(inv, branch)) continue;
    const f = invoiceFacts(inv);
    if (f.outstanding <= 0) continue;
    let due = toYmd(inv.dueDate);
    let estimated = false;
    if (!due) { due = invoiceDate(inv); estimated = true; }
    if (!due) continue;
    const days = daysBetween(due, today);
    const bucket = bucketForDays(days);
    const key = inv.studentId || `name:${inv.studentName || "unknown"}`;
    let row = rowsByKey.get(key);
    if (!row) {
      const s = studentById.get(inv.studentId);
      row = {
        key,
        studentId: inv.studentId || "",
        name: s?.name || inv.studentName || "Unknown student",
        studentCode: s?.studentId || "",
        grade: s?.grade || "",
        phone: s?.parentPhone || inv.parentPhone || "",
        parentName: s?.parentName || "",
        branchId: inv.branchId || s?.branchId || "",
        buckets: emptyBuckets(),
        total: 0,
        overdueTotal: 0,
        oldestDays: -Infinity,
        invoiceCount: 0,
        estimatedDue: false,
      };
      rowsByKey.set(key, row);
    }
    row.buckets[bucket] += f.outstanding;
    row.total += f.outstanding;
    if (bucket !== "current") row.overdueTotal += f.outstanding;
    row.oldestDays = Math.max(row.oldestDays, days);
    row.invoiceCount++;
    row.estimatedDue = row.estimatedDue || estimated;
    totals[bucket] += f.outstanding;
    grand += f.outstanding;
    invoiceCount++;
  }
  const rows = [...rowsByKey.values()].map((r) => {
    for (const k of Object.keys(r.buckets)) r.buckets[k] = round2(r.buckets[k]);
    r.total = round2(r.total);
    r.overdueTotal = round2(r.overdueTotal);
    return r;
  }).sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total);
  for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
  return { rows, totals, total: round2(grand), invoiceCount };
}

// ------------------------------------------------------------------
// Collections (ledger-posted fee receipts)
// ------------------------------------------------------------------
// One normalised row per effective fee receipt. Branch falls back to the
// invoice's branch when the payment row has none.
export function collectionRows({ payments, invoices, accounts }, { branch = "all", range } = {}) {
  const invById = new Map((invoices || []).map((i) => [i.id, i]));
  const attributed = attributePayments(accounts, payments);
  const owner = new Map();
  for (const [id, list] of attributed.byAccount) for (const p of list) owner.set(p.id, id);
  const accById = new Map((accounts || []).map((a) => [a.id, a]));
  const rows = [];
  let undated = 0;
  for (const p of payments || []) {
    if (!isEffectiveInvoiceReceipt(p)) continue;
    const inv = invById.get(p.sourceId);
    const branchId = p.branchId || inv?.branchId || "";
    if (!matchesBranch({ branchId }, branch)) continue;
    const date = toYmd(p.date) || toYmd(p.createdAt);
    if (!date && !isUnbounded(range)) { undated++; continue; }
    if (!inRange(date, range)) continue;
    const accId = owner.get(p.id) || "";
    rows.push({
      id: p.id,
      date,
      month: date.slice(0, 7),
      branchKey: branchId || "main",
      accountKey: accId || `name:${p.account || ""}`,
      accountName: accById.get(accId)?.name || p.account || "(unknown account)",
      amount: num(p.amount),
      invoiceId: p.sourceId,
    });
  }
  return { rows, undated, unmatched: attributed.unmatched.length };
}

// rows -> { rowKeys, colKeys, cell(r,c), rowTotals, colTotals, grand }
export function pivot(rows, rowField, colField) {
  const cells = new Map();
  const rowTotals = new Map(), colTotals = new Map();
  let grand = 0;
  for (const r of rows) {
    const rk = r[rowField], ck = r[colField];
    const key = `${rk}\u0000${ck}`;
    cells.set(key, (cells.get(key) || 0) + r.amount);
    rowTotals.set(rk, (rowTotals.get(rk) || 0) + r.amount);
    colTotals.set(ck, (colTotals.get(ck) || 0) + r.amount);
    grand += r.amount;
  }
  const keys = (m) => [...m.keys()].sort();
  return {
    rowKeys: keys(rowTotals),
    colKeys: keys(colTotals),
    cell: (rk, ck) => round2(cells.get(`${rk}\u0000${ck}`) || 0),
    rowTotal: (rk) => round2(rowTotals.get(rk) || 0),
    colTotal: (ck) => round2(colTotals.get(ck) || 0),
    grand: round2(grand),
  };
}

// ------------------------------------------------------------------
// Student ledger
// ------------------------------------------------------------------
// Same definitions as everywhere else, for one student's invoices.
export function studentStatement(invoices, payments) {
  const live = (invoices || []).filter(isLive);
  let billed = 0, concessions = 0, received = 0, outstanding = 0, unverified = 0;
  for (const inv of live) {
    const f = invoiceFacts(inv);
    billed += f.billed;
    concessions += f.concession;
    received += f.paid;
    outstanding += f.outstanding;
    unverified += f.unverified;
  }
  const ledger = ledgerPaidByInvoice(payments);
  let posted = 0;
  for (const inv of live) posted += ledger.get(inv.id) || 0;
  return {
    billed: round2(billed),
    concessions: round2(concessions),
    received: round2(received),
    outstanding: round2(outstanding),
    unverified: round2(unverified),
    postedToLedger: round2(posted),
    ledgerGap: round2(received - posted),
  };
}

// ------------------------------------------------------------------
// Row decoding for pages that must query the database directly
// (snake_case columns -> camelCase, `extra` jsonb merged to top level,
// the same shape the firebase.js shim returns).
// ------------------------------------------------------------------
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function decodeRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "extra" && v && typeof v === "object") Object.assign(out, v);
    else out[toCamel(k)] = v;
  }
  return out;
}
