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
  // Date-only "YYYY-MM-DD": new Date() would read it as UTC midnight, which
  // is the previous evening in timezones west of UTC. Treat it as LOCAL.
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) {
      const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      // Reject impossible dates such as 2026-02-31 (JS would roll them over).
      return local.getMonth() === Number(m[2]) - 1 && local.getDate() === Number(m[3]) ? local : null;
    }
  }
  // ISO string or epoch number
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Today's date as "YYYY-MM-DD" in the LOCAL timezone. Use this instead of
// new Date().toISOString().slice(0, 10), which is the UTC date and is
// yesterday for the first hours of the local day east of UTC.
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
