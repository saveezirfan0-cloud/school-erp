// src/utils/importParsing.js
//
// Pure parsing and validation for the Excel / CSV importer (ACC-10,
// CODE-28/29/30/31). Nothing here touches the database, so everything is
// unit-tested. The page (Import.jsx) reads the file, calls these helpers,
// shows a preview and only then writes the rows that validated.
//
// Principles
//  - Headers are matched by EXACT normalised name (case, spacing and
//    punctuation insensitive). No substring matching, and every source
//    column maps to at most one field.
//  - Money is parsed once (parseAmountCell) and validated; "Unpaid" can
//    never become paid; Dr/Cr and separate Debit / Credit columns are
//    honoured; nothing is guessed from a free-text hunch.
//  - Every row gets a status (ok / duplicate / error) with a message and
//    its spreadsheet row number, BEFORE anything is written.

import { parseAmountCell, parsePositiveAmount, toMinor, isIsoDate } from "./money";

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 60;
export const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024; // zip-bomb guard for .xlsx

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------

// "  Student  ID " / "student_id" / "Student-ID" -> "student id"
export function normalizeHeader(h) {
  return String(h ?? "")
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// For comparing values (names, descriptions, codes).
export const norm = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Cell -> trimmed string (Dates become YYYY-MM-DD, numbers plain).
export function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return dateToIso(v);
  return String(v).trim();
}

// Stored free text: trimmed, control characters removed, length-capped, and
// anything that would start a spreadsheet formula is defused with a leading
// apostrophe (the data is later exported to CSV / opened in Excel).
export function cleanText(v, max = 500) {
  // eslint-disable-next-line no-control-regex
  let s = cellText(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  if (/^[=+@]/.test(s) || /^-(?![\d.])/.test(s)) s = "'" + s;
  return s;
}

// ---------------------------------------------------------------
// CSV (RFC 4180: quotes, doubled quotes, embedded newlines)
// ---------------------------------------------------------------

export function parseCsv(text) {
  let src = String(text ?? "").replace(/^﻿/, "");
  // pick the delimiter from the first line
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",";

  const rows = [];
  let row = [];
  let field = "";
  inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
      if (rows.length > MAX_ROWS + 2) throw new Error(`Too many rows (limit ${MAX_ROWS})`);
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// matrix (array of arrays, row 0 = headers) -> { headers, rows:[{rowNumber, cells}] }
// Blank rows are dropped; duplicate headers get a numeric suffix.
export function matrixToTable(matrix, firstRowNumber = 1) {
  const m = (matrix || []).slice();
  while (m.length && m[0].every((c) => cellText(c) === "")) { m.shift(); firstRowNumber++; }
  if (m.length === 0) return { headers: [], rows: [] };
  const rawHeaders = m[0].map((h) => cellText(h));
  if (rawHeaders.filter(Boolean).length > MAX_COLUMNS) throw new Error(`Too many columns (limit ${MAX_COLUMNS})`);
  const seen = {};
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? `${base} (${seen[base]})` : base;
  });
  const rows = [];
  for (let r = 1; r < m.length; r++) {
    const line = m[r];
    if (line.every((c) => cellText(c) === "")) continue;
    const cells = {};
    headers.forEach((h, i) => { if (i < line.length) cells[h] = line[i]; });
    rows.push({ rowNumber: firstRowNumber + r, cells });
  }
  if (rows.length > MAX_ROWS) throw new Error(`Too many rows (${rows.length}, limit ${MAX_ROWS}). Split the file.`);
  return { headers, rows };
}

// ---------------------------------------------------------------
// File safety checks (run BEFORE the spreadsheet library sees the bytes)
// ---------------------------------------------------------------

