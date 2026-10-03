import React, { useState, useEffect } from "react";
import { db, trashCollection, doc, onSnapshot, hardDeleteDoc, emptyTrash, hardDeleteDocs } from "../firebase";
import { useUser } from "../context/UserContext";
import { useBulkSelect } from "../hooks/useBulkSelect";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import { runBulk, bulkResultMessage } from "../utils/bulk";
import { restoreWithLedger, ledgerSourceFor } from "../utils/accounting";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";
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
  { key: "subjects",     label: "Subjects",   primary: "name",        secondary: (r) => r.grade || "" },
  { key: "exams",        label: "Exams",      primary: "name",        secondary: (r) => `${r.grade || ""} • ${r.date || ""}` },
  { key: "assignments",  label: "Homework",   primary: "title",       secondary: (r) => `${r.grade || ""} • due ${r.dueDate || "—"}` },
  { key: "materials",    label: "Materials",  primary: "title",       secondary: (r) => r.grade || "" },
];

// The payments ledger is append-only: posted money is corrected with
// reversal entries, never removed. Payments in Trash (deleted before that
// rule existed) can still be restored, but not destroyed.
const LEDGER_LOCKED = new Set(["payments"]);

// A trashed payment may only be restored when it is a plain manual entry.
// Payments created by an invoice / expense / payslip come back through that
// document, and reversal rows are only ever meaningful next to their original.
const restoreBlockReason = (key, r) => {
  if (key !== "payments") return "";
  if (r.reversalOf) return "This is a reversal entry. Restore the document it belongs to instead.";
  if (r.source) return "This payment belongs to an invoice, expense or payslip. Restore that document and its payments come back with it.";
  return "";
};

