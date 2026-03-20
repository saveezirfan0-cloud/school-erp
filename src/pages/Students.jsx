import React, { useEffect, useState } from "react";
import { db, storage } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Search, Edit2, Trash2, X, Download, FileText } from "lucide-react";

const emptyStudent = { name: "", studentId: "", grade: "", parentName: "", parentPhone: "", email: "", branchId: "", monthlyFee: "", address: "", dob: "", recurringFee: false };

export default function Students() {
  const { branches, activeBranch } = useBranch();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterRecurring, setFilterRecurring] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyStudent);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "students"), snap =>
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const grades = [...new Set(students.map(s => s.grade).filter(Boolean))].sort();

  const filtered = students.filter(s => {
    const matchBranch = (activeBranch === "all" || s.branchId === activeBranch) && (!filterBranch || s.branchId === filterBranch);
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.studentId?.toLowerCase().includes(search.toLowerCase());
    const matchGrade = !filterGrade || s.grade === filterGrade;
    const matchRecurring = !filterRecurring || (filterRecurring === "yes" ? s.recurringFee : !s.recurringFee);
    return matchBranch && matchSearch && matchGrade && matchRecurring;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateDoc(doc(db, "students", editing), { ...form, updatedAt: serverTimestamp() });
        toast.success("Student updated");
      } else {
        await addDoc(collection(db, "students"), { ...form, createdAt: serverTimestamp() });
        toast.success("Student added");
      }
      setShowModal(false); setForm(emptyStudent); setEditing(null);
    } catch (err) { toast.error("Error saving student"); }
  };

  const handleCSV = () => exportToCSV("students", ["ID", "Name", "Grade", "Parent", "Phone", "Monthly Fee", "Branch", "Recurring"],
    filtered.map(s => [s.studentId, s.name, s.grade, s.parentName, s.parentPhone, s.monthlyFee, branches.find(b => b.id === s.branchId)?.name || "Main", s.recurringFee ? "Yes" : "No"]));

  const handlePDF = () => exportToPDF("Students Report", ["ID", "Name", "Grade", "Parent", "Phone", "Monthly Fee", "Branch"],
    filtered.map(s => [s.studentId, s.name, s.grade, s.parentName, s.parentPhone, `Rs. ${s.monthlyFee}`, branches.find(b => b.id === s.branchId)?.name || "Main"]));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Students <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>({filtered.length})</span></h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
          <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          <button onClick={() => { setForm(emptyStudent); setEditing(null); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Add Student
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or ID..."
            style={{ width: "100%", padding: "8px 8px 8px 32px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
        </div>
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Grades</option>
          {grades.map(g => <option key={g}>{g}</option>)}
        </select>
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterRecurring} onChange={e => setFilterRecurring(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
          <option value="">All Students</option>
          <option value="yes">Auto-recurring only</option>
          <option value="no">Manual only</option>
        </select>
        {(search || filterGrade || filterBranch || filterRecurring) && (
          <button onClick={() => { setSearch(""); setFilterGrade(""); setFilterBranch(""); setFilterRecurring(""); }}
            style={{ padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>
            Clear filters
          </button>
        )}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["ID", "Name", "Grade", "Parent", "Phone", "Monthly Fee", "Branch", "Auto Fees", "Actions"].map(h => (
                <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "11px 14px", fontSize: 13, fontFamily: "monospace" }}>{s.studentId}</td>
                <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.grade}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.parentName}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.parentPhone}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>Rs. {s.monthlyFee}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{branches.find(b => b.id === s.branchId)?.name || "Main"}</td>
                <td style={{ padding: "11px 14px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.recurringFee ? "#ecfdf5" : "#f8fafc", color: s.recurringFee ? "#10b981" : "var(--text-muted)" }}>
                    {s.recurringFee ? "Auto" : "Manual"}
                  </span>
                </td>
                <td style={{ padding: "11px 14px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { setForm(s); setEditing(s.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                    <button onClick={() => { if (window.confirm("Delete?")) deleteDoc(doc(db, "students", s.id)); }} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No students found</div>}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit Student" : "Add Student"}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Full Name", key: "name", required: true },
                  { label: "Student ID", key: "studentId", required: true },
                  { label: "Grade / Class", key: "grade" },
                  { label: "Date of Birth", key: "dob", type: "date" },
                  { label: "Parent Name", key: "parentName" },
                  { label: "Parent Phone (with country code)", key: "parentPhone" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Monthly Fee (Rs.)", key: "monthlyFee", type: "number" },
                  { label: "Address", key: "address", span: 2 },
                ].map(({ label, key, type = "text", required, span }) => (
                  <div key={key} style={{ gridColumn: span === 2 ? "span 2" : "span 1" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required={required}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px", border: "1px solid var(--border)", borderRadius: 8, gridColumn: "span 1" }}>
                  <input type="checkbox" id="recurringFee" checked={form.recurringFee || false} onChange={e => setForm(p => ({ ...p, recurringFee: e.target.checked }))}
                    style={{ width: 18, height: 18, cursor: "pointer" }} />
                  <div>
                    <label htmlFor="recurringFee" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Auto-generate monthly fees</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Invoice created automatically each month</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Save Student</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}