// Sum of uncompressed sizes declared in a zip's central directory.
// Returns null when the buffer is not a readable zip.
export function zipUncompressedSize(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // find the End Of Central Directory record (scan back, max comment 64 KiB)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || dv.getUint32(offset, true) !== 0x02014b50) return null;
    total += dv.getUint32(offset + 24, true); // uncompressed size
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

// Returns an error string, or "" when the file may be read.
export function checkUploadMeta({ name, size, head }) {
  const lower = String(name || "").toLowerCase();
  if (!/\.(xlsx|csv)$/.test(lower)) return "Only .xlsx and .csv files are supported. Save .xls files as .xlsx first.";
  if (size > MAX_FILE_BYTES) return `File is too large (${(size / 1048576).toFixed(1)} MB). The limit is ${MAX_FILE_BYTES / 1048576} MB.`;
  if (size === 0) return "The file is empty.";
  if (lower.endsWith(".xlsx") && !(head && head[0] === 0x50 && head[1] === 0x4b)) return "This does not look like a real .xlsx file.";
  return "";
}

// ---------------------------------------------------------------
// Column mapping (exact normalised match, one column per field)
// ---------------------------------------------------------------

/**
 * @param {string[]} headers      file headers as they appear
 * @param {Object<string,string[]>} columnMap  field -> accepted header names, most preferred first
 * @returns {{ fieldToHeader: Object<string,string>, unmappedFields: string[], unusedHeaders: string[] }}
 */
export function buildMapping(headers, columnMap) {
  const normHeaders = headers.map((h) => ({ raw: h, n: normalizeHeader(h), used: false }));
  const fieldToHeader = {};
  for (const [field, aliases] of Object.entries(columnMap)) {
    outer: for (const alias of aliases) {
      const na = normalizeHeader(alias);
      for (const h of normHeaders) {
        if (!h.used && h.n === na) {
          fieldToHeader[field] = h.raw;
          h.used = true;
          break outer;
        }
      }
    }
  }
  return {
    fieldToHeader,
    unmappedFields: Object.keys(columnMap).filter((f) => !(f in fieldToHeader)),
    unusedHeaders: normHeaders.filter((h) => !h.used && h.raw).map((h) => h.raw),
  };
}

// rows from matrixToTable + a mapping -> [{ rowNumber, values: {field: rawCell} }]
export function applyMapping(rows, fieldToHeader) {
  return rows.map((r) => {
    const values = {};
    for (const [field, header] of Object.entries(fieldToHeader)) {
      const v = r.cells[header];
      if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) values[field] = v;
    }
    return { rowNumber: r.rowNumber, values };
  }).filter((r) => Object.keys(r.values).length > 0);
}

// ---------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------

// Excel stores dates as UTC midnight (ExcelJS) or as day counts.
function dateToIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// -> "YYYY-MM-DD" or null. Accepts Date objects, Excel serial numbers,
// YYYY-MM-DD / YYYY/MM/DD and DD/MM/YYYY or DD-MM-YYYY (day first).
export function parseDateCell(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) { const s = dateToIso(v); return isIsoDate(s) ? s : null; }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return null; // ~1954 to ~2118
    const s = dateToIso(new Date(Math.round((v - 25569) * 86400000)));
    return isIsoDate(s) ? s : null;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) { const s = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; return isIsoDate(s) ? s : null; }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) { const s = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return isIsoDate(s) ? s : null; }
  return null;
}

const MONTH_LOOKUP = (() => {
  const map = {};
  MONTH_NAMES.forEach((name, i) => {
    map[name.toLowerCase()] = i;
    map[name.slice(0, 3).toLowerCase()] = i;
  });
  map.sept = 8;
  return map;
})();

// "March 2026" / "Mar-26 fee" / 2026-03-01 (Date) / "03/2026" -> { month: "March", year: 2026 } (either may be null)
export function parseMonthYear(v) {
  if (v instanceof Date) {
    return { month: MONTH_NAMES[v.getUTCMonth()], year: v.getUTCFullYear() };
  }
  const t = cellText(v);
  if (!t) return { month: null, year: null };
  let month = null, year = null;
  const word = t.toLowerCase().match(/[a-z]+/g) || [];
  for (const w of word) {
    if (w in MONTH_LOOKUP) { month = MONTH_NAMES[MONTH_LOOKUP[w]]; break; }
  }
  const y = t.match(/\b(20\d{2})\b/);
  if (y) year = Number(y[1]);
  if (!month) {
    const m1 = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
    const m2 = t.match(/^(\d{1,2})\/(\d{4})$/);
    if (m1 && +m1[2] >= 1 && +m1[2] <= 12) { month = MONTH_NAMES[+m1[2] - 1]; year = +m1[1]; }
    else if (m2 && +m2[1] >= 1 && +m2[1] <= 12) { month = MONTH_NAMES[+m2[1] - 1]; year = +m2[2]; }
  }
  return { month, year };
}

