// src/components/Reports/ClassDrilldown.jsx
// Opens under the "By class / grade" table: every student in the class with
// their balance, the teachers teaching it (from Subjects) and one-click
// printable fee statements for parents.

import React from "react";
import { Printer, X, ExternalLink } from "lucide-react";
import { formatRs } from "../../utils/reportData";
import { formatDate } from "../../utils/dates";
import { Card, DataTable } from "./ReportParts";
import { controlStyle } from "./ReportFilters";

const STATUS = {
  paid: { bg: "#ecfdf5", fg: "#059669", label: "Paid" },
  partial: { bg: "#eff6ff", fg: "#2563eb", label: "Partial" },
  pending: { bg: "#fffbeb", fg: "#d97706", label: "Pending" },
  overdue: { bg: "#fef2f2", fg: "#dc2626", label: "Overdue" },
};

export default function ClassDrilldown({ grade, students, teachers, onClose, onPrint, onOpenLedger }) {
  const owing = students.filter(s => s.outstanding > 0);
  const total = (k) => students.reduce((s, r) => s + r[k], 0);
  return (
    <Card title={`Class: ${grade}`} pad={0} style={{ marginBottom: 24 }}
      subtitle={teachers.length
        ? `Teachers: ${teachers.map(t => (t.subjects.length ? `${t.teacher} (${t.subjects.join(", ")})` : t.teacher)).join(" · ")}`
        : "No teachers linked to this class yet — add them under Subjects."}
      right={
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={!owing.length} onClick={() => onPrint(owing.map(s => s.studentId).filter(Boolean))}
            style={{ ...controlStyle, cursor: owing.length ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6, opacity: owing.length ? 1 : 0.5 }}>
            <Printer size={13} /> Print statements ({owing.length} owing)
          </button>
          <button onClick={onClose} aria-label="Close class view" style={{ ...controlStyle, cursor: "pointer", display: "flex", alignItems: "center" }}><X size={14} /></button>
        </div>
      }>
      <DataTable
        rows={students} rowKey={r => r.key} empty="No invoices for this class in the selected period."
        columns={[
          { key: "student", label: "Student", render: r => <span>{r.student}{r.code && <span style={{ color: "var(--text-muted)" }}> · {r.code}</span>}</span> },
          { key: "phone", label: "Parent phone", render: r => r.phone || "—" },
          { key: "billed", label: "Billed", align: "right", render: r => formatRs(r.billed) },
          { key: "collected", label: "Collected", align: "right", render: r => <span style={{ color: "#10b981" }}>{formatRs(r.collected)}</span> },
          { key: "outstanding", label: "Outstanding", align: "right", render: r => <strong style={{ color: r.outstanding > 0 ? "#f59e0b" : "#64748b" }}>{formatRs(r.outstanding)}</strong> },
          { key: "oldest", label: "Oldest due", render: r => (r.oldestDue ? formatDate(r.oldestDue) : "—") },
          { key: "status", label: "Status", render: r => <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: STATUS[r.status].bg, color: STATUS[r.status].fg }}>{STATUS[r.status].label}</span> },
          {
            key: "act", label: "", align: "right", render: r => r.studentId && (
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button title="Print fee statement" aria-label={`Print statement for ${r.student}`} onClick={() => onPrint([r.studentId])} style={{ ...controlStyle, padding: "4px 8px", cursor: "pointer" }}><Printer size={13} /></button>
                <button title="Open ledger" aria-label={`Open ledger for ${r.student}`} onClick={() => onOpenLedger(r.studentId)} style={{ ...controlStyle, padding: "4px 8px", cursor: "pointer" }}><ExternalLink size={13} /></button>
              </span>
            ),
          },
        ]}
        footer={["Total", "", formatRs(total("billed")), formatRs(total("collected")), formatRs(total("outstanding")), "", "", ""]}
      />
    </Card>
  );
}
