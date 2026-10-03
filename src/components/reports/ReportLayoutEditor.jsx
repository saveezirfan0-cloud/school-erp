import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X, Eye, EyeOff, Trash2, Plus, RotateCcw } from "lucide-react";
import {
  normalizeLayout, isDefaultLayout, patchSection, patchHead, setOption, addCustomSection,
  removeCustomSection, addManualEntry, removeManualEntry, sectionDefs,
} from "../../config/reportLayout";

const field = { padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", minWidth: 0 };
const ghostBtn = (color = "#64748b") => ({ border: "none", background: "transparent", cursor: "pointer", padding: 5, borderRadius: 6, display: "flex", alignItems: "center", color });

const OPTIONS = [
  { key: "branchSplit", label: "Show the branch split under each head", hint: "e.g. “Baneen 300,000 · Banaat 85,500”" },
  { key: "accounts", label: "Show Bank & Cash accounts", hint: "Opening, money in/out and closing per account" },
  { key: "comparison", label: "Compare with last month", hint: "▲/▼ % on the income and expense cards" },
  { key: "shareBars", label: "Show share-of-total bars", hint: "The coloured bar under each section" },
];

function Check({ checked, onChange, label, title }) {
  return (
    <label title={title} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#475569", cursor: "pointer", whiteSpace: "nowrap" }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

// `heads` = every head seen this year, [{ id, label, group, side }], so the
// editor can offer heads that have no money in the month being viewed.
export default function ReportLayoutEditor({ layout, heads, month, onSave, onReset, onClose }) {
  const [draft, setDraft] = useState(() => normalizeLayout(layout));
  const [tab, setTab] = useState("income");
  const [saving, setSaving] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [entry, setEntry] = useState({ label: "", amount: "", group: "other", month: "" });

  const defs = useMemo(() => sectionDefs(draft, tab), [draft, tab]);
  const sideHeads = useMemo(() => heads.filter((h) => h.side === tab), [heads, tab]);
  const validKeys = new Set(defs.map((d) => d.key));
  const groupOf = (h) => { const g = draft.heads[h.id]?.group; return validKeys.has(g) ? g : h.group; };
  const manual = draft.manual.filter((m) => m.side === tab);

  const run = async (fn, okMsg) => {
    setSaving(true);
    try { await fn(); toast.success(okMsg); onClose(); }
    catch (e) { toast.error("Couldn't save: " + (e?.message || "unknown error")); setSaving(false); }
  };

  const tabBtn = (id, label) => (
    <button key={id} onClick={() => setTab(id)}
      style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 13, fontWeight: 600,
        background: tab === id ? "var(--primary)" : "white", color: tab === id ? "white" : "#475569" }}>{label}</button>
  );

  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label="Customize report"
        style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 720, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>Customize report</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              Rename, hide or regroup anything, and add manual lines. Applies to every month and to the PDF; only your account sees it. Your records are never changed.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={ghostBtn()}><X size={18} /></button>
        </div>

        <div style={{ padding: "12px 16px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabBtn("income", "Income")}{tabBtn("expense", "Expense")}{tabBtn("options", "Display options")}
        </div>

        <div style={{ padding: 16, overflowY: "auto", flex: 1, background: "#f8fafc" }}>
          {tab === "options" && (
            <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: 8 }}>
              {OPTIONS.map((o) => (
                <label key={o.key} style={{ display: "flex", gap: 10, padding: "10px 12px", cursor: "pointer", alignItems: "flex-start" }}>
                  <input type="checkbox" checked={draft.options[o.key] !== false} onChange={(e) => setDraft((d) => setOption(d, o.key, e.target.checked))} style={{ marginTop: 3 }} />
                  <span><span style={{ fontSize: 14, fontWeight: 600 }}>{o.label}</span><br /><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{o.hint}</span></span>
                </label>
              ))}
            </div>
          )}

          {tab !== "options" && (
            <>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                <strong>Hide</strong> removes a section or head from the statement and its totals. <strong>Don't count</strong> keeps a section visible but leaves it out of the total (e.g. show loans without counting them as income).
              </p>

              {defs.map((def) => {
                const o = draft.sections[`${tab}:${def.key}`] || {};
                const inSection = sideHeads.filter((h) => groupOf(h) === def.key);
                const mine = manual.filter((m) => m.group === def.key);
                if (!def.custom && inSection.length === 0 && mine.length === 0 && !o.label && !o.hidden && !o.excluded) return null;
                return (
                  <div key={def.key} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12, opacity: o.hidden ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", flexWrap: "wrap", background: "var(--primary-light)", borderRadius: "10px 10px 0 0" }}>
                      <input value={o.label || ""} placeholder={def.label} aria-label="Section name"
                        onChange={(e) => setDraft((d) => patchSection(d, `${tab}:${def.key}`, { label: e.target.value }))}
                        style={{ ...field, flex: 1, minWidth: 140, fontWeight: 700 }} />
                      <Check checked={o.excluded} onChange={(v) => setDraft((d) => patchSection(d, `${tab}:${def.key}`, { excluded: v }))} label="Don't count" title="Show it, but leave it out of the total" />
                      <Check checked={o.hidden} onChange={(v) => setDraft((d) => patchSection(d, `${tab}:${def.key}`, { hidden: v }))} label="Hide" />
                      {def.custom && (
                        <button onClick={() => setDraft((d) => removeCustomSection(d, tab, def.key))} title="Delete section (its heads go back to their original sections)" style={ghostBtn("#ef4444")}><Trash2 size={15} /></button>
                      )}
                    </div>

                    {inSection.length === 0 && mine.length === 0 && (
                      <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)" }}>Empty — move a head here from another section, or add a manual line below.</div>
                    )}
                    {inSection.map((h) => {
                      const ho = draft.heads[h.id] || {};
                      return (
                        <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderTop: "1px solid #f1f5f9", opacity: ho.hidden ? 0.5 : 1 }}>
                          <input value={ho.label || ""} placeholder={h.label} aria-label={`Rename ${h.label}`}
                            onChange={(e) => setDraft((d) => patchHead(d, h.id, { label: e.target.value }))}
                            style={{ ...field, flex: 1, textDecoration: ho.hidden ? "line-through" : "none" }} />
                          <select value={groupOf(h)} aria-label={`Move ${h.label} to section`}
                            onChange={(e) => setDraft((d) => patchHead(d, h.id, { group: e.target.value === h.group ? "" : e.target.value }))}
                            style={{ ...field, maxWidth: 170 }}>
                            {defs.map((d2) => <option key={d2.key} value={d2.key}>{draft.sections[`${tab}:${d2.key}`]?.label || d2.label}</option>)}
                          </select>
                          <button onClick={() => setDraft((d) => patchHead(d, h.id, { hidden: !ho.hidden }))} title={ho.hidden ? "Show" : "Hide"} aria-label={ho.hidden ? "Show head" : "Hide head"} style={ghostBtn()}>
                            {ho.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      );
                    })}
                    {mine.map((m) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderTop: "1px solid #f1f5f9", background: "#fffbeb" }}>
                        <span style={{ flex: 1, fontSize: 13 }}>{m.label} <span style={{ color: "#92400e", fontSize: 11 }}>· manual · {m.month ? m.month : "every month"}</span></span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{Number(m.amount).toLocaleString()}</span>
                        <button onClick={() => setDraft((d) => removeManualEntry(d, m.id))} aria-label="Remove manual line" style={ghostBtn("#ef4444")}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* New section */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder={`New ${tab} section, e.g. “Events”`} style={{ ...field, flex: 1 }} />
                <button onClick={() => { setDraft((d) => addCustomSection(d, tab, newSection)); setNewSection(""); }} disabled={!newSection.trim()}
                  style={{ ...field, cursor: newSection.trim() ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4, fontWeight: 600, color: "var(--primary)" }}><Plus size={14} /> Section</button>
              </div>

              {/* Manual line */}
              <div style={{ background: "white", border: "1px dashed #cbd5e1", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Add a manual {tab} line</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>For money that isn't recorded in the system (e.g. a cash donation). It appears only on this report.</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  <input value={entry.label} onChange={(e) => setEntry({ ...entry, label: e.target.value })} placeholder="Description" style={field} />
                  <input type="number" min="0" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} placeholder="Amount" style={field} />
                  <select value={entry.group} onChange={(e) => setEntry({ ...entry, group: e.target.value })} style={field}>
                    {defs.map((d) => <option key={d.key} value={d.key}>{draft.sections[`${tab}:${d.key}`]?.label || d.label}</option>)}
                  </select>
                  <select value={entry.month} onChange={(e) => setEntry({ ...entry, month: e.target.value })} style={field}>
                    <option value="">Every month</option>
                    <option value={month}>Only {month}</option>
                  </select>
                </div>
                <button onClick={() => { setDraft((d) => addManualEntry(d, { ...entry, side: tab })); setEntry({ label: "", amount: "", group: entry.group, month: "" }); }}
                  disabled={!entry.label.trim() || !(Number(entry.amount) > 0)}
                  style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--primary-light)", color: "var(--primary)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: !entry.label.trim() || !(Number(entry.amount) > 0) ? 0.5 : 1 }}>
                  <Plus size={13} style={{ verticalAlign: -2 }} /> Add line
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => { if (window.confirm("Reset this report to the default layout? Manual lines will be removed.")) run(onReset, "Report reset to default"); }}
            disabled={saving || (isDefaultLayout(layout) && isDefaultLayout(draft))}
            style={{ ...field, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#475569", fontWeight: 600 }}><RotateCcw size={14} /> Reset</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ ...field, cursor: "pointer", fontWeight: 600 }}>Cancel</button>
            <button onClick={() => run(() => onSave(draft), "Report layout saved")} disabled={saving}
              style={{ padding: "8px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
