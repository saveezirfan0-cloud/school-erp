import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import toast from "react-hot-toast";
import { Plus, MessageCircle, CheckCircle, X } from "lucide-react";

export default function Fees() {
  const { branches, activeBranch } = useBranch();
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ studentId: "", amount: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "" });

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "invoices"), snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsub2 = onSnapshot(collection(db, "students"), snap => setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsub1(); unsub2(); };
  }, []);

  const filtered = invoices.filter(inv => activeBranch === "all" || inv.branchId === activeBranch);

  const handleCreate = async (e) => {
    e.preventDefault();
    const student = students.find(s => s.id === form.studentId);
    if (!student) return toast.error("Student not found");
    await addDoc(collection(db, "invoices"), {
      ...form, studentName: student.name, parentPhone: student.parentPhone,
      branchId: student.branchId, status: "pending", createdAt: serverTimestamp()
    });
    toast.success("Invoice created");
    setShowModal(false);
  };

  const markPaid = async (inv) => {
    await updateDoc(doc(db, "invoices", inv.id), { status: "paid", paidDate: serverTimestamp() });
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `✅ Fee payment of $${inv.amount} for ${student.name} has been received for ${inv.month}. Thank you!`);
    }
    toast.success("Marked as paid & WhatsApp sent");
  };

  const sendReminder = async (inv) => {
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `📢 Reminder: Fee of $${inv.amount} for ${student.name} is due for ${inv.month}. Due date: ${inv.dueDate}. Please make payment at your earliest.`);
      toast.success("Reminder sent via WhatsApp");
    } else { toast.error("No parent phone number on record"); }
  };

  const statusBadge = (status) => ({
    padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
    background: status === "paid" ? "#ecfdf5" : "#fffbeb",
    color: status === "paid" ? "#10b981" : "#f59e0b"
  });

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
              {["Student", "Month", "Amount", "Due Date", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => (
              <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{inv.studentName}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{inv.month} {inv.year}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600 }}>${inv.amount}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{inv.dueDate}</td>
                <td style={{ padding: "12px 16px" }}><span style={statusBadge(inv.status)}>{inv.status}</span></td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {inv.status === "pending" && (
                      <button onClick={() => markPaid(inv)} style={{ border: "none", background: "#ecfdf5", color: "#10b981", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <CheckCircle size={14} /> Mark Paid
                      </button>
                    )}
                    <button onClick={() => sendReminder(inv)} style={{ border: "none", background: "#f0fdf4", color: "#16a34a", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <MessageCircle size={14} /> Remind
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices found</div>}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Create Invoice</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Student</label>
                  <select value={form.studentId} onChange={e => setForm(p => ({ ...p, studentId: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select student</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.studentId})</option>)}
                  </select>
                </div>
                {[
                  { label: "Month", key: "month", placeholder: "e.g. January" },
                  { label: "Amount ($)", key: "amount", type: "number" },
                  { label: "Due Date", key: "dueDate", type: "date" },
                  { label: "Notes", key: "notes" },
                ].map(({ label, key, type = "text", placeholder }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} placeholder={placeholder} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}