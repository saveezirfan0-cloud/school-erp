import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, addDoc, updateDoc, deleteDoc, doc, collection } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import { logActivity } from "../utils/auditLog";
import { uploadReceipt } from "../lib/storage";
import {
  MATERIAL_KINDS, MATERIAL_KIND_LABELS,
  deriveClasses, appliesToClass, subjectsForGrade, subjectLabel, normalizeBranch, paginate,
  validateMaterialForm, safeHref, safeFileName,
} from "../utils/learning";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, X, FileText, Link2, File as FileIcon, Video, ExternalLink, Upload, Library } from "lucide-react";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const fieldStyle = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };
const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };
const errStyle = { color: "var(--danger)", fontSize: 12, marginTop: 4 };
const ghostBtn = { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 };
const iconBtn = (bg, color) => ({ border: "none", background: bg, color, padding: "6px 9px", borderRadius: 8, cursor: "pointer" });

const KIND_ICON = { note: FileText, link: Link2, file: FileIcon, video: Video };
const KIND_STYLE = {
  note: { background: "#f1f5f9", color: "#475569" },
  link: { background: "#eff6ff", color: "#2563eb" },
  file: { background: "#fffbeb", color: "#d97706" },
  video: { background: "#fdf2f8", color: "#be185d" },
};
const OPEN_LABEL = { note: "Open link", link: "Open link", file: "Open file", video: "Watch video" };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

const emptyForm = (branchId) => ({ title: "", description: "", kind: "link", url: "", subjectId: "", grade: "", branchId });

