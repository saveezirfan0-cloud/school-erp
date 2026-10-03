// src/components/UI/ExportMenu.jsx
//
// One "Export" dropdown for list pages: CSV, Excel and PDF (plus an
// optional Print). The data is built lazily when an option is picked, so
// pages don't rebuild big row arrays on every render.
//
//   <ExportMenu filename="payments" title="Payments Report"
//     getData={() => ({
//       headers, rows,                  // CSV + Excel (raw values)
//       pdfHeaders, pdfRows,            // optional: PDF-specific columns/formatting
//     })} />

import React, { useEffect, useRef, useState } from "react";
import { Download, FileText, FileSpreadsheet, ChevronDown, Table2 } from "lucide-react";
import toast from "react-hot-toast";
import { exportToCSV, exportToExcel, exportToPDF } from "../../utils/exportUtils";

export default function ExportMenu({ filename, title, getData, disabled = false, pdfOptions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const run = (kind) => {
    setOpen(false);
    let data;
    try { data = getData(); } catch (e) { return toast.error("Couldn't prepare the export"); }
    if (!data?.rows?.length) return toast.error("Nothing to export");
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") exportToCSV(filename, data.headers, data.rows);
    else if (kind === "xlsx") exportToExcel(`${filename}-${stamp}`, data.headers, data.rows, title);
    else exportToPDF(title, data.pdfHeaders || data.headers, data.pdfRows || data.rows, { filename: `${filename}-${stamp}`, ...pdfOptions });
  };

  const item = {
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 14px",
    border: "none", background: "white", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#334155",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: "white", fontSize: 13, opacity: disabled ? 0.6 : 1 }}
      >
        <Download size={14} /> Export <ChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 950, minWidth: 170, background: "white", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.15)", overflow: "hidden" }}>
          <button role="menuitem" style={item} onClick={() => run("pdf")}><FileText size={14} color="#dc2626" /> PDF document</button>
          <button role="menuitem" style={item} onClick={() => run("xlsx")}><FileSpreadsheet size={14} color="#16a34a" /> Excel (.xlsx)</button>
          <button role="menuitem" style={item} onClick={() => run("csv")}><Table2 size={14} color="#64748b" /> CSV</button>
        </div>
      )}
    </div>
  );
}
