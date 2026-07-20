// src/components/UI/BulkBar.jsx
//
// The floating bar that appears at the bottom of a list page when one
// or more rows are ticked. Shows the selection count, a "Select all N"
// shortcut when only part of the filtered set is selected, the page's
// bulk actions (Edit / Delete / Mark Paid / ...), and Clear.
//
// Also exports the shared RowCheckbox / HeaderCheckbox so every page
// renders selection controls identically (header supports the
// half-checked "indeterminate" state).

import React, { useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";

const VARIANTS = {
  default: { background: "white", color: "#334155", border: "1px solid var(--border)" },
  primary: { background: "var(--primary)", color: "white", border: "none" },
  success: { background: "#ecfdf5", color: "#10b981", border: "1px solid #a7f3d0" },
  danger:  { background: "#fef2f2", color: "var(--danger)", border: "1px solid #fecaca" },
};

export default function BulkBar({
  count,
  total = 0,          // filtered row count, to offer "Select all N"
  noun = "items",     // "invoices", "expenses", ...
  actions = [],       // [{ label, icon: LucideIcon, onClick, variant }]
  onSelectAll,
  onClear,
  busy = false,
}) {
  if (count === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
      zIndex: 900, background: "#1e293b", color: "white",
      borderRadius: 14, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      justifyContent: "center",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.35)",
      maxWidth: "calc(100vw - 24px)",
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
        {count} selected
      </span>

      {onSelectAll && total > count && (
        <button onClick={onSelectAll} disabled={busy}
          style={{ border: "none", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "4px 2px", whiteSpace: "nowrap" }}>
          Select all {total} {noun}
        </button>
      )}

      <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.2)" }} />

      {actions.map(({ label, icon: Icon, onClick, variant = "default" }) => (
        <button key={label} onClick={onClick} disabled={busy}
          style={{
            ...VARIANTS[variant] || VARIANTS.default,
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 12px", borderRadius: 8, cursor: busy ? "wait" : "pointer",
            fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1, whiteSpace: "nowrap",
          }}>
          {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : (Icon && <Icon size={14} />)}
          {label}
        </button>
      ))}

      <button onClick={onClear} disabled={busy} title="Clear selection"
        style={{ border: "none", background: "rgba(255,255,255,0.12)", color: "white", padding: 8, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center" }}>
        <X size={14} />
      </button>
    </div>
  );
}

const checkStyle = {
  width: 17, height: 17, cursor: "pointer",
  accentColor: "var(--primary)", flexShrink: 0, margin: 0,
};

// Checkbox for a single row (table cell or mobile card).
export function RowCheckbox({ checked, onChange, label = "Select row" }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      style={checkStyle}
    />
  );
}

// Header "select page" checkbox with indeterminate support.
export function HeaderCheckbox({ checked, indeterminate, onChange, label = "Select all on this page" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      style={checkStyle}
    />
  );
}
