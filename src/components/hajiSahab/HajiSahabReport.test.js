/* eslint-disable testing-library/no-unnecessary-act */
// Mounts the Haji Sahab report with fake data and clicks through the main
// features: statement, filters, period modes, drill-down, preview, year and
// branch views.

import React, { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../../context/UserContext", () => ({
  useUser: () => ({
    hajiPrefs: { presets: undefined, legacyLayout: null, active: null }, saveHajiPrefs: async () => {},
    can: () => true, isAdmin: true, userProfile: { name: "Test" },
  }),
}));
jest.mock("../../hooks/useReportDocs", () => ({
  useReportDocs: () => ({ docs: [], available: false, loading: false, reload: async () => {} }),
}));
jest.mock("../../lib/reportDocs", () => ({ saveReportDoc: async () => {}, deleteReportDoc: async () => {} }));
jest.mock("recharts", () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return new Proxy({}, { get: () => Stub });
});

// eslint-disable-next-line import/first
import HajiSahabReport from "./HajiSahabReport";

global.IS_REACT_ACT_ENVIRONMENT = true;

const branches = [{ id: "b1", name: "Baneen" }, { id: "b2", name: "Banaat" }];
const raw = {
  accounts: [{ name: "Cash", subType: "Bank & Cash", type: "Assets", balance: 1000 }],
  journals: [], payslips: [],
  invoices: [
    { id: "i1", branchId: "b1", studentName: "Ali", paidAmount: 5000, status: "paid", paidDate: "2026-09-10", paidAccount: "Cash", lineItems: [{ description: "Tuition Fee", amount: 5000 }] },
    { id: "i2", branchId: "b2", studentName: "Sara", paidAmount: 3000, status: "paid", paidDate: "2026-08-12", paidAccount: "Cash", lineItems: [{ description: "Tuition Fee", amount: 3000 }] },
  ],
  expenses: [
    { id: "e1", branchId: "b1", category: "Utilities", description: "Gas bill", amount: 700, date: "2026-09-03", paidAccount: "Cash" },
    { id: "e2", branchId: "b2", category: "Utilities", description: "Electricity", amount: 400, date: "2026-09-04" },
  ],
  payments: [],
};

let root; let el;
beforeEach(() => {
  jest.useFakeTimers("modern");
  jest.setSystemTime(new Date("2026-09-15T10:00:00Z"));
  el = document.createElement("div");
  document.body.appendChild(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); document.body.innerHTML = ""; jest.useRealTimers(); });

const mount = async (activeBranch = "all") => {
  root = createRoot(el);
  await act(async () => { root.render(<HajiSahabReport raw={raw} branches={branches} activeBranch={activeBranch} />); });
};
const btn = (text, scope = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
const click = async (node) => { await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const type = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

test("shows the month's statement with totals", async () => {
  await mount();
  expect(el.textContent).toContain("1st September to 30th September 2026");
  expect(el.textContent).toContain("Rs. 5,000"); // income
  expect(el.textContent).toContain("Rs. 1,100"); // expense 700 + 400
  expect(el.textContent).toContain("Utilities");
});

test("filters: record type, account and search narrow the figures and are announced", async () => {
  await mount();
  await click(btn("Filters"));
  await click(btn("Expenses", el)); // records: expenses only
  expect(el.textContent).toContain("1 filter on");
  expect(el.textContent).toContain("Rs. 1,100");
  expect(el.textContent).not.toContain("Rs. 5,000");

  await click(btn("Clear filters"));
  const search = el.querySelector('input[aria-label="Search"]');
  await type(search, "gas");
  expect(el.textContent).toContain("Rs. 700");
  expect(el.textContent).not.toContain("Electricity");
});

test("quarter and custom periods change the range", async () => {
  await mount();
  await click(btn("Filters"));
  await click(btn("Quarter", el));
  expect(el.textContent).toContain("1 Jul 2026 to 30 Sep 2026");
  expect(el.textContent).toContain("Rs. 8,000"); // 5,000 + 3,000 from August

  await click(btn("Custom dates"));
  expect(el.querySelector('input[aria-label="From date"]').value).toBe("2026-07-01"); // starts from the range in view
  await type(el.querySelector('input[aria-label="From date"]'), "2026-09-01");
  await type(el.querySelector('input[aria-label="To date"]'), "2026-09-03");
  expect(el.textContent).toContain("1 Sep 2026 to 3 Sep 2026");
  expect(el.textContent).toContain("Rs. 700"); // only the gas bill (3 Sep) falls in these dates
});

test("clicking a head opens the records behind it", async () => {
  await mount();
  const head = [...el.querySelectorAll('[role="button"]')].find((n) => n.textContent.includes("Utilities"));
  await click(head);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Gas bill");
  expect(dialog.textContent).toContain("Electricity");
});

test("preview shows the printable report in an iframe, with per-export toggles", async () => {
  await mount();
  await click(btn("Preview"));
  const frame = document.querySelector('iframe[title="Report preview"]');
  expect(frame).toBeTruthy();
  expect(frame.getAttribute("srcdoc")).toContain("Monthly Statement");
  expect(frame.getAttribute("srcdoc")).toContain("Fee Income");

  // switch this export to Urdu without touching the saved layout
  await click(btn("اردو (Urdu)"));
  expect(document.querySelector('iframe[title="Report preview"]').getAttribute("srcdoc")).toContain("ماہانہ گوشوارہ");
  expect(document.querySelector('iframe[title="Report preview"]').getAttribute("srcdoc")).toContain('dir="rtl"');
});

test("year view lists every month; branch view compares branches", async () => {
  await mount();
  await click(btn("Year"));
  expect(el.textContent).toContain("Opening balance");
  expect(el.textContent).toContain("Fee Income");
  expect(el.textContent).toContain("Total 2026".replace("Total 2026", "Total"));

  await click(btn("Branches"));
  expect(el.textContent).toContain("Branch comparison");
  expect(el.textContent).toContain("Baneen");
  expect(el.textContent).toContain("Banaat");
});

test("branch comparison is unavailable inside a single branch", async () => {
  await mount("b1");
  expect(btn("Branches").disabled).toBe(true);
  expect(el.textContent).toContain("Rs. 5,000");
  expect(el.textContent).not.toContain("Rs. 1,100");
});
