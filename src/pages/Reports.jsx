import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { toDate } from "../utils/dates";
import { matchesBranch } from "../utils/branchFilter";
import { buildMonthlyStatement, printMonthlyStatement, statementPeriodLabel, monthName } from "../utils/monthlyStatement";
import { FileText } from "lucide-react";
import toast from "react-hot-toast";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const hsCell = { border: "1px solid #000", padding: "4px 8px" };
const hsBar = { ...hsCell, background: "#000", color: "#fff", fontWeight: 700 };

export default function Reports() {
  const { activeBranch, branches } = useBranch();
  const [activeTab, setActiveTab] = useState("pl");
  const now = new Date();
  const [hsYear, setHsYear] = useState(now.getFullYear());
  const [hsMonth, setHsMonth] = useState(now.getMonth() + 1);
  const [raw, setRaw] = useState({ invoices: [], expenses: [], payslips: [], payments: [], accounts: [] });
  const [data, setData] = useState({ income: 0, expenses: 0, fees: 0, pending: 0, salaries: 0, monthly: [], accounts: [] });

  useEffect(() => {
    const fetchAll = async () => {
      const [invoicesSnap, expSnap, payslipsSnap, accountsSnap, paymentsSnap] = await Promise.all([
        getDocs(collection(db, "invoices")),
        getDocs(collection(db, "expenses")),
        getDocs(collection(db, "payslips")),
        getDocs(collection(db, "accounts")),
        getDocs(collection(db, "payments")),
      ]);

      // Scope to the active workspace / branch filter. Chart of accounts is
      // organisation-wide, so it is not filtered.
      const invoices = invoicesSnap.docs.map(d => d.data()).filter(i => matchesBranch(i, activeBranch));
      const expenses = expSnap.docs.map(d => d.data()).filter(e => matchesBranch(e, activeBranch));
      const payslips = payslipsSnap.docs.map(d => d.data()).filter(p => matchesBranch(p, activeBranch));
      const accounts = accountsSnap.docs.map(d => d.data());
      // Unfiltered: the monthly statement applies its own branch scope and
      // needs every payment to compute the opening balance.
      setRaw({
        invoices: invoicesSnap.docs.map(d => d.data()),
        expenses: expSnap.docs.map(d => d.data()),
        payslips: payslipsSnap.docs.map(d => d.data()),
        payments: paymentsSnap.docs.map(d => d.data()),
        accounts,
      });

      // Collected = actual money received (paid_amount), not the
      // invoice face value — because concessions mean paid < amount.
      const collected = invoices.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
      const concessions = invoices.reduce((s, i) => s + Number(i.concessionAmount || 0), 0);
      const billed = invoices.reduce((s, i) => s + Number(i.amount || 0), 0);
      const pending = invoices
        .filter(i => i.status === "pending" || i.status === "partial")
        .reduce((s, i) => s + (Number(i.amount || 0) - Number(i.paidAmount || 0) - Number(i.concessionAmount || 0)), 0);
      const fees = collected; // income = money actually collected
      const totalExp = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
      const salaries = payslips.reduce((s, p) => s + Number(p.netPay || 0), 0);

      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthly = months.map((month, i) => ({
        month,
        income: invoices.filter(inv => (toDate(inv.paidDate) || new Date()).getMonth() === i).reduce((s, inv) => s + Number(inv.paidAmount || 0), 0),
        expenses: expenses.filter(e => new Date(e.date || Date.now()).getMonth() === i).reduce((s, e) => s + Number(e.amount || 0), 0),
      }));

      setData({ income: fees, expenses: totalExp, fees, pending, salaries, monthly, accounts, concessions, billed, collected });
    };
    fetchAll();
  }, [activeBranch]);

  const netProfit = data.income - data.expenses - data.salaries;

  const tabs = [
    { id: "pl", label: "Profit & Loss" },
    { id: "bs", label: "Balance Sheet" },
    { id: "cf", label: "Cash Flow" },
    { id: "fees", label: "Fee Collection" },
    { id: "hs", label: "Haji Sahab Report" },
  ];

  const statement = useMemo(() => buildMonthlyStatement({
    year: hsYear, month: hsMonth, ...raw, branches,
    includeAccountOpening: activeBranch === "all",
    inScope: (r) => matchesBranch(r, activeBranch),
  }), [hsYear, hsMonth, raw, branches, activeBranch]);

  const scopeLabel = activeBranch === "all" ? "All branches"
    : activeBranch === "main" ? "Main" : (branches.find(b => b.id === activeBranch)?.name || "");

  const exportStatement = () => {
    if (!printMonthlyStatement(statement, { scopeLabel })) toast.error("Pop-up blocked — allow pop-ups to export the PDF");
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Reports</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>Financial statements and analytics</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 14, fontWeight: 500, background: activeTab === t.id ? "var(--primary)" : "white", color: activeTab === t.id ? "white" : "#475569" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Profit & Loss */}
      {activeTab === "pl" && (
        <div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc" }}>
              <h3 style={{ fontWeight: 700, fontSize: 16 }}>Profit & Loss Statement</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>Current year to date</p>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>Income</div>
                {[
                  { label: "Total Billed (face value)", value: data.billed || 0, muted: true },
                  { label: "Fee Collections (received)", value: data.collected || 0 },
                  { label: "Concessions (waived)", value: data.concessions || 0, amber: true },
                  { label: "Pending Fees (outstanding)", value: data.pending, muted: true },
                ].map(({ label, value, muted, amber }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", opacity: muted ? 0.5 : 1 }}>
                    <span style={{ fontSize: 14 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: amber ? "#f59e0b" : "#10b981" }}>Rs. {value.toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700 }}>
                  <span>Total Income</span>
                  <span style={{ color: "#10b981" }}>Rs. {data.income.toLocaleString()}</span>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>Expenses</div>
                {[
                  { label: "Operating Expenses", value: data.expenses },
                  { label: "Salaries & Payroll", value: data.salaries },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 14 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>Rs. {value.toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700 }}>
                  <span>Total Expenses</span>
                  <span style={{ color: "#ef4444" }}>Rs. {(data.expenses + data.salaries).toLocaleString()}</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 20px", background: netProfit >= 0 ? "#ecfdf5" : "#fef2f2", borderRadius: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Net {netProfit >= 0 ? "Surplus" : "Deficit"}</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: netProfit >= 0 ? "#10b981" : "#ef4444" }}>Rs. {Math.abs(netProfit).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", padding: 24 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 20 }}>Monthly Income vs Expenses</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthly}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => `Rs. ${v.toLocaleString()}`} />
                <Bar dataKey="income" fill="#10b981" name="Income" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Balance Sheet */}
      {activeTab === "bs" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc" }}>
            <h3 style={{ fontWeight: 700, fontSize: 16 }}>Balance Sheet</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>Based on your Chart of Accounts</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {[
              { title: "Assets", types: ["Assets"], color: "#10b981" },
              { title: "Liabilities & Equity", types: ["Liabilities", "Equity"], color: "#4f46e5" },
            ].map(({ title, types, color }) => {
              const accs = data.accounts.filter(a => types.includes(a.type));
              const total = accs.reduce((s, a) => s + Number(a.balance || 0), 0);
              return (
                <div key={title} style={{ padding: 24, borderRight: title === "Assets" ? "1px solid var(--border)" : "none" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 16 }}>{title}</div>
                  {accs.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No accounts added yet. Add accounts in Chart of Accounts.</div>}
                  {accs.map(acc => (
                    <div key={acc.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                      <span style={{ color: "var(--text-muted)" }}>{acc.code} — {acc.name}</span>
                      <span style={{ fontWeight: 600 }}>Rs. {Number(acc.balance).toLocaleString()}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700, fontSize: 15 }}>
                    <span>Total {title}</span>
                    <span style={{ color }}>Rs. {total.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cash Flow */}
      {activeTab === "cf" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", padding: 24 }}>
          <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Cash Flow Statement</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.monthly}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => `Rs. ${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} name="Cash In" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} name="Cash Out" dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 24 }}>
            {[
              { label: "Total Cash In", value: data.income, color: "#10b981", bg: "#ecfdf5" },
              { label: "Total Cash Out", value: data.expenses + data.salaries, color: "#ef4444", bg: "#fef2f2" },
              { label: "Net Cash Flow", value: data.income - data.expenses - data.salaries, color: "#4f46e5", bg: "#eef2ff" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>Rs. {value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fee Collection Report */}
      {activeTab === "fees" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc" }}>
            <h3 style={{ fontWeight: 700, fontSize: 16 }}>Fee Collection Report</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, padding: 24, borderBottom: "1px solid var(--border)" }}>
            {[
              { label: "Total Collected", value: data.fees, color: "#10b981" },
              { label: "Total Pending", value: data.pending, color: "#f59e0b" },
              { label: "Collection Rate", value: data.fees + data.pending > 0 ? `${Math.round((data.fees / (data.fees + data.pending)) * 100)}%` : "0%", color: "#4f46e5" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "center", padding: 16, background: "#f8fafc", borderRadius: 10 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{typeof value === "string" ? value : `Rs. ${value.toLocaleString()}`}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: 24 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.monthly}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => `Rs. ${v.toLocaleString()}`} />
                <Bar dataKey="income" fill="#7a2535" name="Fees Collected" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Haji Sahab Report — monthly statement */}
      {activeTab === "hs" && (
        <div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <select value={hsMonth} onChange={e => setHsMonth(Number(e.target.value))}
              style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>
            <input type="number" value={hsYear} onChange={e => setHsYear(Number(e.target.value) || now.getFullYear())}
              style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, width: 90 }} />
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{scopeLabel}</span>
            <button onClick={exportStatement}
              style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
              <FileText size={15} /> Export PDF
            </button>
          </div>

          <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 24, maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ fontStyle: "italic", fontWeight: 700 }}>Monthly Statement</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{statementPeriodLabel(hsYear, hsMonth)}</div>
            </div>
            {[
              { bar: "Opening Balance", value: statement.openingBalance },
              { title: "Income", rows: statement.income, bar: "Total — Income", value: statement.totalIncome },
              { title: "Expense", rows: statement.expense, bar: "Total — Expense", value: statement.totalExpense },
              { bar: "Closing Balance", value: statement.closingBalance },
            ].map(({ title, rows, bar, value }, i) => (
              <table key={i} style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 14 }}>
                <tbody>
                  {title && <tr><td colSpan={2} style={{ ...hsBar, textAlign: "center", fontSize: 15 }}>{title}</td></tr>}
                  {(rows || []).map(r => (
                    <tr key={r.label}>
                      <td style={{ ...hsCell, fontWeight: 700 }}>{r.label}</td>
                      <td style={{ ...hsCell, textAlign: "right", width: "34%" }}>{r.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={hsBar}>{bar}</td>
                    <td style={{ ...hsBar, textAlign: "right" }}>{value.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
