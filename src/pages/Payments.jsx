import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import toast from "react-hot-toast";
import { Plus, X, ArrowUpCircle, ArrowDownCircle } from "lucide-react";

const empty = { type: "cash_in", account: "", description: "", amount: "", date: "", reference: "", branchId: "", category: "" };
const CATEGORIES = ["Fee Collection", "Salary Payment", "Rent", "Utilities", "Supplies", "Maintenance", "Bank Deposit", "Bank Withdrawal", "Other"];

export default function Payments() {
  const { branches, activeBranch } = useBranch();
  const [payments, setPayments] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "payments"), snap => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, "accounts"), snap => setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, []);

  const bankCashAccounts = accounts.filter(a => a.subType === "Bank & Cash" || a.type === "Assets");
  const filtered = payments.filter(p => activeBranch === "all" || p.branchId === activeBranch);
  const totalIn = filtered.filter(p => p.type === "cash_in").reduce((s, p) => s + Number(p.amount), 0);
  const totalOut = filtered.filter(p => p.type === "cash_out").reduce((s, p) => s + Number(p.amount), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "payments"), { ...form, createdAt: serverTimestamp() });
    toast.success("Payment recorded");
    setShowModal(false);
    setForm(empty);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Cash & Bank Payments</h2>
        <button onClick={() => setShowModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Payment
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Cash In", value: totalIn, color: "#10b981", bg: "#ecfdf5", icon: ArrowDownCircle },
          { label: "Total Cash Out", value: totalOut, color: "#ef4444", bg: "#fef2f2", icon: ArrowUpCircle },
          { label: "Net Balance", value: totalIn - totalOut, color: "#4f46e5", bg: "#eef2ff", icon: ArrowDownCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color }}> Rs. {value.toLocaleString()}</div>
            </div>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={20} color={color} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Date", "Type", "Account", "Category", "Description", "Reference", "Amount"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.date}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: p.type === "cash_in" ? "#ecfdf5" : "#fef2f2", color: p.type === "cash_in" ? "#10b981" : "#ef4444" }}>
                    {p.type === "cash_in" ? "Cash In" : "Cash Out"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.account}</td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.category}</td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.description}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontFamily: "monospace" }}>{p.reference}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600, color: p.type === "cash_in" ? "#10b981" : "#ef4444" }}>
                  {p.type === "cash_in" ? "+" : "-"}Rs. {Number(p.amount).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No payments recorded yet</div>}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Record Payment</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Payment Type</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="cash_in">Cash In</option>
                    <option value="cash_out">Cash Out</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account</label>
                  <select value={form.account} onChange={e => setForm(p => ({ ...p, account: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select account</option>
                    {bankCashAccounts.map(a => <option key={a.id} value={a.name}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Category</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount (Rs.)</label>
                  <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Reference #</label>
                  <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="e.g. CHQ-001"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                  <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}