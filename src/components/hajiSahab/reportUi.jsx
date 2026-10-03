import React from "react";
import { fmtNum, fmtMoney, percentChange } from "../../utils/monthlyStatement";
import { tr } from "../../config/reportI18n";

export const card = { background: "white", borderRadius: 12, border: "1px solid var(--border)" };
export const inputStyle = { padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" };
export const iconBtn = { ...inputStyle, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center" };
export const primaryBtn = { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 };

// Small "▲ 12% vs last month" tag. For expenses a rise is bad, so `upIsGood` flips the colour.
export function Delta({ current, previous, upIsGood, lang, single = true }) {
  const pct = percentChange(current, previous);
  if (pct === null) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;
  if (pct === 0) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>=</span>;
  const good = (pct > 0) === upIsGood;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: good ? "#10b981" : "#ef4444" }}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct) > 999 ? "999%+" : `${Math.abs(pct)}%`}{" "}
      <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>{lang === "ur" ? (single ? "پچھلے مہینے سے" : "پچھلی مدت سے") : (single ? "vs last month" : "vs previous period")}</span>
    </span>
  );
}

export function StatCard({ label, value, icon: Icon, color, bg, children }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <Icon size={17} color={color} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{fmtMoney(value)}</div>
      <div style={{ marginTop: 4, minHeight: 15 }}>{children}</div>
    </div>
  );
}

// Budget progress for a section: "Budget 50,000 · 12,000 left" / "over by".
// For expenses, going over is bad; for income, falling short of the target is.
export function BudgetLine({ group, tone, lang }) {
  if (!group.budget || group.excluded) return null;
  const pct = Math.round((group.total / group.budget) * 100);
  const diff = group.budget - group.total;
  const bad = tone === "expense" ? pct > 100 : pct < 100;
  const warn = tone === "expense" && pct > 80 && pct <= 100;
  const color = bad && tone === "expense" ? "#ef4444" : warn ? "#f59e0b" : tone === "income" && pct >= 100 ? "#10b981" : tone === "income" ? "#f59e0b" : "#10b981";
  const text = tone === "expense"
    ? (diff >= 0 ? `${fmtNum(diff)} left` : `over by ${fmtNum(-diff)}`)
    : (diff <= 0 ? "target reached" : `${fmtNum(diff)} to target`);
  return (
    <div style={{ marginLeft: 23, marginTop: 6 }}>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>
        {tr(lang, "budget")} {fmtNum(group.budget)} · {pct}% · {text}
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(0,0,0,0.06)", marginTop: 3 }}>
        <div style={{ height: 3, borderRadius: 2, background: color, width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
