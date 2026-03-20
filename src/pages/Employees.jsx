import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Edit2, Download, FileText } from "lucide-react";

const empty = { name: "", role: "", phone: "", email: "", branchId: "", salary: "", joinDate: "", recurringPayslip: false };

export default function Employees() {
  const { branches } = useBranch();
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [filterBranch, setFilterBranch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), snap =>
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const roles = [...new Set(employees.map(e => e.role).filter(Boolean))];

  const filtered = employees.filter(e => {
    const matchBranch = !filterBranch || e.branchId === filterBranch;
    const matchRole = !filterRole || e.role === filterRole;
    const matchSearch = !search || e.name?.toLowerCase().includes(search.toLowerCase());
    return matchBranch && matchRole && matchSearch;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateDoc(doc(db, "employees", editing), { ...form, updatedAt: serverTimestamp() });
        toast.success("Employee updated");
      } else {
        await addDoc(collection(db, "employees"), { ...form, createdAt: serverTimestamp() });
        toast.success("Employee added");
      }
      setShowModal(false); setForm(empty); setEditing(null);
    } catch (err) { toast.error("Error saving"); }
  };

  const handleEdit = (emp) => { setForm(emp); setEditing(emp.id); setShowModal(true); };
  const handleDelete = async (id) => { if (window.confirm("Delete employee?")) { await deleteDoc(doc(db, "employees", id)); toast.success("Deleted"); } };

  const handleCSV = () => exportToCSV("employees",
    ["Name", "Role", "Phone", "Email", "Branch", "Salary", "Auto Payslip"],
    filtered.map(e => [e.name, e.role, e.phone, e.email, branches.find(b => b.id === e.branchId)?.name || "Main", e.salary, e.recurringPayslip ? "Yes" : "No"])
  );

  const handlePDF = () => exportToPDF("Employees Report",
    ["Name", "Role", "Phone", "Branch", "Salary"],
    filtered.map(e => [e.name, e.role, e.phone, branches.find(b => b.id === e.branchId)?.name || "Main", `Rs. ${Number(e.salary || 0).toLocaleString()}`])
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Employees / Teachers <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>({filtered.length})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
          <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          <button onClick={() => { setForm(empty); setEditing(null); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name..."
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, minWidth: 160 }} />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Roles</option>
          {roles.map(r => <option key={r}>{r}</option>)}
        </select>
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {(search || filterRole || filterBranch) && (
          <button onClick={() => { setSearch(""); setFilterRole(""); setFilterBranch(""); }}
            style={{ padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>Clear</button>
        )}
      </div>

      {/* Cards grid — responsive */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {filtered.map(emp => (
          <div key={emp.id} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {emp.name?.charAt(0)?.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleEdit(emp)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                <button onClick={() => handleDelete(emp.id)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.name}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{emp.role}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{emp.phone}</div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{branches.find(b => b.id === emp.branchId)?.name || "Main"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>Rs. {Number(emp.salary || 0).toLocaleString()}/mo</span>
              </div>
              {emp.recurringPayslip && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>Auto payslip</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>No employees found</div>}

      {/* Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit Employee" : "Add Employee"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Full Name", key: "name", required: true },
                  { label: "Role / Position", key: "role" },
                  { label: "Phone", key: "phone" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Monthly Salary (Rs.)", key: "salary", type: "number" },
                  { label: "Join Date", key: "joinDate", type: "date" },
                ].map(({ label, key, type = "text", required }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required={required}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId || ""} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main Office</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: form.recurringPayslip ? "#f0fdf4" : "#f8fafc" }}>
                  <input type="checkbox" id="recurringPayslip" checked={form.recurringPayslip || false}
                    onChange={e => setForm(p => ({ ...p, recurringPayslip: e.target.checked }))} style={{ width: 18, height: 18, cursor: "pointer" }} />
                  <div>
                    <label htmlFor="recurringPayslip" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Auto-generate monthly payslip</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Payslip auto-created each month using base salary</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>{editing ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}