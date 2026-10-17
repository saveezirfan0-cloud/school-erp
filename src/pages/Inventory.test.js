/* eslint-disable testing-library/no-unnecessary-act */
// Inventory pages: a checkout is filed as PENDING (stock untouched), the
// admin's Approve tick sends status "approved", staff without the approve
// permission get no tick, and the reception Paid tick marks a sale paid.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const mockCan = {};
const mockTables = {
  inventoryItems: [
    { id: "i1", code: "ITM001", name: "Diary", openingStock: 20, unitPrice: 200, lowStockLevel: 10 },
    { id: "i2", code: "ITM002", name: "Monogram", openingStock: 5, unitPrice: 50, lowStockLevel: 10 },
  ],
  inventoryMovements: [
    { id: "m1", itemId: "i1", direction: "out", quantity: 6, date: "2026-10-16", destination: "Reception", person: "Amina", reason: "for sale", status: "pending", requestedBy: "u2", createdAt: "2026-10-16T08:00:00Z" },
    { id: "m2", itemId: "i1", direction: "out", quantity: 4, date: "2026-10-01", destination: "Reception", status: "approved" },
  ],
  receptionSales: [
    { id: "s1", itemId: "i1", buyerName: "Ali", quantity: 1, unitPrice: 200, amount: 200, date: "2026-10-02", paid: false },
  ],
};
const mockWrites = { addDoc: jest.fn(async () => ({ id: "new" })), updateDoc: jest.fn(async () => {}), deleteDoc: jest.fn(async () => {}), addDocs: jest.fn(async () => []) };
const mockToast = { success: jest.fn(), error: jest.fn() };

jest.mock("../firebase", () => ({
  db: {},
  collection: (_db, name) => ({ name }),
  doc: (_db, name, id) => ({ name, id }),
  onSnapshot: (ref, next) => {
    next({ docs: mockTables[ref.name].map(({ id, ...rest }) => ({ id, data: () => rest })) });
    return () => {};
  },
  addDoc: (...a) => mockWrites.addDoc(...a),
  addDocs: (...a) => mockWrites.addDocs(...a),
  updateDoc: (...a) => mockWrites.updateDoc(...a),
  deleteDoc: (...a) => mockWrites.deleteDoc(...a),
}));
jest.mock("../context/UserContext", () => ({
  useUser: () => ({ can: (k) => !!mockCan[k], userProfile: { id: "u1", name: "Morning Staff" } }),
}));
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u2" } }) }));
jest.mock("../context/BranchContext", () => ({ useBranch: () => ({ branches: [{ id: "b1", name: "Branch A" }] }) }));
jest.mock("../utils/auditLog", () => ({ logActivity: () => {} }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: (...a) => mockToast.success(...a), error: (...a) => mockToast.error(...a) } }));

// eslint-disable-next-line import/first
import Storage from "./Storage";
// eslint-disable-next-line import/first
import StockCheckout from "./StockCheckout";
// eslint-disable-next-line import/first
import ReceptionInventory from "./ReceptionInventory";

global.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(element, path = "/") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>); });
  return { el, root };
}
const setValue = async (input, value) => {
  const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  await act(async () => { input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
};
const click = async (node) => { await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const row = (el, text) => [...el.querySelectorAll("tr")].find((r) => r.textContent.includes(text));

beforeEach(() => {
  Object.keys(mockCan).forEach((k) => delete mockCan[k]);
  Object.values(mockWrites).forEach((f) => f.mockClear());
  mockToast.success.mockClear(); mockToast.error.mockClear();
});

test("storage: a pending checkout is not deducted; the admin's tick approves it", async () => {
  Object.assign(mockCan, { canViewInventory: true, canEditInventory: true, canApproveInventory: true });
  const { el, root } = await mount(<Storage />);
  expect(el.textContent).toContain("Waiting for approval (1)");
  // Diary: 20 opening - 4 approved = 16; the pending 6 is shown as waiting, not deducted
  const stockRow = row(el, "ITM001");
  expect(stockRow.textContent).toContain("16");
  expect(stockRow.textContent).toContain("6");
  const tick = el.querySelector('input[aria-label="Approve 6 Diary"]');
  expect(tick).toBeTruthy();
  await click(tick);
  expect(mockWrites.updateDoc).toHaveBeenCalledWith({ name: "inventoryMovements", id: "m1" }, { status: "approved", reviewedByName: "Morning Staff" });
  await act(async () => { root.unmount(); });
});

test("storage: staff without the approve permission see no approve tick", async () => {
  Object.assign(mockCan, { canViewInventory: true, canEditInventory: true });
  const { el, root } = await mount(<Storage />);
  expect(el.querySelector('input[aria-label="Approve 6 Diary"]')).toBeNull();
  expect(row(el, "Amina").textContent).toContain("Waiting");
  expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Add Item")).toBe(false);
  await act(async () => { root.unmount(); });
});

test("take out stock: files a pending request with destination and reason", async () => {
  Object.assign(mockCan, { canEditInventory: true });
  const { el, root } = await mount(<StockCheckout />, "/stock-checkout?to=Reception");
  await setValue(el.querySelector('input[placeholder^="Type item"]'), "dia");
  await click([...el.querySelectorAll("button")].find((b) => b.textContent.includes("Diary")));
  // 16 in storage, 6 already requested: 10 free
  expect(el.textContent).toContain("free to take: 10");
  await setValue(el.querySelector('input[type="number"]'), "11");
  await setValue(el.querySelector('input[placeholder^="e.g."]'), "Reception sale");
  expect(el.querySelector("select").value).toBe("Reception");
  await act(async () => { el.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(mockWrites.addDoc).not.toHaveBeenCalled();
  expect(mockToast.error.mock.calls[0][0]).toMatch(/Only 10 Diary/);

  await setValue(el.querySelector('input[type="number"]'), "3");
  await act(async () => { el.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(mockWrites.addDoc).toHaveBeenCalledTimes(1);
  expect(mockWrites.addDoc.mock.calls[0][1]).toMatchObject({
    itemId: "i1", direction: "out", quantity: 3, destination: "Reception", reason: "Reception sale",
    person: "Morning Staff", status: "pending",
  });
  expect(el.textContent).toContain("Request sent");
  expect(el.textContent).toContain("deducted from storage once it is approved");
  await act(async () => { root.unmount(); });
});

test("reception: stock left counts approved transfers only, and the Paid tick marks a sale paid", async () => {
  Object.assign(mockCan, { canViewInventory: true, canEditInventory: true });
  const { el, root } = await mount(<ReceptionInventory />);
  // received 4 (approved) - sold 1 = 3 left; the pending 6 is "coming"
  const diary = [...el.querySelectorAll("tr")].find((r) => r.textContent.startsWith("Diary"));
  expect([...diary.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Diary ITM001", "4", "1", "3", "6", "16"]);
  await click(el.querySelector('input[aria-label="Tick when paid"]'));
  expect(mockWrites.updateDoc).toHaveBeenCalledWith({ name: "receptionSales", id: "s1" }, expect.objectContaining({ paid: true }));
  await act(async () => { root.unmount(); });
});
