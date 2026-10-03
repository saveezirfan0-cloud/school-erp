import {
  toMinor, fromMinor, round2, sumMoney, addMoney, subMoney, compareMoney,
  parsePositiveAmount, parseAmountCell, formatMoney, todayLocal, isIsoDate,
  parseLocalDate, monthKey, computeFeePayment,
} from "./money";

describe("toMinor / fromMinor / round2", () => {
  test("rounds on the decimal representation, half away from zero", () => {
    expect(toMinor(1.005)).toBe(101);
    expect(toMinor("1.005")).toBe(101);
    expect(toMinor(-1.005)).toBe(-101);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor(300.29999999999995)).toBe(30030);
    expect(toMinor(7.1e-15)).toBe(0);
  });
  test("invalid input is NaN, never 0", () => {
    for (const bad of ["", "  ", "abc", null, undefined, NaN, Infinity, true]) {
      expect(toMinor(bad)).toBeNaN();
    }
  });
  test("no negative zero", () => {
    expect(Object.is(toMinor(-0.001), 0)).toBe(true);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });
  test("round2 fixes the audit reproductions", () => {
    expect(round2(100.1 + 200.2)).toBe(300.3);
    expect(round2(1.2 + 50.1)).toBe(51.3);
    expect(round2(300.3 - 100.1)).toBe(200.2);
  });
  test("fromMinor", () => {
    expect(fromMinor(12345)).toBe(123.45);
    expect(fromMinor(NaN)).toBeNaN();
  });
});

describe("exact arithmetic", () => {
  test("sumMoney is exact and ignores junk", () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney(["100.10", "200.20", "", "x", null])).toBe(300.3);
    expect(sumMoney([])).toBe(0);
    expect(sumMoney(undefined)).toBe(0);
  });
  test("add / sub / compare", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subMoney(51.3, 51.300000000000004)).toBe(0);
    expect(compareMoney(51.300000000000004, 51.3)).toBe(0);
    expect(compareMoney(1, 2)).toBe(-1);
    expect(compareMoney(2, 1)).toBe(1);
    expect(compareMoney("a", 1)).toBeNaN();
  });
});

describe("parsePositiveAmount", () => {
  test("accepts positive values and rounds to 2 dp", () => {
    expect(parsePositiveAmount("5000")).toEqual({ ok: true, value: 5000, minor: 500000 });
    expect(parsePositiveAmount("10.456").value).toBe(10.46);
  });
  test("rejects zero, negative, NaN and absurd values", () => {
    expect(parsePositiveAmount(0).ok).toBe(false);
    expect(parsePositiveAmount("-5").ok).toBe(false);
    expect(parsePositiveAmount("abc").ok).toBe(false);
    expect(parsePositiveAmount(NaN).ok).toBe(false);
    expect(parsePositiveAmount("").ok).toBe(false);
    expect(parsePositiveAmount(1e20).ok).toBe(false);
    expect(parsePositiveAmount("-5", "Fee").error).toMatch(/^Fee/);
  });
});

describe("formatMoney", () => {
  test("whole amounts drop decimals, fractions keep two", () => {
    expect(formatMoney(5000)).toBe("5,000");
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney("abc")).toBe("0");
  });
});

describe("parseAmountCell", () => {
  test.each([
    [5000, 5000],
    ["5000", 5000],
    ["5,000.00", 5000],
    ["Rs. 5,000", 5000],
    ["Rs 5000", 5000],
    ["PKR 1 200", 1200],
    ["(1,200)", -1200],
    ["-300", -300],
    ["300-", -300],
    ["$12.50", 12.5],
    [".5", 0.5],
  ])("%p -> %p", (input, expected) => {
    expect(parseAmountCell(input)).toBe(expected);
  });
  test.each(["", "abc", "12abc", "1,2,3", "--5", null, undefined, "N/A"])("%p -> null", (input) => {
    expect(parseAmountCell(input)).toBeNull();
  });
  test("dates and non-finite numbers are not amounts", () => {
    expect(parseAmountCell(new Date())).toBeNull();
    expect(parseAmountCell(NaN)).toBeNull();
  });
});

