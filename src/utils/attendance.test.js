import {
  attendancePercent, isLowAttendance, formatPercent, tally, summarisePerStudent,
  buildStudentReport, overallPercent, dailyClassSummary, gradeLabel, gradeOptions,
  parseISODate, toISODate, addDays, startOfMonth, endOfMonth, isInRange,
  normaliseRange, presetRange, effectiveEntry, rosterCounts, buildMarkRows,
  escapeHtml, UNASSIGNED,
} from "./attendance";

const row = (studentId, date, status, grade = "5") => ({ studentId, date, status, grade });

describe("attendancePercent", () => {
  test("null when there are no records", () => {
    expect(attendancePercent({ present: 0, absent: 0, late: 0, leave: 0 })).toBeNull();
    expect(attendancePercent({})).toBeNull();
    expect(attendancePercent(undefined)).toBeNull();
  });
  test("null (not 0) when everything is leave", () => {
    expect(attendancePercent({ leave: 5 })).toBeNull();
  });
  test("leave is excluded from the denominator", () => {
    expect(attendancePercent({ present: 3, absent: 1, leave: 10 })).toBe(75);
  });
  test("late counts as present", () => {
    expect(attendancePercent({ present: 1, late: 1, absent: 2 })).toBe(50);
    expect(attendancePercent({ late: 4 })).toBe(100);
  });
  test("absent only is 0", () => {
    expect(attendancePercent({ absent: 3 })).toBe(0);
  });
  test("rounds to one decimal place", () => {
    expect(attendancePercent({ present: 2, absent: 1 })).toBe(66.7);
    expect(attendancePercent({ present: 1, absent: 7 })).toBe(12.5);
    expect(attendancePercent({ present: 1, absent: 2 })).toBe(33.3);
    expect(attendancePercent({ present: 199, absent: 1 })).toBe(99.5);
  });
});

