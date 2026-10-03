import {
  DEFAULT_GRADING_SCALE,
  DEFAULT_PASS_MARK,
  roundTo,
  toNumber,
  gradeFor,
  remarkFor,
  isPass,
  percentOf,
  cellState,
  validateMarks,
  studentTotals,
  subjectBreakdown,
  rankStudents,
  classResults,
  classStats,
  trendFor,
  sameClass,
  studentsForExam,
  subjectsForExam,
  effectiveMax,
} from "./grading";

const r = (studentId, subjectId, marksObtained, maxMarks = 100, extra = {}) => ({
  examId: "e1", studentId, subjectId, marksObtained, maxMarks, absent: false, ...extra,
});

describe("scale constants", () => {
  test("scale is ordered high to low and ends at 0", () => {
    const mins = DEFAULT_GRADING_SCALE.map((s) => s.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
    expect(mins[mins.length - 1]).toBe(0);
    expect(DEFAULT_PASS_MARK).toBe(50);
  });
});

describe("helpers", () => {
  test("roundTo avoids float noise", () => {
    expect(roundTo(0.1 + 0.2)).toBe(0.3);
    expect(roundTo(1.005)).toBe(1.01);
    expect(roundTo(66.666666)).toBe(66.67);
  });
  test("toNumber", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber("  ")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(0)).toBe(0);
  });
});

describe("gradeFor", () => {
  test.each([
    [100, "A+"], [90, "A+"], [89.99, "A"], [80, "A"], [79.99, "B"], [70, "B"],
    [69.99, "C"], [60, "C"], [59.99, "D"], [50, "D"], [49.99, "F"], [0, "F"],
  ])("%s -> %s", (p, g) => expect(gradeFor(p)).toBe(g));

  test("missing percentage gives blank grade", () => {
    expect(gradeFor(null)).toBe("");
    expect(gradeFor(undefined)).toBe("");
    expect(gradeFor("")).toBe("");
    expect(gradeFor(NaN)).toBe("");
  });
  test("negative falls to lowest grade", () => {
    expect(gradeFor(-5)).toBe("F");
  });
  test("custom scale", () => {
    const scale = [{ min: 50, grade: "Pass" }, { min: 0, grade: "Fail" }];
    expect(gradeFor(50, scale)).toBe("Pass");
    expect(gradeFor(10, scale)).toBe("Fail");
    expect(remarkFor(10, scale)).toBe("");
  });
  test("remark", () => {
    expect(remarkFor(95)).toBe("Outstanding");
    expect(remarkFor(null)).toBe("");
  });
});

describe("isPass", () => {
  test("boundary", () => {
    expect(isPass(50)).toBe(true);
    expect(isPass(49.99)).toBe(false);
    expect(isPass(40, 40)).toBe(true);
    expect(isPass(null)).toBe(false);
  });
});

describe("percentOf", () => {
  test("basic and rounding", () => {
    expect(percentOf(50, 100)).toBe(50);
    expect(percentOf(2, 3)).toBe(66.67);
    expect(percentOf("45", "60")).toBe(75);
  });
  test("zero / missing max is null, zero marks is 0", () => {
    expect(percentOf(10, 0)).toBeNull();
    expect(percentOf(10, null)).toBeNull();
    expect(percentOf(10, -5)).toBeNull();
    expect(percentOf(null, 100)).toBeNull();
    expect(percentOf(0, 100)).toBe(0);
  });
});

describe("cellState", () => {
  test("states", () => {
    expect(cellState(r("s", "a", 50))).toBe("marked");
    expect(cellState(r("s", "a", 0))).toBe("marked");
    expect(cellState(r("s", "a", null))).toBe("blank");
    expect(cellState(r("s", "a", ""))).toBe("blank");
    expect(cellState(r("s", "a", 50, 0))).toBe("blank");
    expect(cellState(r("s", "a", 50, null))).toBe("blank");
    expect(cellState(r("s", "a", 50, null), 100)).toBe("marked");
    expect(cellState(r("s", "a", 50, 100, { absent: true }))).toBe("absent");
    expect(cellState(undefined)).toBe("blank");
  });
});

