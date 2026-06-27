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