describe("isLowAttendance / formatPercent", () => {
  test("strictly below threshold", () => {
    expect(isLowAttendance(74.9, 75)).toBe(true);
    expect(isLowAttendance(75, 75)).toBe(false);
  });
  test("null is never low", () => {
    expect(isLowAttendance(null, 75)).toBe(false);
  });
  test("threshold accepts numeric strings", () => {
    expect(isLowAttendance(60, "75")).toBe(true);
  });
  test("formats", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(80)).toBe("80%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("tally / summarisePerStudent", () => {
  test("ignores unknown statuses and empty input", () => {
    expect(tally([row("a", "d", "present"), row("a", "d", "bogus"), { studentId: "a" }])).toEqual({ present: 1, absent: 0, late: 0, leave: 0 });
    expect(tally(null)).toEqual({ present: 0, absent: 0, late: 0, leave: 0 });
  });
  test("per student totals and percent", () => {
    const s = summarisePerStudent([
      row("a", "2026-10-01", "present"),
      row("a", "2026-10-02", "late"),
      row("a", "2026-10-03", "absent"),
      row("a", "2026-10-04", "leave"),
      row("b", "2026-10-01", "leave"),
    ]);
    expect(s.a).toEqual({ present: 1, absent: 1, late: 1, leave: 1, total: 4, percent: 66.7 });
    expect(s.b.percent).toBeNull();
    expect(s.b.total).toBe(1);
  });
});

describe("buildStudentReport", () => {
  const students = [
    { id: "a", name: "Ali", studentId: "S1", grade: "5" },
    { id: "b", name: "Bina", studentId: "S2", grade: "" },
    { id: "c", name: "Cara", studentId: "S3", grade: "5" },
  ];
  const rows = [
    row("a", "1", "present"), row("a", "2", "absent"), row("a", "3", "absent"),
    row("b", "1", "present"),
  ];
  test("includes students with no records and flags only low ones", () => {
    const rep = buildStudentReport(students, rows, 75);
    expect(rep.map((r) => r.name)).toEqual(["Ali", "Bina", "Cara"]);
    expect(rep[0]).toMatchObject({ percent: 33.3, low: true, absent: 2 });
    expect(rep[1]).toMatchObject({ percent: 100, low: false, grade: UNASSIGNED });
    expect(rep[2]).toMatchObject({ percent: null, low: false, total: 0 });
  });
  test("threshold is configurable", () => {
    expect(buildStudentReport(students, rows, 20)[0].low).toBe(false);
  });
  test("overallPercent aggregates counts, not averages of percents", () => {
    const rep = buildStudentReport(students, rows, 75);
    expect(overallPercent(rep)).toBe(50); // 2 present / 4 countable
    expect(overallPercent([])).toBeNull();
  });
});

describe("dailyClassSummary", () => {
  test("groups by date + class, newest first", () => {
    const out = dailyClassSummary([
      row("a", "2026-10-01", "present", "5"),
      row("b", "2026-10-01", "absent", "5"),
      row("c", "2026-10-01", "late", "4"),
      row("a", "2026-10-02", "leave", "5"),
      row("d", "2026-10-02", "present", ""),
    ]);
    expect(out.map((l) => `${l.date}|${l.grade}`)).toEqual([
      "2026-10-02|5", "2026-10-02|Unassigned", "2026-10-01|4", "2026-10-01|5",
    ]);
    const d1g5 = out.find((l) => l.date === "2026-10-01" && l.grade === "5");
    expect(d1g5).toMatchObject({ present: 1, absent: 1, total: 2, percent: 50 });
    expect(out.find((l) => l.grade === "5" && l.date === "2026-10-02").percent).toBeNull();
  });
  test("empty input", () => {
    expect(dailyClassSummary([])).toEqual([]);
    expect(dailyClassSummary(undefined)).toEqual([]);
  });
});

describe("classes", () => {
  test("gradeLabel", () => {
    expect(gradeLabel("  ")).toBe(UNASSIGNED);
    expect(gradeLabel(undefined)).toBe(UNASSIGNED);
    expect(gradeLabel(" Grade 5 ")).toBe("Grade 5");
  });
  test("gradeOptions: natural sort, Unassigned last", () => {
    const opts = gradeOptions([{ grade: "Grade 10" }, { grade: "" }, { grade: "Grade 2" }, { grade: "Grade 2" }]);
    expect(opts).toEqual(["Grade 2", "Grade 10", UNASSIGNED]);
  });
});

describe("date helpers", () => {
  test("parse / format round trip, rejects impossible dates", () => {
    expect(toISODate(parseISODate("2026-02-28"))).toBe("2026-02-28");
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("26-02-01")).toBeNull();
    expect(parseISODate(null)).toBeNull();
  });
  test("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  test("month bounds", () => {
    expect(startOfMonth("2026-10-17")).toBe("2026-10-01");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
  test("isInRange is inclusive and open-ended on empty bounds", () => {
    expect(isInRange("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isInRange("2026-10-31", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isInRange("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isInRange("2026-09-30", "2026-10-01", "")).toBe(false);
    expect(isInRange("2030-01-01", "2026-10-01", "")).toBe(true);
    expect(isInRange("", "", "")).toBe(false);
  });
  test("normaliseRange swaps reversed bounds", () => {
    expect(normaliseRange("2026-10-10", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(normaliseRange("2026-10-01", "")).toEqual({ from: "2026-10-01", to: "" });
  });
  test("presetRange", () => {
    expect(presetRange("today", "2026-10-03")).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(presetRange("week", "2026-10-03")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(presetRange("month", "2026-10-03")).toEqual({ from: "2026-10-01", to: "2026-10-03" });
    expect(presetRange("lastMonth", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("marking helpers", () => {
  const students = [
    { id: "a", name: "Ali", grade: "5", branchId: "br1" },
    { id: "b", name: "Bina", grade: "", branchId: "" },
    { id: "c", name: "Cara", grade: "5", branchId: "main" },
  ];
  const saved = { a: { status: "absent", note: "sick" } };

  test("effectiveEntry: draft wins over saved, blank when unmarked", () => {
    expect(effectiveEntry(undefined, saved.a)).toEqual({ status: "absent", note: "sick" });
    expect(effectiveEntry({ status: "present" }, saved.a)).toEqual({ status: "present", note: "sick" });
    expect(effectiveEntry({ note: "" }, saved.a)).toEqual({ status: "absent", note: "" });
    expect(effectiveEntry(undefined, undefined)).toEqual({ status: "", note: "" });
    expect(effectiveEntry({ status: "nonsense" }, undefined).status).toBe("");
  });

  test("rosterCounts", () => {
    expect(rosterCounts(students, { b: { status: "late" } }, saved)).toEqual({
      present: 0, absent: 1, late: 1, leave: 0, unmarked: 1, total: 3,
    });
    expect(rosterCounts([], {}, {})).toMatchObject({ total: 0, unmarked: 0 });
  });

  test("buildMarkRows only emits touched, marked students with full fields", () => {
    const rows = buildMarkRows({
      students,
      draft: { a: { note: "back soon" }, b: { status: "present", note: " hi " }, c: { note: "x" } },
      savedByStudent: saved,
      date: "2026-10-03",
      markedBy: "t@school.pk",
    });
    expect(rows).toEqual([
      { studentId: "a", date: "2026-10-03", status: "absent", grade: "5", note: "back soon", markedBy: "t@school.pk", branchId: "br1" },
      { studentId: "b", date: "2026-10-03", status: "present", grade: "", note: "hi", markedBy: "t@school.pk", branchId: "" },
    ]); // c has a note but no status -> skipped
  });

  test("buildMarkRows normalises main branch to blank and handles empty draft", () => {
    const rows = buildMarkRows({ students, draft: { c: { status: "leave" } }, savedByStudent: {}, date: "d", markedBy: "" });
    expect(rows[0].branchId).toBe("");
    expect(buildMarkRows({ students, draft: {}, savedByStudent: {}, date: "d" })).toEqual([]);
  });
});

test("escapeHtml", () => {
  expect(escapeHtml('<b>"A&B"</b>')).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
  expect(escapeHtml(null)).toBe("");
});
