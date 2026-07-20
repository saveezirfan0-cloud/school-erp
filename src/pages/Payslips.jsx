import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { recordPayment, bankCashAccounts, reverseSourcePayments } from "../utils/accounting";
import { useBranch } from "../context/BranchContext";
import { matchesBranch } from "../utils/branchFilter";
import { useBulkSelect } from "../hooks/useBulkSelect";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { runBulk, bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Printer, X, RefreshCw, Download, FileText, Trash2, Pencil, Banknote } from "lucide-react";
import SearchableSelect from "../components/UI/SearchableSelect";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const empty = { employeeId: "", month: "", year: new Date().getFullYear(), basicSalary: "", allowances: "", deductions: "", notes: "" };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Payslips() {
  const { activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payModal, setPayModal] = useState(null); // payslip being paid
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [showModal, setShowModal] = useState(false);
  const [showPrint, setShowPrint] = useState(null);
  const [showRecurring, setShowRecurring] = useState(false);
  const [form, setForm] = useState(empty);
  const [filterMonth, setFilterMonth] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [recurringMonth, setRecurringMonth] = useState(MONTHS[new Date().getMonth()]);
  const [recurringYear, setRecurringYear] = useState(new Date().getFullYear());
  const printRef = useRef();

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "payslips"), snap =>
      setPayslips(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, "employees"), snap =>
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u3 = onSnapshot(collection(db, "accounts"), snap =>
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); u3(); };
  }, []);

  const payAccounts = bankCashAccounts(accounts);

  // Mark a payslip paid: stamp status + create the cash_out payment
  // against the chosen bank/cash account so balances stay correct.
  const confirmPay = async () => {
    if (!payAccount) return toast.error("Select the account paid from");
    try {
      await recordPayment({
        type: "cash_out",
        account: payAccount,
        amount: payModal.netPay,
        category: "Salary",
        description: `Salary — ${payModal.employeeName} (${payModal.month} ${payModal.year})`,
        reference: payModal.id,
        branchId: payModal.branchId || "",
        date: payDate,
        source: "payslip",
        sourceId: payModal.id,
      });
      await updateDoc(doc(db, "payslips", payModal.id), {
        status: "paid",
        paidDate: payDate,
        paidAccount: payAccount,
      });
      toast.success("Salary paid and recorded");
      logActivity("paid", "Payslips", `Salary ${payModal.employeeName} (${payModal.month} ${payModal.year}) · Rs. ${Number(payModal.netPay || 0).toLocaleString()} from ${payAccount}`);
      setPayModal(null);
      setPayAccount("");
    } catch (e) {
      toast.error(e?.message || "Error recording payment");
    }
  };

  const filtered = payslips.filter(p => {
    const matchMonth = !filterMonth || p.month === filterMonth;
    const matchEmp = !filterEmployee || p.employeeName?.toLowerCase().includes(filterEmployee.toLowerCase());
    return matchesBranch(p, activeBranch) && matchMonth && matchEmp;
  });

  // multi-select for bulk actions (this page shows all filtered rows,
  // no pagination, so the header checkbox covers the whole list)
  const bulk = useBulkSelect(filtered.map(p => p.id));
  const visibleIds = filtered.map(p => p.id);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkPayAccount, setBulkPayAccount] = useState("");
  const [bulkPayDate, setBulkPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkBusy, setBulkBusy] = useState(false);

  const selectedPayslips = () => payslips.filter(p => bulk.selected.has(p.id));

  const handleBulkDelete = async () => {
    const items = selectedPayslips();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} payslip${items.length === 1 ? "" : "s"}? Any recorded salary payments will be reversed. You can restore them from Trash.`)) return;
    setBulkBusy(true);
    const t = toast.loading(`Deleting ${items.length} payslips…`);
    try {
      const { ok, failed } = await runBulk(items, (p) => reverseSourcePayments("payslip", p.id), {
        onProgress: (d, tot) => toast.loading(`Reversing payments ${d}/${tot}…`, { id: t }),
      });
      if (ok.length) await deleteDocs("payslips", ok.map(p => p.id));
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "moved to Trash", "payslips"), { id: t });
      if (ok.length) logActivity("deleted", "Payslips", `${ok.length} payslips (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed", { id: t });
    } finally { setBulkBusy(false); }
  };

  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const n = bulk.count;
      await updateDocs("payslips", [...bulk.selected], { ...changes, updatedAt: serverTimestamp() });
      toast.success(`${n} payslip${n === 1 ? "" : "s"} updated`);
      logActivity("updated", "Payslips", `${n} payslips (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  const handleBulkPay = async () => {
    if (!bulkPayAccount) return toast.error("Select the account paid from");
    const targets = selectedPayslips().filter(p => p.status !== "paid");
    if (targets.length === 0) { setBulkPayOpen(false); return toast("All selected payslips are already paid"); }
    setBulkBusy(true);
    const t = toast.loading(`Paying salaries 0/${targets.length}…`);
    try {
      const { ok, failed } = await runBulk(targets, async (p) => {
        await recordPayment({
          type: "cash_out",
          account: bulkPayAccount,
          amount: p.netPay,
          category: "Salary",
          description: `Salary — ${p.employeeName} (${p.month} ${p.year})`,
          reference: p.id,
          branchId: p.branchId || "",
          date: bulkPayDate,
          source: "payslip",
          sourceId: p.id,
        });
        await updateDoc(doc(db, "payslips", p.id), {
          status: "paid",
          paidDate: bulkPayDate,
          paidAccount: bulkPayAccount,
        });
      }, { chunkSize: 3, onProgress: (d, tot) => toast.loading(`Paying salaries ${d}/${tot}…`, { id: t }) });
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "paid", "salaries"), { id: t });
      if (ok.length) logActivity("paid", "Payslips", `${ok.length} salaries from ${bulkPayAccount} (bulk)`);
      setBulkPayOpen(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk payment failed", { id: t });
    } finally { setBulkBusy(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === form.employeeId);
    if (!emp) return toast.error("Please select an employee");
    const netPay = Number(form.basicSalary) + Number(form.allowances || 0) - Number(form.deductions || 0);
    await addDoc(collection(db, "payslips"), {
      ...form,
      employeeName: emp?.name,
      role: emp?.role,
      branchId: emp?.branchId || "",
      netPay,
      createdAt: serverTimestamp()
    });
    toast.success("Payslip created");
    logActivity("created", "Payslips", `Payslip ${emp?.name} — ${form.month} ${form.year} · Rs. ${Number(netPay).toLocaleString()}`);
    setShowModal(false);
    setForm(empty);
  };

  const handleGenerateRecurring = async () => {
    const recurringEmps = employees.filter(e => e.recurringPayslip);
    if (recurringEmps.length === 0) return toast.error("No employees have recurring payslips enabled");
    const existing = payslips.filter(p => p.month === recurringMonth && Number(p.year) === Number(recurringYear));
    const existingIds = new Set(existing.map(p => p.employeeId));
    let count = 0;
    for (const emp of recurringEmps) {
      if (existingIds.has(emp.id)) continue;
      await addDoc(collection(db, "payslips"), {
        employeeId: emp.id, employeeName: emp.name, role: emp.role,
        branchId: emp.branchId || "",
        month: recurringMonth, year: recurringYear,
        basicSalary: emp.salary, allowances: 0, deductions: 0,
        netPay: Number(emp.salary || 0),
        createdAt: serverTimestamp()
      });
      count++;
    }
    toast.success(count > 0 ? `Generated ${count} payslips for ${recurringMonth} ${recurringYear}` : "All payslips already exist for this month");
    if (count > 0) logActivity("generated", "Payslips", `${count} recurring payslips — ${recurringMonth} ${recurringYear}`);
    setShowRecurring(false);
  };

  const handleDelete = async (p) => {
    if (!window.confirm("Delete this payslip? Any recorded salary payment will be reversed. You can restore it from Trash.")) return;
    try {
      await reverseSourcePayments("payslip", p.id);
      await deleteDoc(doc(db, "payslips", p.id));
      toast.success("Payslip moved to Trash");
      logActivity("deleted", "Payslips", `Payslip ${p.employeeName} — ${p.month} ${p.year} · Rs. ${Number(p.netPay || 0).toLocaleString()}`);
    } catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handlePrint = () => {
    const content = printRef.current.innerHTML;
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Payslip</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#1e293b}table{width:100%;border-collapse:collapse}td{padding:10px 16px;border:1px solid #e2e8f0;font-size:14px}.label{background:#f8fafc;font-weight:600;width:40%}.total{background:#7a2535;color:white;font-weight:700;font-size:16px}.footer{margin-top:40px;display:flex;justify-content:space-between;font-size:13px;color:#64748b}</style>
    </head><body>${content}</body></html>`);
    w.document.close();
    w.print();
  };

  const handleCSV = () => exportToCSV("payslips",
    ["Employee", "Role", "Month", "Year", "Basic", "Allowances", "Deductions", "Net Pay"],
    filtered.map(p => [p.employeeName, p.role, p.month, p.year, p.basicSalary, p.allowances || 0, p.deductions || 0, p.netPay])
  );

  const handlePDF = () => exportToPDF("Payslips Report",
    ["Employee", "Role", "Month", "Basic", "Net Pay"],
    filtered.map(p => [p.employeeName, p.role, `${p.month} ${p.year}`, `Rs. ${Number(p.basicSalary).toLocaleString()}`, `Rs. ${Number(p.netPay).toLocaleString()}`])
  );

  const modalStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center", zIndex: 1000,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Payslips</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <>
            <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
            <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          </>}
          <button onClick={() => setShowRecurring(true)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
            <RefreshCw size={14} /> {!isMobile && "Recurring"}
          </button>
          <button onClick={() => setShowModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Generate Payslip
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} placeholder="Search employee..."
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, minWidth: 160 }} />
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Months</option>
          {MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        {(filterMonth || filterEmployee) && (
          <button onClick={() => { setFilterMonth(""); setFilterEmployee(""); }}
            style={{ padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>Clear</button>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(p => (
            <div key={p.id} style={{ background: "white", borderRadius: 12, padding: 16, border: bulk.isSelected(p.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3 }}>
                    <RowCheckbox checked={bulk.isSelected(p.id)} onChange={() => bulk.toggle(p.id)} label={`Select payslip for ${p.employeeName}`} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{p.employeeName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{p.role} · {p.month} {p.year}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setShowPrint(p)}
                    style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "7px 10px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <Printer size={13} /> Print
                  </button>
                  <button onClick={() => handleDelete(p)} title="Delete"
                    style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Basic</div><div>Rs. {Number(p.basicSalary).toLocaleString()}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Allowances</div><div style={{ color: "#10b981" }}>+Rs. {Number(p.allowances || 0).toLocaleString()}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Deductions</div><div style={{ color: "#ef4444" }}>-Rs. {Number(p.deductions || 0).toLocaleString()}</div></div>
              </div>
              <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--primary-light)", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>Net Pay</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--primary)" }}>Rs. {Number(p.netPay).toLocaleString()}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12 }}>No payslips found</div>}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(visibleIds)} indeterminate={bulk.pageIndeterminate(visibleIds)} onChange={() => bulk.togglePage(visibleIds)} />
                  </th>
                  {["Employee", "Role", "Month", "Basic", "Allowances", "Deductions", "Net Pay", "Actions"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(p.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "11px 6px 11px 14px" }}>
                      <RowCheckbox checked={bulk.isSelected(p.id)} onChange={() => bulk.toggle(p.id)} label={`Select payslip for ${p.employeeName}`} />
                    </td>
                    <td style={{ padding: "11px 14px", fontWeight: 500 }}>{p.employeeName}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--text-muted)" }}>{p.role}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{p.month} {p.year}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>Rs. {Number(p.basicSalary).toLocaleString()}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "#10b981" }}>+Rs. {Number(p.allowances || 0).toLocaleString()}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "#ef4444" }}>-Rs. {Number(p.deductions || 0).toLocaleString()}</td>
                    <td style={{ padding: "11px 14px", fontWeight: 700, color: "var(--primary)" }}>Rs. {Number(p.netPay).toLocaleString()}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: p.status === "paid" ? "#ecfdf5" : "#fffbeb", color: p.status === "paid" ? "#10b981" : "#f59e0b" }}>
                          {p.status === "paid" ? "paid" : "pending"}
                        </span>
                        {p.status !== "paid" && (
                          <button onClick={() => { setPayModal(p); setPayAccount(payAccounts[0]?.name || ""); }} title="Mark paid"
                            style={{ border: "none", background: "#ecfdf5", color: "#10b981", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            Pay
                          </button>
                        )}
                        <button onClick={() => setShowPrint(p)}
                          style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                          <Printer size={13} /> Print
                        </button>
                        <button onClick={() => handleDelete(p)} title="Delete payslip"
                          style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No payslips found</div>}
        </div>
      )}

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="payslips"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map(p => p.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          { label: "Pay Salaries", icon: Banknote, variant: "success", onClick: () => { setBulkPayAccount(payAccounts[0]?.name || ""); setBulkPayDate(new Date().toISOString().slice(0, 10)); setBulkPayOpen(true); } },
          { label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete },
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} payslip${bulk.count === 1 ? "" : "s"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "month", label: "Month", type: "select", options: MONTHS.map(m => ({ value: m, label: m })) },
            { key: "year", label: "Year", type: "number", placeholder: String(new Date().getFullYear()) },
          ]}
        />
      )}

      {/* Bulk pay-salaries modal */}
      {bulkPayOpen && (() => {
        const targets = selectedPayslips().filter(p => p.status !== "paid");
        const totalNet = targets.reduce((s, p) => s + Number(p.netPay || 0), 0);
        return (
          <div onClick={(e) => { if (e.target === e.currentTarget && !bulkBusy) setBulkPayOpen(false); }} style={modalStyle}>
            <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 440 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Pay {targets.length} Salar{targets.length === 1 ? "y" : "ies"}</h3>
                <button onClick={() => setBulkPayOpen(false)} disabled={bulkBusy} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
                Each selected pending payslip will be paid in full from the account below and marked <strong>paid</strong>.
                {bulk.count > targets.length && <> Already-paid payslips in the selection are skipped.</>}
                <div style={{ marginTop: 8, fontSize: 14, color: "#1e293b" }}>Total net pay: <strong>Rs. {totalNet.toLocaleString()}</strong></div>
              </div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Paid from account *</label>
              <select value={bulkPayAccount} onChange={e => setBulkPayAccount(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 12, background: "white" }}>
                <option value="">Select account</option>
                {payAccounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Payment date</label>
              <input type="date" value={bulkPayDate} onChange={e => setBulkPayDate(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, marginBottom: 18, boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setBulkPayOpen(false)} disabled={bulkBusy}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
                <button onClick={handleBulkPay} disabled={bulkBusy || targets.length === 0}
                  style={{ flex: 2, padding: "11px", background: "#10b981", color: "white", border: "none", borderRadius: 8, cursor: bulkBusy ? "wait" : "pointer", fontWeight: 600, fontSize: 14, opacity: bulkBusy ? 0.7 : 1 }}>
                  {bulkBusy ? "Paying…" : `Pay Rs. ${totalNet.toLocaleString()}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recurring Modal */}
      {showRecurring && (
        <div style={modalStyle}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Generate Recurring Payslips</h3>
              <button onClick={() => setShowRecurring(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: 14, background: "#f8fafc", borderRadius: 10, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
              Will generate payslips for <strong style={{ color: "#10b981" }}>{employees.filter(e => e.recurringPayslip).length} employees</strong> with recurring payslip enabled. Existing payslips for the selected month are skipped.
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
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowRecurring(false)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleGenerateRecurring} style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Generate Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Modal */}
      {showModal && (
        <div style={modalStyle}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Generate Payslip</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Employee</label>
                  <SearchableSelect
                    value={form.employeeId}
                    onChange={(val) => {
                      const emp = employees.find(em => em.id === val);
                      setForm(p => ({ ...p, employeeId: val, basicSalary: emp?.salary || "" }));
                    }}
                    options={employees.map(emp => ({ value: emp.id, label: emp.name, sublabel: emp.role || "" }))}
                    placeholder="Search employee..."
                  />
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
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Year</label>
                  <input type="number" value={form.year} onChange={e => setForm(p => ({ ...p, year: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Basic Salary (Rs.)</label>
                  <input type="number" value={form.basicSalary} onChange={e => setForm(p => ({ ...p, basicSalary: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Allowances (Rs.)</label>
                  <input type="number" value={form.allowances} onChange={e => setForm(p => ({ ...p, allowances: e.target.value }))} placeholder="0"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Deductions (Rs.)</label>
                  <input type="number" value={form.deductions} onChange={e => setForm(p => ({ ...p, deductions: e.target.value }))} placeholder="0"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Net Pay</label>
                  <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, fontWeight: 700, color: "var(--primary)", background: "#f8fafc" }}>
                    Rs. {(Number(form.basicSalary || 0) + Number(form.allowances || 0) - Number(form.deductions || 0)).toLocaleString()}
                  </div>
                </div>
                <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Notes</label>
                  <input value={form.notes || ""} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay salary modal */}
      {payModal && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setPayModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Pay Salary</h3>
              <button onClick={() => setPayModal(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontWeight: 600 }}>{payModal.employeeName}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{payModal.month} {payModal.year}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)", marginTop: 6 }}>Rs. {Number(payModal.netPay).toLocaleString()}</div>
            </div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Pay from account *</label>
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

      {/* Print Preview */}
      {showPrint && (
        <div style={modalStyle}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Payslip Preview</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handlePrint} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  <Printer size={14} /> Print
                </button>
                <button onClick={() => setShowPrint(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
              </div>
            </div>
            <div ref={printRef}>
              <div style={{ textAlign: "center", borderBottom: "2px solid #7a2535", paddingBottom: 16, marginBottom: 24 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#7a2535" }}>Zohra Majeed Islamic Institute</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>PAYSLIP — {showPrint.month} {showPrint.year}</div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["Employee Name", showPrint.employeeName],
                    ["Role / Position", showPrint.role],
                    ["Pay Period", `${showPrint.month} ${showPrint.year}`],
                    ["Basic Salary", `Rs. ${Number(showPrint.basicSalary).toLocaleString()}`],
                    ["Allowances", `Rs. ${Number(showPrint.allowances || 0).toLocaleString()}`],
                    ["Deductions", `Rs. ${Number(showPrint.deductions || 0).toLocaleString()}`],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ padding: "10px 16px", border: "1px solid #e2e8f0", background: "#f8fafc", fontWeight: 600, fontSize: 14, width: "40%" }}>{label}</td>
                      <td style={{ padding: "10px 16px", border: "1px solid #e2e8f0", fontSize: 14 }}>{value}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "12px 16px", background: "#7a2535", color: "white", fontWeight: 700, fontSize: 15 }}>NET PAY</td>
                    <td style={{ padding: "12px 16px", background: "#7a2535", color: "white", fontWeight: 700, fontSize: 15 }}>Rs. {Number(showPrint.netPay).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              {showPrint.notes && (
                <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "#64748b" }}>
                  Notes: {showPrint.notes}
                </div>
              )}
              <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between", fontSize: 13, color: "#94a3b8" }}>
                <div>Employee Signature: _______________</div>
                <div>Authorized By: _______________</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}