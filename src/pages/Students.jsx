import React, { useEffect, useState } from "react";
import { db, storage } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useBranch } from "../context/BranchContext";
import toast from "react-hot-toast";
import { Plus, Search, Edit2, Trash2, Upload, X } from "lucide-react";

const emptyStudent = { name: "", studentId: "", grade: "", parentName: "", parentPhone: "", email: "", branchId: "", monthlyFee: "", address: "", dob: "" };

export default function Students() {
  const { branches, activeBranch } = useBranch();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyStudent);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docFile, setDocFile] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "students"), (snap) => {
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const filtered = students.filter(s => {
    const matchBranch = activeBranch === "all" || s.branchId === activeBranch;
    const matchSearch = s.name?.toLowerCase().includes(search.toLowerCase()) || s.studentId?.toLowerCase().includes(search.toLowerCase());
    return matchBranch && matchSearch;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUploading(true);
    try {
      let docUrl = form.docUrl || null;
      if (docFile) {
        const fileRef = ref(storage, `students/${Date.now()}_${docFile.name}`);
        await uploadBytes(fileRef, docFile);
        docUrl = await getDownloadURL(fileRef);
      }
      const data = { ...form, docUrl, updatedAt: serverTimestamp() };
      if (editing) {
        await updateDoc(doc(db, "students", editing), data);
        toast.success("Student updated");
      } else {
        await addDoc(collection(db, "students"), { ...data, createdAt: serverTimestamp() });
        toast.success("Student added");
      }
      setShowModal(false); setForm(emptyStudent); setEditing(null); setDocFile(null);
    } catch (err) { toast.error("Error saving student"); }
    setUploading(false);
  };

  const handleEdit = (s) => { setForm(s); setEditing(s.id); setShowModal(true); };
  const handleDelete = async (id) => { if (window.confirm("Delete student?")) { await deleteDoc(doc(db, "students", id)); toast.success("Deleted"); } };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Students</h2>
        <button onClick={() => { setForm(emptyStudent); setEditing(null); setShowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Student
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID..."
              style={{ width: "100%", padding: "8px 8px 8px 34px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["ID", "Name", "Grade", "Parent", "Phone", "Monthly Fee", "Branch", "Actions"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontSize: 14, fontFamily: "monospace" }}>{s.studentId}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{s.grade}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{s.parentName}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{s.parentPhone}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>${s.monthlyFee}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{branches.find(b => b.id === s.branchId)?.name || "—"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleEdit(s)} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(s.id)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={14} /></button>
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
                  { label: "Monthly Fee", key: "monthlyFee", type: "number" },
                  { label: "Address", key: "address" },
                ].map(({ label, key, type = "text", required }) => (
                  <div key={key} style={{ gridColumn: key === "address" ? "span 2" : "span 1" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required={required}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Upload Document</label>
                  <input type="file" onChange={e => setDocFile(e.target.files[0])}
                    style={{ width: "100%", padding: "8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white" }}>Cancel</button>
                <button type="submit" disabled={uploading} style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  {uploading ? "Saving..." : "Save Student"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}