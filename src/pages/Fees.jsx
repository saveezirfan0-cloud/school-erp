import React, { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import Pagination from "../components/UI/Pagination";
import SearchableSelect from "../components/UI/SearchableSelect";
import { useBulkSelect } from "../hooks/useBulkSelect";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { runBulk, bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import {
  collectInvoicePayment, createInvoiceAndCollect, postUnpostedInvoice, reverseSourcePayments,
  getSourcePaidTotal, needsPosting, pickDefaultAccountId, rememberAccountChoice,
} from "../utils/accounting";
import { parsePositiveAmount, sumMoney, subMoney, round2, toMinor, todayLocal, formatMoney } from "../utils/money";
import { useAccounts } from "../utils/useAccounts";
import { useSubmitLock } from "../utils/useSubmitLock";
import { matchesBranch } from "../utils/branchFilter";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, MessageCircle, CheckCircle, X, Trash2, Download, FileText, RefreshCw, Users, Pencil, AlertTriangle } from "lucide-react";

const DEFAULT_LINE_ITEMS = [{ description: "Tuition Fee", amount: "" }];
const LINE_ITEM_PRESETS = ["Tuition Fee", "Registration Fee", "Exam Fee", "Transport Fee", "Custom"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const emptyForm = () => ({ studentId: "", month: "", year: new Date().getFullYear(), dueDate: "", notes: "", directPayment: false, directAccountId: "" });

// Money received so far / still owed on one invoice, in exact paisa maths.
// Legacy "paid" invoices that carry no paidAmount count as fully collected.
const invoiceCollected = (i) => {
  const paid = Number(i.paidAmount);
  if (Number.isFinite(paid) && toMinor(paid) > 0) return round2(paid);
  return i.status === "paid" ? Math.max(0, subMoney(i.amount || 0, i.concessionAmount || 0)) : 0;
};
const invoiceOutstanding = (i) => {
  if (i.status === "paid") return 0;
  return Math.max(0, subMoney(subMoney(i.amount || 0, invoiceCollected(i)), i.concessionAmount || 0));
};

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
  const { can } = useUser();
  const { activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const { accounts, postable, problem: accountsProblem, status: accountsStatus } = useAccounts();
  const [payModal, setPayModal] = useState(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [payAmount, setPayAmount] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(0);
  const [lookupError, setLookupError] = useState(false);
  const [concession, setConcession] = useState(false);
  const [concessionNote, setConcessionNote] = useState("");
  const [postModal, setPostModal] = useState(null); // unposted invoice being posted to the books
  const [postAccount, setPostAccount] = useState("");
  const { busy: submitting, run: runSubmit } = useSubmitLock();
  const { busy: bulkLocked, run: runBulkAction } = useSubmitLock();
  const [showModal, setShowModal] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [form, setForm] = useState(emptyForm());
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
  const [bulkReceiveAccount, setBulkReceiveAccount] = useState("");
  const [bulkStudents, setBulkStudents] = useState([]);
  const [recurringMonth, setRecurringMonth] = useState(MONTHS[new Date().getMonth()]);
  const [recurringYear, setRecurringYear] = useState(new Date().getFullYear());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkPayModal, setBulkPayModal] = useState(false);
  const [bulkPayAccount, setBulkPayAccount] = useState("");
  const [bulkPayDate, setBulkPayDate] = useState(todayLocal());
  const [bulkPayWhatsApp, setBulkPayWhatsApp] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "invoices"), snap =>
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, "students"), snap => {
      const s = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(s);
      // Keep ticks and typed amounts when a student record changes elsewhere.
      setBulkStudents(prev => s.map(st => {
        const old = prev.find(p => p.id === st.id);
        return old
          ? { ...st, selected: old.selected, amount: old.amount, paid: old.paid }
          : { ...st, selected: false, amount: st.monthlyFee || "", paid: false };
      }));
    });
    return () => { u1(); u2(); };
  }, []);

  // The account to pre-select: a remembered one, or the only one. Never an arbitrary pick.
  const defaultAccountId = () => pickDefaultAccountId(postable);

  useEffect(() => { setPage(1); }, [filterStatus, filterMonth, filterBranch, filterStudent, pageSize, activeBranch]);

  const filtered = invoices.filter(inv => {
    const matchBranch = matchesBranch(inv, activeBranch) && (!filterBranch || inv.branchId === filterBranch);
    const matchStatus = !filterStatus || (filterStatus === "unposted" ? needsPosting(inv) : inv.status === filterStatus);
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

  // multi-select for bulk actions (selection only ever contains
  // currently-visible/filtered invoices)
  const bulk = useBulkSelect(filtered.map(inv => inv.id));
  const pagedIds = paged.map(inv => inv.id);
  const totalAmount = sumMoney(lineItems.map(i => i.amount));
  const totalCollected = sumMoney(filtered.map(invoiceCollected));
  const totalPending = sumMoney(filtered.map(invoiceOutstanding));
  const unpostedCount = filtered.filter(needsPosting).length;

  const addLineItem = () => setLineItems(p => [...p, { description: "", amount: "" }]);
  const removeLineItem = (idx) => setLineItems(p => p.filter((_, i) => i !== idx));
  const updateLineItem = (idx, field, value) => setLineItems(p => p.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  // Validate and normalise line items: every amount a positive money value.
  const cleanLineItems = () => {
    const out = [];
    for (const li of lineItems) {
      const a = parsePositiveAmount(li.amount, `${li.description || "Line item"} amount`);
      if (!a.ok) return { error: a.error };
      out.push({ ...li, amount: a.value });
    }
    if (out.length === 0) return { error: "Add at least one line item" };
    return { items: out, total: sumMoney(out.map(i => i.amount)) };
  };

  const openCreate = () => {
    setForm({ ...emptyForm(), directAccountId: defaultAccountId() });
    setLineItems(DEFAULT_LINE_ITEMS);
    setShowModal(true);
  };

  const handleCreate = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      const student = students.find(s => s.id === form.studentId);
      if (!student) return toast.error("Student not found");
      const lines = cleanLineItems();
      if (lines.error) return toast.error(lines.error);
      try {
        const invoiceData = {
          studentId: student.id, studentName: student.name, parentPhone: student.parentPhone,
          branchId: student.branchId, month: form.month, year: form.year,
          dueDate: form.dueDate, notes: form.notes, lineItems: lines.items, amount: lines.total,
        };
        if (form.directPayment) {
          if (!form.directAccountId) return toast.error("Choose the account that received the money");
          // One shared path: creates the invoice, posts the cash_in, marks it paid.
          await createInvoiceAndCollect({ invoiceData, accounts, accountId: form.directAccountId, date: todayLocal() });
          rememberAccountChoice(form.directAccountId);
          if (student.parentPhone) {
            await sendWhatsAppMessage(student.parentPhone, `✅ Fee payment of Rs. ${lines.total} received for ${student.name} for ${form.month}. Thank you!`);
          }
        } else {
          await addDoc(collection(db, "invoices"), {
            ...invoiceData, status: "pending", paidAmount: 0, paidDate: null, createdAt: serverTimestamp(),
          });
        }
        toast.success(form.directPayment ? "Payment received!" : "Invoice created");
        logActivity(form.directPayment ? "collected" : "created", "Invoices", `Invoice ${student.name} — ${form.month} ${form.year} · Rs. ${formatMoney(lines.total)}${form.directPayment ? " (paid on the spot)" : ""}`);
        setShowModal(false);
        setForm(emptyForm());
        setLineItems(DEFAULT_LINE_ITEMS);
      } catch (err) {
        toast.error(err?.message || "Error creating invoice", { duration: 7000 });
      }
    });
  };

  const handleBulkReceive = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      const selected = bulkStudents.filter(s => s.selected);
      if (selected.length === 0) return toast.error("Select at least one student");
      if (!bulkMonth) return toast.error("Choose the month");
      const paidRows = selected.filter(s => s.paid);
      if (paidRows.length > 0 && !bulkReceiveAccount) return toast.error("Choose the account that received the money for the rows marked Paid");
      // validate everything before writing anything
      for (const s of selected) {
        const a = parsePositiveAmount(s.amount, `Amount for ${s.name}`);
        if (!a.ok) return toast.error(a.error);
      }
      const exists = (s) => invoices.some(i => i.studentId === s.id && i.month === bulkMonth && Number(i.year) === Number(bulkYear));
      let count = 0, skipped = 0;
      const failures = [];
      for (const s of selected) {
        if (exists(s)) { skipped++; continue; }
        try {
          const amount = round2(s.amount);
          const invoiceData = {
            studentId: s.id, studentName: s.name, parentPhone: s.parentPhone,
            branchId: s.branchId, amount, month: bulkMonth, year: bulkYear,
            dueDate: bulkDueDate,
            lineItems: [{ description: "Tuition Fee", amount }],
          };
          if (s.paid) {
            await createInvoiceAndCollect({ invoiceData, accounts, accountId: bulkReceiveAccount, date: todayLocal() });
            if (s.parentPhone) {
              await sendWhatsAppMessage(s.parentPhone, `✅ Fee of Rs. ${amount} received for ${s.name} — ${bulkMonth} ${bulkYear}. Thank you!`);
            }
          } else {
            await addDoc(collection(db, "invoices"), {
              ...invoiceData, status: "pending", paidAmount: 0, paidDate: null, createdAt: serverTimestamp(),
            });
          }
          count++;
        } catch (err) {
          failures.push(`${s.name}: ${err?.message || "failed"}`);
        }
      }
      if (paidRows.length > 0) rememberAccountChoice(bulkReceiveAccount);
      const parts = [`${count} invoice${count === 1 ? "" : "s"} created`];
      if (skipped) parts.push(`${skipped} skipped (already exist for ${bulkMonth} ${bulkYear})`);
      if (failures.length) {
        toast.error(`${parts.join(", ")}. ${failures.length} failed: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`, { duration: 9000 });
      } else {
        toast.success(parts.join(", "));
      }
      if (count > 0) logActivity("created", "Invoices", `${count} invoices — ${bulkMonth} ${bulkYear} (bulk)`);
      if (failures.length === 0) setShowBulk(false);
    });
  };

  const handleGenerateRecurring = () => runSubmit(async () => {
    const recurringStudents = students.filter(s => s.recurringFee);
    if (recurringStudents.length === 0) return toast.error("No students have auto-recurring fees enabled");
    const existing = invoices.filter(i => i.month === recurringMonth && Number(i.year) === Number(recurringYear));
    const existingIds = new Set(existing.map(i => i.studentId));
    let count = 0, noFee = 0;
    try {
      for (const s of recurringStudents) {
        if (existingIds.has(s.id)) continue;
        const fee = parsePositiveAmount(s.monthlyFee);
        if (!fee.ok) { noFee++; continue; } // never create a NaN / zero invoice
        await addDoc(collection(db, "invoices"), {
          studentId: s.id, studentName: s.name, parentPhone: s.parentPhone,
          branchId: s.branchId, status: "pending", amount: fee.value, paidAmount: 0, paidDate: null,
          month: recurringMonth, year: recurringYear,
          lineItems: [{ description: "Tuition Fee", amount: fee.value }],
          createdAt: serverTimestamp()
        });
        count++;
      }
    } catch (err) {
      toast.error(`${count} generated before an error: ${err?.message || "failed"}`, { duration: 8000 });
      return;
    }
    toast.success((count > 0 ? `Generated ${count} invoices` : "All invoices already exist for this month") + (noFee ? ` (${noFee} students skipped: no monthly fee set)` : ""));
    if (count > 0) logActivity("generated", "Invoices", `${count} recurring invoices — ${recurringMonth} ${recurringYear}`);
    setShowRecurring(false);
  });

  const markPaid = async (inv) => {
    setPayModal(inv);
    setPayAccount(defaultAccountId());
    setPayDate(todayLocal());
    setConcession(false); setConcessionNote("");
    setLookupError(false);
    setAlreadyPaid(0);
    setPayAmount("");
    // Look up how much has already been received for this invoice.
    try {
      const paid = await getSourcePaidTotal("invoice", inv.id);
      setAlreadyPaid(paid);
      const remaining = Math.max(0, subMoney(subMoney(inv.amount || 0, paid), inv.concessionAmount || 0));
      setPayAmount(String(remaining));
    } catch {
      // Do NOT assume nothing was paid: that would suggest the full fee again.
      setLookupError(true);
    }
  };

  const confirmPay = () => runSubmit(async () => {
    if (lookupError) return toast.error("Could not read what was already paid. Close and reopen this window.");
    if (!payAccount) return toast.error("Select the account that received payment");
    const current = invoices.find(i => i.id === payModal.id) || payModal;
    try {
      // The shared helper re-reads the ledger, validates, posts and updates.
      const res = await collectInvoicePayment({
        invoice: current, accounts, accountId: payAccount, amount: payAmount === "" ? 0 : payAmount,
        date: payDate, concession, concessionNote,
      });
      rememberAccountChoice(payAccount);
      const student = students.find(s => s.id === current.studentId);
      if (student?.parentPhone) {
        let msg;
        if (res.status === "paid" && res.concessionAdded > 0)
          msg = `✅ Fee settled for ${student.name} (${current.month}). Paid Rs. ${formatMoney(res.cash)}, concession Rs. ${formatMoney(res.concessionAdded)}. Thank you!`;
        else if (res.status === "paid")
          msg = `✅ Fee fully paid for ${student.name} (${current.month}). Thank you!`;
        else
          msg = `✅ Part payment of Rs. ${formatMoney(res.cash)} received for ${student.name} (${current.month}). Balance: Rs. ${formatMoney(res.balance)}.`;
        await sendWhatsAppMessage(student.parentPhone, msg);
      }
      toast.success(res.concessionAdded > 0 ? "Recorded with concession" : res.status === "paid" ? "Payment recorded — fully paid" : "Partial payment recorded");
      logActivity(res.cash > 0 ? "collected" : "concession", "Fees", `Rs. ${formatMoney(res.cash)} from ${current.studentName || "student"} (${current.month || ""}) into ${res.accountName || "no account (concession only)"}${res.concessionAdded > 0 ? ` + concession Rs. ${formatMoney(res.concessionAdded)}${concessionNote ? ` (${concessionNote})` : ""}` : ""}`);
      setPayModal(null); setPayAccount(""); setPayAmount("");
      setConcession(false); setConcessionNote("");
    } catch (e) {
      toast.error(e?.message || "Error recording payment", { duration: 7000 });
    }
  });

  const confirmPostUnposted = () => runSubmit(async () => {
    if (!postAccount) return toast.error("Select the account that holds this money");
    try {
      const res = await postUnpostedInvoice({ invoice: postModal, accounts, accountId: postAccount });
      rememberAccountChoice(postAccount);
      toast.success(`Rs. ${formatMoney(res.cash)} posted to the books`);
      logActivity("posted", "Fees", `Unposted receipt for ${postModal.studentName || "student"} (${postModal.month || ""}) · Rs. ${formatMoney(res.cash)}`);
      setPostModal(null); setPostAccount("");
    } catch (e) {
      toast.error(e?.message || "Could not post to the books", { duration: 7000 });
    }
  });

  const sendReminder = async (inv) => {
    const student = students.find(s => s.id === inv.studentId);
    if (!student?.parentPhone) return toast.error("No phone number on record");
    const res = await sendWhatsAppMessage(student.parentPhone, `📢 Fee of Rs. ${inv.amount} for ${student.name} is due for ${inv.month}. Due: ${inv.dueDate}.`);
    if (res?.ok) toast.success("Reminder sent");
    else if (res?.skipped) toast.error("WhatsApp isn't configured");
    else toast.error("Reminder failed: " + (res?.error || "unknown") + (String(res?.error || "").includes("24") || String(res?.error || "").toLowerCase().includes("template") ? " — needs an approved template (see WhatsApp guide)" : ""), { duration: 7000 });
  };

  const handleDelete = async (inv) => {
    if (!window.confirm("Delete this invoice? Any recorded payments for it will be reversed. You can restore it from Trash (the payments are re-posted on restore).")) return;
    try {
      // Reverse any money posted for this invoice so balances don't drift.
      await reverseSourcePayments("invoice", inv.id);
      await deleteDoc(doc(db, "invoices", inv.id));
      toast.success("Invoice deleted");
      logActivity("deleted", "Invoices", `Invoice ${inv.studentName} — ${inv.month} ${inv.year} · Rs. ${formatMoney(inv.amount || 0)}`);
    } catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const selectedInvoices = () => invoices.filter(i => bulk.selected.has(i.id));

  const handleBulkDelete = async () => {
    const items = selectedInvoices();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} invoice${items.length === 1 ? "" : "s"}? Any recorded payments for them will be reversed. You can restore them from Trash.`)) return;
    setBulkBusy(true);
    const t = toast.loading(`Deleting ${items.length} invoices…`);
    try {
      // Reverse each invoice's ledger money first; only invoices whose
      // reversal succeeded get deleted, so balances can never drift.
      const { ok, failed } = await runBulk(items, (inv) => reverseSourcePayments("invoice", inv.id), {
        onProgress: (d, tot) => toast.loading(`Reversing payments ${d}/${tot}…`, { id: t }),
      });
      if (ok.length) await deleteDocs("invoices", ok.map(i => i.id));
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "moved to Trash", "invoices"), { id: t });
      if (ok.length) logActivity("deleted", "Invoices", `${ok.length} invoices (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed", { id: t });
    } finally { setBulkBusy(false); }
  };

  // NOTE: "status" is deliberately not editable in bulk any more. A status
  // of paid/partial must come from a real payment (Mark Paid), otherwise the
  // invoice says paid while no money is in the books (ACC-01).
  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const n = bulk.count;
      await updateDocs("invoices", [...bulk.selected], { ...changes, updatedAt: serverTimestamp() });
      toast.success(`${n} invoice${n === 1 ? "" : "s"} updated`);
      logActivity("updated", "Invoices", `${n} invoices (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  const handleBulkMarkPaid = () => runBulkAction(async () => {
    if (!bulkPayAccount) return toast.error("Select the account that received payment");
    const targets = selectedInvoices().filter(i => i.status !== "paid" && !needsPosting(i));
    if (targets.length === 0) { setBulkPayModal(false); return toast("Nothing to collect: selected invoices are already paid or unposted"); }
    setBulkBusy(true);
    const t = toast.loading(`Recording payments 0/${targets.length}…`);
    try {
      const { ok, failed } = await runBulk(targets, async (inv) => {
        // Same shared helper as the single "Mark Paid": it reads the ledger,
        // collects the remainder into the chosen account and stamps the invoice.
        const res = await collectInvoicePayment({
          invoice: inv, accounts, accountId: bulkPayAccount, collectRemaining: true, date: bulkPayDate,
        });
        if (bulkPayWhatsApp && inv.parentPhone && res.cash > 0) {
          await sendWhatsAppMessage(inv.parentPhone, `✅ Fee of Rs. ${formatMoney(res.cash)} received for ${inv.studentName} (${inv.month || ""}). Thank you!`);
        }
      }, { chunkSize: 3, onProgress: (d, tot) => toast.loading(`Recording payments ${d}/${tot}…`, { id: t }) });
      rememberAccountChoice(bulkPayAccount);
      const firstErr = failed[0]?.error?.message;
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "marked paid", "invoices") + (firstErr ? ` (${firstErr})` : ""), { id: t, duration: failed.length ? 8000 : 4000 });
      if (ok.length) logActivity("collected", "Fees", `${ok.length} invoices marked paid into ${accounts.find(a => a.id === bulkPayAccount)?.name || "account"} (bulk)`);
      setBulkPayModal(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk payment failed", { id: t });
    } finally { setBulkBusy(false); }
  });

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
              {can("canExport") && <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>}
              {can("canExport") && <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>}
            </>
          )}
          <button onClick={() => setShowRecurring(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><RefreshCw size={14} />{!isMobile && " Recurring"}</button>
          <button onClick={() => setShowBulk(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#2a8c7a", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Users size={14} />{!isMobile && " Bulk"}</button>
          <button onClick={openCreate}
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

      {unpostedCount > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 10, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>{unpostedCount} paid invoice{unpostedCount === 1 ? " is" : "s are"} not in the books (saved while no Bank &amp; Cash account was available). Use <strong>Post</strong> on each one.</span>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={filterStudent} onChange={e => setFilterStudent(e.target.value)} placeholder="Search student..."
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, flex: 1, minWidth: 120 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}>
          <option value="">All</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
          <option value="unposted">Unposted (not in books)</option>
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
            <div key={inv.id} style={{ background: "white", borderRadius: 12, padding: 16, border: bulk.isSelected(inv.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3 }}>
                    <RowCheckbox checked={bulk.isSelected(inv.id)} onChange={() => bulk.toggle(inv.id)} label={`Select invoice for ${inv.studentName}`} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{inv.studentName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{inv.month} {inv.year}</div>
                  </div>
                </div>
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: inv.status === "paid" ? "#ecfdf5" : inv.status === "partial" ? "#eff6ff" : "#fffbeb", color: inv.status === "paid" ? "#10b981" : inv.status === "partial" ? "#2563eb" : "#f59e0b" }}>
                  {inv.status}{inv.status === "partial" && inv.paidAmount ? ` (Rs. ${Number(inv.paidAmount).toLocaleString()})` : ""}
                </span>
                {needsPosting(inv) && <span title={inv.unpostedReason || "Not posted to the books"} style={{ marginLeft: 6, padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#b45309" }}>unposted</span>}
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
                {needsPosting(inv) && (
                  <button onClick={() => { setPostModal(inv); setPostAccount(defaultAccountId()); }}
                    style={{ flex: 1, border: "none", background: "#fef3c7", color: "#b45309", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    Post
                  </button>
                )}
                {inv.status !== "paid" && !needsPosting(inv) && (
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
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                  </th>
                  {["Student", "Month", "Line Items", "Total", "Due Date", "Status", "Actions"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(inv => (
                  <tr key={inv.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(inv.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "11px 6px 11px 14px" }}>
                      <RowCheckbox checked={bulk.isSelected(inv.id)} onChange={() => bulk.toggle(inv.id)} label={`Select invoice for ${inv.studentName}`} />
                    </td>
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
                      {needsPosting(inv) && <span title={inv.unpostedReason || "Not posted to the books"} style={{ marginLeft: 6, padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#b45309" }}>unposted</span>}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        {needsPosting(inv) && (
                          <button onClick={() => { setPostModal(inv); setPostAccount(defaultAccountId()); }} style={{ border: "none", background: "#fef3c7", color: "#b45309", padding: "5px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Post</button>
                        )}
                        {inv.status !== "paid" && !needsPosting(inv) && (
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

      {/* Bulk actions bar (appears when invoices are selected) */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="invoices"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map(i => i.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          { label: "Mark Paid", icon: CheckCircle, variant: "success", onClick: () => { setBulkPayAccount(defaultAccountId()); setBulkPayDate(todayLocal()); setBulkPayWhatsApp(false); setBulkPayModal(true); } },
          { label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete },
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} invoice${bulk.count === 1 ? "" : "s"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "dueDate", label: "Due Date", type: "date" },
            { key: "month", label: "Month", type: "select", options: MONTHS.map(m => ({ value: m, label: m })) },
            { key: "year", label: "Year", type: "number", placeholder: String(new Date().getFullYear()) },
          ]}
        />
      )}

      {/* Bulk mark-paid modal */}
      {bulkPayModal && (() => {
        const targets = selectedInvoices().filter(i => i.status !== "paid" && !needsPosting(i));
        const approxOutstanding = sumMoney(targets.map(invoiceOutstanding));
        const busyNow = bulkBusy || bulkLocked;
        return (
          <div onClick={(e) => { if (e.target === e.currentTarget && !bulkBusy) setBulkPayModal(false); }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
            <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 440 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Receive Payment — {targets.length} invoice{targets.length === 1 ? "" : "s"}</h3>
                <button onClick={() => setBulkPayModal(false)} disabled={bulkBusy} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
                Each selected unpaid invoice will have its remaining balance collected into the account below and be marked <strong>paid</strong>.
                {bulk.count > targets.length && <> Already-paid invoices in the selection are skipped.</>}
                <div style={{ marginTop: 8, fontSize: 14, color: "#1e293b" }}>Outstanding (approx.): <strong>Rs. {formatMoney(approxOutstanding)}</strong></div>
              </div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Received into account *</label>
              {postable.length === 0 ? (
                <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 12 }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
              ) : (
                <select value={bulkPayAccount} onChange={e => setBulkPayAccount(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12, background: "white" }}>
                  <option value="">Select account</option>
                  {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Payment date</label>
              <input type="date" value={bulkPayDate} onChange={e => setBulkPayDate(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, marginBottom: 18, cursor: "pointer" }}>
                <input type="checkbox" checked={bulkPayWhatsApp} onChange={e => setBulkPayWhatsApp(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
                Send WhatsApp confirmation to parents
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setBulkPayModal(false)} disabled={bulkBusy}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
                <button onClick={handleBulkMarkPaid} disabled={busyNow || targets.length === 0 || postable.length === 0}
                  style={{ flex: 2, padding: "11px", background: "#10b981", color: "white", border: "none", borderRadius: 8, cursor: busyNow ? "wait" : "pointer", fontWeight: 600, fontSize: 14, opacity: busyNow || postable.length === 0 ? 0.7 : 1 }}>
                  {busyNow ? "Recording…" : `Collect ${targets.length} Payment${targets.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                <div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Already paid</div><div style={{ fontWeight: 700, color: "#10b981" }}>Rs. {formatMoney(alreadyPaid)}</div></div>
                <div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Balance</div><div style={{ fontWeight: 700, color: "var(--primary)" }}>Rs. {formatMoney(Math.max(0, subMoney(subMoney(payModal.amount || 0, alreadyPaid), payModal.concessionAmount || 0)))}</div></div>
              </div>
            </div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Amount to pay now *</label>
            {lookupError && (
              <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 10 }}>Could not read what has already been paid for this invoice, so payment is blocked. Close this window and try again.</div>
            )}
            <input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

            {/* Concession: forgive the remaining balance for non-profit tracking */}
            {(() => {
              const total = Number(payModal.amount || 0);
              const remainingAfter = Math.max(0, subMoney(subMoney(subMoney(total, alreadyPaid), payModal.concessionAmount || 0), Number(payAmount) || 0));
              return remainingAfter > 0 ? (
                <div style={{ background: concession ? "#fffbeb" : "#f8fafc", border: "1px solid " + (concession ? "#fde68a" : "var(--border)"), borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={concession} onChange={(e) => setConcession(e.target.checked)} style={{ width: 18, height: 18 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Mark remaining Rs. {formatMoney(remainingAfter)} as concession</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Closes the invoice; the unpaid amount is tracked as concession (waived).</div>
                    </div>
                  </label>
                  {concession && (
                    <input value={concessionNote} onChange={(e) => setConcessionNote(e.target.value)} placeholder="Reason (optional) — e.g. financial hardship"
                      style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, marginTop: 8, boxSizing: "border-box" }} />
                  )}
                </div>
              ) : null;
            })()}

            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Received into account *</label>
            {postable.length === 0 ? (
              <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 12 }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
            ) : (
              <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12 }}>
                <option value="">Select account</option>
                {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Payment date</label>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 18, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPayModal(null)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white" }}>Cancel</button>
              <button onClick={confirmPay} disabled={postable.length === 0 || submitting || lookupError}
                style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: (postable.length === 0 || submitting || lookupError) ? "not-allowed" : "pointer", fontWeight: 600, opacity: (postable.length === 0 || submitting || lookupError) ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {submitting && <span style={{ width: 15, height: 15, border: "2px solid rgba(255,255,255,0.5)", borderTop: "2px solid white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
                {submitting ? "Saving..." : "Confirm Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post an unposted receipt to the books */}
      {postModal && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !submitting) setPostModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Post receipt to the books</h3>
              <button onClick={() => setPostModal(null)} disabled={submitting} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "#92400e" }}>
              <strong>{postModal.studentName}</strong> ({postModal.month} {postModal.year}) was marked paid, Rs. {formatMoney(postModal.paidAmount || postModal.amount || 0)}, but never posted to a Bank &amp; Cash account. Choose the account that actually holds this money.
            </div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Account *</label>
            {postable.length === 0 ? (
              <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 12 }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
            ) : (
              <select value={postAccount} onChange={(e) => setPostAccount(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 18 }}>
                <option value="">Select account</option>
                {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPostModal(null)} disabled={submitting} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white" }}>Cancel</button>
              <button onClick={confirmPostUnposted} disabled={submitting || postable.length === 0}
                style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: (submitting || postable.length === 0) ? "not-allowed" : "pointer", fontWeight: 600, opacity: (submitting || postable.length === 0) ? 0.6 : 1 }}>
                {submitting ? "Posting..." : "Post to books"}
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
                  <SearchableSelect
                    value={form.studentId}
                    onChange={(val) => {
                      const s = students.find(st => st.id === val);
                      setForm(p => ({ ...p, studentId: val }));
                      if (s?.monthlyFee) setLineItems([{ description: "Tuition Fee", amount: s.monthlyFee }]);
                    }}
                    options={students.map(s => ({ value: s.id, label: `${s.name} (${s.studentId})`, sublabel: s.grade || "" }))}
                    placeholder="Search student by name or ID..."
                  />
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
              {form.directPayment && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Received into account *</label>
                  {postable.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#ef4444" }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
                  ) : (
                    <select value={form.directAccountId} onChange={e => setForm(p => ({ ...p, directAccountId: e.target.value }))} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Select account</option>
                      {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
              )}

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
                      <input type="number" min="0.01" step="0.01" value={item.amount} onChange={e => updateLineItem(idx, "amount", e.target.value)} placeholder="0"
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, width: 100 }} />
                      {lineItems.length > 1 && (
                        <button type="button" onClick={() => removeLineItem(idx)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px", background: "#f8fafc" }}>
                    <strong style={{ fontSize: 15 }}>Total: Rs. {formatMoney(totalAmount)}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                <button type="submit" disabled={submitting || (form.directPayment && postable.length === 0)}
                  style={{ flex: 2, padding: "11px", background: form.directPayment ? "#10b981" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: (submitting || (form.directPayment && postable.length === 0)) ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: (submitting || (form.directPayment && postable.length === 0)) ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {submitting && <span style={{ width: 15, height: 15, border: "2px solid rgba(255,255,255,0.5)", borderTop: "2px solid white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
                  {submitting ? "Saving..." : (form.directPayment ? "Receive Payment" : "Create Invoice")}
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

              {bulkStudents.some(s => s.selected && s.paid) && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Rows ticked Paid were received into *</label>
                  {postable.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#ef4444" }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
                  ) : (
                    <select value={bulkReceiveAccount} onChange={e => setBulkReceiveAccount(e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Select account</option>
                      {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
              )}

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
                    <input type="number" min="0.01" step="0.01" value={s.amount}
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
                <button type="submit" disabled={submitting}
                  style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontWeight: 600, fontSize: 14 }}>
                  {submitting ? "Saving..." : `Create ${bulkStudents.filter(s => s.selected).length} Invoices`}
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
              <button onClick={handleGenerateRecurring} disabled={submitting}
                style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontWeight: 600, fontSize: 14 }}>
                {submitting ? "Generating..." : "Generate Now"}
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
                { label: "Status", value: selectedInvoice.status + (needsPosting(selectedInvoice) ? " (unposted)" : "") },
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
