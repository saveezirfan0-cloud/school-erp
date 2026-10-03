// Shared controls for the report pages: a date-range bar and the
// "results may be incomplete / failed to load" banner.

import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DATE_PRESETS, presetRange } from "../utils/reporting";

export function useDateRange(defaultPreset = "ytd") {
  const [preset, setPresetState] = useState(defaultPreset);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset)),
    [preset, custom]
  );
  const setPreset = (p) => {
    // Start a custom range from the one that was showing.
    if (p === "custom" && preset !== "custom") setCustom(presetRange(preset));
    setPresetState(p);
  };
  return { preset, range, setPreset, custom, setCustom };
}

const field = { padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" };

export function DateRangeBar({ dr, note }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
      <select value={dr.preset} onChange={(e) => dr.setPreset(e.target.value)} style={field} aria-label="Period">
        {DATE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {dr.preset === "custom" && (
        <>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>From{" "}
            <input type="date" value={dr.custom.from} max={dr.custom.to || undefined}
              onChange={(e) => dr.setCustom((c) => ({ ...c, from: e.target.value }))} style={field} />
          </label>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>To{" "}
            <input type="date" value={dr.custom.to} min={dr.custom.from || undefined}
              onChange={(e) => dr.setCustom((c) => ({ ...c, to: e.target.value }))} style={field} />
          </label>
        </>
      )}
      {dr.preset !== "custom" && dr.range.from && (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{dr.range.from} to {dr.range.to}</span>
      )}
      {note && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{note}</span>}
    </div>
  );
}

const LABELS = {
  invoices: "invoices", payments: "payments", expenses: "expenses", payslips: "payslips",
  students: "students", accounts: "accounts", journals: "journals", employees: "employees",
  branches: "branches", auditLog: "log entries",
};

// capped: names of collections that returned exactly the row cap.
// errors: { name: message } for queries that failed.
export function DataWarnings({ capped = [], errors = {} }) {
  const errNames = Object.keys(errors);
  if (capped.length === 0 && errNames.length === 0) return null;
  const box = (bg, border, color) => ({ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginBottom: 12, borderRadius: 10, background: bg, border: `1px solid ${border}`, color, fontSize: 13 });
  return (
    <div role="alert">
      {capped.length > 0 && (
        <div style={box("#fffbeb", "#fcd34d", "#92400e")}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>Results may be incomplete.</strong> The {capped.map((n) => LABELS[n] || n).join(", ")} query returned exactly
            1,000 rows, which is the most the server sends in one request, so some records may be missing and the totals below could be too low.
          </span>
        </div>
      )}
      {errNames.length > 0 && (
        <div style={box("#fef2f2", "#fca5a5", "#991b1b")}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>Some data could not be loaded</strong> ({errNames.map((n) => LABELS[n] || n).join(", ")}). Figures that depend on it
            are shown as zero and are not reliable. You may not have access to these records, or the connection failed.
          </span>
        </div>
      )}
    </div>
  );
}

export const money = (v) => `Rs. ${Number(v || 0).toLocaleString()}`;
