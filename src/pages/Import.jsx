import React, { useState, useRef } from "react";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import {
  Upload, CheckCircle, XCircle,
  AlertCircle, ChevronDown, ChevronRight,
  Download, RefreshCw, Eye
} from "lucide-react";

const TEMPLATES = {
  students: {
    label: "Students / Contacts",
    color: "#4f46e5",
    bg: "#eef2ff",
    collection: "students",
    description: "Export from Manager.io: Customers tab → click Export",
    requiredColumns: ["name"],
    columnMap: {
      name: ["name", "customer", "contact name", "full name", "contact"],
      email: ["email", "email address"],
      parentPhone: ["phone", "mobile", "telephone", "phone number"],
      parentName: ["contact person", "parent", "guardian", "parent name"],
      address: ["address", "billing address", "street"],
      grade: ["grade", "class", "level", "year"],
      studentId: ["code", "customer code", "id", "reference", "ref"],
      monthlyFee: ["balance", "amount", "fee", "monthly fee"],
    },
    transform: (row) => ({
      ...row,
      recurringFee: false,
      branchId: "",
      createdAt: serverTimestamp(),
    }),
  },
  employees: {
    label: "Employees / Staff",
    color: "#2a8c7a",
    bg: "#e6f4f1",
    collection: "employees",
    description: "Export from Manager.io: Employees tab → click Export",
    requiredColumns: ["name"],
    columnMap: {
      name: ["name", "employee name", "full name", "employee"],
      email: ["email", "email address"],
      phone: ["phone", "mobile", "telephone"],
      role: ["position", "job title", "department", "role", "designation"],
      salary: ["salary", "wage", "pay", "monthly salary"],
      joinDate: ["start date", "hire date", "join date"],
    },
    transform: (row) => ({
      ...row,
      recurringPayslip: false,
      branchId: "",
      createdAt: serverTimestamp(),
    }),
  },
  invoices: {
    label: "Invoices & Fees",
    color: "#10b981",
    bg: "#ecfdf5",
    collection: "invoices",
    description: "Export from Manager.io: Sales Invoices tab → click Export",
    requiredColumns: ["studentName"],
    columnMap: {
      studentName: ["customer", "name", "contact", "bill to", "client"],
      amount: ["total", "amount", "amount due", "invoice total"],
      dueDate: ["due date", "payment due", "due"],
      status: ["status", "paid", "payment status"],
      month: ["description", "memo", "reference", "period"],
      notes: ["notes", "memo", "description"],
    },
    transform: (row) => ({
      ...row,
      status: row.status?.toLowerCase()?.includes("paid") ? "paid" : "pending",
      branchId: "",
      lineItems: row.amount ? [{ description: "Imported Fee", amount: row.amount }] : [],
      createdAt: serverTimestamp(),
    }),
  },
  expenses: {
    label: "Expenses",
    color: "#ef4444",
    bg: "#fef2f2",
    collection: "expenses",
    description: "Export from Manager.io: Expense Claims → Export",
    requiredColumns: ["description"],
    columnMap: {
      description: ["description", "memo", "details", "particulars", "item"],
      amount: ["total", "amount", "net amount"],
      date: ["date", "expense date", "transaction date"],
      category: ["account", "category", "expense account", "type"],
      notes: ["notes", "reference", "ref no"],
    },
    transform: (row) => ({
      ...row,
      branchId: "",
      createdAt: serverTimestamp(),
    }),
  },
  accounts: {
    label: "Chart of Accounts",
    color: "#7a2535",
    bg: "#f5eaec",
    collection: "accounts",
    description: "Export from Manager.io: Chart of Accounts tab → Export",
    requiredColumns: ["name"],
    columnMap: {
      code: ["code", "account code", "number", "account number"],
      name: ["name", "account name", "account", "description"],
      type: ["type", "account type", "category", "classification"],
      balance: ["balance", "opening balance", "debit balance"],
      description: ["description", "notes", "memo"],
    },
    transform: (row) => ({
      ...row,
      subType: row.type || "",
      createdAt: serverTimestamp(),
    }),
  },
  payments: {
    label: "Payments & Transactions",
    color: "#f59e0b",
    bg: "#fffbeb",
    collection: "payments",
    description: "Export from Manager.io: Bank Accounts → Transactions",
    requiredColumns: ["amount"],
    columnMap: {
      description: ["description", "memo", "narration", "particulars"],
      amount: ["amount", "debit", "credit", "net amount"],
      date: ["date", "transaction date", "value date"],
      type: ["type", "transaction type", "dr/cr"],
      account: ["account", "bank account", "cash account"],
      reference: ["reference", "ref", "cheque no", "voucher no"],
      category: ["category", "account", "expense account"],
    },
    transform: (row) => ({
      ...row,
      type:
        row.type?.toLowerCase()?.includes("debit") ||
        row.type?.toLowerCase()?.includes("out")
          ? "cash_out"
          : "cash_in",
      branchId: "",
      createdAt: serverTimestamp(),
    }),
  },
};

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function mapColumns(rows, columnMap) {
  if (!rows || rows.length === 0) return [];
  const fileHeaders = Object.keys(rows[0]).map((h) => h.toLowerCase().trim());
  const fieldToFileHeader = {};

  for (const [field, aliases] of Object.entries(columnMap)) {
    for (const alias of aliases) {
      const found = fileHeaders.find(
        (h) => h === alias.toLowerCase() || h.includes(alias.toLowerCase())
      );
      if (found) {
        const originalHeader = Object.keys(rows[0]).find(
          (h) => h.toLowerCase().trim() === found
        );
        fieldToFileHeader[field] = originalHeader;
        break;
      }
    }
  }

  return rows
    .map((row) => {
      const mapped = {};
      for (const [field, header] of Object.entries(fieldToFileHeader)) {
        if (header && row[header] !== undefined && row[header] !== "") {
          mapped[field] = String(row[header]).trim();
        }
      }
      return mapped;
    })
    .filter((row) => Object.keys(row).length > 0);
}

