import React, { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { parsePositiveAmount, todayLocal, isIsoDate, formatMoney } from "../utils/money";
import { useAccounts } from "../utils/useAccounts";
import { useSubmitLock } from "../utils/useSubmitLock";
import Pagination from "../components/UI/Pagination";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { isAutoJournal } from "../utils/autoJournals";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import toast from "react-hot-toast";
import { Plus, X, Trash2, Pencil } from "lucide-react";

// Accounts are referenced by id (debitAccountId / creditAccountId) so renaming an
// account never orphans a journal; the names are kept alongside for older readers.
const makeEmpty = () => ({ date: todayLocal(), reference: "", description: "", debitAccountId: "", creditAccountId: "", amount: "", notes: "" });

export default function Journals() {
  const { can } = useUser();
  const [journals, setJournals] = useState([]);
  const { accounts } = useAccounts();
  const { busy: submitting, run: runSubmit } = useSubmitLock();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(makeEmpty());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "journals"), snap => setJournals(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))));
    return () => { u1(); };
  }, []);

  // multi-select for bulk actions
  // Entries auto-posted from Expenses, fee collections and salaries are managed
  // with their source document (they follow its payment), so they
  // can't be selected, edited or deleted here.
  const isAuto = isAutoJournal;
  const manualIds = journals.filter(j => !isAuto(j)).map(j => j.id);

  const [show, setShow] = useState("manual"); // manual | auto | all
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const shown = journals.filter(j => show === "all" || (show === "auto") === isAuto(j));
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = shown.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [show, pageSize]);

  const bulk = useBulkSelect(manualIds);
  const visibleIds = paged.filter(j => !isAuto(j)).map(j => j.id);

  // Shown name: the account's CURRENT name when its id is known, else the stored name.
  const accountLabel = (id, storedName) => accounts.find(a => a.id === id)?.name || storedName || "—";

  const handleSubmit = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      const dr = accounts.find(a => a.id === form.debitAccountId);
      const cr = accounts.find(a => a.id === form.creditAccountId);
      if (!dr || !cr) return toast.error("Choose both a debit and a credit account");
      if (dr.id === cr.id) return toast.error("Debit and credit accounts must be different");
      const amt = parsePositiveAmount(form.amount);
      if (!amt.ok) return toast.error(amt.error);
      if (!isIsoDate(form.date)) return toast.error("Enter a valid date");
      try {
        await addDoc(collection(db, "journals"), {
          date: form.date, reference: form.reference, description: form.description, notes: form.notes,
          debitAccount: dr.name, creditAccount: cr.name,
          debitAccountId: dr.id, creditAccountId: cr.id,
          amount: amt.value, createdAt: serverTimestamp(),
        });
        toast.success("Journal entry saved");
        logActivity("created", "Journals", `${form.reference || "Journal"} — ${form.description} · Rs. ${formatMoney(amt.value)}`);
        setShowModal(false);
        setForm(makeEmpty());
      } catch (err) {
        toast.error(err?.message || "Could not save the journal entry");
      }
    });
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
        <button onClick={() => { setForm(makeEmpty()); setShowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> New Journal Entry
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["manual", "Manual"], ["auto", "Auto-posted"], ["all", "All"]].map(([k, label]) => (
          <button key={k} onClick={() => setShow(k)}
            style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid var(--border)", cursor: "pointer", fontSize: 13, fontWeight: 500, background: show === k ? "var(--primary)" : "white", color: show === k ? "white" : "#475569" }}>
            {label}
          </button>
        ))}
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
            {paged.map(j => (
              <tr key={j.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(j.id) ? "var(--primary-light)" : undefined }}>
                <td style={{ padding: "12px 6px 12px 16px" }}>
                  {!isAuto(j) && <RowCheckbox checked={bulk.isSelected(j.id)} onChange={() => bulk.toggle(j.id)} label={`Select journal entry ${j.reference || j.description}`} />}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{j.date}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>
                  {j.reference}
                  {isAuto(j) && <span title="Posted automatically from an expense, fee or salary payment; change or delete that instead" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: 10, fontFamily: "inherit", background: "#eef2ff", color: "#4f46e5" }}>Auto</span>}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500 }}>{j.description}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>
                    DR: {accountLabel(j.debitAccountId, j.debitAccount)}
                  </span>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "#fef2f2", color: "#ef4444", fontWeight: 600 }}>
                    CR: {accountLabel(j.creditAccountId, j.creditAccount)}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>Rs. {formatMoney(j.amount)}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{j.notes}</td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  {!isAuto(j) && can("canDeleteJournals") && <button onClick={() => handleDelete(j)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{journals.length === 0 ? "No journal entries yet" : "No entries in this view"}</div>}
      </div>

      <Pagination page={safePage} pageCount={pageCount} total={shown.length} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={manualIds.length}
        noun="entries"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(manualIds)}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          ...(can("canDeleteJournals") ? [{ label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete }] : []),
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
                  <select value={form.debitAccountId} onChange={e => setForm(p => ({ ...p, debitAccountId: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
                    <option value="">Select account</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>

                {/* Credit */}
                <div style={{ background: "#fef2f2", borderRadius: 10, padding: 16, border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 10, textTransform: "uppercase" }}>Credit (Cr)</div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account</label>
                  <select value={form.creditAccountId} onChange={e => setForm(p => ({ ...p, creditAccountId: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
                    <option value="">Select account</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount (Rs.)</label>
                  <input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Notes</label>
                  <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>

              <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#10b981" }}>DR: {accountLabel(form.debitAccountId, "")}</span>
                <span style={{ fontWeight: 700 }}>Rs. {formatMoney(form.amount || 0)}</span>
                <span style={{ color: "#ef4444" }}>CR: {accountLabel(form.creditAccountId, "")}</span>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontWeight: 600 }}>{submitting ? "Posting..." : "Post Entry"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}