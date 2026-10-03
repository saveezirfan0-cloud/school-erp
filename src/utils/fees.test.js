import { summarizeInvoices } from "./fees";

const inv = (id, amount, extra = {}) => ({ id, amount, ...extra });
const pay = (sourceId, amount, extra = {}) => ({ id: `p${Math.random()}`, sourceId, amount, type: "cash_in", ...extra });

test("received is the sum of live payments and balance is billed minus received", () => {
  const s = summarizeInvoices([inv("a", 2000), inv("b", 3000)], [pay("a", 2000), pay("b", 1000)]);
  expect(s.billed).toBe(5000);
  expect(s.received).toBe(3000);
  expect(s.balance).toBe(2000);
  expect(s.rows.map((r) => r.statusLabel)).toEqual(["Paid", "Partial"]);
});

test("a reversed payment and its reversal row cancel out instead of double-counting", () => {
  // Original payment flagged reversed, plus the opposite cash_out entry that
  // reversePayment() posts. Net effect on the student must be zero.
  const payments = [
    pay("a", 2000, { reversed: true }),
    pay("a", 2000, { type: "cash_out", reversalOf: "orig" }),
  ];
  const s = summarizeInvoices([inv("a", 2000)], payments);
  expect(s.received).toBe(0);
  expect(s.balance).toBe(2000);
});

test("a re-taken payment after a reversal counts once", () => {
  const payments = [
    pay("a", 2000, { reversed: true }),
    pay("a", 2000, { type: "cash_out", reversalOf: "orig" }),
    pay("a", 2000),
  ];
  const s = summarizeInvoices([inv("a", 2000)], payments);
  expect(s.received).toBe(2000);
  expect(s.balance).toBe(0);
});

test("a concession closes the remaining balance", () => {
  const s = summarizeInvoices([inv("a", 2000, { concessionAmount: 500 })], [pay("a", 1500)]);
  expect(s.concession).toBe(500);
  expect(s.balance).toBe(0);
  expect(s.rows[0].statusLabel).toBe("Paid");
});

test("payments for other invoices are ignored", () => {
  const s = summarizeInvoices([inv("a", 2000)], [pay("a", 500), pay("zzz", 9999)]);
  expect(s.received).toBe(500);
  expect(s.payments).toHaveLength(1);
});

test("unpaid invoices are Overdue only once past their due date", () => {
  const rows = summarizeInvoices(
    [inv("a", 100, { dueDate: "2026-01-01" }), inv("b", 100, { dueDate: "2026-12-01" }), inv("c", 100)], [], "2026-06-01"
  ).rows;
  expect(rows.map((r) => r.statusLabel)).toEqual(["Overdue", "Pending", "Pending"]);
});
