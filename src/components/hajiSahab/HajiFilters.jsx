import React from "react";
import { Search, X } from "lucide-react";
import { SOURCES, QUARTERS, defaultFilters, activeFilterCount } from "../../utils/reportFilters";
import { card, inputStyle } from "./reportUi";

const chip = (on) => ({
  padding: "5px 12px", borderRadius: 16, cursor: "pointer", fontSize: 12, fontWeight: 600,
  border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
  background: on ? "var(--primary-light)" : "white", color: on ? "var(--primary)" : "#64748b",
});
const label = { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 };
const small = { ...inputStyle, padding: "6px 10px", fontSize: 13 };

const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Period, branches, kinds of record, Bank & Cash account, search, minimum amount.
// An empty list means "all". `period` modes: month (uses the month/year at the
// top), quarter (uses the year), custom (own dates).
export default function HajiFilters({ filters, onChange, branchChoices, cashAccounts }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const count = activeFilterCount(filters);
  const mode = (id, text) => (
    <button key={id} onClick={() => set({ mode: id })} style={chip(filters.mode === id)}>{text}</button>
  );

  return (
    <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div>
          <div style={label}>Period</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {mode("month", "Month")}{mode("quarter", "Quarter")}{mode("custom", "Custom dates")}
          </div>
          {filters.mode === "quarter" && (
            <select value={filters.quarter} onChange={(e) => set({ quarter: Number(e.target.value) })} style={small} aria-label="Quarter">
              {QUARTERS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          )}
          {filters.mode === "custom" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} style={small} aria-label="From date" />
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>to</span>
              <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} style={small} aria-label="To date" />
            </div>
          )}
          {filters.mode === "month" && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Use the month and year at the top.</div>}
        </div>

        {branchChoices.length > 1 && (
          <div>
            <div style={label}>Branches {filters.branches.length === 0 && <span style={{ textTransform: "none", fontWeight: 500 }}>· all</span>}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {branchChoices.map((b) => (
                <button key={b.id} onClick={() => set({ branches: toggleIn(filters.branches, b.id) })} style={chip(filters.branches.includes(b.id))}>{b.name}</button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={label}>Records {filters.sources.length === 0 && <span style={{ textTransform: "none", fontWeight: 500 }}>· all</span>}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SOURCES.map((s) => (
              <button key={s.id} onClick={() => set({ sources: toggleIn(filters.sources, s.id) })} style={chip(filters.sources.includes(s.id))}>{s.label}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={label}>Paid through</div>
          <select value={filters.account} onChange={(e) => set({ account: e.target.value })} style={{ ...small, width: "100%" }} aria-label="Bank or cash account">
            <option value="">Any account</option>
            {cashAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <div style={label}>Search</div>
          <div style={{ position: "relative" }}>
            <Search size={14} color="#94a3b8" style={{ position: "absolute", left: 10, top: 9 }} />
            <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Head, student, description…"
              style={{ ...small, width: "100%", paddingLeft: 30 }} aria-label="Search" />
          </div>
        </div>

        <div>
          <div style={label}>Minimum amount</div>
          <input type="number" min="0" value={filters.minAmount} onChange={(e) => set({ minAmount: e.target.value })} placeholder="e.g. 5000" style={{ ...small, width: "100%" }} aria-label="Minimum amount" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: count ? "#92400e" : "var(--text-muted)" }}>
          {count ? `${count} filter${count === 1 ? "" : "s"} on — totals and the closing balance cover only the matching records.` : "No filters — the full statement."}
        </div>
        {(count > 0 || filters.mode !== "month") && (
          <button onClick={() => onChange(defaultFilters())} style={{ ...small, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, color: "#475569" }}><X size={13} /> Clear filters</button>
        )}
      </div>
    </div>
  );
}
