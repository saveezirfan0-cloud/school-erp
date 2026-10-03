// Smoke test: mount the Reports page with fake data, click through every
// tab and change the main filters. Catches render-time crashes the pure
// reportData tests can't.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const month = TODAY.toLocaleString("en-US", { month: "long" });

const mockTables = {
  invoices: [
    { id: "i1", studentId: "s1", studentName: "Ali", branchId: "b1", amount: 1000, paidAmount: 1000, status: "paid", month, year: TODAY.getFullYear(), paidDate: iso(TODAY), dueDate: iso(TODAY), paidAccount: "Cash", lineItems: [{ description: "Tuition Fee", amount: 1000 }] },
    { id: "i2", studentId: "s2", studentName: "Sara", branchId: "", amount: 500, paidAmount: 0, status: "pending", month, year: TODAY.getFullYear(), dueDate: "2020-01-01" },
  ],
  expenses: [{ id: "e1", category: "Utilities", amount: 200, date: iso(TODAY), branchId: "b1" }],
  payslips: [{ id: "p1", role: "Teacher", netPay: 300, month, year: TODAY.getFullYear(), status: "pending", branchId: "b1" }],
  payments: [{ id: "x1", type: "cash_in", account: "Cash", amount: 1000, category: "Fee Collection", date: iso(TODAY), branchId: "b1" }],
  students: [{ id: "s1", name: "Ali", studentId: "Z1", grade: "Grade 5", branchId: "b1" }, { id: "s2", name: "Sara", studentId: "Z2", grade: "Grade 6" }],
  journals: [],
  subjects: [{ id: "sub1", name: "Maths", grade: "Grade 6", teacher: "Ms Noor", branchId: "" }],
  accounts: [{ id: "a1", code: "1000", name: "Cash", type: "Assets", subType: "Bank & Cash", balance: 100 }, { id: "a2", code: "2000", name: "Loan", type: "Liabilities", balance: 50 }],
};

const mockWrites = { add: jest.fn(async () => ({ id: "new" })), update: jest.fn(async () => {}), remove: jest.fn(async () => {}) };

jest.mock("../firebase", () => ({
  db: {},
  collection: (_db, name) => ({ name }),
  doc: (_db, name, id) => ({ name, id }),
  addDoc: (...a) => mockWrites.add(...a),
  updateDoc: (...a) => mockWrites.update(...a),
  deleteDoc: (...a) => mockWrites.remove(...a),
  // a table that isn't in mockTables behaves like a table that doesn't exist yet
  getAllDocs: async (ref) => ({ docs: mockTables[ref.name].map(({ id, ...rest }) => ({ id, data: () => rest })) }),
}));
jest.mock("../context/BranchContext", () => {
  const branches = [{ id: "b1", name: "North Campus" }];
  return { useBranch: () => ({ activeBranch: "all", branches }) };
});
jest.mock("../context/UserContext", () => ({
  useUser: () => ({
    hajiPrefs: { presets: undefined, legacyLayout: null, active: null }, saveHajiPrefs: async () => {},
    can: () => true, isAdmin: true, userProfile: { name: "Test" },
  }),
}));
jest.mock("../hooks/useReportDocs", () => ({
  useReportDocs: () => ({ docs: [], available: false, loading: false, reload: async () => {} }),
}));
jest.mock("../lib/reportDocs", () => ({ saveReportDoc: async () => {}, deleteReportDoc: async () => {} }));
jest.mock("recharts", () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return new Proxy({}, { get: () => Stub });
});

