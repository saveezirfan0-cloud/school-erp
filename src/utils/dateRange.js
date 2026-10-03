// src/utils/dateRange.js
//
// Period helpers for dashboard-style date filtering. A "range" is
// { from: "YYYY-MM-DD" | null, to: "YYYY-MM-DD" | null } (inclusive on
// both ends, null = open ended). Dates are compared as plain strings so
// there is no timezone drift on date-only fields like paidDate.

import { toDate } from "./dates";

// Fiscal year starts on 1 July (Jul–Jun), the usual schools / Pakistan
// convention. Change this one number if the institute uses another year end.
export const FISCAL_YEAR_START_MONTH = 7; // 1 = Jan … 12 = Dec

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Normalise any stored date (date-only string, ISO timestamp, Firestore
// Timestamp) to a local "YYYY-MM-DD", or "" when it can't be parsed.
export function toYMD(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = toDate(value);
  return d ? ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) : "";
}

export function todayYMD(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Fiscal year is named by the calendar year it STARTS in (FY 2026 = Jul 2026 – Jun 2027).
export function fiscalYearOf(now = new Date()) {
  const m = now.getMonth() + 1;
  return m >= FISCAL_YEAR_START_MONTH ? now.getFullYear() : now.getFullYear() - 1;
}

export function fiscalYearRange(startYear) {
  const sm = FISCAL_YEAR_START_MONTH;
  if (sm === 1) return calendarYearRange(startYear);
  const endMonth = sm - 1;
  return { from: ymd(startYear, sm, 1), to: ymd(startYear + 1, endMonth, lastDay(startYear + 1, endMonth)) };
}

export function calendarYearRange(year) {
  return { from: ymd(year, 1, 1), to: ymd(year, 12, 31) };
}

export function fiscalYearLabel(startYear) {
  return FISCAL_YEAR_START_MONTH === 1
    ? String(startYear)
    : `FY ${startYear}–${String(startYear + 1).slice(2)}`;
}

// Selectable years for the year pickers: current year back 5 years, plus next.
export function yearOptions(kind, now = new Date()) {
  const cur = kind === "fiscal" ? fiscalYearOf(now) : now.getFullYear();
  const out = [];
  for (let y = cur + 1; y >= cur - 5; y--) out.push(y);
  return out;
}

export const PERIOD_MODES = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "last30", label: "Last 30 days" },
  { value: "quarter", label: "This quarter" },
  { value: "calendar", label: "Calendar year" },
  { value: "fiscal", label: "Fiscal year" },
  { value: "custom", label: "Custom range" },
];

export function defaultPeriod(now = new Date()) {
  return { mode: "fiscal", year: fiscalYearOf(now), from: "", to: "" };
}

// period = { mode, year, from, to }  ->  { from, to }
export function resolveRange(period, now = new Date()) {
  const { mode, year, from, to } = period || {};
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  switch (mode) {
    case "today": { const t = todayYMD(now); return { from: t, to: t }; }
    case "month": return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
    }
    case "last30": {
      const start = new Date(y, now.getMonth(), now.getDate() - 29);
      return { from: ymd(start.getFullYear(), start.getMonth() + 1, start.getDate()), to: todayYMD(now) };
    }
    case "quarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, qs, 1), to: ymd(y, qs + 2, lastDay(y, qs + 2)) };
    }
    case "calendar": return calendarYearRange(Number(year) || y);
    case "fiscal": return fiscalYearRange(Number(year) || fiscalYearOf(now));
    case "custom": return { from: from || null, to: to || null };
    default: return { from: null, to: null };
  }
}

export function inRange(value, range) {
  if (!range || (!range.from && !range.to)) return true;
  const d = toYMD(value);
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

const fmt = (s) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

export function describePeriod(period, range) {
  if (!range.from && !range.to) return "All time";
  const span = range.from && range.to ? `${fmt(range.from)} – ${fmt(range.to)}` : range.from ? `From ${fmt(range.from)}` : `Up to ${fmt(range.to)}`;
  if (period.mode === "fiscal") return `${fiscalYearLabel(Number(period.year))} · ${span}`;
  if (period.mode === "calendar") return `${period.year} · ${span}`;
  return span;
}

// Build chart buckets covering `range`. Daily for spans up to ~2 months,
// monthly otherwise. For an open-ended range pass the data's own min/max
// dates as `fallback`.
export function buildBuckets(range, fallback = {}) {
  const from = range.from || fallback.from;
  const to = range.to || fallback.to;
  if (!from || !to || from > to) return { unit: "month", buckets: [] };

  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const days = Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000) + 1;

  const buckets = [];
  if (days <= 62) {
    for (let i = 0; i < days; i++) {
      const dt = new Date(fy, fm - 1, fd + i);
      const key = ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      buckets.push({ key, label: `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]}` });
    }
    return { unit: "day", buckets };
  }
  let cy = fy, cm = fm;
  while ((cy < ty || (cy === ty && cm <= tm)) && buckets.length < 120) {
    buckets.push({
      key: `${cy}-${pad(cm)}`,
      label: `${MONTH_NAMES[cm - 1]} ${String(cy).slice(2)}`,
    });
    cm++; if (cm > 12) { cm = 1; cy++; }
  }
  return { unit: "month", buckets };
}

export const bucketKey = (unit, value) => {
  const d = toYMD(value);
  return unit === "day" ? d : d.slice(0, 7);
};
