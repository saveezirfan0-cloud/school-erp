import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import { renderDocument } from "../../utils/reportPdf";
import { LANGS } from "../../config/reportI18n";

const chip = (on) => ({
  padding: "5px 11px", borderRadius: 16, cursor: "pointer", fontSize: 12, fontWeight: 600,
  border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
  background: on ? "var(--primary-light)" : "white", color: on ? "var(--primary)" : "#64748b",
});

// Shows the report exactly as the PDF will look. `makeDoc(overrides)` builds the
// document for the current data; the toggles below only change this export
// (they don't touch the saved layout). Printing goes through the iframe, so it
// isn't blocked like a pop-up, and "Save as PDF" in the dialog makes the file.
export default function PreviewModal({ makeDoc, baseOptions, landscape, onClose }) {
  const [ov, setOv] = useState({ language: baseOptions.language || "en", accounts: baseOptions.accounts !== false, outstanding: baseOptions.outstanding !== false, branchSplit: baseOptions.branchSplit !== false });
  const frame = useRef(null);
  const html = useMemo(() => renderDocument(makeDoc(ov)), [makeDoc, ov]);
  const toggle = (k) => setOv((o) => ({ ...o, [k]: !o[k] }));

  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label="Report preview"
        style={{ background: "#e2e8f0", borderRadius: 14, width: "100%", maxWidth: landscape ? 1180 : 860, height: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "12px 16px", background: "white", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Preview</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>This is how the PDF will look · {landscape ? "A4 landscape" : "A4 portrait"}</div>
          </div>
          <button onClick={print} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            <Printer size={15} /> Print / Save as PDF
          </button>
          <button onClick={onClose} aria-label="Close preview" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 5, color: "#64748b", display: "flex" }}><X size={20} /></button>
        </div>

        <div style={{ padding: "8px 16px", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>For this export:</span>
          {LANGS.map((l) => <button key={l.id} onClick={() => setOv((o) => ({ ...o, language: l.id }))} style={chip(ov.language === l.id)}>{l.label}</button>)}
          <span style={{ width: 1, height: 18, background: "var(--border)" }} />
          <button onClick={() => toggle("branchSplit")} style={chip(ov.branchSplit)}>Branch split</button>
          <button onClick={() => toggle("outstanding")} style={chip(ov.outstanding)}>Outstanding</button>
          <button onClick={() => toggle("accounts")} style={chip(ov.accounts)}>Bank &amp; Cash</button>
        </div>

        <div style={{ flex: 1, padding: 16, overflow: "auto" }}>
          <iframe ref={frame} title="Report preview" srcDoc={html}
            style={{ display: "block", margin: "0 auto", width: landscape ? "297mm" : "210mm", maxWidth: "100%", minHeight: "100%", height: landscape ? "210mm" : "297mm", border: "none", background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
