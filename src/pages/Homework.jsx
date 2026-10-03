import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, addDoc, updateDoc, deleteDoc, doc, collection, upsertDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import { logActivity } from "../utils/auditLog";
import { exportToCSV } from "../utils/exportUtils";
import { uploadReceipt } from "../lib/storage";
import { formatDate } from "../utils/dates";
import {
  SUBMISSION_STATUSES, SUBMISSION_STATUS_LABELS,
  todayStr, isOverdue, deriveClasses, appliesToClass, subjectsForGrade, subjectLabel,
  normalizeBranch, rosterFor, paginate,
  deriveSubmissionStatus, applyStatusChange, applyDateChange,
  validateMarks, draftFromSubmission, draftChanged, buildSubmissionRow,
  completionStats, assignmentState, buildAssignmentStats,
  validateAssignmentForm, safeHref, safeFileName,
} from "../utils/learning";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, X, Download, ArrowLeft, Paperclip, ClipboardList, Upload, Save } from "lucide-react";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const fieldStyle = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };
const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };
const errStyle = { color: "var(--danger)", fontSize: 12, marginTop: 4 };
const ghostBtn = { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 };
const iconBtn = (bg, color, pad = "6px 9px") => ({ border: "none", background: bg, color, padding: pad, borderRadius: 8, cursor: "pointer" });
const card = { background: "white", borderRadius: 12, border: "1px solid var(--border)" };

