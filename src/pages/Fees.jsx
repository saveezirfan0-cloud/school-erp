import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import toast from "react-hot-toast";
import { Plus, MessageCircle, CheckCircle, X, Trash2 } from "lucide-react";

const DEFAULT_LINE_ITEMS = [
  { description: "Tuition Fee", amount: "" },
];

export default function Fees() {
  const { branches, activeBranch } = useBranch();
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [form, setForm] = useState({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "" });
  const [lineItems, setLineItems] = useState(DEFAULT_LINE_ITEMS);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "invoices"), snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, "students"), snap => setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, []);

  const filtered = invoices.filter(inv => activeBranch === "all" || inv.branchId === activeBranch);
  const totalAmount = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);

  const addLineItem = () => setLineItems(p => [...p, { description: "", amount: "" }]);
  const removeLineItem = (idx) => setLineItems(p => p.filter((_, i) => i !== idx));
  const updateLineItem = (idx, field, value) => setLineItems(p => p.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const handleCreate = async (e) => {
    e.preventDefault();
    const student = students.find(s => s.id === form.studentId);
    if (!student) return toast.error("Student not found");
    const amount = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    await addDoc(collection(db, "invoices"), {
      ...form, studentName: student.name, parentPhone: student.parentPhone,
      branchId: student.branchId, status: "pending", amount, lineItems,
      createdAt: serverTimestamp()
    });
    toast.success("Invoice created");
    setShowModal(false);
    setForm({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "" });
    setLineItems(DEFAULT_LINE_ITEMS);
  };

  const markPaid = async (inv) => {
    await updateDoc(doc(db, "invoices", inv.id), { status: "paid", paidDate: serverTimestamp() });
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `✅ Fee payment of Rs. ${inv.amount} for ${student.name} has been received for ${inv.month}. Thank you!`);
    }
    toast.success("Marked as paid & WhatsApp sent");
  };

  const sendReminder = async (inv) => {
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `📢 Reminder: Fee of Rs. ${inv.amount} for ${student.name} is due for ${inv.month}. Due date: ${inv.dueDate}. Please make payment at your earliest.`);
      toast.success("Reminder sent via WhatsApp");
    } else { toast.error("No parent phone number on record"); }
  };

  const LINE_ITEM_PRESETS = ["Tuition Fee", "Registration Fee", "Exam Fee", "Transport Fee", "Custom"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Fees & Invoices</h2>
        <button onClick={() => setShowModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Create Invoice
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Student", "Month", "Line Items", "Total", "Due Date", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => (
              <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{inv.studentName}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{inv.month} {inv.year}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>
                  {inv.lineItems ? inv.lineItems.map(li => li.description).join(", ") : "—"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600 }}>Rs. {Number(inv.amount).toLocaleString()}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{inv.dueDate}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : "#f59e0b" }}>
                    {inv.status}
                  </span>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {inv.status === "pending" && (
                      <button onClick={() => markPaid(inv)} style={{ border: "none", background: "#ecfdf5", color: "#10b981", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <CheckCircle size={14} /> Paid
                      </button>
                    )}
                    <button onClick={() => sendReminder(inv)} style={{ border: "none", background: "#f0fdf4", color: "#16a34a", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <MessageCircle size={14} /> Remind
                    </button>
                    <button onClick={() => setSelectedInvoice(inv)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices found</div>}
      </div>

      {/* Create Invoice Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 600, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Create Invoice</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Student</label>
                  <select value={form.studentId} onChange={e => setForm(p => ({ ...p, studentId: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select student</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.studentId})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Month</label>
                  <input value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))} placeholder="e.g. January" required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Fee Line Items</label>
                  <button type="button" onClick={addLineItem}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "var(--primary-light)", color: "var(--primary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", background: "#f8fafc", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", gap: 8 }}>
                    <span>Description</span><span>Amount (Rs.)</span><span></span>
                  </div>
                  {lineItems.map((item, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "8px 12px", borderTop: "1px solid var(--border)", gap: 8, alignItems: "center" }}>
                      <select value={item.description} onChange={e => updateLineItem(idx, "description", e.target.value)}
                        style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                        <option value="">Select type</option>
                        {LINE_ITEM_PRESETS.map(p => <option key={p}>{p}</option>)}
                      </select>
                      {item.description === "Custom" ? (
                        <input value={item.customDescription || ""} onChange={e => updateLineItem(idx, "customDescription", e.target.value)}
                          placeholder="Custom description"
                          style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 160 }} />
                      ) : null}
                      <input type="number" value={item.amount} onChange={e => updateLineItem(idx, "amount", e.target.value)} placeholder="0"
                        style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 110 }} />
                      {lineItems.length > 1 && (
                        <button type="button" onClick={() => removeLineItem(idx)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px", borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
                    <strong style={{ fontSize: 15 }}>Total: Rs. {totalAmount.toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Notes</label>
                <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Create Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Invoice Detail</h3>
              <button onClick={() => setSelectedInvoice(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Student</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{selectedInvoice.studentName}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Period</div>
              <div style={{ fontWeight: 600 }}>{selectedInvoice.month} {selectedInvoice.year}</div>
            </div>
            {selectedInvoice.lineItems && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                {selectedInvoice.lineItems.map((li, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span>{li.customDescription || li.description}</span>
                    <span style={{ fontWeight: 600 }}>Rs. {Number(li.amount).toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#f8fafc", fontWeight: 700 }}>
                  <span>Total</span>
                  <span style={{ color: "var(--primary)" }}>Rs. {Number(selectedInvoice.amount).toLocaleString()}</span>
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-muted)" }}>Status</span>
              <span style={{ fontWeight: 600, color: selectedInvoice.status === "paid" ? "#10b981" : "#f59e0b" }}>{selectedInvoice.status}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}