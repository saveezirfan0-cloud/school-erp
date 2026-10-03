import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, FileText, Download, TrendingUp, TrendingDown, Wallet, Scale } from "lucide-react";
import toast from "react-hot-toast";
import { matchesBranch } from "../../utils/branchFilter";
import { exportToCSV } from "../../utils/exportUtils";
import {
  buildMonthlyStatement, printMonthlyStatement, statementCsvRows, statementPeriodLabel,
  percentChange, monthName, fmtNum,
} from "../../utils/monthlyStatement";

const card = { background: "white", borderRadius: 12, border: "1px solid var(--border)" };
const inputStyle = { padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" };
const iconBtn = { ...inputStyle, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center" };

// Small "▲ 12% vs last month" tag. For expenses a rise is bad, so `upIsGood` flips the colour.
function Delta({ pct, upIsGood }) {
  if (pct === null) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No data last month</span>;
  if (pct === 0) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Same as last month</span>;
  const good = (pct > 0) === upIsGood;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: good ? "#10b981" : "#ef4444" }}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>vs last month</span>
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color, bg, children }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <Icon size={17} color={color} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>Rs. {fmtNum(value)}</div>
      <div style={{ marginTop: 4, minHeight: 15 }}>{children}</div>
    </div>
  );
}

// One column of the statement (Income or Expense): grouped sections with
// subtotals, share bars and a per-branch split under each head.
function Section({ title, section, color, tint, emptyText, extra }) {
  const [closed, setClosed] = useState({});
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 15 }}>{title}</h3>
          {extra && <div style={{ marginTop: 3 }}>{extra}</div>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color }}>Rs. {fmtNum(section.total)}</div>
      </div>

      {section.groups.length === 0 && (
        <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{emptyText}</div>
      )}

      {section.groups.map((g) => {
        const share = section.total ? Math.round((g.total / section.total) * 100) : 0;
        const isClosed = closed[g.key];
        return (
          <div key={g.key} style={{ borderBottom: "1px solid var(--border)" }}>
            <button onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              style={{ width: "100%", textAlign: "left", background: tint, border: "none", cursor: "pointer", padding: "11px 20px", display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ChevronDown size={15} color="var(--primary)" style={{ transform: isClosed ? "rotate(-90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: "var(--sidebar-bg)" }}>{g.label}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{share}%</span>
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90, textAlign: "right" }}>{fmtNum(g.total)}</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: "rgba(0,0,0,0.06)", marginTop: 7, marginLeft: 23 }}>
                <div style={{ height: 3, borderRadius: 2, background: color, width: `${share}%` }} />
              </div>
            </button>
            {!isClosed && g.heads.map((h) => (
              <div key={h.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 20px 9px 43px", borderTop: "1px solid #f1f5f9", fontSize: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div>{h.label}</div>
                  {h.branches.length > 1 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {h.branches.map((b) => `${b.name} ${fmtNum(b.amount)}`).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmtNum(h.amount)}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function HajiSahabReport({ raw, branches, activeBranch }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const allBranches = activeBranch === "all";
  const scopeLabel = allBranches ? "All branches"
    : activeBranch === "main" ? "Main" : (branches.find((b) => b.id === activeBranch)?.name || "");

  const { statement, previous } = useMemo(() => {
    const build = (y, m) => buildMonthlyStatement({
      year: y, month: m, ...raw, branches,
      inScope: (r) => matchesBranch(r, activeBranch),
      // Account opening balances are organisation-wide, so only add them for "All".
      includeAccountOpening: activeBranch === "all",
    });
    return {
      statement: build(year, month),
      previous: month === 1 ? build(year - 1, 12) : build(year, month - 1),
    };
  }, [year, month, raw, branches, activeBranch]);

  const step = (delta) => {
    const idx = year * 12 + (month - 1) + delta;
    setYear(Math.floor(idx / 12));
    setMonth((idx % 12) + 1);
  };

  const exportPdf = () => {
    if (!printMonthlyStatement(statement, { scopeLabel })) toast.error("Pop-up blocked — allow pop-ups to export the PDF");
  };
  const exportCsv = () => exportToCSV(
    `haji-sahab-${year}-${String(month).padStart(2, "0")}`,
    ["Section", "Group", "Head", "Branches", "Amount"],
    statementCsvRows(statement),
  );

  const net = statement.net;
  const hasActivity = statement.totalIncome || statement.totalExpense;
  const ledgerGap = statement.closingBalance - statement.ledgerClosing;

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => step(-1)} style={iconBtn} title="Previous month"><ChevronLeft size={16} /></button>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={inputStyle}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} style={{ ...inputStyle, width: 90 }} />
        <button onClick={() => step(1)} style={iconBtn} title="Next month"><ChevronRight size={16} /></button>
        <span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: 4 }}>{scopeLabel}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={exportCsv} style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "#475569" }}>
            <Download size={14} /> CSV
          </button>
          <button onClick={exportPdf}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            <FileText size={15} /> Export PDF
          </button>
        </div>
      </div>

      {/* Headline */}
      <div style={{ background: "var(--sidebar-bg)", borderRadius: 14, padding: "20px 24px", marginBottom: 16, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 1 }}>Closing balance</div>
          <div style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>Rs. {fmtNum(statement.closingBalance)}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{statementPeriodLabel(year, month)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Net {net >= 0 ? "surplus" : "deficit"} this month</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: net >= 0 ? "#6ee7b7" : "#fca5a5" }}>Rs. {fmtNum(Math.abs(net))}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="Opening balance" value={statement.openingBalance} icon={Wallet} color="#4f46e5" bg="#eef2ff">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Cash &amp; bank on the 1st</span>
        </StatCard>
        <StatCard label="Total income" value={statement.totalIncome} icon={TrendingUp} color="#10b981" bg="#ecfdf5">
          <Delta pct={percentChange(statement.totalIncome, previous.totalIncome)} upIsGood />
        </StatCard>
        <StatCard label="Total expense" value={statement.totalExpense} icon={TrendingDown} color="#ef4444" bg="#fef2f2">
          <Delta pct={percentChange(statement.totalExpense, previous.totalExpense)} upIsGood={false} />
        </StatCard>
        <StatCard label="Closing balance" value={statement.closingBalance} icon={Scale} color="var(--primary)" bg="var(--primary-light)">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Opening + income − expense</span>
        </StatCard>
      </div>

      {!hasActivity && (
        <div style={{ ...card, padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
          Nothing recorded for {monthName(month)} {year}. Try another month, or turn on <strong>History</strong> in the top bar to include imported records.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
        <Section title="Income" section={statement.income} color="#10b981" tint="#f0fdf4" emptyText="No income recorded this month" />
        <Section title="Expense" section={statement.expense} color="#ef4444" tint="#fef2f2" emptyText="No expenses recorded this month" />
      </div>

      {allBranches && statement.cashAccounts.length > 0 && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ fontWeight: 700, fontSize: 15 }}>Bank &amp; Cash accounts</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Where the money sits, from your Chart of Accounts and payments</div>
          </div>
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "right" }}>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600 }}>Account</th>
                  {["Opening", "Money in", "Money out", "Closing"].map((h) => <th key={h} style={{ padding: "10px 20px", fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {statement.cashAccounts.map((a) => (
                  <tr key={a.name} style={{ borderTop: "1px solid #f1f5f9", textAlign: "right" }}>
                    <td style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600 }}>{a.name}</td>
                    <td style={{ padding: "10px 20px" }}>{fmtNum(a.opening)}</td>
                    <td style={{ padding: "10px 20px", color: "#10b981" }}>{fmtNum(a.moneyIn)}</td>
                    <td style={{ padding: "10px 20px", color: "#ef4444" }}>{fmtNum(a.moneyOut)}</td>
                    <td style={{ padding: "10px 20px", fontWeight: 700 }}>{fmtNum(a.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledgerGap !== 0 && (
            <div style={{ padding: "12px 20px", background: "#fffbeb", borderTop: "1px solid var(--border)", fontSize: 12, color: "#92400e" }}>
              The statement's closing balance is Rs. {fmtNum(Math.abs(ledgerGap))} {ledgerGap > 0 ? "higher" : "lower"} than the accounts above because some
              income or expenses this month weren't posted to a Bank &amp; Cash account (e.g. an expense saved without "paid from").
            </div>
          )}
        </div>
      )}
    </div>
  );
}
