import React, { useEffect, useMemo, useState } from "react";
import { db, addDoc, updateDoc, deleteDoc, doc, collection, deleteDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import { useBulkSelect } from "../hooks/useBulkSelect";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { exportToCSV } from "../utils/exportUtils";
import { deriveClasses, appliesToClass, isDuplicateSubject, normalizeBranch, paginate } from "../utils/learning";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, X, Download, BookOpen } from "lucide-react";

const emptySubject = { name: "", code: "", grade: "", teacher: "", branchId: "" };

const fieldStyle = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };
const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Subjects() {
  const { branches, activeBranch } = useBranch();
  const { can } = useUser();
  const canEdit = can("canEditLearning");
  const isMobile = useIsMobile();

  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptySubject);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // The hook handles branch scope, search and sort; class filtering and
  // paging happen below because a blank class means "all classes".
  const { rows, filtered: searched, loading } = useCollection("subjects", {
    activeBranch,
    search,
    searchFields: ["name", "code", "teacher", "grade"],
    sortBy: sortField,
    sortDir,
    pageSize: 100000,
  });
  const { rows: students } = useCollection("students", { pageSize: 100000 });
  const { rows: employees } = useCollection("employees", { activeBranch, pageSize: 100000 });

  const classes = useMemo(() => deriveClasses(students, rows), [students, rows]);
  const teacherNames = useMemo(
    () => [...new Set(employees.map((e) => String(e.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [employees]
  );

  const filtered = useMemo(
    () => searched.filter((s) => appliesToClass(s.grade, filterGrade)),
    [searched, filterGrade]
  );
  const { items: paged, page: safePage, pageCount, total } = paginate(filtered, page, pageSize);

  const bulk = useBulkSelect(rows.map((s) => s.id), activeBranch);
  const pagedIds = paged.map((s) => s.id);

  useEffect(() => { setPage(1); }, [search, filterGrade, pageSize, activeBranch, sortField, sortDir]);

  const active = !!(search || filterGrade);
  const clearAll = () => { setSearch(""); setFilterGrade(""); };

  const branchName = (id) => branches.find((b) => b.id === id)?.name || "Main Office";
  const defaultBranch = activeBranch === "all" || activeBranch === "main" ? "" : activeBranch;

  const openAdd = () => { setForm({ ...emptySubject, branchId: defaultBranch }); setEditing(null); setShowModal(true); };
  const openEdit = (s) => {
    setForm({ name: s.name || "", code: s.code || "", grade: s.grade || "", teacher: s.teacher || "", branchId: normalizeBranch(s.branchId) });
    setEditing(s.id);
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptySubject); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      grade: form.grade.trim(),
      teacher: form.teacher.trim(),
      branchId: normalizeBranch(form.branchId),
    };
    if (!payload.name) { toast.error("Subject name is required"); return; }
    if (isDuplicateSubject(payload, rows, editing)) {
      toast.error("This subject already exists for that class and branch");
      return;
    }
    setSaving(true);
    try {
      const where = payload.grade || "all classes";
      if (editing) {
        await updateDoc(doc(db, "subjects", editing), payload);
        toast.success("Subject updated");
        logActivity("updated", "Subjects", `${payload.name} (${where})`);
      } else {
        await addDoc(collection(db, "subjects"), payload);
        toast.success("Subject added");
        logActivity("created", "Subjects", `${payload.name} (${where})`);
      }
      closeModal();
    } catch (err) {
      toast.error(err?.message || "Error saving subject");
    } finally { setSaving(false); }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete subject "${s.name}"? You can restore it from Trash. Homework and materials that use it keep working but lose the subject label.`)) return;
    try {
      await deleteDoc(doc(db, "subjects", s.id));
      toast.success("Subject moved to Trash");
      logActivity("deleted", "Subjects", `${s.name} (${s.grade || "all classes"})`);
    } catch (err) { toast.error(err?.message || "Error deleting subject"); }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} subject${ids.length === 1 ? "" : "s"}? You can restore them from Trash.`)) return;
    setBulkBusy(true);
    try {
      await deleteDocs("subjects", ids);
      toast.success(bulkResultMessage(ids.length, 0, "moved to Trash", "subjects"));
      logActivity("deleted", "Subjects", `${ids.length} subjects (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed");
    } finally { setBulkBusy(false); }
  };

  const handleCSV = () => exportToCSV("subjects",
    ["Name", "Code", "Class", "Teacher", "Branch"],
    filtered.map((s) => [s.name, s.code, s.grade || "All classes", s.teacher, branchName(s.branchId)])
  );

  const ghostBtn = { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 };
  const iconBtn = (bg, color, pad) => ({ border: "none", background: bg, color, padding: pad, borderRadius: 8, cursor: "pointer" });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Subjects <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <button onClick={handleCSV} style={ghostBtn}><Download size={14} /> CSV</button>}
          {canEdit && (
            <button onClick={openAdd}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Plus size={15} /> Add Subject
            </button>
          )}
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, code, teacher..."
        filters={[
          { key: "grade", value: filterGrade, onChange: setFilterGrade, placeholder: "All Classes", options: classes.map((g) => ({ value: g, label: g })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "name", label: "Name" },
            { value: "code", label: "Code" },
            { value: "grade", label: "Class" },
            { value: "teacher", label: "Teacher" },
          ],
        }}
        active={active}
        onClear={clearAll}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>Loading subjects…</div>
      ) : total === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
          <BookOpen size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "#334155" }}>{rows.length === 0 ? "No subjects yet" : "No subjects match your filters"}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {rows.length === 0
              ? (canEdit ? "Add the subjects taught in each class to start assigning homework and sharing materials." : "Subjects will appear here once they are added.")
              : "Try clearing the search or class filter."}
          </div>
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((s) => (
            <div key={s.id} style={{ background: "white", borderRadius: 12, padding: 16, border: bulk.isSelected(s.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  {canEdit && <RowCheckbox checked={bulk.isSelected(s.id)} onChange={() => bulk.toggle(s.id)} label={`Select ${s.name}`} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, wordBreak: "break-word" }}>{s.name}</div>
                    {s.code && <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{s.code}</div>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)} style={iconBtn("var(--primary-light)", "var(--primary)", "7px 9px")}><Edit2 size={14} /></button>
                    <button aria-label={`Delete ${s.name}`} onClick={() => handleDelete(s)} style={iconBtn("#fef2f2", "var(--danger)", "7px 9px")}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Class</div><div style={{ fontWeight: 500 }}>{s.grade || "All classes"}</div></div>
                <div style={{ fontSize: 12 }}><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Teacher</div><div style={{ fontWeight: 500 }}>{s.teacher || "—"}</div></div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>{branchName(s.branchId)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {canEdit && (
                    <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                      <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                    </th>
                  )}
                  {["Name", "Code", "Class", "Teacher", "Branch", ...(canEdit ? ["Actions"] : [])].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(s.id) ? "var(--primary-light)" : undefined }}>
                    {canEdit && (
                      <td style={{ padding: "11px 6px 11px 14px" }}>
                        <RowCheckbox checked={bulk.isSelected(s.id)} onChange={() => bulk.toggle(s.id)} label={`Select ${s.name}`} />
                      </td>
                    )}
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>{s.name}</td>
                    <td style={{ padding: "11px 14px", fontSize: 12, fontFamily: "monospace" }}>{s.code || "—"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>
                      {s.grade || <span style={{ color: "var(--text-muted)" }}>All classes</span>}
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{s.teacher || "—"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{branchName(s.branchId)}</td>
                    {canEdit && (
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)} style={iconBtn("var(--primary-light)", "var(--primary)", "6px 9px")}><Edit2 size={13} /></button>
                          <button aria-label={`Delete ${s.name}`} onClick={() => handleDelete(s)} style={iconBtn("#fef2f2", "var(--danger)", "6px 9px")}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {canEdit && (
        <BulkBar
          count={bulk.count}
          total={filtered.length}
          noun="subjects"
          busy={bulkBusy}
          onSelectAll={() => bulk.selectAll(filtered.map((s) => s.id))}
          onClear={bulk.clear}
          actions={[{ label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete }]}
        />
      )}

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : 520, maxHeight: "90vh", overflow: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>{editing ? "Edit Subject" : "Add Subject"}</h3>
              <button aria-label="Close" onClick={closeModal} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Subject Name *</label>
                  <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="e.g. Mathematics" style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Code</label>
                  <input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. MTH" style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Class</label>
                  <select value={form.grade} onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))} style={fieldStyle}>
                    <option value="">All classes</option>
                    {classes.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Teacher</label>
                  <input list="subject-teachers" value={form.teacher} onChange={(e) => setForm((p) => ({ ...p, teacher: e.target.value }))} placeholder="Pick or type a name" style={fieldStyle} />
                  <datalist id="subject-teachers">
                    {teacherNames.map((n) => <option key={n} value={n} />)}
                  </datalist>
                </div>
                <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
                  <label style={labelStyle}>Branch</label>
                  <select value={form.branchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))} style={fieldStyle}>
                    <option value="">Main Office</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={closeModal} style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
                <button type="submit" disabled={saving}
                  style={{ flex: 2, padding: 11, background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "wait" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving…" : editing ? "Update Subject" : "Add Subject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
