import React, { useState, useEffect } from "react";
import { db, trashCollection, doc, onSnapshot, restoreDoc, hardDeleteDoc, emptyTrash } from "../firebase";
import { useUser } from "../context/UserContext";
import toast from "react-hot-toast";
import { Trash2, RotateCcw, X, AlertTriangle } from "lucide-react";

// Collections that support Trash, with a friendly label and the
// fields to show as a summary per row.
const TRASH_SOURCES = [
  { key: "students",     label: "Students",   primary: "name",        secondary: (r) => r.studentId || r.grade || "" },
  { key: "employees",    label: "Employees",  primary: "name",        secondary: (r) => r.role || "" },
  { key: "invoices",     label: "Invoices",   primary: "studentName", secondary: (r) => `${r.month || ""} • Rs. ${r.amount || 0}` },
  { key: "payments",     label: "Payments",   primary: "description", secondary: (r) => `${r.category || ""} • Rs. ${r.amount || 0}` },
  { key: "expenses",     label: "Expenses",   primary: "description", secondary: (r) => `${r.category || ""} • Rs. ${r.amount || 0}` },
  { key: "payslips",     label: "Payslips",   primary: "employeeName",secondary: (r) => `${r.month || ""} ${r.year || ""} • Rs. ${r.netPay || 0}` },
  { key: "journals",     label: "Journals",   primary: "description", secondary: (r) => `Rs. ${r.amount || 0}` },
  { key: "accounts",     label: "Accounts",   primary: "name",        secondary: (r) => r.code || "" },
  { key: "branches",     label: "Branches",   primary: "name",        secondary: (r) => r.address || "" },
  { key: "reminderLogs", label: "Reminders",  primary: "message",     secondary: (r) => r.status || "" },
];

export default function Trash() {
  const { isAdmin } = useUser();
  const [active, setActive] = useState("students");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const source = TRASH_SOURCES.find((s) => s.key === active);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      trashCollection(active),
      (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("Trash load error:", err); setLoading(false); }
    );
    return unsub;
  }, [active]);

  const handleRestore = async (id) => {
    try { await restoreDoc(doc(db, active, id)); toast.success("Restored"); }
    catch (e) { toast.error(e?.message || "Error restoring"); }
  };

  const handleDeleteForever = async (id) => {
    if (!window.confirm("Permanently delete this record? This cannot be undone.")) return;
    try { await hardDeleteDoc(doc(db, active, id)); toast.success("Deleted permanently"); }
    catch (e) { toast.error(e?.message || "Error deleting"); }
  };

  const handleEmpty = async () => {
    if (!rows.length) return;
    if (!window.confirm(`Permanently delete all ${rows.length} ${source.label.toLowerCase()} in Trash? This cannot be undone.`)) return;
    try { await emptyTrash(active); toast.success("Trash emptied"); }
    catch (e) { toast.error(e?.message || "Error emptying trash"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <Trash2 size={20} /> Trash <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({rows.length})</span>
        </h2>
        {rows.length > 0 && (
          <button onClick={handleEmpty}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "#fef2f2", color: "var(--danger)", border: "1px solid #fecaca", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={14} /> Empty {source.label} Trash
          </button>
        )}
      </div>

      {/* collection tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TRASH_SOURCES.map((s) => (
          <button key={s.key} onClick={() => setActive(s.key)}
            style={{ padding: "7px 13px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: active === s.key ? "1px solid var(--primary)" : "1px solid var(--border)",
              background: active === s.key ? "var(--primary)" : "white",
              color: active === s.key ? "white" : "#475569" }}>
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
            <Trash2 size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>No {source.label.toLowerCase()} in Trash</div>
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r[source.primary] || "—"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {source.secondary(r)}
                  {r.deletedAt && <span> • deleted {new Date(r.deletedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => handleRestore(r.id)} title="Restore"
                  style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: "white", color: "#16a34a", padding: "7px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  <RotateCcw size={14} /> Restore
                </button>
                <button onClick={() => handleDeleteForever(r.id)} title="Delete forever"
                  style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}>
                  <X size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
        Deleted records are kept here until you restore them or permanently delete them. Permanent deletion cannot be undone.
      </p>
    </div>
  );
}
