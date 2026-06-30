import React, { useState } from "react";
import { db, addDoc, updateDoc, deleteDoc, doc, collection, serverTimestamp } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, X, Download, FileText, Receipt } from "lucide-react";
import { useNavigate } from "react-router-dom";

const emptyStudent = { name: "", studentId: "", grade: "", parentName: "", parentPhone: "", email: "", branchId: "", monthlyFee: "", address: "", dob: "", recurringFee: false };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Students() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyStudent);
  const [editing, setEditing] = useState(null);

  const { rows, filtered, paged, total, pageCount, page: safePage } = useCollection("students", {
    activeBranch,
    search,
    searchFields: ["name", "studentId", "parentName", "parentPhone"],
    filters: { grade: filterGrade },
    sortBy: sortField,
    sortDir,
    page,
    pageSize,
  });

  const grades = [...new Set(rows.map((s) => s.grade).filter(Boolean))].sort();
  const active = !!(search || filterGrade || sortField);

  React.useEffect(() => { setPage(1); }, [search, filterGrade, pageSize, activeBranch]);

  const clearAll = () => { setSearch(""); setFilterGrade(""); setSortField(""); setSortDir("asc"); };

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
    } catch (err) { toast.error(err?.message || "Error saving"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this student? This cannot be undone.")) return;
    try { await deleteDoc(doc(db, "students", id)); toast.success("Student deleted"); }
    catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handleCSV = () => exportToCSV("students",
    ["ID", "Name", "Grade", "Parent", "Phone", "Fee", "Branch"],
    filtered.map((s) => [s.studentId, s.name, s.grade, s.parentName, s.parentPhone, s.monthlyFee, branches.find((b) => b.id === s.branchId)?.name || "Main"])
  );
  const handlePDF = () => exportToPDF("Students Report",
    ["ID", "Name", "Grade", "Parent", "Phone", "Fee"],
    filtered.map((s) => [s.studentId, s.name, s.grade, s.parentName, s.parentPhone, `Rs. ${s.monthlyFee}`])
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Students <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <>
            <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
            <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          </>}
          <button onClick={() => { setForm(emptyStudent); setEditing(null); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={15} /> Add Student
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, ID, parent, phone..."
        filters={[
          { key: "grade", value: filterGrade, onChange: setFilterGrade, placeholder: "All Grades", options: grades.map((g) => ({ value: g, label: g })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "name", label: "Name" },
            { value: "studentId", label: "Student ID" },
            { value: "grade", label: "Grade" },
            { value: "monthlyFee", label: "Monthly Fee" },
          ],
        }}
        active={active}
        onClear={clearAll}
      />

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((s) => (
            <div key={s.id} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--primary)", fontSize: 16 }}>
                    {s.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{s.studentId}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => navigate(`/students/${s.id}/ledger`)} title="Ledger" style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Receipt size={14} /></button>
                  <button onClick={() => { setForm(s); setEditing(s.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(s.id)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Trash2 size={14} /></button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Grade</div><div style={{ fontWeight: 500 }}>{s.grade || "—"}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Monthly Fee</div><div style={{ fontWeight: 600, color: "var(--primary)" }}>Rs. {s.monthlyFee || 0}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Parent</div><div style={{ fontWeight: 500 }}>{s.parentName || "—"}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Phone</div><a href={`tel:${s.parentPhone}`} style={{ color: "#2a8c7a", fontWeight: 500, textDecoration: "none" }}>{s.parentPhone || "—"}</a></div>
              </div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{branches.find((b) => b.id === s.branchId)?.name || "Main Office"}</span>
                {s.recurringFee && <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>Auto fees</span>}
              </div>
            </div>
          ))}
          {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12 }}>No students found</div>}
        </div>
      ) : (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["ID", "Name", "Grade", "Parent", "Phone", "Fee", "Branch", "Auto", "Actions"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 14px", fontSize: 12, fontFamily: "monospace" }}>{s.studentId}</td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>{s.name}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.grade}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{s.parentName}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.parentPhone}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600 }}>Rs. {s.monthlyFee}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{branches.find((b) => b.id === s.branchId)?.name || "Main Office"}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.recurringFee ? "#ecfdf5" : "#f8fafc", color: s.recurringFee ? "#10b981" : "var(--text-muted)" }}>
                        {s.recurringFee ? "Auto" : "Manual"}
                      </span>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => navigate(`/students/${s.id}/ledger`)} title="Ledger" style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Receipt size={13} /></button>
                        <button onClick={() => { setForm(s); setEditing(s.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                        <button onClick={() => handleDelete(s.id)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No students found</div>}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>{editing ? "Edit Student" : "Add Student"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyStudent); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                {[
                  { label: "Full Name", key: "name", required: true },
                  { label: "Student ID", key: "studentId", required: true },
                  { label: "Grade / Class", key: "grade" },
                  { label: "Date of Birth", key: "dob", type: "date" },
                  { label: "Parent Name", key: "parentName" },
                  { label: "Parent Phone (+92...)", key: "parentPhone" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Monthly Fee (Rs.)", key: "monthlyFee", type: "number" },
                ].map(({ label, key, type = "text", required }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} required={required}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Branch</label>
                  <select value={form.branchId || ""} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main Office</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: form.recurringFee ? "#f0fdf4" : "#f8fafc" }}>
                  <input type="checkbox" id="recurringFee" checked={form.recurringFee || false} onChange={(e) => setForm((p) => ({ ...p, recurringFee: e.target.checked }))} style={{ width: 18, height: 18 }} />
                  <div>
                    <label htmlFor="recurringFee" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Auto monthly fees</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Invoice created each month</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(emptyStudent); }}
                  style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                <button type="submit"
                  style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {editing ? "Update Student" : "Add Student"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
