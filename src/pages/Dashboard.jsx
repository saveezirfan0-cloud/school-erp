import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { effectiveBranchId, matchesBranch } from "../utils/branchFilter";
import { toMillis } from "../utils/dates";
import { studentName } from "../utils/studentLabel";
import { useNavigate, Link } from "react-router-dom";
import { invoiceCollected, invoiceOutstanding } from "../utils/invoiceTotals";
import { buildBuckets, bucketKey, defaultPeriod, inRange, resolveRange, describePeriod, toYMD } from "../utils/dateRange";
import DateRangeFilter from "../components/UI/DateRangeFilter";
import DetailModal from "../components/UI/DetailModal";
import { Users, Receipt, TrendingDown, TrendingUp, UserCheck, Building2, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import AcademicsWidget from "../components/AcademicsWidget";

const PERIOD_KEY = "dashboardPeriod";
const loadPeriod = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PERIOD_KEY));
    if (saved && saved.mode) return saved;
  } catch (e) { /* storage unavailable — use default */ }
  return defaultPeriod();
};

const rs = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

export default function Dashboard() {
  const { activeBranch, setActiveBranch, branches } = useBranch();
  const navigate = useNavigate();
  const [raw, setRaw] = useState({ students: [], employees: [], invoices: [], expenses: [], payslips: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(loadPeriod);
  const [detail, setDetail] = useState(null); // key of the open popup

  useEffect(() => {
    try { localStorage.setItem(PERIOD_KEY, JSON.stringify(period)); } catch (e) { /* ignore */ }
  }, [period]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [studentsSnap, employeesSnap, invSnap, expSnap, payslipsSnap, paySnap] = await Promise.all([
          getDocs(collection(db, "students")),
          getDocs(collection(db, "employees")),
          getDocs(collection(db, "invoices")),
          getDocs(collection(db, "expenses")),
          getDocs(collection(db, "payslips")),
          getDocs(collection(db, "payments")),
        ]);
        const read = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRaw({ students: read(studentsSnap), employees: read(employeesSnap), invoices: read(invSnap), expenses: read(expSnap), payslips: read(payslipsSnap), payments: read(paySnap) });
      } catch (err) { console.error("Dashboard error:", err); }
      setLoading(false);
    };
    fetchAll();
  }, []);

  const range = useMemo(() => resolveRange(period), [period]);
  const branchName = (id) => (id ? branches.find(b => b.id === id)?.name || "Unknown branch" : "Main Office");

  // Everything below is derived from the raw rows + the period, for ALL
  // branches. The active branch is applied afterwards ("scope"), so the
  // per-branch breakdown can reuse the same numbers.
  const all = useMemo(() => {
    const studentsById = new Map(raw.students.map(s => [s.id, s]));

    // Money rules live in utils/invoiceTotals so the Dashboard, Reports and
    // Fees pages always agree.
    const invoices = raw.invoices.map(i => ({
      ...i,
      _branch: effectiveBranchId(i, studentsById),
      _received: invoiceCollected(i),
      _outstanding: invoiceOutstanding(i),
      _paidOn: toYMD(i.paidDate || i.createdAt),
      _raisedOn: toYMD(i.createdAt),
    }));
    const branchKey = (r) => (!r.branchId || r.branchId === "main" ? "" : r.branchId);
    // Fee income imported from the Accounts workbook (Jan-Sep 2026) has no
    // invoices behind it, only cash-in payments. Only import-batch rows are
    // counted: payments the app records for invoices are already in `invoices`.
    const importedFees = raw.payments
      .filter(p => p.importBatch && p.type === "cash_in" && !p.reversed && /fees\s*$/i.test(p.category || ""))
      .map(p => ({
        id: `pay-${p.id}`, studentName: p.category, month: "", year: "",
        _branch: branchKey(p), _received: Number(p.amount || 0), _paidOn: toYMD(p.date || p.createdAt),
      }));
    // Total expenses = operating expenses + payroll (matches the P&L report).
    const expenses = [
      ...raw.expenses.map(e => ({ ...e, _branch: branchKey(e), _on: toYMD(e.date || e.createdAt) })),
      ...raw.payslips.map(p => ({
        id: `payslip-${p.id}`, _branch: branchKey(p), _on: toYMD(p.paidDate || p.date || p.createdAt),
        description: `Salary — ${p.employeeName || "employee"} (${p.month || ""} ${p.year || ""})`.trim(),
        category: "Salaries", amount: Number(p.netPay || 0),
      })),
    ];
    const students = raw.students.map(s => ({ ...s, _branch: !s.branchId || s.branchId === "main" ? "" : s.branchId }));
    const employees = raw.employees.map(e => ({ ...e, _branch: !e.branchId || e.branchId === "main" ? "" : e.branchId }));

    return {
      students,
      employees,
      collected: [...invoices, ...importedFees].filter(i => i._received > 0 && inRange(i._paidOn, range)),
      pending: invoices.filter(i => i._outstanding > 0 && inRange(i._raisedOn, range)),
      invoicesInRange: invoices.filter(i => inRange(i._raisedOn, range)),
      expenses: expenses.filter(e => inRange(e._on, range)),
    };
  }, [raw, range]);

  const inScope = (r) => matchesBranch({ branchId: r._branch }, activeBranch);
  const scope = useMemo(() => ({
    students: all.students.filter(inScope),
    employees: all.employees.filter(inScope),
    collected: all.collected.filter(inScope),
    pending: all.pending.filter(inScope),
    invoices: all.invoicesInRange.filter(inScope),
    expenses: all.expenses.filter(inScope),
  }), [all, activeBranch]);

  const collected = sum(scope.collected, "_received");
  const pendingAmt = sum(scope.pending, "_outstanding");
  const totalExp = sum(scope.expenses, "amount");
  const netSurplus = collected - totalExp;
  const rate = collected + pendingAmt > 0 ? Math.round((collected / (collected + pendingAmt)) * 100) : 0;

  // One row per branch (Main Office first) — drives the "All branches" breakdown.
  const breakdown = useMemo(() => {
    const keys = ["", ...branches.map(b => b.id)];
    return keys.map(k => {
      const c = sum(all.collected.filter(r => r._branch === k), "_received");
      const e = sum(all.expenses.filter(r => r._branch === k), "amount");
      return {
        id: k || "main",
        name: branchName(k),
        students: all.students.filter(r => r._branch === k).length,
        employees: all.employees.filter(r => r._branch === k).length,
        collected: c,
        pending: sum(all.pending.filter(r => r._branch === k), "_outstanding"),
        expenses: e,
        net: c - e,
      };
    });
  }, [all, branches]);

  // Timeline: fees vs expenses per day (short ranges) or per month.
  const chartData = useMemo(() => {
    const dates = [...scope.collected.map(r => r._paidOn), ...scope.expenses.map(r => r._on)].filter(Boolean).sort();
    const { unit, buckets } = buildBuckets(range, { from: dates[0], to: dates[dates.length - 1] });
    const rows = buckets.map(b => ({ ...b, fees: 0, expenses: 0 }));
    const idx = new Map(rows.map((r, i) => [r.key, i]));
    scope.collected.forEach(r => { const i = idx.get(bucketKey(unit, r._paidOn)); if (i != null) rows[i].fees += r._received; });
    scope.expenses.forEach(r => { const i = idx.get(bucketKey(unit, r._on)); if (i != null) rows[i].expenses += Number(r.amount || 0); });
    return rows;
  }, [scope, range]);

  const recentInvoices = [...scope.invoices].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).slice(0, 6);

  const isAll = activeBranch === "all";
  const scopeTitle = isAll ? "All branches" : branchName(activeBranch === "main" ? "" : activeBranch);
  const periodText = describePeriod(period, range);

  const cards = [
    { key: "students", label: "Total Students", value: scope.students.length, icon: Users, color: "#7a2535", bg: "#f5eaec", hint: "Current headcount" },
    { key: "employees", label: "Employees", value: scope.employees.length, icon: UserCheck, color: "#2a8c7a", bg: "#e6f4f1", hint: "Current headcount" },
    { key: "collected", label: "Fees Collected", value: rs(collected), icon: TrendingUp, color: "#10b981", bg: "#ecfdf5" },
    { key: "pending", label: "Pending Fees", value: rs(pendingAmt), icon: Receipt, color: "#f59e0b", bg: "#fffbeb" },
    { key: "expenses", label: "Total Expenses", value: rs(totalExp), icon: TrendingDown, color: "#ef4444", bg: "#fef2f2", hint: "Operating + payroll" },
    // Branch count only makes sense across all branches; a single-branch
    // dashboard shows its own unpaid-invoice count instead.
    isAll
      ? { key: "branches", label: "Branches", value: branches.length + 1, icon: Building2, color: "#4f46e5", bg: "#eef2ff", hint: "Including Main Office" }
      : { key: "invoices", label: "Unpaid Invoices", value: scope.pending.length, icon: FileText, color: "#4f46e5", bg: "#eef2ff" },
  ];

  const branchCol = { key: "branch", label: "Branch", render: r => branchName(r._branch) };
  const studentCol = { key: "studentName", label: "Student", render: r => r.studentName || "—" };
  const openStudent = (id) => (id ? () => { setDetail(null); navigate(`/students/${id}`); } : undefined);
  const amountCol = (key, label, field) => ({ key, label, align: "right", render: r => <strong>{rs(r[field])}</strong>, text: r => r[field] });
  const totalFoot = (label, value) => <strong style={{ color: "var(--text)" }}>{label}: {rs(value)}</strong>;

  const details = {
    students: {
      title: "Students", subtitle: `${scopeTitle} · current headcount`,
      columns: [
        { key: "studentId", label: "ID", render: r => r.studentId || "—" },
        { key: "name", label: "Name", render: r => studentName(r), text: r => studentName(r) },
        { key: "grade", label: "Grade", render: r => r.grade || "—" },
        branchCol,
        { key: "monthlyFee", label: "Monthly Fee", align: "right", render: r => rs(r.monthlyFee) },
      ],
      rows: scope.students.map(r => ({ ...r, onClick: openStudent(r.id) })),
    },
    employees: {
      title: "Employees", subtitle: `${scopeTitle} · current headcount`,
      columns: [
        { key: "name", label: "Name" },
        { key: "role", label: "Role", render: r => r.role || "—" },
        { key: "phone", label: "Phone", render: r => r.phone || "—" },
        branchCol,
        { key: "salary", label: "Salary", align: "right", render: r => rs(r.salary) },
      ],
      rows: scope.employees,
    },
    collected: {
      title: "Fees Collected", subtitle: `${scopeTitle} · ${periodText}`,
      columns: [studentCol, branchCol, { key: "month", label: "Month", render: r => `${r.month || ""} ${r.year || ""}` }, { key: "_paidOn", label: "Received" }, amountCol("amt", "Received", "_received")],
      rows: [...scope.collected].sort((a, b) => (b._paidOn || "").localeCompare(a._paidOn || "")).map(r => ({ ...r, onClick: openStudent(r.studentId) })),
      footer: totalFoot("Total", collected),
    },
    pending: {
      title: "Pending Fees", subtitle: `${scopeTitle} · invoices raised ${periodText}`,
      columns: [studentCol, branchCol, { key: "month", label: "Month", render: r => `${r.month || ""} ${r.year || ""}` }, { key: "status", label: "Status" }, amountCol("amt", "Outstanding", "_outstanding")],
      rows: [...scope.pending].sort((a, b) => b._outstanding - a._outstanding).map(r => ({ ...r, onClick: openStudent(r.studentId) })),
      footer: totalFoot("Outstanding", pendingAmt),
    },
    invoices: {
      title: "Unpaid Invoices", subtitle: `${scopeTitle} · invoices raised ${periodText}`,
      columns: [studentCol, { key: "month", label: "Month", render: r => `${r.month || ""} ${r.year || ""}` }, { key: "status", label: "Status" }, amountCol("amt", "Outstanding", "_outstanding")],
      rows: [...scope.pending].sort((a, b) => b._outstanding - a._outstanding).map(r => ({ ...r, onClick: openStudent(r.studentId) })),
      footer: totalFoot("Outstanding", pendingAmt),
    },
    expenses: {
      title: "Expenses", subtitle: `${scopeTitle} · ${periodText}`,
      columns: [{ key: "_on", label: "Date" }, { key: "description", label: "Description", render: r => r.description || "—" }, { key: "category", label: "Category", render: r => r.category || "—" }, branchCol, amountCol("amt", "Amount", "amount")],
      rows: [...scope.expenses].sort((a, b) => (b._on || "").localeCompare(a._on || "")),
      footer: totalFoot("Total", totalExp),
    },
    // The entries behind the net figure: every fee received and every expense /
    // salary in scope, newest first, signed so they add up to the net.
    net: {
      title: netSurplus >= 0 ? "Net Surplus" : "Net Deficit", subtitle: `${scopeTitle} · ${periodText}`,
      summary: [
        { label: "Fees collected", value: rs(collected), color: "#10b981" },
        { label: "Expenses & payroll", value: rs(totalExp), color: "#ef4444" },
        { label: netSurplus >= 0 ? "Net surplus" : "Net deficit", value: rs(Math.abs(netSurplus)), color: netSurplus >= 0 ? "#10b981" : "#ef4444" },
      ],
      columns: [
        { key: "date", label: "Date" },
        { key: "type", label: "Type" },
        { key: "details", label: "Details" },
        branchCol,
        { key: "signed", label: "Amount", align: "right", text: r => r.signed, render: r => <strong style={{ color: r.signed >= 0 ? "#10b981" : "#ef4444" }}>{r.signed >= 0 ? "+" : "−"}{rs(Math.abs(r.signed))}</strong> },
      ],
      rows: [
        ...scope.collected.map(r => ({ id: `f-${r.id}`, _branch: r._branch, date: r._paidOn, type: "Fee", details: `${r.studentName || "—"} · ${r.month || ""} ${r.year || ""}`.trim(), signed: r._received, onClick: openStudent(r.studentId) })),
        ...scope.expenses.map(r => ({ id: `e-${r.id}`, _branch: r._branch, date: r._on, type: r.category === "Salaries" ? "Salary" : "Expense", details: r.description || r.category || "—", signed: -Number(r.amount || 0) })),
      ].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    },
    // Collection rate = collected / (collected + still outstanding): list both sides.
    rate: {
      title: "Collection Rate", subtitle: `${scopeTitle} · ${periodText}`,
      summary: [
        { label: "Collected", value: rs(collected), color: "#10b981" },
        { label: "Outstanding", value: rs(pendingAmt), color: "#f59e0b" },
        { label: "Collection rate", value: `${rate}%` },
      ],
      columns: [
        { key: "date", label: "Date" },
        { key: "kind", label: "Status" },
        studentCol,
        branchCol,
        { key: "amt", label: "Amount", align: "right", text: r => r.amt, render: r => <strong>{rs(r.amt)}</strong> },
      ],
      rows: [
        ...scope.collected.map(r => ({ ...r, id: `c-${r.id}`, date: r._paidOn, kind: "Collected", amt: r._received, onClick: openStudent(r.studentId) })),
        ...scope.pending.map(r => ({ ...r, id: `p-${r.id}`, date: r._raisedOn, kind: "Outstanding", amt: r._outstanding, onClick: openStudent(r.studentId) })),
      ].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    },
    branches: {
      title: "Branches", subtitle: `Per-branch breakdown · ${periodText} — click a branch to open its dashboard`,
      columns: [
        { key: "name", label: "Branch" },
        { key: "students", label: "Students", align: "right" },
        { key: "employees", label: "Staff", align: "right" },
        { key: "collected", label: "Collected", align: "right", render: r => rs(r.collected) },
        { key: "pending", label: "Pending", align: "right", render: r => rs(r.pending) },
        { key: "expenses", label: "Expenses", align: "right", render: r => rs(r.expenses) },
        { key: "net", label: "Net", align: "right", text: r => r.net, render: r => <strong style={{ color: r.net >= 0 ? "#10b981" : "#ef4444" }}>{rs(r.net)}</strong> },
      ],
      rows: breakdown.map(b => ({ ...b, onClick: () => { setActiveBranch(b.id); setDetail(null); } })),
    },
  };
  const openDetail = detail ? details[detail] : null;
  const tileStyle = { cursor: "pointer", textAlign: "left", font: "inherit" };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 40, height: 40, border: "3px solid var(--primary-light)", borderTop: "3px solid var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading dashboard...</p>
    </div>
  );

  const axisFmt = v => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Dashboard</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{isAll ? "All branches overview" : scopeTitle}</p>
      </div>

      <DateRangeFilter value={period} onChange={setPeriod} />

      <div style={{ background: "var(--sidebar-bg)", borderRadius: 14, marginBottom: 20, color: "white", display: "flex", justifyContent: "space-between", alignItems: "stretch", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setDetail("net")} title="View entries behind the net figure"
          style={{ ...tileStyle, flex: "1 1 260px", border: "none", background: "transparent", color: "inherit", padding: "20px 24px", borderRadius: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Net {netSurplus >= 0 ? "Surplus" : "Deficit"}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{rs(Math.abs(netSurplus))}</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>Fees collected minus expenses &amp; payroll · {periodText}</div>
        </button>
        <button type="button" onClick={() => setDetail("rate")} title="View entries behind the collection rate"
          style={{ ...tileStyle, border: "none", background: "transparent", color: "inherit", padding: "20px 24px", borderRadius: 14, textAlign: "right" }}>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Collection rate</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{rate}%</div>
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {cards.map(({ key, label, value, icon: Icon, color, bg, hint }) => (
          <button type="button" key={key} onClick={() => setDetail(key)} title={`View ${label.toLowerCase()} details`}
            style={{ ...tileStyle, background: "white", borderRadius: 12, padding: "16px", border: "1px solid var(--border)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon size={18} color={color} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            {hint && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{hint}</div>}
          </button>
        ))}
      </div>

      {isAll && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>By Branch</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{periodText} · click a branch to open its dashboard</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Branch", "Students", "Staff", "Collected", "Pending", "Expenses", "Net"].map((h, i) => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: i === 0 ? "left" : "right", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.map(b => (
                  <tr key={b.id} onClick={() => setActiveBranch(b.id)} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                    <td style={{ padding: "11px 16px", fontSize: 14, fontWeight: 500 }}>{b.name}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right" }}>{b.students}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right" }}>{b.employees}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right" }}>{rs(b.collected)}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right" }}>{rs(b.pending)}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right" }}>{rs(b.expenses)}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, textAlign: "right", fontWeight: 600, color: b.net >= 0 ? "#10b981" : "#ef4444" }}>{rs(b.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <AcademicsWidget />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "white", borderRadius: 12, padding: "20px 16px", border: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Fees vs Expenses</h3>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 300 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: -10 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={axisFmt} />
                  <Tooltip formatter={v => rs(v)} />
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
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={axisFmt} />
                  <Tooltip formatter={v => rs(v)} />
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
          <Link to="/fees" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>View all →</Link>
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
                <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No invoices for this period</td></tr>
              )}
              {recentInvoices.map(inv => (
                <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "11px 16px", fontSize: 14, fontWeight: 500 }}>{inv.studentName || "—"}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13 }}>{inv.month} {inv.year}</td>
                  <td style={{ padding: "11px 16px", fontSize: 14, fontWeight: 600 }}>{rs(inv.amount)}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : inv.status === "partial" ? "#eff6ff" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : inv.status === "partial" ? "#2563eb" : "#f59e0b" }}>{inv.status}</span>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 13, color: "var(--text-muted)" }}>{inv.dueDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openDetail && <DetailModal {...openDetail} onClose={() => setDetail(null)} />}
    </div>
  );
}
