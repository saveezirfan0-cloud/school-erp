import {
  summarizeStock, stockStatus, parseQuantity, nextItemCode, destinationOptions, isReception,
  parseInventoryWorkbook, planInventoryImport,
} from "./inventory";

const items = [
  { id: "i1", code: "ITM001", name: "Diary", openingStock: 100, unitPrice: 200, lowStockLevel: 10, receptionOpening: 5 },
  { id: "i2", code: "ITM002", name: "Monogram", openingStock: 8, unitPrice: 50 },
];

test("a pending checkout does not change storage stock, only what is free to request", () => {
  const s = summarizeStock(items, [
    { itemId: "i1", direction: "out", quantity: 10, status: "pending", destination: "Reception" },
  ]).get("i1");
  expect(s.current).toBe(100);
  expect(s.pendingOut).toBe(10);
  expect(s.available).toBe(90);
  expect(s.receptionIn).toBe(0);
});

test("approved movements change stock; rejected ones never do", () => {
  const s = summarizeStock(items, [
    { itemId: "i1", direction: "out", quantity: 10, status: "approved", destination: "Reception" },
    { itemId: "i1", direction: "out", quantity: 7, status: "rejected", destination: "Office" },
    { itemId: "i1", direction: "in", quantity: 50, status: "approved" },
    { itemId: "i1", direction: "out", quantity: "3", status: "approved", destination: "Branch A" },
  ]).get("i1");
  expect(s.current).toBe(137);
  expect(s.value).toBe(137 * 200);
  expect(s.receptionIn).toBe(10);
});

test("reception stock = reception opening + approved transfers to Reception - sold", () => {
  const s = summarizeStock(items, [
    { itemId: "i1", direction: "out", quantity: 10, status: "approved", destination: " reception " },
    { itemId: "i1", direction: "out", quantity: 4, status: "pending", destination: "Reception" },
  ], [{ itemId: "i1", quantity: 6 }, { itemId: "zz", quantity: 1 }]).get("i1");
  expect(s.receptionLeft).toBe(5 + 10 - 6);
});

test("status: out of stock, low (below the item's level, default 10), available", () => {
  expect(stockStatus(0, 10)).toBe("Out of Stock");
  expect(stockStatus(9, 10)).toBe("Low Stock");
  expect(stockStatus(10, 10)).toBe("Available");
  expect(summarizeStock(items).get("i2").status).toBe("Low Stock");
});

test("quantities are whole numbers above zero", () => {
  expect(parseQuantity("4")).toEqual({ ok: true, value: 4 });
  expect(parseQuantity("").ok).toBe(false);
  expect(parseQuantity("0").ok).toBe(false);
  expect(parseQuantity("-2").ok).toBe(false);
  expect(parseQuantity("1.5").error).toMatch(/whole/);
  expect(parseQuantity("abc").ok).toBe(false);
});

test("next item code and destinations", () => {
  expect(nextItemCode(items)).toBe("ITM003");
  expect(nextItemCode([])).toBe("ITM001");
  expect(destinationOptions([{ name: "Branch A" }, { name: "office" }, { name: "" }]))
    .toEqual(["Reception", "Office", "Branch A", "Student", "Staff"]);
  expect(isReception("RECEPTION")).toBe(true);
  expect(isReception("Office")).toBe(false);
});

