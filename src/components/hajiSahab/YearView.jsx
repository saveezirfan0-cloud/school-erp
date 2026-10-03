import React from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { TrendingUp, TrendingDown, Scale, CalendarDays } from "lucide-react";
import { fmtNum, monthName } from "../../utils/monthlyStatement";
import { pick, tr, monthLabel } from "../../config/reportI18n";
import { card, StatCard } from "./reportUi";

const cell = { padding: "8px 10px", textAlign: "end", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const first = { ...cell, textAlign: "start", position: "sticky", insetInlineStart: 0, background: "white", minWidth: 170, zIndex: 1 };

function Rows({ side, tone, titleKey, lang }) {
  const color = tone === "in" ? "#10b981" : "#ef4444";
  return (
    <>
      <tr><td colSpan={14} style={{ padding: "8px 10px", background: tone === "in" ? "#f0fdf4" : "#fef2f2", fontWeight: 700, fontSize: 12, color: "var(--sidebar-bg)", textTransform: "uppercase", letterSpacing: 0.5 }}>{tr(lang, titleKey)}</td></tr>
      {side.rows.map((r) => (
        <tr key={r.key} style={{ borderTop: "1px solid #f1f5f9" }}>
          <td style={first}>
            {pick(lang, r.label, r.labelUr)}
            {r.excluded && <span style={{ marginInlineStart: 6, fontSize: 9, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "1px 6px" }}>{tr(lang, "notCounted")}</span>}
          </td>
          {r.values.map((v, i) => <td key={i} style={{ ...cell, color: v ? undefined : "#cbd5e1" }}>{v ? fmtNum(v) : "–"}</td>)}
          <td style={{ ...cell, fontWeight: 700 }}>{fmtNum(r.total)}</td>
        </tr>
      ))}
      <tr style={{ borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
        <td style={{ ...first, background: "#f8fafc", fontWeight: 700 }}>{tr(lang, titleKey === "income" ? "totalIncome" : "totalExpense")}</td>
        {side.totals.map((v, i) => <td key={i} style={{ ...cell, fontWeight: 700, color }}>{v ? fmtNum(v) : "–"}</td>)}
        <td style={{ ...cell, fontWeight: 700, color }}>{fmtNum(side.total)}</td>
      </tr>
    </>
  );
}

export default function YearView({ table, year, options }) {
  const lang = options.language || "en";
  const chart = Array.from({ length: 12 }, (_, i) => ({
    month: monthLabel(lang, i + 1, monthName(i + 1).slice(0, 3)),
    income: table.income.totals[i], expense: table.expense.totals[i], net: table.net[i],
  }));
  const active = Math.max(1, table.monthsWithActivity);
  const best = chart.reduce((b, m) => (m.net > b.net ? m : b), chart[0]);

  return (
    <div dir={lang === "ur" ? "rtl" : "ltr"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label={`${tr(lang, "totalIncome")} ${year}`} value={table.income.total} icon={TrendingUp} color="#10b981" bg="#ecfdf5">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Avg {fmtNum(Math.round(table.income.total / active))} / month</span>
        </StatCard>
        <StatCard label={`${tr(lang, "totalExpense")} ${year}`} value={table.expense.total} icon={TrendingDown} color="#ef4444" bg="#fef2f2">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Avg {fmtNum(Math.round(table.expense.total / active))} / month</span>
        </StatCard>
        <StatCard label={`${tr(lang, table.netTotal >= 0 ? "surplus" : "deficit")} ${year}`} value={Math.abs(table.netTotal)} icon={Scale} color="var(--primary)" bg="var(--primary-light)">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Income − expense</span>
        </StatCard>
        <StatCard label="Best month" value={Math.max(0, best.net)} icon={CalendarDays} color="#4f46e5" bg="#eef2ff">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{best.net > 0 ? best.month : "No surplus month yet"}</span>
        </StatCard>
      </div>

      <div style={{ ...card, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{tr(lang, "income")} vs {tr(lang, "expense")}</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chart} margin={{ left: -8 }}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip formatter={(v) => `Rs. ${Number(v).toLocaleString()}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name={tr(lang, "income")} fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name={tr(lang, "expense")} fill="#ef4444" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="net" name={tr(lang, "net")} stroke="#7a2535" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ ...first, background: "#f8fafc", fontWeight: 600 }} />
                {Array.from({ length: 12 }, (_, i) => <th key={i} style={{ ...cell, fontWeight: 600 }}>{monthLabel(lang, i + 1, monthName(i + 1).slice(0, 3))}</th>)}
                <th style={{ ...cell, fontWeight: 700 }}>{tr(lang, "total")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={first}>{tr(lang, "opening")}</td>
                {table.opening.map((v, i) => <td key={i} style={{ ...cell, color: "var(--text-muted)" }}>{fmtNum(v)}</td>)}
                <td style={cell} />
              </tr>
              <Rows side={table.income} tone="in" titleKey="income" lang={lang} />
              <Rows side={table.expense} tone="out" titleKey="expense" lang={lang} />
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td style={{ ...first, fontWeight: 700 }}>{tr(lang, "net")}</td>
                {table.net.map((v, i) => <td key={i} style={{ ...cell, fontWeight: 700, color: v >= 0 ? "#10b981" : "#ef4444" }}>{v ? fmtNum(v) : "–"}</td>)}
                <td style={{ ...cell, fontWeight: 700, color: table.netTotal >= 0 ? "#10b981" : "#ef4444" }}>{fmtNum(table.netTotal)}</td>
              </tr>
              <tr style={{ background: "var(--primary-light)" }}>
                <td style={{ ...first, background: "var(--primary-light)", fontWeight: 700 }}>{tr(lang, "closing")}</td>
                {table.closing.map((v, i) => <td key={i} style={{ ...cell, fontWeight: 600 }}>{fmtNum(v)}</td>)}
                <td style={cell} />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--text-muted)", background: "#f8fafc", borderTop: "1px solid var(--border)" }}>
          Opening and closing balances roll forward from January's opening balance using the income and expense shown. A single month's statement takes its opening from your Bank &amp; Cash accounts, so the two can differ if some entries weren't posted to an account.
        </div>
      </div>
    </div>
  );
}
