import React, { useState, useRef, useEffect } from "react";
import { db, addDoc, collection, serverTimestamp } from "../../firebase";
import { runBulk, bulkResultMessage } from "../../utils/bulk";
import { logActivity } from "../../utils/auditLog";
import toast from "react-hot-toast";
import { X, Plus, Trash2, Copy, ArrowDownToLine } from "lucide-react";

const MAX_ROWS = 200;

// Order matters: it is the column order used for pasting from a spreadsheet.
const COLUMNS = [
  { key: "name", label: "Full Name *", width: 180 },
  { key: "role", label: "Role / Position", width: 150, fill: true },
  { key: "phone", label: "Phone", width: 140 },
  { key: "email", label: "Email", width: 190, type: "email" },
  { key: "salary", label: "Monthly Salary", width: 120, type: "number", fill: true },
  { key: "joinDate", label: "Join Date", width: 140, type: "date", fill: true },
];

const newRow = (defaults = {}) => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: "", role: "", phone: "", email: "", salary: "", joinDate: "",
  recurringPayslip: false,
  ...defaults,
});

const isBlank = (r) => COLUMNS.every((c) => !String(r[c.key] ?? "").trim());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneOk = (p) => { const d = p.replace(/[\s\-()]/g, ""); return /^\+?\d{7,15}$/.test(d); };

// Dates pasted from spreadsheets: accept yyyy-mm-dd, or dd/mm/yyyy and dd-mm-yyyy.
const normalizeDate = (v) => {
  const s = String(v || "").trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
};

const baseInput = { width: "100%", padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };
const ghostBtn = { display: "flex", alignItems: "center", gap: 5, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 };

