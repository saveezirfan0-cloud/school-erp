// src/utils/inventory.js
//
// Pure inventory helpers shared by Storage, Reception Inventory and the
// Take Out Stock form. Stock is never stored; it is always worked out from
// the movements, the same way the database does (inventory_stock() in
// supabase/migrations/0014_inventory.sql):
//
//   storage stock   = opening stock + APPROVED stock in - APPROVED stock out
//   reception stock = reception opening + APPROVED stock out to Reception - sold
//
// A checkout waiting for approval ("pending") never changes the storage
// figure. It only reduces what is still free to request ("available").

import { parseDateCell } from "./importParsing";

export const RECEPTION = "Reception";
export const MOVEMENT_STATUS = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };
export const PAYMENT_OPTIONS = ["No Payment Required", "Pending", "Paid"];

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const isReception = (destination) => norm(destination) === RECEPTION.toLowerCase();

// Destinations offered on the checkout form: Reception and Office first,
// then each branch, then the people items are handed to directly.
export function destinationOptions(branches = []) {
  const names = branches.map((b) => String(b?.name || "").trim()).filter(Boolean);
  const seen = new Set();
  return [RECEPTION, "Office", ...names, "Student", "Staff"].filter((n) => {
    const k = norm(n);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function stockStatus(current, lowLevel) {
  if (current <= 0) return "Out of Stock";
  if (current < num(lowLevel)) return "Low Stock";
  return "Available";
}

/**
 * Stock figures for every item.
 * @returns {Map<string, object>} itemId -> {
 *   opening, approvedIn, approvedOut, current, pendingIn, pendingOut, available,
 *   receptionOpening, receptionIn, sold, receptionLeft, value, status }
 */
export function summarizeStock(items = [], movements = [], sales = []) {
  const map = new Map();
  for (const it of items) {
    map.set(it.id, {
      opening: num(it.openingStock), approvedIn: 0, approvedOut: 0, pendingIn: 0, pendingOut: 0,
      receptionOpening: num(it.receptionOpening), receptionIn: 0, sold: 0,
    });
  }
  for (const m of movements) {
    const s = map.get(m.itemId);
    if (!s) continue;
    const q = num(m.quantity);
    if (m.status === MOVEMENT_STATUS.APPROVED) {
      if (m.direction === "in") s.approvedIn += q;
      else {
        s.approvedOut += q;
        if (isReception(m.destination)) s.receptionIn += q;
      }
    } else if (m.status === MOVEMENT_STATUS.PENDING) {
      if (m.direction === "in") s.pendingIn += q;
      else s.pendingOut += q;
    }
  }
  for (const sale of sales) {
    const s = map.get(sale.itemId);
    if (s) s.sold += num(sale.quantity);
  }
  for (const it of items) {
    const s = map.get(it.id);
    s.current = s.opening + s.approvedIn - s.approvedOut;
    s.available = s.current - s.pendingOut;
    s.receptionLeft = s.receptionOpening + s.receptionIn - s.sold;
    s.value = s.current * num(it.unitPrice);
    s.status = stockStatus(s.current, it.lowStockLevel ?? 10);
  }
  return map;
}

// Validate a requested quantity: a whole number above zero. Returns
// { ok, value } or { ok: false, error }.
export function parseQuantity(input) {
  const s = String(input ?? "").trim();
  if (!s) return { ok: false, error: "Enter a quantity" };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Quantity must be more than 0" };
  if (!Number.isInteger(n)) return { ok: false, error: "Quantity must be a whole number" };
  return { ok: true, value: n };
}

// Next free "ITM###" code.
export function nextItemCode(items = []) {
  let max = 0;
  for (const it of items) {
    const m = String(it.code || "").match(/^ITM(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ITM${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------
// Workbook import ("Current Stock Status" + "Daily In-Out Log" sheets)
// ---------------------------------------------------------------

const findHeader = (rows, test) => rows.findIndex((r) => Array.isArray(r) && r.some((c) => test(norm(c))));
const colIndex = (header, ...names) => header.findIndex((c) => names.some((n) => norm(c).startsWith(n)));
const cellText = (v) => (v === null || v === undefined ? "" : String(v).trim().replace(/\s+/g, " "));

/**
 * Turn the sheets of the inventory workbook into items and movements.
 * @param {{name: string, rows: any[][]}[]} sheets
 * @param {{ year?: number }} opts  year used for dates written as DD-MM only
 * @returns {{ items: object[], movements: object[], problems: string[] }}
 */
export function parseInventoryWorkbook(sheets, { year = new Date().getFullYear() } = {}) {
  const problems = [];
  const items = [];
  const movements = [];

  const stockSheet = sheets.find((s) => findHeader(s.rows, (c) => c === "item description") >= 0
    && findHeader(s.rows, (c) => c.startsWith("opening stock")) >= 0);
  if (!stockSheet) {
    problems.push('No sheet with "Item Description" and "Opening Stock" columns was found.');
  } else {
    const h = findHeader(stockSheet.rows, (c) => c.startsWith("opening stock"));
    const header = stockSheet.rows[h];
    const cCode = colIndex(header, "item id", "item code", "code");
    const cName = colIndex(header, "item description", "item name", "description");
    const cOpen = colIndex(header, "opening stock");
    const cPrice = colIndex(header, "amount per unit", "unit price", "price");
    stockSheet.rows.slice(h + 1).forEach((r, i) => {
      const name = cellText(r[cName]);
      if (!name) return;
      const opening = num(r[cOpen]);
      if (opening < 0) problems.push(`${stockSheet.name} row ${h + i + 2}: negative opening stock for "${name}" skipped`);
      items.push({
        code: cCode >= 0 ? cellText(r[cCode]) : "",
        name,
        openingStock: Math.max(0, opening),
        unitPrice: Math.max(0, num(r[cPrice])),
      });
    });
  }

  const logSheet = sheets.find((s) => findHeader(s.rows, (c) => c.startsWith("stock out")) >= 0);
  if (logSheet) {
    const h = findHeader(logSheet.rows, (c) => c.startsWith("stock out"));
    const header = logSheet.rows[h];
    const cDate = colIndex(header, "date");
    const cSlip = colIndex(header, "slip");
    const cName = colIndex(header, "item description", "item");
    const cWho = colIndex(header, "person", "department");
    const cIn = colIndex(header, "stock in");
    const cOut = colIndex(header, "stock out");
    const cPay = colIndex(header, "payment");
    logSheet.rows.slice(h + 1).forEach((r, i) => {
      const rowNo = h + i + 2;
      const name = cellText(r[cName]);
      const qIn = num(r[cIn]);
      const qOut = num(r[cOut]);
      if (!name && !qIn && !qOut) return;
      const date = parseLogDate(r[cDate], year);
      if (!name) { problems.push(`${logSheet.name} row ${rowNo}: no item name, skipped`); return; }
      if (!date) { problems.push(`${logSheet.name} row ${rowNo}: unreadable date for "${name}", skipped`); return; }
      const pay = r[cPay];
      const paymentStatus = typeof pay === "number" ? `Paid Rs. ${pay}` : cellText(pay);
      const base = { name, date, slipNo: cellText(r[cSlip]), destination: cellText(r[cWho]), paymentStatus };
      if (qIn > 0) movements.push({ ...base, direction: "in", quantity: qIn });
      if (qOut > 0) movements.push({ ...base, direction: "out", quantity: qOut });
      if (qIn <= 0 && qOut <= 0) problems.push(`${logSheet.name} row ${rowNo}: no quantity for "${name}", skipped`);
    });
  }
  return { items, movements, problems };
}

function parseLogDate(v, year) {
  const iso = parseDateCell(v);
  if (iso) return iso;
  const m = String(v ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})$/);   // DD-MM
  if (!m) return null;
  return parseDateCell(`${m[1]}-${m[2]}-${year}`);
}

// Same log line? Used so importing the workbook twice adds nothing twice.
const movementKey = (m) => [m.itemId, m.date, m.direction, num(m.quantity), norm(m.destination)].join("|");

/**
 * Match parsed workbook data against what is already in the app.
 * Items whose code (or, without a code, name) already exists are not
 * created again; log rows are matched to items by name, and a log row that
 * was already imported for an existing item is skipped.
 * @returns {{ newItems: object[], movements: object[], problems: string[], duplicates: number }}
 *   movements carry `itemKey` (index into newItems as "new:<i>") or `itemId`.
 */
export function planInventoryImport(parsed, existingItems = [], existingMovements = []) {
  const problems = [...parsed.problems];
  const already = new Set(existingMovements.map(movementKey));
  let duplicates = 0;
  const byCode = new Map(existingItems.filter((i) => i.code).map((i) => [norm(i.code), i]));
  const byName = new Map();
  const addName = (name, ref) => {
    const k = norm(name);
    byName.set(k, byName.has(k) && byName.get(k) !== ref ? "ambiguous" : ref);
  };
  existingItems.forEach((i) => addName(i.name, { itemId: i.id }));

  const pending = [...existingItems];
  const newItems = [];
  for (const it of parsed.items) {
    const existing = (it.code && byCode.get(norm(it.code)))
      || (!it.code && existingItems.find((e) => norm(e.name) === norm(it.name)));
    if (existing) continue;
    const code = it.code || nextItemCode([...pending, ...newItems]);
    const ref = { itemKey: `new:${newItems.length}` };
    newItems.push({ ...it, code });
    byCode.set(norm(code), ref);
    addName(it.name, ref);
  }

  const movements = [];
  for (const m of parsed.movements) {
    const ref = byName.get(norm(m.name));
    if (!ref) { problems.push(`Log entry for "${m.name}" on ${m.date}: no item with that name, skipped`); continue; }
    if (ref === "ambiguous") { problems.push(`Log entry for "${m.name}" on ${m.date}: several items share that name, skipped`); continue; }
    if (ref.itemId && already.has(movementKey({ ...m, itemId: ref.itemId }))) { duplicates++; continue; }
    movements.push({ ...m, ...ref });
  }
  // Oldest first, and stock in before stock out on the same day, so each
  // approval sees the stock it needs.
  movements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.direction === "in" ? -1 : 0) - (b.direction === "in" ? -1 : 0)));
  return { newItems, movements, problems, duplicates };
}
