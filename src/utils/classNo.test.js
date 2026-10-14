import { nextClassNo, classNoHolder, planTransfer, planNumbering } from "./classNo";

const students = [
  { id: "a", name: "Ali", grade: "Class 1", branchId: "", classNo: "1" },
  { id: "b", name: "Bilal", grade: "Class 1", branchId: "", classNo: "3" },
  { id: "c", name: "Sara", grade: "Class 1", branchId: "north", classNo: "7" },
  { id: "d", name: "Zain", grade: "Class 2", branchId: "", classNo: "2" },
  { id: "e", name: "Hina", grade: "Class 2", branchId: "" },
];

describe("nextClassNo", () => {
  test("is one past the highest number in that grade and branch", () => {
    expect(nextClassNo(students, "Class 1", "")).toBe("4");
    expect(nextClassNo(students, "Class 1", "north")).toBe("8");
    expect(nextClassNo(students, "Class 9", "")).toBe("1");
  });

  test("ignores excluded students and needs a grade", () => {
    expect(nextClassNo(students, "Class 1", "", { excludeIds: ["b"] })).toBe("2");
    expect(nextClassNo(students, "", "")).toBe("");
  });
});

describe("classNoHolder", () => {
  test("finds another student with the same number in the class", () => {
    expect(classNoHolder(students, "Class 1", "", "3")?.id).toBe("b");
    expect(classNoHolder(students, "Class 1", "", "3", "b")).toBeNull();
    expect(classNoHolder(students, "Class 1", "north", "3")).toBeNull();
    expect(classNoHolder(students, "Class 1", "", "")).toBeNull();
  });
});

describe("planTransfer", () => {
  test("moves students in class-number order and numbers them after the target class", () => {
    const plan = planTransfer(students, [students[1], students[0]], "Class 2", undefined);
    expect(plan.map((p) => [p.student.id, p.classNo])).toEqual([["a", "3"], ["b", "4"]]);
    expect(plan.every((p) => p.branchId === "")).toBe(true);
  });

  test("keeps the number of a student already in the target class", () => {
    const plan = planTransfer(students, [students[3], students[0]], "Class 2", "");
    expect(plan.find((p) => p.student.id === "d")).toMatchObject({ classNo: "2", unchanged: true });
    expect(plan.find((p) => p.student.id === "a")).toMatchObject({ classNo: "1", unchanged: false });
  });

  test("a branch change numbers students in the new branch's class", () => {
    const plan = planTransfer(students, [students[0]], "Class 1", "north");
    expect(plan[0]).toMatchObject({ branchId: "north", classNo: "8", unchanged: false });
  });
});

describe("planNumbering", () => {
  test("numbers unnumbered students by name after the class's highest number", () => {
    const list = [...students, { id: "f", name: "Adeel", grade: "Class 2", branchId: "" }];
    const plan = planNumbering(list, list.filter((s) => s.grade === "Class 2"));
    expect(plan.map((p) => [p.student.id, p.classNo])).toEqual([["f", "3"], ["e", "4"]]);
  });
});
