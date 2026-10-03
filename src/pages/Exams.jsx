import React, { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  ArrowLeft, Plus, Edit2, Trash2, X, ClipboardList, Save, Eye, EyeOff, MessageSquare, FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  db, addDoc, updateDoc, deleteDoc, doc, collection, serverTimestamp, upsertDocs,
} from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import { logActivity } from "../utils/auditLog";
import {
  classResults, classStats, validateMarks, toNumber, studentsForExam, subjectsForExam,
} from "../utils/grading";

const EXAM_TYPES = [
  { value: "test", label: "Test" },
  { value: "quiz", label: "Quiz" },
  { value: "midterm", label: "Mid-term" },
  { value: "final", label: "Final" },
  { value: "other", label: "Other" },
];
const typeLabel = (v) => EXAM_TYPES.find((t) => t.value === v)?.label || v || "—";

const today = () => format(new Date(), "yyyy-MM-dd");
const blankBranch = (b) => (!b || b === "main" ? "" : b);
const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : String(n));

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

const inputStyle = {
  width: "100%", padding: "10px 12px", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white",
};
const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };
const iconBtn = (bg, color, pad = "6px 9px") => ({
  border: "none", background: bg, color, padding: pad, borderRadius: 6, cursor: "pointer",
  display: "inline-flex", alignItems: "center",
});
const thStyle = {
  padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap",
};

function PublishedPill({ published }) {
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: published ? "#ecfdf5" : "#f8fafc",
      color: published ? "#10b981" : "var(--text-muted)",
    }}>
      {published ? "Published" : "Draft"}
    </span>
  );
}

// ===========================================================================
// Page: exam list  +  marks entry for the open exam
// ===========================================================================
const emptyExam = (branchId) => ({
  name: "", term: "", examType: "test", grade: "", date: today(), totalMarks: 100, published: false, branchId,
});

