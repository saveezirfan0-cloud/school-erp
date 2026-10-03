import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, doc, getDoc } from "../firebase";
import { useRelated } from "../hooks/useProfileData";
import { toMillis, formatDate, localISODate } from "../utils/dates";
import { summarizeInvoices } from "../utils/fees";
import { buildStatement, printStatements } from "../utils/studentStatement";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, TrendingUp, Wallet, Printer } from "lucide-react";

// Per-student financial history: every invoice raised, every payment
// received, and the running balance. The single most useful screen
// for answering "what does this student owe?".
export default function StudentLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);

  useEffect(() => {
    getDoc(doc(db, "students", id)).then((snap) => {
      if (snap.exists()) setStudent({ id: snap.id, ...snap.data() });
    });
  }, [id]);

  // Only this student's invoices, and only the payments made against them.
  const { rows: invoices, loading: loadingInvoices } = useRelated("invoices", { studentId: id });
  const invoiceIds = useMemo(() => invoices.map((i) => i.id), [invoices]);
  const { rows: payments } = useRelated("payments", { sourceId: invoiceIds, source: "invoice" }, invoiceIds.length > 0);
  const loading = loadingInvoices;

  // Same money rules as the student profile's Fees tab (see utils/fees.js).
  const { billed: totalBilled, received: totalReceived, concession: totalConcession, balance, payments: studentPayments } =
    summarizeInvoices(invoices, payments, localISODate());

  // Build a combined, dated timeline of invoices and payments.
  const events = [
    ...invoices.map((i) => ({
      kind: "invoice", date: i.date || i.createdAt, label: `Invoice — ${i.month || ""} ${i.year || ""}`.trim(),
      detail: (i.lineItems || []).map((l) => l.description).join(", ") || "Fee", amount: Number(i.amount || 0), id: i.id,
    })),
    ...studentPayments.map((p) => ({
      kind: p.reversed ? "reversed" : (p.type === "cash_in" ? "payment" : "reversal"),
      date: p.date || p.createdAt,
      label: p.type === "cash_in" ? `Payment — ${p.account || ""}` : `Reversal — ${p.account || ""}`,
      detail: p.description || "", amount: Number(p.amount || 0), id: p.id, reversed: p.reversed,
    })),
  ].sort((a, b) => toMillis(a.date) - toMillis(b.date));

  const card = (label, value, color, Icon) => (
    <div style={{ flex: 1, minWidth: 150, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}>
        <Icon size={15} /> {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>Rs. {value.toLocaleString()}</div>
    </div>
  );

  return (
    <div>
      <button onClick={() => navigate(-1)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{student?.name || "Student"} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)", fontFamily: "monospace" }}>{student?.studentId}</span></h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{student?.grade} {student?.parentName ? `• Parent: ${student.parentName}` : ""}</div>
        </div>
        <button disabled={!student || loading}
          onClick={() => {
            const statement = buildStatement({ student, invoices, payments: studentPayments, today: localISODate() });
            if (!printStatements([statement])) toast.error("Allow pop-ups to print the statement");
          }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}>
          <Printer size={14} /> Print statement
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {card("Total Billed", totalBilled, "var(--primary)", FileText)}
        {card("Total Received", totalReceived, "#10b981", TrendingUp)}
        {totalConcession > 0 && card("Concession", totalConcession, "#2563eb", FileText)}
        {card("Balance Due", balance, balance > 0 ? "#ef4444" : "#10b981", Wallet)}
      </div>

      <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Statement</div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices or payments yet.</div>
        ) : (
          events.map((e) => (
            <div key={e.kind + e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", opacity: e.reversed ? 0.5 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, textDecoration: e.reversed ? "line-through" : "none" }}>{e.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(e.date)} {e.detail ? `• ${e.detail}` : ""}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap",
                color: e.kind === "invoice" ? "var(--primary)" : e.kind === "payment" ? "#10b981" : "#ef4444" }}>
                {e.kind === "invoice" ? "+" : e.kind === "payment" ? "−" : "+"} Rs. {e.amount.toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
        Invoices add to what's billed; payments reduce the balance. Reversed payments (and their reversal entries) are shown for the record but don't count. Concessions forgive part of an invoice's balance.
      </p>
    </div>
  );
}