const STATUS_STYLE = {
  pending: { background: "#f1f5f9", color: "#475569" },
  submitted: { background: "#eff6ff", color: "#2563eb" },
  late: { background: "#fffbeb", color: "#d97706" },
  graded: { background: "#ecfdf5", color: "#059669" },
  missing: { background: "#fef2f2", color: "#dc2626" },
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function Pill({ style, children }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

function StatusPill({ status }) {
  return <Pill style={STATUS_STYLE[status]}>{SUBMISSION_STATUS_LABELS[status]}</Pill>;
}

function ProgressBar({ stats }) {
  const pct = stats ? stats.percent : 0;
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        {stats && stats.total > 0 ? `${stats.handedIn} of ${stats.total}` : "No students"}
        {stats && stats.total > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {pct}%</span>}
      </div>
      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%`, height: "100%", background: stats && stats.complete ? "var(--success)" : "var(--primary)" }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit assignment modal
// ---------------------------------------------------------------------------
const emptyForm = (branchId) => ({
  title: "", description: "", grade: "", subjectId: "", assignedDate: todayStr(),
  dueDate: "", maxMarks: "", attachmentUrl: "", branchId,
});

function AssignmentModal({ editing, classes, subjects, branches, defaultBranch, isMobile, onClose }) {
  const [form, setForm] = useState(() => editing
    ? {
        title: editing.title || "", description: editing.description || "", grade: editing.grade || "",
        subjectId: editing.subjectId || "", assignedDate: editing.assignedDate || "", dueDate: editing.dueDate || "",
        maxMarks: editing.maxMarks === null || editing.maxMarks === undefined ? "" : String(editing.maxMarks),
        attachmentUrl: editing.attachmentUrl || "", branchId: normalizeBranch(editing.branchId),
      }
    : emptyForm(defaultBranch));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const subjectOptions = useMemo(
    () => subjectsForGrade(subjects, form.grade, form.branchId),
    [subjects, form.grade, form.branchId]
  );

  // Changing class/branch may make the chosen subject unavailable.
  const changeScope = (key, value) => setForm((p) => {
    const next = { ...p, [key]: value };
    const stillOk = subjectsForGrade(subjects, next.grade, next.branchId).some((s) => s.id === next.subjectId);
    return stillOk ? next : { ...next, subjectId: "" };
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { toast.error("File is too large (max 10 MB)"); return; }
    setUploading(true);
    try {
      const safe = new File([file], safeFileName(file.name), { type: file.type });
      const url = await uploadReceipt(safe);
      set("attachmentUrl", url);
      toast.success("File uploaded");
    } catch (err) {
      toast.error(err?.message || "Upload failed");
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || uploading) return;
    const result = validateAssignmentForm(form);
    setErrors(result.errors);
    if (!result.ok) { toast.error("Please fix the highlighted fields"); return; }

    if (editing && (form.grade.trim() !== String(editing.grade || "").trim() || normalizeBranch(form.branchId) !== normalizeBranch(editing.branchId))) {
      if (!window.confirm("Changing the class or branch changes which students this homework applies to. Continue?")) return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      subjectId: form.subjectId || "",
      grade: form.grade.trim(),
      assignedDate: form.assignedDate || "",
      dueDate: form.dueDate || "",
      maxMarks: result.values.maxMarks,
      attachmentUrl: result.values.attachmentUrl,
      branchId: normalizeBranch(form.branchId),
    };
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "assignments", editing.id), payload);
        toast.success("Homework updated");
        logActivity("updated", "Homework", `${payload.title} (${payload.grade})`);
      } else {
        await addDoc(collection(db, "assignments"), payload);
        toast.success("Homework created");
        logActivity("created", "Homework", `${payload.title} (${payload.grade})`);
      }
      onClose();
    } catch (err) {
      toast.error(err?.message || "Error saving homework");
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
      <div role="dialog" aria-modal="true" style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : 600, maxHeight: "92vh", overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>{editing ? "Edit Homework" : "New Homework"}</h3>
          <button aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Title *</label>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Chapter 3 exercises" style={fieldStyle} />
              {errors.title && <div style={errStyle}>{errors.title}</div>}
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Description</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Instructions for students" style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }} />
            </div>
            <div>
              <label style={labelStyle}>Class *</label>
              <select value={form.grade} onChange={(e) => changeScope("grade", e.target.value)} style={fieldStyle}>
                <option value="">Select class…</option>
                {deriveClasses(classes.map((g) => ({ grade: g })), [{ grade: form.grade }]).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              {errors.grade && <div style={errStyle}>{errors.grade}</div>}
            </div>
            <div>
              <label style={labelStyle}>Subject</label>
              <select value={form.subjectId} onChange={(e) => set("subjectId", e.target.value)} style={fieldStyle}>
                <option value="">No subject</option>
                {subjectOptions.map((s) => <option key={s.id} value={s.id}>{subjectLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Assigned date</label>
              <input type="date" value={form.assignedDate} onChange={(e) => set("assignedDate", e.target.value)} style={fieldStyle} />
              {errors.assignedDate && <div style={errStyle}>{errors.assignedDate}</div>}
            </div>
            <div>
              <label style={labelStyle}>Due date</label>
              <input type="date" value={form.dueDate} min={form.assignedDate || undefined} onChange={(e) => set("dueDate", e.target.value)} style={fieldStyle} />
              {errors.dueDate && <div style={errStyle}>{errors.dueDate}</div>}
            </div>
            <div>
              <label style={labelStyle}>Max marks</label>
              <input type="number" min="0" step="any" value={form.maxMarks} onChange={(e) => set("maxMarks", e.target.value)} placeholder="Leave blank if not graded" style={fieldStyle} />
              {errors.maxMarks && <div style={errStyle}>{errors.maxMarks}</div>}
            </div>
            <div>
              <label style={labelStyle}>Branch</label>
              <select value={form.branchId} onChange={(e) => changeScope("branchId", e.target.value)} style={fieldStyle}>
                <option value="">Main Office</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Attachment</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={form.attachmentUrl} onChange={(e) => set("attachmentUrl", e.target.value)} placeholder="Paste a link (https://…) or upload a file" style={fieldStyle} />
                <input ref={fileRef} type="file" onChange={handleFile} style={{ display: "none" }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ ...ghostBtn, whiteSpace: "nowrap", opacity: uploading ? 0.6 : 1 }}>
                  <Upload size={14} /> {uploading ? "Uploading…" : "Upload"}
                </button>
              </div>
              {errors.attachmentUrl && <div style={errStyle}>{errors.attachmentUrl}</div>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
            <button type="submit" disabled={saving || uploading}
              style={{ flex: 2, padding: 11, background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "wait" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving || uploading ? 0.7 : 1 }}>
              {saving ? "Saving…" : editing ? "Update Homework" : "Create Homework"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment detail: class roster with per-student submission rows
// ---------------------------------------------------------------------------
function AssignmentDetail({ assignment, students, submissions, subjectName, canEdit, isMobile, onBack, onEdit }) {
  const today = todayStr();
  const [drafts, setDrafts] = useState({});
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const roster = useMemo(() => rosterFor(students, assignment), [students, assignment]);
  const subBySid = useMemo(() => {
    const m = new Map();
    for (const s of submissions) m.set(String(s.studentId), s);
    return m;
  }, [submissions]);

  const currentDraft = (sid) => drafts[sid] || draftFromSubmission(subBySid.get(String(sid)));
  const displayStatus = (sid) => {
    const d = currentDraft(sid);
    return deriveSubmissionStatus({ status: d.status, submittedDate: d.submittedDate }, assignment.dueDate, today);
  };
  const marksCheck = (sid) => validateMarks(currentDraft(sid).marks, assignment.maxMarks);

  const dirtyIds = roster
    .filter((s) => drafts[s.id] && draftChanged(subBySid.get(String(s.id)), drafts[s.id]))
    .map((s) => s.id);

  // Progress reflects stored data plus unsaved edits.
  const liveStats = useMemo(() => {
    const merged = roster.map((s) => {
      const d = drafts[s.id] || draftFromSubmission(subBySid.get(String(s.id)));
      return { studentId: s.id, status: d.status, submittedDate: d.submittedDate };
    });
    return completionStats(roster, merged, assignment.dueDate, today);
  }, [roster, drafts, subBySid, assignment.dueDate, today]);

  const update = (sid, fn) => setDrafts((prev) => ({ ...prev, [sid]: fn(prev[sid] || draftFromSubmission(subBySid.get(String(sid)))) }));
  const onStatus = (sid, v) => update(sid, (d) => applyStatusChange(d, v, assignment.dueDate, today));
  const onDate = (sid, v) => update(sid, (d) => applyDateChange(d, v, assignment.dueDate));
  const onFeedback = (sid, v) => update(sid, (d) => ({ ...d, feedback: v }));
  const onMarks = (sid, v) => update(sid, (d) => {
    const next = { ...d, marks: v };
    // Entering marks for work that was pending/missing means it was handed in and graded.
    if (String(v).trim() !== "" && (d.status === "pending" || d.status === "missing")) {
      return applyStatusChange(next, "graded", assignment.dueDate, today);
    }
    return next;
  });

  const handleBack = () => {
    if (dirtyIds.length > 0 && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onBack();
  };

  const handleSave = async () => {
    if (dirtyIds.length === 0 || saving) return;
    const bad = dirtyIds.filter((id) => !marksCheck(id).ok);
    if (bad.length) {
      toast.error(`Fix marks for ${bad.length} student${bad.length === 1 ? "" : "s"} (0 to ${assignment.maxMarks || "—"})`);
      return;
    }
    const byId = new Map(roster.map((s) => [s.id, s]));
    const rows = dirtyIds.map((id) => buildSubmissionRow({
      assignmentId: assignment.id,
      student: byId.get(id),
      draft: drafts[id],
      maxMarks: assignment.maxMarks,
    }));
    setSaving(true);
    try {
      await upsertDocs("submissions", rows, ["assignmentId", "studentId"]);
      toast.success(`Saved ${rows.length} submission${rows.length === 1 ? "" : "s"}`);
      logActivity("updated", "Homework", `Submissions for "${assignment.title}" (${rows.length} student${rows.length === 1 ? "" : "s"})`);
      // Drafts stay until the realtime snapshot catches up; once they equal the
      // stored row they stop counting as unsaved.
    } catch (err) {
      toast.error(err?.message || "Error saving submissions");
    } finally { setSaving(false); }
  };

  const visible = roster.filter((s) => {
    const q = rosterSearch.trim().toLowerCase();
    if (q && !`${s.name || ""} ${s.studentId || ""}`.toLowerCase().includes(q)) return false;
    if (rosterStatus && displayStatus(s.id) !== rosterStatus) return false;
    return true;
  });

  const handleCSV = () => exportToCSV(`homework-${assignment.title}`,
    ["Student ID", "Name", "Status", "Submitted", "Marks", "Max", "Feedback"],
    roster.map((s) => {
      const d = currentDraft(s.id);
      return [s.studentId, s.name, SUBMISSION_STATUS_LABELS[displayStatus(s.id)], d.submittedDate, d.marks, assignment.maxMarks ?? "", d.feedback];
    })
  );

  const href = safeHref(assignment.attachmentUrl);
  const overdue = isOverdue(assignment.dueDate, today);
  const inputStyle = (invalid) => ({ ...fieldStyle, padding: "7px 9px", fontSize: 13, borderColor: invalid ? "var(--danger)" : "var(--border)" });

  return (
    <div>
      <button onClick={handleBack} style={{ ...ghostBtn, marginBottom: 12 }}><ArrowLeft size={14} /> All homework</button>

      <div style={{ ...card, padding: isMobile ? 16 : 20, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 700, wordBreak: "break-word" }}>{assignment.title}</h2>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span>{assignment.grade || "All classes"}</span>
              {subjectName && <span>· {subjectName}</span>}
              <span>· Assigned {assignment.assignedDate ? formatDate(assignment.assignedDate) : "—"}</span>
              <span>· Due {assignment.dueDate ? formatDate(assignment.dueDate) : "no due date"}</span>
              {overdue && !liveStats.complete && <Pill style={{ background: "#fef2f2", color: "#dc2626" }}>Overdue</Pill>}
              {assignment.maxMarks ? <span>· Max {assignment.maxMarks} marks</span> : null}
            </div>
            {assignment.description && <p style={{ fontSize: 13, marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{assignment.description}</p>}
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 13, color: "var(--primary)", fontWeight: 500 }}>
                <Paperclip size={13} /> Open attachment
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!isMobile && <button onClick={handleCSV} style={ghostBtn}><Download size={14} /> CSV</button>}
            {canEdit && <button onClick={onEdit} style={ghostBtn}><Edit2 size={14} /> Edit</button>}
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 200px", maxWidth: 320 }}><ProgressBar stats={liveStats} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SUBMISSION_STATUSES.map((st) => (
              <Pill key={st} style={STATUS_STYLE[st]}>{SUBMISSION_STATUS_LABELS[st]}: {liveStats[st]}</Pill>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder="Search student…" aria-label="Search student"
          style={{ ...fieldStyle, flex: 1, minWidth: 160, width: "auto", padding: "8px 10px", fontSize: 13 }} />
        <select value={rosterStatus} onChange={(e) => setRosterStatus(e.target.value)} aria-label="Filter by status"
          style={{ ...fieldStyle, width: "auto", padding: "8px 10px", fontSize: 13 }}>
          <option value="">All statuses</option>
          {SUBMISSION_STATUSES.map((st) => <option key={st} value={st}>{SUBMISSION_STATUS_LABELS[st]}</option>)}
        </select>
        {canEdit && (
          <>
            {dirtyIds.length > 0 && (
              <button onClick={() => setDrafts({})} disabled={saving} style={ghostBtn}>Discard</button>
            )}
            <button onClick={handleSave} disabled={dirtyIds.length === 0 || saving}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: dirtyIds.length === 0 || saving ? "not-allowed" : "pointer", opacity: dirtyIds.length === 0 || saving ? 0.5 : 1 }}>
              <Save size={14} /> {saving ? "Saving…" : dirtyIds.length ? `Save changes (${dirtyIds.length})` : "Save changes"}
            </button>
          </>
        )}
      </div>

      {roster.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontWeight: 600, color: "#334155" }}>No students in this class</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            No students are enrolled in {assignment.grade || "any class"} for this branch, so there is nothing to track yet.
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div style={{ ...card, padding: 30, textAlign: "center", color: "var(--text-muted)" }}>No students match.</div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((s) => {
            const d = currentDraft(s.id);
            const mc = marksCheck(s.id);
            return (
              <div key={s.id} style={{ ...card, padding: 14, borderColor: dirtyIds.includes(s.id) ? "var(--primary)" : "var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{s.studentId}</div>
                  </div>
                  <StatusPill status={displayStatus(s.id)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 12 }}>Status</label>
                    <select value={d.status} disabled={!canEdit} onChange={(e) => onStatus(s.id, e.target.value)} style={inputStyle(false)}>
                      {SUBMISSION_STATUSES.map((st) => <option key={st} value={st}>{SUBMISSION_STATUS_LABELS[st]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 12 }}>Submitted</label>
                    <input type="date" value={d.submittedDate} disabled={!canEdit} onChange={(e) => onDate(s.id, e.target.value)} style={inputStyle(false)} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 12 }}>Marks{assignment.maxMarks ? ` / ${assignment.maxMarks}` : ""}</label>
                    <input type="number" inputMode="decimal" step="any" min="0" value={d.marks} disabled={!canEdit} onChange={(e) => onMarks(s.id, e.target.value)} style={inputStyle(!mc.ok)} />
                    {!mc.ok && <div style={errStyle}>{mc.error}</div>}
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 12 }}>Feedback</label>
                    <input value={d.feedback} disabled={!canEdit} onChange={(e) => onFeedback(s.id, e.target.value)} style={inputStyle(false)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Student", "Status", "Submitted", `Marks${assignment.maxMarks ? ` / ${assignment.maxMarks}` : ""}`, "Feedback"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const d = currentDraft(s.id);
                  const mc = marksCheck(s.id);
                  const ds = displayStatus(s.id);
                  return (
                    <tr key={s.id} style={{ borderTop: "1px solid var(--border)", background: dirtyIds.includes(s.id) ? "var(--primary-light)" : undefined, verticalAlign: "top" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{s.studentId}</div>
                      </td>
                      <td style={{ padding: "10px 14px", width: 170 }}>
                        <select value={d.status} disabled={!canEdit} onChange={(e) => onStatus(s.id, e.target.value)} aria-label={`Status for ${s.name}`} style={inputStyle(false)}>
                          {SUBMISSION_STATUSES.map((st) => <option key={st} value={st}>{SUBMISSION_STATUS_LABELS[st]}</option>)}
                        </select>
                        {ds !== d.status && <div style={{ marginTop: 4 }}><StatusPill status={ds} /></div>}
                      </td>
                      <td style={{ padding: "10px 14px", width: 150 }}>
                        <input type="date" value={d.submittedDate} disabled={!canEdit} onChange={(e) => onDate(s.id, e.target.value)} aria-label={`Submitted date for ${s.name}`} style={inputStyle(false)} />
                      </td>
                      <td style={{ padding: "10px 14px", width: 110 }}>
                        <input type="number" inputMode="decimal" step="any" min="0" value={d.marks} disabled={!canEdit} onChange={(e) => onMarks(s.id, e.target.value)} aria-label={`Marks for ${s.name}`} style={inputStyle(!mc.ok)} />
                        {!mc.ok && <div style={errStyle}>{mc.error}</div>}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <input value={d.feedback} disabled={!canEdit} onChange={(e) => onFeedback(s.id, e.target.value)} placeholder={canEdit ? "Feedback…" : ""} aria-label={`Feedback for ${s.name}`} style={inputStyle(false)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const STATE_LABELS = { open: "Open", overdue: "Overdue", complete: "Complete" };
const STATE_STYLE = {
  open: { background: "#eff6ff", color: "#2563eb" },
  overdue: { background: "#fef2f2", color: "#dc2626" },
  complete: { background: "#ecfdf5", color: "#059669" },
};

export default function Homework() {
  const { branches, activeBranch } = useBranch();
  const { can } = useUser();
  const canEdit = can("canEditLearning");
  const isMobile = useIsMobile();
  const today = todayStr();

  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterState, setFilterState] = useState("");
  const [sortField, setSortField] = useState("dueDate");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [modal, setModal] = useState(null); // null | { editing: assignment|null }
  const [openId, setOpenId] = useState(null);

  const { rows, filtered: searched, loading } = useCollection("assignments", {
    activeBranch,
    search,
    searchFields: ["title", "description"],
    sortBy: sortField,
    sortDir,
    pageSize: 100000,
  });
  const { rows: students, loading: loadingStudents } = useCollection("students", { pageSize: 100000 });
  const { rows: subjects } = useCollection("subjects", { pageSize: 100000 });
  const { rows: submissions, loading: loadingSubs } = useCollection("submissions", { pageSize: 100000 });

  const classes = useMemo(() => deriveClasses(students, rows, subjects), [students, rows, subjects]);
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const subjectFilterOptions = useMemo(
    () => subjectsForGrade(subjects, filterGrade).map((s) => ({
      value: s.id,
      label: `${subjectLabel(s)}${!filterGrade && s.grade ? ` · ${s.grade}` : ""}`,
    })),
    [subjects, filterGrade]
  );

  const classMatches = useMemo(
    () => searched.filter((a) =>
      appliesToClass(a.grade, filterGrade) && (!filterSubject || a.subjectId === filterSubject)),
    [searched, filterGrade, filterSubject]
  );
  const statsMap = useMemo(
    () => buildAssignmentStats(classMatches, students, submissions, today),
    [classMatches, students, submissions, today]
  );
  const stateOf = (a) => assignmentState(a, statsMap.get(a.id), today);
  const filtered = useMemo(
    () => (filterState ? classMatches.filter((a) => assignmentState(a, statsMap.get(a.id), today) === filterState) : classMatches),
    [classMatches, filterState, statsMap, today]
  );
  const { items: paged, page: safePage, pageCount, total } = paginate(filtered, page, pageSize);

  useEffect(() => { setPage(1); }, [search, filterGrade, filterSubject, filterState, pageSize, activeBranch, sortField, sortDir]);

  const active = !!(search || filterGrade || filterSubject || filterState);
  const clearAll = () => { setSearch(""); setFilterGrade(""); setFilterSubject(""); setFilterState(""); };
  const subjectName = (id) => subjectLabel(subjectById.get(id)) || "";
  const defaultBranch = activeBranch === "all" || activeBranch === "main" ? "" : activeBranch;

  const handleDelete = async (a) => {
    if (!window.confirm(`Delete homework "${a.title}"? You can restore it from Trash.`)) return;
    try {
      await deleteDoc(doc(db, "assignments", a.id));
      toast.success("Homework moved to Trash");
      logActivity("deleted", "Homework", `${a.title} (${a.grade || "all classes"})`);
      if (openId === a.id) setOpenId(null);
    } catch (err) { toast.error(err?.message || "Error deleting homework"); }
  };

  const handleCSV = () => exportToCSV("homework",
    ["Title", "Class", "Subject", "Assigned", "Due", "Handed in", "Total", "Max marks"],
    filtered.map((a) => {
      const st = statsMap.get(a.id);
      return [a.title, a.grade || "All classes", subjectName(a.subjectId), a.assignedDate, a.dueDate, st ? st.handedIn : 0, st ? st.total : 0, a.maxMarks ?? ""];
    })
  );

  const openAssignment = openId ? rows.find((a) => a.id === openId) : null;
  // Left an open assignment that was deleted elsewhere.
  useEffect(() => {
    if (openId && !loading && !openAssignment) setOpenId(null);
  }, [openId, loading, openAssignment]);

  const modalEl = modal && (
    <AssignmentModal
      key={modal.editing ? modal.editing.id : "new"}
      editing={modal.editing}
      classes={classes}
      subjects={subjects}
      branches={branches}
      defaultBranch={defaultBranch}
      isMobile={isMobile}
      onClose={() => setModal(null)}
    />
  );

  if (openAssignment) {
    return (
      <>
        <AssignmentDetail
          key={openAssignment.id}
          assignment={openAssignment}
          students={students}
          submissions={submissions.filter((s) => String(s.assignmentId) === String(openAssignment.id))}
          subjectName={subjectName(openAssignment.subjectId)}
          canEdit={canEdit}
          isMobile={isMobile}
          onBack={() => setOpenId(null)}
          onEdit={() => setModal({ editing: openAssignment })}
        />
        {modalEl}
      </>
    );
  }

  const isLoading = loading || loadingStudents || loadingSubs;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Homework <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <button onClick={handleCSV} style={ghostBtn}><Download size={14} /> CSV</button>}
          {canEdit && (
            <button onClick={() => setModal({ editing: null })}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Plus size={15} /> New Homework
            </button>
          )}
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search title or description..."
        filters={[
          { key: "grade", value: filterGrade, onChange: (v) => { setFilterGrade(v); setFilterSubject(""); }, placeholder: "All Classes", options: classes.map((g) => ({ value: g, label: g })) },
          { key: "subject", value: filterSubject, onChange: setFilterSubject, placeholder: "All Subjects", options: subjectFilterOptions },
          { key: "state", value: filterState, onChange: setFilterState, placeholder: "All Status", options: Object.keys(STATE_LABELS).map((k) => ({ value: k, label: STATE_LABELS[k] })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "dueDate", label: "Due date" },
            { value: "assignedDate", label: "Assigned date" },
            { value: "title", label: "Title" },
            { value: "grade", label: "Class" },
          ],
        }}
        active={active}
        onClear={clearAll}
      />

      {isLoading ? (
        <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading homework…</div>
      ) : total === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          <ClipboardList size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "#334155" }}>{rows.length === 0 ? "No homework yet" : "No homework matches your filters"}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {rows.length === 0
              ? (canEdit ? "Create an assignment to start tracking submissions for a class." : "Homework will appear here once it is assigned.")
              : "Try clearing the search or filters."}
          </div>
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((a) => {
            const st = statsMap.get(a.id);
            const state = stateOf(a);
            return (
              <div key={a.id} onClick={() => setOpenId(a.id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setOpenId(a.id); }}
                style={{ ...card, padding: 16, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, wordBreak: "break-word" }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {a.grade || "All classes"}{a.subjectId && subjectName(a.subjectId) ? ` · ${subjectName(a.subjectId)}` : ""}
                    </div>
                  </div>
                  <Pill style={STATE_STYLE[state]}>{STATE_LABELS[state]}</Pill>
                </div>
                <div style={{ fontSize: 12, marginBottom: 10 }}>
                  Due <strong>{a.dueDate ? formatDate(a.dueDate) : "—"}</strong>
                </div>
                <ProgressBar stats={st} />
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    <button aria-label={`Edit ${a.title}`} onClick={() => setModal({ editing: a })} style={iconBtn("var(--primary-light)", "var(--primary)", "7px 9px")}><Edit2 size={14} /></button>
                    <button aria-label={`Delete ${a.title}`} onClick={() => handleDelete(a)} style={iconBtn("#fef2f2", "var(--danger)", "7px 9px")}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Title", "Class", "Subject", "Assigned", "Due", "Progress", "Status", "Actions"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((a) => {
                  const st = statsMap.get(a.id);
                  const state = stateOf(a);
                  return (
                    <tr key={a.id} onClick={() => setOpenId(a.id)} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                      <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500, maxWidth: 260 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{a.grade || "All classes"}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13 }}>{subjectName(a.subjectId) || "—"}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{a.assignedDate ? formatDate(a.assignedDate) : "—"}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{a.dueDate ? formatDate(a.dueDate) : "—"}</td>
                      <td style={{ padding: "11px 14px" }}><ProgressBar stats={st} /></td>
                      <td style={{ padding: "11px 14px" }}><Pill style={STATE_STYLE[state]}>{STATE_LABELS[state]}</Pill></td>
                      <td style={{ padding: "11px 14px" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setOpenId(a.id)} style={{ ...ghostBtn, padding: "5px 10px", fontSize: 12 }}>Open</button>
                          {canEdit && (
                            <>
                              <button aria-label={`Edit ${a.title}`} onClick={() => setModal({ editing: a })} style={iconBtn("var(--primary-light)", "var(--primary)")}><Edit2 size={13} /></button>
                              <button aria-label={`Delete ${a.title}`} onClick={() => handleDelete(a)} style={iconBtn("#fef2f2", "var(--danger)")}><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {modalEl}
    </div>
  );
}
