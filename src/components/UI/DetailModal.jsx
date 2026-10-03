import React, { useEffect } from "react";
import { X, Download } from "lucide-react";
import { exportToCSV } from "../../utils/exportUtils";

// Generic popup used by clickable dashboard metrics.
//   columns: [{ key, label, align?, render?(row) }]
//   footer:  optional node (e.g. totals)
export default function DetailModal({ title, subtitle, columns, rows, footer, onClose, emptyText = "Nothing to show for this period" }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Plain-text value of a cell for CSV: column.text, else the rendered value
  // when it is plain text/number, else the raw field.
  const csvCell = (c, r) => {
    if (c.text) return c.text(r);
    if (c.render) { const v = c.render(r); if (typeof v === "string" || typeof v === "number") return v; }
    return r[c.key];
  };
  const exportCsv = () => exportToCSV(
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    columns.map(c => c.label),
    rows.map(r => columns.map(c => csvCell(c, r)))
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 820, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
            {subtitle && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={exportCsv} disabled={rows.length === 0} title="Download as CSV"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: rows.length ? "pointer" : "not-allowed", fontSize: 12, opacity: rows.length ? 1 : 0.5 }}>
              <Download size={13} /> CSV
            </button>
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
          </div>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                {columns.map((c) => (
                  <th key={c.key} style={{ padding: "10px 16px", textAlign: c.align || "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={columns.length} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>{emptyText}</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id || i} onClick={r.onClick} style={{ borderTop: "1px solid var(--border)", cursor: r.onClick ? "pointer" : "default" }}>
                  {columns.map((c) => (
                    <td key={c.key} style={{ padding: "10px 16px", fontSize: 13, textAlign: c.align || "left" }}>{c.render ? c.render(r) : r[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>{rows.length} record{rows.length === 1 ? "" : "s"}</span>
          {footer}
        </div>
      </div>
    </div>
  );
}
