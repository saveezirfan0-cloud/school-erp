// src/utils/money.js
//
// Pure money and date helpers shared by every page that posts money.
//
// RULES
//  - Never add, subtract or compare currency with raw floating point.
//    Convert to integer minor units (paisa) with toMinor(), do the
//    arithmetic on integers, and convert back with fromMinor().
//  - round2() is the single rounding function for anything that is
//    stored or displayed as an amount.
//  - Dates that mean "a calendar day" are YYYY-MM-DD strings in the
//    user's LOCAL time zone (todayLocal), never toISOString().slice(),
//    which is UTC and lands early-morning entries on the previous day.

export const MINOR_PER_UNIT = 100;

// Convert a number or numeric string into integer minor units.
// Returns NaN for blank / non-numeric / non-finite input.
// Rounds half away from zero on the DECIMAL representation, so
// 1.005 -> 101 (a plain Math.round(1.005 * 100) gives 100).
export function toMinor(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  if (typeof value === "boolean") return NaN;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return NaN;
  const abs = Math.abs(n);
  const s = String(abs);
  // Exponent notation (1e-7, 1e21): fall back to plain scaling.
  const scaled = /e/i.test(s) ? Math.round(abs * MINOR_PER_UNIT) : Math.round(Number(s + "e2"));
  if (scaled === 0) return 0; // avoid -0
  return n < 0 ? -scaled : scaled;
}

// Integer minor units back to a (2 dp) number.
export function fromMinor(minor) {
  if (!Number.isFinite(minor)) return NaN;
  const v = minor / MINOR_PER_UNIT;
  return v === 0 ? 0 : v; // avoid -0
}

// Round to 2 decimal places (returns NaN for invalid input).
export function round2(value) {
  return fromMinor(toMinor(value));
}

// Sum a list of amounts exactly (invalid entries count as 0).
export function sumMoney(values) {
  let total = 0;
  for (const v of values || []) {
    const m = toMinor(v);
    if (Number.isFinite(m)) total += m;
  }
  return fromMinor(total);
}

export function addMoney(a, b) {
  return fromMinor(toMinor(a) + toMinor(b));
}

export function subMoney(a, b) {
  return fromMinor(toMinor(a) - toMinor(b));
}

// Compare two amounts at paisa precision: -1, 0 or 1 (NaN if invalid).
export function compareMoney(a, b) {
  const x = toMinor(a);
  const y = toMinor(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  return x < y ? -1 : x > y ? 1 : 0;
}

// Validate a user-entered amount that must be a positive money value.
// Returns { ok: true, value } (value rounded to 2 dp) or { ok: false, error }.
export function parsePositiveAmount(input, label = "Amount") {
  const minor = toMinor(input);
  if (!Number.isFinite(minor)) return { ok: false, error: `${label} must be a number` };
  if (minor <= 0) return { ok: false, error: `${label} must be greater than zero` };
  if (minor > 1e13) return { ok: false, error: `${label} is too large` };
  return { ok: true, value: fromMinor(minor), minor };
}

// Format for display, e.g. 1234.5 -> "1,234.50". Whole amounts drop decimals.
export function formatMoney(value) {
  const minor = toMinor(value);
  if (!Number.isFinite(minor)) return "0";
  const v = fromMinor(minor);
  const whole = Number.isInteger(v);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// Lenient parser for amounts coming from spreadsheets / CSV:
//   5000, "5,000.00", "Rs. 5,000", "PKR 1 200", "(1,200)" (negative),
//   "-300", "300-" (trailing minus). Returns a 2 dp number or null.
// It deliberately does NOT interpret Dr/Cr; callers decide direction.
export function parseAmountCell(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? round2(raw) : null;
  if (raw instanceof Date) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s ]/g, "");
  // currency words / symbols at either end
  s = s.replace(/^(rs\.?|pkr|inr|usd|gbp|eur|aed|sar|[$£€₨₹])/i, "");
  s = s.replace(/(rs\.?|pkr|inr|usd|gbp|eur|aed|sar|[$£€₨₹])$/i, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith("+")) { s = s.slice(1); }
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1); }
  // thousands separators: commas only when they group digits properly
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const v = round2(n);
  return negative ? (v === 0 ? 0 : -v) : v;
}

// ---------------------------------------------------------------
// Dates (calendar days as YYYY-MM-DD in LOCAL time)
// ---------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");

// Today's calendar date in the user's local time zone.
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// Format any Date as a local YYYY-MM-DD.
export function toLocalDateString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return todayLocal(d);
}

export function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Parse YYYY-MM-DD as a LOCAL date (new Date("2026-10-01") is UTC and
// shifts to the previous month in zones west of UTC).
export function parseLocalDate(s) {
  if (!isIsoDate(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "2026-10-01" -> "2026-10" (for month bucketing without Date parsing).
export function monthKey(s) {
  return typeof s === "string" && /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
}

// ---------------------------------------------------------------
// Fee collection arithmetic (shared by every path that marks an
// invoice paid, so they all agree on status and balances).
// ---------------------------------------------------------------

/**
 * @param {object} p
 * @param {number|string} p.total              invoice amount
 * @param {number|string} p.alreadyPaid        cash already received (from the ledger)
 * @param {number|string} p.amount             cash received now (>= 0)
 * @param {number|string} [p.existingConcession] concession already granted
 * @param {boolean} [p.concession]             waive whatever remains after this payment
 * @returns {{ok:true, status:"paid"|"partial", newPaid:number, cash:number,
 *   concessionAdded:number, concessionTotal:number, balance:number}
 *   | {ok:false, error:string}}
 */
export function computeFeePayment({ total, alreadyPaid = 0, amount = 0, existingConcession = 0, concession = false }) {
  const totalM = toMinor(total);
  const paidM = toMinor(alreadyPaid || 0);
  const cashM = toMinor(amount === "" ? 0 : amount);
  const concM = toMinor(existingConcession || 0);
  if (!Number.isFinite(totalM) || totalM <= 0) return { ok: false, error: "Invoice amount is not valid" };
  if (!Number.isFinite(paidM) || !Number.isFinite(concM)) return { ok: false, error: "Existing payment data is not valid" };
  if (!Number.isFinite(cashM)) return { ok: false, error: "Enter a valid amount" };
  if (cashM < 0) return { ok: false, error: "Amount cannot be negative" };

  const balanceBefore = totalM - paidM - concM;
  if (balanceBefore <= 0) return { ok: false, error: "This invoice has no balance left to collect" };
  if (cashM > balanceBefore) {
    return { ok: false, error: `That exceeds the balance. Remaining is Rs. ${formatMoney(fromMinor(balanceBefore))}` };
  }
  if (cashM === 0 && !concession) return { ok: false, error: "Enter an amount or mark the balance as concession" };

  const remainingAfter = balanceBefore - cashM;
  const concessionAddedM = concession ? remainingAfter : 0;
  const balanceAfter = remainingAfter - concessionAddedM;
  return {
    ok: true,
    status: balanceAfter === 0 ? "paid" : "partial",
    newPaid: fromMinor(paidM + cashM),
    cash: fromMinor(cashM),
    concessionAdded: fromMinor(concessionAddedM),
    concessionTotal: fromMinor(concM + concessionAddedM),
    balance: fromMinor(balanceAfter),
  };
}
