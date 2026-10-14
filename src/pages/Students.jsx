import React, { useState } from "react";
import { db, supabase, addDoc, updateDoc, deleteDoc, doc, collection, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { usePersistentState } from "../hooks/usePersistentState";
import { studentName } from "../utils/studentLabel";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import BulkAddStudentsModal from "../components/UI/BulkAddStudentsModal";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import ExportMenu from "../components/UI/ExportMenu";
import toast from "react-hot-toast";
import { Plus, Users, Edit2, Trash2, X, Receipt, CalendarCheck, GraduationCap, ArrowRightLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isLeftStudent, leftStatusFields } from "../utils/studentStatus";
import { useUser } from "../context/UserContext";
import RollCallModal from "../components/Profile/RollCallModal";
import TransferStudentsModal from "../components/UI/TransferStudentsModal";
import { nextClassNo, classNoHolder, planNumbering } from "../utils/classNo";

const emptyStudent = { name: "", studentId: "", classNo: "", grade: "", parentName: "", parentPhone: "", email: "", branchId: "", monthlyFee: "", address: "", dob: "", recurringFee: false };

// Invoices copy the student's branch when they are created. When a student
// moves branch, carry their invoices along so branch-scoped fees/dashboards
// stay correct. Best effort: the dashboard also resolves branch via the student.
async function syncInvoiceBranch(studentIds, branchId) {
  if (!studentIds.length) return;
  const { error } = await supabase.from("invoices").update({ branch_id: branchId || "" }).in("student_id", studentIds);
  if (error) console.error("Could not update invoice branch:", error);
}

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
  const { can } = useUser();
  const { branches, activeBranch } = useBranch();
  const canSeeAcademics = can("canViewAttendance") || can("canViewExams") || can("canViewLearning");
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [showRollCall, setShowRollCall] = useState(false);

  const [search, setSearch] = useState("");
  // Multi-select class filter (Hifz, Class 1, ...). Remembered between visits.
  const [filterGrades, setFilterGrades] = usePersistentState("students.filterGrades", []);
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyStudent);
  const [editing, setEditing] = useState(null);
  const [transferring, setTransferring] = useState(null); // students being transferred

  // Viewing one class shows each student's number in that class (and lists
  // them in that order unless another sort is picked); across classes only
  // the school-wide Reg No. is shown.
  const singleClass = filterGrades.length === 1 ? filterGrades[0] : null;

  const { rows, filtered, paged, total, pageCount, page: safePage } = useCollection("students", {
    activeBranch,
    search,
    searchFields: ["name", "studentId", "grade", "parentName", "parentPhone", "email"],
    filters: { grade: filterGrades },
    sortBy: sortField || (singleClass ? "classNo" : ""),
    sortDir,
    page,
    pageSize,
  });

  // Include any remembered selection that no longer matches a student, so it stays visible and removable.
  const grades = [...new Set([...rows.map((s) => s.grade).filter(Boolean), ...filterGrades])].sort();
  const active = !!(search || filterGrades.length || sortField);

  // multi-select for bulk actions
  const bulk = useBulkSelect(rows.map((s) => s.id), activeBranch);
  const pagedIds = paged.map((s) => s.id);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  React.useEffect(() => { setPage(1); }, [search, filterGrades, pageSize, activeBranch]);

  const clearAll = () => { setSearch(""); setFilterGrades([]); setSortField(""); setSortDir("asc"); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const before = editing ? rows.find((r) => r.id === editing) : null;
    const data = { ...form, classNo: String(form.classNo ?? "").trim() };
    const movedClass = before && ((before.grade || "") !== (data.grade || "") || (before.branchId || "") !== (data.branchId || ""));
    // A new student, or one moved to another class without a new number typed
    // in, gets the next free number in their class.
    if (data.grade && (!data.classNo || (movedClass && data.classNo === String(before.classNo ?? "").trim()))) {
      data.classNo = nextClassNo(rows, data.grade, data.branchId, { excludeIds: editing ? [editing] : [] });
    }
    const holder = classNoHolder(rows, data.grade, data.branchId, data.classNo, editing);
    if (holder && !window.confirm(`Class No. ${data.classNo} in ${data.grade} is already ${studentName(holder)}'s. Save anyway?`)) return;
    try {
      if (editing) {
        await updateDoc(doc(db, "students", editing), { ...data, updatedAt: serverTimestamp() });
        if (before && (before.branchId || "") !== (data.branchId || "")) await syncInvoiceBranch([editing], data.branchId);
        toast.success("Student updated");
        logActivity("updated", "Students", `${form.name || "Unnamed"}${form.studentId ? ` (${form.studentId})` : ""}`);
      } else {
        await addDoc(collection(db, "students"), { ...data, createdAt: serverTimestamp() });
        toast.success("Student added");
        logActivity("created", "Students", `${form.name || "Unnamed"}${form.studentId ? ` (${form.studentId})` : ""}`);
      }
      setShowModal(false); setForm(emptyStudent); setEditing(null);
    } catch (err) { toast.error(err?.message || "Error saving"); }
  };

  const handleDelete = async (s) => {
    if (!window.confirm("Delete this student? You can restore them from Trash.")) return;
    try {
      await deleteDoc(doc(db, "students", s.id));
      toast.success("Student moved to Trash");
      logActivity("deleted", "Students", `${studentName(s)}${s.name && s.studentId ? ` (${s.studentId})` : ""}`);
    }
    catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} student${ids.length === 1 ? "" : "s"}? Their invoices and ledgers are kept. You can restore students from Trash.`)) return;
    setBulkBusy(true);
    try {
      await deleteDocs("students", ids);
      toast.success(bulkResultMessage(ids.length, 0, "moved to Trash", "students"));
      logActivity("deleted", "Students", `${ids.length} students (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed");
    } finally { setBulkBusy(false); }
  };

  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const n = bulk.count;
      if (changes.branchId === "main") changes.branchId = "";
      await updateDocs("students", [...bulk.selected], { ...changes, updatedAt: serverTimestamp() });
      if ("branchId" in changes) await syncInvoiceBranch([...bulk.selected], changes.branchId);
      toast.success(`${n} student${n === 1 ? "" : "s"} updated`);
      logActivity("updated", "Students", `${n} students (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  // Write a transfer planned by TransferStudentsModal: new class, branch and
  // class number, plus a line in the student's transfer history.
  const handleTransfer = async (moves, { date, note }) => {
    setBulkBusy(true);
    try {
      for (const m of moves) {
        const s = m.student;
        const entry = { date, fromGrade: s.grade || "", toGrade: m.grade, fromBranchId: s.branchId || "", toBranchId: m.branchId, fromClassNo: s.classNo || "", toClassNo: m.classNo, ...(note ? { note } : {}) };
        await updateDoc(doc(db, "students", s.id), {
          grade: m.grade, branchId: m.branchId, classNo: m.classNo,
          transferHistory: [...(Array.isArray(s.transferHistory) ? s.transferHistory : []), entry],
          updatedAt: serverTimestamp(),
        });
      }
      const branchMoves = {};
      moves.filter((m) => (m.student.branchId || "") !== m.branchId).forEach((m) => { (branchMoves[m.branchId] ||= []).push(m.student.id); });
      for (const [branchId, ids] of Object.entries(branchMoves)) await syncInvoiceBranch(ids, branchId);
      const n = moves.length;
      toast.success(`${n} student${n === 1 ? "" : "s"} transferred to ${moves[0].grade}`);
      logActivity("updated", "Students", n === 1
        ? `${studentName(moves[0].student)}${moves[0].student.studentId ? ` (${moves[0].student.studentId})` : ""}: transferred to ${moves[0].grade}`
        : `${n} students (bulk): transferred to ${moves[0].grade}`);
      setTransferring(null);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Transfer failed");
    } finally { setBulkBusy(false); }
  };

  // One-click numbering for students in the viewed class who have no class number yet.
  const unnumbered = singleClass ? filtered.filter((s) => !String(s.classNo ?? "").trim()) : [];
  const handleAssignNumbers = async () => {
    const plan = planNumbering(rows, unnumbered);
    if (!plan.length) return;
    if (!window.confirm(`Give ${plan.length} student${plan.length === 1 ? "" : "s"} in ${singleClass} a class number (alphabetically, after the highest number already used)?`)) return;
    setBulkBusy(true);
    try {
      for (const p of plan) await updateDoc(doc(db, "students", p.student.id), { classNo: p.classNo, updatedAt: serverTimestamp() });
      toast.success(`Class numbers assigned to ${plan.length} student${plan.length === 1 ? "" : "s"}`);
      logActivity("updated", "Students", `${plan.length} students (bulk): class numbers assigned in ${singleClass}`);
    } catch (err) {
      toast.error(err?.message || "Could not assign class numbers");
    } finally { setBulkBusy(false); }
  };

  const branchLabel = (s) => branches.find((b) => b.id === s.branchId)?.name || "Main";
  const numberHeaders = singleClass ? ["Reg No.", "Class No."] : ["Reg No."];
  const numberCells = (s) => (singleClass ? [s.studentId, s.classNo] : [s.studentId]);
  const getExportData = () => ({
    headers: [...numberHeaders, "Name", "Grade", "Parent", "Phone", "Fee", "Branch"],
    rows: filtered.map((s) => [...numberCells(s), s.name, s.grade, s.parentName, s.parentPhone, Number(s.monthlyFee || 0), branchLabel(s)]),
    pdfHeaders: [...numberHeaders, "Name", "Grade", "Parent", "Phone", "Fee", "Branch"],
    pdfRows: filtered.map((s) => [...numberCells(s), s.name, s.grade, s.parentName, s.parentPhone, `Rs. ${Number(s.monthlyFee || 0).toLocaleString()}`, branchLabel(s)]),
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Students <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can("canExport") && <ExportMenu filename="students" title="Students Report" getData={getExportData} disabled={filtered.length === 0} />}
          <button onClick={() => setShowBulkAdd(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Users size={15} /> Bulk Add
          </button>
          {can("canEditStudents") && (
            <button onClick={() => setShowRollCall(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
              <CalendarCheck size={14} /> Attendance
            </button>
          )}
          <button onClick={() => { setForm(emptyStudent); setEditing(null); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={15} /> Add Student
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, Reg No., class, parent, phone..."
        filters={[
          { key: "grade", multi: true, value: filterGrades, onChange: setFilterGrades, placeholder: "All Classes", options: grades.map((g) => ({ value: g, label: g })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "name", label: "Name" },
            { value: "studentId", label: "Reg No." },
            { value: "classNo", label: "Class No." },
            { value: "grade", label: "Grade" },
            { value: "monthlyFee", label: "Monthly Fee" },
          ],
        }}
        active={active}
        onClear={clearAll}
      />

      {unnumbered.length > 0 && can("canEditStudents") && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, fontSize: 13 }}>
          <span>{unnumbered.length} student{unnumbered.length === 1 ? "" : "s"} in {singleClass} {unnumbered.length === 1 ? "has" : "have"} no class number yet.</span>
          <button onClick={handleAssignNumbers} disabled={bulkBusy}
            style={{ padding: "6px 12px", border: "1px solid #d97706", color: "#b45309", background: "white", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
            Assign class numbers
          </button>
        </div>
      )}

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((s) => (
            <div key={s.id} onClick={() => navigate(`/students/${s.id}`)} style={{ background: "white", borderRadius: 12, padding: 16, cursor: "pointer", border: bulk.isSelected(s.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <RowCheckbox checked={bulk.isSelected(s.id)} onChange={() => bulk.toggle(s.id)} label={`Select ${studentName(s)}`} />
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--primary)", fontSize: 16 }}>
                    {studentName(s).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{studentName(s)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {s.studentId && <span>Reg No. <span style={{ fontFamily: "monospace" }}>{s.studentId}</span></span>}
                      {singleClass && s.classNo && <span>{s.studentId ? " • " : ""}Class No. <strong>{s.classNo}</strong></span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => navigate(`/students/${s.id}/ledger`)} title="Ledger" style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Receipt size={14} /></button>
                  {canSeeAcademics && <button onClick={() => navigate(`/students/${s.id}/academics`)} title="Academics" aria-label="Academics" style={{ border: "none", background: "#ecfdf5", color: "#059669", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><GraduationCap size={14} /></button>}
                  {can("canEditStudents") && <button onClick={() => setTransferring([s])} title="Transfer" aria-label="Transfer" style={{ border: "none", background: "#f5f3ff", color: "#7c3aed", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><ArrowRightLeft size={14} /></button>}
                  <button onClick={() => { setForm(s); setEditing(s.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Edit2 size={14} /></button>
                  {can("canDeleteStudents") && <button onClick={() => handleDelete(s)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer" }}><Trash2 size={14} /></button>}
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
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                  </th>
                  {[...numberHeaders, "Name", "Grade", "Parent", "Phone", "Fee", "Branch", "Auto", "Actions"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} title="Open student profile"
                    style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: bulk.isSelected(s.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "11px 6px 11px 14px" }}>
                      <RowCheckbox checked={bulk.isSelected(s.id)} onChange={() => bulk.toggle(s.id)} label={`Select ${studentName(s)}`} />
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 12, fontFamily: "monospace" }}>{s.studentId}</td>
                    {singleClass && <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600 }}>{s.classNo}</td>}
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", color: "var(--primary)" }}>{studentName(s)}{isLeftStudent(s) && <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#fef2f2", color: "#ef4444", fontWeight: 600 }}>Left</span>}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.grade}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{s.parentName}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.parentPhone}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600 }}>Rs. {s.monthlyFee || 0}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{branches.find((b) => b.id === s.branchId)?.name || "Main Office"}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.recurringFee ? "#ecfdf5" : "#f8fafc", color: s.recurringFee ? "#10b981" : "var(--text-muted)" }}>
                        {s.recurringFee ? "Auto" : "Manual"}
                      </span>
                    </td>
                    <td style={{ padding: "11px 14px" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => navigate(`/students/${s.id}/ledger`)} title="Ledger" style={{ border: "none", background: "#eff6ff", color: "#2563eb", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Receipt size={13} /></button>
                        {canSeeAcademics && <button onClick={() => navigate(`/students/${s.id}/academics`)} title="Academics" aria-label="Academics" style={{ border: "none", background: "#ecfdf5", color: "#059669", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><GraduationCap size={13} /></button>}
                        {can("canEditStudents") && <button onClick={() => setTransferring([s])} title="Transfer" aria-label="Transfer" style={{ border: "none", background: "#f5f3ff", color: "#7c3aed", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><ArrowRightLeft size={13} /></button>}
                        <button onClick={() => { setForm(s); setEditing(s.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                        {can("canDeleteStudents") && <button onClick={() => handleDelete(s)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>}
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

      {showRollCall && (
        <RollCallModal
          subjectType="student" noun="students"
          scopeLabel={filterGrades.length ? filterGrades.join(", ") : "all classes in the current list"}
          people={filtered.map((s) => ({ id: s.id, name: s.name, sub: [s.studentId, s.grade].filter(Boolean).join(" • "), branchId: s.branchId }))}
          onClose={() => setShowRollCall(false)}
        />
      )}

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="students"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map((s) => s.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Edit2, onClick: () => setShowBulkEdit(true) },
          ...(can("canEditStudents") ? [{ label: "Transfer", icon: ArrowRightLeft, onClick: () => setTransferring(rows.filter((s) => bulk.isSelected(s.id))) }] : []),
          ...(can("canDeleteStudents") ? [{ label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete }] : []),
        ]}
      />

      {transferring && (
        <TransferStudentsModal
          students={transferring}
          allStudents={rows}
          branches={branches}
          grades={[...new Set(rows.map((s) => s.grade).filter(Boolean))].sort()}
          busy={bulkBusy}
          onApply={handleTransfer}
          onClose={() => setTransferring(null)}
        />
      )}

      {showBulkAdd && (
        <BulkAddStudentsModal
          branches={branches}
          activeBranch={activeBranch}
          existingIds={rows.map((s) => (s.studentId || "").trim().toLowerCase()).filter(Boolean)}
          students={rows}
          onClose={() => setShowBulkAdd(false)}
          onDone={({ keepOpen } = {}) => { if (!keepOpen) setShowBulkAdd(false); }}
        />
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} student${bulk.count === 1 ? "" : "s"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "grade", label: "Grade / Class", type: "text", placeholder: "e.g. Grade 5", hint: "Keeps each student's class number. Use Transfer to move students and renumber them in the new class." },
            { key: "branchId", label: "Branch", type: "select", options: [{ value: "main", label: "Main Office" }, ...branches.map((b) => ({ value: b.id, label: b.name }))] },
            { key: "monthlyFee", label: "Monthly Fee (Rs.)", type: "number", placeholder: "e.g. 5000", hint: "Applies to future invoices only — existing invoices keep their amounts." },
            { key: "recurringFee", label: "Auto-recurring fee", type: "boolean" },
          ]}
        />
      )}

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
                  { label: "Full Name", key: "name" },
                  { label: "Reg No.", key: "studentId" },
                  { label: "Grade / Class", key: "grade" },
                  { label: "Class No.", key: "classNo", type: "number", placeholder: form.grade ? `Auto: ${nextClassNo(rows, form.grade, form.branchId, { excludeIds: editing ? [editing] : [] })}` : "Set a class first" },
                  { label: "Date of Birth", key: "dob", type: "date" },
                  { label: "Admission Date", key: "admissionDate", type: "date" },
                  { label: "Parent Name", key: "parentName" },
                  { label: "Parent Phone (+92...)", key: "parentPhone" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Monthly Fee (Rs.)", key: "monthlyFee", type: "number" },
                ].map(({ label, key, type = "text", required, placeholder }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} required={required} placeholder={placeholder}
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
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: isLeftStudent(form) ? "#fef2f2" : "#f8fafc" }}>
                  <input type="checkbox" id="studentLeft" checked={isLeftStudent(form)} onChange={(e) => setForm((p) => ({ ...p, ...leftStatusFields(e.target.checked) }))} style={{ width: 18, height: 18 }} />
                  <div>
                    <label htmlFor="studentLeft" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Student has left</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Keeps their records, stops new fee invoices</div>
                  </div>
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