describe("validateMarks", () => {
  test("accepts empty, zero, max and decimals", () => {
    expect(validateMarks("", 100)).toEqual({ ok: true, value: null, error: "" });
    expect(validateMarks(null, 100).ok).toBe(true);
    expect(validateMarks("0", 100)).toMatchObject({ ok: true, value: 0 });
    expect(validateMarks("100", 100)).toMatchObject({ ok: true, value: 100 });
    expect(validateMarks("45.5", 100)).toMatchObject({ ok: true, value: 45.5 });
  });
  test("rejects negatives, over max and junk", () => {
    expect(validateMarks("-1", 100).ok).toBe(false);
    expect(validateMarks("100.5", 100).ok).toBe(false);
    expect(validateMarks("abc", 100).ok).toBe(false);
  });
  test("no max means no upper bound", () => {
    expect(validateMarks("500", null).ok).toBe(true);
  });
});

describe("studentTotals", () => {
  test("sums marked cells", () => {
    const t = studentTotals([r("s", "a", 80), r("s", "b", 60)]);
    expect(t).toMatchObject({ obtained: 140, max: 200, percentage: 70, grade: "B", marked: 2, absent: 0, blank: 0, complete: true });
  });
  test("absent and blank cells are excluded from obtained AND max", () => {
    const t = studentTotals([
      r("s", "a", 90),
      r("s", "b", null),
      r("s", "c", 30, 100, { absent: true }), // marks ignored when absent
    ]);
    expect(t).toMatchObject({ obtained: 90, max: 100, percentage: 90, grade: "A+", marked: 1, absent: 1, blank: 1, complete: false });
  });
  test("zero marks counts (is not blank)", () => {
    const t = studentTotals([r("s", "a", 0), r("s", "b", 100)]);
    expect(t).toMatchObject({ obtained: 100, max: 200, percentage: 50, marked: 2 });
  });
  test("nothing marked -> null percentage and blank grade", () => {
    const t = studentTotals([r("s", "a", null), r("s", "b", 5, 100, { absent: true })]);
    expect(t.percentage).toBeNull();
    expect(t.grade).toBe("");
    expect(t.obtained).toBe(0);
    expect(t.max).toBe(0);
    expect(t.complete).toBe(false);
  });
  test("empty / undefined input", () => {
    expect(studentTotals([]).percentage).toBeNull();
    expect(studentTotals(undefined).marked).toBe(0);
  });
  test("zero max rows are skipped, not divided by", () => {
    const t = studentTotals([r("s", "a", 10, 0), r("s", "b", 40, 50)]);
    expect(t).toMatchObject({ obtained: 40, max: 50, percentage: 80, blank: 1 });
  });
  test("only zero-max rows -> no percentage (no NaN/Infinity)", () => {
    const t = studentTotals([r("s", "a", 10, 0)]);
    expect(t.percentage).toBeNull();
  });
  test("different max per row", () => {
    const t = studentTotals([r("s", "a", 18, 20), r("s", "b", 45, 50)]);
    expect(t).toMatchObject({ obtained: 63, max: 70, percentage: 90 });
  });
  test("string marks from the database are accepted", () => {
    const t = studentTotals([r("s", "a", "45", "50")]);
    expect(t.percentage).toBe(90);
  });
  test("rounding of totals and percentage", () => {
    const t = studentTotals([r("s", "a", 0.1, 1), r("s", "b", 0.2, 1), r("s", "c", 1, 3)]);
    expect(t.obtained).toBe(1.3);
    expect(t.max).toBe(5);
    expect(t.percentage).toBe(26);
    const t2 = studentTotals([r("s", "a", 2, 3)]);
    expect(t2.percentage).toBe(66.67);
  });
  test("subjectIds whitelist", () => {
    const t = studentTotals([r("s", "a", 80), r("s", "b", 20)], { subjectIds: ["a"] });
    expect(t).toMatchObject({ obtained: 80, max: 100 });
  });
  test("defaultMax used when row has none", () => {
    const t = studentTotals([r("s", "a", 40, null)], { defaultMax: 50 });
    expect(t.percentage).toBe(80);
  });
  test("grade boundaries use the rounded percentage", () => {
    // 89.995 -> rounds to 90 -> A+
    const t = studentTotals([r("s", "a", 89.995, 100)]);
    expect(t.percentage).toBe(90);
    expect(t.grade).toBe("A+");
  });
});