const STATUS_PAID = new Set(["paid", "paid in full", "fully paid", "settled", "received", "complete", "completed"]);
const STATUS_PENDING = new Set(["unpaid", "not paid", "pending", "open", "outstanding", "due", "overdue", "unsettled", "not yet paid", "awaiting payment"]);
const STATUS_PARTIAL = new Set(["partial", "partially paid", "part paid", "part payment", "partly paid"]);

// Exact phrases only. "Unpaid", "Not paid" and "Partially paid" must never read as paid.
export function parseInvoiceStatus(v) {
  const t = normalizeHeader(cellText(v));
  if (!t) return { ok: true, status: "pending", explicit: false };
  if (STATUS_PAID.has(t)) return { ok: true, status: "paid", explicit: true };
  if (STATUS_PENDING.has(t)) return { ok: true, status: "pending", explicit: true };
  if (STATUS_PARTIAL.has(t)) return { ok: true, status: "partial", explicit: true };
  return { ok: false, error: `Unrecognised status "${cellText(v).slice(0, 30)}" (use Paid, Unpaid, Partial or Pending)` };
}

const DIR_OUT = new Set(["debit", "dr", "out", "cash out", "cashout", "withdrawal", "payment", "paid", "paid out", "expense", "spent"]);
const DIR_IN = new Set(["credit", "cr", "in", "cash in", "cashin", "deposit", "receipt", "received", "income", "paid in"]);

// Bank-statement convention: DEBIT / Dr / withdrawal = money OUT of the
// account, CREDIT / Cr / deposit = money IN. Whole-word matches only
// ("Outstanding" is not "out").
export function parseDirection(v) {
  const t = normalizeHeader(cellText(v));
  if (DIR_OUT.has(t)) return "cash_out";
  if (DIR_IN.has(t)) return "cash_in";
  return null;
}

function parseMoneyField(raw, label, { allowNegative = false } = {}) {
  const n = parseAmountCell(raw);
  if (n === null) return { error: `${label} "${cellText(raw).slice(0, 20)}" is not a number` };
  if (!allowNegative && n < 0) return { error: `${label} cannot be negative` };
  return { value: n };
}

// ---------------------------------------------------------------
// Templates: accepted headers + per-row validation
// ---------------------------------------------------------------

const ACCOUNT_TYPE_LOOKUP = {
  asset: "Assets", assets: "Assets",
  liability: "Liabilities", liabilities: "Liabilities",
  equity: "Equity", capital: "Equity",
  income: "Income", revenue: "Income", incomes: "Income",
  expense: "Expenses", expenses: "Expenses",
};
const ACCOUNT_SUBTYPES = {
  Assets: ["Current Assets", "Fixed Assets", "Bank & Cash", "Accounts Receivable", "Other Assets"],
  Liabilities: ["Current Liabilities", "Long-term Liabilities", "Accounts Payable", "Other Liabilities"],
  Equity: ["Owner's Equity", "Retained Earnings", "Capital"],
  Income: ["Fee Income", "Other Income", "Grants & Donations"],
  Expenses: ["Salaries & Wages", "Rent & Utilities", "Supplies", "Maintenance", "Transport", "Other Expenses"],
};

