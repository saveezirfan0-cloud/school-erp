// src/components/UI/MultiSelect.jsx
//
// A dropdown that lets you tick several options at once (e.g. filter
// students by more than one class). Empty selection means "all".
//
// Usage:
//   <MultiSelect
//     values={grades}
//     onChange={setGrades}
//     options={[{ value: "Hifz", label: "Hifz" }, ...]}
//     placeholder="All Classes"
//   />

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export default function MultiSelect({
  values = [],
  onChange,
  options = [],
  placeholder = "All",
  searchable = true,
  minWidth = 150,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = new Set(values.map(String));
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options;

  const toggle = (val) => {
    const key = String(val);
    onChange(selected.has(key) ? values.filter((v) => String(v) !== key) : [...values, val]);
  };

  const summary = values.length === 0
    ? placeholder
    : values.length <= 2
      ? values.map((v) => options.find((o) => String(o.value) === String(v))?.label ?? v).join(", ")
      : `${values.length} selected`;

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8,
          fontSize: 13, background: "white", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left",
          color: values.length ? "#1e293b" : "var(--text-muted)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: Math.max(minWidth, 200), zIndex: 1100,
          background: "white", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          {searchable && options.length > 6 && (
            <div style={{ padding: 8, borderBottom: "1px solid var(--border)", position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                style={{ width: "100%", padding: "6px 8px 6px 26px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
          )}
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {shown.length === 0 ? (
              <div style={{ padding: 14, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No matches</div>
            ) : shown.map((o) => (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={selected.has(String(o.value))}
                  onChange={() => toggle(o.value)}
                  style={{ width: 16, height: 16, accentColor: "var(--primary)", margin: 0 }}
                />
                {o.label}
              </label>
            ))}
          </div>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ width: "100%", padding: "8px 12px", border: "none", borderTop: "1px solid var(--border)", background: "#f8fafc", cursor: "pointer", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <X size={12} /> Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
