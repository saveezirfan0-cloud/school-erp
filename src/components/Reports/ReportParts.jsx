// src/components/Reports/ReportParts.jsx
// Small presentational building blocks shared by the Reports tabs.

import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { formatRs } from "../../utils/reportData";

export const cardStyle = { background: "white", borderRadius: 12, border: "1px solid var(--border)" };

export function Card({ title, subtitle, right, children, pad = 24, style }) {
  return (
    <div style={{ ...cardStyle, overflow: "hidden", ...style }}>
      {(title || right) && (
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: 15 }}>{title}</h3>
            {subtitle && <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

// "+12%" / "-Rs. 4,000" vs the previous period. `goodWhen` says which
// direction is good news (expenses going down is good).
export function Delta({ delta, goodWhen = "up", compact = false }) {
  if (!delta) return null;
  const { amount, pct, unit } = delta;
  const flat = Math.abs(amount) < 0.5;
  const up = amount > 0;
  const good = flat ? null : (goodWhen === "up") === up;
  const color = flat ? "#64748b" : good ? "#059669" : "#dc2626";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = flat ? (compact ? "—" : "no change") : unit === "pts" ? `${up ? "+" : "-"}${Math.abs(Math.round(amount))} pts` : pct === null ? `${up ? "+" : "-"}${formatRs(Math.abs(amount))}` : `${up ? "+" : "-"}${Math.abs(Math.round(pct * 100))}%`;
  return (
    <span title={unit === "pts" ? "Percentage points vs comparison period" : `${up ? "+" : "-"}${formatRs(Math.abs(amount))} vs comparison period`}
      style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: compact ? 11 : 12, fontWeight: 600, color, whiteSpace: "nowrap" }}>
      <Icon size={compact ? 12 : 14} /> {text}
    </span>
  );
}

export function KpiCard({ label, value, sub, delta, goodWhen, color = "#1e293b", bg = "#f8fafc" }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: 16, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, overflowWrap: "anywhere" }}>{value}</div>
      <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minHeight: 18 }}>
        <Delta delta={delta} goodWhen={goodWhen} />
        {sub && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</span>}
      </div>
    </div>
  );
}

export function KpiGrid({ children, columns = 4 }) {
  return (
    <div className="grid-2-mobile" style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 16, marginBottom: 24 }}>
      {children}
    </div>
  );
}

const TONES = { good: "#10b981", bad: "#ef4444", warn: "#f59e0b", info: "#4f46e5" };
export function Highlights({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <Card title="Highlights" style={{ marginBottom: 24 }} pad="12px 24px">
      {items.map((h, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 14, alignItems: "flex-start" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: TONES[h.tone] || TONES.info, marginTop: 7, flexShrink: 0 }} />
          <span>{h.text}</span>
        </div>
      ))}
    </Card>
  );
}

// Ranked horizontal bars: label, amount, share. Long tails fold into "Other".
export function BarList({ rows, color = "#7a2535", limit = 8, empty = "No data for this selection." }) {
  if (!rows || rows.length === 0) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{empty}</div>;
  let shown = rows;
  if (rows.length > limit) {
    const rest = rows.slice(limit - 1);
    shown = [...rows.slice(0, limit - 1), {
      label: `Other (${rest.length})`, amount: rest.reduce((s, r) => s + r.amount, 0),
      share: rest.reduce((s, r) => s + (r.share || 0), 0),
    }];
  }
  const max = Math.max(...shown.map(r => r.amount), 1);
  return (
    <div>
      {shown.map(r => (
        <div key={r.label} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
            <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              {formatRs(r.amount)} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {Math.round((r.share || 0) * 100)}%</span>
            </span>
          </div>
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4 }}>
            <div style={{ height: 8, width: `${Math.max(2, (r.amount / max) * 100)}%`, background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// columns: [{ key, label, align, render(row) }]
export function DataTable({ columns, rows, empty = "Nothing to show.", footer, rowKey, onRowClick, activeKey }) {
  const th = { padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", background: "#f8fafc", borderBottom: "1px solid var(--border)" };
  const td = { padding: "10px 14px", fontSize: 13, borderBottom: "1px solid var(--border)" };
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={{ ...th, textAlign: c.align || "left" }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: 24 }}>{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={onRowClick ? { cursor: "pointer", background: activeKey !== undefined && rowKey && rowKey(r) === activeKey ? "var(--primary-light)" : undefined } : undefined}>
              {columns.map(c => <td key={c.key} style={{ ...td, textAlign: c.align || "left", whiteSpace: c.nowrap === false ? "normal" : "nowrap" }}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot><tr>{footer.map((f, i) => <td key={i} style={{ ...td, fontWeight: 700, background: "#f8fafc", textAlign: columns[i]?.align || "left" }}>{f}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

// Compact axis numbers: 1,250,000 -> 1.3M
export const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
};
export const moneyTip = (v) => formatRs(v);
