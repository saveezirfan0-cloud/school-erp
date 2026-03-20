import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, doc, onSnapshot, serverTimestamp, getDocs } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, MessageCircle, CheckCircle, X, Trash2, Download, FileText, RefreshCw, Users } from "lucide-react";

const DEFAULT_LINE_ITEMS = [{ description: "Tuition Fee", amount: "" }];
const LINE_ITEM_PRESETS = ["Tuition Fee", "Registration Fee", "Exam Fee", "Transport Fee", "Custom"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Fees() {
  const { branches, activeBranch } = useBranch();
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [form, setForm] = useState({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "", directPayment: false });
  const [lineItems, setLineItems] = useState(DEFAULT_LINE_ITEMS);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [bulkMonth, setBulkMonth] = useState("");
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [bulkStudents, setBulkStudents] = useState([]);
  const [recurringMonth, setRecurringMonth] = useState(MONTHS[new Date().getMonth()]);
  const [recurringYear, setRecurringYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "invoices"), snap => setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, "students"), snap => {
      const s = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(s);
      setBulkStudents(s.map(st => ({ ...st, selected: false, amount: st.monthlyFee || "", paid: false })));
    });
    return () => { u1(); u2(); };
  }, []);

  const filtered = invoices.filter(inv => {
    const matchBranch = (activeBranch === "all" || inv.branchId === activeBranch) && (!filterBranch || inv.branchId === filterBranch);
    const matchStatus = !filterStatus || inv.status === filterStatus;
    const matchMonth = !filterMonth || inv.month === filterMonth;
    const matchStudent = !filterStudent || inv.studentName?.toLowerCase().includes(filterStudent.toLowerCase());
    return matchBranch && matchStatus && matchMonth && matchStudent;
  });

  const totalAmount = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);
  const addLineItem = () => setLineItems(p => [...p, { description: "", amount: "" }]);
  const removeLineItem = (idx) => setLineItems(p => p.filter((_, i) => i !== idx));
  const updateLineItem = (idx, field, value) => setLineItems(p => p.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const handleCreate = async (e) => {
    e.preventDefault();
    const student = students.find(s => s.id === form.studentId);
    if (!student) return toast.error("Student not found");
    const amount = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    const status = form.directPayment ? "paid" : "pending";
    await addDoc(collection(db, "invoices"), {
      ...form, studentName: student.name, parentPhone: student.parentPhone,
      branchId: student.branchId, status, amount, lineItems,
      paidDate: form.directPayment ? serverTimestamp() : null,
      createdAt: serverTimestamp()
    });
    if (form.directPayment && student.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `✅ Fee payment of Rs. ${amount} received for ${student.name} for ${form.month}. Thank you!`);
    }
    toast.success(form.directPayment ? "Payment received & invoice created" : "Invoice created");
    setShowModal(false);
    setForm({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "", directPayment: false });
    setLineItems(DEFAULT_LINE_ITEMS);
  };

  const handleBulkReceive = async (e) => {
    e.preventDefault();
    const selected = bulkStudents.filter(s => s.selected);
    if (selected.length === 0) return toast.error("Select at least one student");
    let count = 0;
    for (const s of selected) {
      await addDoc(collection(db, "invoices"), {
        studentId: s.id, studentName: s.name, parentPhone: s.parentPhone,
        branchId: s.branchId, status: s.paid ? "paid" : "pending",
        amount: Number(s.amount), month: bulkMonth, year: bulkYear,
        dueDate: bulkDueDate, lineItems: [{ description: "Tuition Fee", amount: s.amount }],
        paidDate: s.paid ? serverTimestamp() : null, createdAt: serverTimestamp()
      });
      if (s.paid && s.parentPhone) {
        await sendWhatsAppMessage(s.parentPhone, `✅ Fee of Rs. ${s.amount} received for ${s.name} — ${bulkMonth} ${bulkYear}. Thank you!`);
      }
      count++;
    }
    toast.success(`${count} invoices created`);
    setShowBulk(false);
  };

  const handleGenerateRecurring = async () => {
    const recurringStudents = students.filter(s => s.recurringFee);
    if (recurringStudents.length === 0) return toast.error("No students have auto-recurring fees enabled");
    const existing = invoices.filter(i => i.month === recurringMonth && Number(i.year) === Number(recurringYear));
    const existingIds = new Set(existing.map(i => i.studentId));
    let count = 0;
    for (const s of recurringStudents) {
      if (existingIds.has(s.id)) continue;
      await addDoc(collection(db, "invoices"), {
        studentId: s.id, studentName: s.name, parentPhone: s.parentPhone,
        branchId: s.branchId, status: "pending", amount: Number(s.monthlyFee),
        month: recurringMonth, year: recurringYear,
        lineItems: [{ description: "Tuition Fee", amount: s.monthlyFee }],
        createdAt: serverTimestamp()
      });
      count++;
    }
    toast.success(count > 0 ? `Generated ${count} invoices for ${recurringMonth} ${recurringYear}` : "All recurring invoices already exist for this month");
    setShowRecurring(false);
  };

  const markPaid = async (inv) => {
    await updateDoc(doc(db, "invoices", inv.id), { status: "paid", paidDate: serverTimestamp() });
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) await sendWhatsAppMessage(student.parentPhone, `✅ Fee of Rs. ${inv.amount} for ${student.name} received for ${inv.month}. Thank you!`);
    toast.success("Marked paid");
  };

  const sendReminder = async (inv) => {
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `📢 Fee of Rs. ${inv.amount} for ${student.name} is due for ${inv.month}. Due: ${inv.dueDate}.`);
      toast.success("Reminder sent");
    } else toast.error("No phone number");
  };

  const handleCSV = () => exportToCSV("fees", ["Student", "Month", "Year", "Amount", "Status", "Due Date", "Branch"],
    filtered.map(i => [i.studentName, i.month, i.year, i.amount, i.status, i.dueDate, branches.find(b => b.id === i.branchId)?.name || "Main"]));

  const handlePDF = () => exportToPDF("Fees & Invoices Report", ["Student", "Month", "Amount", "Status", "Due Date"],
    filtered.map(i => [i.studentName, `${i.month} ${i.year}`, `Rs. ${Number(i.amount).toLocaleString()}`, i.status, i.dueDate]));

  const totalCollected = filtered.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalPending = filtered.filter(i => i.status === "pending").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Fees & Invoices</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
          <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          <button onClick={() => setShowRecurring(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><RefreshCw size={14} /> Recurring</button>
          <button onClick={() => setShowBulk(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#2a8c7a", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Users size={14} /> Bulk Receive</button>
          <button onClick={() => { setForm({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "", directPayment: false }); setLineItems(DEFAULT_LINE_ITEMS); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Plus size={14} /> New Invoice</button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Collected", value: totalCollected, color: "#10b981", bg: "#ecfdf5" },
          { label: "Pending", value: totalPending, color: "#f59e0b", bg: "#fffbeb" },
          { label: "Total Invoices", value: filtered.length, color: "#4f46e5", bg: "#eef2ff", isCount: true },
        ].map(({ label, value, color, bg, isCount }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{isCount ? value : `Rs. ${value.toLocaleString()}`}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={filterStudent} onChange={e => setFilterStudent(e.target.value)} placeholder="Search student..."
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, minWidth: 160 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Status</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Months</option>
          {MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {(filterStatus || filterMonth || filterBranch || filterStudent) && (
          <button onClick={() => { setFilterStatus(""); setFilterMonth(""); setFilterBranch(""); setFilterStudent(""); }}
            style={{ padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Student", "Month", "Line Items", "Total", "Due Date", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => (
              <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>{inv.studentName}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{inv.month} {inv.year}</td>
                <td style={{ padding: "11px 14px", fontSize: 12, color: "var(--text-muted)" }}>{inv.lineItems?.map(li => li.description).join(", ") || "—"}</td>
                <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600 }}>Rs. {Number(inv.amount).toLocaleString()}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{inv.dueDate || "—"}</td>
                <td style={{ padding: "11px 14px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : "#f59e0b" }}>{inv.status}</span>
                </td>
                <td style={{ padding: "11px 14px" }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    {inv.status === "pending" && <button onClick={() => markPaid(inv)} style={{ border: "none", background: "#ecfdf5", color: "#10b981", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}><CheckCircle size={13} /> Paid</button>}
                    <button onClick={() => sendReminder(inv)} style={{ border: "none", background: "#f0fdf4", color: "#16a34a", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}><MessageCircle size={13} /> Remind</button>
                    <button onClick={() => setSelectedInvoice(inv)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices found</div>}
      </div>

      {/* Single Invoice Modal */}
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
                  <select value={form.studentId} onChange={e => {
                    const s = students.find(st => st.id === e.target.value);
                    setForm(p => ({ ...p, studentId: e.target.value }));
                    if (s?.monthlyFee) setLineItems([{ description: "Tuition Fee", amount: s.monthlyFee }]);
                  }} required style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select student</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.studentId})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Month</label>
                  <select value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select month</option>
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>

              {/* Direct payment toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, background: form.directPayment ? "#ecfdf5" : "#f8fafc", borderRadius: 10, marginBottom: 20, border: `1px solid ${form.directPayment ? "#bbf7d0" : "var(--border)"}` }}>
                <input type="checkbox" id="directPay" checked={form.directPayment} onChange={e => setForm(p => ({ ...p, directPayment: e.target.checked }))} style={{ width: 18, height: 18 }} />
                <div>
                  <label htmlFor="directPay" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Directly receive payment (mark as paid immediately)</label>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Creates invoice and marks it paid — WhatsApp receipt sent to parent</div>
                </div>
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Fee Line Items</label>
                  <button type="button" onClick={addLineItem} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "var(--primary-light)", color: "var(--primary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}><Plus size={12} /> Add Item</button>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", background: "#f8fafc", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", gap: 8 }}>
                    <span>Description</span><span>Amount (Rs.)</span><span></span>
                  </div>
                  {lineItems.map((item, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "8px 12px", borderTop: "1px solid var(--border)", gap: 8, alignItems: "center" }}>
                      <select value={item.description} onChange={e => updateLineItem(idx, "description", e.target.value)}
                        style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                        <option value="">Select</option>
                        {LINE_ITEM_PRESETS.map(p => <option key={p}>{p}</option>)}
                      </select>
                      <input type="number" value={item.amount} onChange={e => updateLineItem(idx, "amount", e.target.value)} placeholder="0"
                        style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 110 }} />
                      {lineItems.length > 1 && <button type="button" onClick={() => removeLineItem(idx)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={14} /></button>}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px", borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
                    <strong>Total: Rs. {totalAmount.toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: form.directPayment ? "#10b981" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  {form.directPayment ? "Receive Payment" : "Create Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Receive Modal */}
      {showBulk && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 700, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Bulk Fee Receive</h3>
              <button onClick={() => setShowBulk(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleBulkReceive}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Month</label>
                  <select value={bulkMonth} onChange={e => setBulkMonth(e.target.value)} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select</option>
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Year</label>
                  <input type="number" value={bulkYear} onChange={e => setBulkYear(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Due Date</label>
                  <input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => setBulkStudents(p => p.map(s => ({ ...s, selected: true })))}
                  style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Select All</button>
                <button type="button" onClick={() => setBulkStudents(p => p.map(s => ({ ...s, selected: false })))}
                  style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Deselect All</button>
                <span style={{ fontSize: 13, color: "var(--text-muted)", alignSelf: "center" }}>
                  {bulkStudents.filter(s => s.selected).length} selected
                </span>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 100px 120px 100px", background: "#f8fafc", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", gap: 8 }}>
                  <span></span><span>Student</span><span>Grade</span><span>Amount (Rs.)</span><span>Mark Paid</span>
                </div>
                {bulkStudents.map((s, idx) => (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "36px 1fr 100px 120px 100px", padding: "8px 12px", borderTop: "1px solid var(--border)", gap: 8, alignItems: "center", background: s.selected ? "#fef9f9" : "white" }}>
                    <input type="checkbox" checked={s.selected} onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, selected: e.target.checked } : st))} style={{ width: 16, height: 16 }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.grade}</span>
                    <input type="number" value={s.amount} onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, amount: e.target.value } : st))}
                      style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} />
                    <input type="checkbox" checked={s.paid} onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, paid: e.target.checked } : st))} style={{ width: 16, height: 16 }} />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowBulk(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  Create {bulkStudents.filter(s => s.selected).length} Invoices
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recurring Modal */}
      {showRecurring && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Generate Recurring Fees</h3>
              <button onClick={() => setShowRecurring(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: 16, background: "#f8fafc", borderRadius: 10, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
              This will auto-generate invoices for all <strong style={{ color: "#10b981" }}>{students.filter(s => s.recurringFee).length} students</strong> with recurring fees enabled. Already existing invoices for this month will be skipped.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Month</label>
                <select value={recurringMonth} onChange={e => setRecurringMonth(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                  {MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Year</label>
                <input type="number" value={recurringYear} onChange={e => setRecurringYear(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setShowRecurring(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleGenerateRecurring} style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Generate Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail */}
      {selectedInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Invoice Detail</h3>
              <button onClick={() => setSelectedInvoice(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Student</div><div style={{ fontWeight: 600 }}>{selectedInvoice.studentName}</div></div>
            <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Period</div><div style={{ fontWeight: 600 }}>{selectedInvoice.month} {selectedInvoice.year}</div></div>
            {selectedInvoice.lineItems && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
                {selectedInvoice.lineItems.map((li, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span>{li.customDescription || li.description}</span>
                    <span style={{ fontWeight: 600 }}>Rs. {Number(li.amount).toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#f8fafc", fontWeight: 700 }}>
                  <span>Total</span><span style={{ color: "var(--primary)" }}>Rs. {Number(selectedInvoice.amount).toLocaleString()}</span>
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