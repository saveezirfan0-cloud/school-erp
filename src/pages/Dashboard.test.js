/* eslint-disable testing-library/no-unnecessary-act */
// Smoke test for the merged Dashboard: renders with the ACC-04 fixture and
// checks the tiles use the shared definitions (collected = cash recorded,
// pending = what is still owed, marked-paid-no-money reported separately),
// that a tile opens its popup, and that CSV is hidden without canExport.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const mockCan = { canExport: true, canViewReports: true };
const mockTables = {
  students: [{ id: "s1", name: "Ali", branchId: "" }, { id: "s2", name: "Sara", branchId: "b1" }],
  employees: [],
  invoices: [
    { id: "A", studentId: "s1", studentName: "Ali", amount: 5000, status: "paid", paidAmount: 5000, paidDate: "2026-10-01", month: "October", year: 2026 },
    { id: "B", studentId: "s2", studentName: "Sara", amount: 5000, status: "paid", paidAmount: 3000, concessionAmount: 2000, paidDate: "2026-10-02", month: "October", year: 2026 },
    { id: "C", studentId: "s2", studentName: "Sara", amount: 4000, status: "paid", paidDate: "2026-10-03", month: "October", year: 2026 },
    { id: "D", studentId: "s1", studentName: "Ali", amount: 6000, status: "partial", paidAmount: 2500, paidDate: "2026-10-04", dueDate: "2026-08-15", month: "October", year: 2026 },
  ],
  expenses: [{ id: "e1", amount: 1000, date: "2026-10-02", category: "Utilities" }],
  payslips: [
    { id: "p1", netPay: 2000, status: "paid", paidDate: "2026-10-05", employeeName: "T" },
    { id: "p2", netPay: 9000, status: "pending", month: "October", year: 2026 },
  ],
  payments: [
    // receipt of invoice A: already counted through the invoice, must NOT be counted again
    { id: "x1", type: "cash_in", source: "invoice", sourceId: "A", amount: 5000, category: "Fee Collection", date: "2026-10-01" },
    // ledger-only income (no invoice): counted as Other Income
    { id: "x2", type: "cash_in", amount: 1500, category: "Donation", description: "Welfare", date: "2026-10-03" },
    { id: "x3", type: "cash_in", amount: 700, category: "Tafseer Course Fees", date: "2026-10-03" },
    // not income: account transfer, reversed row, cash out
    { id: "x4", type: "cash_in", amount: 999, category: "Bank Deposit", date: "2026-10-03" },
    { id: "x5", type: "cash_in", amount: 888, category: "Donation", reversed: true, date: "2026-10-03" },
    { id: "x6", type: "cash_out", amount: 777, category: "Utilities", date: "2026-10-03" },
  ],
};

jest.mock("../firebase", () => ({
  db: {},
  collection: (_db, name) => ({ name }),
  getDocs: async (ref) => ({ size: mockTables[ref.name].length, docs: mockTables[ref.name].map(({ id, ...rest }) => ({ id, data: () => rest })) }),
}));
jest.mock("../context/BranchContext", () => ({
  useBranch: () => ({ activeBranch: "all", setActiveBranch: () => {}, branches: [{ id: "b1", name: "North Campus" }] }),
}));
jest.mock("../context/UserContext", () => ({ useUser: () => ({ can: (k) => !!mockCan[k] }) }));
jest.mock("../components/AcademicsWidget", () => () => null);
jest.mock("recharts", () => {
  const Stub = ({ children }) => <div>{children}</div>;
  // The bar chart exposes its onClick as a button so a chart click can be simulated.
  const Bar = ({ onClick }) => <button data-testid="bar-chart" onClick={() => onClick({ activePayload: [{ payload: { key: "2026-10-02", label: "2 Oct" } }] })}>bar</button>;
  return new Proxy({}, { get: (_t, name) => (name === "BarChart" ? Bar : Stub) });
});

// eslint-disable-next-line import/first
import Dashboard from "./Dashboard";

global.IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  localStorage.setItem("dashboardPeriod", JSON.stringify({ mode: "all" }));
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MemoryRouter><Dashboard /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); });
  return { el, root };
}
const tile = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.includes(text));

test("tiles use the shared definitions and open popups", async () => {
  const { el, root } = await mount();
  // collected = cash recorded 5000 + 3000 + 2500 (not face value of paid invoices)
  expect(tile(el, "Fees Collected").textContent).toContain("Rs. 10,500");
  // pending = 6000 - 2500 on the partial invoice; "paid" invoices owe nothing
  expect(tile(el, "Pending Fees").textContent).toContain("Rs. 3,500");
  expect(tile(el, "Overdue Fees").textContent).toContain("Rs. 3,500");
  // expenses 1,000 + only the PAID payslip 2,000
  expect(tile(el, "Total Expenses").textContent).toContain("Rs. 3,000");
  // other income = ledger rows with no invoice: 1,500 + 700 (invoice receipt, transfer, reversal, cash out excluded)
  expect(tile(el, "Other Income").textContent).toContain("Rs. 2,200");
  // net = collected 10,500 + other 2,200 - expenses 3,000
  expect(el.textContent).toContain("Rs. 9,700"); // net surplus
  // marked paid with no money recorded is flagged, not counted
  expect(el.textContent).toContain("1 invoice is marked paid (Rs. 4,000) with no money recorded");
  expect(el.querySelector('a[href="/reports?tab=books"]')).toBeTruthy();
  expect(el.querySelector('a[href="/fee-aging"]')).toBeTruthy();
  // By-branch table: Main Office and North Campus
  expect(el.textContent).toContain("North Campus");

  await act(async () => { tile(el, "Pending Fees").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const dialog = document.body.querySelector('[role="dialog"]') || el.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Outstanding: Rs. 3,500");
  expect([...dialog.querySelectorAll("button")].some(b => b.textContent.includes("CSV"))).toBe(true);

  await act(async () => { root.unmount(); });
});

test("CSV export in popups is hidden without canExport", async () => {
  mockCan.canExport = false;
  const { el, root } = await mount();
  await act(async () => { tile(el, "Fees Collected").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const dialog = el.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  expect([...dialog.querySelectorAll("button")].some(b => b.textContent.includes("CSV"))).toBe(false);
  mockCan.canExport = true;
  await act(async () => { root.unmount(); });
});

test("clicking a chart day opens the entries behind that day", async () => {
  const { el, root } = await mount();
  await act(async () => { el.querySelector('[data-testid="bar-chart"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const dialog = el.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  expect(dialog.textContent).toContain("Activity on 2 Oct 2026");
  // 2 Oct: Sara's cash received 3,000 and the 1,000 Utilities expense; nothing else
  expect(dialog.textContent).toContain("Rs. 3,000");
  expect(dialog.textContent).toContain("Utilities");
  expect(dialog.textContent).toContain("2 records");
  expect(dialog.textContent).not.toContain("Donation");
  await act(async () => { root.unmount(); });
});
