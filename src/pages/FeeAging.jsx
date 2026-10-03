// Fee aging and defaulters (FEAT-001).
//
// Who owes what, and for how long: outstanding fee balances per student
// in 0-30 / 31-60 / 61-90 / 90+ day buckets counted from the due date.
// Balance = amount - paid - concession for every invoice that is not
// marked paid (partial invoices included), using the same definitions
// as the Dashboard and Reports (utils/reporting.js). Respects the
// branch selector; CSV export needs the canExport permission.

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Clock } from "lucide-react";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useReportData } from "../hooks/useReportData";
import { DataWarnings, money } from "../components/ReportControls";
import { exportToCSV } from "../utils/exportUtils";
import { AGING_BUCKETS, buildAging, todayLocal } from "../utils/reporting";

const COLLECTIONS = ["invoices", "students"];
const BUCKET_COLOR = { current: "#64748b", d0_30: "#f59e0b", d31_60: "#ea580c", d61_90: "#dc2626", d90plus: "#991b1b" };
const field = { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" };
const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "10px 12px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
const num = { ...td, textAlign: "right" };

export default function FeeAging() {
  const { activeBranch, branches } = useBranch();
  const { can } = useUser();
  const { data, loading, capped, errors } = useReportData(COLLECTIONS);
  const [search, setSearch] = useState("");
  const [minDays, setMinDays] = useState("overdue");
  const [includeCurrent, setIncludeCurrent] = useState(false);

  const today = todayLocal();
  const branchName = (id) => (!id || id === "main" ? "Main Office" : branches.find((b) => b.id === id)?.name || id);
  const scopeName = activeBranch === "all" ? "all branches" : branchName(activeBranch);

  const aging = useMemo(
    () => buildAging(data.invoices || [], data.students || [], { branch: activeBranch, today }),
    [data, activeBranch, today]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const floor = minDays === "overdue" ? null : Number(minDays);
    return aging.rows.filter((r) => {
      if (!includeCurrent && r.overdueTotal <= 0) return false;
      if (floor !== null && r.oldestDays < floor) return false;
      if (!q) return true;
      return [r.name, r.studentCode, r.grade, r.phone, r.parentName].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [aging, search, minDays, includeCurrent]);

  const shownTotal = rows.reduce((s, r) => s + r.total, 0);
  const overdueTotal = aging.total - aging.totals.current;

  const handleCSV = () => exportToCSV(`fee-aging-${today}`,
    ["Student", "Student ID", "Grade", "Branch", "Parent", "Parent phone", ...AGING_BUCKETS.map((b) => b.label), "Total outstanding", "Days past due (oldest)", "Open invoices", "Due date estimated"],
    rows.map((r) => [r.name, r.studentCode, r.grade, branchName(r.branchId), r.parentName, r.phone,
      ...AGING_BUCKETS.map((b) => r.buckets[b.key]), r.total, Math.max(0, r.oldestDays), r.invoiceCount, r.estimatedDue ? "yes" : ""]));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Clock size={20} /> Fee Aging &amp; Defaulters</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Outstanding fees by days past due date for {scopeName}, as of {today}.
          </p>
        </div>
        {can("canExport") && rows.length > 0 && (
          <button onClick={handleCSV} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}>
            <Download size={14} /> CSV
          </button>
        )}
      </div>

      <DataWarnings capped={capped} errors={errors} />

      {loading ? (
        <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            {AGING_BUCKETS.map((b) => (
              <div key={b.key} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{b.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: BUCKET_COLOR[b.key] }}>{money(aging.totals[b.key])}</div>
              </div>
            ))}
            <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Total overdue</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626" }}>{money(overdueTotal)}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student, grade, parent, phone..." style={{ ...field, flex: 1, minWidth: 180 }} />
            <select value={minDays} onChange={(e) => setMinDays(e.target.value)} style={field} aria-label="Minimum days overdue">
              <option value="overdue">Any overdue</option>
              <option value="31">Over 30 days</option>
              <option value="61">Over 60 days</option>
              <option value="91">Over 90 days</option>
            </select>
            <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={includeCurrent} onChange={(e) => setIncludeCurrent(e.target.checked)} />
              Include fees not yet due
            </label>
          </div>

          <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Student", "Grade", "Branch", "Parent phone"].map((h) => <th key={h} style={th}>{h}</th>)}
                    {AGING_BUCKETS.map((b) => <th key={b.key} style={{ ...th, textAlign: "right" }}>{b.label}</th>)}
                    <th style={{ ...th, textAlign: "right" }}>Total</th>
                    <th style={{ ...th, textAlign: "right" }}>Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td style={td}>
                        {r.studentId && can("canViewStudents")
                          ? <Link to={`/students/${r.studentId}/ledger`} style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>{r.name}</Link>
                          : <span style={{ fontWeight: 600 }}>{r.name}</span>}
                        {r.studentCode && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{r.studentCode}</span>}
                      </td>
                      <td style={td}>{r.grade || "—"}</td>
                      <td style={td}>{branchName(r.branchId)}</td>
                      <td style={td}>{r.phone || "—"}</td>
                      {AGING_BUCKETS.map((b) => (
                        <td key={b.key} style={{ ...num, color: r.buckets[b.key] > 0 ? BUCKET_COLOR[b.key] : "var(--text-muted)", fontWeight: r.buckets[b.key] > 0 ? 600 : 400 }}>
                          {r.buckets[b.key] > 0 ? r.buckets[b.key].toLocaleString() : "—"}
                        </td>
                      ))}
                      <td style={{ ...num, fontWeight: 700 }}>{r.total.toLocaleString()}</td>
                      <td style={num} title={r.estimatedDue ? "Some invoices have no due date; the invoice date was used" : undefined}>
                        {r.oldestDays > 0 ? `${r.oldestDays}d` : "—"}{r.estimatedDue ? "*" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc" }}>
                      <td style={{ ...td, fontWeight: 700 }} colSpan={4}>{rows.length} student{rows.length === 1 ? "" : "s"}</td>
                      {AGING_BUCKETS.map((b) => (
                        <td key={b.key} style={{ ...num, fontWeight: 700 }}>
                          {rows.reduce((s, r) => s + r.buckets[b.key], 0).toLocaleString()}
                        </td>
                      ))}
                      <td style={{ ...num, fontWeight: 700 }}>{shownTotal.toLocaleString()}</td>
                      <td style={td} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {rows.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                {aging.rows.length === 0 ? "No outstanding fees. Nothing is owed." : "No students match these filters."}
              </div>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
            Days are counted from each invoice's due date; * means some invoices have no due date and were aged from the invoice date.
            Invoices marked paid are excluded, even if no payment was recorded against them (see Reports, Books Check). Students are
            listed by their oldest overdue invoice first.
          </p>
        </>
      )}
    </div>
  );
}