function downloadTemplate(type) {
  const template = TEMPLATES[type];
  const headers = Object.values(template.columnMap).map((aliases) => aliases[0]);
  const examples = {
    students: ["Ahmad Khan", "ahmad@gmail.com", "+923001234567", "Mr. Khan", "House 5", "Grade 5", "STU-001", "5000"],
    employees: ["Sarah Ahmed", "sarah@zmi.edu", "+923009876543", "Teacher", "25000", "2024-01-01"],
    invoices: ["Ahmad Khan", "5000", "2026-03-31", "paid", "March 2026", "Monthly fee"],
    expenses: ["Office Rent", "15000", "2026-03-01", "Rent", "March 2026"],
    accounts: ["1001", "Cash in Hand", "Assets", "50000", "Petty cash"],
    payments: ["Salary payment", "25000", "2026-03-01", "cash_out", "Main Account", "CHQ-001", "Salaries"],
  };
  const ws = XLSX.utils.aoa_to_sheet([headers, examples[type]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, `ZMI_${type}_template.xlsx`);
}

export default function Import() {
  const [activeType, setActiveType] = useState("students");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [mappedData, setMappedData] = useState([]);
  const [step, setStep] = useState(1);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [expandedErrors, setExpandedErrors] = useState(false);
  const fileRef = useRef();

  const template = TEMPLATES[activeType];

  const handleFileChange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setResults(null);
    setPreview([]);
    setMappedData([]);
    setStep(1);
    try {
      const rows = await parseFile(f);
      const mapped = mapColumns(rows, template.columnMap);
      setPreview(rows.slice(0, 5));
      setMappedData(mapped);
      setStep(2);
      toast.success(`Parsed ${rows.length} rows from file`);
    } catch (err) {
      toast.error("Could not read file. Make sure it is a valid CSV or Excel file.");
    }
  };

  const handleImport = async () => {
    if (mappedData.length === 0) return toast.error("No data to import");
    setImporting(true);
    let success = 0;
    let failed = 0;
    const errors = [];

    for (const row of mappedData) {
      try {
        const hasRequired = template.requiredColumns.every((col) => row[col]);
        if (!hasRequired) {
          failed++;
          errors.push(`Skipped — missing: ${template.requiredColumns.join(", ")}`);
          continue;
        }
        const transformed = template.transform(row);
        await addDoc(collection(db, template.collection), transformed);
        success++;
      } catch (err) {
        failed++;
        errors.push(`Error: ${err.message}`);
      }
    }

    setResults({ success, failed, errors, total: mappedData.length });
    setStep(3);
    setImporting(false);
    if (success > 0) toast.success(`Imported ${success} records!`);
    if (failed > 0) toast.error(`${failed} records failed`);
  };

  const reset = () => {
    setFile(null);
    setPreview([]);
    setMappedData([]);
    setStep(1);
    setResults(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Import Data</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
          Import existing data from Manager.io, Excel, or CSV files
        </p>
      </div>

      {/* Type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10, marginBottom: 24 }}>
        {Object.entries(TEMPLATES).map(([key, t]) => (
          <button
            key={key}
            onClick={() => { setActiveType(key); reset(); }}
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
        ))}
      </div>

      {/* Steps indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        {[{ n: 1, label: "Upload File" }, { n: 2, label: "Preview & Confirm" }, { n: 3, label: "Done" }].map(({ n, label }, i) => (
          <React.Fragment key={n}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: step >= n ? template.color : "#e2e8f0",
                color: step >= n ? "white" : "var(--text-muted)",
                fontSize: 13, fontWeight: 700, flexShrink: 0,
              }}>
                {step > n ? <CheckCircle size={14} /> : n}
              </div>
              <span style={{
                fontSize: 13,
                fontWeight: step === n ? 600 : 400,
                color: step === n ? template.color : "var(--text-muted)",
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            </div>
            {i < 2 && (
              <div style={{ flex: 1, height: 2, background: step > n ? template.color : "#e2e8f0", maxWidth: 60 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Instructions */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>How to export from Manager.io</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
              {template.description}. Supported: <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 6 }}>Required:</span>
              {template.requiredColumns.map((c) => (
                <span key={c} style={{ padding: "2px 8px", background: template.bg, color: template.color, borderRadius: 4, fontSize: 12, fontWeight: 600, marginRight: 4 }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => downloadTemplate(activeType)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, fontWeight: 500, flexShrink: 0 }}
          >
            <Download size={14} /> Download Template
          </button>
        </div>
      </div>

      {/* Step 1 — Upload */}
      {step === 1 && (
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: "2px dashed var(--border)", borderRadius: 12,
            padding: 48, textAlign: "center", cursor: "pointer", background: "white",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = template.color)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: template.bg,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <Upload size={24} color={template.color} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
            Click to upload {template.label} file
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Supports .xlsx, .xls, .csv from Manager.io or any spreadsheet
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && mappedData.length > 0 && (
        <div>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Rows found", value: mappedData.length, color: template.color },
              { label: "File", value: file?.name?.slice(0, 18) + (file?.name?.length > 18 ? "..." : ""), color: "#475569" },
              { label: "Fields mapped", value: Object.keys(template.columnMap).length, color: "#10b981" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "white", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Preview table */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <Eye size={15} color="var(--text-muted)" />
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Preview — first {Math.min(5, mappedData.length)} of {mappedData.length} rows
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {Object.keys(template.columnMap).map((col) => (
                      <th key={col} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedData.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      {Object.keys(template.columnMap).map((col) => (
                        <td key={col} style={{ padding: "10px 14px", fontSize: 13, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row[col] || <span style={{ color: "#cbd5e1" }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Warning */}
          <div style={{ background: "#fffbeb", borderRadius: 10, padding: 14, border: "1px solid #fde68a", marginBottom: 20, fontSize: 13, color: "#92400e" }}>
            <strong>Note:</strong> The importer auto-detects column names. Fields showing "—" were not found in your file and will be left blank.
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={reset}
              style={{ padding: "11px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}
            >
              Change File
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              style={{
                flex: 1, padding: "11px",
                background: importing ? "#c4a0a8" : template.color,
                color: "white", border: "none", borderRadius: 8,
                cursor: importing ? "not-allowed" : "pointer",
                fontWeight: 700, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {importing ? (
                <>
                  <RefreshCw size={16} style={{ animation: "spin 0.8s linear infinite" }} />
                  Importing {mappedData.length} records...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Import {mappedData.length} {template.label} Records
                </>
              )}
            </button>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Step 3 — Results */}
      {step === 3 && results && (
        <div>
          {/* Result cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Total Processed", value: results.total, color: "#475569" },
              { label: "Successfully Imported", value: results.success, color: "#10b981" },
              { label: "Failed / Skipped", value: results.failed, color: results.failed > 0 ? "#ef4444" : "#10b981" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color, marginBottom: 6 }}>{value}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Success banner */}
          {results.success > 0 && (
            <div style={{ background: "#ecfdf5", borderRadius: 12, padding: 20, border: "1px solid #bbf7d0", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <CheckCircle size={24} color="#10b981" />
              <div>
                <div style={{ fontWeight: 600, color: "#065f46", fontSize: 15 }}>Import Successful!</div>
                <div style={{ fontSize: 13, color: "#047857", marginTop: 2 }}>
                  {results.success} {template.label} records added to your system.
                </div>
              </div>
            </div>
          )}

          {/* Errors */}
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
                const keys = Object.keys(TEMPLATES);
                const next = keys[(keys.indexOf(activeType) + 1) % keys.length];
                setActiveType(next);
                reset();
              }}
              style={{ flex: 1, padding: "11px", background: template.color, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}
            >
              Import Next Module →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}