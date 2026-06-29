// src/components/UI/ListToolbar.jsx
// Shared toolbar for list pages: a search box, any number of filter
// dropdowns, an optional sort control, and a Clear button that only
// appears when something is active. Keeps every CRM page consistent.

import React from "react";
import { Search, X, ArrowUpDown } from "lucide-react";

export default function ListToolbar({
  search, onSearch, searchPlaceholder = "Search...",
  filters = [],        // [{ key, value, onChange, options:[{value,label}], placeholder }]
  sort = null,         // { field, dir, onSortField, onToggleDir, options:[{value,label}] }
  onClear,
  active = false,      // whether Clear should show
  rightSlot = null,    // optional extra controls
}) {
  const inputStyle = {
    padding: "8px 10px", border: "1px solid var(--border)",
    borderRadius: 8, fontSize: 13, background: "white",
  };

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      {onSearch && (
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ ...inputStyle, width: "100%", padding: "8px 8px 8px 30px", boxSizing: "border-box" }}
          />
        </div>
      )}

      {filters.map((f) => (
        <select key={f.key} value={f.value} onChange={(e) => f.onChange(e.target.value)} style={inputStyle}>
          <option value="">{f.placeholder || "All"}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}

      {sort && (
        <div style={{ display: "flex", gap: 4 }}>
          <select value={sort.field || ""} onChange={(e) => sort.onSortField(e.target.value)} style={inputStyle} aria-label="Sort by">
            <option value="">Sort by…</option>
            {sort.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={sort.onToggleDir}
            title={sort.dir === "desc" ? "Descending" : "Ascending"}
            style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <ArrowUpDown size={14} />
            {sort.dir === "desc" ? "Z→A" : "A→Z"}
          </button>
        </div>
      )}

      {rightSlot}

      {active && onClear && (
        <button onClick={onClear} style={{ ...inputStyle, cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <X size={13} /> Clear
        </button>
      )}
    </div>
  );
}
