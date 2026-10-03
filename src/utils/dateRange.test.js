import { resolveRange, inRange, fiscalYearOf, fiscalYearRange, buildBuckets, toYMD } from "./dateRange";
import { effectiveBranchId, matchesBranchResolved } from "./branchFilter";

describe("fiscal / calendar years", () => {
  it("fiscal year runs 1 Jul – 30 Jun and is named by its start year", () => {
    expect(fiscalYearRange(2026)).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(fiscalYearOf(new Date(2026, 9, 3))).toBe(2026);  // Oct 2026
    expect(fiscalYearOf(new Date(2026, 2, 3))).toBe(2025);  // Mar 2026
  });

  it("resolves calendar year, months and custom ranges", () => {
    expect(resolveRange({ mode: "calendar", year: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(resolveRange({ mode: "month" }, new Date(2026, 1, 10))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange({ mode: "lastMonth" }, new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange({ mode: "custom", from: "2026-08-01", to: "" })).toEqual({ from: "2026-08-01", to: null });
    expect(resolveRange({ mode: "all" })).toEqual({ from: null, to: null });
  });

  it("inRange is inclusive and rejects unparseable dates when bounded", () => {
    const r = { from: "2026-07-01", to: "2027-06-30" };
    expect(inRange("2026-07-01", r)).toBe(true);
    expect(inRange("2027-06-30", r)).toBe(true);
    expect(inRange("2026-06-30", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
    expect(inRange(null, { from: null, to: null })).toBe(true);
  });

  it("toYMD keeps date-only strings untouched", () => {
    expect(toYMD("2026-08-29")).toBe("2026-08-29");
    expect(toYMD("")).toBe("");
  });

  it("buckets by day for short ranges and by month for long ones", () => {
    expect(buildBuckets({ from: "2026-08-01", to: "2026-08-03" }).unit).toBe("day");
    const m = buildBuckets({ from: "2026-07-01", to: "2027-06-30" });
    expect(m.unit).toBe("month");
    expect(m.buckets).toHaveLength(12);
    expect(m.buckets[0].key).toBe("2026-07");
  });
});

describe("effectiveBranchId", () => {
  const students = new Map([["s1", { id: "s1", branchId: "baneen" }], ["s2", { id: "s2", branchId: "" }]]);

  it("uses the student's current branch over a stale invoice branch", () => {
    const inv = { studentId: "s1", branchId: "" };
    expect(effectiveBranchId(inv, students)).toBe("baneen");
    expect(matchesBranchResolved(inv, "main", students)).toBe(false);
    expect(matchesBranchResolved(inv, "baneen", students)).toBe(true);
  });

  it("falls back to the record's branch when the student is unknown", () => {
    expect(effectiveBranchId({ studentId: "gone", branchId: "x" }, students)).toBe("x");
    expect(matchesBranchResolved({ studentId: "s2" }, "main", students)).toBe(true);
  });
});
