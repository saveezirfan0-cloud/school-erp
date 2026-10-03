import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, Pencil, Check, Star, Users } from "lucide-react";

const field = { padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", minWidth: 0 };
const ghost = (color = "#64748b") => ({ border: "none", background: "transparent", cursor: "pointer", padding: 5, borderRadius: 6, display: "flex", alignItems: "center", color });

// Lists shared and personal presets with rename / delete / share / default.
// `onAction({ type, preset, name? })` does the saving; types:
//   use | rename | delete | share (mine -> shared) | default | undefault
export default function PresetManager({ presets, activeId, isAdmin, sharedAvailable, onAction, onClose }) {
  const [editing, setEditing] = useState(null); // preset id being renamed
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action) => {
    setBusy(true);
    try { await onAction(action); } finally { setBusy(false); }
  };
  const editable = (p) => p.kind === "mine" || (p.kind === "shared" && isAdmin);

  const rows = presets.filter((p) => p.kind !== "builtin");
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label="Manage presets"
        style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>Report presets</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              A preset is a saved report layout (renames, hidden items, budgets, language…). <strong>Shared</strong> presets are seen by everyone; <strong>mine</strong> only by you.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={ghost()}><X size={18} /></button>
        </div>

        <div style={{ padding: 16, overflowY: "auto", flex: 1, background: "#f8fafc" }}>
          {!sharedAvailable && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 12 }}>
              Shared presets need a one-time setup: run <code>supabase/report_docs.sql</code> in the Supabase SQL editor. Personal presets work without it.
            </div>
          )}
          {rows.length === 0 && <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 24 }}>No presets yet. Use <strong>Customize → Save as new preset</strong> to create one.</div>}

          {rows.map((p) => (
            <div key={p.id} style={{ background: "white", border: `1px solid ${p.id === activeId ? "var(--primary)" : "var(--border)"}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {editing === p.id ? (
                  <>
                    <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: 1 }} autoFocus />
                    <button disabled={busy || !name.trim()} onClick={async () => { await run({ type: "rename", preset: p, name: name.trim() }); setEditing(null); }} style={ghost("#10b981")} aria-label="Save name"><Check size={16} /></button>
                    <button onClick={() => setEditing(null)} style={ghost()} aria-label="Cancel rename"><X size={16} /></button>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 120 }}>
                      {p.name}
                      <span style={{ marginInlineStart: 8, fontSize: 10, fontWeight: 600, borderRadius: 10, padding: "1px 7px", background: p.kind === "shared" ? "#eef2ff" : "var(--primary-light)", color: p.kind === "shared" ? "#4f46e5" : "var(--primary)" }}>
                        {p.kind === "shared" ? "shared" : "mine"}
                      </span>
                      {p.isDefault && <span title="Default for everyone who hasn't picked their own" style={{ marginInlineStart: 6, fontSize: 10, fontWeight: 600, borderRadius: 10, padding: "1px 7px", background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>default for all</span>}
                      {p.id === activeId && <span style={{ marginInlineStart: 6, fontSize: 10, color: "#10b981", fontWeight: 600 }}>● in use</span>}
                    </span>
                    {p.id !== activeId && <button disabled={busy} onClick={() => run({ type: "use", preset: p })} style={{ ...field, cursor: "pointer", fontWeight: 600, color: "var(--primary)" }}>Use</button>}
                    {editable(p) && <button onClick={() => { setEditing(p.id); setName(p.name); }} style={ghost()} aria-label="Rename" title="Rename"><Pencil size={15} /></button>}
                    {p.kind === "mine" && isAdmin && sharedAvailable && (
                      <button disabled={busy} onClick={() => run({ type: "share", preset: p })} style={ghost("#4f46e5")} title="Share a copy with everyone" aria-label="Share with everyone"><Users size={15} /></button>
                    )}
                    {p.kind === "shared" && isAdmin && (
                      <button disabled={busy} onClick={() => run({ type: p.isDefault ? "undefault" : "default", preset: p })} style={ghost(p.isDefault ? "#f59e0b" : "#94a3b8")} title={p.isDefault ? "Stop being the default" : "Make the default for everyone"} aria-label="Toggle default"><Star size={15} fill={p.isDefault ? "#f59e0b" : "none"} /></button>
                    )}
                    {editable(p) && <button disabled={busy} onClick={() => { if (window.confirm(`Delete preset “${p.name}”?`)) run({ type: "delete", preset: p }); }} style={ghost("#ef4444")} title="Delete" aria-label="Delete"><Trash2 size={15} /></button>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
