// Smoke test: mount the Reports page with fake data, click through every
// tab and change the main filters. Catches render-time crashes the pure
// reportData tests can't.

import React, { act } from "react";
import { createRoot } from "react-dom/client";

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
  accounts: [{ id: "a1", code: "1000", name: "Cash", type: "Assets", subType: "Bank & Cash", balance: 100 }, { id: "a2", code: "2000", name: "Loan", type: "Liabilities", balance: 50 }],
};

jest.mock("../firebase", () => ({
  db: {},
  collection: (_db, name) => ({ name }),
  getAllDocs: async (ref) => ({ docs: mockTables[ref.name].map(({ id, ...rest }) => ({ id, data: () => rest })) }),
}));
jest.mock("../context/BranchContext", () => ({
  useBranch: () => ({ activeBranch: "all", branches: [{ id: "b1", name: "North Campus" }] }),
}));
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
  await act(async () => { root.render(<Reports />); });
  await act(async () => { await Promise.resolve(); });
  return { el, root };
}
const click = async (el, text) => {
  const btn = [...el.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(text));
  expect(btn).toBeTruthy();
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const choose = async (select, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  await act(async () => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
};
const selectByLabel = (el, label) => [...el.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(label)).querySelector("select");

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
  await choose(selectByLabel(el, "Account"), "Cash");

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
