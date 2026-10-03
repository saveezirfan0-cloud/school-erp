import React, { useState, useRef, useMemo, useEffect } from "react";
import { db } from "../firebase";
import { collection, addDoc, getDocs, serverTimestamp } from "../firebase";
import toast from "react-hot-toast";
import {
  Upload, CheckCircle, XCircle,
  AlertCircle, ChevronDown, ChevronRight,
  Download, RefreshCw, Eye, AlertTriangle
} from "lucide-react";
import {
  IMPORT_TYPES, readSpreadsheetFile, buildMapping, applyMapping, missingRequired, validateImport,
  describeTotals, cellText, MAX_ROWS, MAX_FILE_BYTES,
} from "../utils/importParsing";
import { createInvoiceAndCollect, createExpenseAndPost, postManualPayment, pickDefaultAccountId, rememberAccountChoice } from "../utils/accounting";
import { useAccounts } from "../utils/useAccounts";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";

// Display settings per import type; the parsing rules live in utils/importParsing.js.
const META = {
  students: { label: "Students / Contacts", color: "#4f46e5", bg: "#eef2ff", description: "Export from Manager.io: Customers tab → click Export" },
  employees: { label: "Employees / Staff", color: "#2a8c7a", bg: "#e6f4f1", description: "Export from Manager.io: Employees tab → click Export" },
  invoices: { label: "Invoices & Fees", color: "#10b981", bg: "#ecfdf5", description: "Export from Manager.io: Sales Invoices tab → click Export" },
  expenses: { label: "Expenses", color: "#ef4444", bg: "#fef2f2", description: "Export from Manager.io: Expense Claims → Export" },
  accounts: { label: "Chart of Accounts", color: "#7a2535", bg: "#f5eaec", description: "Export from Manager.io: Chart of Accounts tab → Export" },
  payments: { label: "Payments & Transactions", color: "#f59e0b", bg: "#fffbeb", description: "Export from Manager.io: Bank Accounts → Transactions" },
};
const TYPE_KEYS = Object.keys(META);
const PREVIEW_LIMIT = 100;

async function downloadTemplate(type) {
  const def = IMPORT_TYPES[type];
  const fields = Object.keys(def.columnMap);
  const headers = fields.map((f) => def.columnMap[f][0].replace(/\b\w/g, (c) => c.toUpperCase()));
  const example = fields.map((f) => def.example[f] ?? "");
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template");
  ws.addRow(headers);
  ws.addRow(example);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 20; });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ZMI_${type}_template.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

const statusStyle = {
  ok: { bg: "#ecfdf5", color: "#047857", label: "Ready" },
  duplicate: { bg: "#fffbeb", color: "#b45309", label: "Duplicate" },
  error: { bg: "#fef2f2", color: "#b91c1c", label: "Error" },
};

