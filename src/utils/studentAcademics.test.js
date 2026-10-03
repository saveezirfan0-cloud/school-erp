import {
  monthLabel,
  formatDay,
  rowsForStudent,
  monthlyAttendance,
  recentAbsences,
  attendanceOverview,
  examsForStudent,
  examHistory,
  examSubjectRows,
  homeworkForStudent,
  homeworkSummary,
  attendanceToday,
  homeworkDueSoon,
} from "./studentAcademics";

const att = (studentId, date, status, grade = "Grade 5") => ({ studentId, date, status, grade });

describe("monthLabel / formatDay", () => {
  test("formats keys and dates", () => {
    expect(monthLabel("2026-03")).toBe("Mar 2026");
    expect(monthLabel("bad")).toBe("bad");
    expect(monthLabel(null)).toBe("");
    expect(formatDay("2026-03-05")).toBe("05 Mar 2026");
    expect(formatDay("")).toBe("—");
    expect(formatDay("2026-02-30")).toBe("—");
  });
});

describe("monthlyAttendance", () => {
  const rows = [
    att("s1", "2026-02-27", "present"),
    att("s1", "2026-03-02", "present"),
    att("s1", "2026-03-03", "late"),
    att("s1", "2026-03-04", "absent"),
    att("s1", "2026-03-05", "leave"),
    att("s1", "2026-03-06", "bogus"),
    att("s1", "not-a-date", "present"),
    att("s1", "2026-04-01", "leave"),
  ];

  test("buckets by month, oldest first, using the shared percentage rule", () => {
    const out = monthlyAttendance(rows);
    expect(out.map((m) => m.key)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(out[0]).toMatchObject({ label: "Feb 2026", present: 1, total: 1, percent: 100 });
    // present 1 + late 1 attended, absent 1, leave excluded -> 2/3
    expect(out[1]).toMatchObject({ present: 1, late: 1, absent: 1, leave: 1, total: 4, percent: 66.7 });
  });

  test("a month with only leave has a null percent, never 0", () => {
    const out = monthlyAttendance(rows);
    expect(out[2]).toMatchObject({ leave: 1, total: 1, percent: null });
  });

  test("empty / missing input", () => {
    expect(monthlyAttendance([])).toEqual([]);
    expect(monthlyAttendance(undefined)).toEqual([]);
  });
});

describe("recentAbsences / attendanceOverview / rowsForStudent", () => {
  const rows = [
    att("s1", "2026-03-02", "absent"),
    att("s1", "2026-03-09", "absent"),
    att("s1", "2026-03-05", "leave"),
    att("s1", "2026-03-06", "present"),
    att("s2", "2026-03-07", "absent"),
  ];

  test("newest absences first, leave excluded, limit respected", () => {
    const mine = rowsForStudent(rows, "s1");
    expect(mine).toHaveLength(4);
    expect(recentAbsences(mine).map((r) => r.date)).toEqual(["2026-03-09", "2026-03-02"]);
    expect(recentAbsences(mine, 1)).toHaveLength(1);
    expect(recentAbsences(mine, 0)).toEqual([]);
  });

  test("overview", () => {
    expect(attendanceOverview(rowsForStudent(rows, "s1"))).toMatchObject({ present: 1, absent: 2, leave: 1, total: 4, percent: 33.3 });
    expect(attendanceOverview([])).toMatchObject({ total: 0, percent: null });
  });
});

describe("exam history", () => {
  const s1 = { id: "s1", name: "Ann", grade: "Grade 5", branchId: "" };
  const s2 = { id: "s2", name: "Ben", grade: "Grade 5", branchId: "" };
  const s3 = { id: "s3", name: "Cat", grade: "Grade 6", branchId: "" };
  const students = [s1, s2, s3];
  const exams = [
    { id: "e1", name: "Mid", grade: "Grade 5", date: "2026-03-01", totalMarks: 100, published: true, branchId: "" },
    { id: "e2", name: "Final", grade: "Grade 5", date: "2026-06-01", totalMarks: 100, published: false, branchId: "" },
    { id: "e3", name: "Other", grade: "Grade 6", date: "2026-03-01", totalMarks: 100, published: true, branchId: "" },
    { id: "e4", name: "Branch", grade: "Grade 5", date: "2026-04-01", totalMarks: 100, published: true, branchId: "b1" },
  ];
  const r = (examId, studentId, subjectId, marksObtained, maxMarks = 50, extra = {}) => ({ examId, studentId, subjectId, marksObtained, maxMarks, absent: false, ...extra });
  const results = [
    r("e1", "s1", "m", 45), r("e1", "s1", "en", 40),   // 85/100
    r("e1", "s2", "m", 30), r("e1", "s2", "en", 50),   // 80/100
    r("e2", "s1", "m", 20), r("e2", "s1", "en", 20),   // 40/100 (unpublished)
    r("e3", "s3", "m", 50),
  ];

  test("only the student's class and branch, published only by default, newest first", () => {
    expect(examsForStudent(s1, exams).map((e) => e.id)).toEqual(["e1"]);
    expect(examsForStudent(s1, exams, { includeUnpublished: true }).map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  test("a student with a blank class has no exams", () => {
    expect(examsForStudent({ id: "x", grade: "  " }, exams, { includeUnpublished: true })).toEqual([]);
    expect(examsForStudent(null, exams)).toEqual([]);
  });

  test("totals, grade, rank and class size", () => {
    const h = examHistory({ student: s1, exams, results, students });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ percentage: 85, grade: "A", rank: 1, classSize: 2, pass: true, hasMarks: true });
    const hb = examHistory({ student: s2, exams, results, students });
    expect(hb[0]).toMatchObject({ percentage: 80, rank: 2 });
  });

  test("unpublished exams appear for editors", () => {
    const h = examHistory({ student: s1, exams, results, students, includeUnpublished: true });
    expect(h.map((x) => x.exam.id)).toEqual(["e2", "e1"]);
    expect(h[0]).toMatchObject({ percentage: 40, grade: "F", pass: false });
  });

  test("no marks -> null percentage, no rank, no pass; absent cells are excluded", () => {
    const none = examHistory({ student: s1, exams, results: [], students });
    expect(none[0]).toMatchObject({ percentage: null, grade: "", rank: null, pass: null, hasMarks: false, classSize: 0 });
    const absent = examHistory({
      student: s1, exams, students,
      results: [r("e1", "s1", "m", 40), r("e1", "s1", "en", null, 50, { absent: true })],
    });
    expect(absent[0]).toMatchObject({ percentage: 80 });
  });

  test("student missing from the roster still ranks", () => {
    const h = examHistory({ student: s1, exams, results, students: [s2] });
    expect(h[0]).toMatchObject({ rank: 1, classSize: 2 });
  });

  test("subject rows carry names and keep marks for subjects the user cannot list", () => {
    const subjects = [
      { id: "m", name: "Maths", grade: "Grade 5", branchId: "" },
      { id: "en", name: "English", grade: "", branchId: "" },
      { id: "sci", name: "Science", grade: "Grade 5", branchId: "" },
    ];
    const rows = examSubjectRows({ exam: exams[0], results, subjects, studentId: "s1" });
    expect(rows.map((x) => x.name)).toEqual(["English", "Maths"]);
    expect(rows.find((x) => x.name === "Maths")).toMatchObject({ obtained: 45, max: 50, percentage: 90, grade: "A+" });

    const noSubjects = examSubjectRows({ exam: exams[0], results, subjects: [], studentId: "s1" });
    expect(noSubjects).toHaveLength(2);
    expect(noSubjects.every((x) => x.name === "Subject")).toBe(true);
    expect(examSubjectRows({ exam: null, results, subjects, studentId: "s1" })).toEqual([]);
  });
});

describe("homework", () => {
  const today = "2026-03-10";
  const student = { id: "s1", grade: "Grade 5", branchId: "" };
  const assignments = [
    { id: "a1", title: "Essay", grade: "Grade 5", dueDate: "2026-03-05", branchId: "" },   // past
    { id: "a2", title: "Sums", grade: "Grade 5", dueDate: "2026-03-12", branchId: "" },    // upcoming
    { id: "a3", title: "All school", grade: "", dueDate: "2026-03-08", branchId: "" },     // all classes
    { id: "a4", title: "Other class", grade: "Grade 6", dueDate: "2026-03-08", branchId: "" },
    { id: "a5", title: "Other branch", grade: "Grade 5", dueDate: "2026-03-08", branchId: "b1" },
    { id: "a6", title: "No due date", grade: "Grade 5", dueDate: null, branchId: "" },
    { id: "a7", title: "Late one", grade: "Grade 5", dueDate: "2026-03-01", branchId: "" },
    { id: "a8", title: "Done", grade: "Grade 5", dueDate: "2026-03-02", branchId: "" },
  ];
  const submissions = [
    { assignmentId: "a7", studentId: "s1", status: "submitted", submittedDate: "2026-03-03" },
    { assignmentId: "a8", studentId: "s1", status: "graded", submittedDate: "2026-03-01" },
    { assignmentId: "a1", studentId: "s2", status: "graded" },
  ];

  const items = homeworkForStudent({ student, assignments, submissions, today });
  const byId = Object.fromEntries(items.map((i) => [i.assignment.id, i]));

  test("only assignments for the student's class and branch", () => {
    expect(items.map((i) => i.assignment.id).sort()).toEqual(["a1", "a2", "a3", "a6", "a7", "a8"]);
  });

  test("derived statuses and overdue flag", () => {
    expect(byId.a1).toMatchObject({ status: "missing", overdue: true });     // other student's submission ignored
    expect(byId.a2).toMatchObject({ status: "pending", overdue: false });
    expect(byId.a3).toMatchObject({ status: "missing", overdue: true });
    expect(byId.a6).toMatchObject({ status: "pending", overdue: false });
    expect(byId.a7).toMatchObject({ status: "late", overdue: false });       // handed in after due
    expect(byId.a8).toMatchObject({ status: "graded", overdue: false });
  });

  test("sorted by due date, newest first, undated last", () => {
    expect(items.map((i) => i.assignment.id)).toEqual(["a2", "a3", "a1", "a8", "a7", "a6"]);
  });

  test("summary", () => {
    expect(homeworkSummary(items)).toMatchObject({ total: 6, handedIn: 2, late: 1, graded: 1, missing: 2, pending: 2, percent: 33 });
    expect(homeworkSummary([])).toMatchObject({ total: 0, percent: 0 });
  });

  test("no student / no assignments", () => {
    expect(homeworkForStudent({ student: null, assignments, submissions, today })).toEqual([]);
    expect(homeworkForStudent({ student, assignments: [], submissions: [], today })).toEqual([]);
  });

  test("a student with a blank class only gets all-class homework", () => {
    const blank = { id: "s9", grade: "", branchId: "" };
    expect(homeworkForStudent({ student: blank, assignments, submissions, today }).map((i) => i.assignment.id)).toEqual(["a3"]);
  });
});

describe("dashboard helpers", () => {
  const today = "2026-03-10";
  const students = [
    { id: "s1", grade: "Grade 5" },
    { id: "s2", grade: "Grade 6" },
    { id: "s3", grade: "Grade 7" },
    { id: "s4", grade: "" },
  ];
  const rows = [
    att("s1", today, "present"),
    att("s2", today, "absent", "Grade 6"),
    att("s5", today, "late", "Grade 6"),
    att("s1", "2026-03-09", "present"),
    att("s1", today, "bogus"),
  ];

  test("attendanceToday counts today only and classes marked of total", () => {
    expect(attendanceToday(rows, students, today)).toMatchObject({
      present: 1, absent: 1, late: 1, leave: 0, marked: 3, classesMarked: 2, classesTotal: 3,
    });
  });

  test("without students, classes are not counted", () => {
    expect(attendanceToday(rows, undefined, today)).toMatchObject({ marked: 3, classesTotal: null });
  });

  test("nothing marked yet", () => {
    expect(attendanceToday([], students, today)).toMatchObject({ marked: 0, classesMarked: 0, classesTotal: 3 });
    expect(attendanceToday(undefined, undefined, today)).toMatchObject({ marked: 0 });
  });

  test("homeworkDueSoon window is inclusive of today and day 7", () => {
    const list = [
      { id: "1", title: "b", dueDate: "2026-03-17" },
      { id: "2", title: "a", dueDate: "2026-03-10" },
      { id: "3", title: "c", dueDate: "2026-03-18" },
      { id: "4", title: "d", dueDate: "2026-03-09" },
      { id: "5", title: "e", dueDate: "" },
      { id: "6", title: "f", dueDate: "2026-03-12" },
    ];
    expect(homeworkDueSoon(list, today).map((a) => a.id)).toEqual(["2", "6", "1"]);
    expect(homeworkDueSoon(undefined, today)).toEqual([]);
  });
});
