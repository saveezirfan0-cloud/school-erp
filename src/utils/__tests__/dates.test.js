import { toDate, toMillis, formatDate, formatTime, todayLocal } from "../dates";

// These tests are timezone independent; `npm run test:tz` also runs them
// under Asia/Karachi (UTC+5) and America/Los_Angeles (UTC-8).

describe("toDate", () => {
  test("null-ish and garbage give null", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate("garbage")).toBeNull();
  });

  test("Firestore-like shapes", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(toDate({ toDate: () => d })).toBe(d);
    expect(toDate({ seconds: 1000, nanoseconds: 0 }).getTime()).toBe(1000 * 1000);
  });

  test("ISO strings with offset and epoch millis", () => {
    expect(toDate("2026-03-31T10:00:00Z").getTime()).toBe(Date.UTC(2026, 2, 31, 10));
    expect(toDate("2026-03-31T10:00:00+05:00").getTime()).toBe(Date.UTC(2026, 2, 31, 5));
    expect(toDate(86400000).getTime()).toBe(86400000);
  });

  test("a date-only string is local midnight of that same calendar day in every timezone", () => {
    const d = toDate("2026-03-31");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 31, 0]);
  });

  test("impossible calendar dates are rejected", () => {
    expect(toDate("2026-02-31")).toBeNull();
    expect(toDate("2026-13-01")).toBeNull();
  });
});

describe("toMillis", () => {
  test("invalid gives 0 so sorts stay stable", () => {
    expect(toMillis("nope")).toBe(0);
    expect(toMillis(null)).toBe(0);
    expect(toMillis(5000)).toBe(5000);
  });
});

describe("formatDate / formatTime", () => {
  test("fallbacks for bad input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
    expect(formatTime(null)).toBe("");
  });

  test("formats a date-only value as that calendar day", () => {
    expect(formatDate("2026-03-31", "en-GB")).toBe("31 Mar 2026");
  });
});

describe("todayLocal", () => {
  test("uses the local calendar date, not the UTC one", () => {
    const now = new Date(2026, 2, 31, 0, 30); // 00:30 local on 31 March
    expect(todayLocal(now)).toBe("2026-03-31");
    const late = new Date(2026, 11, 31, 23, 59);
    expect(todayLocal(late)).toBe("2026-12-31");
  });

  test("zero pads month and day", () => {
    expect(todayLocal(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  test("defaults to now in YYYY-MM-DD form", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
