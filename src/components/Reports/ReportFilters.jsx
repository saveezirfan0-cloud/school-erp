// src/components/Reports/ReportFilters.jsx
// The filter bar at the top of Reports: branch, period (presets or a
// custom date range), chart grouping and a previous-period comparison,
// plus a slot for tab-specific filters.

import React from "react";
import { RotateCcw, Download, Printer, RefreshCw, Mail } from "lucide-react";
import { DATE_PRESETS, GRANULARITIES, COMPARE_MODES } from "../../utils/reportData";

const control = { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", minWidth: 0 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" };

export function Field({ label, children }) {
  return <label style={{ display: "block" }}><span style={labelStyle}>{label}</span>{children}</label>;
}

export function Select({ value, onChange, options, label, allLabel }) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} style={control}>
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export default function ReportFilters({
  branchOptions, branch, onBranch,
  preset, onPreset, custom, onCustom,
  showPeriod = true, periodLabel = "Period",
  granularity, onGranularity,
  compareMode, onCompareMode, showCompare = false,
  children,                       // tab-specific filters
  dirty, onReset,
  summary,                        // e.g. "Main Office · 1 Jan 2026 – 31 Dec 2026"
  onRefresh, refreshing,
  onCSV, onPDF, onEmail,
}) {
  return (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Select label="Branch" value={branch} onChange={onBranch} options={branchOptions} />
        {showPeriod && <Select label={periodLabel} value={preset} onChange={onPreset} options={DATE_PRESETS.map(p => ({ value: p.id, label: p.label }))} />}
        {showPeriod && preset === "custom" && (
          <>
            <Field label="From"><input type="date" value={custom.from} max={custom.to || undefined} onChange={e => onCustom({ ...custom, from: e.target.value })} style={control} /></Field>
            <Field label="To"><input type="date" value={custom.to} min={custom.from || undefined} onChange={e => onCustom({ ...custom, to: e.target.value })} style={control} /></Field>
          </>
        )}
        {granularity !== undefined && <Select label="Group by" value={granularity} onChange={onGranularity} options={GRANULARITIES.map(g => ({ value: g.id, label: g.label }))} />}
        {children}
        {showCompare && <Select label="Compare with" value={compareMode} onChange={onCompareMode} options={COMPARE_MODES.map(m => ({ value: m.id, label: m.label }))} />}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dirty && <button onClick={onReset} style={btn}><RotateCcw size={13} /> Reset</button>}
          {onRefresh && <button onClick={onRefresh} disabled={refreshing} style={btn} title="Reload the latest data"><RefreshCw size={13} /> {refreshing ? "Loading…" : "Refresh"}</button>}
          {onCSV && <button onClick={onCSV} style={btn}><Download size={13} /> CSV</button>}
          {onPDF && <button onClick={onPDF} style={btn}><Printer size={13} /> PDF</button>}
          {onEmail && <button onClick={onEmail} style={btn} title="Open an email with a text summary of this report"><Mail size={13} /> Email summary</button>}
        </div>
      </div>
      {summary && <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>Showing: <strong style={{ color: "#334155" }}>{summary}</strong></div>}
    </div>
  );
}

const btn = { ...control, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#475569" };
export { control as controlStyle };
