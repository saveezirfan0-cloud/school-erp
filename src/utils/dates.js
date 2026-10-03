// src/utils/dates.js
// After the Supabase migration, timestamp fields (createdAt,
// paidDate, timestamp) are ISO strings, not Firestore Timestamp
// objects. Old code called `.toDate()` on them, which silently
// returns undefined now. These helpers parse BOTH shapes so the
// app keeps working whether a record was written before or after
// the migration.

export function toDate(value) {
  if (!value) return null;
  // Firestore Timestamp (legacy records)
  if (typeof value?.toDate === "function") return value.toDate();
  // { seconds, nanoseconds } shape
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  // ISO string or epoch number
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Epoch millis for sorting; 0 when unparseable so sorts are stable.
export function toMillis(value) {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}

// Convenience formatters that won't throw on bad input.
export function formatDate(value, locale = "en-GB", opts = { day: "2-digit", month: "short", year: "numeric" }) {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale, opts) : "—";
}

export function formatTime(value, locale = "en-GB", opts = { hour: "2-digit", minute: "2-digit" }) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(locale, opts) : "";
}

// Local-calendar "YYYY-MM-DD" (toISOString() would shift the day for
// anyone east/west of UTC — wrong for attendance, which is per local day).
export function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Time elapsed since a "YYYY-MM-DD" date, e.g. "2 yrs 3 mos".
export function durationSince(dateStr) {
  const d = dateStr && new Date(dateStr);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (now.getDate() < d.getDate()) months--;
  if (months < 0) return "Not started yet";
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} yr${y === 1 ? "" : "s"}`, (m || !y) && `${m} mo${m === 1 ? "" : "s"}`].filter(Boolean).join(" ");
}
