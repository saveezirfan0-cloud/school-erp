/* eslint-disable testing-library/no-unnecessary-act */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

const mockUpdateDocs = jest.fn(() => Promise.resolve());
jest.mock("../../firebase", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) },
  updateDocs: (...a) => mockUpdateDocs(...a),
  serverTimestamp: () => "ts",
}));
jest.mock("../../utils/auditLog", () => ({ logActivity: jest.fn() }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));

// eslint-disable-next-line import/first
import InvoiceEditModal from "./InvoiceEditModal";

global.IS_REACT_ACT_ENVIRONMENT = true;

async function save(invoice, tweak) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<InvoiceEditModal invoice={invoice} branches={[]} isMobile={false} onClose={() => {}} />);
  });
  if (tweak) await tweak(el);
  const form = el.querySelector("form");
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  root.unmount();
  el.remove();
}

const base = {
  id: "i1", studentName: "A", month: "March", year: 2026, branchId: "b1", dueDate: "2026-03-10", notes: "",
  amount: 5000, lineItems: [{ description: "Tuition Fee", amount: 5000 }],
};

beforeEach(() => mockUpdateDocs.mockClear());

test("a paid invoice can be edited but its money fields are never written", async () => {
  await save({ ...base, status: "paid", paidAmount: 5000 });
  expect(mockUpdateDocs).toHaveBeenCalledTimes(1);
  const changes = mockUpdateDocs.mock.calls[0][2];
  expect(changes).toMatchObject({ month: "March", year: 2026, dueDate: "2026-03-10" });
  for (const k of ["amount", "lineItems", "status", "paidAmount"]) expect(changes).not.toHaveProperty(k);
});

test("an invoice with a concession is locked the same way", async () => {
  await save({ ...base, status: "pending", paidAmount: 0, concessionAmount: 500 });
  const changes = mockUpdateDocs.mock.calls[0][2];
  for (const k of ["amount", "lineItems", "status", "paidAmount"]) expect(changes).not.toHaveProperty(k);
});

test("an untouched pending invoice still saves its line items and total", async () => {
  await save({ ...base, status: "pending", paidAmount: 0 });
  const changes = mockUpdateDocs.mock.calls[0][2];
  expect(changes.amount).toBe(5000);
  expect(changes.lineItems).toEqual([{ description: "Tuition Fee", amount: 5000 }]);
});
