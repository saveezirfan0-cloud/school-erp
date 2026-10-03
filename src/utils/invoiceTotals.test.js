import { sumInvoices, collectedByMonth, invoiceCollected, invoiceOutstanding, invoiceUnverified } from "./invoiceTotals";
import { summarizeInvoices } from "./reporting";

const inv = (o) => ({ amount: 0, status: "pending", ...o });

describe("invoiceTotals", () => {
  test("fully paid invoice counts its paidAmount", () => {
    const t = sumInvoices([inv({ amount: 4000, status: "paid", paidAmount: 4000 })]);
    expect(t).toMatchObject({ billed: 4000, collected: 4000, pending: 0, concessions: 0 });
  });

  test("partial invoice: paid part is collected, balance is pending", () => {
    const t = sumInvoices([inv({ amount: 4000, status: "partial", paidAmount: 3500 })]);
    expect(t).toMatchObject({ collected: 3500, pending: 500 });
  });

  test("concession-closed invoice: waived amount is not collected or pending", () => {
    const t = sumInvoices([inv({ amount: 4000, status: "paid", paidAmount: 2500, concessionAmount: 1500 })]);
    expect(t).toMatchObject({ collected: 2500, concessions: 1500, pending: 0 });
  });

  // DEFINITION CHANGE (audit ACC-04, utils/reporting.js): this used to expect
  // that a paid invoice with no paidAmount counted as collected in full less
  // concession (1500 / 1000). Collected is now cash recorded; the gap is
  // reported as "unverified" (marked paid, no money recorded).
  test("paid invoice with no paidAmount is NOT collected; it is unverified", () => {
    expect(invoiceCollected(inv({ amount: 1500, status: "paid" }))).toBe(0);
    expect(invoiceCollected(inv({ amount: 1500, status: "paid", paidAmount: 0, concessionAmount: 500 }))).toBe(0);
    expect(invoiceUnverified(inv({ amount: 1500, status: "paid" }))).toBe(1500);
    expect(invoiceUnverified(inv({ amount: 1500, status: "paid", paidAmount: 0, concessionAmount: 500 }))).toBe(1000);
    expect(invoiceOutstanding(inv({ amount: 1500, status: "paid" }))).toBe(0);
    const t = sumInvoices([inv({ amount: 1500, status: "paid" }), inv({ amount: 4000, status: "paid", paidAmount: 4000 })]);
    expect(t).toMatchObject({ collected: 4000, pending: 0, unverified: 1500 });
  });

  test("any non-paid status (e.g. overdue) is outstanding, not just pending/partial", () => {
    expect(invoiceOutstanding(inv({ amount: 1000, status: "overdue", paidAmount: 200 }))).toBe(800);
  });

  // The same fixture as reporting.test.js (ACC-04): the old Dashboard said
  // 17,000 collected / 0 pending, old Reports 10,500 / 3,500.
  test("agrees with utils/reporting.js on the ACC-04 fixture (10,500 collected, 3,500 pending)", () => {
    const invoices = [
      { id: "A", amount: 5000, status: "paid", paidAmount: 5000 },
      { id: "B", amount: 5000, status: "paid", paidAmount: 3000, concessionAmount: 2000 },
      { id: "C", amount: 4000, status: "paid" },
      { id: "D", amount: 6000, status: "partial", paidAmount: 2500 },
      { id: "E", amount: 3000, status: "paid" },
    ];
    const t = sumInvoices(invoices);
    const r = summarizeInvoices(invoices, { today: "2026-10-10" });
    expect(t.collected).toBe(10500);
    expect(t.pending).toBe(3500);
    expect(t).toMatchObject({ collected: r.collected, pending: r.outstanding, concessions: r.concessions, unverified: r.unverified });
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