export default function Import() {
  const [activeType, setActiveType] = useState("students");
  const [file, setFile] = useState(null);
  const [table, setTable] = useState(null);          // { headers, rows } as read from the file
  const [ctxData, setCtxData] = useState(null);      // { existing, students } for duplicate / student checks
  const [step, setStep] = useState(1);
  const [results, setResults] = useState(null);
  const [expandedErrors, setExpandedErrors] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [progress, setProgress] = useState(null);
  const [reading, setReading] = useState(false);
  const { busy: importing, run: runImport } = useSubmitLock();
  const { accounts, postable, problem: accountsProblem } = useAccounts();
  const fileRef = useRef();

  const def = IMPORT_TYPES[activeType];
  const meta = META[activeType];

  // Column mapping, then row validation. Re-runs when accounts finish loading,
  // because payment rows are checked against the real Bank & Cash accounts.
  const mapping = useMemo(() => (table ? buildMapping(table.headers, def.columnMap) : null), [table, def]);
  const missing = useMemo(() => (mapping ? missingRequired(activeType, mapping.fieldToHeader) : []), [mapping, activeType]);
  const validated = useMemo(() => {
    if (!table || !mapping || !ctxData || missing.length) return null;
    const mapped = applyMapping(table.rows, mapping.fieldToHeader);
    return validateImport(activeType, mapped, {
      students: ctxData.students, existing: ctxData.existing, cashAccounts: postable,
    });
  }, [table, mapping, ctxData, missing, activeType, postable]);

  const readyRows = validated ? validated.rows.filter((r) => r.status === "ok") : [];
  const needsAccount = activeType === "invoices" && readyRows.some((r) => r.record.status !== "pending");

  useEffect(() => {
    if (needsAccount && !accountId && postable.length) setAccountId(pickDefaultAccountId(postable));
  }, [needsAccount, accountId, postable]);

  const reset = () => {
    setFile(null);
    setTable(null);
    setCtxData(null);
    setStep(1);
    setResults(null);
    setAcknowledged(false);
    setAccountId("");
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFileChange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    reset();
    setFile(f);
    setReading(true);
    try {
      const t = await readSpreadsheetFile(f);
      if (t.rows.length === 0) throw new Error("The file has a header row but no data rows.");
      // Existing records (for duplicate detection) and students (to link invoices).
      let existing = [];
      let students = [];
      try {
        const snap = await getDocs(collection(db, IMPORT_TYPES[activeType].collection));
        existing = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (activeType === "invoices") {
          const st = await getDocs(collection(db, "students"));
          students = st.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
      } catch {
        throw new Error("Could not load existing records to check for duplicates. Nothing was imported. Try again.");
      }
      setTable(t);
      setCtxData({ existing, students });
      setStep(2);
    } catch (err) {
      toast.error(err?.message || "Could not read the file.", { duration: 7000 });
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
    } finally {
      setReading(false);
    }
  };

  const importBlockReason = () => {
    if (!validated) return "Nothing to import";
    if (readyRows.length === 0) return "No rows are ready to import";
    if (needsAccount && postable.length === 0) return accountsProblem || "A Bank & Cash account is required for rows that are already paid";
    if (needsAccount && !accountId) return "Choose the account that received the paid rows";
    if (def.money && !acknowledged) return "Tick the box to confirm you have checked the totals";
    return "";
  };

  const handleImport = () => runImport(async () => {
    const why = importBlockReason();
    if (why) return toast.error(why);
    const batchId = "imp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let success = 0;
    const errors = [];
    setProgress({ done: 0, total: readyRows.length });

    for (const row of readyRows) {
      const rec = row.record;
      try {
        if (activeType === "students" || activeType === "employees" || activeType === "accounts") {
          await addDoc(collection(db, def.collection), { ...rec, importBatchId: batchId, createdAt: serverTimestamp() });
        } else if (activeType === "expenses") {
          await createExpenseAndPost({ expense: { ...rec, importBatchId: batchId }, accounts, accountId: "" });
        } else if (activeType === "payments") {
          await postManualPayment({
            accounts, accountId: rec.accountId, type: rec.type, amount: rec.amount, category: rec.category,
            description: rec.description, reference: rec.reference, branchId: rec.branchId, date: rec.date,
            extra: { importBatchId: batchId },
          });
        } else if (activeType === "invoices") {
          const invoiceData = {
            studentId: rec.studentId, studentName: rec.studentName, parentPhone: rec.parentPhone,
            branchId: rec.branchId, month: rec.month, year: rec.year, dueDate: rec.dueDate, notes: rec.notes,
            lineItems: rec.lineItems, amount: rec.amount, importBatchId: batchId,
          };
          if (rec.status === "pending") {
            await addDoc(collection(db, "invoices"), {
              ...invoiceData, status: "pending", paidAmount: 0, paidDate: null, createdAt: serverTimestamp(),
            });
          } else {
            // Paid / partial rows post their cash_in through the same shared helper as every other path.
            await createInvoiceAndCollect({
              invoiceData, accounts, accountId, date: rec.paidDate, receivedAmount: rec.paidAmount,
            });
          }
        }
        success++;
      } catch (err) {
        errors.push(`Row ${row.rowNumber}: ${err?.message || "failed"}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    const invalid = validated.rows.filter((r) => r.status === "error");
    const dupes = validated.rows.filter((r) => r.status === "duplicate");
    for (const r of invalid) errors.push(`Row ${r.rowNumber} skipped: ${r.message}`);
    setResults({ success, failed: errors.length, errors, total: validated.rows.length, duplicates: dupes.length, batchId });
    setStep(3);
    setProgress(null);
    if (needsAccount) rememberAccountChoice(accountId);
    logActivity("imported", "Import", `${meta.label}: ${success} imported, ${dupes.length} duplicates skipped, ${invalid.length} invalid (${file?.name || "file"}, batch ${batchId})`);
    if (success > 0) toast.success(`Imported ${success} records!`);
    if (errors.length > 0) toast.error(`${errors.length} rows were not imported`);
  });

  const mappedFields = mapping ? Object.keys(mapping.fieldToHeader) : [];
  const shownRows = validated ? (onlyProblems ? validated.rows.filter((r) => r.status !== "ok") : validated.rows).slice(0, PREVIEW_LIMIT) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Import Data</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
          Import existing data from Manager.io, Excel, or CSV files. You review every row before anything is written.
        </p>
      </div>

      {/* Type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10, marginBottom: 24 }}>
        {TYPE_KEYS.map((key) => {
          const t = META[key];
          return (
            <button
              key={key}
              onClick={() => { if (importing) return; setActiveType(key); reset(); }}
              style={{
                padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                border: activeType === key ? `2px solid ${t.color}` : "1px solid var(--border)",
                background: activeType === key ? t.bg : "white",
                textAlign: "left", transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: activeType === key ? t.color : "#1e293b", marginBottom: 2 }}>
                {t.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {activeType === key ? "Selected ✓" : "Click to select"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Steps indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        {[{ n: 1, label: "Upload File" }, { n: 2, label: "Preview & Confirm" }, { n: 3, label: "Done" }].map(({ n, label }, i) => (
          <React.Fragment key={n}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: step >= n ? meta.color : "#e2e8f0",
                color: step >= n ? "white" : "var(--text-muted)",
                fontSize: 13, fontWeight: 700, flexShrink: 0,
              }}>
                {step > n ? <CheckCircle size={14} /> : n}
              </div>
              <span style={{
                fontSize: 13,
                fontWeight: step === n ? 600 : 400,
                color: step === n ? meta.color : "var(--text-muted)",
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            </div>
            {i < 2 && (
              <div style={{ flex: 1, height: 2, background: step > n ? meta.color : "#e2e8f0", maxWidth: 60 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Instructions */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>How to export from Manager.io</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
              {meta.description}. Supported: <strong>.xlsx</strong> and <strong>.csv</strong> (up to {MAX_FILE_BYTES / 1048576} MB and {MAX_ROWS.toLocaleString()} rows). Save older .xls files as .xlsx first.
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 6 }}>Required:</span>
              {[...def.requiredFields.map((f) => def.columnMap[f][0]), ...(def.requiredAnyOf || []).map((g) => g.map((f) => def.columnMap[f][0]).join(" or "))].map((c) => (
                <span key={c} style={{ padding: "2px 8px", background: meta.bg, color: meta.color, borderRadius: 4, fontSize: 12, fontWeight: 600, marginRight: 4 }}>
                  {c}
                </span>
              ))}
            </div>
            {activeType === "payments" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                Direction follows the bank statement: <strong>Debit / Dr / Withdrawal</strong> = money out, <strong>Credit / Cr / Deposit</strong> = money in. The Account column must name an existing Bank &amp; Cash account.
              </div>
            )}
            {activeType === "invoices" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                Students must already exist. Status must be exactly Paid, Unpaid, Partial or Pending. Paid and Partial rows need a Paid Date and are posted into the Bank &amp; Cash account you choose.
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
              Dates: YYYY-MM-DD, or DD/MM/YYYY (day first).
            </div>
          </div>
          <button
            onClick={() => downloadTemplate(activeType).catch(() => toast.error("Could not build the template"))}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, fontWeight: 500, flexShrink: 0 }}
          >
            <Download size={14} /> Download Template
          </button>
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div
          onClick={() => !reading && fileRef.current?.click()}
          style={{
            border: "2px dashed var(--border)", borderRadius: 12,
            padding: 48, textAlign: "center", cursor: reading ? "wait" : "pointer", background: "white",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = meta.color)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: meta.bg,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <Upload size={24} color={meta.color} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
            {reading ? "Reading file…" : `Click to upload ${meta.label} file`}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Supports .xlsx and .csv from Manager.io or any spreadsheet
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 2 && table && (
        <div>
          {/* Column mapping */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Columns found: {mappedFields.length} of {Object.keys(def.columnMap).length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(def.columnMap).map((f) => {
                const header = mapping.fieldToHeader[f];
                return (
                  <span key={f} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, background: header ? "#ecfdf5" : "#f1f5f9", color: header ? "#047857" : "#64748b" }}>
                    {f}: {header ? `“${header.trim()}”` : "not in file"}
                  </span>
                );
              })}
            </div>
            {mapping.unusedHeaders.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Ignored columns: {mapping.unusedHeaders.slice(0, 12).join(", ")}{mapping.unusedHeaders.length > 12 ? "…" : ""}
              </div>
            )}
          </div>

          {missing.length > 0 && (
            <div style={{ display: "flex", gap: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: 14, fontSize: 13, marginBottom: 16 }}>
              <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>This file is missing {missing.join(" and ")}. Rename the column header in your file (see the template) and upload it again.</div>
            </div>
          )}

          {validated && (
            <>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
                {[
                  { label: "Rows in file", value: validated.summary.total, color: "#475569" },
                  { label: "Ready to import", value: validated.summary.ready, color: "#10b981" },
                  { label: "Duplicates (skipped)", value: validated.summary.duplicates, color: "#b45309" },
                  { label: "Errors (not imported)", value: validated.summary.errors, color: validated.summary.errors ? "#ef4444" : "#10b981" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "white", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
              {def.money && (
                <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 16 }}>
                  <strong>Totals of the ready rows:</strong> {describeTotals(activeType, validated.summary.totals) || "none"}
                </div>
              )}

              {/* Row preview with per-row status */}
              <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Eye size={15} color="var(--text-muted)" />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    Preview — {shownRows.length} of {onlyProblems ? validated.summary.duplicates + validated.summary.errors : validated.rows.length} rows
                  </span>
                  <label style={{ marginLeft: "auto", fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                    Show only problems
                  </label>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                        <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>ROW</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>STATUS</th>
                        {mappedFields.map((col) => (
                          <th key={col} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => {
                        const raw = table.rows.find((x) => x.rowNumber === r.rowNumber);
                        const st = statusStyle[r.status];
                        return (
                          <React.Fragment key={r.rowNumber}>
                            <tr style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)" }}>{r.rowNumber}</td>
                              <td style={{ padding: "8px 14px" }}>
                                <span style={{ padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                              </td>
                              {mappedFields.map((col) => (
                                <td key={col} style={{ padding: "8px 14px", fontSize: 13, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {cellText(raw?.cells[mapping.fieldToHeader[col]]) || <span style={{ color: "#cbd5e1" }}>—</span>}
                                </td>
                              ))}
                            </tr>
                            {r.message && (
                              <tr>
                                <td />
                                <td colSpan={mappedFields.length + 1} style={{ padding: "0 14px 8px", fontSize: 12, color: st.color }}>{r.message}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Posting account for rows that are already paid */}
              {needsAccount && (
                <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", padding: 16, marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Paid and Partial rows were received into *
                  </label>
                  {postable.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#ef4444" }}>{accountsProblem}</div>
                  ) : (
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                      style={{ width: "100%", maxWidth: 360, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "white" }}>
                      <option value="">Select account</option>
                      {postable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    Each of those rows posts a cash-in entry dated its Paid Date, exactly like Mark Paid does.
                  </div>
                </div>
              )}

              <div style={{ background: "#fffbeb", borderRadius: 10, padding: 14, border: "1px solid #fde68a", marginBottom: 16, fontSize: 13, color: "#92400e", display: "flex", gap: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  Only rows marked <strong>Ready</strong> are written. Duplicates (already in the system, or repeated in this file) and rows with errors are skipped.
                  Existing records are checked up to the first 1,000 rows the system returns.
                </div>
              </div>

              {def.money && validated.summary.ready > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ width: 16, height: 16 }} />
                  I have checked these totals against my file
                </label>
              )}
            </>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={reset}
              disabled={importing}
              style={{ padding: "11px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}
            >
              Change File
            </button>
            {validated && (
              <button
                onClick={handleImport}
                disabled={importing || !!importBlockReason()}
                title={importBlockReason()}
                style={{
                  flex: 1, padding: "11px",
                  background: importing || importBlockReason() ? "#c4a0a8" : meta.color,
                  color: "white", border: "none", borderRadius: 8,
                  cursor: importing || importBlockReason() ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {importing ? (
                  <>
                    <RefreshCw size={16} style={{ animation: "spin 0.8s linear infinite" }} />
                    Importing {progress ? `${progress.done}/${progress.total}` : ""}…
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    Import {readyRows.length} {meta.label} Record{readyRows.length === 1 ? "" : "s"}
                  </>
                )}
              </button>
            )}
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && results && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Rows in file", value: results.total, color: "#475569" },
              { label: "Imported", value: results.success, color: "#10b981" },
              { label: "Duplicates skipped", value: results.duplicates, color: results.duplicates > 0 ? "#b45309" : "#10b981" },
              { label: "Failed / invalid", value: results.failed, color: results.failed > 0 ? "#ef4444" : "#10b981" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color, marginBottom: 6 }}>{value}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {results.success > 0 && (
            <div style={{ background: "#ecfdf5", borderRadius: 12, padding: 20, border: "1px solid #bbf7d0", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <CheckCircle size={24} color="#10b981" />
              <div>
                <div style={{ fontWeight: 600, color: "#065f46", fontSize: 15 }}>Import finished</div>
                <div style={{ fontSize: 13, color: "#047857", marginTop: 2 }}>
                  {results.success} {meta.label} records added. Import batch <code>{results.batchId}</code> is stored on each record.
                </div>
              </div>
            </div>
          )}

          {results.errors.length > 0 && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 16 }}>
              <button
                onClick={() => setExpandedErrors((p) => !p)}
                style={{ width: "100%", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertCircle size={16} color="#f59e0b" />
                  {results.errors.length} rows had issues
                </div>
                {expandedErrors ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {expandedErrors && (
                <div style={{ borderTop: "1px solid var(--border)", maxHeight: 240, overflowY: "auto" }}>
                  {results.errors.map((err, i) => (
                    <div key={i} style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", fontSize: 13, color: "#ef4444", display: "flex", alignItems: "center", gap: 8 }}>
                      <XCircle size={13} />
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={reset}
              style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white", fontWeight: 500 }}
            >
              Import Another File
            </button>
            <button
              onClick={() => {
                const next = TYPE_KEYS[(TYPE_KEYS.indexOf(activeType) + 1) % TYPE_KEYS.length];
                setActiveType(next);
                reset();
              }}
              style={{ flex: 1, padding: "11px", background: meta.color, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}
            >
              Import Next Module →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
