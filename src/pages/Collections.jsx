// Collections report (FEAT-002): fee money received, by branch, month
// and Bank & Cash account.
//
// Source: payment (ledger) rows tied to invoices, net of reversals, so
// the totals tie to Bank & Cash. Money recorded on an invoice that never
// reached the ledger is not here; it is called out below the table so a
// gap between this report and the Fees pages is explained, not hidden.

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Wallet, AlertTriangle } from "lucide-react";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useReportData } from "../hooks/useReportData";
import { useDateRange, DateRangeBar, DataWarnings, money } from "../components/ReportControls";
import { exportToCSV } from "../utils/exportUtils";
import { collectionRows, pivot, invoicesWithoutLedger, monthLabel, inRange, rangeLabel } from "../utils/reporting";

const COLLECTIONS = ["payments", "invoices", "accounts"];
const DIMS = {
  month: { label: "Month", field: "month", fmt: monthLabel },
  branch: { label: "Branch", field: "branchName", fmt: (v) => v },
  account: { label: "Account", field: "accountName", fmt: (v) => v },
  none: { label: "Total only", field: "all", fmt: (v) => v },
};
const field = { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" };
const th = { padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "10px 14px", fontSize: 13, borderTop: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" };

export default function Collections() {
  const { activeBranch, branches } = useBranch();
  const { can } = useUser();
  const dr = useDateRange("ytd");
  const { data, loading, capped, errors } = useReportData(COLLECTIONS);
  const [rowDim, setRowDim] = useState("month");
  const [colDim, setColDim] = useState("account");

  const branchName = (id) => (!id || id === "main" ? "Main Office" : branches.find((b) => b.id === id)?.name || id);
  const scopeName = activeBranch === "all" ? "all branches" : branchName(activeBranch);

  const report = useMemo(() => {
    const r = collectionRows(
      { payments: data.payments || [], invoices: data.invoices || [], accounts: data.accounts || [] },
      { branch: activeBranch, range: dr.range }
    );
    const nameOf = (id) => (!id || id === "main" ? "Main Office" : branches.find((b) => b.id === id)?.name || id);
    const rows = r.rows.map((x) => ({ ...x, branchName: nameOf(x.branchKey), all: "Total" }));
    return { ...r, rows };
  }, [data, activeBranch, dr.range, branches]);

  const rd = DIMS[rowDim], cd = DIMS[colDim];
  const grid = useMemo(() => pivot(report.rows, rd.field, cd.field), [report.rows, rd.field, cd.field]);

  // Money invoices say was received but the ledger does not hold.
  const gaps = useMemo(() => {
    const all = invoicesWithoutLedger(data.invoices || [], data.payments || [], { branch: activeBranch });
    return all.filter((g) => inRange(g.date, dr.range));
  }, [data, activeBranch, dr.range]);
  const gapTotal = gaps.reduce((s, g) => s + g.diff, 0);

  const showCols = colDim !== "none" && colDim !== rowDim;
  const colKeys = showCols ? grid.colKeys : [];

  const handleCSV = () => exportToCSV(`collections-${rowDim}-by-${colDim}`,
    [rd.label, ...colKeys.map((k) => cd.fmt(k)), "Total"],
    [...grid.rowKeys.map((rk) => [rd.fmt(rk), ...colKeys.map((ck) => grid.cell(rk, ck)), grid.rowTotal(rk)]),
      ["Total", ...colKeys.map((ck) => grid.colTotal(ck)), grid.grand]]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Wallet size={20} /> Collections</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Fee money received into Bank &amp; Cash, net of reversals · {scopeName} · {rangeLabel(dr.range)}
          </p>
        </div>
        {can("canExport") && report.rows.length > 0 && (
          <button onClick={handleCSV} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}>
            <Download size={14} /> CSV
          </button>
        )}
      </div>

      <DateRangeBar dr={dr} />
      <DataWarnings capped={capped} errors={errors} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <label style={{ fontSize: 13, color: "var(--text-muted)" }}>Rows{" "}
          <select value={rowDim} onChange={(e) => setRowDim(e.target.value)} style={field}>
            {["month", "branch", "account"].map((k) => <option key={k} value={k}>{DIMS[k].label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--text-muted)" }}>Columns{" "}
          <select value={colDim} onChange={(e) => setColDim(e.target.value)} style={field}>
            {["account", "branch", "month", "none"].map((k) => <option key={k} value={k}>{DIMS[k].label}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...th, textAlign: "left" }}>{rd.label}</th>
                    {colKeys.map((k) => <th key={k} style={th}>{cd.fmt(k)}</th>)}
                    <th style={th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.rowKeys.map((rk) => (
                    <tr key={rk}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{rd.fmt(rk)}</td>
                      {colKeys.map((ck) => <td key={ck} style={td}>{grid.cell(rk, ck) ? grid.cell(rk, ck).toLocaleString() : "—"}</td>)}
                      <td style={{ ...td, fontWeight: 700 }}>{grid.rowTotal(rk).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                {grid.rowKeys.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc" }}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Total</td>
                      {colKeys.map((ck) => <td key={ck} style={{ ...td, fontWeight: 700 }}>{grid.colTotal(ck).toLocaleString()}</td>)}
                      <td style={{ ...td, fontWeight: 700, color: "#10b981" }}>{money(grid.grand)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {grid.rowKeys.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No fee receipts recorded in Bank &amp; Cash for this period.</div>
            )}
          </div>

          {report.undated > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>{report.undated} receipt{report.undated === 1 ? " has" : "s have"} no date and {report.undated === 1 ? "is" : "are"} left out. Choose "All time" to include them.</p>
          )}
          {report.unmatched > 0 && (
            <p style={{ fontSize: 12, color: "#92400e", marginTop: 10 }}>{report.unmatched} payment{report.unmatched === 1 ? "" : "s"} name an account that no longer exists; they appear under the name they were recorded with.</p>
          )}

          {gaps.length > 0 && (
            <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginTop: 14, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {gaps.length} invoice{gaps.length === 1 ? " is" : "s are"} recorded as paid in this period (Rs. {gapTotal.toLocaleString()}) with no matching Bank &amp; Cash entry, so
                that money is not in the table above. {can("canViewReports") && <Link to="/reports" style={{ color: "inherit", fontWeight: 600 }}>See Reports, Books Check</Link>}
              </span>
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
            Counts fee receipts by the date they were posted. Reversed receipts and their reversing entries cancel out and are excluded.
            There is no "collected by" field on payments yet, so collections cannot be split by cashier.
          </p>
        </>
      )}
    </div>
  );
}
