import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase";
import { collection, addDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Printer, X, RefreshCw, Download, FileText } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const empty = { employeeId: "", month: "", year: new Date().getFullYear(), basicSalary: "", allowances: "", deductions: "", notes: "" };

export default function Payslips() {
  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
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
    const u1 = onSnapshot(collection(db, "payslips"), snap => setPayslips(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, "employees"), snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, []);

  const filtered = payslips.filter(p => {
    const matchMonth = !filterMonth || p.month === filterMonth;
    const matchEmp = !filterEmployee || p.employeeName?.toLowerCase().includes(filterEmployee.toLowerCase());
    return matchMonth && matchEmp;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === form.employeeId);
    const netPay = Number(form.basicSalary) + Number(form.allowances || 0) - Number(form.deductions || 0);
    await addDoc(collection(db, "payslips"), { ...form, employeeName: emp?.name, role: emp?.role, netPay, createdAt: serverTimestamp() });
    toast.success("Payslip created");
    setShowModal(false); setForm(empty);
  };

  const handleGenerateRecurring = async () => {
    const recurringEmps = employees.filter(e => e.recurringPayslip);
    if (recurringEmps.length === 0) return toast.error("No employees have recurring payslips enabled. Edit employees to enable.");
    const existing = payslips.filter(p => p.month === recurringMonth && Number(p.year) === Number(recurringYear));
    const existingIds = new Set(existing.map(p => p.employeeId));
    let count = 0;
    for (const emp of recurringEmps) {
      if (existingIds.has(emp.id)) continue;
      const netPay = Number(emp.salary || 0);
      await addDoc(collection(db, "payslips"), {
        employeeId: emp.id, employeeName: emp.name, role: emp.role,
        month: recurringMonth, year: recurringYear,
        basicSalary: emp.salary, allowances: 0, deductions: 0, netPay,
        createdAt: serverTimestamp()
      });
      count++;
    }
    toast.success(count > 0 ? `Generated ${count} payslips for ${recurringMonth} ${recurringYear}` : "All payslips already exist for this month");
    setShowRecurring(false);
  };

  const handlePrint = () => {
    const content = printRef.current.innerHTML;
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Payslip</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#1e293b}.header{text-align:center;border-bottom:2px solid #7a2535;padding-bottom:16px;margin-bottom:24px}table{width:100%;border-collapse:collapse}td{padding:10px 16px;border:1px solid #e2e8f0;font-size:14px}.label{background:#f8fafc;font-weight:600;width:40%}.total{background:#7a2535;color:white;font-weight:700;font-size:16px}.footer{margin-top:40px;display:flex;justify-content:space-between;font-size:13px;color:#64748b}</style>
      </head><body>${content}</body></html>`);
    w.document.close(); w.print();
  };

  const handleCSV = () => exportToCSV("payslips", ["Employee", "Role", "Month", "Year", "Basic", "Allowances", "Deductions", "Net Pay"],
    filtered.map(p => [p.employeeName, p.role, p.month, p.year, p.basicSalary, p.allowances || 0, p.deductions || 0, p.netPay]));

  const handlePDF = () => exportToPDF("Payslips Report", ["Employee", "Role", "Month", "Basic", "Net Pay"],
    filtered.map(p => [p.employeeName, p.role, `${p.month} ${p.year}`, `Rs. ${Number(p.basicSalary).toLocaleString()}`, `Rs. ${Number(p.netPay).toLocaleString()}`]));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Payslips</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
          <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          <button onClick={() => setShowRecurring(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><RefreshCw size={14} /> Recurring</button>
          <button onClick={() => setShowModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Generate Payslip
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} placeholder="Search employee..."
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, minWidth: 180 }} />
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

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Employee", "Role", "Month", "Basic", "Allowances", "Deductions", "Net Pay", "Actions"].map(h => (
                <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "11px 14px", fontWeight: 500 }}>{p.employeeName}</td>
                <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--text-muted)" }}>{p.role}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{p.month} {p.year}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>Rs. {Number(p.basicSalary).toLocaleString()}</td>
                <td style={{ padding: "11px 14px", fontSize: 13, color: "#10b981" }}>+Rs. {Number(p.allowances || 0).toLocaleString()}</td>
                <td style={{ padding: "11px 14px", fontSize: 13, color: "#ef4444" }}>-Rs. {Number(p.deductions || 0).toLocaleString()}</td>
                <td style={{ padding: "11px 14px", fontWeight: 700, color: "var(--primary)" }}>Rs. {Number(p.netPay).toLocaleString()}</td>
                <td style={{ padding: "11px 14px" }}>
                  <button onClick={() => setShowPrint(p)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <Printer size={13} /> Print
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No payslips found</div>}
      </div>

      {/* Recurring Modal */}
      {showRecurring && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Generate Recurring Payslips</h3>
              <button onClick={() => setShowRecurring(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: 16, background: "#f8fafc", borderRadius: 10, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
              Generates payslips for all employees with <strong>recurring payslip</strong> enabled. Go to Employees and tick "Auto-generate payslip" per staff member.
              <br /><br />
              <strong style={{ color: "#10b981" }}>{employees.filter(e => e.recurringPayslip).length} employees</strong> have recurring enabled.
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

      {/* Generate Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Generate Payslip</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Employee</label>
                  <select value={form.employeeId} onChange={e => {
                    const emp = employees.find(em => em.id === e.target.value);
                    setForm(p => ({ ...p, employeeId: e.target.value, basicSalary: emp?.salary || "" }));
                  }} required style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select employee</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} — {emp.role}</option>)}
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
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Year</label>
                  <input type="number" value={form.year} onChange={e => setForm(p => ({ ...p, year: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Basic Salary (Rs.)</label>
                  <input type="number" value={form.basicSalary} onChange={e => setForm(p => ({ ...p, basicSalary: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Allowances (Rs.)</label>
                  <input type="number" value={form.allowances} onChange={e => setForm(p => ({ ...p, allowances: e.target.value }))} placeholder="0"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Deductions (Rs.)</label>
                  <input type="number" value={form.deductions} onChange={e => setForm(p => ({ ...p, deductions: e.target.value }))} placeholder="0"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Net Pay</label>
                  <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, fontWeight: 700, color: "var(--primary)", background: "#f8fafc" }}>
                    Rs. {(Number(form.basicSalary || 0) + Number(form.allowances || 0) - Number(form.deductions || 0)).toLocaleString()}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Preview */}
      {showPrint && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Payslip Preview</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handlePrint} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}><Printer size={14} /> Print</button>
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
                  {[["Employee Name", showPrint.employeeName], ["Role", showPrint.role], ["Pay Period", `${showPrint.month} ${showPrint.year}`], ["Basic Salary", `Rs. ${Number(showPrint.basicSalary).toLocaleString()}`], ["Allowances", `Rs. ${Number(showPrint.allowances || 0).toLocaleString()}`], ["Deductions", `Rs. ${Number(showPrint.deductions || 0).toLocaleString()}`]].map(([label, value]) => (
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