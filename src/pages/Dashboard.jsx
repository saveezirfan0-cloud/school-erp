import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useReportData } from "../hooks/useReportData";
import { useDateRange, DateRangeBar, DataWarnings } from "../components/ReportControls";
import { matchesBranch } from "../utils/branchFilter";
import { toMillis } from "../utils/dates";
import { profitAndLoss, monthlySeries, isLive } from "../utils/reporting";
import { Users, Receipt, TrendingDown, TrendingUp, UserCheck, Building2, AlertTriangle, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const COLLECTIONS = ["students", "employees", "invoices", "expenses", "payslips", "branches"];

export default function Dashboard() {
  const { activeBranch, branches } = useBranch();
  const { can } = useUser();
  const dr = useDateRange("ytd");
  const { data, loading, capped, errors } = useReportData(COLLECTIONS);

  // Every figure below comes from utils/reporting.js, the same
  // definitions Reports, Bank & Cash and the Student Ledger use.
  const view = useMemo(() => {
    const inScope = (rows) => (rows || []).filter((r) => isLive(r) && matchesBranch(r, activeBranch));
    const students = inScope(data.students);
    const employees = inScope(data.employees);
    const money = { invoices: data.invoices || [], expenses: data.expenses || [], payslips: data.payslips || [] };
    const opts = { branch: activeBranch, range: dr.range };
    return {
      studentCount: students.length,
      employeeCount: employees.length,
      branchCount: (data.branches || []).length,
      pl: profitAndLoss(money, opts),
      chartData: monthlySeries(money, opts).map((m) => ({ month: m.month, fees: m.income, expenses: m.outflow })),
      recentInvoices: inScope(data.invoices).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).slice(0, 6),
    };
  }, [data, activeBranch, dr.range]);

  const { pl, chartData, recentInvoices } = view;
  const stats = {
    feesCollected: pl.collected, pending: pl.outstanding, overdue: pl.overdue,
    expenses: pl.expenses + pl.salaries, branches: view.branchCount,
  };

  const cards = [
    { label: "Total Students", value: view.studentCount, icon: Users, color: "#7a2535", bg: "#f5eaec" },
    { label: "Employees", value: view.employeeCount, icon: UserCheck, color: "#2a8c7a", bg: "#e6f4f1" },
    { label: "Fees Collected", value: `Rs. ${stats.feesCollected.toLocaleString()}`, icon: TrendingUp, color: "#10b981", bg: "#ecfdf5" },
    { label: "Outstanding Fees", value: `Rs. ${stats.pending.toLocaleString()}`, icon: Receipt, color: "#f59e0b", bg: "#fffbeb" },
    { label: "Overdue Fees", value: `Rs. ${stats.overdue.toLocaleString()}`, icon: Clock, color: "#dc2626", bg: "#fef2f2", to: can("canViewReports") ? "/fee-aging" : null },
    { label: "Expenses + Salaries", value: `Rs. ${stats.expenses.toLocaleString()}`, icon: TrendingDown, color: "#ef4444", bg: "#fef2f2" },
    { label: "Branches", value: stats.branches + 1, icon: Building2, color: "#4f46e5", bg: "#eef2ff" },
  ];

  const netSurplus = pl.net;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 40, height: 40, border: "3px solid var(--primary-light)", borderTop: "3px solid var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading dashboard...</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Dashboard</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
          {activeBranch === "all" ? "All branches overview" : activeBranch === "main" ? "Main Office" : branches.find(b => b.id === activeBranch)?.name || ""}
        </p>
      </div>

      <DateRangeBar dr={dr} note="Applies to collected, expenses and charts. Outstanding and overdue are balances as of today." />
      <DataWarnings capped={capped} errors={errors} />

      {pl.unverifiedAllTime > 0 && can("canViewReports") && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginBottom: 14, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {pl.unverifiedAllTimeCount} invoice{pl.unverifiedAllTimeCount === 1 ? " is" : "s are"} marked paid (Rs. {pl.unverifiedAllTime.toLocaleString()}) with no money recorded against {pl.unverifiedAllTimeCount === 1 ? "it" : "them"}.
            These are not counted as collected. <Link to="/reports" style={{ color: "inherit", fontWeight: 600 }}>Open Reports, Books Check</Link>
          </span>
        </div>
      )}

      <div style={{ background: "var(--sidebar-bg)", borderRadius: 14, padding: "20px 24px", marginBottom: 20, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Net {netSurplus >= 0 ? "Surplus" : "Deficit"}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Rs. {Math.abs(netSurplus).toLocaleString()}</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>Fees collected minus expenses and salaries paid</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Collection rate (billed in period)</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {pl.collectionRate}%
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {cards.map(({ label, value, icon: Icon, color, bg, to }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: "16px", border: "1px solid var(--border)", position: "relative" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon size={18} color={color} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            {to && <Link to={to} style={{ position: "absolute", inset: 0, borderRadius: 12 }} aria-label={`${label}: open fee aging report`} title="Open fee aging report" />}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "white", borderRadius: 12, padding: "20px 16px", border: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Monthly Fees vs Expenses</h3>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 300 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: -10 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => `Rs. ${Number(v).toLocaleString()}`} />
                  <Bar dataKey="fees" fill="#7a2535" name="Fees" radius={[3,3,0,0]} />
                  <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div style={{ background: "white", borderRadius: 12, padding: "20px 16px", border: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Cash Flow Trend</h3>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 300 }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ left: -10 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => `Rs. ${Number(v).toLocaleString()}`} />
                  <Line type="monotone" dataKey="fees" stroke="#7a2535" strokeWidth={2} name="Fees" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} name="Expenses" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Recent Invoices</h3>
          <div style={{ display: "flex", gap: 16 }}>
            {can("canViewReports") && <Link to="/fee-aging" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>Fee aging &amp; defaulters →</Link>}
            <Link to="/fees" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>View all →</Link>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Student", "Month", "Amount", "Status", "Due Date"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentInvoices.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No invoices yet</td></tr>
              )}
              {recentInvoices.map(inv => (
                <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "11px 16px", fontSize: 14, fontWeight: 500 }}>{inv.studentName}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13 }}>{inv.month} {inv.year}</td>
                  <td style={{ padding: "11px 16px", fontSize: 14, fontWeight: 600 }}>Rs. {Number(inv.amount).toLocaleString()}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : "#f59e0b" }}>{inv.status}</span>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 13, color: "var(--text-muted)" }}>{inv.dueDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}