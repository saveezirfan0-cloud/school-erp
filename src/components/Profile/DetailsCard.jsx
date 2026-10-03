import React, { useState } from "react";
import toast from "react-hot-toast";
import { Edit2, Check, X } from "lucide-react";
import { cardStyle, cardHeadStyle } from "./ProfileShell";

const inputStyle = { width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };

// A titled grid of fields that reads as plain text and flips to a form
// when "Edit" is pressed. Only fields that changed are passed to onSave.
//
// field: { key, label, type?: text|tel|email|date|number|textarea|select|boolean,
//          options?: [{value,label}], full?: bool, required?: bool,
//          format?: (value, record) => ReactNode }  // display only
export default function DetailsCard({ title, fields, record, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, record[f.key] ?? (f.type === "boolean" ? false : "")])));
    setEditing(true);
  };

  const save = async () => {
    const missing = fields.find((f) => f.required && !String(draft[f.key] ?? "").trim());
    if (missing) return toast.error(`${missing.label} is required`);
    const changes = {};
    for (const f of fields) {
      let v = draft[f.key];
      if (f.type === "number") v = v === "" || v == null ? null : Number(v);
      if (f.type === "boolean") v = !!v;
      const before = f.type === "boolean" ? !!record[f.key] : record[f.key];
      if (String(v ?? "") !== String(before ?? "")) changes[f.key] = v;
    }
    if (Object.keys(changes).length === 0) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(changes);
      setEditing(false);
    } catch (err) {
      toast.error(err?.message || "Error saving");
    } finally { setSaving(false); }
  };

  const display = (f) => {
    const v = record[f.key];
    if (f.format) return f.format(v, record);
    if (f.type === "boolean") return v ? "Yes" : "No";
    if (f.type === "select") return f.options?.find((o) => String(o.value) === String(v ?? ""))?.label ?? (v || "—");
    if (f.type === "tel" && v) return <a href={`tel:${v}`} style={{ color: "#2a8c7a", textDecoration: "none", fontWeight: 500 }}>{v}</a>;
    if (f.type === "email" && v) return <a href={`mailto:${v}`} style={{ color: "#2a8c7a", textDecoration: "none", fontWeight: 500 }}>{v}</a>;
    return v === "" || v == null ? "—" : String(v);
  };

  const input = (f) => {
    const val = draft[f.key] ?? "";
    const set = (v) => setDraft((p) => ({ ...p, [f.key]: v }));
    if (f.type === "select") return (
      <select value={val} onChange={(e) => set(e.target.value)} style={inputStyle}>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
    if (f.type === "textarea") return <textarea value={val} onChange={(e) => set(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />;
    if (f.type === "boolean") return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, paddingTop: 8 }}>
        <input type="checkbox" checked={!!draft[f.key]} onChange={(e) => set(e.target.checked)} style={{ width: 18, height: 18 }} /> Enabled
      </label>
    );
    return <input type={f.type || "text"} value={val} onChange={(e) => set(e.target.value)} style={inputStyle} />;
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={cardHeadStyle}>
        <span>{title}</span>
        {canEdit && !editing && (
          <button onClick={start} style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            <Edit2 size={13} /> Edit
          </button>
        )}
        {editing && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setEditing(false)} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: "white", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}><X size={13} /> Cancel</button>
            <button onClick={save} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "var(--primary)", color: "white", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}><Check size={13} /> {saving ? "Saving…" : "Save"}</button>
          </div>
        )}
      </div>
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {fields.map((f) => (
          <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : undefined, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{f.label}{editing && f.required ? " *" : ""}</div>
            {editing ? input(f) : <div style={{ fontSize: 14, fontWeight: 500, wordBreak: "break-word", whiteSpace: f.type === "textarea" ? "pre-wrap" : undefined }}>{display(f)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
