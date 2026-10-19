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

// The item dropdown's trigger on one line (the box showing the placeholder).
const trigger = (line) => [...line.querySelectorAll("span")].find((sp) => sp.textContent.includes("Choose or search")).parentElement;
// Open line `n`'s item dropdown and pick the option whose label contains `text`.
async function pickItem(el, n, text) {
  const line = el.querySelectorAll('[data-testid="checkout-line"]')[n];
  if (!line.querySelector('input[placeholder="Choose or search item…"]')) await click(trigger(line)); // open unless already open
  const opt = [...line.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent.startsWith(text));
  await click(opt.parentElement.parentElement);
}
const submit = async (el) => { await act(async () => { el.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

test("take out stock: the item dropdown lists every item without typing", async () => {
  Object.assign(mockCan, { canEditInventory: true });
  const { el, root } = await mount(<StockCheckout />);
  const line = el.querySelector('[data-testid="checkout-line"]');
  await click(trigger(line));
  expect(line.textContent).toContain("Diary (ITM001)");
  expect(line.textContent).toContain("Monogram (ITM002)");
  expect(line.textContent).toContain("10 free to take"); // 16 in storage - 6 waiting
  await act(async () => { root.unmount(); });
});

test("take out stock: one line, too many is refused; nothing is saved", async () => {
  Object.assign(mockCan, { canEditInventory: true });
  const { el, root } = await mount(<StockCheckout />, "/stock-checkout?to=Reception");
  await pickItem(el, 0, "Diary");
  expect(el.textContent).toContain("free to take: 10");
  await setValue(el.querySelector('input[aria-label="Quantity for line 1"]'), "11");
  await setValue(el.querySelector('input[placeholder^="e.g."]'), "Reception sale");
  expect(el.querySelector("select").value).toBe("Reception");
  await submit(el);
  expect(mockWrites.addDocs).not.toHaveBeenCalled();
  expect(mockToast.error.mock.calls[0][0]).toMatch(/Only 10 Diary/);
  await act(async () => { root.unmount(); });
});

test("take out stock: several items in one go are filed together as pending", async () => {
  Object.assign(mockCan, { canEditInventory: true });
  const { el, root } = await mount(<StockCheckout />, "/stock-checkout?to=Reception");
  await pickItem(el, 0, "Diary");
  await setValue(el.querySelector('input[aria-label="Quantity for line 1"]'), "3");
  await click([...el.querySelectorAll("button")].find((b) => b.textContent.includes("Add another item")));
  // an item already on a line is not offered again
  const line2 = el.querySelectorAll('[data-testid="checkout-line"]')[1];
  await click(trigger(line2));
  expect(line2.textContent).not.toContain("Diary (ITM001)");
  await pickItem(el, 1, "Monogram");
  await setValue(el.querySelector('input[aria-label="Quantity for line 2"]'), "2");
  await setValue(el.querySelector('input[placeholder^="e.g."]'), "Reception sale");
  expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Send for Approval (2 items)")).toBe(true);
  await submit(el);
  expect(mockWrites.addDocs).toHaveBeenCalledTimes(1);
  const [name, rows] = mockWrites.addDocs.mock.calls[0];
  expect(name).toBe("inventoryMovements");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ itemId: "i1", quantity: 3, direction: "out", destination: "Reception", reason: "Reception sale", person: "Morning Staff", status: "pending" });
  expect(rows[1]).toMatchObject({ itemId: "i2", quantity: 2, status: "pending" });
  expect(el.textContent).toContain("2 requests sent");
  expect(el.textContent).toContain("3 × Diary");
  expect(el.textContent).toContain("2 × Monogram");
  await act(async () => { root.unmount(); });
});

test("reception: stock left counts approved transfers only, and the Paid tick marks a sale paid", async () => {
  Object.assign(mockCan, { canViewInventory: true, canEditInventory: true });
  const { el, root } = await mount(<ReceptionInventory />);
  // received 4 (approved) - sold 1 = 3 left; the pending 6 is "coming"
  const diary = [...el.querySelectorAll("tr")].find((r) => r.textContent.startsWith("Diary"));
  expect([...diary.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Diary ITM001", "4", "1", "3", "6", "16", ""]);
  // staff can edit a sale (labelled button) but not correct the stock count
  expect([...row(el, "Ali").querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit")).toBe(true);
  await click(el.querySelector('input[aria-label="Tick when paid"]'));
  expect(mockWrites.updateDoc).toHaveBeenCalledWith({ name: "receptionSales", id: "s1" }, expect.objectContaining({ paid: true }));
  await act(async () => { root.unmount(); });
});

test("reception: an admin can correct the stock left; it is saved as the reception opening", async () => {
  Object.assign(mockCan, { canViewInventory: true, canEditInventory: true, canApproveInventory: true });
  const { el, root } = await mount(<ReceptionInventory />);
  const diary = () => [...el.querySelectorAll("tr")].find((r) => r.textContent.startsWith("Diary"));
  await click([...diary().querySelectorAll("button")].find((b) => b.textContent.trim() === "Edit"));
  const dialog = el.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Stock left now: 3");
  const input = dialog.querySelector('input[type="number"]');
  const save = () => act(async () => { dialog.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

  // 4 came from storage and 1 was sold, so it cannot go below 3
  await setValue(input, "2");
  await save();
  expect(mockWrites.updateDoc).not.toHaveBeenCalled();
  expect(mockToast.error.mock.calls[0][0]).toMatch(/Can't go below 3/);

  // 5 on the shelf: opening = 5 - 4 received + 1 sold = 2
  await setValue(input, "5");
  await save();
  expect(mockWrites.updateDoc).toHaveBeenCalledWith({ name: "inventoryItems", id: "i1" }, { receptionOpening: 2 });
  await act(async () => { root.unmount(); });
});
