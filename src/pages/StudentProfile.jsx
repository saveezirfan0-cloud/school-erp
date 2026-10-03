import React, { useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { updateDocs, serverTimestamp } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useDocument, useRelated } from "../hooks/useProfileData";
import { logActivity } from "../utils/auditLog";
import { formatDate, localISODate, durationSince } from "../utils/dates";
import { summarizeInvoices, isLivePayment } from "../utils/fees";
import ProfileShell, { cardStyle, cardHeadStyle } from "../components/Profile/ProfileShell";
import DetailsCard from "../components/Profile/DetailsCard";
import AttendanceTab, { summarize } from "../components/Profile/AttendanceTab";
import NotesTab from "../components/Profile/NotesTab";
import { User, GraduationCap, CalendarCheck, Receipt, StickyNote, Wallet, TrendingUp, FileText } from "lucide-react";

const money = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;


export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { branches } = useBranch();
  const { can } = useUser();
  const canEdit = can("canEditStudents");
  const canSeeFees = can("canViewFees");

  const { record: student, loading, notFound } = useDocument("students", id);
  const { rows: attendance } = useRelated("attendance", { subjectType: "student", subjectId: id });
  const { rows: invoices } = useRelated("invoices", { studentId: id }, canSeeFees);
  // Payments are linked to invoices (source/sourceId), not to the student.
  const { rows: invoicePayments } = useRelated("payments", { source: "invoice" }, canSeeFees);

  const tabs = [
    { key: "contact", label: "Contact", icon: User },
    { key: "admission", label: "Admission", icon: GraduationCap },
    { key: "attendance", label: "Attendance", icon: CalendarCheck },
    ...(canSeeFees ? [{ key: "fees", label: "Fees & Invoices", icon: Receipt }] : []),
    { key: "notes", label: "Notes", icon: StickyNote },
  ];
  const requested = params.get("tab");
  const tab = tabs.some((t) => t.key === requested) ? requested : "contact";
  const setTab = (key) => setParams({ tab: key }, { replace: true });

  const branchName = branches.find((b) => b.id === student?.branchId)?.name || "Main Office";
  const branchOptions = [{ value: "", label: "Main Office" }, ...branches.map((b) => ({ value: b.id, label: b.name }))];

  // Shared with the ledger so the two screens always agree.
  const fees = useMemo(() => {
    const out = summarizeInvoices(invoices, invoicePayments, localISODate());
    out.rows.sort((a, b) => (String(b.createdAt || "") > String(a.createdAt || "") ? 1 : -1));
    out.payments.sort((a, b) => (String(b.date || "") > String(a.date || "") ? 1 : -1));
    return out;
  }, [invoices, invoicePayments]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (notFound) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <p style={{ color: "var(--text-muted)", marginBottom: 12 }}>This student doesn't exist or you don't have access to them.</p>
      <button onClick={() => navigate("/students")} style={{ padding: "9px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "white" }}>Back to students</button>
    </div>
  );

  const save = (changes) => updateDocs("students", [id], { ...changes, updatedAt: serverTimestamp() })
    .then(() => { logActivity("updated", "Students", `${student.name}${student.studentId ? ` (${student.studentId})` : ""}: ${Object.keys(changes).join(", ")}`); });

  const att = summarize(attendance);
  const statusStyle = { Paid: ["#ecfdf5", "#10b981"], Partial: ["#fffbeb", "#d97706"], Overdue: ["#fef2f2", "#ef4444"], Pending: ["#f8fafc", "#64748b"] };

  const contactFields = [
    { key: "name", label: "Full name", required: true },
    { key: "parentName", label: "Parent / guardian" },
    { key: "parentPhone", label: "Parent phone", type: "tel" },
    { key: "altPhone", label: "Alternate phone", type: "tel" },
    { key: "email", label: "Email", type: "email" },
    { key: "emergencyContact", label: "Emergency contact name" },
    { key: "emergencyPhone", label: "Emergency contact phone", type: "tel" },
    { key: "address", label: "Address", type: "textarea", full: true },
  ];
  const admissionFields = [
    { key: "studentId", label: "Student ID", required: true },
    { key: "admissionDate", label: "Admission date", type: "date", format: (v) => (v ? formatDate(v) : "—") },
    { key: "grade", label: "Grade / class" },
    { key: "branchId", label: "Branch", type: "select", options: branchOptions },
    { key: "dob", label: "Date of birth", type: "date", format: (v) => (v ? formatDate(v) : "—") },
    { key: "gender", label: "Gender", type: "select", options: [{ value: "", label: "—" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }] },
    { key: "previousSchool", label: "Previous school" },
    { key: "monthlyFee", label: "Monthly fee (Rs.)", type: "number", format: (v) => money(v) },
    { key: "recurringFee", label: "Auto monthly fees", type: "boolean" },
  ];

  return (
    <ProfileShell
      onBack={() => navigate("/students")} backLabel="Students"
      title={student.name || "Student"}
      subtitle={[student.studentId, student.grade, student.parentName && `Parent: ${student.parentName}`].filter(Boolean).join(" • ")}
      banner={student.deletedAt ? <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>This student is in Trash. Restore them from the Trash page to make them active again.</div> : null}
      badges={[
        { label: branchName },
        student.recurringFee ? { label: "Auto fees", bg: "#ecfdf5", color: "#10b981" } : { label: "Manual fees" },
      ]}
      stats={[
        { label: "Monthly fee", value: money(student.monthlyFee) },
        ...(canSeeFees ? [{ label: "Balance due", value: money(fees.balance), color: fees.balance > 0 ? "#ef4444" : "#10b981" }] : []),
        { label: "Attendance", value: att.rate == null ? "—" : `${att.rate}%` },
      ]}
      tabs={tabs} activeTab={tab} onTab={setTab}
    >
      {tab === "contact" && <DetailsCard title="Contact details" fields={contactFields} record={student} canEdit={canEdit} onSave={save} />}

      {tab === "admission" && (
        <>
          <DetailsCard title="Admission & enrolment" fields={admissionFields} record={student} canEdit={canEdit} onSave={save} />
          <div style={{ ...cardStyle, padding: 16, fontSize: 14 }}>
            <span style={{ color: "var(--text-muted)" }}>Enrolled for: </span>
            <strong>{durationSince(student.admissionDate)}</strong>
            {!student.admissionDate && <span style={{ color: "var(--text-muted)" }}> — set an admission date above</span>}
          </div>
        </>
      )}

      {tab === "attendance" && <AttendanceTab subjectType="student" subject={student} records={attendance} canEdit={canEdit} />}

      {tab === "fees" && canSeeFees && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              ["Total billed", fees.billed, "var(--primary)", FileText],
              ["Total received", fees.received, "#10b981", TrendingUp],
              ...(fees.concession > 0 ? [["Concession", fees.concession, "#2563eb", Receipt]] : []),
              ["Balance due", fees.balance, fees.balance > 0 ? "#ef4444" : "#10b981", Wallet],
            ].map(([label, value, color, Icon]) => (
              <div key={label} style={{ flex: 1, minWidth: 150, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}><Icon size={15} /> {label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{money(value)}</div>
              </div>
            ))}
          </div>

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={cardHeadStyle}>
              <span>Invoices ({fees.rows.length})</span>
              <button onClick={() => navigate(`/students/${id}/ledger`)} style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Full ledger</button>
            </div>
            {fees.rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>No invoices yet.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    {["Period", "Amount", "Paid", "Balance", "Due", "Status"].map((h) => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{fees.rows.map((r) => {
                    const [bg, color] = statusStyle[r.statusLabel];
                    return (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500 }}>{`${r.month || ""} ${r.year || ""}`.trim() || "—"}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{money(r.amount)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#10b981" }}>{money(r.paid)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{money(r.balance)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                        <td style={{ padding: "10px 14px" }}><span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color }}>{r.statusLabel}</span></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={cardHeadStyle}>Payments received ({fees.payments.filter(isLivePayment).length})</div>
            {fees.payments.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>No payments yet.</div> : fees.payments.map((p) => {
              const struck = p.reversed || p.reversalOf;
              return (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--border)", opacity: struck ? 0.5 : 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, textDecoration: p.reversed ? "line-through" : "none" }}>{p.description || "Fee payment"}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(p.date)} • {p.account}{p.reversalOf ? " • reversal" : p.reversed ? " • reversed" : ""}</div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", color: p.type === "cash_in" ? "#10b981" : "#ef4444" }}>{p.type === "cash_in" ? "+" : "−"} {money(p.amount)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "notes" && <NotesTab collectionName="students" moduleLabel="Students" record={student} canEdit={canEdit} />}
    </ProfileShell>
  );
}
