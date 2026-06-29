import React, { useState } from "react";
import { db, addDoc, collection, serverTimestamp } from "../../firebase";
import { useBranch } from "../../context/BranchContext";
import { useUser } from "../../context/UserContext";
import toast from "react-hot-toast";
import { Plus, X, GraduationCap, Briefcase } from "lucide-react";

// A floating "Quick Add" button available on every page. Lets staff
// add a student or an employee instantly without navigating away, so
// in-progress work on the current page isn't disturbed.
export default function QuickAdd() {
  const { branches, activeBranch } = useBranch();
  const { can } = useUser();

  const canStudent = can("canEditStudents");
  const canEmployee = can("canEditEmployees");
  if (!canStudent && !canEmployee) return null; // nothing to add

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(canStudent ? "student" : "employee");
  const [saving, setSaving] = useState(false);

  const defaultBranch = activeBranch && activeBranch !== "all" ? activeBranch : "";
  const [student, setStudent] = useState({ name: "", studentId: "", grade: "", parentName: "", parentPhone: "", monthlyFee: "", branchId: defaultBranch });
  const [employee, setEmployee] = useState({ name: "", role: "", phone: "", salary: "", branchId: defaultBranch });

  const reset = () => {
    setStudent({ name: "", studentId: "", grade: "", parentName: "", parentPhone: "", monthlyFee: "", branchId: defaultBranch });
    setEmployee({ name: "", role: "", phone: "", salary: "", branchId: defaultBranch });
  };

  const close = () => { setOpen(false); reset(); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (kind === "student") {
        if (!student.name.trim()) { toast.error("Name is required"); setSaving(false); return; }
        await addDoc(collection(db, "students"), { ...student, createdAt: serverTimestamp() });
        toast.success("Student added");
      } else {
        if (!employee.name.trim()) { toast.error("Name is required"); setSaving(false); return; }
        await addDoc(collection(db, "employees"), { ...employee, createdAt: serverTimestamp() });
        toast.success("Employee added");
      }
      close();
    } catch (err) {
      toast.error(err?.message || "Error saving");
    } finally {
      setSaving(false);
    }
  };

  const field = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
  const label = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };

  return (
    <>
      {/* Floating action button */}
      <button
        onClick={() => setOpen(true)}
        title="Quick add"
        aria-label="Quick add"
        style={{
          position: "fixed", right: 20, bottom: 20, zIndex: 900,
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: "var(--primary)", color: "white", cursor: "pointer",
          boxShadow: "0 6px 18px rgba(122,37,53,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Plus size={26} />
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
        >
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Quick Add</h3>
              <button onClick={close} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* type switch (only show options the user can create) */}
            {canStudent && canEmployee && (
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <button type="button" onClick={() => setKind("student")}
                  style={{ flex: 1, padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    border: kind === "student" ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: kind === "student" ? "var(--primary-light)" : "white",
                    color: kind === "student" ? "var(--primary)" : "#475569" }}>
                  <GraduationCap size={16} /> Student
                </button>
                <button type="button" onClick={() => setKind("employee")}
                  style={{ flex: 1, padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    border: kind === "employee" ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: kind === "employee" ? "var(--primary-light)" : "white",
                    color: kind === "employee" ? "var(--primary)" : "#475569" }}>
                  <Briefcase size={16} /> Employee
                </button>
              </div>
            )}

            <form onSubmit={save}>
              {kind === "student" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={label}>Full Name *</label>
                    <input style={field} value={student.name} onChange={(e) => setStudent(p => ({ ...p, name: e.target.value }))} required />
                  </div>
                  <div>
                    <label style={label}>Student ID</label>
                    <input style={field} value={student.studentId} onChange={(e) => setStudent(p => ({ ...p, studentId: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Grade / Class</label>
                    <input style={field} value={student.grade} onChange={(e) => setStudent(p => ({ ...p, grade: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Parent Name</label>
                    <input style={field} value={student.parentName} onChange={(e) => setStudent(p => ({ ...p, parentName: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Parent Phone</label>
                    <input style={field} value={student.parentPhone} onChange={(e) => setStudent(p => ({ ...p, parentPhone: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Monthly Fee (Rs.)</label>
                    <input type="number" style={field} value={student.monthlyFee} onChange={(e) => setStudent(p => ({ ...p, monthlyFee: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Branch</label>
                    <select style={field} value={student.branchId} onChange={(e) => setStudent(p => ({ ...p, branchId: e.target.value }))}>
                      <option value="">Main Office</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={label}>Full Name *</label>
                    <input style={field} value={employee.name} onChange={(e) => setEmployee(p => ({ ...p, name: e.target.value }))} required />
                  </div>
                  <div>
                    <label style={label}>Role / Title</label>
                    <input style={field} value={employee.role} onChange={(e) => setEmployee(p => ({ ...p, role: e.target.value }))} placeholder="Teacher, Admin..." />
                  </div>
                  <div>
                    <label style={label}>Phone</label>
                    <input style={field} value={employee.phone} onChange={(e) => setEmployee(p => ({ ...p, phone: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Salary (Rs.)</label>
                    <input type="number" style={field} value={employee.salary} onChange={(e) => setEmployee(p => ({ ...p, salary: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>Branch</label>
                    <select style={field} value={employee.branchId} onChange={(e) => setEmployee(p => ({ ...p, branchId: e.target.value }))}>
                      <option value="">Main Office</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={close} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving..." : kind === "student" ? "Add Student" : "Add Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
