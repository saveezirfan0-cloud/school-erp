// src/utils/invoiceTotals.js
// Single source of truth for invoice money figures. Dashboard, Reports and
// Fees & Invoices all used to compute "collected" / "pending" differently
// (face value vs paidAmount, partial invoices ignored, ...), so the same
// data showed different totals on each screen. Always go through here.
import { toDate } from "./dates";

const num = (v) => Number(v || 0);

// Concession (waived) amount on an invoice.
export function invoiceConcession(inv) {
  return num(inv.concessionAmount);
}

// Money actually received for an invoice.
// Invoices marked "paid" before `paidAmount` was tracked (bulk-created or
// imported) have no recorded amount; treat them as settled in full, less any
// concession, so they are not silently dropped from the totals.
export function invoiceCollected(inv) {
  const paid = num(inv.paidAmount);
  if (inv.status === "paid" && paid <= 0) {
    return Math.max(0, num(inv.amount) - invoiceConcession(inv));
  }
  return paid;
}

// Balance still owed. Only open invoices (pending / partial) have one.
export function invoiceOutstanding(inv) {
  if (inv.status !== "pending" && inv.status !== "partial") return 0;
  return Math.max(0, num(inv.amount) - invoiceCollected(inv) - invoiceConcession(inv));
}

// Date a payment is attributed to for monthly charts; null if unknown.
export function invoicePaymentDate(inv) {
  return toDate(inv.paidDate) || toDate(inv.createdAt) || null;
}

// Totals for a list of invoices:
//   billed      face value of every invoice
//   collected   cash received (includes part-payments on partial invoices)
//   concessions amount waived
//   pending     outstanding balance on pending + partial invoices
export function summarizeInvoices(invoices) {
  return invoices.reduce((t, inv) => {
    t.billed += num(inv.amount);
    t.collected += invoiceCollected(inv);
    t.concessions += invoiceConcession(inv);
    t.pending += invoiceOutstanding(inv);
    t.count += 1;
    return t;
  }, { billed: 0, collected: 0, concessions: 0, pending: 0, count: 0 });
}

// Collected cash per calendar month (index 0 = Jan), by payment date.
export function collectedByMonth(invoices) {
  const months = new Array(12).fill(0);
  for (const inv of invoices) {
    const amt = invoiceCollected(inv);
    if (amt <= 0) continue;
    const d = invoicePaymentDate(inv);
    if (d) months[d.getMonth()] += amt;
  }
  return months;
}