// Same layout as the school's Inventory.xlsx: a title row, then headers.
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const workbook = [
  {
    name: "Current Stock Status",
    rows: [
      ["Zohra Majeed Islamic Institute"],
      ["Item ID", "Item Description", "Opening Stock", "Amount Per Unit", "Total Amount", "Total Stock In", "Total Stock Out", "Current Stock", "Status"],
      ["ITM001", "Diary", 497, 200, 99400, 0, 18, 479, "Available"],
      ["ITM006", "Files (Big)", 4, 0, 0, 0, 0, 4, "Low Stock"],
      ["ITM023", "Files", 13, 0, 0, 0, 2, 11, "Available"],
      ["ITM007", "Envelopes ", 478, 0, 0, 0, 0, 478, "Available"],
      ["ITM008", "Envelopes ", 24, 0, 0, 0, 0, 24, "Available"],
      [null, "Envelopes (Printed) New-Edition", 0, 0, 0, 300, 0, 300, "Available"],
      [],
    ],
  },
  {
    name: "Daily In-Out Log",
    rows: [
      ["DAILY INWARD / OUTWARD REGISTER"],
      ["Date (DD-MM)", "Slip / Bill No.", "Item Description", "Person / Department", "Stock In (Qty)", "Stock Out (Qty)", "Payment Status"],
      [utc(2026, 9, 8), null, "Files", "Office", null, 2, "No Payment Required"],
      [utc(2026, 9, 9), null, "Diary", "Office (Banaat)", null, 10, "Pending"],
      [utc(2026, 9, 10), null, "Diary", "Banaat (Umer Colony)", null, 8, 1600],
      [utc(2026, 9, 12), null, "Diary ", "Reception", null, 10, "Pending"],
      [utc(2026, 9, 12), null, "Envelopes (Printed) New-Edition", "Office", 300, null, "No Payment Required"],
      ["15-09", null, "Envelopes", "Office", null, 1, ""],
      [null, null, "Ghost item", "Office", null, 1, ""],
    ],
  },
];

test("the workbook is read: items, log rows, a missing code gets the next one", () => {
  const parsed = parseInventoryWorkbook(workbook, { year: 2026 });
  expect(parsed.items.map((i) => i.code)).toEqual(["ITM001", "ITM006", "ITM023", "ITM007", "ITM008", ""]);
  expect(parsed.items[0]).toEqual({ code: "ITM001", name: "Diary", openingStock: 497, unitPrice: 200 });
  expect(parsed.movements).toHaveLength(6);
  expect(parsed.movements[2]).toMatchObject({ name: "Diary", date: "2026-09-10", direction: "out", quantity: 8, paymentStatus: "Paid Rs. 1600" });
  expect(parsed.movements[5]).toMatchObject({ date: "2026-09-15", name: "Envelopes" });
  expect(parsed.problems).toEqual([expect.stringMatching(/row 9: unreadable date for "Ghost item"/)]);

  const plan = planInventoryImport(parsed, []);
  expect(plan.newItems.at(-1).code).toBe("ITM024");
  // "Files" is not "Files (Big)"; the trailing space in "Diary " still matches Diary;
  // "Envelopes" is shared by two items, so that log row cannot be placed.
  expect(plan.movements.map((m) => `${m.itemKey}:${m.direction}:${m.quantity}`)).toEqual([
    "new:2:out:2", "new:0:out:10", "new:0:out:8", "new:5:in:300", "new:0:out:10",
  ]);
  expect(plan.problems.some((p) => /"Envelopes".*several items/.test(p))).toBe(true);

  // Diary: 497 opening - 28 out (the workbook's own total misses the "Diary " row)
  const created = plan.newItems.map((it, i) => ({ ...it, id: `n${i}` }));
  const moves = plan.movements.map((m) => ({ ...m, itemId: `n${m.itemKey.slice(4)}`, status: "approved" }));
  expect(summarizeStock(created, moves).get("n0").current).toBe(469);
});

test("importing the same workbook again creates nothing twice", () => {
  const parsed = parseInventoryWorkbook(workbook, { year: 2026 });
  const existing = parseInventoryWorkbook(workbook, { year: 2026 }).items.map((it, i) => ({ ...it, id: `x${i}`, code: it.code || "ITM024" }));
  const nameToId = (name) => existing.find((e) => e.name.trim() === name.trim()).id;
  const existingMoves = parsed.movements
    .filter((m) => m.name !== "Envelopes")
    .map((m) => ({ ...m, itemId: nameToId(m.name) }));
  const plan = planInventoryImport(parsed, existing, existingMoves);
  expect(plan.newItems).toEqual([]);
  expect(plan.movements).toEqual([]);
  expect(plan.duplicates).toBe(5);
});
