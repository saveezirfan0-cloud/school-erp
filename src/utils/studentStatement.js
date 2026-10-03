// src/utils/studentStatement.js
//
// Parent-facing fee statement: what a student was billed, what was paid and
// what is still owed. Money rules come from utils/reporting.js (invoiceFacts,
// the one definition of paid / outstanding / unverified), so the printout
// agrees with the Student Ledger, Fees, Dashboard and Reports. An invoice
// marked paid with no money recorded is NOT shown as received; it is flagged
// "Marked paid, no payment recorded" so the office can chase it.

import { invoiceFacts, isLive, isEffectiveInvoiceReceipt } from "./reporting";
import { formatDate, toMillis } from "./dates";
import { monthIndex } from "./reportData";

const num = (v) => Number(v) || 0;
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rs = (n) => `Rs. ${Math.round(num(n)).toLocaleString()}`;

const invoiceOrder = (i) => {
  const mi = monthIndex(i.month);
  return mi >= 0 && Number(i.year) ? new Date(Number(i.year), mi, 1).getTime() : toMillis(i.date || i.createdAt);
};

// student: the student row; invoices: that student's invoices; payments: any
// payments (only those against these invoices count); today: "YYYY-MM-DD".
export function buildStatement({ student, invoices, payments, today }) {
  const mine = (invoices || []).filter(isLive);
  const ids = new Set(mine.map((i) => i.id));
  let billed = 0, received = 0, concession = 0, balance = 0, unverified = 0;
  const rows = mine.map((i) => {
    const f = invoiceFacts(i);
    billed += f.billed; received += f.paid; concession += f.concession; balance += f.outstanding; unverified += f.unverified;
    const statusLabel = f.unverified > 0 ? "Marked paid, no payment recorded"
      : f.outstanding <= 0 ? "Paid"
      : f.paid > 0 ? "Partial"
      : (i.dueDate && today && i.dueDate < today ? "Overdue" : "Pending");
    return { ...i, amount: f.billed, paid: f.paid, concession: f.concession, balance: f.outstanding, unverified: f.unverified, statusLabel };
  }).sort((a, b) => invoiceOrder(a) - invoiceOrder(b));
  return {
    student,
    rows,
    payments: (payments || []).filter((p) => ids.has(p.sourceId) && isEffectiveInvoiceReceipt(p))
      .sort((a, b) => toMillis(a.date || a.createdAt) - toMillis(b.date || b.createdAt)),
    billed, received, concession, balance, unverified,
  };
}

// The statements for a set of students, built from flat invoice / payment lists.
export function buildStatements({ students, invoices, payments, today }) {
  const byStudent = new Map();
  for (const i of invoices) {
    if (!byStudent.has(i.studentId)) byStudent.set(i.studentId, []);
    byStudent.get(i.studentId).push(i);
  }
  return students.map(student => buildStatement({ student, invoices: byStudent.get(student.id) || [], payments, today }));
}

export function statementsHtml(statements, { org = "Zohra Majeed Islamic Institute", title = "Fee Statement" } = {}) {
  const pages = statements.map(st => {
    const s = st.student || {};
    const invRows = st.rows.map(r => `<tr>
        <td>${esc(`${r.month || ""} ${r.year || ""}`.trim() || formatDate(r.date || r.createdAt))}</td>
        <td>${esc((r.lineItems || []).map(l => l.description).filter(Boolean).join(", ") || "Fee")}</td>
        <td class="n">${rs(r.amount)}</td><td class="n">${rs(r.paid)}</td>
        <td class="n">${r.concession ? rs(r.concession) : "—"}</td>
        <td class="n"><b>${rs(r.balance)}</b></td><td>${esc(r.statusLabel)}</td></tr>`).join("");
    const payRows = st.payments.map(p => `<tr><td>${esc(formatDate(p.date || p.createdAt))}</td><td>${esc(p.account || "")}</td><td>${esc(p.description || "")}</td><td class="n">${rs(p.amount)}</td></tr>`).join("");
    return `<section class="page">
      <h1>${esc(org)}</h1><h2>${esc(title)}</h2>
      <div class="meta">
        <div><b>${esc(s.name || "Student")}</b> ${s.studentId ? `· ${esc(s.studentId)}` : ""}<br>${esc(s.grade || "")}</div>
        <div>${s.parentName ? `Parent: ${esc(s.parentName)}<br>` : ""}${esc(s.parentPhone || "")}</div>
        <div class="r">Statement date<br><b>${esc(formatDate(new Date()))}</b></div>
      </div>
      <h3>Invoices</h3>
      <table><thead><tr><th>Period</th><th>Details</th><th class="n">Billed</th><th class="n">Paid</th><th class="n">Concession</th><th class="n">Balance</th><th>Status</th></tr></thead>
        <tbody>${invRows || `<tr><td colspan="7" class="muted">No invoices.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="n">${rs(st.billed)}</td><td class="n">${rs(st.received)}</td><td class="n">${rs(st.concession)}</td><td class="n">${rs(st.balance)}</td><td></td></tr></tfoot></table>
      <h3>Payments received</h3>
      <table><thead><tr><th>Date</th><th>Account</th><th>Note</th><th class="n">Amount</th></tr></thead>
        <tbody>${payRows || `<tr><td colspan="4" class="muted">No payments recorded.</td></tr>`}</tbody></table>
      ${st.unverified > 0 ? `<p class="muted">${rs(st.unverified)} is on invoices marked paid with no payment recorded; it is not counted as received.</p>` : ""}
      <div class="due ${st.balance > 0 ? "owing" : "clear"}">${st.balance > 0 ? `Balance due: ${rs(st.balance)}` : "No balance due — thank you."}</div>
      <p class="muted">Computed from the school's fee records. Please contact the office if anything looks wrong.</p>
    </section>`;
  }).join("");

  return `<html><head><title>${esc(title)}</title><style>
    body{font-family:Arial,sans-serif;color:#1e293b;margin:0}
    .page{padding:32px;page-break-after:always} .page:last-child{page-break-after:auto}
    h1{color:#7a2535;font-size:20px;margin:0} h2{font-size:15px;margin:2px 0 16px;color:#475569;font-weight:600}
    h3{font-size:13px;margin:18px 0 6px;color:#7a2535;text-transform:uppercase;letter-spacing:.5px}
    .meta{display:flex;justify-content:space-between;gap:16px;font-size:13px;line-height:1.5;border:1px solid #e2e8f0;border-radius:8px;padding:12px}
    .r{text-align:right} table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#7a2535;color:#fff;text-align:left;padding:7px 8px} td{padding:6px 8px;border-bottom:1px solid #e2e8f0}
    .n{text-align:right;white-space:nowrap} tfoot td{font-weight:700;background:#f8fafc}
    .due{margin-top:18px;padding:12px 16px;border-radius:8px;font-weight:700;font-size:15px}
    .owing{background:#fef2f2;color:#b91c1c}.clear{background:#ecfdf5;color:#047857}
    .muted{color:#94a3b8;font-size:12px}
  </style></head><body>${pages}</body></html>`;
}

// Open a print window with one page per statement.
export function printStatements(statements, opts) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(statementsHtml(statements, opts));
  w.document.close();
  w.print();
  return true;
}
