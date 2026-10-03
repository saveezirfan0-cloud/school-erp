// src/utils/invoiceGenerator.js
//
// Printable, numbered fee receipts (FEAT-003).
//
// buildReceiptHtml() is a PURE function that returns a complete HTML
// document as a string. EVERY dynamic value is HTML-escaped (names,
// descriptions, notes, numbers, dates), and the document carries a
// restrictive Content-Security-Policy meta tag with no script allowed,
// so a hostile student name can never run code in the print window.
//
// RECEIPT NUMBERS
// There is no database sequence yet, so the number is derived from
// data that already exists and never changes:
//
//     <BRANCH PREFIX>-<YYYYMMDD of the payment>-<first 8 chars of the payment id>
//     e.g.  MAIN-20261003-3F9A1C7B
//
// It is deterministic (reprinting the same payment always gives the
// same number), needs no write, and cannot collide across devices
// because it embeds the unique payment id. It is NOT gap-free: proper
// gap-checkable sequences need a per-branch counter in the database
// (see ACC-20); when that exists, pass it as `receiptNo` and this
// function prints it unchanged.

import { formatMoney, subMoney } from "./money";

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

// Escape any value for safe placement in HTML text OR an attribute.
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
}

// "Main Office" -> "MAIN", "Lahore Campus" -> "LAHO", "" -> "MAIN".
export function receiptPrefix(branchName) {
  const first = String(branchName || "").trim().split(/\s+/)[0] || "";
  const clean = first.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
  return clean || "MAIN";
}

/**
 * @param {object} p
 * @param {string} [p.branchName]  used for the prefix ("" = main branch)
 * @param {string} p.date          payment date, YYYY-MM-DD
 * @param {string} p.id            payment id (unique)
 */
export function buildReceiptNumber({ branchName = "", date, id }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Receipt date must be YYYY-MM-DD");
  const short = String(id || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  if (short.length < 4) throw new Error("A payment id is required to number a receipt");
  return `${receiptPrefix(branchName)}-${date.replace(/-/g, "")}-${short}`;
}

const row = (label, value) =>
  `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;

/**
 * Build the receipt document.
 *
 * @param {object} r
 * @param {string} r.receiptNo
 * @param {string} [r.institute]
 * @param {string} [r.branchName]
 * @param {string} r.date           payment date
 * @param {string} r.studentName
 * @param {string} [r.studentId]
 * @param {string} [r.period]       e.g. "March 2026"
 * @param {string} [r.description]
 * @param {number|string} r.amount  amount received on this receipt
 * @param {string} [r.account]      "Cash in Hand", "Meezan Bank" ...
 * @param {number|string} [r.invoiceTotal]
 * @param {number|string} [r.paidToDate]
 * @param {number|string} [r.balance]
 * @param {string} [r.printedOn]    date printed, YYYY-MM-DD
 * @returns {string} full HTML document
 */
export function buildReceiptHtml(r) {
  const rows = [
    row("Receipt no.", r.receiptNo),
    row("Date received", r.date),
    row("Received from", r.studentName),
  ];
  if (r.studentId) rows.push(row("Student ID", r.studentId));
  if (r.branchName) rows.push(row("Branch", r.branchName));
  if (r.period) rows.push(row("Fee period", r.period));
  if (r.description) rows.push(row("Description", r.description));
  if (r.account) rows.push(row("Received into", r.account));

  const hasInvoice = r.invoiceTotal !== undefined && r.invoiceTotal !== null && r.invoiceTotal !== "";
  const summary = hasInvoice
    ? `<table class="summary">
        ${row("Invoice total", "Rs. " + formatMoney(r.invoiceTotal))}
        ${row("Paid to date", "Rs. " + formatMoney(r.paidToDate))}
        ${row("Balance on invoice", "Rs. " + formatMoney(r.balance))}
      </table>
      <p class="note">Invoice figures are as of ${escapeHtml(r.printedOn || "")}.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml("Receipt " + (r.receiptNo || ""))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 32px; }
  .receipt { max-width: 560px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 28px; }
  h1 { font-size: 20px; margin: 0; color: #7a2535; text-align: center; }
  .sub { text-align: center; color: #64748b; font-size: 13px; margin: 4px 0 18px; }
  h2 { font-size: 15px; text-align: center; letter-spacing: 2px; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; font-size: 14px; text-align: left; }
  th { background: #f8fafc; width: 40%; font-weight: 600; }
  .total th, .total td { background: #7a2535; color: #fff; font-size: 16px; font-weight: 700; }
  .note { color: #64748b; font-size: 12px; margin: 0 0 14px; }
  .sign { display: flex; justify-content: space-between; margin-top: 36px; font-size: 13px; color: #64748b; }
  @media print { body { padding: 0; } .receipt { border: none; } }
</style>
</head>
<body>
<div class="receipt">
  <h1>${escapeHtml(r.institute || "Zohra Majeed Islamic Institute")}</h1>
  <div class="sub">Fee receipt</div>
  <h2>RECEIPT</h2>
  <table>
    ${rows.join("\n    ")}
    <tr class="total"><th scope="row">Amount received</th><td>${escapeHtml("Rs. " + formatMoney(r.amount))}</td></tr>
  </table>
  ${summary}
  <div class="sign"><span>Received by: ____________</span><span>Parent / guardian: ____________</span></div>
</div>
</body>
</html>`;
}

// Gather the receipt fields from a payment row, its invoice (if it
// could be read) and the branch list. Pure: no I/O.
export function receiptFromPayment({ payment, invoice, branches = [], institute, printedOn }) {
  const branchName = (branches.find((b) => b.id === payment.branchId) || {}).name || "";
  const receiptNo = buildReceiptNumber({ branchName, date: payment.date, id: payment.id });
  const studentName = invoice?.studentName
    || String(payment.description || "").replace(/^Fee\s*[—-]\s*/, "").replace(/\s*\([^)]*\)\s*$/, "")
    || "Student";
  const period = invoice ? [invoice.month, invoice.year].filter(Boolean).join(" ") : "";
  const out = {
    receiptNo, institute, branchName, date: payment.date, studentName,
    period, description: invoice ? "" : payment.description,
    amount: payment.amount, account: payment.account, printedOn,
  };
  if (invoice && invoice.amount !== undefined) {
    const total = Number(invoice.amount) || 0;
    const paid = Number(invoice.paidAmount) || 0;
    const conc = Number(invoice.concessionAmount) || 0;
    out.invoiceTotal = total;
    out.paidToDate = paid;
    out.balance = Math.max(0, subMoney(subMoney(total, paid), conc));
  }
  return out;
}

// Open the receipt in a print window. Returns false if the browser
// blocked the pop-up (the caller should tell the user).
export function openPrintWindow(html) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
