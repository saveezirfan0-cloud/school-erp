// src/components/UI/DocumentViewer.jsx
//
// Full-screen preview for one or more printable documents (invoice,
// receipt, payslip, voucher, statement). Offers Print and Download PDF.
// Pass `docs` built with the helpers in utils/documents.js.

import React, { useEffect, useMemo, useState } from "react";
import { Printer, Download, X, Loader2 } from "lucide-react";
import { DOC_CSS, docsToHTML, printDocs, downloadDocsPDF } from "../../utils/documents";

export default function DocumentViewer({ docs, title, onClose }) {
  const list = useMemo(() => (Array.isArray(docs) ? docs : docs ? [docs] : []), [docs]);
  const [busy, setBusy] = useState(false);
  const html = useMemo(() => docsToHTML(list), [list]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (list.length === 0) return null;
  const heading = title || (list.length === 1 ? list[0].title : `${list.length} documents`);

  const handlePDF = async () => {
    setBusy(true);
    try { await downloadDocsPDF(list); } finally { setBusy(false); }
  };

  const btn = {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
    cursor: "pointer", fontSize: 13, fontWeight: 600,
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 12 }}
    >
      <div role="dialog" aria-label={heading} style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{heading}</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => printDocs(list, heading)} style={{ ...btn, border: "1px solid var(--border)", background: "white", color: "#334155" }}>
              <Printer size={14} /> Print
            </button>
            <button onClick={handlePDF} disabled={busy} style={{ ...btn, border: "none", background: "var(--primary)", color: "white", opacity: busy ? 0.7 : 1, cursor: busy ? "wait" : "pointer" }}>
              {busy ? <Loader2 size={14} style={{ animation: "spin 0.7s linear infinite" }} /> : <Download size={14} />} PDF
            </button>
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", display: "flex" }}><X size={20} /></button>
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "16px 20px", background: "#f1f5f9", flex: 1 }}>
          <style>{DOC_CSS}</style>
          <div style={{ background: "white", borderRadius: 8, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
            // Content is built by utils/documents.js, which HTML-escapes every value.
            dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
