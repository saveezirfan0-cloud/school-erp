import { summarizeInvoices, collectedByMonth, invoiceCollected, invoiceOutstanding } from "./invoiceTotals";

const inv = (o) => ({ amount: 0, status: "pending", ...o });

describe("invoiceTotals", () => {
  test("fully paid invoice counts its paidAmount", () => {
    const t = summarizeInvoices([inv({ amount: 4000, status: "paid", paidAmount: 4000 })]);
    expect(t).toMatchObject({ billed: 4000, collected: 4000, pending: 0, concessions: 0 });
  });

  test("partial invoice: paid part is collected, balance is pending", () => {
    const t = summarizeInvoices([inv({ amount: 4000, status: "partial", paidAmount: 3500 })]);
    expect(t).toMatchObject({ collected: 3500, pending: 500 });
  });

  test("concession-closed invoice: waived amount is not collected or pending", () => {
    const t = summarizeInvoices([inv({ amount: 4000, status: "paid", paidAmount: 2500, concessionAmount: 1500 })]);
    expect(t).toMatchObject({ collected: 2500, concessions: 1500, pending: 0 });
  });

  test("legacy paid invoice without paidAmount is treated as paid in full", () => {
    expect(invoiceCollected(inv({ amount: 1500, status: "paid" }))).toBe(1500);
    expect(invoiceCollected(inv({ amount: 1500, status: "paid", paidAmount: 0, concessionAmount: 500 }))).toBe(1000);
  });

  test("pending invoice is fully outstanding; pending never negative", () => {
    expect(invoiceOutstanding(inv({ amount: 1500 }))).toBe(1500);
    expect(invoiceOutstanding(inv({ amount: 1000, status: "partial", paidAmount: 1200 }))).toBe(0);
  });

  test("monthly buckets use paidDate, falling back to createdAt; unpaid ignored", () => {
    const months = collectedByMonth([
      inv({ amount: 100, status: "paid", paidAmount: 100, paidDate: "2026-09-10" }),
      inv({ amount: 50, status: "partial", paidAmount: 50, createdAt: "2026-08-02T00:00:00Z" }),
      inv({ amount: 999, status: "pending" }),
    ]);
    expect(months[8]).toBe(100);
    expect(months[7]).toBe(50);
    expect(months.reduce((a, b) => a + b, 0)).toBe(150);
  });
});
