// src/components/UI/BulkEditModal.jsx
//
// Generic "edit N records at once" modal. Each page describes its
// editable fields; only the fields the user *ticks* are applied, so
// there is never any ambiguity about what a blank input means.
//
// Field shape:
//   {
//     key: "dueDate",
//     label: "Due Date",
//     type: "text" | "number" | "date" | "select" | "boolean",
//     options: [{ value, label }],   // for type: "select"
//     hint: "small helper text",     // optional, shown under the input
//   }
//
// onApply receives an object containing ONLY the ticked fields, with
// numbers converted to Number and booleans to true/false.

import React, { useState } from "react";
import { X, Loader2, Pencil } from "lucide-react";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function BulkEditModal({ title, note, fields, busy, onApply, onClose }) {
  const isMobile = useIsMobile();
  const [enabled, setEnabled] = useState({});   // { key: bool }
  const [values, setValues] = useState({});     // { key: string }

  const toggleField = (key) =>
    setEnabled((p) => ({ ...p, [key]: !p[key] }));
  const setValue = (key, v) =>
    setValues((p) => ({ ...p, [key]: v }));

  const enabledFields = fields.filter((f) => enabled[f.key]);
  const missing = enabledFields.filter((f) => {
    const v = values[f.key];
    return v === undefined || v === "";
  });
  const canApply = enabledFields.length > 0 && missing.length === 0 && !busy;

  const handleApply = () => {
    const changes = {};
    for (const f of enabledFields) {
      const raw = values[f.key];
      if (f.type === "number") changes[f.key] = Number(raw);
      else if (f.type === "boolean") changes[f.key] = raw === "true";
      else changes[f.key] = raw;
    }
    onApply(changes);
  };

  const inputStyle = (on) => ({
    width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
    border: "1px solid var(--border)", boxSizing: "border-box",
    background: on ? "white" : "#f8fafc",
    color: on ? "#1e293b" : "var(--text-muted)",
  });

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
      <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 460, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Pencil size={16} /> {title}
          </h3>
          <button onClick={onClose} disabled={busy} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          {note || "Tick a field to change it on every selected record. Unticked fields are left untouched."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {fields.map((f) => {
            const on = !!enabled[f.key];
            return (
              <div key={f.key} style={{ border: "1px solid " + (on ? "var(--primary)" : "var(--border)"), borderRadius: 10, padding: "10px 12px", background: on ? "var(--primary-light)" : "white", transition: "all 0.15s" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", marginBottom: on ? 8 : 0 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleField(f.key)}
                    style={{ width: 16, height: 16, accentColor: "var(--primary)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
                </label>

                {on && (
                  <>
                    {f.type === "select" || f.type === "boolean" ? (
                      <select value={values[f.key] ?? ""} onChange={(e) => setValue(f.key, e.target.value)} style={inputStyle(on)}>
                        <option value="">Select…</option>
                        {(f.type === "boolean"
                          ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }]
                          : f.options || []
                        ).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValue(f.key, e.target.value)}
                        placeholder={f.placeholder || ""}
                        style={inputStyle(on)}
                      />
                    )}
                    {f.hint && <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>{f.hint}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>
            Cancel
          </button>
          <button type="button" onClick={handleApply} disabled={!canApply}
            style={{ flex: 2, padding: "11px", background: canApply ? "var(--primary)" : "#cbd5e1", color: "white", border: "none", borderRadius: 8, cursor: canApply ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {busy && <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
            {busy ? "Applying…" : "Apply Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