export default function Exams() {
  const { branches, activeBranch } = useBranch();
  const { can, assignedBranchId } = useUser();
  const canEdit = can("canEditExams");
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
  const [filterType, setFilterType] = useState("");
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [openId, setOpenId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyExam(""));
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const { rows, paged, total, pageCount, page: safePage, loading } = useCollection("exams", {
    activeBranch,
    search,
    searchFields: ["name", "term", "grade"],
    filters: { grade: filterGrade, term: filterTerm, examType: filterType },
    sortBy: sortField,
    sortDir,
    page,
    pageSize,
  });
  const { rows: students, loading: studentsLoading } = useCollection("students", { branchScoped: false });

  useEffect(() => { setPage(1); }, [search, filterGrade, filterTerm, filterType, pageSize, activeBranch]);

  const grades = useMemo(
    () => [...new Set([...rows.map((e) => e.grade), ...students.map((s) => s.grade)].map((g) => (g || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rows, students]
  );
  const terms = useMemo(() => [...new Set(rows.map((e) => (e.term || "").trim()).filter(Boolean))].sort(), [rows]);
  const filterActive = !!(search || filterGrade || filterTerm || filterType);
  const clearAll = () => { setSearch(""); setFilterGrade(""); setFilterTerm(""); setFilterType(""); };

  const branchName = (id) => branches.find((b) => b.id === id)?.name || "Main Office";
  const openExam = openId ? rows.find((e) => e.id === openId) : null;

  const defaultBranch = () => {
    if (assignedBranchId) return assignedBranchId;
    if (activeBranch && activeBranch !== "all") return blankBranch(activeBranch);
    return "";
  };

  const openCreate = () => { setForm(emptyExam(defaultBranch())); setEditing(null); setShowModal(true); };
  const openEdit = (e) => {
    setForm({
      name: e.name || "", term: e.term || "", examType: e.examType || "test", grade: e.grade || "",
      date: e.date || "", totalMarks: e.totalMarks ?? "", published: !!e.published, branchId: e.branchId || "",
    });
    setEditing(e.id);
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (saving) return;
    const totalMarks = toNumber(form.totalMarks);
    if (totalMarks === null || totalMarks <= 0) { toast.error("Total marks must be greater than 0"); return; }
    const payload = {
      name: form.name.trim(),
      term: form.term.trim(),
      examType: form.examType,
      grade: form.grade.trim(),
      date: form.date,
      totalMarks,
      published: !!form.published,
      branchId: form.branchId || "",
    };
    if (!payload.name || !payload.grade) { toast.error("Name and class are required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "exams", editing), { ...payload, updatedAt: serverTimestamp() });
        toast.success("Exam updated");
        logActivity("updated", "Exams", `${payload.name} (${payload.grade}${payload.term ? `, ${payload.term}` : ""})`);
      } else {
        await addDoc(collection(db, "exams"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Exam created");
        logActivity("created", "Exams", `${payload.name} (${payload.grade}${payload.term ? `, ${payload.term}` : ""})`);
      }
      closeModal();
    } catch (err) {
      toast.error(err?.message || "Error saving exam");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e) => {
    if (!window.confirm(`Delete "${e.name}"? It moves to Trash and can be restored; entered marks are kept.`)) return;
    try {
      await deleteDoc(doc(db, "exams", e.id));
      toast.success("Exam moved to Trash");
      logActivity("deleted", "Exams", `${e.name} (${e.grade || "no class"})`);
      if (openId === e.id) setOpenId(null);
    } catch (err) {
      toast.error(err?.message || "Error deleting exam");
    }
  };

  const togglePublished = async (e) => {
    try {
      await updateDoc(doc(db, "exams", e.id), { published: !e.published, updatedAt: serverTimestamp() });
      toast.success(e.published ? "Results unpublished" : "Results published");
      logActivity("updated", "Exams", `${e.name}: ${e.published ? "unpublished" : "published"}`);
    } catch (err) {
      toast.error(err?.message || "Error updating exam");
    }
  };

  // ---------- marks entry for the open exam ----------
  if (openExam) {
    return (
      <MarksEntry
        key={openExam.id}
        exam={openExam}
        allStudents={students}
        studentsLoading={studentsLoading}
        canEdit={canEdit}
        branchName={branchName}
        onBack={() => setOpenId(null)}
        onTogglePublished={() => togglePublished(openExam)}
        onReportCards={() => navigate("/report-cards")}
        isMobile={isMobile}
      />
    );
  }

  // ---------- list ----------
  const actionButtons = (e) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button onClick={() => setOpenId(e.id)} title={canEdit ? "Enter marks" : "View marks"}
        style={{ ...iconBtn("#eff6ff", "#2563eb", isMobile ? "7px 10px" : undefined), gap: 4, fontSize: 12, fontWeight: 600 }}>
        <ClipboardList size={13} /> {canEdit ? "Marks" : "View"}
      </button>
      {canEdit && (
        <>
          <button onClick={() => togglePublished(e)} title={e.published ? "Unpublish" : "Publish"}
            style={iconBtn("#f8fafc", "var(--text-muted)", isMobile ? "7px 9px" : undefined)}>
            {e.published ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button onClick={() => openEdit(e)} title="Edit exam"
            style={iconBtn("var(--primary-light)", "var(--primary)", isMobile ? "7px 9px" : undefined)}><Edit2 size={13} /></button>
          <button onClick={() => handleDelete(e)} title="Delete exam"
            style={iconBtn("#fef2f2", "var(--danger)", isMobile ? "7px 9px" : undefined)}><Trash2 size={13} /></button>
        </>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>
          Exams &amp; Results <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span>
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => navigate("/report-cards")}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
            <FileText size={14} /> Report Cards
          </button>
          {canEdit && (
            <button onClick={openCreate}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Plus size={15} /> Add Exam
            </button>
          )}
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search exam, term, class..."
        filters={[
          { key: "grade", value: filterGrade, onChange: setFilterGrade, placeholder: "All Classes", options: grades.map((g) => ({ value: g, label: g })) },
          { key: "term", value: filterTerm, onChange: setFilterTerm, placeholder: "All Terms", options: terms.map((t) => ({ value: t, label: t })) },
          { key: "type", value: filterType, onChange: setFilterType, placeholder: "All Types", options: EXAM_TYPES },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "date", label: "Date" },
            { value: "name", label: "Name" },
            { value: "grade", label: "Class" },
            { value: "term", label: "Term" },
          ],
        }}
        active={filterActive}
        onClear={clearAll}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>Loading exams…</div>
      ) : total === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
          {rows.length === 0
            ? <>No exams yet.{canEdit ? " Click “Add Exam” to create the first one." : ""}</>
            : "No exams match your filters."}
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((e) => (
            <div key={e.id} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.grade || "No class"}{e.term ? ` · ${e.term}` : ""}</div>
                </div>
                <PublishedPill published={e.published} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Type</div><div style={{ fontWeight: 500 }}>{typeLabel(e.examType)}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Date</div><div style={{ fontWeight: 500 }}>{e.date || "—"}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Total marks</div><div style={{ fontWeight: 600, color: "var(--primary)" }}>{fmt(e.totalMarks)}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Branch</div><div style={{ fontWeight: 500 }}>{branchName(e.branchId)}</div></div>
              </div>
              {actionButtons(e)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Exam", "Class", "Term", "Type", "Date", "Total", "Branch", "Status", "Actions"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>
                      <button onClick={() => setOpenId(e.id)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600, color: "var(--primary)", textAlign: "left" }}>{e.name}</button>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{e.grade}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{e.term || "—"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{typeLabel(e.examType)}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{e.date || "—"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600 }}>{fmt(e.totalMarks)}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{branchName(e.branchId)}</td>
                    <td style={{ padding: "11px 14px" }}><PublishedPill published={e.published} /></td>
                    <td style={{ padding: "11px 14px" }}>{actionButtons(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : 560, maxHeight: "90vh", overflow: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>{editing ? "Edit Exam" : "Add Exam"}</h3>
              <button onClick={closeModal} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
                  <label style={labelStyle}>Exam name</label>
                  <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="e.g. Mid-term 2026" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Class / Grade</label>
                  <input list="exam-grades" value={form.grade} onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))} required placeholder="e.g. Grade 5" style={inputStyle} />
                  <datalist id="exam-grades">{grades.map((g) => <option key={g} value={g} />)}</datalist>
                </div>
                <div>
                  <label style={labelStyle}>Term</label>
                  <input list="exam-terms" value={form.term} onChange={(e) => setForm((p) => ({ ...p, term: e.target.value }))} placeholder="e.g. Term 1" style={inputStyle} />
                  <datalist id="exam-terms">{terms.map((t) => <option key={t} value={t} />)}</datalist>
                </div>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={form.examType} onChange={(e) => setForm((p) => ({ ...p, examType: e.target.value }))} style={inputStyle}>
                    {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Total marks (per subject)</label>
                  <input type="number" min="1" step="any" value={form.totalMarks} onChange={(e) => setForm((p) => ({ ...p, totalMarks: e.target.value }))} required style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Branch</label>
                  <select value={form.branchId} disabled={!!assignedBranchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))} style={inputStyle}>
                    <option value="">Main Office</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: isMobile ? undefined : "1 / -1", display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: form.published ? "#f0fdf4" : "#f8fafc" }}>
                  <input type="checkbox" id="exam-published" checked={form.published} onChange={(e) => setForm((p) => ({ ...p, published: e.target.checked }))} style={{ width: 18, height: 18 }} />
                  <div>
                    <label htmlFor="exam-published" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Published</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Results are final and may appear on report cards</div>
                  </div>
                </div>
              </div>
              {editing && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                  Changing the class or branch does not move marks already entered for this exam.
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={closeModal} style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
                <button type="submit" disabled={saving}
                  style={{ flex: 2, padding: 11, background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving…" : editing ? "Update Exam" : "Create Exam"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Marks entry grid: rows = students, columns = subjects
// ===========================================================================
const cellKey = (studentId, subjectId) => `${studentId}|${subjectId}`;
const EMPTY_CELL = { marks: "", absent: false, remarks: "" };
const savedToCell = (r) => (r
  ? { marks: r.marksObtained === null || r.marksObtained === undefined ? "" : String(r.marksObtained), absent: !!r.absent, remarks: r.remarks || "" }
  : EMPTY_CELL);

function MarksEntry({ exam, allStudents, studentsLoading, canEdit, branchName, onBack, onTogglePublished, onReportCards, isMobile }) {
  const { rows: subjectRows, loading: subjectsLoading } = useCollection("subjects", { branchScoped: false });
  const { filtered: resultRows, loading: resultsLoading } = useCollection("examResults", {
    branchScoped: false,
    filters: { examId: exam.id },
  });

  const students = useMemo(() => studentsForExam(allStudents, exam), [allStudents, exam]);
  const subjects = useMemo(() => subjectsForExam(subjectRows, exam), [subjectRows, exam]);

  const [draft, setDraft] = useState({});       // { "stu|sub": {marks, absent, remarks} } — edited cells only
  const [maxDraft, setMaxDraft] = useState({}); // { subjectId: "50" }
  const [openNotes, setOpenNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const inputRefs = useRef({});

  const savedMap = useMemo(() => {
    const m = {};
    resultRows.forEach((r) => { m[cellKey(r.studentId, r.subjectId)] = r; });
    return m;
  }, [resultRows]);

  // Max marks last saved for each subject column (first saved row that has one).
  const savedColMax = useMemo(() => {
    const m = {};
    resultRows.forEach((r) => {
      const v = toNumber(r.maxMarks);
      if (v !== null && m[r.subjectId] === undefined) m[r.subjectId] = v;
    });
    return m;
  }, [resultRows]);

  const defaultMaxStr = String(toNumber(exam.totalMarks) ?? 100);
  const colMaxStr = useMemo(() => {
    const m = {};
    subjects.forEach((s) => {
      m[s.id] = maxDraft[s.id] !== undefined
        ? maxDraft[s.id]
        : savedColMax[s.id] !== undefined ? String(savedColMax[s.id]) : defaultMaxStr;
    });
    return m;
  }, [subjects, maxDraft, savedColMax, defaultMaxStr]);
  const colMax = useMemo(() => {
    const m = {};
    subjects.forEach((s) => {
      const v = toNumber(colMaxStr[s.id]);
      m[s.id] = v !== null && v > 0 ? v : null;
    });
    return m;
  }, [subjects, colMaxStr]);
  const badMaxCount = subjects.filter((s) => colMax[s.id] === null).length;

  // Everything derived per cell: current value, validation error, row to save, changed flag.
  const cells = useMemo(() => {
    const out = {};
    students.forEach((st) => {
      subjects.forEach((sb) => {
        const key = cellKey(st.id, sb.id);
        const saved = savedMap[key];
        const cell = draft[key] || savedToCell(saved);
        const max = colMax[sb.id];
        const v = cell.absent ? { ok: true, value: null, error: "" } : validateMarks(cell.marks, max);
        const remarks = (cell.remarks || "").trim();
        const hasContent = cell.absent || String(cell.marks).trim() !== "" || remarks !== "";
        const desired = {
          marksObtained: cell.absent ? null : v.value,
          maxMarks: max,
          absent: !!cell.absent,
          remarks,
        };
        let changed;
        if (!saved) changed = hasContent;
        else {
          changed = toNumber(saved.marksObtained) !== desired.marksObtained
            || !!saved.absent !== desired.absent
            || (saved.remarks || "").trim() !== desired.remarks
            || (hasContent && toNumber(saved.maxMarks) !== max);
        }
        out[key] = { cell, error: v.ok ? "" : v.error, desired, changed, student: st, subject: sb };
      });
    });
    return out;
  }, [students, subjects, savedMap, draft, colMax]);

  const changedKeys = useMemo(() => new Set(Object.keys(cells).filter((k) => cells[k].changed)), [cells]);
  const errorCount = Object.values(cells).filter((c) => c.error).length;

  // Live totals / ranks from what is currently on screen.
  const liveResults = useMemo(() => {
    const out = [];
    students.forEach((st) => {
      subjects.forEach((sb) => {
        const c = cells[cellKey(st.id, sb.id)];
        if (!c) return;
        if (c.cell.absent) out.push({ studentId: st.id, subjectId: sb.id, absent: true });
        else if (!c.error && c.desired.marksObtained !== null) {
          out.push({ studentId: st.id, subjectId: sb.id, marksObtained: c.desired.marksObtained, maxMarks: c.desired.maxMarks, absent: false });
        }
      });
    });
    return out;
  }, [students, subjects, cells]);
  const subjectIds = useMemo(() => subjects.map((s) => s.id), [subjects]);
  const ranked = useMemo(() => classResults(students, liveResults, { subjectIds }), [students, liveResults, subjectIds]);
  const stats = useMemo(() => classStats(ranked), [ranked]);

  // Once saved rows arrive, forget draft cells that now equal what is stored so a
  // later edit by someone else is not shadowed. (Refs: read latest without re-running on every keystroke.)
  const changedRef = useRef(changedKeys);
  changedRef.current = changedKeys;
  const savedColMaxRef = useRef(savedColMax);
  savedColMaxRef.current = savedColMax;
  useEffect(() => {
    setDraft((d) => {
      const keys = Object.keys(d);
      const keep = keys.filter((k) => changedRef.current.has(k));
      if (keep.length === keys.length) return d;
      const next = {};
      keep.forEach((k) => { next[k] = d[k]; });
      return next;
    });
    setMaxDraft((d) => {
      const keys = Object.keys(d);
      const keep = keys.filter((k) => toNumber(d[k]) !== savedColMaxRef.current[k]);
      if (keep.length === keys.length) return d;
      const next = {};
      keep.forEach((k) => { next[k] = d[k]; });
      return next;
    });
  }, [resultRows]);

  const dirtyCount = changedKeys.size;

  // Warn before closing the tab with unsaved marks.
  useEffect(() => {
    if (dirtyCount === 0) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  const setCell = (st, sb, patch) => {
    const key = cellKey(st.id, sb.id);
    setDraft((d) => ({ ...d, [key]: { ...(d[key] || cells[key]?.cell || EMPTY_CELL), ...patch } }));
  };

  const handleBack = () => {
    if (dirtyCount > 0 && !window.confirm(`You have ${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}. Leave without saving?`)) return;
    onBack();
  };

  const handleSave = async () => {
    if (!canEdit || saving || dirtyCount === 0) return;
    if (badMaxCount > 0) { toast.error("Enter a max mark greater than 0 for every subject"); return; }
    if (errorCount > 0) { toast.error(`Fix ${errorCount} invalid mark${errorCount === 1 ? "" : "s"} before saving`); return; }
    const rows = [...changedKeys].map((k) => {
      const c = cells[k];
      return {
        examId: exam.id,
        studentId: c.student.id,
        subjectId: c.subject.id,
        marksObtained: c.desired.marksObtained,
        maxMarks: c.desired.maxMarks,
        absent: c.desired.absent,
        remarks: c.desired.remarks,
        branchId: blankBranch(c.student.branchId),
      };
    });
    setSaving(true);
    try {
      await upsertDocs("examResults", rows, ["examId", "studentId", "subjectId"]);
      toast.success(`Saved ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`);
      logActivity("updated", "Exams", `Marks: ${exam.name} (${exam.grade}) · ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`);
    } catch (err) {
      toast.error(err?.message || "Error saving marks");
    } finally {
      setSaving(false);
    }
  };

  // Tab / Enter move DOWN a column (Shift reverses); at the end of a column they
  // continue to the next column. Absent (disabled) cells are skipped.
  const handleKeyDown = (e, r, c) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    const back = e.shiftKey;
    const rowsN = students.length;
    const colsN = subjects.length;
    let nr = r;
    let nc = c;
    for (let i = 0; i < rowsN * colsN; i++) {
      nr += back ? -1 : 1;
      if (nr >= rowsN) { nr = 0; nc += 1; } else if (nr < 0) { nr = rowsN - 1; nc -= 1; }
      if (nc < 0 || nc >= colsN) {
        if (e.key === "Enter") e.preventDefault();
        return; // Tab leaves the grid naturally
      }
      const el = inputRefs.current[`${nr}:${nc}`];
      if (el && !el.disabled) {
        e.preventDefault();
        el.focus();
        el.select();
        return;
      }
    }
  };

  const stickyCell = (extra) => ({ position: "sticky", left: 0, background: "white", zIndex: 1, ...extra });
  const loading = studentsLoading || subjectsLoading || resultsLoading;

  const header = (
    <div style={{ marginBottom: 14 }}>
      <button onClick={handleBack} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 13, padding: 0, marginBottom: 8 }}>
        <ArrowLeft size={15} /> All exams
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{exam.name}</h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span>{exam.grade}</span>
            {exam.term && <span>· {exam.term}</span>}
            <span>· {typeLabel(exam.examType)}</span>
            {exam.date && <span>· {exam.date}</span>}
            <span>· {branchName(exam.branchId)}</span>
            <PublishedPill published={exam.published} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onReportCards} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
            <FileText size={14} /> Report cards
          </button>
          {canEdit && (
            <button onClick={onTogglePublished} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
              {exam.published ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const emptyBox = (children) => (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14 }}>{children}</div>
  );

  if (loading) return <div>{header}{emptyBox("Loading…")}</div>;
  if (subjects.length === 0) {
    return (
      <div>
        {header}
        {emptyBox(<>
          <div style={{ fontWeight: 600, color: "#334155", marginBottom: 6 }}>No subjects for {exam.grade || "this class"} yet</div>
          Add subjects for this class (or for all classes) on the Subjects page first, then come back to enter marks.
        </>)}
      </div>
    );
  }
  if (students.length === 0) {
    return (
      <div>
        {header}
        {emptyBox(<>
          <div style={{ fontWeight: 600, color: "#334155", marginBottom: 6 }}>No students in {exam.grade || "this class"}</div>
          No students have class “{exam.grade}” in {branchName(exam.branchId)}. Check the exam’s class and branch, or the students’ class on the Students page.
        </>)}
      </div>
    );
  }

  const statTile = (label, value) => (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", minWidth: 100, flex: 1 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
  const pct = (v) => (v === null ? "—" : `${v}%`);

  return (
    <div>
      {header}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {statTile("Students", `${stats.count} / ${students.length}`)}
        {statTile("Average", pct(stats.average))}
        {statTile("Highest", pct(stats.highest))}
        {statTile("Lowest", pct(stats.lowest))}
        {statTile("Pass rate", pct(stats.passPercent))}
      </div>

      {!canEdit && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-muted)", background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
          You have view-only access to exam marks.
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 280 + subjects.length * 130 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={stickyCell({ ...thStyle, background: "#f8fafc", minWidth: isMobile ? 120 : 190, zIndex: 2 })}>Student</th>
                {subjects.map((s) => (
                  <th key={s.id} style={{ ...thStyle, textAlign: "center", minWidth: 120, verticalAlign: "bottom" }}>
                    <div style={{ color: "#334155", textTransform: "none", fontSize: 13 }}>{s.name}</div>
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, textTransform: "none", fontWeight: 500 }}>
                      <span>Max</span>
                      <input
                        value={colMaxStr[s.id]}
                        disabled={!canEdit}
                        inputMode="decimal"
                        aria-label={`Max marks for ${s.name}`}
                        onChange={(e) => setMaxDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                        style={{ width: 52, padding: "3px 5px", fontSize: 12, textAlign: "center", border: `1px solid ${colMax[s.id] === null ? "#ef4444" : "var(--border)"}`, borderRadius: 6 }}
                      />
                    </div>
                  </th>
                ))}
                <th style={{ ...thStyle, textAlign: "center" }}>Total</th>
                <th style={{ ...thStyle, textAlign: "center" }}>%</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Grade</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Rank</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ student: st, totals, rank, pass }, r) => (
                <tr key={st.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={stickyCell({ padding: "8px 14px", borderRight: "1px solid var(--border)" })}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{st.name}</div>
                    {st.studentId && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{st.studentId}</div>}
                  </td>
                  {subjects.map((sb, c) => {
                    const key = cellKey(st.id, sb.id);
                    const info = cells[key];
                    const { cell } = info;
                    const noteOpen = openNotes[key] || !!cell.remarks;
                    return (
                      <td key={sb.id} style={{ padding: "6px 8px", textAlign: "center", verticalAlign: "top", background: info.changed ? "#fffbeb" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <input
                            ref={(el) => { inputRefs.current[`${r}:${c}`] = el; }}
                            value={cell.absent ? "" : cell.marks}
                            placeholder={cell.absent ? "ABS" : ""}
                            disabled={!canEdit || cell.absent}
                            inputMode="decimal"
                            aria-label={`${st.name} — ${sb.name} marks`}
                            aria-invalid={!!info.error}
                            title={info.error || undefined}
                            onChange={(e) => setCell(st, sb, { marks: e.target.value })}
                            onKeyDown={(e) => handleKeyDown(e, r, c)}
                            onFocus={(e) => e.target.select()}
                            style={{
                              width: 62, padding: "7px 6px", fontSize: 14, textAlign: "center", borderRadius: 6, boxSizing: "border-box",
                              border: `1px solid ${info.error ? "#ef4444" : "var(--border)"}`,
                              background: info.error ? "#fef2f2" : cell.absent ? "#f1f5f9" : "white",
                            }}
                          />
                          {canEdit && (
                            <button type="button" onClick={() => setOpenNotes((o) => ({ ...o, [key]: !noteOpen }))} title="Remarks" tabIndex={-1}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: 2, color: cell.remarks ? "var(--primary)" : "#cbd5e1", display: "flex" }}>
                              <MessageSquare size={14} />
                            </button>
                          )}
                        </div>
                        {info.error && <div style={{ fontSize: 10, color: "#ef4444", marginTop: 2 }}>{info.error}</div>}
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--text-muted)", marginTop: 3, cursor: canEdit ? "pointer" : "default" }}>
                          <input type="checkbox" checked={cell.absent} disabled={!canEdit} tabIndex={-1}
                            onChange={(e) => setCell(st, sb, { absent: e.target.checked })} />
                          Absent
                        </label>
                        {noteOpen && (
                          <input
                            value={cell.remarks}
                            disabled={!canEdit}
                            placeholder="Remarks"
                            aria-label={`${st.name} — ${sb.name} remarks`}
                            onChange={(e) => setCell(st, sb, { remarks: e.target.value })}
                            style={{ display: "block", width: "100%", marginTop: 4, padding: "4px 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" }}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, whiteSpace: "nowrap" }}>
                    {totals.marked > 0 ? `${totals.obtained} / ${totals.max}` : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{pct(totals.percentage)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center" }}>
                    {totals.grade
                      ? <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: pass ? "#ecfdf5" : "#fef2f2", color: pass ? "#10b981" : "#ef4444" }}>{totals.grade}</span>
                      : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{rank ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Tab / Enter moves down a column. Absent and blank cells are left out of totals; they do not count as zero.
      </div>

      {canEdit && (
        <div style={{ position: "sticky", bottom: 0, marginTop: 14, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", boxShadow: "0 -2px 8px rgba(0,0,0,0.04)", zIndex: 5 }}>
          <div style={{ fontSize: 13, color: errorCount || badMaxCount ? "#ef4444" : "var(--text-muted)" }}>
            {errorCount > 0
              ? `${errorCount} invalid mark${errorCount === 1 ? "" : "s"} — fix before saving`
              : badMaxCount > 0
                ? "Enter a max mark greater than 0 for every subject"
                : dirtyCount > 0
                  ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`
                  : "All changes saved"}
          </div>
          <button onClick={handleSave} disabled={saving || dirtyCount === 0 || errorCount > 0 || badMaxCount > 0}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: saving || dirtyCount === 0 || errorCount > 0 || badMaxCount > 0 ? 0.5 : 1 }}>
            <Save size={15} /> {saving ? "Saving…" : "Save marks"}
          </button>
        </div>
      )}
    </div>
  );
}