const money = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export const IMPORT_TYPES = {
  students: {
    collection: "students",
    requiredFields: ["name"],
    columnMap: {
      name: ["name", "student name", "customer", "customer name", "contact name", "full name", "contact"],
      studentId: ["student id", "studentid", "code", "customer code", "id", "reference", "ref"],
      grade: ["grade", "class", "level"],
      parentName: ["parent", "parent name", "guardian", "guardian name", "contact person"],
      parentPhone: ["phone", "mobile", "telephone", "phone number", "parent phone"],
      email: ["email", "email address"],
      address: ["address", "billing address", "street"],
      monthlyFee: ["monthly fee", "fee", "tuition fee"], // never "balance": a parent's outstanding balance is not the monthly fee
    },
    example: { name: "Ahmad Khan", studentId: "STU-001", grade: "Grade 5", parentName: "Mr. Khan", parentPhone: "+923001234567", email: "ahmad@example.com", address: "House 5", monthlyFee: "5000" },
    validate(values) {
      const errors = [], warnings = [];
      const name = cleanText(values.name, 120);
      if (!name) errors.push("Name is required");
      const rec = {
        name, studentId: cleanText(values.studentId, 60), grade: cleanText(values.grade, 60),
        parentName: cleanText(values.parentName, 120), parentPhone: cleanText(values.parentPhone, 40),
        email: cleanText(values.email, 120), address: cleanText(values.address, 300),
        recurringFee: false, branchId: "",
      };
      if (values.monthlyFee !== undefined) {
        const f = parseMoneyField(values.monthlyFee, "Monthly fee");
        if (f.error) errors.push(f.error); else if (f.value > 0) rec.monthlyFee = f.value;
      }
      return { errors, warnings, record: rec };
    },
    keys(rec) {
      const k = [];
      if (rec.studentId) k.push(`id:${norm(rec.studentId)}`);
      k.push(`np:${norm(rec.name)}|${String(rec.parentPhone || "").replace(/\D/g, "")}`);
      return k;
    },
    existingKeys(doc) {
      const k = [`np:${norm(doc.name)}|${String(doc.parentPhone || "").replace(/\D/g, "")}`];
      if (doc.studentId) k.push(`id:${norm(doc.studentId)}`);
      return k;
    },
  },

  employees: {
    collection: "employees",
    requiredFields: ["name"],
    columnMap: {
      name: ["name", "employee name", "full name", "employee"],
      role: ["role", "position", "job title", "designation", "department"],
      phone: ["phone", "mobile", "telephone"],
      email: ["email", "email address"],
      salary: ["salary", "monthly salary", "wage", "pay"],
      joinDate: ["join date", "start date", "hire date"],
    },
    example: { name: "Sarah Ahmed", role: "Teacher", phone: "+923009876543", email: "sarah@example.com", salary: "25000", joinDate: "2024-01-01" },
    validate(values) {
      const errors = [], warnings = [];
      const name = cleanText(values.name, 120);
      if (!name) errors.push("Name is required");
      const rec = {
        name, role: cleanText(values.role, 80), phone: cleanText(values.phone, 40), email: cleanText(values.email, 120),
        recurringPayslip: false, branchId: "",
      };
      if (values.salary !== undefined) {
        const s = parseMoneyField(values.salary, "Salary");
        if (s.error) errors.push(s.error); else if (s.value > 0) rec.salary = s.value;
      }
      if (values.joinDate !== undefined) {
        const d = parseDateCell(values.joinDate);
        if (!d) warnings.push("Join date not understood, left blank"); else rec.joinDate = d;
      }
      return { errors, warnings, record: rec };
    },
    keys(rec) {
      const k = [];
      if (rec.email) k.push(`em:${norm(rec.email)}`);
      k.push(`np:${norm(rec.name)}|${String(rec.phone || "").replace(/\D/g, "")}`);
      return k;
    },
    existingKeys(doc) {
      const k = [`np:${norm(doc.name)}|${String(doc.phone || "").replace(/\D/g, "")}`];
      if (doc.email) k.push(`em:${norm(doc.email)}`);
      return k;
    },
  },

  invoices: {
    collection: "invoices",
    requiredFields: ["amount", "month"],
    requiredAnyOf: [["studentName", "studentCode"]],
    money: true,
    columnMap: {
      studentName: ["student", "student name", "customer", "name", "bill to", "client"],
      studentCode: ["student id", "studentid", "student code", "roll no"],
      amount: ["amount", "total", "invoice total", "invoice amount", "fee"],
      month: ["month", "period", "fee month", "fee period"],
      year: ["year"],
      dueDate: ["due date", "payment due", "due"],
      status: ["status", "payment status", "paid status"],
      paidAmount: ["paid amount", "amount paid", "received amount"],
      paidDate: ["paid date", "payment date", "date paid", "received date"],
      notes: ["notes", "memo", "description"],
    },
    example: { studentName: "Ahmad Khan", studentCode: "STU-001", amount: "5000", month: "March 2026", year: "2026", dueDate: "2026-03-31", status: "Unpaid", paidAmount: "", paidDate: "", notes: "Monthly fee" },
    validate(values, ctx) {
      const errors = [], warnings = [];
      // student: by Student ID if given, otherwise by exact name; ambiguity is an error
      const students = ctx.students || [];
      let student = null;
      const code = norm(cellText(values.studentCode));
      const nm = norm(cellText(values.studentName));
      if (!nm && !code) errors.push("Student is required");
      else if (code) {
        const hits = students.filter((s) => norm(s.studentId) === code);
        if (hits.length === 1) student = hits[0]; else errors.push(hits.length ? `Student ID "${cellText(values.studentCode)}" matches ${hits.length} students` : `No student with ID "${cellText(values.studentCode)}"`);
      } else {
        const hits = students.filter((s) => norm(s.name) === nm);
        if (hits.length === 1) student = hits[0];
        else errors.push(hits.length ? `${hits.length} students are named "${cellText(values.studentName)}", add a Student ID column` : `No student named "${cellText(values.studentName)}". Import students first.`);
      }

      const amt = values.amount === undefined ? { error: "Amount is required" } : parseMoneyField(values.amount, "Amount");
      if (amt.error) errors.push(amt.error); else if (amt.value <= 0) errors.push("Amount must be greater than zero");

      // month / year
      const my = parseMonthYear(values.month);
      let month = my.month;
      let year = my.year;
      if (values.year !== undefined) {
        const y = Number(cellText(values.year));
        if (Number.isInteger(y) && y >= 2000 && y <= 2100) year = y; else errors.push(`Year "${cellText(values.year)}" is not valid`);
      }
      if (!month) errors.push("Month not understood (use e.g. March 2026)");
      if (month && !year) errors.push("Year is missing (put it in the Month or Year column)");

      let dueDate = "";
      if (values.dueDate !== undefined) {
        const d = parseDateCell(values.dueDate);
        if (!d) warnings.push("Due date not understood, left blank"); else dueDate = d;
      }

      const st = parseInvoiceStatus(values.status);
      if (!st.ok) errors.push(st.error);
      let status = st.ok ? st.status : "pending";
      let paidAmount = 0;
      let paidDate = "";
      if (status === "paid" || status === "partial") {
        if (values.paidDate === undefined) errors.push("Paid rows need a Paid Date so the cash lands in the right period");
        else {
          const pd = parseDateCell(values.paidDate);
          if (!pd) errors.push("Paid date not understood"); else paidDate = pd;
        }
      }
      if (status === "paid") {
        paidAmount = amt.value || 0;
        if (values.paidAmount !== undefined) {
          const p = parseMoneyField(values.paidAmount, "Paid amount");
          if (p.error) errors.push(p.error); else if (!amt.error && toMinor(p.value) !== toMinor(amt.value)) errors.push("Status is Paid but Paid amount differs from Amount (use Partial)");
        }
      } else if (status === "partial") {
        const p = values.paidAmount === undefined ? { error: "Partial rows need a Paid amount" } : parseMoneyField(values.paidAmount, "Paid amount");
        if (p.error) errors.push(p.error);
        else if (p.value <= 0 || (!amt.error && toMinor(p.value) >= toMinor(amt.value))) errors.push("Paid amount must be above zero and below the invoice amount");
        else paidAmount = p.value;
      } else if (values.paidAmount !== undefined) {
        const p = parseAmountCell(values.paidAmount);
        if (p !== null && p > 0) warnings.push("Paid amount ignored because the status is not Paid or Partial");
      }

      const rec = student ? {
        studentId: student.id, studentName: student.name, parentPhone: student.parentPhone || "",
        branchId: student.branchId || "", month, year, dueDate, notes: cleanText(values.notes, 300),
        amount: amt.value, lineItems: amt.value ? [{ description: "Imported Fee", amount: amt.value }] : [],
        status, paidAmount, paidDate,
      } : null;
      return { errors, warnings, record: rec };
    },
    keys(rec) { return [`${rec.studentId}|${norm(rec.month)}|${Number(rec.year)}`]; },
    existingKeys(doc) { return doc.studentId ? [`${doc.studentId}|${norm(doc.month)}|${Number(doc.year)}`] : []; },
  },

  expenses: {
    collection: "expenses",
    requiredFields: ["description", "amount", "date"],
    money: true,
    columnMap: {
      description: ["description", "memo", "details", "particulars", "item"],
      amount: ["amount", "total", "net amount"],
      date: ["date", "expense date", "transaction date"],
      category: ["category", "expense account", "type"],
      notes: ["notes", "reference", "ref no"],
    },
    example: { description: "Office Rent", amount: "15000", date: "2026-03-01", category: "Rent", notes: "March 2026" },
    validate(values) {
      const errors = [], warnings = [];
      const description = cleanText(values.description, 200);
      if (!description) errors.push("Description is required");
      const amt = values.amount === undefined ? { error: "Amount is required" } : parseMoneyField(values.amount, "Amount");
      if (amt.error) errors.push(amt.error); else if (amt.value <= 0) errors.push("Amount must be greater than zero");
      const date = values.date === undefined ? null : parseDateCell(values.date);
      if (!date) errors.push(values.date === undefined ? "Date is required" : "Date not understood (use YYYY-MM-DD)");
      const rec = { description, amount: amt.value, date: date || "", category: cleanText(values.category, 60) || "Other", notes: cleanText(values.notes, 300), branchId: "" };
      return { errors, warnings, record: rec };
    },
    keys(rec) { return [`${rec.date}|${toMinor(rec.amount)}|${norm(rec.description)}`]; },
    existingKeys(doc) { return [`${doc.date}|${toMinor(doc.amount)}|${norm(doc.description)}`]; },
  },

  accounts: {
    collection: "accounts",
    requiredFields: ["name", "type"],
    columnMap: {
      code: ["code", "account code", "number", "account number"],
      name: ["name", "account name", "account"],
      type: ["type", "account type", "classification"],
      subType: ["sub type", "subtype", "category"],
      balance: ["opening balance", "balance", "debit balance"],
      description: ["description", "notes", "memo"],
    },
    example: { code: "1001", name: "Cash in Hand", type: "Assets", subType: "Bank & Cash", balance: "50000", description: "Petty cash" },
    validate(values) {
      const errors = [], warnings = [];
      const name = cleanText(values.name, 120);
      if (!name) errors.push("Name is required");
      const type = ACCOUNT_TYPE_LOOKUP[norm(cellText(values.type))] || null;
      if (!type) errors.push(`Type "${cellText(values.type).slice(0, 20)}" must be Assets, Liabilities, Equity, Income or Expenses`);
      let subType = "";
      if (values.subType !== undefined && type) {
        const want = norm(cellText(values.subType)).replace(/\band\b/g, "&");
        const hit = ACCOUNT_SUBTYPES[type].find((s) => norm(s).replace(/\band\b/g, "&") === want);
        if (hit) subType = hit; else errors.push(`Sub-type "${cellText(values.subType).slice(0, 30)}" is not valid for ${type}`);
      }
      let balance = 0;
      if (values.balance !== undefined) {
        const b = parseMoneyField(values.balance, "Balance", { allowNegative: true });
        if (b.error) errors.push(b.error); else balance = b.value;
      }
      const rec = { code: cleanText(values.code, 30), name, type: type || "", subType, balance, description: cleanText(values.description, 300) };
      return { errors, warnings, record: rec };
    },
    keys(rec) { const k = [`name:${norm(rec.name)}`]; if (rec.code) k.push(`code:${norm(rec.code)}`); return k; },
    existingKeys(doc) { const k = [`name:${norm(doc.name)}`]; if (doc.code) k.push(`code:${norm(doc.code)}`); return k; },
  },

  payments: {
    collection: "payments",
    requiredFields: ["account", "date"],
    requiredAnyOf: [["amount", "debit", "credit"]],
    money: true,
    columnMap: {
      date: ["date", "transaction date", "value date"],
      account: ["account", "bank account", "cash account"],
      description: ["description", "memo", "narration", "particulars"],
      type: ["type", "transaction type", "dr cr", "drcr"],
      amount: ["amount", "net amount", "value"],
      debit: ["debit", "debit amount", "withdrawal", "withdrawals", "paid out", "money out"],
      credit: ["credit", "credit amount", "deposit", "deposits", "paid in", "money in", "received"],
      reference: ["reference", "ref", "cheque no", "voucher no"],
      category: ["category", "expense account"],
    },
    example: { date: "2026-03-01", account: "Cash in Hand", description: "Salary payment", type: "Debit", amount: "25000", debit: "", credit: "", reference: "CHQ-001", category: "Salary Payment" },
    validate(values, ctx) {
      const errors = [], warnings = [];
      const date = values.date === undefined ? null : parseDateCell(values.date);
      if (!date) errors.push(values.date === undefined ? "Date is required" : "Date not understood (use YYYY-MM-DD)");

      // account must be an existing Bank & Cash account, matched by exact name
      let acct = null;
      const an = norm(cellText(values.account));
      if (!an) errors.push("Account is required");
      else {
        const hits = (ctx.cashAccounts || []).filter((a) => norm(a.name) === an);
        if (hits.length === 1) acct = hits[0];
        else errors.push(hits.length ? `More than one account is named "${cellText(values.account)}"` : `No Bank & Cash account named "${cellText(values.account)}"`);
      }

      // direction + amount: Debit/Credit columns, Dr/Cr type, or a signed amount
      let type = null;
      let amount = null;
      const hasDebit = values.debit !== undefined;
      const hasCredit = values.credit !== undefined;
      if (hasDebit || hasCredit) {
        const d = hasDebit ? parseMoneyField(values.debit, "Debit") : { value: 0 };
        const c = hasCredit ? parseMoneyField(values.credit, "Credit") : { value: 0 };
        if (d.error) errors.push(d.error);
        else if (c.error) errors.push(c.error);
        else if (d.value > 0 && c.value > 0) errors.push("Row has both a Debit and a Credit amount");
        else if (d.value > 0) { type = "cash_out"; amount = d.value; }
        else if (c.value > 0) { type = "cash_in"; amount = c.value; }
        else errors.push("Debit and Credit are both empty or zero");
        if (values.amount !== undefined && !errors.length) warnings.push("Amount column ignored because Debit/Credit columns are present");
      } else if (values.amount === undefined) {
        errors.push("Amount (or Debit/Credit) is required");
      } else {
        const a = parseMoneyField(values.amount, "Amount", { allowNegative: true });
        if (a.error) errors.push(a.error);
        else if (a.value === 0) errors.push("Amount must not be zero");
        else if (values.type !== undefined) {
          const dir = parseDirection(values.type);
          if (!dir) errors.push(`Type "${cellText(values.type).slice(0, 20)}" not understood (use Debit/Credit, Dr/Cr, In/Out)`);
          else if (a.value < 0) errors.push("Amount is negative but a Type is given. Use a positive amount with the Type.");
          else { type = dir; amount = a.value; }
        } else {
          // no Type column: the sign decides (negative = money out)
          type = a.value < 0 ? "cash_out" : "cash_in";
          amount = Math.abs(a.value);
          warnings.push(`No Type column: read as ${type === "cash_out" ? "money out (negative)" : "money in (positive)"}`);
        }
      }
      if (amount !== null && amount > 0) {
        const check = parsePositiveAmount(amount);
        if (!check.ok) errors.push(check.error);
      }
      const rec = acct && type && amount ? {
        type, account: acct.name, accountId: acct.id, amount, date: date || "",
        description: cleanText(values.description, 200) || "Imported payment",
        reference: cleanText(values.reference, 60), category: cleanText(values.category, 60) || "Other", branchId: "",
      } : null;
      return { errors, warnings, record: rec };
    },
    keys(rec) { return [`${rec.date}|${norm(rec.account)}|${rec.type}|${toMinor(rec.amount)}|${norm(rec.reference)}|${norm(rec.description)}`]; },
    existingKeys(doc) {
      if (doc.reversalOf) return [];
      return [`${doc.date}|${norm(doc.account)}|${doc.type}|${toMinor(doc.amount)}|${norm(doc.reference)}|${norm(doc.description)}`];
    },
  },
};

