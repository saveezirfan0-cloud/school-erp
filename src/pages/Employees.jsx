import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import toast from "react-hot-toast";
import { Plus, Trash2, X } from "lucide-react";

export default function Employees() {
  const { branches } = useBranch();
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", phone: "", email: "", branchId: "", salary: "", joinDate: "" });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "employees"), { ...form, createdAt: serverTimestamp() });
    toast.success("Employee added");
    setShowModal(false);
    setForm({ name: "", role: "", phone: "", email: "", branchId: "", salary: "", joinDate: "" });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Employees / Teachers</h2>
        <button onClick={() => setShowModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Employee
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {employees.map(emp => (
          <div key={emp.id} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {emp.name?.charAt(0)?.toUpperCase()}
              </div>
              <button onClick={() => deleteDoc(doc(db, "employees", emp.id))} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}><Trash2 size={15} /></button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.name}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{emp.role}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{emp.phone}</div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{branches.find(b => b.id === emp.branchId)?.name || "Main"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>Rs.{emp.salary}/mo</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Add Employee</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Full Name", key: "name" },
                  { label: "Role / Position", key: "role" },
                  { label: "Phone", key: "phone" },
                  { label: "Email", key: "email" },
                  { label: "Monthly Salary", key: "salary", type: "number" },
                  { label: "Join Date", key: "joinDate", type: "date" },
                ].map(({ label, key, type = "text" }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main Office</option>
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