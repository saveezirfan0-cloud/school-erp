// Small building blocks shared by the Storage and Reception Inventory pages.
import React from "react";
import { X } from "lucide-react";

export const inputStyle = { width: "100%", padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };
export const btn = (bg = "var(--primary)", color = "white") => ({ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", background: bg, color, border: bg === "white" ? "1px solid var(--border)" : "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" });
export const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" };
export const td = { padding: "10px 12px", fontSize: 13.5, borderTop: "1px solid var(--border)", verticalAlign: "middle" };

export function Modal({ title, onClose, children, width = 460 }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: width, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5, color: "#374151" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{hint}</span>}
    </label>
  );
}

export function StatCard({ label, value, color = "var(--text)" }) {
  return (
    <div style={{ background: "white", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const STATUS_COLORS = {
  "Available": ["#ecfdf5", "#047857"],
  "Low Stock": ["#fffbeb", "#b45309"],
  "Out of Stock": ["#fef2f2", "#b91c1c"],
  pending: ["#fffbeb", "#b45309"],
  approved: ["#ecfdf5", "#047857"],
  rejected: ["#fef2f2", "#b91c1c"],
  Paid: ["#ecfdf5", "#047857"],
  Unpaid: ["#fffbeb", "#b45309"],
};

export function Pill({ children, tone }) {
  const [bg, color] = STATUS_COLORS[tone || children] || ["#f1f5f9", "#475569"];
  return <span style={{ background: bg, color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}

// Database refusals in words staff understand.
export function friendlyError(err, fallback = "Something went wrong") {
  const msg = err?.message || "";
  if (err?.code === "42501" || /row-level security|permission denied|only an approver/i.test(msg)) {
    return /only an approver/i.test(msg) ? "Only an admin can approve or change a reviewed entry." : "You do not have permission to do that.";
  }
  if (err?.code === "23503" && /still referenced|update or delete on table/i.test(msg)) return "This item has stock entries or sales, so it cannot be deleted.";
  if (err?.code === "23503") return "That item no longer exists. Reload the page and pick it again.";
  if (err?.code === "PGRST205" || /schema cache|relation "?public\.(inventory|reception)/i.test(msg)) return "The inventory tables are missing. An admin must run supabase/migrations/0014_inventory.sql.";
  return msg || fallback;
}