// Messages for required columns that were not found in the file.
export function missingRequired(type, fieldToHeader) {
  const t = IMPORT_TYPES[type];
  const out = [];
  for (const f of t.requiredFields || []) if (!(f in fieldToHeader)) out.push(`a "${t.columnMap[f][0]}" column`);
  for (const group of t.requiredAnyOf || []) {
    if (!group.some((f) => f in fieldToHeader)) out.push(`one of: ${group.map((f) => `"${t.columnMap[f][0]}"`).join(", ")}`);
  }
  return out;
}

// ---------------------------------------------------------------
// Whole-file validation with duplicate detection
// ---------------------------------------------------------------

/**
 * @param {string} type             key of IMPORT_TYPES
 * @param {{rowNumber:number, values:object}[]} mappedRows
 * @param {{students?:object[], cashAccounts?:object[], existing?:object[]}} ctx
 * @returns {{ rows: object[], summary: object }}
 */
export function validateImport(type, mappedRows, ctx = {}) {
  const t = IMPORT_TYPES[type];
  if (!t) throw new Error("Unknown import type");
  const existing = new Set();
  for (const d of ctx.existing || []) for (const k of t.existingKeys(d)) existing.add(k);
  const seen = new Map();

  const rows = mappedRows.map((r) => {
    const res = t.validate(r.values, ctx);
    const out = { rowNumber: r.rowNumber, errors: res.errors, warnings: res.warnings, record: res.record, status: "ok", message: "" };
    if (res.errors.length) { out.status = "error"; out.message = res.errors.join("; "); return out; }
    const keys = t.keys(res.record);
    const hitExisting = keys.some((k) => existing.has(k));
    const firstSeen = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
    if (hitExisting) { out.status = "duplicate"; out.message = "Already exists, will be skipped"; }
    else if (firstSeen !== undefined) { out.status = "duplicate"; out.message = `Same as row ${firstSeen} in this file, will be skipped`; }
    else keys.forEach((k) => seen.set(k, r.rowNumber));
    if (out.status === "ok" && res.warnings.length) out.message = res.warnings.join("; ");
    return out;
  });

  const ok = rows.filter((r) => r.status === "ok");
  const summary = {
    total: rows.length,
    ready: ok.length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    errors: rows.filter((r) => r.status === "error").length,
    totals: {},
  };
  if (t.money) {
    const sum = (list) => list.reduce((s, r) => s + toMinor(r.record.amount), 0) / 100;
    if (type === "payments") {
      summary.totals.moneyIn = sum(ok.filter((r) => r.record.type === "cash_in"));
      summary.totals.moneyOut = sum(ok.filter((r) => r.record.type === "cash_out"));
    } else {
      summary.totals.amount = sum(ok);
    }
    if (type === "invoices") {
      const cashRows = ok.filter((r) => r.record.status !== "pending");
      summary.totals.cashRows = cashRows.length;
      summary.totals.cashAmount = cashRows.reduce((s, r) => s + toMinor(r.record.paidAmount), 0) / 100;
    }
  }
  return { rows, summary };
}

