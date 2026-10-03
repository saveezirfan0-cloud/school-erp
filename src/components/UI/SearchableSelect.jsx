// src/components/UI/SearchableSelect.jsx
//
// A type-to-search dropdown for picking one record from a long list
// (students, employees, accounts...). Drop-in replacement for a
// native <select> where the option list is large.
//
// Usage:
//   <SearchableSelect
//     value={studentId}
//     onChange={setStudentId}
//     options={students.map(s => ({ value: s.id, label: `${s.name} (${s.studentId})`, sublabel: s.grade }))}
//     placeholder="Search student..."
//     rememberKey="fees.student"   // optional: remember the last pick
//   />
//
// With `rememberKey`, the last option picked is saved in localStorage and
// pre-selected the next time the control opens empty (e.g. a fresh form).
// Clearing the field with the X forgets it.

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";

export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Search...",
  emptyText = "No matches",
  allowClear = true,
  disabled = false,
  rememberKey = null,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const storageKey = rememberKey ? `searchSelect:${rememberKey}` : null;
  const restored = useRef(false);

  const selected = options.find((o) => String(o.value) === String(value));

  // Pre-select the remembered choice once, as soon as it is in the options
  // (options often arrive after mount). Never fights a value the form set,
  // and never re-applies after the user clears it.
  useEffect(() => {
    if (!storageKey || restored.current || disabled) return;
    if (value) { restored.current = true; return; }
    if (options.length === 0) return;
    let saved = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* storage unavailable */ }
    restored.current = true;
    if (saved && options.some((o) => String(o.value) === saved)) onChange(saved);
  }, [storageKey, options, value, disabled]);

  const remember = (val) => {
    if (!storageKey) return;
    try {
      if (val === "" || val == null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(val));
    } catch { /* storage unavailable */ }
  };

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Focus the search box when opening.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) =>
        (o.label || "").toLowerCase().includes(q) ||
        (o.sublabel || "").toLowerCase().includes(q))
    : options;

  const pick = (opt) => {
    onChange(opt.value);
    remember(opt.value);
    setOpen(false);
    setQuery("");
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const field = {
    width: "100%", padding: "10px 12px", border: "1px solid var(--border)",
    borderRadius: 8, fontSize: 14, background: disabled ? "#f8fafc" : "white",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    cursor: disabled ? "not-allowed" : "pointer", boxSizing: "border-box", gap: 8,
  };

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      {/* trigger */}
      <div style={field} onClick={() => !disabled && setOpen((o) => !o)}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "#1e293b" : "var(--text-muted)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {allowClear && selected && !disabled && (
            <X size={15} style={{ color: "var(--text-muted)" }}
              onClick={(e) => { e.stopPropagation(); onChange(""); remember(""); }} />
          )}
          <ChevronDown size={16} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </span>
      </div>

      {/* dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 1100,
          background: "white", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)", position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder={placeholder}
              style={{ width: "100%", padding: "8px 8px 8px 28px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
            />
          </div>
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{emptyText}</div>
            ) : (
              filtered.map((opt, i) => {
                const isSel = String(opt.value) === String(value);
                return (
                  <div
                    key={opt.value}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(opt)}
                    style={{
                      padding: "9px 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      background: i === highlight ? "var(--primary-light)" : "transparent",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opt.label}</div>
                      {opt.sublabel && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{opt.sublabel}</div>}
                    </div>
                    {isSel && <Check size={15} style={{ color: "var(--primary)", flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
