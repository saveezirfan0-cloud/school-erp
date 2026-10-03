/* eslint-disable no-script-url */
import {
  isValidDateStr, todayStr, isOverdue,
  normalizeBranch, sameBranch, deriveClasses, appliesToClass, subjectsForGrade,
  subjectLabel, isDuplicateSubject, rosterFor, paginate,
  normalizeStatus, deriveSubmissionStatus, suggestStatus, applyStatusChange, applyDateChange,
  validateMarks, blankDraft, draftFromSubmission, draftChanged, buildSubmissionRow,
  completionStats, assignmentState, buildAssignmentStats,
  validateUrl, sanitizeUrl, safeHref, safeFileName,
  validateAssignmentForm, validateMaterialForm,
} from "./learning";

const TODAY = "2026-10-03";

describe("dates", () => {
  test("isValidDateStr", () => {
    expect(isValidDateStr("2026-10-03")).toBe(true);
    expect(isValidDateStr("2024-02-29")).toBe(true);
    expect(isValidDateStr("2026-02-30")).toBe(false);
    expect(isValidDateStr("2026-1-3")).toBe(false);
    expect(isValidDateStr("")).toBe(false);
    expect(isValidDateStr(null)).toBe(false);
    expect(isValidDateStr(20261003)).toBe(false);
  });

  test("todayStr uses the local calendar day", () => {
    expect(todayStr(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayStr(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  test("isOverdue: due today is not overdue, no/invalid due date never is", () => {
    expect(isOverdue("2026-10-02", TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false);
    expect(isOverdue("2026-10-04", TODAY)).toBe(false);
    expect(isOverdue("", TODAY)).toBe(false);
    expect(isOverdue(undefined, TODAY)).toBe(false);
    expect(isOverdue("garbage", TODAY)).toBe(false);
  });
});

describe("branch and class helpers", () => {
  test("main office normalises to blank", () => {
    expect(normalizeBranch("main")).toBe("");
    expect(normalizeBranch(undefined)).toBe("");
    expect(normalizeBranch(null)).toBe("");
    expect(normalizeBranch(" b1 ")).toBe("b1");
    expect(sameBranch("", "main")).toBe(true);
    expect(sameBranch("b1", "")).toBe(false);
  });

  test("deriveClasses: distinct, trimmed, blank-free, natural order, multiple lists", () => {
    const students = [{ grade: "Grade 10" }, { grade: "Grade 2" }, { grade: " Grade 2 " }, { grade: "" }, {}];
    const subjects = [{ grade: "Grade 1" }, { grade: "Grade 10" }];
    expect(deriveClasses(students, subjects)).toEqual(["Grade 1", "Grade 2", "Grade 10"]);
    expect(deriveClasses([])).toEqual([]);
    expect(deriveClasses(undefined, null)).toEqual([]);
  });

  test("appliesToClass: blank row grade is all classes", () => {
    expect(appliesToClass("Grade 5", "")).toBe(true);
    expect(appliesToClass("", "Grade 5")).toBe(true);
    expect(appliesToClass("Grade 5", "Grade 5")).toBe(true);
    expect(appliesToClass(" Grade 5 ", "Grade 5")).toBe(true);
    expect(appliesToClass("Grade 4", "Grade 5")).toBe(false);
  });

  test("subjectsForGrade includes all-class subjects and respects branch", () => {
    const subjects = [
      { id: "1", name: "Maths", grade: "Grade 5", branchId: "" },
      { id: "2", name: "Art", grade: "", branchId: "" },
      { id: "3", name: "Science", grade: "Grade 6", branchId: "" },
      { id: "4", name: "Urdu", grade: "Grade 5", branchId: "b1" },
    ];
    expect(subjectsForGrade(subjects, "Grade 5").map((s) => s.id)).toEqual(["2", "1", "4"]);
    expect(subjectsForGrade(subjects, "Grade 5", "main").map((s) => s.id)).toEqual(["2", "1"]);
    expect(subjectsForGrade(subjects, "Grade 5", "b1").map((s) => s.id)).toEqual(["4"]);
    expect(subjectsForGrade(undefined, "Grade 5")).toEqual([]);
  });

  test("subjectLabel", () => {
    expect(subjectLabel({ name: "Maths", code: "MTH" })).toBe("Maths (MTH)");
    expect(subjectLabel({ name: "Maths" })).toBe("Maths");
    expect(subjectLabel(null)).toBe("");
  });

  test("isDuplicateSubject ignores case/space and the row being edited", () => {
    const subjects = [{ id: "1", name: "Maths", grade: "Grade 5", branchId: "" }];
    expect(isDuplicateSubject({ name: " maths ", grade: "grade 5", branchId: "main" }, subjects)).toBe(true);
    expect(isDuplicateSubject({ name: "Maths", grade: "Grade 5" }, subjects, "1")).toBe(false);
    expect(isDuplicateSubject({ name: "Maths", grade: "Grade 6" }, subjects)).toBe(false);
    expect(isDuplicateSubject({ name: "Maths", grade: "Grade 5", branchId: "b1" }, subjects)).toBe(false);
    expect(isDuplicateSubject({ name: "  ", grade: "" }, subjects)).toBe(false);
  });

  test("rosterFor filters by class and branch, sorted by name", () => {
    const students = [
      { id: "a", name: "Zed", grade: "Grade 5", branchId: "" },
      { id: "b", name: "Amy", grade: "Grade 5", branchId: "main" },
      { id: "c", name: "Bob", grade: "Grade 6", branchId: "" },
      { id: "d", name: "Cat", grade: "Grade 5", branchId: "b1" },
    ];
    expect(rosterFor(students, { grade: "Grade 5", branchId: "" }).map((s) => s.id)).toEqual(["b", "a"]);
    expect(rosterFor(students, { grade: "Grade 5", branchId: "b1" }).map((s) => s.id)).toEqual(["d"]);
    expect(rosterFor(students, { grade: "", branchId: "" }).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(rosterFor(students, { grade: "Grade 9", branchId: "" })).toEqual([]);
    expect(rosterFor([], { grade: "Grade 5" })).toEqual([]);
    expect(rosterFor(undefined, undefined)).toEqual([]);
  });

  test("paginate clamps the page and handles empty lists", () => {
    const list = [1, 2, 3, 4, 5];
    expect(paginate(list, 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 3, total: 5 });
    expect(paginate(list, 99, 2).items).toEqual([5]);
    expect(paginate(list, 0, 2).page).toBe(1);
    expect(paginate([], 1, 25)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});

describe("deriveSubmissionStatus", () => {
  test("no row: pending before/on due date, missing after, pending with no due date", () => {
    expect(deriveSubmissionStatus(undefined, "2026-10-10", TODAY)).toBe("pending");
    expect(deriveSubmissionStatus(null, TODAY, TODAY)).toBe("pending");
    expect(deriveSubmissionStatus(null, "2026-10-02", TODAY)).toBe("missing");
    expect(deriveSubmissionStatus(null, "", TODAY)).toBe("pending");
    expect(deriveSubmissionStatus(null, undefined, TODAY)).toBe("pending");
  });

  test("stored pending past due shows missing", () => {
    expect(deriveSubmissionStatus({ status: "pending" }, "2026-10-01", TODAY)).toBe("missing");
  });

  test("submitted after due date reads as late; on due date it is on time", () => {
    expect(deriveSubmissionStatus({ status: "submitted", submittedDate: "2026-10-02" }, "2026-10-01", TODAY)).toBe("late");
    expect(deriveSubmissionStatus({ status: "submitted", submittedDate: "2026-10-01" }, "2026-10-01", TODAY)).toBe("submitted");
    expect(deriveSubmissionStatus({ status: "submitted", submittedDate: "2026-09-30" }, "2026-10-01", TODAY)).toBe("submitted");
  });

  test("submitted with no due date or no submitted date stays submitted", () => {
    expect(deriveSubmissionStatus({ status: "submitted", submittedDate: "2026-10-02" }, "", TODAY)).toBe("submitted");
    expect(deriveSubmissionStatus({ status: "submitted" }, "2026-10-01", TODAY)).toBe("submitted");
  });

  test("teacher-set late/graded/missing are kept", () => {
    expect(deriveSubmissionStatus({ status: "late", submittedDate: "2026-09-01" }, "2026-10-01", TODAY)).toBe("late");
    expect(deriveSubmissionStatus({ status: "graded", submittedDate: "2026-10-09" }, "2026-10-01", TODAY)).toBe("graded");
    expect(deriveSubmissionStatus({ status: "missing" }, "2026-12-01", TODAY)).toBe("missing");
  });

  test("unknown stored status is treated as pending", () => {
    expect(normalizeStatus("weird")).toBe("pending");
    expect(normalizeStatus(" GRADED ")).toBe("graded");
    expect(deriveSubmissionStatus({ status: "weird" }, "2026-12-01", TODAY)).toBe("pending");
  });
});

describe("status editing", () => {
  test("suggestStatus", () => {
    expect(suggestStatus("submitted", "2026-10-05", "2026-10-04")).toBe("late");
    expect(suggestStatus("submitted", "2026-10-04", "2026-10-04")).toBe("submitted");
    expect(suggestStatus("late", "2026-10-03", "2026-10-04")).toBe("submitted");
    expect(suggestStatus("submitted", "", "2026-10-04")).toBe("submitted");
    expect(suggestStatus("submitted", "2026-10-05", "")).toBe("submitted");
    expect(suggestStatus("graded", "2026-10-05", "2026-10-04")).toBe("graded");
    expect(suggestStatus("pending", "2026-10-05", "2026-10-04")).toBe("pending");
  });

  test("applyStatusChange defaults the date and suggests late", () => {
    expect(applyStatusChange(blankDraft(), "submitted", "2026-10-10", TODAY))
      .toMatchObject({ status: "submitted", submittedDate: TODAY });
    expect(applyStatusChange(blankDraft(), "submitted", "2026-10-01", TODAY))
      .toMatchObject({ status: "late", submittedDate: TODAY });
    expect(applyStatusChange(blankDraft(), "submitted", "", TODAY))
      .toMatchObject({ status: "submitted", submittedDate: TODAY });
    // an existing date is kept
    expect(applyStatusChange({ ...blankDraft(), submittedDate: "2026-09-01" }, "submitted", "2026-10-01", TODAY).submittedDate)
      .toBe("2026-09-01");
    // going back to pending/missing clears the date
    expect(applyStatusChange({ ...blankDraft(), status: "submitted", submittedDate: TODAY }, "pending", "", TODAY))
      .toMatchObject({ status: "pending", submittedDate: "" });
    expect(applyStatusChange({ ...blankDraft(), submittedDate: TODAY }, "missing", "", TODAY).submittedDate).toBe("");
  });

  test("applyDateChange flips submitted<->late with the date", () => {
    const d = { ...blankDraft(), status: "submitted", submittedDate: "2026-10-01" };
    expect(applyDateChange(d, "2026-10-09", "2026-10-05").status).toBe("late");
    expect(applyDateChange({ ...d, status: "late" }, "2026-10-04", "2026-10-05").status).toBe("submitted");
    expect(applyDateChange(d, "", "2026-10-05")).toMatchObject({ status: "submitted", submittedDate: "" });
  });
});

describe("validateMarks", () => {
  test("blank is allowed and null", () => {
    expect(validateMarks("", 10)).toEqual({ ok: true, value: null });
    expect(validateMarks("   ", 10)).toEqual({ ok: true, value: null });
    expect(validateMarks(null, 10)).toEqual({ ok: true, value: null });
    expect(validateMarks(undefined, 10)).toEqual({ ok: true, value: null });
  });

  test("0 up to max inclusive", () => {
    expect(validateMarks("0", 10)).toEqual({ ok: true, value: 0 });
    expect(validateMarks("10", 10)).toEqual({ ok: true, value: 10 });
    expect(validateMarks(7.5, "10")).toEqual({ ok: true, value: 7.5 });
    expect(validateMarks(".5", 10)).toEqual({ ok: true, value: 0.5 });
  });

  test("rejects negatives, over max, junk", () => {
    expect(validateMarks("-1", 10).ok).toBe(false);
    expect(validateMarks("10.5", 10)).toMatchObject({ ok: false, error: "Cannot exceed 10" });
    expect(validateMarks("abc", 10).ok).toBe(false);
    expect(validateMarks("1e3", 10000).ok).toBe(false);
    expect(validateMarks("0x10", 100).ok).toBe(false);
    expect(validateMarks("NaN", 100).ok).toBe(false);
  });

  test("no usable max means no upper bound", () => {
    expect(validateMarks("500", "").ok).toBe(true);
    expect(validateMarks("500", null).ok).toBe(true);
    expect(validateMarks("500", 0).ok).toBe(true);
    expect(validateMarks("500", undefined).ok).toBe(true);
  });
});

describe("submission rows", () => {
  const student = { id: "s1", name: "Amy", branchId: "main" };

  test("buildSubmissionRow carries the student's branch (blank for main)", () => {
    const row = buildSubmissionRow({
      assignmentId: "a1", student,
      draft: { status: "graded", submittedDate: "2026-10-02", marks: "8", feedback: " good " },
      maxMarks: 10,
    });
    expect(row).toEqual({
      assignmentId: "a1", studentId: "s1", status: "graded",
      submittedDate: "2026-10-02", marks: 8, feedback: "good", branchId: "",
    });
    expect(buildSubmissionRow({ assignmentId: "a1", student: { id: "s2", branchId: "b1" } }).branchId).toBe("b1");
  });

  test("buildSubmissionRow tolerates a blank draft and bad values", () => {
    expect(buildSubmissionRow({ assignmentId: "a1", student, draft: undefined })).toEqual({
      assignmentId: "a1", studentId: "s1", status: "pending",
      submittedDate: "", marks: null, feedback: "", branchId: "",
    });
    expect(buildSubmissionRow({ assignmentId: "a1", student, draft: { status: "x", submittedDate: "nope", marks: "99" }, maxMarks: 10 }))
      .toMatchObject({ status: "pending", submittedDate: "", marks: null });
  });

  test("draftFromSubmission / draftChanged", () => {
    expect(draftFromSubmission(null)).toEqual(blankDraft());
    const sub = { status: "graded", submittedDate: "2026-10-01", marks: 9, feedback: "ok" };
    const d = draftFromSubmission(sub);
    expect(d).toEqual({ status: "graded", submittedDate: "2026-10-01", marks: "9", feedback: "ok" });
    expect(draftChanged(sub, d)).toBe(false);
    expect(draftChanged(sub, { ...d, marks: "10" })).toBe(true);
    expect(draftChanged(sub, { ...d, feedback: "ok " })).toBe(false);
    expect(draftChanged(sub, { ...d, marks: "9.0" })).toBe(false);
    expect(draftChanged(sub, { ...d, marks: "" })).toBe(true);
    expect(draftChanged(null, blankDraft())).toBe(false);
    expect(draftChanged(null, { ...blankDraft(), status: "submitted" })).toBe(true);
    expect(draftChanged(undefined, undefined)).toBe(false);
  });
});

describe("completionStats", () => {
  const roster = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];

  test("empty roster is all zeros, 0%, not complete", () => {
    expect(completionStats([], [{ studentId: "1", status: "graded" }], "2026-10-01", TODAY)).toEqual({
      total: 0, pending: 0, submitted: 0, late: 0, graded: 0, missing: 0,
      handedIn: 0, percent: 0, complete: false,
    });
    expect(completionStats(undefined, undefined, "", TODAY).total).toBe(0);
  });

  test("counts display statuses; ignores rows for students not on the roster", () => {
    const subs = [
      { studentId: "1", status: "graded", submittedDate: "2026-09-30" },
      { studentId: "2", status: "submitted", submittedDate: "2026-10-02" }, // after due -> late
      { studentId: "99", status: "graded" }, // not on roster
    ];
    const s = completionStats(roster, subs, "2026-10-01", TODAY);
    expect(s).toMatchObject({ total: 4, graded: 1, late: 1, missing: 2, pending: 0, handedIn: 2, percent: 50, complete: false });
  });

  test("due today and no due date keep unsubmitted students pending", () => {
    expect(completionStats(roster, [], TODAY, TODAY)).toMatchObject({ pending: 4, missing: 0 });
    expect(completionStats(roster, [], "", TODAY)).toMatchObject({ pending: 4, missing: 0 });
  });

  test("everyone handed in is complete", () => {
    const subs = roster.map((r) => ({ studentId: r.id, status: "submitted", submittedDate: "2026-09-30" }));
    expect(completionStats(roster, subs, "2026-10-01", TODAY)).toMatchObject({ handedIn: 4, percent: 100, complete: true });
  });

  test("duplicate rows: the last one wins", () => {
    const subs = [{ studentId: "1", status: "pending" }, { studentId: "1", status: "graded" }];
    expect(completionStats([{ id: "1" }], subs, "", TODAY).graded).toBe(1);
  });

  test("numeric ids match string ids", () => {
    expect(completionStats([{ id: 1 }], [{ studentId: "1", status: "graded" }], "", TODAY).graded).toBe(1);
  });

  test("percent rounds", () => {
    const r = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(completionStats(r, [{ studentId: "1", status: "graded" }], "", TODAY).percent).toBe(33);
  });
});

describe("assignmentState / buildAssignmentStats", () => {
  const done = { total: 2, complete: true };
  const open = { total: 2, complete: false };

  test("assignmentState", () => {
    expect(assignmentState({ dueDate: "2026-10-01" }, done, TODAY)).toBe("complete");
    expect(assignmentState({ dueDate: "2026-10-01" }, open, TODAY)).toBe("overdue");
    expect(assignmentState({ dueDate: TODAY }, open, TODAY)).toBe("open");
    expect(assignmentState({ dueDate: "" }, open, TODAY)).toBe("open");
    // overdue with an empty roster is not flagged
    expect(assignmentState({ dueDate: "2026-10-01" }, { total: 0, complete: false }, TODAY)).toBe("open");
    expect(assignmentState({ dueDate: "2026-10-01" }, undefined, TODAY)).toBe("open");
  });

  test("buildAssignmentStats maps each assignment to its own roster", () => {
    const students = [
      { id: "s1", grade: "Grade 5", branchId: "" },
      { id: "s2", grade: "Grade 5", branchId: "" },
      { id: "s3", grade: "Grade 6", branchId: "" },
    ];
    const assignments = [
      { id: "a1", grade: "Grade 5", branchId: "", dueDate: "2026-10-01" },
      { id: "a2", grade: "Grade 6", branchId: "", dueDate: "2026-10-20" },
      { id: "a3", grade: "Grade 9", branchId: "", dueDate: "" },
    ];
    const subs = [
      { assignmentId: "a1", studentId: "s1", status: "graded" },
      { assignmentId: "a2", studentId: "s1", status: "graded" }, // s1 not in Grade 6
    ];
    const m = buildAssignmentStats(assignments, students, subs, TODAY);
    expect(m.get("a1")).toMatchObject({ total: 2, graded: 1, missing: 1, percent: 50 });
    expect(m.get("a2")).toMatchObject({ total: 1, pending: 1, handedIn: 0 });
    expect(m.get("a3")).toMatchObject({ total: 0, percent: 0, complete: false });
    expect(buildAssignmentStats(undefined, undefined, undefined, TODAY).size).toBe(0);
  });
});

describe("validateUrl", () => {
  test("accepts http and https and normalises", () => {
    expect(validateUrl("https://example.com/a?b=1")).toEqual({ ok: true, url: "https://example.com/a?b=1", error: null });
    expect(validateUrl("  http://example.com  ").url).toBe("http://example.com/");
    expect(validateUrl("HTTPS://Example.com/x").url).toBe("https://example.com/x");
    expect(validateUrl("http://localhost:3000/x").ok).toBe(true);
  });

  test("bare domains get https://", () => {
    expect(validateUrl("example.com/notes.pdf").url).toBe("https://example.com/notes.pdf");
    expect(validateUrl("//cdn.example.com/a").url).toBe("https://cdn.example.com/a");
  });

  test("rejects javascript: in every spelling", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "javascript://example.com/%0Aalert(1)",
      "jav&#x61;script:alert(1)",
      "\u0000javascript:alert(1)",
    ]) {
      expect(validateUrl(bad).ok).toBe(false);
      expect(sanitizeUrl(bad)).toBe("");
      expect(safeHref(bad)).toBe("");
    }
  });

  test("rejects other schemes, junk, credentials, blanks", () => {
    for (const bad of [
      "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd",
      "ftp://example.com/a", "mailto:a@b.com", "https://", "http://nodot", "not a url",
      "https://user:pass@example.com", "https://exa mple.com",
    ]) {
      expect(validateUrl(bad).ok).toBe(false);
    }
    expect(validateUrl("")).toMatchObject({ ok: false, url: "" });
    expect(validateUrl(null).ok).toBe(false);
    expect(validateUrl(undefined).ok).toBe(false);
  });

  test("required:false allows blank but still rejects bad links", () => {
    expect(validateUrl("", { required: false })).toEqual({ ok: true, url: "", error: null });
    expect(validateUrl("   ", { required: false }).ok).toBe(true);
    expect(validateUrl("javascript:alert(1)", { required: false }).ok).toBe(false);
  });

  test("safeHref is strict: needs a scheme already", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("example.com/a")).toBe("");
    expect(safeHref("")).toBe("");
    expect(safeHref(undefined)).toBe("");
  });

  test("safeFileName", () => {
    expect(safeFileName("My Notes (final).pdf")).toBe("My_Notes_final_.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\x\\y z.docx")).toBe("y_z.docx");
    expect(safeFileName("")).toBe("file");
    expect(safeFileName(undefined)).toBe("file");
    expect(safeFileName("...")).toBe("file");
  });
});

describe("form validation", () => {
  const good = {
    title: "Ch 3 questions", grade: "Grade 5", assignedDate: "2026-10-01",
    dueDate: "2026-10-05", maxMarks: "20", attachmentUrl: "",
  };

  test("valid assignment", () => {
    const r = validateAssignmentForm(good);
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ maxMarks: 20, attachmentUrl: "" });
  });

  test("optional fields may be blank", () => {
    const r = validateAssignmentForm({ ...good, dueDate: "", maxMarks: "" });
    expect(r.ok).toBe(true);
    expect(r.values.maxMarks).toBeNull();
  });

  test("due date on the assigned date is fine, before it is not", () => {
    expect(validateAssignmentForm({ ...good, dueDate: "2026-10-01" }).ok).toBe(true);
    expect(validateAssignmentForm({ ...good, dueDate: "2026-09-30" }).errors.dueDate).toBeTruthy();
  });

  test("assignment errors", () => {
    const r = validateAssignmentForm({ title: " ", grade: "", maxMarks: "0", attachmentUrl: "javascript:alert(1)", dueDate: "2026-02-31" });
    expect(Object.keys(r.errors).sort()).toEqual(["attachmentUrl", "dueDate", "grade", "maxMarks", "title"]);
    expect(validateAssignmentForm({ ...good, maxMarks: "-5" }).errors.maxMarks).toBeTruthy();
    expect(validateAssignmentForm({ ...good, maxMarks: "abc" }).errors.maxMarks).toBeTruthy();
    expect(validateAssignmentForm(undefined).ok).toBe(false);
  });

  test("attachment link is normalised", () => {
    expect(validateAssignmentForm({ ...good, attachmentUrl: "example.com/w.pdf" }).values.attachmentUrl)
      .toBe("https://example.com/w.pdf");
  });

  test("materials: links need a URL, notes do not", () => {
    expect(validateMaterialForm({ title: "Intro", kind: "link", url: "https://example.com" }).ok).toBe(true);
    expect(validateMaterialForm({ title: "Intro", kind: "link", url: "" }).errors.url).toBeTruthy();
    expect(validateMaterialForm({ title: "Intro", kind: "video", url: "" }).ok).toBe(false);
    expect(validateMaterialForm({ title: "Intro", kind: "file", url: "" }).ok).toBe(false);
    expect(validateMaterialForm({ title: "Rules", kind: "note", url: "" })).toMatchObject({ ok: true, values: { kind: "note", url: "" } });
    expect(validateMaterialForm({ title: "Rules", kind: "note", url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateMaterialForm({ title: "", kind: "bogus", url: "https://example.com" }).errors).toEqual({
      title: expect.any(String), kind: expect.any(String),
    });
  });
});
