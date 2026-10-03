import React, { useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { updateDocs, serverTimestamp } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useDocument, useRelated } from "../hooks/useProfileData";
import { logActivity } from "../utils/auditLog";
import { formatDate, durationSince } from "../utils/dates";
import ProfileShell, { cardStyle, cardHeadStyle } from "../components/Profile/ProfileShell";
import DetailsCard from "../components/Profile/DetailsCard";
import AttendanceTab, { summarize } from "../components/Profile/AttendanceTab";
import NotesTab from "../components/Profile/NotesTab";
import { User, Briefcase, CalendarCheck, Banknote, StickyNote, Wallet, TrendingUp } from "lucide-react";

const money = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];


export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { branches } = useBranch();
  const { can } = useUser();
  const canEdit = can("canEditEmployees");
  const canSeePayslips = can("canViewPayslips");

  const { record: emp, loading, notFound } = useDocument("employees", id);
  const { rows: attendance } = useRelated("attendance", { subjectType: "employee", subjectId: id });
  const { rows: payslips } = useRelated("payslips", { employeeId: id }, canSeePayslips);

  const tabs = [
    { key: "contact", label: "Contact", icon: User },
    { key: "employment", label: "Employment", icon: Briefcase },
    { key: "attendance", label: "Attendance", icon: CalendarCheck },
    ...(canSeePayslips ? [{ key: "payslips", label: "Payslips", icon: Banknote }] : []),
    { key: "notes", label: "Notes", icon: StickyNote },
  ];
  const requested = params.get("tab");
  const tab = tabs.some((t) => t.key === requested) ? requested : "contact";
  const setTab = (key) => setParams({ tab: key }, { replace: true });

  const branchName = branches.find((b) => b.id === emp?.branchId)?.name || "Main Office";
  const branchOptions = [{ value: "", label: "Main Office" }, ...branches.map((b) => ({ value: b.id, label: b.name }))];

  const pay = useMemo(() => {
    const rows = payslips.map((p) => ({ ...p, net: Number(p.netPay || 0), paid: p.status === "paid" }))
      .sort((a, b) => (Number(b.year) - Number(a.year)) || (MONTHS.indexOf(b.month) - MONTHS.indexOf(a.month)));
    return {
      rows,
      paid: rows.filter((r) => r.paid).reduce((s, r) => s + r.net, 0),
      pending: rows.filter((r) => !r.paid).reduce((s, r) => s + r.net, 0),
    };
  }, [payslips]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (notFound) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <p style={{ color: "var(--text-muted)", marginBottom: 12 }}>This employee doesn't exist or you don't have access to them.</p>
      <button onClick={() => navigate("/employees")} style={{ padding: "9px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "white" }}>Back to employees</button>
    </div>
  );

  const save = (changes) => updateDocs("employees", [id], { ...changes, updatedAt: serverTimestamp() })
    .then(() => { logActivity("updated", "Employees", `${emp.name}${emp.role ? ` — ${emp.role}` : ""}: ${Object.keys(changes).join(", ")}`); });

  const att = summarize(attendance);

  const contactFields = [
    { key: "name", label: "Full name", required: true },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "altPhone", label: "Alternate phone", type: "tel" },
    { key: "email", label: "Email", type: "email" },
    { key: "cnic", label: "CNIC / national ID" },
    { key: "emergencyContact", label: "Emergency contact name" },
    { key: "emergencyPhone", label: "Emergency contact phone", type: "tel" },
    { key: "address", label: "Address", type: "textarea", full: true },
  ];
  const employmentFields = [
    { key: "role", label: "Role / position" },
    { key: "joinDate", label: "Join date", type: "date", format: (v) => (v ? formatDate(v) : "—") },
    { key: "branchId", label: "Branch", type: "select", options: branchOptions },
    { key: "employmentType", label: "Employment type", type: "select", options: ["", "Full-time", "Part-time", "Contract"].map((v) => ({ value: v, label: v || "—" })) },
    { key: "qualification", label: "Qualification" },
    { key: "salary", label: "Monthly salary (Rs.)", type: "number", format: (v) => money(v) },
    { key: "recurringPayslip", label: "Auto monthly payslip", type: "boolean" },
  ];

  return (
    <ProfileShell
      onBack={() => navigate("/employees")} backLabel="Employees"
      title={emp.name || "Employee"}
      subtitle={[emp.role, emp.phone, emp.email].filter(Boolean).join(" • ")}
      banner={emp.deletedAt ? <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>This employee is in Trash. Restore them from the Trash page to make them active again.</div> : null}
      badges={[
        { label: branchName },
        emp.recurringPayslip ? { label: "Auto payslip", bg: "#ecfdf5", color: "#10b981" } : { label: "Manual payslip" },
      ]}
      stats={[
        { label: "Monthly salary", value: money(emp.salary) },
        { label: "Attendance", value: att.rate == null ? "—" : `${att.rate}%` },
        { label: "With us", value: durationSince(emp.joinDate) },
      ]}
      tabs={tabs} activeTab={tab} onTab={setTab}
    >
      {tab === "contact" && <DetailsCard title="Contact details" fields={contactFields} record={emp} canEdit={canEdit} onSave={save} />}
      {tab === "employment" && <DetailsCard title="Employment & pay" fields={employmentFields} record={emp} canEdit={canEdit} onSave={save} />}
      {tab === "attendance" && <AttendanceTab subjectType="employee" subject={emp} records={attendance} canEdit={canEdit} />}

      {tab === "payslips" && canSeePayslips && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              ["Total paid", pay.paid, "#10b981", TrendingUp],
              ["Pending", pay.pending, pay.pending > 0 ? "#d97706" : "#10b981", Wallet],
            ].map(([label, value, color, Icon]) => (
              <div key={label} style={{ flex: 1, minWidth: 150, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}><Icon size={15} /> {label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{money(value)}</div>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <div style={cardHeadStyle}>
              <span>Payslips ({pay.rows.length})</span>
              <button onClick={() => navigate("/payslips")} style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Open Payslips</button>
            </div>
            {pay.rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>No payslips yet.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    {["Period", "Basic", "Allowances", "Deductions", "Net pay", "Status"].map((h) => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{pay.rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500 }}>{`${r.month || ""} ${r.year || ""}`.trim() || "—"}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>{money(r.basicSalary)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>{money(r.allowances)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>{money(r.deductions)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{money(r.net)}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: r.paid ? "#ecfdf5" : "#fffbeb", color: r.paid ? "#10b981" : "#d97706" }}>
                          {r.paid ? `Paid${r.paidDate ? ` ${formatDate(r.paidDate)}` : ""}` : "Pending"}
                        </span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "notes" && <NotesTab collectionName="employees" moduleLabel="Employees" record={emp} canEdit={canEdit} />}
    </ProfileShell>
  );
}
