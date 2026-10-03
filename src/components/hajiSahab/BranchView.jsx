import React from "react";
import { fmtNum } from "../../utils/monthlyStatement";
import { pick, tr } from "../../config/reportI18n";
import { card } from "./reportUi";

const cell = { padding: "9px 14px", textAlign: "end", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const first = { ...cell, textAlign: "start", position: "sticky", insetInlineStart: 0, background: "white", minWidth: 180, zIndex: 1 };

function Block({ side, tone, titleKey, lang }) {
  const color = tone === "in" ? "#10b981" : "#ef4444";
  return (
    <>
      <tr><td colSpan={side.totals.length + 2} style={{ padding: "8px 14px", background: tone === "in" ? "#f0fdf4" : "#fef2f2", fontWeight: 700, fontSize: 12, color: "var(--sidebar-bg)", textTransform: "uppercase", letterSpacing: 0.5 }}>{tr(lang, titleKey)}</td></tr>
      {side.rows.map((r) => (
        <tr key={r.key} style={{ borderTop: "1px solid #f1f5f9" }}>
          <td style={first}>{pick(lang, r.label, r.labelUr)}</td>
          {r.values.map((v, i) => <td key={i} style={{ ...cell, color: v ? undefined : "#cbd5e1" }}>{v ? fmtNum(v) : "–"}</td>)}
          <td style={{ ...cell, fontWeight: 700 }}>{fmtNum(r.total)}</td>
        </tr>
      ))}
      <tr style={{ borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
        <td style={{ ...first, background: "#f8fafc", fontWeight: 700 }}>{tr(lang, titleKey === "income" ? "totalIncome" : "totalExpense")}</td>
        {side.totals.map((v, i) => <td key={i} style={{ ...cell, fontWeight: 700, color }}>{fmtNum(v)}</td>)}
        <td style={{ ...cell, fontWeight: 700, color }}>{fmtNum(side.total)}</td>
      </tr>
    </>
  );
}

// Branches side by side for the selected month.
export default function BranchView({ matrix, options }) {
  const lang = options.language || "en";
  const empty = !matrix.income.total && !matrix.expense.total;
  return (
    <div dir={lang === "ur" ? "rtl" : "ltr"} style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ fontWeight: 700, fontSize: 15 }}>Branch comparison</h3>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Every branch for this month, with your report layout applied. Account balances are organisation-wide, so they aren't split by branch.</div>
      </div>
      {empty ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Nothing recorded for this month.</div>
      ) : (
        <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ ...first, background: "#f8fafc" }} />
                {matrix.branches.map((b) => <th key={b.id} style={{ ...cell, fontWeight: 600 }}>{b.name}</th>)}
                <th style={{ ...cell, fontWeight: 700 }}>{tr(lang, "total")}</th>
              </tr>
            </thead>
            <tbody>
              <Block side={matrix.income} tone="in" titleKey="income" lang={lang} />
              <Block side={matrix.expense} tone="out" titleKey="expense" lang={lang} />
              <tr style={{ borderTop: "2px solid var(--border)", background: "var(--primary-light)" }}>
                <td style={{ ...first, background: "var(--primary-light)", fontWeight: 700 }}>{tr(lang, "net")}</td>
                {matrix.nets.map((v, i) => <td key={i} style={{ ...cell, fontWeight: 700, color: v >= 0 ? "#10b981" : "#ef4444" }}>{fmtNum(v)}</td>)}
                <td style={{ ...cell, fontWeight: 700, color: matrix.netTotal >= 0 ? "#10b981" : "#ef4444" }}>{fmtNum(matrix.netTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
