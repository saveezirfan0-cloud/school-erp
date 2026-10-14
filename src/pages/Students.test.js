/* eslint-disable testing-library/no-unnecessary-act */
// Students list: Reg No. always shows, Class No. only when one class is
// viewed (ordered by it), and a row's Transfer moves the student to another
// class with the next free class number and a transfer-history entry.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const mockStudents = [
  { id: "s1", name: "Ali", studentId: "R-101", grade: "Class 1", branchId: "", classNo: "2" },
  { id: "s2", name: "Bilal", studentId: "R-102", grade: "Class 1", branchId: "", classNo: "1" },
  { id: "s3", name: "Sara", studentId: "R-103", grade: "Class 2", branchId: "", classNo: "4" },
];
const mockUpdateDoc = jest.fn(async () => {});

jest.mock("../firebase", () => ({
  db: {},
  supabase: { from: () => ({ update: () => ({ in: async () => ({}) }) }) },
  collection: (_db, name) => ({ name }),
  doc: (_db, name, id) => ({ name, id }),
  onSnapshot: (ref, onNext) => {
    onNext({ docs: mockStudents.map(({ id, ...rest }) => ({ id, data: () => rest })) });
    return () => {};
  },
  updateDoc: (...args) => mockUpdateDoc(...args),
  addDoc: jest.fn(), deleteDoc: jest.fn(), updateDocs: jest.fn(), deleteDocs: jest.fn(),
  serverTimestamp: () => "TS",
}));
jest.mock("../context/BranchContext", () => ({
  useBranch: () => ({ activeBranch: "all", branches: [{ id: "b1", name: "North Campus" }] }),
}));
jest.mock("../context/UserContext", () => ({ useUser: () => ({ can: () => true }) }));
jest.mock("../utils/auditLog", () => ({ logActivity: () => {} }));

// eslint-disable-next-line import/first
import Students from "./Students";

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><Students /></MemoryRouter>); });
}
const headers = () => [...container.querySelectorAll("thead th")].map((th) => th.textContent).filter(Boolean);
const firstCells = () => [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[1].textContent);

beforeEach(() => { localStorage.clear(); mockUpdateDoc.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("all classes: only Reg No. is shown", async () => {
  await render();
  expect(headers().slice(0, 2)).toEqual(["Reg No.", "Name"]);
  expect(headers()).not.toContain("Class No.");
});

test("one class: Reg No. and Class No. are shown, ordered by Class No.", async () => {
  localStorage.setItem("students.filterGrades", JSON.stringify(["Class 1"]));
  await render();
  expect(headers().slice(0, 3)).toEqual(["Reg No.", "Class No.", "Name"]);
  expect(firstCells()).toEqual(["R-102", "R-101"]);
  const classNos = [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[2].textContent);
  expect(classNos).toEqual(["1", "2"]);
});

test("transfer moves a student with the next class number and records it", async () => {
  await render();
  const aliRow = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Ali"));
  await act(async () => { aliRow.querySelector('button[aria-label="Transfer"]').click(); });

  const gradeInput = document.getElementById("transferGrade");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setValue.call(gradeInput, "Class 2");
    gradeInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.getElementById("transferClassNo").value).toBe("5");

  const submit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Transfer");
  await act(async () => { submit.click(); });

  expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  const [ref, data] = mockUpdateDoc.mock.calls[0];
  expect(ref).toEqual({ name: "students", id: "s1" });
  expect(data).toMatchObject({ grade: "Class 2", branchId: "", classNo: "5" });
  expect(data.transferHistory).toEqual([expect.objectContaining({ fromGrade: "Class 1", toGrade: "Class 2", fromClassNo: "2", toClassNo: "5" })]);
});
