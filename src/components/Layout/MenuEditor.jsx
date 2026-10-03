import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  X, GripVertical, ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus, RotateCcw,
} from "lucide-react";
import { useUser } from "../../context/UserContext";
import {
  MENU_ITEMS, normalizeLayout, isItemAllowed, moveItem, moveSection,
  renameSection, addSection, removeSection, toggleHidden, defaultLayout,
} from "../../config/menu";

const iconBtn = (disabled) => ({
  border: "none",
  background: "transparent",
  padding: 5,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  color: disabled ? "#cbd5e1" : "#64748b",
  cursor: disabled ? "default" : "pointer",
});

export default function MenuEditor({ onClose }) {
  const { can, isAdmin, menuLayout, saveMenuLayout } = useUser();
  const access = { can, isAdmin };
  const [draft, setDraft] = useState(() => normalizeLayout(menuLayout));
  const [saving, setSaving] = useState(false);
  const drag = useRef(null); // { type: "item" | "section", key | index }
  const [dropHint, setDropHint] = useState(null); // section id being hovered

  const allowed = (k) => isItemAllowed(k, access);
  // Sections that only hold pages this user can't open aren't worth showing.
  const visibleSections = draft.sections
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.items.length === 0 || s.items.some(allowed));

  const shift = (section, key, dir) => {
    const items = section.items;
    const from = items.indexOf(key);
    let to = from + dir;
    while (to >= 0 && to < items.length && !allowed(items[to])) to += dir;
    if (to < 0 || to >= items.length) return;
    setDraft((d) => moveItem(d, key, section.id, to));
  };

  const shiftSection = (index, dir) => {
    let to = index + dir;
    while (to >= 0 && to < draft.sections.length && !visibleSections.some((s) => s.index === to)) to += dir;
    if (to < 0 || to >= draft.sections.length) return;
    setDraft((d) => moveSection(d, index, to));
  };

  const startDrag = (e, payload) => {
    drag.current = payload;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(payload.key ?? payload.index)); // Firefox needs data set
  };
  const endDrag = () => { drag.current = null; setDropHint(null); };

  const dropOnItem = (e, section, index) => {
    const d = drag.current;
    if (!d || d.type !== "item") return;
    e.preventDefault();
    e.stopPropagation();
    setDraft((cur) => moveItem(cur, d.key, section.id, index));
    endDrag();
  };
  const dropOnSection = (e, section) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    if (d.type === "item") setDraft((cur) => moveItem(cur, d.key, section.id, section.items.length));
    else setDraft((cur) => moveSection(cur, d.index, section.index));
    endDrag();
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveMenuLayout(draft);
      toast.success("Menu saved");
      onClose();
    } catch (e) {
      toast.error("Couldn't save menu: " + (e?.message || "unknown error"));
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset your menu to the default layout?")) return;
    setSaving(true);
    try {
      await saveMenuLayout(null);
      toast.success("Menu reset to default");
      onClose();
    } catch (e) {
      toast.error("Couldn't reset menu: " + (e?.message || "unknown error"));
      setSaving(false);
    }
  };

  const sectionChoices = draft.sections.map((s) => ({ id: s.id, label: s.label.trim() || "Top level (no heading)" }));
  const isDefault = JSON.stringify(draft) === JSON.stringify(defaultLayout());

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
      }}
    >
      <div
        role="dialog"
        aria-label="Customize menu"
        style={{
          background: "white", borderRadius: 14, width: "100%", maxWidth: 640,
          maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>Customize menu</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              Drag items to reorder, or use the arrows. Changes apply only to your account.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={iconBtn(false)}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: "auto", flex: 1, background: "#f8fafc" }}>
          {visibleSections.map((section, vi) => (
            <div
              key={section.id}
              onDragOver={(e) => { if (drag.current) { e.preventDefault(); setDropHint(section.id); } }}
              onDrop={(e) => dropOnSection(e, section)}
              style={{
                background: "white", borderRadius: 10, marginBottom: 12, padding: 8,
                border: dropHint === section.id ? "1px solid var(--accent)" : "1px solid var(--border)",
              }}
            >
              {/* Section header */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <span
                  draggable
                  onDragStart={(e) => startDrag(e, { type: "section", index: section.index })}
                  onDragEnd={endDrag}
                  title="Drag to move section"
                  style={{ ...iconBtn(false), cursor: "grab" }}
                ><GripVertical size={16} /></span>
                <input
                  value={section.label}
                  onChange={(e) => setDraft((d) => renameSection(d, section.id, e.target.value))}
                  placeholder="No heading (top-level links)"
                  aria-label="Section name"
                  style={{ flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid transparent", borderRadius: 6, fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "#334155", background: "#f8fafc" }}
                />
                <button onClick={() => shiftSection(section.index, -1)} disabled={vi === 0} aria-label="Move section up" style={iconBtn(vi === 0)}><ChevronUp size={16} /></button>
                <button onClick={() => shiftSection(section.index, 1)} disabled={vi === visibleSections.length - 1} aria-label="Move section down" style={iconBtn(vi === visibleSections.length - 1)}><ChevronDown size={16} /></button>
                <button
                  onClick={() => setDraft((d) => removeSection(d, section.id))}
                  disabled={draft.sections.length <= 1}
                  aria-label="Delete section"
                  title="Delete section (its pages move to the section above)"
                  style={{ ...iconBtn(draft.sections.length <= 1), color: draft.sections.length <= 1 ? "#cbd5e1" : "#ef4444" }}
                ><Trash2 size={15} /></button>
              </div>

              {/* Items */}
              {section.items.filter(allowed).map((key, i, shown) => {
                const { icon: Icon, label } = MENU_ITEMS[key];
                const hidden = draft.hidden.includes(key);
                const realIndex = section.items.indexOf(key);
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e) => startDrag(e, { type: "item", key })}
                    onDragEnd={endDrag}
                    onDragOver={(e) => { if (drag.current?.type === "item") e.preventDefault(); }}
                    onDrop={(e) => dropOnItem(e, section, realIndex)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 4px 8px",
                      borderRadius: 8, opacity: hidden ? 0.5 : 1, background: "white",
                    }}
                  >
                    <span style={{ ...iconBtn(false), cursor: "grab", padding: 3 }}><GripVertical size={15} /></span>
                    <Icon size={15} color="#475569" />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, textDecoration: hidden ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                    <select
                      value={section.id}
                      onChange={(e) => setDraft((d) => moveItem(d, key, e.target.value))}
                      aria-label={`Move ${label} to section`}
                      className="hide-mobile"
                      style={{ maxWidth: 130, padding: "3px 4px", border: "1px solid var(--border)", borderRadius: 6, background: "white", color: "#475569", fontSize: 12 }}
                    >
                      {sectionChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <button onClick={() => shift(section, key, -1)} disabled={i === 0} aria-label={`Move ${label} up`} style={iconBtn(i === 0)}><ChevronUp size={16} /></button>
                    <button onClick={() => shift(section, key, 1)} disabled={i === shown.length - 1} aria-label={`Move ${label} down`} style={iconBtn(i === shown.length - 1)}><ChevronDown size={16} /></button>
                    <button onClick={() => setDraft((d) => toggleHidden(d, key))} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} title={hidden ? "Show in menu" : "Hide from menu"} style={iconBtn(false)}>
                      {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                );
              })}
              {section.items.filter(allowed).length === 0 && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 10px" }}>Empty — drag a page here, or use a page's section picker.</p>
              )}
            </div>
          ))}

          <button
            onClick={() => setDraft((d) => addSection(d))}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px dashed #94a3b8", borderRadius: 8, background: "transparent", color: "#475569", fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={15} /> Add section
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <button onClick={reset} disabled={saving || (!menuLayout && isDefault)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", color: "#475569", fontSize: 13, opacity: saving || (!menuLayout && isDefault) ? 0.5 : 1 }}>
            <RotateCcw size={14} /> Reset to default
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "white", fontSize: 13, fontWeight: 600 }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ padding: "8px 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "white", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : "Save menu"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
