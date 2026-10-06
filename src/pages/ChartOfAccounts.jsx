import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, supabase } from "../firebase";
import { logActivity } from "../utils/auditLog";
import { DataWarnings } from "../components/ReportControls";
import { isCapped, isLive } from "../utils/reporting";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Edit2 } from "lucide-react";

const ACCOUNT_TYPES = [
  { type: "Assets", sub: ["Current Assets", "Fixed Assets", "Bank & Cash", "Accounts Receivable", "Other Assets"] },
  { type: "Liabilities", sub: ["Current Liabilities", "Long-term Liabilities", "Accounts Payable", "Other Liabilities"] },
  { type: "Equity", sub: ["Owner's Equity", "Retained Earnings", "Capital"] },
  { type: "Income", sub: ["Fee Income", "Other Income", "Grants & Donations"] },
  { type: "Expenses", sub: ["Salaries & Wages", "Rent & Utilities", "Supplies", "Maintenance", "Transport", "Other Expenses"] },
];

const empty = { code: "", name: "", type: "", subType: "", description: "", balance: "0" };

// Live journal entries that reference an account, by id (stable across renames)
// or by name (legacy entries). A failed lookup counts as none, like the
// payments check beside it.
async function countJournalsUsing(acc) {
  if (!acc) return 0;
  const count = (build) => build(supabase.from("journals").select("id", { count: "exact", head: true }).is("deleted_at", null))
    .then(({ count: n, error }) => (error ? 0 : n || 0), () => 0);
  const name = String(acc.name || "");
  const [drId, crId, drName, crName] = await Promise.all([
    count((q) => q.eq("extra->>debitAccountId", acc.id)),
    count((q) => q.eq("extra->>creditAccountId", acc.id)),
    name ? count((q) => q.eq("debit_account", name)) : 0,
    name ? count((q) => q.eq("credit_account", name)) : 0,
  ]);
  // An entry usually matches by both id and name; take the larger view, not the sum.
  return Math.max(drId + crId, drName + crName);
}

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType] = useState("All");

  const [capped, setCapped] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "accounts"), snap => {
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isLive).sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""))));
      setCapped(isCapped(snap.size));
    }, (err) => { console.error("Accounts load error:", err); setErrors({ accounts: err?.message || "Could not load" }); });
    return unsub;
  }, []);

  const subTypes = ACCOUNT_TYPES.find(a => a.type === form.type)?.sub || [];
  const filtered = filterType === "All" ? accounts : accounts.filter(a => a.type === filterType);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const name = String(form.name || "").trim();
      const clash = accounts.find(a => a.id !== editing && String(a.name || "").trim().toLowerCase() === name.toLowerCase());
      if (clash) {
        toast.error(`An account named "${clash.name}" already exists. Names must be unique because older records are matched by name.`);
        return;
      }
      if (editing) {
        const before = accounts.find(a => a.id === editing);
        const openingChanged = before && Number(before.balance || 0) !== Number(form.balance || 0);
        if (openingChanged && !window.confirm(`Change the opening balance of "${before.name}" from Rs. ${Number(before.balance || 0).toLocaleString()} to Rs. ${Number(form.balance || 0).toLocaleString()}? This changes the account's current balance and is recorded in the Activity Log.`)) {
          return;
        }
        await updateDoc(doc(db, "accounts", editing), { ...form, name, updatedAt: serverTimestamp() });
        const changes = before ? ["code", "name", "type", "subType", "balance"]
          .filter(k => String(before[k] ?? "") !== String(k === "name" ? name : form[k] ?? ""))
          .map(k => `${k}: ${before[k] ?? ""} -> ${k === "name" ? name : form[k] ?? ""}`) : [];
        logActivity("updated", "Chart of Accounts", `${before?.name || editing}${changes.length ? " · " + changes.join("; ") : ""}`);
        if (before && String(before.name || "").trim() !== name) await carryRename(String(before.name || "").trim(), name);
        toast.success("Account updated");
      } else {
        await addDoc(collection(db, "accounts"), { ...form, name, createdAt: serverTimestamp() });
        logActivity("created", "Chart of Accounts", `${form.code} ${name} (${form.type}) · opening Rs. ${Number(form.balance || 0).toLocaleString()}`);
        toast.success("Account added");
      }
      setShowModal(false);
      setForm(empty);
      setEditing(null);
    } catch (err) {
      toast.error(err?.message || "Error saving account");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (acc) => {
    setForm({
      code: acc.code || "", name: acc.name || "", type: acc.type || "",
      subType: acc.subType || "", description: acc.description || "", balance: String(acc.balance ?? "0"),
    });
    setEditing(acc.id);
    setShowModal(true);
  };

  // Records that point at an account by NAME (payments, paid-from
  // accounts, journals) are renamed with it, so a rename never cuts an
  // account off from its history. Failures are reported, not hidden.
  const carryRename = async (oldName, newName) => {
    const targets = [
      ["payments", "account"], ["invoices", "paid_account"], ["expenses", "paid_account"],
      ["payslips", "paid_account"], ["journals", "debit_account"], ["journals", "credit_account"],
    ];
    const results = await Promise.allSettled(targets.map(async ([table, col]) => {
      const { error } = await supabase.from(table).update({ [col]: newName }).eq(col, oldName);
      if (error) throw error;
    }));
    const failed = results.map((r, i) => (r.status === "rejected" ? `${targets[i][0]}.${targets[i][1]}` : null)).filter(Boolean);
    if (failed.length) {
      toast.error(`Renamed, but these records still use the old name: ${failed.join(", ")}. Older entries may not show under the new name.`, { duration: 8000 });
      logActivity("rename incomplete", "Chart of Accounts", `${oldName} -> ${newName}; not updated: ${failed.join(", ")}`);
    }
  };

  const handleDelete = async (id) => {
    const acc = accounts.find(a => a.id === id);
    // An account with transactions cannot be deleted: its history would
    // disappear from every balance.
    let used = null;
    try {
      const { count, error } = await supabase.from("payments").select("id", { count: "exact", head: true })
        .eq("account", acc?.name || "").is("deleted_at", null);
      if (!error) used = count;
    } catch { /* fall through to the plain confirm */ }
    if (used > 0) return toast.error(`"${acc?.name}" has ${used} transaction${used === 1 ? "" : "s"} and cannot be deleted. Transfer or reverse them first.`);
    // Journals point at accounts too (fee income and expense accounts never
    // appear on a payment). Deleting one would leave those entries unpostable.
    const journals = await countJournalsUsing(acc);
    if (journals > 0) return toast.error(`"${acc?.name}" is used by ${journals} journal entr${journals === 1 ? "y" : "ies"} and cannot be deleted. Move those entries to Trash or re-point them first.`);
    if (!window.confirm("Delete this account? You can restore it from Trash.")) return;
    try {
      await deleteDoc(doc(db, "accounts", id));
      logActivity("deleted", "Chart of Accounts", `${acc?.code || ""} ${acc?.name || id} · opening Rs. ${Number(acc?.balance || 0).toLocaleString()}`);
      toast.success("Account deleted");
    }
    catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const typeColors = {
    Assets: { bg: "#ecfdf5", color: "#10b981" },
    Liabilities: { bg: "#fef2f2", color: "#ef4444" },
    Equity: { bg: "#eef2ff", color: "#4f46e5" },
    Income: { bg: "#f0fdf4", color: "#16a34a" },
    Expenses: { bg: "#fffbeb", color: "#f59e0b" },
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Chart of Accounts</h2>
        <button onClick={() => { setForm(empty); setEditing(null); setShowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Account
        </button>
      </div>

      <DataWarnings capped={capped ? ["accounts"] : []} errors={errors} />

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["All", "Assets", "Liabilities", "Equity", "Income", "Expenses"].map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid var(--border)", cursor: "pointer", fontSize: 13, fontWeight: 500, background: filterType === t ? "var(--primary)" : "white", color: filterType === t ? "white" : "#475569" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Accounts grouped by type */}
      {(filterType === "All" ? ["Assets", "Liabilities", "Equity", "Income", "Expenses"] : [filterType]).map(type => {
        const group = filtered.filter(a => a.type === type);
        if (group.length === 0) return null;
        const c = typeColors[type];
        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: c.bg, color: c.color }}>{type}</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{group.length} accounts</span>
            </div>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Code", "Account Name", "Sub Type", "Description", "Opening Balance", ""].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.map(acc => (
                    <tr key={acc.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px", fontSize: 13, fontFamily: "monospace", fontWeight: 600 }}>{acc.code}</td>
                      <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{acc.name}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{acc.subType}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{acc.description}</td>
                      <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600 }}>Rs. {Number(acc.balance).toLocaleString()}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => openEdit(acc)} title="Edit"
                            style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDelete(acc.id)} title="Delete"
                            style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>No accounts yet. Add your first account to get started.</div>
      )}

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit Account" : "Add Account"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account Code</label>
                  <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. 1001" required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account Name</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Cash in Hand" required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account Type</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value, subType: "" }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select type</option>
                    {ACCOUNT_TYPES.map(a => <option key={a.type}>{a.type}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Sub Type</label>
                  <select value={form.subType} onChange={e => setForm(p => ({ ...p, subType: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select sub type</option>
                    {subTypes.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Opening Balance (Rs.)</label>
                  <input type="number" value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                  <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 600, opacity: submitting ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {submitting && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.5)", borderTop: "2px solid white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
                  {submitting ? "Saving..." : (editing ? "Update Account" : "Save Account")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}