// Human sentence for the preview ("Rs. 12,000 in, Rs. 5,000 out").
export function describeTotals(type, totals) {
  if (type === "payments") return `Money in Rs. ${money(totals.moneyIn || 0)}, money out Rs. ${money(totals.moneyOut || 0)}`;
  if (type === "invoices") return `Invoices Rs. ${money(totals.amount || 0)}${totals.cashRows ? `, of which ${totals.cashRows} row${totals.cashRows === 1 ? "" : "s"} already received (Rs. ${money(totals.cashAmount || 0)})` : ""}`;
  if (type === "expenses") return `Expenses Rs. ${money(totals.amount || 0)}`;
  return "";
}

// ---------------------------------------------------------------
// Reading a file (browser only; the heavy library is loaded on demand)
// ---------------------------------------------------------------

function excelValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("");
    if ("result" in v) return excelValue(v.result);
    if ("text" in v) return excelValue(v.text);
    if ("error" in v) return "";
    return "";
  }
  return v;
}

/**
 * Read the first sheet of an .xlsx, or a .csv, into { headers, rows }.
 * Throws a readable Error for anything unsafe or unsupported.
 */
export async function readSpreadsheetFile(file) {
  const headBuf = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const problem = checkUploadMeta({ name: file.name, size: file.size, head: headBuf });
  if (problem) throw new Error(problem);

  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return matrixToTable(parseCsv(text));
  }

  const buffer = await file.arrayBuffer();
  const unz = zipUncompressedSize(buffer);
  if (unz === null) throw new Error("This .xlsx file is damaged or not a spreadsheet.");
  if (unz > MAX_UNCOMPRESSED_BYTES) throw new Error("This spreadsheet expands to an unreasonable size and was rejected.");

  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");

  const matrix = [];
  let count = 0;
  // includeEmpty keeps blank rows so reported row numbers match the sheet.
  ws.eachRow({ includeEmpty: true }, (row) => {
    count++;
    if (count > MAX_ROWS + 2) throw new Error(`Too many rows (limit ${MAX_ROWS}). Split the file.`);
    const cols = Math.min(row.cellCount, MAX_COLUMNS + 1);
    const line = [];
    for (let c = 1; c <= cols; c++) line.push(excelValue(row.getCell(c).value));
    matrix.push(line);
  });
  return matrixToTable(matrix, 1);
}

