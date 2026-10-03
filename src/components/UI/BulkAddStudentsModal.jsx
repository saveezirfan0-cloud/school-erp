import React, { useState } from "react";
import { db, addDoc, collection, serverTimestamp } from "../../firebase";
import { runBulk, bulkResultMessage } from "../../utils/bulk";
import { logActivity } from "../../utils/auditLog";
import toast from "react-hot-toast";
import { X, Plus, Trash2, Copy } from "lucide-react";

const newRow = (defaults = {}) => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: "", studentId: "", grade: "", parentName: "", parentPhone: "", email: "", monthlyFee: "", dob: "", address: "",
  recurringFee: false,
  ...defaults,
});

const isBlank = (r) => !r.name.trim() && !r.studentId.trim() && !r.parentName.trim() && !r.parentPhone.trim() && !r.email.trim() && !r.grade.trim() && !String(r.monthlyFee).trim();

const COLUMNS = [
  { key: "name", label: "Full Name *", width: 170 },
  { key: "studentId", label: "Student ID *", width: 110 },
  { key: "grade", label: "Grade / Class", width: 110 },
  { key: "parentName", label: "Parent Name", width: 150 },
  { key: "parentPhone", label: "Parent Phone", width: 140 },
  { key: "email", label: "Email", width: 170, type: "email" },
  { key: "monthlyFee", label: "Monthly Fee", width: 100, type: "number" },
  { key: "dob", label: "Date of Birth", width: 140, type: "date" },
];

const inputStyle = { width: "100%", padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };

