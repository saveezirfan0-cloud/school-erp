import React from "react";
import { createPortal } from "react-dom";
import { X, Download } from "lucide-react";
import { fmtNum } from "../../utils/monthlyStatement";
import { exportToCSV } from "../../utils/exportUtils";

// The records behind one head: date, what it was, where it came from, amount.
export default function DrillDownModal({ title, subtitle, items, onClose }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label={title}
        style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 680, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{subtitle} · {items.length} record{items.length === 1 ? "" : "s"} · Rs. {fmtNum(total)}</p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <button onClick={() => exportToCSV(`records-${title}`.replace(/\s+/g, "-").toLowerCase(), ["Date", "Description", "Source", "Branch", "Amount"], items.map((i) => [i.date, i.text, i.source, i.branch, i.amount]))}
              title="Download these records as CSV" aria-label="Download CSV"
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 5, color: "#64748b", display: "flex" }}><Download size={17} /></button>
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 5, color: "#64748b", display: "flex" }}><X size={18} /></button>
          </div>
        </div>
        <div className="table-scroll" style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", fontSize: 11, textAlign: "left", position: "sticky", top: 0, background: "#f8fafc" }}>
                {["Date", "Description", "Source", "Branch"].map((h) => <th key={h} style={{ padding: "9px 14px", fontWeight: 600 }}>{h}</th>)}
                <th style={{ padding: "9px 14px", fontWeight: 600, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 14px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{i.date || "—"}</td>
                  <td style={{ padding: "8px 14px" }}>{i.text}</td>
                  <td style={{ padding: "8px 14px", color: "var(--text-muted)", fontSize: 12 }}>{i.source}</td>
                  <td style={{ padding: "8px 14px", color: "var(--text-muted)", fontSize: 12 }}>{i.branch}</td>
                  <td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtNum(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
