// src/utils/billingPeriods.js
//
// "Which months am I billing?" for the New Invoice form. An invoice always
// covers exactly one month (bulk / recurring generation and the reports
// dedupe and group on studentId + month + year), so billing a student for
// several months means one invoice per month. This file turns a from–to
// range into that list and describes it for the user.

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Never more than this many invoices from one form submit.
export const MAX_PERIODS = 24;

const monthIndex = (name) => MONTH_NAMES.indexOf(String(name || "").trim());
const toYear = (y) => {
  const n = Number(y);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : NaN;
};

// Every month from (fromMonth, fromYear) up to and including (toMonth,
// toYear), in order. The "to" side defaults to the "from" side, so a single
// month is a range of one.
//
// Returns { periods: [{ month, year }, ...] } or { error }.
export function monthRange({ fromMonth, fromYear, toMonth, toYear: toY }) {
  const fm = monthIndex(fromMonth);
  const fy = toYear(fromYear);
  if (fm < 0) return { error: "Choose the month" };
  if (Number.isNaN(fy)) return { error: "Enter a valid year" };

  const tm = toMonth ? monthIndex(toMonth) : fm;
  const ty = toY === undefined || toY === null || toY === "" ? fy : toYear(toY);
  if (tm < 0) return { error: "Choose the last month to bill" };
  if (Number.isNaN(ty)) return { error: "Enter a valid year for the last month" };

  const from = fy * 12 + fm;
  const to = ty * 12 + tm;
  if (to < from) return { error: "The last month must not be before the first month" };
  if (to - from + 1 > MAX_PERIODS) return { error: `You can bill at most ${MAX_PERIODS} months at once` };

  const periods = [];
  for (let k = from; k <= to; k++) {
    periods.push({ month: MONTH_NAMES[k % 12], year: Math.floor(k / 12) });
  }
  return { periods };
}

// "October 2026" or "October 2026 – December 2026".
export function periodLabel(periods) {
  if (!periods || periods.length === 0) return "";
  const one = (p) => `${p.month} ${p.year}`;
  return periods.length === 1 ? one(periods[0]) : `${one(periods[0])} – ${one(periods[periods.length - 1])}`;
}

// Key used to match a period against existing invoice rows.
export const periodKey = (p) => `${p.month}|${Number(p.year)}`;

// Periods for which this student already has an invoice (any kind), so the
// form can warn before creating a second one for the same month.
export function periodsAlreadyInvoiced(periods, invoices, studentId) {
  const have = new Set(
    (invoices || [])
      .filter((i) => i.studentId === studentId)
      .map((i) => periodKey({ month: i.month, year: i.year }))
  );
  return (periods || []).filter((p) => have.has(periodKey(p)));
}
