import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "../firebase";
import toast from "react-hot-toast";
import { Plus, Trash2, X } from "lucide-react";

const ACCOUNT_TYPES = [
  { type: "Assets", sub: ["Current Assets", "Fixed Assets", "Bank & Cash", "Accounts Receivable", "Other Assets"] },
  { type: "Liabilities", sub: ["Current Liabilities", "Long-term Liabilities", "Accounts Payable", "Other Liabilities"] },
  { type: "Equity", sub: ["Owner's Equity", "Retained Earnings", "Capital"] },
  { type: "Income", sub: ["Fee Income", "Other Income", "Grants & Donations"] },
  { type: "Expenses", sub: ["Salaries & Wages", "Rent & Utilities", "Supplies", "Maintenance", "Transport", "Other Expenses"] },
];

const empty = { code: "", name: "", type: "", subType: "", description: "", balance: "0" };

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [filterType, setFilterType] = useState("All");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "accounts"), snap =>
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.code?.localeCompare(b.code)))
    );
    return unsub;
  }, []);

  const subTypes = ACCOUNT_TYPES.find(a => a.type === form.type)?.sub || [];
  const filtered = filterType === "All" ? accounts : accounts.filter(a => a.type === filterType);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "accounts"), { ...form, createdAt: serverTimestamp() });
    toast.success("Account added");
    setShowModal(false);
    setForm(empty);
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
        <button onClick={() => setShowModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Account
        </button>
      </div>

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
                        <button onClick={() => deleteDoc(doc(db, "accounts", acc.id))}
                          style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
                          <Trash2 size={14} />
                        </button>
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
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Add Account</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
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
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Save Account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}