import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, supabase, doc, getDoc, isHistoryVisible } from "../firebase";
import { toMillis, formatDate } from "../utils/dates";
import { studentName } from "../utils/studentLabel";
import { decodeRow, studentStatement, invoiceFacts, isEffectiveInvoiceReceipt } from "../utils/reporting";
import { DataWarnings } from "../components/ReportControls";
import { ArrowLeft, FileText, TrendingUp, Wallet, Percent, AlertTriangle, RefreshCw } from "lucide-react";

// Per-student financial history: every invoice raised, every payment
// received, and the running balance. The single most useful screen
// for answering "what does this student owe?".
//
// Only THIS student's rows are queried (not whole tables), so the
// platform's 1000-row cap cannot truncate a ledger. The figures use the
// shared definitions in utils/reporting.js, so they agree with the
// Dashboard, Reports and Fees pages.
export default function StudentLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    // Direct queries bypass the firebase.js shim, so apply its History scope
    // here: imported (historical) rows stay hidden unless the toggle is on.
    const showHistory = isHistoryVisible();
    const inScope = (r) => showHistory || r.historical !== true; // applied to invoices; payments follow their invoice
    const errs = {};
    try {
      const snap = await getDoc(doc(db, "students", id));
      if (snap.exists()) setStudent({ id: snap.id, ...snap.data() });
    } catch (e) { console.error("StudentLedger student error:", e); errs.students = e?.message || "Could not load"; }

    let inv = [];
    try {
      const { data, error } = await supabase.from("invoices").select("*").eq("student_id", id).is("deleted_at", null);
      if (error) throw error;
      inv = (data || []).map(decodeRow).filter(inScope);
    } catch (e) { console.error("StudentLedger invoices error:", e); errs.invoices = e?.message || "Could not load"; }
    setInvoices(inv);

    // Payments for these invoices only, in chunks to keep the URL short.
    const pays = [];
    try {
      const ids = inv.map((i) => i.id);
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await supabase.from("payments").select("*")
          .eq("source", "invoice").in("source_id", ids.slice(i, i + 50)).is("deleted_at", null);
        if (error) throw error;
        pays.push(...(data || []).map(decodeRow)); // scoped by the invoices already kept above
      }
    } catch (e) { console.error("StudentLedger payments error:", e); errs.payments = e?.message || "Could not load"; }
    setPayments(pays);
    setErrors(errs);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const st = useMemo(() => studentStatement(invoices, payments), [invoices, payments]);
  const name = student ? studentName(student) : (invoices.find((i) => i.studentName)?.studentName || "Student");

  // Build a combined, dated timeline of invoices and payments.
  const events = [
    ...invoices.map((i) => {
      const f = invoiceFacts(i);
      const notes = [(i.lineItems || []).map((l) => l.description).join(", ") || "Fee"];
      if (f.concession > 0) notes.push(`concession Rs. ${f.concession.toLocaleString()}`);
      if (f.unverified > 0) notes.push(`marked paid, no money recorded (Rs. ${f.unverified.toLocaleString()})`);
      else if (f.outstanding > 0) notes.push(`Rs. ${f.outstanding.toLocaleString()} outstanding`);
      return {
        kind: "invoice", date: i.date || i.createdAt, label: `Invoice — ${i.month || ""} ${i.year || ""}`.trim(),
        detail: notes.join(" · "), amount: Number(i.amount || 0), id: i.id,
      };
    }),
    ...payments.map((p) => ({
      kind: p.reversed ? "reversed" : (p.type === "cash_in" ? "payment" : "reversal"),
      date: p.date || p.createdAt,
      label: p.type === "cash_in" ? `Payment — ${p.account || ""}` : `Reversal — ${p.account || ""}`,
      detail: p.description || "", amount: Number(p.amount || 0), id: p.id, reversed: p.reversed,
      counted: isEffectiveInvoiceReceipt(p),
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
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>{name} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)", fontFamily: "monospace" }}>{student?.studentId}</span></h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{student?.grade} {student?.parentName ? `• Parent: ${student.parentName}` : ""}</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {card("Total Billed", st.billed, "var(--primary)", FileText)}
        {st.concessions > 0 && card("Concessions", st.concessions, "#f59e0b", Percent)}
        {card("Total Received", st.received, "#10b981", TrendingUp)}
        {card("Balance Due", st.outstanding, st.outstanding > 0 ? "#ef4444" : "#10b981", Wallet)}
      </div>
      {st.unverified > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginBottom: 16, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Rs. {st.unverified.toLocaleString()} is on invoices marked paid with no money recorded against them. It is not counted as received.</span>
        </div>
      )}
      {st.ledgerGap > 0.5 && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginBottom: 16, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Invoices record Rs. {st.received.toLocaleString()} received, but only Rs. {st.postedToLedger.toLocaleString()} is in Bank &amp; Cash. The difference has no ledger entry.</span>
        </div>
      )}
      {student?.historical === true && !isHistoryVisible() && (
        <div style={{ padding: "10px 14px", marginBottom: 16, borderRadius: 10, background: "#f8fafc", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
          This is an imported historical record. Its invoices and payments are hidden while History is off, so the figures below show as empty. Turn on History in the top bar to see them.
        </div>
      )}
      <DataWarnings errors={errors} />

      <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Statement
          <button onClick={load} disabled={loading} title="Reload" style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: "white", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices or payments yet.</div>
        ) : (
          events.map((e) => (
            <div key={e.kind + e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", opacity: e.kind !== "invoice" && !e.counted ? 0.5 : 1 }}>
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
        Invoices add to what's billed; payments reduce the balance. Reversed payments and their reversing entries are shown faded and cancel out. Concessions forgive part of an invoice's balance. Balance due counts only invoices that are not marked paid.
      </p>
    </div>
  );
}
