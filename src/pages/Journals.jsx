import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { useBulkSelect } from "../hooks/useBulkSelect";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import toast from "react-hot-toast";
import { Plus, X, Trash2, Pencil } from "lucide-react";

const empty = { date: "", reference: "", description: "", debitAccount: "", creditAccount: "", amount: "", notes: "" };

export default function Journals() {
  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "journals"), snap => setJournals(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))));
    const u2 = onSnapshot(collection(db, "accounts"), snap => setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, []);

  // multi-select for bulk actions
  const bulk = useBulkSelect(journals.map(j => j.id));
  const visibleIds = journals.map(j => j.id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.debitAccount === form.creditAccount) return toast.error("Debit and credit accounts must be different");
    await addDoc(collection(db, "journals"), { ...form, createdAt: serverTimestamp() });
    toast.success("Journal entry saved");
    logActivity("created", "Journals", `${form.reference || "Journal"} — ${form.description} · Rs. ${Number(form.amount || 0).toLocaleString()}`);
    setShowModal(false);
    setForm(empty);
  };

  const handleDelete = async (j) => {
    if (!window.confirm("Delete this journal entry? You can restore it from Trash.")) return;
    try {
      await deleteDoc(doc(db, "journals", j.id));
      toast.success("Journal entry moved to Trash");
      logActivity("deleted", "Journals", `${j.reference || "Journal"} — ${j.description} · Rs. ${Number(j.amount || 0).toLocaleString()}`);
    }
    catch { toast.error("Error deleting"); }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} journal entr${ids.length === 1 ? "y" : "ies"}? You can restore them from Trash.`)) return;
    setBulkBusy(true);
    try {
      await deleteDocs("journals", ids);
      toast.success(bulkResultMessage(ids.length, 0, "moved to Trash", "journal entries"));
      logActivity("deleted", "Journals", `${ids.length} journal entries (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed");
    } finally { setBulkBusy(false); }
  };

  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const n = bulk.count;
      await updateDocs("journals", [...bulk.selected], { ...changes, updatedAt: serverTimestamp() });
      toast.success(`${n} journal entr${n === 1 ? "y" : "ies"} updated`);
      logActivity("updated", "Journals", `${n} journal entries (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Journal Entries</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>Double-entry bookkeeping records</p>
        </div>
        <button onClick={() => setShowModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> New Journal Entry
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th style={{ padding: "12px 6px 12px 16px", width: 34 }}>
                <HeaderCheckbox checked={bulk.pageChecked(visibleIds)} indeterminate={bulk.pageIndeterminate(visibleIds)} onChange={() => bulk.togglePage(visibleIds)} />
              </th>
              {["Date", "Reference", "Description", "Debit Account", "Credit Account", "Amount", "Notes"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
              <th style={{ padding: "12px 16px" }}></th>
            </tr>
          </thead>
          <tbody>
            {journals.map(j => (
              <tr key={j.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(j.id) ? "var(--primary-light)" : undefined }}>
                <td style={{ padding: "12px 6px 12px 16px" }}>
                  <RowCheckbox checked={bulk.isSelected(j.id)} onChange={() => bulk.toggle(j.id)} label={`Select journal entry ${j.reference || j.description}`} />
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{j.date}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{j.reference}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500 }}>{j.description}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>
                    DR: {j.debitAccount}
                  </span>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "#fef2f2", color: "#ef4444", fontWeight: 600 }}>
                    CR: {j.creditAccount}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>Rs. {Number(j.amount).toLocaleString()}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{j.notes}</td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <button onClick={() => handleDelete(j)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {journals.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No journal entries yet</div>}
      </div>

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={journals.length}
        noun="entries"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(journals.map(j => j.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          { label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete },
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} journal entr${bulk.count === 1 ? "y" : "ies"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "date", label: "Date", type: "date" },
            { key: "reference", label: "Reference #", type: "text", placeholder: "e.g. JV-001" },
          ]}
        />
      )}

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 560 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>New Journal Entry</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Reference #</label>
                  <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="e.g. JV-001"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                  <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>

                {/* Debit */}
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 16, border: "1px solid #bbf7d0" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 10, textTransform: "uppercase" }}>Debit (Dr)</div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account</label>
                  <select value={form.debitAccount} onChange={e => setForm(p => ({ ...p, debitAccount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
                    <option value="">Select account</option>
                    {accounts.map(a => <option key={a.id} value={a.name}>{a.code} — {a.name}</option>)}
                  </select>
                </div>

                {/* Credit */}
                <div style={{ background: "#fef2f2", borderRadius: 10, padding: 16, border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 10, textTransform: "uppercase" }}>Credit (Cr)</div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account</label>
                  <select value={form.creditAccount} onChange={e => setForm(p => ({ ...p, creditAccount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
                    <option value="">Select account</option>
                    {accounts.map(a => <option key={a.id} value={a.name}>{a.code} — {a.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount (Rs.)</label>
                  <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Notes</label>
                  <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>

              <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#10b981" }}>DR: {form.debitAccount || "—"}</span>
                <span style={{ fontWeight: 700 }}>Rs. {Number(form.amount || 0).toLocaleString()}</span>
                <span style={{ color: "#ef4444" }}>CR: {form.creditAccount || "—"}</span>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Post Entry</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}