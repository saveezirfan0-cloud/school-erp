import React from "react";
import { CalendarDays } from "lucide-react";
import { PERIOD_MODES, yearOptions, fiscalYearLabel, fiscalYearOf, describePeriod, resolveRange } from "../../utils/dateRange";

const field = { padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" };

// Period picker: presets, calendar year, fiscal year (with year dropdown) and
// a custom from/to range. Controlled: value = { mode, year, from, to }.
export default function DateRangeFilter({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const onMode = (mode) => {
    // Switching kinds resets to the current calendar / fiscal year.
    const patch = { mode };
    if (mode === "calendar") patch.year = new Date().getFullYear();
    if (mode === "fiscal") patch.year = fiscalYearOf();
    set(patch);
  };

  const range = resolveRange(value);

  return (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <CalendarDays size={16} color="var(--text-muted)" />
      <select style={field} value={value.mode} onChange={(e) => onMode(e.target.value)} aria-label="Period">
        {PERIOD_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>

      {(value.mode === "calendar" || value.mode === "fiscal") && (
        <select style={field} value={value.year} onChange={(e) => set({ year: Number(e.target.value) })} aria-label="Year">
          {yearOptions(value.mode).map((y) => (
            <option key={y} value={y}>{value.mode === "fiscal" ? fiscalYearLabel(y) : y}</option>
          ))}
        </select>
      )}

      {value.mode === "custom" && (
        <>
          <input type="date" style={field} value={value.from || ""} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>to</span>
          <input type="date" style={field} value={value.to || ""} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        </>
      )}

      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>{describePeriod(value, range)}</span>
    </div>
  );
}
