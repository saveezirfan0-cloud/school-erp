import React, { useRef } from "react";
import { X, Printer } from "lucide-react";
import { formatDate } from "../../utils/dates";
import { invoiceCollected, invoiceConcession, invoiceOutstanding } from "../../utils/invoiceTotals";

const money = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const STATUS_COLORS = { Paid: ["#ecfdf5", "#10b981"], Partial: ["#fffbeb", "#d97706"], Overdue: ["#fef2f2", "#ef4444"], Pending: ["#f8fafc", "#64748b"] };

// Same wording the Fees tab uses; falls back to the stored invoice status.
function statusOf(inv, balance, paid) {
  if (balance <= 0) return "Paid";
  if (paid > 0) return "Partial";
  return "Pending";
}

// Invoice details with a printable layout. "Print / Save as PDF" opens the
// browser print dialog (choose "Save as PDF" as the destination).
//   invoice   the invoice row
//   student   optional student row (adds parent / grade to the header)
//   figures   optional { paid, concession, balance, statusLabel } when the
//             caller has already computed them from the payment ledger
//             (student profile); otherwise derived from the invoice itself.
//   payments  optional live payments for this invoice, listed on the document
export default function InvoiceModal({ invoice, student, figures, payments = [], onClose }) {
  const printRef = useRef();
  if (!invoice) return null;

  const amount = Number(invoice.amount || 0);
  const paid = figures ? figures.paid : invoiceCollected(invoice);
  const concession = figures ? figures.concession : invoiceConcession(invoice);
  const balance = figures ? figures.balance : invoiceOutstanding(invoice);
  const status = figures?.statusLabel || statusOf(invoice, balance, paid);
  const [statusBg, statusColor] = STATUS_COLORS[status] || STATUS_COLORS.Pending;
  const period = `${invoice.month || ""} ${invoice.year || ""}`.trim() || "—";
  const invoiceNo = `INV-${String(invoice.id || "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const issued = invoice.date || invoice.createdAt;
  const items = (invoice.lineItems && invoice.lineItems.length)
    ? invoice.lineItems.map((li) => ({ description: li.customDescription || li.description || "Fee", amount: Number(li.amount || 0) }))
    : [{ description: "Fee", amount }];

  const handlePrint = () => {
    // Print from a hidden iframe so popup blockers can't swallow it.
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    const d = iframe.contentWindow.document;
    d.open();
    d.write(`<html><head><title>${invoiceNo}</title>
      <style>@page{margin:14mm}body{font-family:Arial,sans-serif;color:#1e293b;margin:0}table{border-collapse:collapse}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
      </head><body>${printRef.current.innerHTML}</body></html>`);
    d.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  const cell = { padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #e2e8f0" };
  const totalRow = (label, value, opts = {}) => (
    <tr>
      <td style={{ padding: "6px 12px", fontSize: 13, textAlign: "right", color: "#64748b", fontWeight: opts.bold ? 700 : 400 }}>{label}</td>
      <td style={{ padding: "6px 12px", fontSize: opts.bold ? 15 : 13, textAlign: "right", width: 130, fontWeight: opts.bold ? 700 : 600, color: opts.color || "inherit" }}>{value}</td>
    </tr>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 640, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Invoice</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={handlePrint} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Printer size={14} /> Print / Save PDF
            </button>
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
          </div>
        </div>

        {/* Everything inside this div is what gets printed. */}
        <div ref={printRef} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 24, color: "#1e293b", fontFamily: "Arial, sans-serif" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #7a2535", paddingBottom: 14, marginBottom: 18, gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#7a2535" }}>Zohra Majeed Islamic Institute</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>Fee Invoice</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{invoiceNo}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>Issued: {formatDate(issued)}</div>
              <span style={{ display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusBg, color: statusColor }}>{status}</span>
            </div>
          </div>

          <table style={{ width: "100%", marginBottom: 18 }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: "top", width: "50%" }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>Billed to</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{invoice.studentName || student?.name || "—"}</div>
                  {student?.studentId && <div style={{ fontSize: 12, color: "#64748b" }}>ID: {student.studentId}</div>}
                  {student?.grade && <div style={{ fontSize: 12, color: "#64748b" }}>Class: {student.grade}</div>}
                  {(student?.parentName || invoice.parentPhone) && (
                    <div style={{ fontSize: 12, color: "#64748b" }}>Parent: {[student?.parentName, invoice.parentPhone || student?.parentPhone].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td style={{ verticalAlign: "top", width: "50%", textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>Period</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{period}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Due: {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: "100%" }}>
            <thead>
              <tr style={{ background: "#7a2535", color: "white" }}>
                <th style={{ ...cell, textAlign: "left", fontSize: 12, borderBottom: "none" }}>Description</th>
                <th style={{ ...cell, textAlign: "right", fontSize: 12, borderBottom: "none", width: 130 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((li, i) => (
                <tr key={i}>
                  <td style={cell}>{li.description}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{money(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table style={{ width: "100%", marginTop: 6 }}>
            <tbody>
              {totalRow("Total", money(amount), { bold: true })}
              {concession > 0 && totalRow(invoice.concessionNote ? `Concession (${invoice.concessionNote})` : "Concession", `− ${money(concession)}`, { color: "#2563eb" })}
              {totalRow("Paid", money(paid), { color: "#10b981" })}
              {totalRow("Balance due", money(balance), { bold: true, color: balance > 0 ? "#ef4444" : "#10b981" })}
            </tbody>
          </table>

          {payments.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Payments received</div>
              <table style={{ width: "100%" }}>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td style={cell}>{formatDate(p.date || p.createdAt)}</td>
                      <td style={cell}>{p.account || "—"}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{p.type === "cash_in" ? "" : "− "}{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invoice.notes && (
            <div style={{ marginTop: 16, padding: 10, background: "#f8fafc", borderRadius: 6, fontSize: 12, color: "#64748b" }}>Notes: {invoice.notes}</div>
          )}

          <div style={{ marginTop: 36, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8" }}>
            <div>Parent Signature: _______________</div>
            <div>Authorized By: _______________</div>
          </div>
        </div>
      </div>
    </div>
  );
}