export default function Trash() {
  const { isAdmin } = useUser();
  const { busy: restoring, run: runRestore } = useSubmitLock();
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

  const handleRestore = (r) => runRestore(async () => {
    const why = restoreBlockReason(active, r);
    if (why) return toast.error(why, { duration: 6000 });
    if (active === "payments" && !window.confirm("Restoring this payment puts its amount back into the account balance. Continue?")) return;
    try {
      // Invoices, expenses and payslips get the ledger entries that the delete
      // reversed re-posted, so status and money agree again.
      const res = await restoreWithLedger(active, r.id);
      toast.success(res.reposted > 0 ? `Restored, ${res.reposted} payment${res.reposted === 1 ? "" : "s"} re-posted to the ledger` : "Restored");
      logActivity("restored", "Trash", `${source.label}: ${r[source.primary] || r.id}${res.reposted ? ` (+${res.reposted} ledger entr${res.reposted === 1 ? "y" : "ies"})` : ""}`);
    }
    catch (e) { toast.error(e?.message || "Error restoring", { duration: 7000 }); }
  });

  const handleDeleteForever = async (r) => {
    if (LEDGER_LOCKED.has(active)) return toast.error("Payments are part of the ledger and cannot be permanently deleted.");
    if (!window.confirm("Permanently delete this record? This cannot be undone.")) return;
    try {
      await hardDeleteDoc(doc(db, active, r.id));
      toast.success("Deleted permanently");
      logActivity("deleted forever", "Trash", `${source.label}: ${r[source.primary] || r.id}`);
    }
    catch (e) { toast.error(e?.message || "Error deleting"); }
  };

  // multi-select for bulk restore / permanent delete. Switching tabs
  // changes the visible ids, so stale selections prune automatically.
  const bulk = useBulkSelect(rows.map((r) => r.id));
  const visibleIds = rows.map((r) => r.id);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkRestore = () => runRestore(async () => {
    const chosen = rows.filter((r) => bulk.selected.has(r.id));
    const eligible = chosen.filter((r) => !restoreBlockReason(active, r));
    const skipped = chosen.length - eligible.length;
    if (eligible.length === 0) return toast.error("None of the selected rows can be restored here. Restore the invoice, expense or payslip they belong to.", { duration: 6000 });
    setBulkBusy(true);
    try {
      // One at a time per row so each document's ledger entries are re-posted and a failure names the row.
      const { ok, failed } = await runBulk(eligible, (r) => restoreWithLedger(active, r.id), { chunkSize: 2 });
      const firstErr = failed[0]?.error?.message;
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "restored", source.label.toLowerCase()) + (skipped ? ` · ${skipped} skipped` : "") + (firstErr ? ` (${firstErr})` : ""), { duration: failed.length ? 8000 : 4000 });
      if (ok.length) logActivity("restored", "Trash", `${ok.length} ${source.label.toLowerCase()} (bulk)`);
      bulk.clear();
    } catch (e) {
      toast.error(e?.message || "Bulk restore failed");
    } finally { setBulkBusy(false); }
  });

  const handleBulkDeleteForever = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (LEDGER_LOCKED.has(active)) return toast.error("Payments are part of the ledger and cannot be permanently deleted.");
    if (!window.confirm(`Permanently delete ${ids.length} ${source.label.toLowerCase()}? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await hardDeleteDocs(active, ids);
      toast.success(bulkResultMessage(ids.length, 0, "deleted permanently", source.label.toLowerCase()));
      logActivity("deleted forever", "Trash", `${ids.length} ${source.label.toLowerCase()} (bulk)`);
      bulk.clear();
    } catch (e) {
      toast.error(e?.message || "Bulk delete failed");
    } finally { setBulkBusy(false); }
  };

  const handleEmpty = async () => {
    if (!rows.length) return;
    if (LEDGER_LOCKED.has(active)) return toast.error("Payments are part of the ledger and cannot be permanently deleted.");
    if (!window.confirm(`Permanently delete all ${rows.length} ${source.label.toLowerCase()} in Trash? This cannot be undone.`)) return;
    try { await emptyTrash(active); toast.success("Trash emptied"); logActivity("emptied trash", "Trash", `${rows.length} ${source.label.toLowerCase()} deleted forever`); }
    catch (e) { toast.error(e?.message || "Error emptying trash"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <Trash2 size={20} /> Trash <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({rows.length})</span>
        </h2>
        {rows.length > 0 && !LEDGER_LOCKED.has(active) && (
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
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#f8fafc" }}>
              <HeaderCheckbox checked={bulk.pageChecked(visibleIds)} indeterminate={bulk.pageIndeterminate(visibleIds)} onChange={() => bulk.togglePage(visibleIds)} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Select all</span>
            </div>
            {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", gap: 10, background: bulk.isSelected(r.id) ? "var(--primary-light)" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <RowCheckbox checked={bulk.isSelected(r.id)} onChange={() => bulk.toggle(r.id)} label={`Select ${r[source.primary] || "record"}`} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r[source.primary] || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {source.secondary(r)}
                    {r.deletedAt && <span> • deleted {new Date(r.deletedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => handleRestore(r)} disabled={restoring} title={restoreBlockReason(active, r) || "Restore"}
                  style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: "white", color: "#16a34a", padding: "7px 11px", borderRadius: 8, cursor: restoring ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: restoreBlockReason(active, r) ? 0.45 : 1 }}>
                  <RotateCcw size={14} /> Restore
                </button>
                {!LEDGER_LOCKED.has(active) && (
                  <button onClick={() => handleDeleteForever(r)} title="Delete forever"
                    style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}>
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
            ))}
          </>
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={rows.length}
        noun={source.label.toLowerCase()}
        busy={bulkBusy || restoring}
        onSelectAll={() => bulk.selectAll(rows.map((r) => r.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Restore", icon: RotateCcw, variant: "success", onClick: handleBulkRestore },
          ...(LEDGER_LOCKED.has(active) ? [] : [{ label: "Delete Forever", icon: Trash2, variant: "danger", onClick: handleBulkDeleteForever }]),
        ]}
      />

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
        Deleted records are kept here until you restore them or permanently delete them. Permanent deletion cannot be undone.
        {ledgerSourceFor(active) && " Restoring an invoice, expense or payslip re-posts the payments that were reversed when it was deleted."}
        {LEDGER_LOCKED.has(active) && " Payments are part of the ledger and cannot be permanently deleted."}
      </p>
    </div>
  );
}