describe("subjectBreakdown", () => {
  test("follows subject order and reports state", () => {
    const rows = [
      r("s", "math", 45, 50, { remarks: "Good" }),
      r("s", "sci", null),
      r("s", "eng", 0, 50, { absent: true }),
    ];
    const b = subjectBreakdown(rows, ["eng", "math", "sci", "art"]);
    expect(b.map((x) => x.state)).toEqual(["absent", "marked", "blank", "blank"]);
    expect(b[1]).toMatchObject({ obtained: 45, max: 50, percentage: 90, grade: "A+", remarks: "Good" });
    expect(b[2].percentage).toBeNull();
  });
  test("sums several exams for the same subject (term report)", () => {
    const rows = [r("s", "math", 30, 50), { ...r("s", "math", 40, 50), examId: "e2" }];
    const b = subjectBreakdown(rows, ["math"]);
    expect(b[0]).toMatchObject({ obtained: 70, max: 100, percentage: 70, state: "marked" });
  });
  test("absent in one exam but marked in another is marked", () => {
    const rows = [r("s", "math", 0, 50, { absent: true }), { ...r("s", "math", 40, 50), examId: "e2" }];
    const b = subjectBreakdown(rows, ["math"]);
    expect(b[0]).toMatchObject({ obtained: 40, max: 50, state: "marked" });
  });
});

describe("rankStudents", () => {
  const items = (vals) => vals.map((v, i) => ({ id: "s" + i, percentage: v }));

  test("distinct values", () => {
    expect(rankStudents(items([70, 90, 80]))).toEqual({ s0: 3, s1: 1, s2: 2 });
  });
  test("ties share a rank and the next rank is skipped", () => {
    expect(rankStudents(items([90, 80, 80, 70]))).toEqual({ s0: 1, s1: 2, s2: 2, s3: 4 });
  });
  test("tie at the top", () => {
    expect(rankStudents(items([85, 85, 85, 60]))).toEqual({ s0: 1, s1: 1, s2: 1, s3: 4 });
  });
  test("null values are unranked and do not consume ranks", () => {
    expect(rankStudents(items([null, 50, 60]))).toEqual({ s0: null, s1: 2, s2: 1 });
  });
  test("zero is a valid, lowest, ranked score", () => {
    expect(rankStudents(items([0, 10]))).toEqual({ s0: 2, s1: 1 });
  });
  test("values equal after rounding tie", () => {
    expect(rankStudents(items([66.666, 66.667]))).toEqual({ s0: 1, s1: 1 });
  });
  test("custom accessors", () => {
    const rows = [{ k: "a", total: 5 }, { k: "b", total: 9 }];
    expect(rankStudents(rows, (x) => x.total, (x) => x.k)).toEqual({ a: 2, b: 1 });
  });
  test("empty", () => {
    expect(rankStudents([])).toEqual({});
    expect(rankStudents(undefined)).toEqual({});
  });
});

describe("classResults + classStats", () => {
  const students = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
  const results = [
    r("s1", "a", 90), r("s1", "b", 90),
    r("s2", "a", 40), r("s2", "b", 40),
    r("s3", "a", 40), r("s3", "b", 40),
    // s4 has nothing entered
    r("s4", "a", null),
  ];
  const rows = classResults(students, results, {});

  test("totals, ranks and pass flags per student", () => {
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 2, null]);
    expect(rows.map((x) => x.pass)).toEqual([true, false, false, null]);
    expect(rows[0].totals.percentage).toBe(90);
  });
  test("results of students not in the list are ignored", () => {
    const rows2 = classResults([{ id: "s1" }], results, {});
    expect(rows2).toHaveLength(1);
    expect(rows2[0].rank).toBe(1);
  });
  test("stats ignore students without marks", () => {
    const s = classStats(rows);
    expect(s.count).toBe(3);
    expect(s.average).toBe(56.67);
    expect(s.highest).toBe(90);
    expect(s.lowest).toBe(40);
    expect(s.passCount).toBe(1);
    expect(s.failCount).toBe(2);
    expect(s.passPercent).toBe(33.33);
    expect(s.gradeCounts["A+"]).toBe(1);
    expect(s.gradeCounts.F).toBe(2);
  });
  test("custom pass mark", () => {
    expect(classStats(rows, 40).passPercent).toBe(100);
  });
  test("empty class", () => {
    const s = classStats([]);
    expect(s).toMatchObject({ count: 0, average: null, highest: null, lowest: null, passPercent: null });
  });
  test("accepts plain {percentage} entries", () => {
    expect(classStats([{ percentage: 60 }, { percentage: null }]).count).toBe(1);
  });
});