function MaterialModal({ editing, classes, subjects, branches, defaultBranch, isMobile, onClose }) {
  const [form, setForm] = useState(() => editing
    ? {
        title: editing.title || "", description: editing.description || "", kind: MATERIAL_KINDS.includes(editing.kind) ? editing.kind : "link",
        url: editing.url || "", subjectId: editing.subjectId || "", grade: editing.grade || "", branchId: normalizeBranch(editing.branchId),
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
      setForm((p) => ({ ...p, url, title: p.title || file.name.replace(/\.[^.]+$/, "") }));
      toast.success("File uploaded");
    } catch (err) {
      toast.error(err?.message || "Upload failed");
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || uploading) return;
    const result = validateMaterialForm(form);
    setErrors(result.errors);
    if (!result.ok) { toast.error("Please fix the highlighted fields"); return; }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      kind: result.values.kind,
      url: result.values.url,
      subjectId: form.subjectId || "",
      grade: form.grade.trim(),
      branchId: normalizeBranch(form.branchId),
    };
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "materials", editing.id), payload);
        toast.success("Material updated");
        logActivity("updated", "Materials", `${payload.title} (${payload.grade || "all classes"})`);
      } else {
        await addDoc(collection(db, "materials"), payload);
        toast.success("Material added");
        logActivity("created", "Materials", `${payload.title} (${payload.grade || "all classes"})`);
      }
      onClose();
    } catch (err) {
      toast.error(err?.message || "Error saving material");
    } finally { setSaving(false); }
  };

  const needsUrl = form.kind !== "note";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
      <div role="dialog" aria-modal="true" style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : 580, maxHeight: "92vh", overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>{editing ? "Edit Material" : "Add Material"}</h3>
          <button aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Type *</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }} role="radiogroup" aria-label="Material type">
                {MATERIAL_KINDS.map((k) => {
                  const Icon = KIND_ICON[k];
                  const on = form.kind === k;
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set("kind", k)}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 4px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                        border: on ? "1.5px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary-light)" : "white", color: on ? "var(--primary)" : "#475569" }}>
                      <Icon size={16} /> {MATERIAL_KIND_LABELS[k]}
                    </button>
                  );
                })}
              </div>
              {errors.kind && <div style={errStyle}>{errors.kind}</div>}
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Title *</label>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Fractions revision notes" style={fieldStyle} />
              {errors.title && <div style={errStyle}>{errors.title}</div>}
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>{form.kind === "note" ? "Note" : "Description"}</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={form.kind === "note" ? 5 : 3}
                placeholder={form.kind === "note" ? "Write the note here" : "What is this for?"} style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }} />
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>{form.kind === "video" ? "Video link" : form.kind === "file" ? "File link" : "Link"}{needsUrl ? " *" : " (optional)"}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" inputMode="url" autoCapitalize="none" style={fieldStyle} />
                {form.kind === "file" && (
                  <>
                    <input ref={fileRef} type="file" onChange={handleFile} style={{ display: "none" }} />
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                      style={{ ...ghostBtn, whiteSpace: "nowrap", opacity: uploading ? 0.6 : 1 }}>
                      <Upload size={14} /> {uploading ? "Uploading…" : "Upload"}
                    </button>
                  </>
                )}
              </div>
              {form.kind === "file" && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Upload a file (max 10 MB) or paste a link to one.</div>}
              {errors.url && <div style={errStyle}>{errors.url}</div>}
            </div>
            <div>
              <label style={labelStyle}>Class</label>
              <select value={form.grade} onChange={(e) => changeScope("grade", e.target.value)} style={fieldStyle}>
                <option value="">All classes</option>
                {deriveClasses(classes.map((g) => ({ grade: g })), [{ grade: form.grade }]).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Subject</label>
              <select value={form.subjectId} onChange={(e) => set("subjectId", e.target.value)} style={fieldStyle}>
                <option value="">No subject</option>
                {subjectOptions.map((s) => <option key={s.id} value={s.id}>{subjectLabel(s)}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
              <label style={labelStyle}>Branch</label>
              <select value={form.branchId} onChange={(e) => changeScope("branchId", e.target.value)} style={fieldStyle}>
                <option value="">Main Office</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
            <button type="submit" disabled={saving || uploading}
              style={{ flex: 2, padding: 11, background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "wait" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving || uploading ? 0.7 : 1 }}>
              {saving ? "Saving…" : editing ? "Update Material" : "Add Material"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Materials() {
  const { branches, activeBranch } = useBranch();
  const { can } = useUser();
  const canEdit = can("canEditLearning");
  const isMobile = useIsMobile();

  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [sortField, setSortField] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [modal, setModal] = useState(null); // null | { editing: material|null }

  const { rows, filtered: searched, loading } = useCollection("materials", {
    activeBranch,
    search,
    searchFields: ["title", "description"],
    sortBy: sortField,
    sortDir,
    pageSize: 100000,
  });
  const { rows: students } = useCollection("students", { pageSize: 100000 });
  const { rows: subjects } = useCollection("subjects", { pageSize: 100000 });

  const classes = useMemo(() => deriveClasses(students, rows, subjects), [students, rows, subjects]);
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const subjectFilterOptions = useMemo(
    () => subjectsForGrade(subjects, filterGrade).map((s) => ({
      value: s.id,
      label: `${subjectLabel(s)}${!filterGrade && s.grade ? ` · ${s.grade}` : ""}`,
    })),
    [subjects, filterGrade]
  );

  const filtered = useMemo(
    () => searched.filter((m) =>
      appliesToClass(m.grade, filterGrade) &&
      (!filterSubject || m.subjectId === filterSubject) &&
      (!filterKind || m.kind === filterKind)),
    [searched, filterGrade, filterSubject, filterKind]
  );
  const { items: paged, page: safePage, pageCount, total } = paginate(filtered, page, pageSize);

  useEffect(() => { setPage(1); }, [search, filterGrade, filterSubject, filterKind, pageSize, activeBranch, sortField, sortDir]);

  const active = !!(search || filterGrade || filterSubject || filterKind);
  const clearAll = () => { setSearch(""); setFilterGrade(""); setFilterSubject(""); setFilterKind(""); };
  const defaultBranch = activeBranch === "all" || activeBranch === "main" ? "" : activeBranch;

  const handleDelete = async (m) => {
    if (!window.confirm(`Delete "${m.title}"? You can restore it from Trash.`)) return;
    try {
      await deleteDoc(doc(db, "materials", m.id));
      toast.success("Material moved to Trash");
      logActivity("deleted", "Materials", `${m.title} (${m.grade || "all classes"})`);
    } catch (err) { toast.error(err?.message || "Error deleting material"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Learning Materials <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        {canEdit && (
          <button onClick={() => setModal({ editing: null })}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={15} /> Add Material
          </button>
        )}
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search title or description..."
        filters={[
          { key: "grade", value: filterGrade, onChange: (v) => { setFilterGrade(v); setFilterSubject(""); }, placeholder: "All Classes", options: classes.map((g) => ({ value: g, label: g })) },
          { key: "subject", value: filterSubject, onChange: setFilterSubject, placeholder: "All Subjects", options: subjectFilterOptions },
          { key: "kind", value: filterKind, onChange: setFilterKind, placeholder: "All Types", options: MATERIAL_KINDS.map((k) => ({ value: k, label: MATERIAL_KIND_LABELS[k] })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "createdAt", label: "Date added" },
            { value: "title", label: "Title" },
            { value: "kind", label: "Type" },
          ],
        }}
        active={active}
        onClear={clearAll}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>Loading materials…</div>
      ) : total === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
          <Library size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "#334155" }}>{rows.length === 0 ? "No learning materials yet" : "No materials match your filters"}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {rows.length === 0
              ? (canEdit ? "Share notes, links, files and videos with a class." : "Materials will appear here once they are shared.")
              : "Try clearing the search or filters."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(270px, 1fr))", gap: 14 }}>
          {paged.map((m) => {
            const kind = MATERIAL_KINDS.includes(m.kind) ? m.kind : "link";
            const Icon = KIND_ICON[kind];
            const href = safeHref(m.url);
            const subj = subjectById.get(m.subjectId);
            return (
              <div key={m.id} style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", padding: 16, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, ...KIND_STYLE[kind] }}>
                    <Icon size={12} /> {MATERIAL_KIND_LABELS[kind]}
                  </span>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button aria-label={`Edit ${m.title}`} onClick={() => setModal({ editing: m })} style={iconBtn("var(--primary-light)", "var(--primary)")}><Edit2 size={13} /></button>
                      <button aria-label={`Delete ${m.title}`} onClick={() => handleDelete(m)} style={iconBtn("#fef2f2", "var(--danger)")}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, wordBreak: "break-word" }}>{m.title}</div>
                {m.description && (
                  <div style={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap", wordBreak: "break-word", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: kind === "note" ? 8 : 3, overflow: "hidden" }}>
                    {m.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#f8fafc", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{m.grade || "All classes"}</span>
                  {subj && <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "var(--primary-light)", color: "var(--primary)", fontWeight: 600 }}>{subj.name}</span>}
                </div>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 12px", borderRadius: 8, background: "var(--primary)", color: "white", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                    <ExternalLink size={14} /> {OPEN_LABEL[kind]}
                  </a>
                ) : m.url ? (
                  <div style={{ fontSize: 12, color: "var(--danger)" }}>Link is not a valid http(s) address. Edit to fix it.</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize} pageSizeOptions={[12, 24, 48]}
      />

      {modal && (
        <MaterialModal
          key={modal.editing ? modal.editing.id : "new"}
          editing={modal.editing}
          classes={classes}
          subjects={subjects}
          branches={branches}
          defaultBranch={defaultBranch}
          isMobile={isMobile}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
