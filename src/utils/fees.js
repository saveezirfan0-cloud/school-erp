// src/utils/fees.js
//
// One place for "what has this student been billed, paid and still owes".
// Used by the student ledger and the student profile's Fees tab so the two
// can never disagree.
//
// Money rules (they match getSourcePaidTotal in accounting.js):
//   - cash_in adds to what was received, cash_out (a refund) subtracts.
//   - A payment that was reversed is flagged `reversed`, and its undo is a
//     separate row carrying `reversalOf`. Both are ignored: together they net
//     to zero, so counting the reversal row on top of skipping the original
//     would wrongly subtract the money twice.
//   - A concession forgives the remaining balance on an invoice, so it
//     reduces what is owed without being a payment.

// A payment that counts toward "received".
export const isLivePayment = (p) => !p.reversed && !p.reversalOf;

// Signed amount a live payment contributes (0 for reversed/reversal rows).
export const netAmount = (p) =>
  !isLivePayment(p) ? 0 : (p.type === "cash_in" ? Number(p.amount || 0) : -Number(p.amount || 0));

// invoices: the student's invoice rows. payments: any payment rows; only
// those whose sourceId is one of these invoices are counted.
// today: "YYYY-MM-DD", used to flag overdue invoices.
export function summarizeInvoices(invoices, payments, today) {
  const ids = new Set(invoices.map((i) => i.id));
  const mine = payments.filter((p) => ids.has(p.sourceId));

  const paidBy = {};
  for (const p of mine) paidBy[p.sourceId] = (paidBy[p.sourceId] || 0) + netAmount(p);

  const rows = invoices.map((i) => {
    const amount = Number(i.amount || 0);
    const paid = paidBy[i.id] || 0;
    const concession = Number(i.concessionAmount || 0);
    const balance = Math.max(0, amount - paid - concession);
    const statusLabel = balance <= 0 ? "Paid"
      : paid > 0 ? "Partial"
      : (i.dueDate && today && i.dueDate < today ? "Overdue" : "Pending");
    return { ...i, amount, paid, concession, balance, statusLabel };
  });

  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  return {
    rows,
    payments: mine,
    billed: sum("amount"),
    received: sum("paid"),
    concession: sum("concession"),
    balance: sum("balance"),
  };
}
