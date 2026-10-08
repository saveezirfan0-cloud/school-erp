import { monthRange, periodLabel, periodsAlreadyInvoiced, MAX_PERIODS } from "./billingPeriods";

test("a single month is a range of one", () => {
  expect(monthRange({ fromMonth: "October", fromYear: 2026 })).toEqual({
    periods: [{ month: "October", year: 2026 }],
  });
});

test("a range lists every month in order, including across a year boundary", () => {
  const { periods } = monthRange({ fromMonth: "November", fromYear: 2026, toMonth: "February", toYear: 2027 });
  expect(periods).toEqual([
    { month: "November", year: 2026 },
    { month: "December", year: 2026 },
    { month: "January", year: 2027 },
    { month: "February", year: 2027 },
  ]);
});

test("the to-year defaults to the from-year and years may be strings (form inputs)", () => {
  const { periods } = monthRange({ fromMonth: "March", fromYear: "2026", toMonth: "May", toYear: "" });
  expect(periods.map((p) => `${p.month} ${p.year}`)).toEqual(["March 2026", "April 2026", "May 2026"]);
  expect(periods.every((p) => typeof p.year === "number")).toBe(true);
});

test("rejects a last month before the first, missing months and bad years", () => {
  expect(monthRange({ fromMonth: "May", fromYear: 2026, toMonth: "March", toYear: 2026 }).error).toMatch(/not be before/);
  expect(monthRange({ fromMonth: "", fromYear: 2026 }).error).toMatch(/Choose the month/);
  expect(monthRange({ fromMonth: "May", fromYear: "abc" }).error).toMatch(/valid year/);
  expect(monthRange({ fromMonth: "May", fromYear: 2026, toMonth: "Nope" }).error).toMatch(/last month/);
});

test("caps the number of months billed at once", () => {
  expect(monthRange({ fromMonth: "January", fromYear: 2026, toMonth: "December", toYear: 2027 }).periods).toHaveLength(MAX_PERIODS);
  expect(monthRange({ fromMonth: "January", fromYear: 2026, toMonth: "January", toYear: 2028 }).error).toMatch(/at most/);
});

test("periodLabel describes one month or a from–to range", () => {
  expect(periodLabel([{ month: "October", year: 2026 }])).toBe("October 2026");
  expect(periodLabel([{ month: "October", year: 2026 }, { month: "December", year: 2026 }])).toBe("October 2026 – December 2026");
  expect(periodLabel([])).toBe("");
});

test("periodsAlreadyInvoiced finds this student's existing months regardless of year type", () => {
  const periods = monthRange({ fromMonth: "October", fromYear: 2026, toMonth: "December", toYear: 2026 }).periods;
  const invoices = [
    { id: 1, studentId: "s1", month: "October", year: "2026" },
    { id: 2, studentId: "s1", month: "December", year: 2026 },
    { id: 3, studentId: "s2", month: "November", year: 2026 },
  ];
  expect(periodsAlreadyInvoiced(periods, invoices, "s1").map((p) => p.month)).toEqual(["October", "December"]);
  expect(periodsAlreadyInvoiced(periods, invoices, "s3")).toEqual([]);
});