export default function BulkAddStudentsModal({ branches, activeBranch, existingIds, onClose, onDone }) {
  const defaultBranch = activeBranch && activeBranch !== "all" && activeBranch !== "main" ? activeBranch : "";
  const [branchId, setBranchId] = useState(defaultBranch);
  const [rowCount, setRowCount] = useState(5);
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, () => newRow()));
  const [errors, setErrors] = useState({}); // _key -> message
  const [busy, setBusy] = useState(false);

  const update = (key, field, value) => {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  };
  const addRows = (n = 1) => setRows((rs) => [...rs, ...Array.from({ length: n }, () => newRow())]);
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r._key !== key) : rs));
  const duplicateRow = (key) => setRows((rs) => {
    const i = rs.findIndex((r) => r._key === key);
    // Copy everything except the unique fields (name and ID)
    const copy = newRow({ ...rs[i], name: "", studentId: "" });
    return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
  });

  const applyRowCount = () => {
    const n = Math.max(1, Math.min(200, parseInt(rowCount, 10) || 1));
    setRowCount(n);
    setRows((rs) => (n >= rs.length ? [...rs, ...Array.from({ length: n - rs.length }, () => newRow())] : rs.filter((r, i) => i < n || !isBlank(r))));
  };

  const validate = (filled) => {
    const errs = {};
    const seen = new Map();
    const taken = new Set(existingIds);
    filled.forEach((r) => {
      const id = r.studentId.trim().toLowerCase();
      if (!r.name.trim()) errs[r._key] = "Name is required";
      else if (!id) errs[r._key] = "Student ID is required";
      else if (taken.has(id)) errs[r._key] = "Student ID already exists";
      else if (seen.has(id)) errs[r._key] = "Duplicate Student ID in this list";
      else if (r.monthlyFee !== "" && (isNaN(Number(r.monthlyFee)) || Number(r.monthlyFee) < 0)) errs[r._key] = "Invalid monthly fee";
      seen.set(id, true);
    });
    return errs;
  };

  const handleSave = async () => {
    const filled = rows.filter((r) => !isBlank(r));
    if (filled.length === 0) { toast.error("Enter at least one student"); return; }
    const errs = validate(filled);
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error(`Fix ${Object.keys(errs).length} row${Object.keys(errs).length === 1 ? "" : "s"} before saving`); return; }

    setBusy(true);
    try {
      const { ok, failed } = await runBulk(filled, (r) => {
        const { _key, ...data } = r;
        return addDoc(collection(db, "students"), {
          ...data,
          name: data.name.trim(),
          studentId: data.studentId.trim(),
          monthlyFee: data.monthlyFee === "" ? 0 : Number(data.monthlyFee),
          branchId,
          createdAt: serverTimestamp(),
        });
      });
      if (ok.length) logActivity("created", "Students", `${ok.length} students (bulk add)`);
      if (failed.length === 0) {
        toast.success(bulkResultMessage(ok.length, 0, "added", "students"));
        onDone();
        return;
      }
      toast.error(bulkResultMessage(ok.length, failed.length, "added", "students"));
      // Keep only the rows that failed so they can be fixed and retried
      const failedErrs = {};
      failed.forEach(({ item, error }) => { failedErrs[item._key] = error?.message || "Failed to save"; });
      setRows(rows.filter((r) => failedErrs[r._key] || isBlank(r)));
      setErrors(failedErrs);
      if (ok.length) onDone({ keepOpen: true });
    } finally { setBusy(false); }
  };

  const filledCount = rows.filter((r) => !isBlank(r)).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}>
      <div style={{ background: "white", borderRadius: 16, padding: 20, width: "100%", maxWidth: 1250, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>Bulk Add Students</h3>
          <button onClick={onClose} disabled={busy} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Branch (applies to all)</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ ...inputStyle, width: 180 }}>
              <option value="">Main Office</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Number of rows</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={1} max={200} value={rowCount} onChange={(e) => setRowCount(e.target.value)} style={{ ...inputStyle, width: 80 }} />
              <button type="button" onClick={applyRowCount} style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 13 }}>Set</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", paddingBottom: 8 }}>Fill in the details for each student. Empty rows are ignored. * required.</div>
        </div>

        <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, flex: 1 }}>
          <table style={{ borderCollapse: "collapse", minWidth: 1150 }}>
            <thead>
              <tr style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
                <th style={{ padding: "8px 6px", fontSize: 11, color: "var(--text-muted)", width: 30 }}>#</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={{ padding: "8px 6px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", minWidth: c.width }}>{c.label}</th>
                ))}
                <th style={{ padding: "8px 6px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>Auto fees</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <React.Fragment key={r._key}>
                  <tr style={{ borderTop: "1px solid var(--border)", background: errors[r._key] ? "#fef2f2" : undefined }}>
                    <td style={{ padding: "6px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>{i + 1}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} style={{ padding: "5px 4px" }}>
                        <input type={c.type || "text"} value={r[c.key]} min={c.type === "number" ? 0 : undefined}
                          onChange={(e) => update(r._key, c.key, e.target.value)} style={inputStyle} aria-label={`${c.label} row ${i + 1}`} />
                      </td>
                    ))}
                    <td style={{ padding: "5px 4px", textAlign: "center" }}>
                      <input type="checkbox" checked={r.recurringFee} onChange={(e) => update(r._key, "recurringFee", e.target.checked)} style={{ width: 16, height: 16 }} aria-label={`Auto fees row ${i + 1}`} />
                    </td>
                    <td style={{ padding: "5px 4px", whiteSpace: "nowrap" }}>
                      <button type="button" title="Duplicate row (keeps grade, parent, fee)" onClick={() => duplicateRow(r._key)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--primary)", padding: 4 }}><Copy size={14} /></button>
                      <button type="button" title="Remove row" onClick={() => removeRow(r._key)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                  {errors[r._key] && (
                    <tr style={{ background: "#fef2f2" }}>
                      <td />
                      <td colSpan={COLUMNS.length + 2} style={{ padding: "0 6px 6px", fontSize: 12, color: "var(--danger)" }}>Row {i + 1}: {errors[r._key]}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => addRows(1)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}><Plus size={14} /> Add row</button>
          <button type="button" onClick={() => addRows(5)} style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}>+5 rows</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={busy} style={{ padding: "10px 18px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy || filledCount === 0}
            style={{ padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: busy || filledCount === 0 ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: busy || filledCount === 0 ? 0.6 : 1 }}>
            {busy ? "Saving..." : `Add ${filledCount} Student${filledCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
