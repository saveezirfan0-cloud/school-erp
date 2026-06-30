import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "../firebase";
import { useBranch } from "../context/BranchContext";
import Pagination from "../components/UI/Pagination";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import { recordPayment, bankCashAccounts, reverseSourcePayments, getSourcePaidTotal } from "../utils/accounting";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, MessageCircle, CheckCircle, X, Trash2, Download, FileText, RefreshCw, Users } from "lucide-react";

const DEFAULT_LINE_ITEMS = [{ description: "Tuition Fee", amount: "" }];
const LINE_ITEM_PRESETS = ["Tuition Fee", "Registration Fee", "Exam Fee", "Transport Fee", "Custom"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Fees() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payModal, setPayModal] = useState(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(0);
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [bulkMonth, setBulkMonth] = useState("");
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [bulkStudents, setBulkStudents] = useState([]);
  const [recurringMonth, setRecurringMonth] = useState(MONTHS[new Date().getMonth()]);
  const [recurringYear, setRecurringYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "invoices"), snap =>
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, "students"), snap => {
      const s = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(s);
      setBulkStudents(s.map(st => ({ ...st, selected: false, amount: st.monthlyFee || "", paid: false })));
    });
    const u3 = onSnapshot(collection(db, "accounts"), snap =>
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); u3(); };
  }, []);

  const payAccounts = bankCashAccounts(accounts);

  useEffect(() => { setPage(1); }, [filterStatus, filterMonth, filterBranch, filterStudent, pageSize, activeBranch]);

  const filtered = invoices.filter(inv => {
    const matchBranch = (activeBranch === "all" || inv.branchId === activeBranch) && (!filterBranch || inv.branchId === filterBranch);
    const matchStatus = !filterStatus || inv.status === filterStatus;
    const matchMonth = !filterMonth || inv.month === filterMonth;
    const matchStudent = !filterStudent || inv.studentName?.toLowerCase().includes(filterStudent.toLowerCase());
    return matchBranch && matchStatus && matchMonth && matchStudent;
  }).sort((a, b) => {
    // createdAt is an ISO string after the Supabase migration (was a
    // Firestore Timestamp before). Parse defensively for both.
    const ts = (v) => {
      if (!v) return 0;
      if (typeof v?.toDate === "function") return v.toDate().getTime();
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return ts(b.createdAt) - ts(a.createdAt);
  });

  // pagination over filtered invoices
  const rowCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const totalAmount = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalCollected = filtered.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalPending = filtered.filter(i => i.status === "pending").reduce((s, i) => s + Number(i.amount), 0);

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
    toast.success(form.directPayment ? "Payment received!" : "Invoice created");
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
        dueDate: bulkDueDate,
        lineItems: [{ description: "Tuition Fee", amount: s.amount }],
        paidDate: s.paid ? serverTimestamp() : null,
        createdAt: serverTimestamp()
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
    toast.success(count > 0 ? `Generated ${count} invoices` : "All invoices already exist for this month");
    setShowRecurring(false);
  };

  const markPaid = async (inv) => {
    setPayModal(inv);
    setPayAccount(payAccounts[0]?.name || "");
    setPayDate(new Date().toISOString().slice(0, 10));
    // Look up how much has already been received for this invoice.
    try {
      const paid = await getSourcePaidTotal("invoice", inv.id);
      setAlreadyPaid(paid);
      const remaining = Math.max(0, Number(inv.amount || 0) - paid);
      setPayAmount(String(remaining));
    } catch {
      setAlreadyPaid(0);
      setPayAmount(String(inv.amount || ""));
    }
  };

  const confirmPay = async () => {
    if (!payAccount) return toast.error("Select the account that received payment");
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    const total = Number(payModal.amount || 0);
    const newPaid = alreadyPaid + amt;
    if (newPaid - total > 0.001) return toast.error(`That exceeds the balance. Remaining is Rs. ${(total - alreadyPaid).toLocaleString()}`);
    try {
      await recordPayment({
        type: "cash_in",
        account: payAccount,
        amount: amt,
        category: "Fee Collection",
        description: `Fee — ${payModal.studentName || "student"} (${payModal.month || ""})`,
        reference: payModal.id,
        branchId: payModal.branchId || "",
        date: payDate,
        source: "invoice",
        sourceId: payModal.id,
      });
      const status = newPaid + 0.001 >= total ? "paid" : "partial";
      await updateDoc(doc(db, "invoices", payModal.id), {
        status,
        paidAmount: newPaid,
        paidDate: payDate,
        paidAccount: payAccount,
      });
      const student = students.find(s => s.id === payModal.studentId);
      if (student?.parentPhone) {
        const msg = status === "paid"
          ? `✅ Fee fully paid for ${student.name} (${payModal.month}). Thank you!`
          : `✅ Part payment of Rs. ${amt.toLocaleString()} received for ${student.name} (${payModal.month}). Balance: Rs. ${(total - newPaid).toLocaleString()}.`;
        await sendWhatsAppMessage(student.parentPhone, msg);
      }
      toast.success(status === "paid" ? "Payment recorded — fully paid" : "Partial payment recorded");
      setPayModal(null);
      setPayAccount("");
      setPayAmount("");
    } catch (e) {
      toast.error(e?.message || "Error recording payment");
    }
  };

  const sendReminder = async (inv) => {
    const student = students.find(s => s.id === inv.studentId);
    if (student?.parentPhone) {
      await sendWhatsAppMessage(student.parentPhone, `📢 Fee of Rs. ${inv.amount} for ${student.name} is due for ${inv.month}. Due: ${inv.dueDate}.`);
      toast.success("Reminder sent");
    } else toast.error("No phone number on record");
  };

  const handleDelete = async (inv) => {
    if (!window.confirm("Delete this invoice? Any recorded payments for it will be reversed. You can restore it from Trash.")) return;
    try {
      // Reverse any money posted for this invoice so balances don't drift.
      await reverseSourcePayments("invoice", inv.id);
      await deleteDoc(doc(db, "invoices", inv.id));
      toast.success("Invoice deleted");
    } catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handleCSV = () => exportToCSV("fees",
    ["Student", "Month", "Year", "Amount", "Status", "Due Date"],
    filtered.map(i => [i.studentName, i.month, i.year, i.amount, i.status, i.dueDate])
  );

  const handlePDF = () => exportToPDF("Fees & Invoices",
    ["Student", "Month", "Amount", "Status", "Due Date"],
    filtered.map(i => [i.studentName, `${i.month} ${i.year}`, `Rs. ${Number(i.amount).toLocaleString()}`, i.status, i.dueDate])
  );

  const modalStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center", zIndex: 1000
  };
  const sheetStyle = {
    background: "white",
    borderRadius: isMobile ? "20px 20px 0 0" : 16,
    padding: isMobile ? "24px 20px" : 32,
    width: "100%", maxHeight: "92vh", overflow: "auto"
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Fees & Invoices</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && (
            <>
              <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
              <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
            </>
          )}
          <button onClick={() => setShowRecurring(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><RefreshCw size={14} />{!isMobile && " Recurring"}</button>
          <button onClick={() => setShowBulk(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#2a8c7a", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Users size={14} />{!isMobile && " Bulk"}</button>
          <button onClick={() => { setForm({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "", directPayment: false }); setLineItems(DEFAULT_LINE_ITEMS); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={14} />{!isMobile && " New Invoice"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Collected", value: totalCollected, color: "#10b981", bg: "#ecfdf5" },
          { label: "Pending", value: totalPending, color: "#f59e0b", bg: "#fffbeb" },
          { label: "Invoices", value: filtered.length, color: "#4f46e5", bg: "#eef2ff", isCount: true },
        ].map(({ label, value, color, bg, isCount }) => (
          <div key={label} style={{ background: "white", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color }}>
              {isCount ? value : `Rs. ${value.toLocaleString()}`}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={filterStudent} onChange={e => setFilterStudent(e.target.value)} placeholder="Search student..."
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, flex: 1, minWidth: 120 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}>
          <option value="">All</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
        </select>
        {!isMobile && (
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}>
            <option value="">All Months</option>
            {MONTHS.map(m => <option key={m}>{m}</option>)}
          </select>
        )}
        {(filterStatus || filterMonth || filterStudent || filterBranch) && (
          <button onClick={() => { setFilterStatus(""); setFilterMonth(""); setFilterStudent(""); setFilterBranch(""); }}
            style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>Clear</button>
        )}
      </div>

      {/* Mobile card view */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map(inv => (
            <div key={inv.id} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{inv.studentName}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{inv.month} {inv.year}</div>
                </div>
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : inv.status === "partial" ? "#eff6ff" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : inv.status === "partial" ? "#2563eb" : "#f59e0b" }}>
                  {inv.status}{inv.status === "partial" && inv.paidAmount ? ` (Rs. ${Number(inv.paidAmount).toLocaleString()})` : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>
                  Rs. {Number(inv.amount).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Due: {inv.dueDate || "—"}</div>
              </div>
              {inv.lineItems && inv.lineItems.length > 0 && (
                <div style={{ marginBottom: 10, padding: "6px 10px", background: "#f8fafc", borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  {inv.lineItems.map(li => li.description).join(" • ")}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                {inv.status !== "paid" && (
                  <button onClick={() => markPaid(inv)}
                    style={{ flex: 1, border: "none", background: "#ecfdf5", color: "#10b981", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <CheckCircle size={14} /> {inv.status === "partial" ? "Add Payment" : "Mark Paid"}
                  </button>
                )}
                <button onClick={() => sendReminder(inv)}
                  style={{ flex: 1, border: "none", background: "#f0fdf4", color: "#16a34a", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  <MessageCircle size={14} /> Remind
                </button>
                <button onClick={() => setSelectedInvoice(inv)}
                  style={{ flex: 1, border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  View
                </button>
                <button onClick={() => handleDelete(inv)} title="Delete invoice"
                  style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "10px 12px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
              No invoices found
            </div>
          )}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Student", "Month", "Line Items", "Total", "Due Date", "Status", "Actions"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(inv => (
                  <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>{inv.studentName}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{inv.month} {inv.year}</td>
                    <td style={{ padding: "11px 14px", fontSize: 12, color: "var(--text-muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {inv.lineItems?.map(li => li.description).join(", ") || "—"}
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>Rs. {Number(inv.amount).toLocaleString()}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{inv.dueDate || "—"}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : inv.status === "partial" ? "#eff6ff" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : inv.status === "partial" ? "#2563eb" : "#f59e0b", whiteSpace: "nowrap" }}>
                        {inv.status}{inv.status === "partial" && inv.paidAmount ? ` · Rs.${Number(inv.paidAmount).toLocaleString()}` : ""}
                      </span>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        {inv.status !== "paid" && (
                          <button onClick={() => markPaid(inv)} style={{ border: "none", background: "#ecfdf5", color: "#10b981", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
                            <CheckCircle size={12} /> {inv.status === "partial" ? "Add" : "Paid"}
                          </button>
                        )}
                        <button onClick={() => sendReminder(inv)} style={{ border: "none", background: "#f0fdf4", color: "#16a34a", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>Remind</button>
                        <button onClick={() => setSelectedInvoice(inv)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>View</button>
                        <button onClick={() => handleDelete(inv)} title="Delete invoice" style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "5px 8px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center" }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No invoices found</div>}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={rowCount} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {/* Record payment modal */}
      {payModal && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setPayModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Record Fee Payment</h3>
              <button onClick={() => setPayModal(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontWeight: 600 }}>{payModal.studentName}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{payModal.month} {payModal.year}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Invoice</div><div style={{ fontWeight: 700 }}>Rs. {Number(payModal.amount || 0).toLocaleString()}</div></div>
                <div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Already paid</div><div style={{ fontWeight: 700, color: "#10b981" }}>Rs. {alreadyPaid.toLocaleString()}</div></div>
                <div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Balance</div><div style={{ fontWeight: 700, color: "var(--primary)" }}>Rs. {Math.max(0, Number(payModal.amount || 0) - alreadyPaid).toLocaleString()}</div></div>
              </div>
            </div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Amount to pay now *</label>
            <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Received into account *</label>
            {payAccounts.length === 0 ? (
              <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 12 }}>No Bank &amp; Cash accounts yet. Add one in Chart of Accounts first.</div>
            ) : (
              <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12 }}>
                {payAccounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select>
            )}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Payment date</label>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 18, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPayModal(null)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white" }}>Cancel</button>
              <button onClick={confirmPay} disabled={payAccounts.length === 0}
                style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: payAccounts.length === 0 ? "not-allowed" : "pointer", fontWeight: 600, opacity: payAccounts.length === 0 ? 0.6 : 1 }}>
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showModal && (
        <div style={modalStyle}>
          <div style={{ ...sheetStyle, maxWidth: isMobile ? "100%" : 600 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>New Invoice</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 16 }}>
                <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Student</label>
                  <select value={form.studentId} onChange={e => {
                    const s = students.find(st => st.id === e.target.value);
                    setForm(p => ({ ...p, studentId: e.target.value }));
                    if (s?.monthlyFee) setLineItems([{ description: "Tuition Fee", amount: s.monthlyFee }]);
                  }} required style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select student</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.studentId})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Month</label>
                  <select value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))} required
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select month</option>
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
              </div>

              {/* Direct payment toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, background: form.directPayment ? "#ecfdf5" : "#f8fafc", borderRadius: 10, marginBottom: 16, border: `1px solid ${form.directPayment ? "#bbf7d0" : "var(--border)"}` }}>
                <input type="checkbox" id="directPay" checked={form.directPayment} onChange={e => setForm(p => ({ ...p, directPayment: e.target.checked }))} style={{ width: 18, height: 18 }} />
                <div>
                  <label htmlFor="directPay" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Receive payment now (mark as paid immediately)</label>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>WhatsApp receipt sent to parent automatically</div>
                </div>
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Fee Line Items</label>
                  <button type="button" onClick={addLineItem}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "var(--primary-light)", color: "var(--primary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  {lineItems.map((item, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "10px 12px", borderBottom: idx < lineItems.length - 1 ? "1px solid var(--border)" : "none", gap: 8, alignItems: "center" }}>
                      <select value={item.description} onChange={e => updateLineItem(idx, "description", e.target.value)}
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }}>
                        <option value="">Select type</option>
                        {LINE_ITEM_PRESETS.map(p => <option key={p}>{p}</option>)}
                      </select>
                      <input type="number" value={item.amount} onChange={e => updateLineItem(idx, "amount", e.target.value)} placeholder="0"
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, width: 100 }} />
                      {lineItems.length > 1 && (
                        <button type="button" onClick={() => removeLineItem(idx)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px", background: "#f8fafc" }}>
                    <strong style={{ fontSize: 15 }}>Total: Rs. {totalAmount.toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                <button type="submit"
                  style={{ flex: 2, padding: "11px", background: form.directPayment ? "#10b981" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {form.directPayment ? "Receive Payment" : "Create Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Receive Modal */}
      {showBulk && (
        <div style={modalStyle}>
          <div style={{ ...sheetStyle, maxWidth: isMobile ? "100%" : 700 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Bulk Fee Receive</h3>
              <button onClick={() => setShowBulk(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleBulkReceive}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Month</label>
                  <select value={bulkMonth} onChange={e => setBulkMonth(e.target.value)} required
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select</option>
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Year</label>
                  <input type="number" value={bulkYear} onChange={e => setBulkYear(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Due Date</label>
                  <input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                <button type="button" onClick={() => setBulkStudents(p => p.map(s => ({ ...s, selected: true })))}
                  style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 12, background: "white" }}>Select All</button>
                <button type="button" onClick={() => setBulkStudents(p => p.map(s => ({ ...s, selected: false })))}
                  style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 12, background: "white" }}>Deselect All</button>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{bulkStudents.filter(s => s.selected).length} selected</span>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16, maxHeight: 320, overflowY: "auto" }}>
                {bulkStudents.map((s, idx) => (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto auto", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 10, alignItems: "center", background: s.selected ? "#fef9f9" : "white" }}>
                    <input type="checkbox" checked={s.selected}
                      onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, selected: e.target.checked } : st))}
                      style={{ width: 16, height: 16 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.grade}</div>
                    </div>
                    <input type="number" value={s.amount}
                      onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, amount: e.target.value } : st))}
                      style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 90 }}
                      placeholder="Amount" />
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
                      <input type="checkbox" checked={s.paid}
                        onChange={e => setBulkStudents(p => p.map((st, i) => i === idx ? { ...st, paid: e.target.checked } : st))}
                        style={{ width: 15, height: 15 }} />
                      Paid
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowBulk(false)}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                <button type="submit"
                  style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  Create {bulkStudents.filter(s => s.selected).length} Invoices
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recurring Modal */}
      {showRecurring && (
        <div style={modalStyle}>
          <div style={{ ...sheetStyle, maxWidth: isMobile ? "100%" : 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Generate Recurring Fees</h3>
              <button onClick={() => setShowRecurring(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: 14, background: "#f8fafc", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
              Will generate invoices for <strong style={{ color: "#10b981" }}>{students.filter(s => s.recurringFee).length} students</strong> with auto-recurring fees enabled. Existing invoices for this month are skipped.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Month</label>
                <select value={recurringMonth} onChange={e => setRecurringMonth(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                  {MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Year</label>
                <input type="number" value={recurringYear} onChange={e => setRecurringYear(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowRecurring(false)}
                style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={handleGenerateRecurring}
                style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                Generate Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div style={modalStyle}>
          <div style={{ ...sheetStyle, maxWidth: isMobile ? "100%" : 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Invoice Detail</h3>
              <button onClick={() => setSelectedInvoice(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { label: "Student", value: selectedInvoice.studentName },
                { label: "Period", value: `${selectedInvoice.month} ${selectedInvoice.year}` },
                { label: "Due Date", value: selectedInvoice.dueDate || "—" },
                { label: "Status", value: selectedInvoice.status },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
            {selectedInvoice.lineItems && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                {selectedInvoice.lineItems.map((li, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "11px 14px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span>{li.customDescription || li.description}</span>
                    <span style={{ fontWeight: 600 }}>Rs. {Number(li.amount).toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#f8fafc", fontWeight: 700, fontSize: 15 }}>
                  <span>Total</span>
                  <span style={{ color: "var(--primary)" }}>Rs. {Number(selectedInvoice.amount).toLocaleString()}</span>
                </div>
              </div>
            )}
            <button onClick={() => setSelectedInvoice(null)}
              style={{ width: "100%", padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
