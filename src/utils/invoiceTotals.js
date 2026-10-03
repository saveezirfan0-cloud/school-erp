// src/utils/invoiceTotals.js
// Per-invoice money figures for Dashboard, Reports and Fees & Invoices.
//
// This file holds NO definitions of its own: every function delegates to
// utils/reporting.js (invoiceFacts), the single source of truth for what
// "collected", "outstanding", "concession" and "marked paid, no money"
// mean (audit ACC-04). It stays as a thin adapter so existing imports
// keep working. Do not re-implement a formula here.
import { invoiceFacts, invoicePaidDate } from "./reporting";

const num = (v) => Number(v || 0);

// Concession (waived) amount on an invoice.
export function invoiceConcession(inv) {
  return invoiceFacts(inv).concession;
}

// Cash recorded against the invoice (paidAmount). An invoice marked "paid"
// with no money recorded is NOT collected: it is reported separately by
// invoiceUnverified() so it can be chased.
export function invoiceCollected(inv) {
  return invoiceFacts(inv).paid;
}

// Balance still owed: amount - paid - concession for every non-paid status
// (pending, partial, overdue, ...); 0 once the invoice is marked paid.
export function invoiceOutstanding(inv) {
  return invoiceFacts(inv).outstanding;
}

// Marked paid, but paid + concession is less than the amount.
export function invoiceUnverified(inv) {
  return invoiceFacts(inv).unverified;
}

// Date a payment is attributed to for monthly charts; null if unknown.
// paidDate, then the invoice date, then createdAt (local date).
export function invoicePaymentDate(inv) {
  const ymd = invoicePaidDate(inv);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// Totals for a list of invoices:
//   billed      face value of every invoice
//   collected   cash received (includes part-payments on partial invoices)
//   concessions amount waived
//   pending     outstanding balance on every non-paid invoice
//   unverified  marked paid with no (or too little) money recorded
export function sumInvoices(invoices) {
  return invoices.reduce((t, inv) => {
    const f = invoiceFacts(inv);
    t.billed += f.billed;
    t.collected += f.paid;
    t.concessions += f.concession;
    t.pending += f.outstanding;
    t.unverified += f.unverified;
    t.count += 1;
    return t;
  }, { billed: 0, collected: 0, concessions: 0, pending: 0, unverified: 0, count: 0 });
}

// Collected cash per calendar month (index 0 = January) of the payment
// date. NOTE: months of different years merge; prefer
// reporting.monthlySeries (keyed YYYY-MM) for anything spanning years.
export function collectedByMonth(invoices) {
  const months = new Array(12).fill(0);
  for (const inv of invoices) {
    const amt = invoiceCollected(inv);
    if (amt <= 0) continue;
    const d = invoicePaymentDate(inv);
    if (d) months[d.getMonth()] += num(amt);
  }
  return months;
}