describe("trendFor", () => {
  const exams = [
    { id: "e2", name: "Mid", date: "2026-03-01", totalMarks: 100 },
    { id: "e1", name: "Test 1", date: "2026-01-15", totalMarks: 50 },
    { id: "e3", name: "Final", date: "2026-06-01", totalMarks: 100 },
  ];
  const results = [
    { examId: "e1", studentId: "s1", subjectId: "a", marksObtained: 40, maxMarks: 50 },
    { examId: "e2", studentId: "s1", subjectId: "a", marksObtained: 60, maxMarks: 100 },
    { examId: "e2", studentId: "s2", subjectId: "a", marksObtained: 99, maxMarks: 100 },
  ];
  test("chronological, skips exams without marks, only that student", () => {
    const t = trendFor(exams, results, "s1");
    expect(t.map((x) => x.exam.id)).toEqual(["e1", "e2"]);
    expect(t.map((x) => x.percentage)).toEqual([80, 60]);
  });
  test("student with no results", () => {
    expect(trendFor(exams, results, "nobody")).toEqual([]);
  });
});

describe("class / subject / branch matching", () => {
  const exam = { id: "e1", grade: "Grade 5", branchId: "" };
  const students = [
    { id: "1", name: "Zed", grade: "Grade 5", branchId: "" },
    { id: "2", name: "Amy", grade: " grade 5 ", branchId: "main" },
    { id: "3", name: "Bob", grade: "Grade 5", branchId: "b1" },
    { id: "4", name: "Cat", grade: "Grade 6", branchId: "" },
  ];
  test("sameClass ignores case and whitespace", () => {
    expect(sameClass(" Grade 5", "grade 5 ")).toBe(true);
    expect(sameClass("Grade 5", "Grade 6")).toBe(false);
    expect(sameClass(null, "")).toBe(true);
  });
  test("studentsForExam filters by class and branch and sorts by name", () => {
    expect(studentsForExam(students, exam).map((s) => s.name)).toEqual(["Amy", "Zed"]);
    expect(studentsForExam(students, { ...exam, branchId: "b1" }).map((s) => s.name)).toEqual(["Bob"]);
    expect(studentsForExam(students, null)).toEqual([]);
  });
  test("subjectsForExam includes blank-grade subjects and respects branch", () => {
    const subjects = [
      { id: "a", name: "Maths", grade: "Grade 5", branchId: "" },
      { id: "b", name: "Arabic", grade: "", branchId: "" },
      { id: "c", name: "Art", grade: "Grade 6", branchId: "" },
      { id: "d", name: "Quran", grade: "Grade 5", branchId: "b1" },
      { id: "e", name: "Drawing", grade: null, branchId: "b1" },
    ];
    expect(subjectsForExam(subjects, exam).map((s) => s.name)).toEqual(["Arabic", "Maths"]);
    expect(subjectsForExam(subjects, { ...exam, branchId: "b1" }).map((s) => s.name)).toEqual(["Arabic", "Drawing", "Maths", "Quran"]);
    expect(subjectsForExam([], exam)).toEqual([]);
  });
  test("effectiveMax falls back to the exam total then 100", () => {
    expect(effectiveMax({ maxMarks: 20 }, { totalMarks: 50 })).toBe(20);
    expect(effectiveMax({}, { totalMarks: 50 })).toBe(50);
    expect(effectiveMax(null, {})).toBe(100);
  });
});
