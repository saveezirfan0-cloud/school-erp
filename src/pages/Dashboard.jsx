import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { matchesBranch } from "../utils/branchFilter";
import { toMillis, toDate } from "../utils/dates";
import { Users, Receipt, TrendingDown, TrendingUp, UserCheck, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

export default function Dashboard() {
  const { activeBranch, branches } = useBranch();
  const [stats, setStats] = useState({ students: 0, employees: 0, feesCollected: 0, expenses: 0, pending: 0, branches: 0 });
  const [chartData, setChartData] = useState([]);
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [studentsSnap, employeesSnap, feesSnap, expSnap, branchSnap] = await Promise.all([
          getDocs(collection(db, "students")),
          getDocs(collection(db, "employees")),
          getDocs(collection(db, "invoices")),
          getDocs(collection(db, "expenses")),
          getDocs(collection(db, "branches")),
        ]);

        let students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let fees = feesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        students = students.filter(s => matchesBranch(s, activeBranch));
        fees = fees.filter(f => matchesBranch(f, activeBranch));
        expenses = expenses.filter(e => matchesBranch(e, activeBranch));
        employees = employees.filter(e => matchesBranch(e, activeBranch));

        const collected = fees.filter(f => f.status === "paid").reduce((s, f) => s + Number(f.amount || 0), 0);
        const pending = fees.filter(f => f.status === "pending").reduce((s, f) => s + Number(f.amount || 0), 0);
        const totalExp = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

        setStats({ students: students.length, employees: employees.length, feesCollected: collected, expenses: totalExp, pending, branches: branchSnap.size });

        const recent = fees.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).slice(0, 6);
        setRecentInvoices(recent);

        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthly = months.map((month, i) => ({
          month,
          fees: fees.filter(f => f.status === "paid" && (toDate(f.paidDate) || toDate(f.createdAt) || new Date()).getMonth() === i).reduce((s, f) => s + Number(f.amount || 0), 0),
          expenses: expenses.filter(e => new Date(e.date || Date.now()).getMonth() === i).reduce((s, e) => s + Number(e.amount || 0), 0),
        }));
        setChartData(monthly);
      } catch (err) { console.error("Dashboard error:", err); }
      setLoading(false);
    };
    fetchStats();
  }, [activeBranch]);

  const cards = [
    { label: "Total Students", value: stats.students, icon: Users, color: "#7a2535", bg: "#f5eaec" },
    { label: "Employees", value: stats.employees, icon: UserCheck, color: "#2a8c7a", bg: "#e6f4f1" },
    { label: "Fees Collected", value: `Rs. ${stats.feesCollected.toLocaleString()}`, icon: TrendingUp, color: "#10b981", bg: "#ecfdf5" },
    { label: "Pending Fees", value: `Rs. ${stats.pending.toLocaleString()}`, icon: Receipt, color: "#f59e0b", bg: "#fffbeb" },
    { label: "Total Expenses", value: `Rs. ${stats.expenses.toLocaleString()}`, icon: TrendingDown, color: "#ef4444", bg: "#fef2f2" },
    { label: "Branches", value: stats.branches + 1, icon: Building2, color: "#4f46e5", bg: "#eef2ff" },
  ];

  const netSurplus = stats.feesCollected - stats.expenses;

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

      <div style={{ background: "var(--sidebar-bg)", borderRadius: 14, padding: "20px 24px", marginBottom: 20, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Net {netSurplus >= 0 ? "Surplus" : "Deficit"}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Rs. {Math.abs(netSurplus).toLocaleString()}</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>Fees collected minus expenses</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Collection rate</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {stats.feesCollected + stats.pending > 0 ? `${Math.round((stats.feesCollected / (stats.feesCollected + stats.pending)) * 100)}%` : "0%"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: "16px", border: "1px solid var(--border)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon size={18} color={color} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
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
          <a href="/fees" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>View all →</a>
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