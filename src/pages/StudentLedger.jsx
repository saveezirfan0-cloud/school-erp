import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, collection, onSnapshot, doc, getDoc } from "../firebase";
import { toMillis, formatDate } from "../utils/dates";
import { ArrowLeft, FileText, TrendingUp, Wallet } from "lucide-react";

// Per-student financial history: every invoice raised, every payment
// received, and the running balance. The single most useful screen
// for answering "what does this student owe?".
export default function StudentLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDoc(doc(db, "students", id)).then((snap) => {
      if (snap.exists()) setStudent({ id: snap.id, ...snap.data() });
    });
    const u1 = onSnapshot(collection(db, "invoices"), (snap) => {
      setInvoices(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.studentId === id));
      setLoading(false);
    });
    const u2 = onSnapshot(collection(db, "payments"), (snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.source === "invoice"));
    });
    return () => { u1(); u2(); };
  }, [id]);

  // Payments linked to THIS student's invoices.
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const studentPayments = payments.filter((p) => invoiceIds.has(p.sourceId));

  const totalBilled = invoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  // net received = cash_in minus any reversals (cash_out tied to invoices)
  const totalReceived = studentPayments
    .filter((p) => !p.reversed)
    .reduce((s, p) => s + (p.type === "cash_in" ? Number(p.amount) : -Number(p.amount)), 0);
  const balance = totalBilled - totalReceived;

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

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>{student?.name || "Student"} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)", fontFamily: "monospace" }}>{student?.studentId}</span></h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{student?.grade} {student?.parentName ? `• Parent: ${student.parentName}` : ""}</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {card("Total Billed", totalBilled, "var(--primary)", FileText)}
        {card("Total Received", totalReceived, "#10b981", TrendingUp)}
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
        Invoices add to what's billed; payments reduce the balance. Reversed payments are shown struck through and don't count.
      </p>
    </div>
  );
}