import Reports from "./Reports";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Reports /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); });
  return { el, root };
}
const click = async (el, text) => {
  const btn = [...el.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(text));
  expect(btn).toBeTruthy();
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const clickRow = async (el, text) => {
  const row = [...el.querySelectorAll("tbody tr")].find(r => r.textContent.includes(text));
  expect(row).toBeTruthy();
  await act(async () => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const choose = async (select, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  await act(async () => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
};
const type = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const selectByLabel = (el, label) => [...el.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(label)).querySelector("select");

beforeEach(() => {
  delete mockTables.budgets;
  Object.values(mockWrites).forEach(f => f.mockClear());
  document.body.innerHTML = "";
});

test("every tab renders real numbers and the filters respond", async () => {
  const { el, root } = await mount();

  // P&L: income Rs. 1,000 collected, expenses 200 + 300
  expect(el.textContent).toContain("Profit & Loss Statement");
  expect(el.textContent).toContain("Rs. 1,000");
  expect(el.textContent).toContain("Branch comparison");
  expect(el.textContent).toContain("North Campus");

  // branch filter: Main Office has no income, so the comparison table goes away
  await choose(selectByLabel(el, "Branch"), "main");
  expect(el.textContent).not.toContain("Branch comparison");
  await choose(selectByLabel(el, "Branch"), "all");

  // custom period reveals the date inputs
  await choose(selectByLabel(el, "Period"), "custom");
  expect(el.querySelectorAll('input[type="date"]').length).toBe(2);
  await choose(selectByLabel(el, "Period"), "all");

  await click(el, "Balance Sheet");
  expect(el.textContent).toContain("1000 — Cash");
  expect(el.textContent).toContain("Rs. 1,100"); // 100 opening + 1,000 received

  await click(el, "Cash Flow");
  expect(el.textContent).toContain("Closing balance");
  expect(el.textContent).toContain("Fee Collection");
  // accounts are offered by chart-of-accounts id
  const accountSelect = selectByLabel(el, "Account");
  expect([...accountSelect.options].map(o => o.value)).toEqual(["", "a1"]);
  await choose(accountSelect, "a1");

  await click(el, "Fee Collection");
  expect(el.textContent).toContain("Students with outstanding fees");
  expect(el.textContent).toContain("Sara");
  expect(el.textContent).toContain("Grade 6");
  await choose(selectByLabel(el, "Status"), "paid");
  expect(el.textContent).not.toContain("Sara");
  await click(el, "Reset");
  expect(el.textContent).toContain("Sara");

  await act(async () => { root.unmount(); });
});

test("income basis and comparison mode change the P&L", async () => {
  const { el, root } = await mount();
  await choose(selectByLabel(el, "Period"), "all"); // no comparison range for all time
  await choose(selectByLabel(el, "Period"), "thisYear");

  const headers = () => [...el.querySelectorAll("th")].map(t => t.textContent.trim());
  expect(el.textContent).toContain("Fee collections (received)");
  expect(headers()).toContain("Previous");
  await choose(selectByLabel(el, "Compare with"), "yoy");
  expect(headers()).toContain("Last year");
  expect(headers()).not.toContain("Previous");
  await choose(selectByLabel(el, "Compare with"), "none");
  expect(headers()).not.toContain("Last year");
  expect(headers()).not.toContain("Previous");

  await choose(selectByLabel(el, "Income basis"), "accrual");
  expect(el.textContent).toContain("Fee revenue (billed less concessions)");
  expect(el.textContent).toContain("Income (billed)");
  expect(el.textContent).not.toContain("Fee collections (received)");

  await click(el, "Reset");
  expect(el.textContent).toContain("Fee collections (received)");
  await act(async () => { root.unmount(); });
});

test("class view: teachers, students and printable statements", async () => {
  window.open = jest.fn(() => ({ document: { write: jest.fn(), close: jest.fn() }, print: jest.fn() }));
  const { el, root } = await mount();
  await click(el, "Fee Collection");
  await choose(selectByLabel(el, "Period"), "all");

  await clickRow(el, "Grade 6");
  expect(el.textContent).toContain("Class: Grade 6");
  expect(el.textContent).toContain("Ms Noor (Maths)");
  expect(el.textContent).toContain("Print statements (1 owing)");

  await click(el, "Print statements");
  expect(window.open).toHaveBeenCalledTimes(1);
  const w = window.open.mock.results[0].value;
  const html = w.document.write.mock.calls[0][0];
  expect(html).toContain("Sara");
  expect(html).toContain("Balance due: Rs. 500");
  expect(w.print).toHaveBeenCalled();

  // clicking the class again closes it
  await clickRow(el, "Grade 6");
  expect(el.textContent).not.toContain("Class: Grade 6");
  await act(async () => { root.unmount(); });
});

test("budget tab: setup hint when the table is missing, then edit and save", async () => {
  const { el, root } = await mount();
  await click(el, "Budget vs Actual");
  expect(el.textContent).toContain("supabase/budgets.sql");
  await act(async () => { root.unmount(); });

  // table exists now, with one Main Office line
  mockTables.budgets = [{ id: "bud1", kind: "expense", category: "Utilities", amount: 100, branchId: "" }];
  document.body.innerHTML = "";
  const m = await mount();
  await click(m.el, "Budget vs Actual");
  expect(m.el.textContent).toContain("Budget vs actual");
  expect(m.el.textContent).toContain("Pick a branch to edit its budget");
  expect(m.el.textContent).not.toContain("Edit budget");

  await choose(selectByLabel(m.el, "Branch"), "main");
  await click(m.el, "Edit budget");
  await type(m.el.querySelector('input[aria-label="Fee income monthly budget"]'), "6000");
  await type(m.el.querySelector('input[aria-label="Utilities monthly budget"]'), "150");
  await click(m.el, "Save budget");

  expect(mockWrites.add).toHaveBeenCalledWith({ name: "budgets" }, { kind: "income", category: "Fee income", amount: 6000, branchId: "" });
  expect(mockWrites.update).toHaveBeenCalledWith({ name: "budgets", id: "bud1" }, { amount: 150 });
  expect(mockWrites.remove).not.toHaveBeenCalled();
  await act(async () => { m.root.unmount(); });
});