export default function BulkAddEmployeesModal({ branches, activeBranch, onClose, onDone }) {
  const defaultBranch = activeBranch && activeBranch !== "all" && activeBranch !== "main" ? activeBranch : "";
  const [branchId, setBranchId] = useState(defaultBranch);
  const [rowCount, setRowCount] = useState(5);
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, () => newRow()));
  const [errors, setErrors] = useState({}); // _key -> { field, msg }
  const [busy, setBusy] = useState(false);
  const tableRef = useRef(null);
  const pendingFocus = useRef(null); // { row, col } to focus after next render

  useEffect(() => {
    const t = pendingFocus.current;
    if (!t) return;
    pendingFocus.current = null;
    const el = tableRef.current?.querySelector(`[data-cell="${t.row}-${t.col}"]`);
    if (el) el.focus();
  });

  const clearError = (key) => setErrors((e) => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });

  const update = (key, field, value) => {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    clearError(key);
  };
  const addRows = (n = 1) => setRows((rs) => [...rs, ...Array.from({ length: Math.min(n, MAX_ROWS - rs.length) }, () => newRow())]);
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r._key !== key) : rs));
  const duplicateRow = (key) => setRows((rs) => {
    if (rs.length >= MAX_ROWS) return rs;
    const i = rs.findIndex((r) => r._key === key);
    const copy = newRow({ ...rs[i], name: "", phone: "", email: "" }); // keep role, salary, join date...
    return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
  });

  const applyRowCount = () => {
    const n = Math.max(1, Math.min(MAX_ROWS, parseInt(rowCount, 10) || 1));
    setRowCount(n);
    setRows((rs) => (n >= rs.length
      ? [...rs, ...Array.from({ length: n - rs.length }, () => newRow())]
      : rs.filter((r, i) => i < n || !isBlank(r)))); // never drop rows with data
  };

  // Copy the first filled value in a column into every row below it that is empty.
  const fillDown = (field) => setRows((rs) => {
    const src = rs.find((r) => String(r[field]).trim() !== "");
    if (!src) { toast.error("Type a value in the first row of this column first"); return rs; }
    return rs.map((r) => (String(r[field]).trim() === "" && !isBlank(r) ? { ...r, [field]: src[field] } : r));
  });

  const toggleAllRecurring = () => setRows((rs) => {
    const targets = rs.filter((r) => !isBlank(r));
    const next = !targets.every((r) => r.recurringPayslip);
    return rs.map((r) => (isBlank(r) ? r : { ...r, recurringPayslip: next }));
  });

  // Paste multi-cell data copied from Excel / Google Sheets: fills the grid
  // starting at the focused cell, adding rows as needed.
  const handlePaste = (e, rowIdx, colIdx) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return; // single value: normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((l) => l.split("\t"));
    setRows((rs) => {
      const room = MAX_ROWS - rowIdx;
      const use = lines.slice(0, room);
      if (lines.length > room) toast.error(`Only ${MAX_ROWS} rows are allowed — extra rows were ignored`);
      const out = [...rs];
      while (out.length < rowIdx + use.length) out.push(newRow());
      use.forEach((cells, li) => {
        const target = { ...out[rowIdx + li] };
        cells.forEach((val, ci) => {
          const col = COLUMNS[colIdx + ci];
          if (!col) return;
          const v = val.trim();
          target[col.key] = col.key === "joinDate" ? normalizeDate(v) : col.type === "number" ? v.replace(/[^\d.]/g, "") : v;
        });
        out[rowIdx + li] = target;
      });
      return out;
    });
    setErrors({});
    toast.success(`Pasted ${Math.min(lines.length, MAX_ROWS - rowIdx)} row${lines.length === 1 ? "" : "s"}`);
  };

  // Enter moves to the cell below (like a spreadsheet); adds a row at the bottom.
  const handleKeyDown = (e, rowIdx, colIdx) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (rowIdx === rows.length - 1) {
      if (rows.length >= MAX_ROWS) return;
      addRows(1);
    }
    pendingFocus.current = { row: rowIdx + 1, col: colIdx };
    // force a re-render so the focus effect runs even when no row was added
    setErrors((er) => ({ ...er }));
  };

  const validate = (filled) => {
    const errs = {};
    filled.forEach((r) => {
      const fail = (field, msg) => { if (!errs[r._key]) errs[r._key] = { field, msg }; };
      if (!r.name.trim()) fail("name", "Name is required");
      if (r.salary !== "" && (isNaN(Number(r.salary)) || Number(r.salary) < 0)) fail("salary", "Invalid monthly salary");
      if (r.email.trim() && !EMAIL_RE.test(r.email.trim())) fail("email", "Invalid email address");
      if (r.phone.trim() && !phoneOk(r.phone)) fail("phone", "Invalid phone number (7–15 digits, optional +)");
    });
    return errs;
  };

  const handleSave = async () => {
    const filled = rows.filter((r) => !isBlank(r));
    if (filled.length === 0) { toast.error("Enter at least one employee"); return; }
    const errs = validate(filled);
    setErrors(errs);
    const n = Object.keys(errs).length;
    if (n) {
      toast.error(`Fix ${n} row${n === 1 ? "" : "s"} before saving`);
      const first = rows.findIndex((r) => errs[r._key]);
      const col = COLUMNS.findIndex((c) => c.key === errs[rows[first]._key].field);
      pendingFocus.current = { row: first, col: Math.max(col, 0) };
      return;
    }

    setBusy(true);
    try {
      const { ok, failed } = await runBulk(filled, (r) => {
        const { _key, ...data } = r;
        return addDoc(collection(db, "employees"), {
          ...data,
          name: data.name.trim(),
          role: data.role.trim(),
          phone: data.phone.replace(/[\s\-()]/g, ""),
          email: data.email.trim(),
          salary: data.salary === "" ? "" : Number(data.salary),
          branchId,
          createdAt: serverTimestamp(),
        });
      });
      if (ok.length) logActivity("created", "Employees", `${ok.length} employees (bulk add)`);
      if (failed.length === 0) {
        toast.success(bulkResultMessage(ok.length, 0, "added", "employees"));
        onDone();
        return;
      }
      toast.error(bulkResultMessage(ok.length, failed.length, "added", "employees"));
      // Keep only the rows that failed so they can be fixed and retried.
      const failedErrs = {};
      failed.forEach(({ item, error }) => { failedErrs[item._key] = { field: "name", msg: error?.message || "Failed to save" }; });
      setRows(rows.filter((r) => failedErrs[r._key]));
      setErrors(failedErrs);
      if (ok.length) onDone({ keepOpen: true });
    } finally { setBusy(false); }
  };

  const filledCount = rows.filter((r) => !isBlank(r)).length;

  const handleClose = () => {
    if (busy) return;
    if (filledCount > 0 && !window.confirm(`Discard ${filledCount} unsaved employee${filledCount === 1 ? "" : "s"}?`)) return;
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}>
      <div style={{ background: "white", borderRadius: 16, padding: 20, width: "100%", maxWidth: 1100, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>Bulk Add Employees</h3>
          <button onClick={handleClose} disabled={busy} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Branch (applies to all)</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ ...baseInput, width: 180 }}>
              <option value="">Main Office</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Number of rows</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={1} max={MAX_ROWS} value={rowCount} onChange={(e) => setRowCount(e.target.value)} style={{ ...baseInput, width: 80 }} />
              <button type="button" onClick={applyRowCount} style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 13 }}>Set</button>
            </div>
          </div>
          <button type="button" onClick={toggleAllRecurring} style={{ ...ghostBtn, padding: "8px 12px" }}>Toggle auto payslip for all</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Tip: press Enter to move down a column, or copy rows from Excel / Google Sheets (columns in the order shown) and paste into any cell. Empty rows are ignored.
        </div>

        <div ref={tableRef} style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, flex: 1 }}>
          <table style={{ borderCollapse: "collapse", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
                <th style={{ padding: "8px 6px", fontSize: 11, color: "var(--text-muted)", width: 30 }}>#</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={{ padding: "8px 6px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", minWidth: c.width }}>
                    {c.label}
                    {c.fill && (
                      <button type="button" onClick={() => fillDown(c.key)} title={`Copy the first ${c.label.replace(" *", "")} down to empty rows`}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "var(--primary)", padding: "0 0 0 4px", verticalAlign: "middle" }}>
                        <ArrowDownToLine size={12} />
                      </button>
                    )}
                  </th>
                ))}
                <th style={{ padding: "8px 6px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>Auto payslip</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const err = errors[r._key];
                return (
                  <React.Fragment key={r._key}>
                    <tr style={{ borderTop: "1px solid var(--border)", background: err ? "#fef2f2" : undefined }}>
                      <td style={{ padding: "6px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>{i + 1}</td>
                      {COLUMNS.map((c, ci) => (
                        <td key={c.key} style={{ padding: "5px 4px" }}>
                          <input type={c.type || "text"} value={r[c.key]} min={c.type === "number" ? 0 : undefined}
                            data-cell={`${i}-${ci}`}
                            onChange={(e) => update(r._key, c.key, e.target.value)}
                            onPaste={(e) => handlePaste(e, i, ci)}
                            onKeyDown={(e) => handleKeyDown(e, i, ci)}
                            aria-label={`${c.label.replace(" *", "")} row ${i + 1}`}
                            aria-invalid={err?.field === c.key || undefined}
                            style={{ ...baseInput, borderColor: err?.field === c.key ? "var(--danger)" : "var(--border)" }} />
                        </td>
                      ))}
                      <td style={{ padding: "5px 4px", textAlign: "center" }}>
                        <input type="checkbox" checked={r.recurringPayslip} onChange={(e) => update(r._key, "recurringPayslip", e.target.checked)} style={{ width: 16, height: 16 }} aria-label={`Auto payslip row ${i + 1}`} />
                      </td>
                      <td style={{ padding: "5px 4px", whiteSpace: "nowrap" }}>
                        <button type="button" title="Duplicate row (keeps role, salary, join date)" onClick={() => duplicateRow(r._key)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--primary)", padding: 4 }}><Copy size={14} /></button>
                        <button type="button" title="Remove row" onClick={() => removeRow(r._key)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                    {err && (
                      <tr style={{ background: "#fef2f2" }}>
                        <td />
                        <td colSpan={COLUMNS.length + 2} style={{ padding: "0 6px 6px", fontSize: 12, color: "var(--danger)" }}>Row {i + 1}: {err.msg}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => addRows(1)} disabled={rows.length >= MAX_ROWS} style={ghostBtn}><Plus size={14} /> Add row</button>
          <button type="button" onClick={() => addRows(5)} disabled={rows.length >= MAX_ROWS} style={{ ...ghostBtn, padding: "9px 12px" }}>+5 rows</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleClose} disabled={busy} style={{ padding: "10px 18px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy || filledCount === 0}
            style={{ padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: busy || filledCount === 0 ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: busy || filledCount === 0 ? 0.6 : 1 }}>
            {busy ? "Saving..." : `Add ${filledCount} Employee${filledCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
