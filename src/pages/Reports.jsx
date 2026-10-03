import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useReportData } from "../hooks/useReportData";
import { useDateRange, DateRangeBar, DataWarnings, money } from "../components/ReportControls";
import { BalanceSheetTab, BooksCheckTab, BOOK_COLLECTIONS } from "./ReportsBooks";
import { exportToCSV } from "../utils/exportUtils";
import { profitAndLoss, monthlySeries, rangeLabel } from "../utils/reporting";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const BASE_COLLECTIONS = ["invoices", "expenses", "payslips"];

const tabs = [
  { id: "pl", label: "Profit & Loss" },
  { id: "bs", label: "Balance Sheet" },
  { id: "cf", label: "Cash Flow" },
  { id: "fees", label: "Fee Collection" },
  { id: "books", label: "Books Check" },
];

const panel = { background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" };
const panelHead = { padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc" };
const sectionLabel = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 };
const lineStyle = (muted) => ({ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", opacity: muted ? 0.6 : 1 });

export default function Reports() {
  const { activeBranch, branches } = useBranch();
  const { can } = useUser();
  const [activeTab, setActiveTab] = useState("pl");
  const dr = useDateRange("ytd");
  const needBooks = activeTab === "bs" || activeTab === "books";
  const books = useReportData(needBooks ? BOOK_COLLECTIONS : BASE_COLLECTIONS);
  const { data, loading, capped, errors } = books;

  const branchName = activeBranch === "all" ? "all branches"
    : activeBranch === "main" ? "Main Office"
    : branches.find((b) => b.id === activeBranch)?.name || "selected branch";

  const pl = useMemo(
    () => profitAndLoss(
      { invoices: data.invoices || [], expenses: data.expenses || [], payslips: data.payslips || [] },
      { branch: activeBranch, range: dr.range }
    ),
    [data, activeBranch, dr.range]
  );
  const monthly = useMemo(
    () => monthlySeries(
      { invoices: data.invoices || [], expenses: data.expenses || [], payslips: data.payslips || [] },
      { branch: activeBranch, range: dr.range }
    ),
    [data, activeBranch, dr.range]
  );

  const periodTabs = activeTab === "pl" || activeTab === "cf" || activeTab === "fees";
  const subtitle = `${branchName} · ${rangeLabel(dr.range)}`;

  const exportMonthly = () => exportToCSV(`profit-and-loss-${dr.range.from || "start"}-${dr.range.to || "today"}`,
    ["Month", "Fees collected", "Expenses", "Salaries paid", "Net"],
    monthly.map((m) => [m.month, m.income, m.expenses, m.salaries, m.income - m.outflow]));

  const undatedNote = pl.undated > 0 && (
    <div style={{ padding: "8px 14px", marginBottom: 12, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
      {pl.undated} record{pl.undated === 1 ? " has" : "s have"} no date and {pl.undated === 1 ? "is" : "are"} left out of this period. Choose "All time" to include them.
    </div>
  );

  const net = pl.net;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Reports</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>Financial statements and analytics for {branchName}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link to="/fee-aging" style={linkBtn}>Fee aging &amp; defaulters</Link>
          <Link to="/collections" style={linkBtn}>Collections report</Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 14, fontWeight: 500, background: activeTab === t.id ? "var(--primary)" : "white", color: activeTab === t.id ? "white" : "#475569" }}>
            {t.label}
          </button>
        ))}
      </div>

      {periodTabs && <DateRangeBar dr={dr} />}
      {periodTabs && <DataWarnings capped={capped} errors={errors} />}
      {periodTabs && undatedNote}
      {periodTabs && loading && <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading…</div>}

      {/* Profit & Loss */}
      {activeTab === "pl" && !loading && (
        <div>
          <div style={{ ...panel, marginBottom: 24 }}>
            <div style={panelHead}>
              <h3 style={{ fontWeight: 700, fontSize: 16 }}>Profit & Loss Statement</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{subtitle} · cash basis (fees as received, expenses by date, salaries when paid)</p>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 24 }}>
                <div style={sectionLabel}>Income</div>
                {[
                  { label: "Fee collections (money received)", value: pl.collected, color: "#10b981" },
                  { label: "Memo: billed in period (face value)", value: pl.billed, muted: true, color: "#10b981" },
                  { label: "Memo: concessions given", value: pl.concessions, muted: true, color: "#f59e0b" },
                  { label: "Memo: outstanding fees as of today (all periods)", value: pl.outstanding, muted: true, color: "#f59e0b" },
                ].map(({ label, value, muted, color }) => (
                  <div key={label} style={lineStyle(muted)}>
                    <span style={{ fontSize: 14 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color }}>{money(value)}</span>
                  </div>
                ))}
                {pl.unverified > 0 && (
                  <div style={{ ...lineStyle(false), color: "#b45309" }}>
                    <span style={{ fontSize: 14 }}>Marked paid but no money recorded ({pl.unverifiedCount} invoice{pl.unverifiedCount === 1 ? "" : "s"}, not counted as income)</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{money(pl.unverified)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700 }}>
                  <span>Total Income</span>
                  <span style={{ color: "#10b981" }}>{money(pl.collected)}</span>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={sectionLabel}>Expenses</div>
                {[
                  { label: "Operating expenses", value: pl.expenses },
                  { label: "Salaries paid", value: pl.salaries },
                ].map(({ label, value }) => (
                  <div key={label} style={lineStyle(false)}>
                    <span style={{ fontSize: 14 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>{money(value)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700 }}>
                  <span>Total Expenses</span>
                  <span style={{ color: "#ef4444" }}>{money(pl.expenses + pl.salaries)}</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 20px", background: net >= 0 ? "#ecfdf5" : "#fef2f2", borderRadius: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Net {net >= 0 ? "Surplus" : "Deficit"}</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: net >= 0 ? "#10b981" : "#ef4444" }}>{money(Math.abs(net))}</span>
              </div>
            </div>
          </div>

          <div style={{ ...panel, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ fontWeight: 600 }}>Monthly Income vs Expenses</h3>
              {can("canExport") && monthly.length > 0 && (
                <button onClick={exportMonthly} style={linkBtn}><Download size={14} /> CSV</button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="income" fill="#10b981" name="Income" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" fill="#ef4444" name="Expenses + salaries" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "bs" && <BalanceSheetTab books={books} branch={activeBranch} />}

      {/* Cash Flow */}
      {activeTab === "cf" && !loading && (
        <div style={{ ...panel, padding: 24 }}>
          <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Cash Flow Statement</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>{subtitle} · fee receipts against expenses and salaries paid</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthly}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => money(v)} />
              <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} name="Cash In" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="outflow" stroke="#ef4444" strokeWidth={2} name="Cash Out" dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginTop: 24 }}>
            {[
              { label: "Total Cash In", value: pl.collected, color: "#10b981", bg: "#ecfdf5" },
              { label: "Total Cash Out", value: pl.expenses + pl.salaries, color: "#ef4444", bg: "#fef2f2" },
              { label: "Net Cash Flow", value: net, color: "#4f46e5", bg: "#eef2ff" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{money(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fee Collection Report */}
      {activeTab === "fees" && !loading && (
        <div style={panel}>
          <div style={panelHead}>
            <h3 style={{ fontWeight: 700, fontSize: 16 }}>Fee Collection Report</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{subtitle}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, padding: 24, borderBottom: "1px solid var(--border)" }}>
            {[
              { label: "Collected in period", value: money(pl.collected), color: "#10b981" },
              { label: "Outstanding today", value: money(pl.outstanding), color: "#f59e0b" },
              { label: "Overdue today", value: money(pl.overdue), color: "#ef4444" },
              { label: "Collection rate (billed in period)", value: `${pl.collectionRate}%`, color: "#4f46e5" },
              { label: "Marked paid, no money recorded", value: money(pl.unverified), color: pl.unverified > 0 ? "#b45309" : "#64748b" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "center", padding: 16, background: "#f8fafc", borderRadius: 10 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: 24 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="income" fill="#7a2535" name="Fees Collected" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
              Collected = money recorded against invoices, by paid date. Outstanding and overdue are balances as of today and are not cut by the period.
              Per-account and per-month detail is in the <Link to="/collections">Collections report</Link>.
            </p>
          </div>
        </div>
      )}

      {activeTab === "books" && <BooksCheckTab books={books} branch={activeBranch} branchName={branchName} />}
    </div>
  );
}

const linkBtn = { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 };