describe("local dates", () => {
  test("todayLocal uses local fields, not UTC", () => {
    // Local 00:30 on 1 Nov: toISOString() in UTC+5 would give 31 Oct.
    const d = new Date(2026, 10, 1, 0, 30, 0);
    expect(todayLocal(d)).toBe("2026-11-01");
    const late = new Date(2026, 9, 31, 23, 59, 0);
    expect(todayLocal(late)).toBe("2026-10-31");
  });
  test("isIsoDate validates real calendar days", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  test("parseLocalDate / monthKey do not shift months", () => {
    const d = parseLocalDate("2026-10-01");
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(1);
    expect(parseLocalDate("nope")).toBeNull();
    expect(monthKey("2026-10-01")).toBe("2026-10");
    expect(monthKey("garbage")).toBe("");
  });
});

describe("computeFeePayment", () => {
  test("exact payment settles the invoice", () => {
    const r = computeFeePayment({ total: 5000, alreadyPaid: 0, amount: 5000 });
    expect(r).toMatchObject({ ok: true, status: "paid", newPaid: 5000, cash: 5000, balance: 0, concessionAdded: 0 });
  });
  test("part payment leaves a partial balance, repeated payments accumulate", () => {
    const first = computeFeePayment({ total: 5000, alreadyPaid: 0, amount: 2000 });
    expect(first).toMatchObject({ ok: true, status: "partial", newPaid: 2000, balance: 3000 });
    const second = computeFeePayment({ total: 5000, alreadyPaid: first.newPaid, amount: 3000 });
    expect(second).toMatchObject({ ok: true, status: "paid", newPaid: 5000, balance: 0 });
  });
  test("overpayment is rejected, with no float tolerance games", () => {
    const r = computeFeePayment({ total: 5000, alreadyPaid: 4000, amount: 1000.01 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exceeds the balance/);
  });
  test("floating point invoices (100.10 + 200.20) settle exactly", () => {
    const total = round2(100.1 + 200.2);
    const r = computeFeePayment({ total, alreadyPaid: 100.1, amount: 200.2 });
    expect(r).toMatchObject({ ok: true, status: "paid", balance: 0 });
    // 1.20 + 50.10 with 51.30 already received must not post a 7e-15 remainder
    const r2 = computeFeePayment({ total: 1.2 + 50.1, alreadyPaid: 51.3, amount: 0, concession: false });
    expect(r2.ok).toBe(false);
  });
  test("concession closes the remainder", () => {
    const r = computeFeePayment({ total: 5000, alreadyPaid: 1000, amount: 2000, concession: true });
    expect(r).toMatchObject({ ok: true, status: "paid", concessionAdded: 2000, concessionTotal: 2000, newPaid: 3000, cash: 2000, balance: 0 });
  });
  test("zero cash with concession is allowed, without it is not", () => {
    expect(computeFeePayment({ total: 5000, alreadyPaid: 0, amount: 0, concession: true })).toMatchObject({ ok: true, status: "paid", cash: 0, concessionAdded: 5000 });
    expect(computeFeePayment({ total: 5000, alreadyPaid: 0, amount: 0 }).ok).toBe(false);
    expect(computeFeePayment({ total: 5000, alreadyPaid: 0, amount: "" }).ok).toBe(false);
  });
  test("existing concession reduces the balance", () => {
    const r = computeFeePayment({ total: 5000, alreadyPaid: 1000, existingConcession: 1000, amount: 3000 });
    expect(r).toMatchObject({ ok: true, status: "paid", balance: 0 });
    expect(computeFeePayment({ total: 5000, alreadyPaid: 1000, existingConcession: 1000, amount: 3000.01 }).ok).toBe(false);
  });
  test("negative, NaN and bad totals are rejected", () => {
    expect(computeFeePayment({ total: 5000, amount: -1 }).ok).toBe(false);
    expect(computeFeePayment({ total: 5000, amount: "abc" }).ok).toBe(false);
    expect(computeFeePayment({ total: NaN, amount: 10 }).ok).toBe(false);
    expect(computeFeePayment({ total: 0, amount: 10 }).ok).toBe(false);
    expect(computeFeePayment({ total: -50, amount: 10 }).ok).toBe(false);
  });
  test("an already settled invoice has nothing to collect", () => {
    expect(computeFeePayment({ total: 5000, alreadyPaid: 5000, amount: 10 }).ok).toBe(false);
  });
});
