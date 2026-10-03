// src/utils/exportUtils.js
//
// CSV download and print-to-PDF helpers, plus the shared `escapeHtml`
// that any code building HTML strings must use for dynamic values.

// ---- HTML escaping ----------------------------------------------------

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/**
 * Escape a value for safe use as HTML text or inside a quoted attribute.
 * null/undefined become "". Everything else is converted with String().
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
}

// ---- CSV ----------------------------------------------------------------

// A string that spreadsheets parse as a plain number: harmless, and it
// must stay numeric (e.g. "-500", "+923001234567", "12.5", "1e3").
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// First characters that make Excel / Sheets / LibreOffice evaluate a formula.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Make one cell safe for a CSV file and return the raw (unquoted) text.
 * - real numbers (typeof number) and numeric-looking strings stay as they are
 * - other text starting with = + - @ tab or CR gets a leading apostrophe,
 *   which spreadsheets treat as "this is text"
 */
export function neutralizeCell(cell) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  const text = cell instanceof Date ? cell.toISOString() : String(cell);
  if (NUMERIC_TEXT.test(text)) return text;
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

function csvField(cell) {
  // Real numbers are written bare so they stay numeric in the sheet.
  if (typeof cell === "number" && Number.isFinite(cell)) return String(cell);
  return `"${neutralizeCell(cell).replace(/"/g, '""')}"`;
}

/** Build the CSV text (with a UTF-8 BOM so Excel reads non-ASCII names). */
export function buildCSV(headers, rows) {
  const lines = [
    headers.map(csvField).join(","),
    ...rows.map((row) => row.map(csvField).join(",")),
  ];
  return "﻿" + lines.join("\r\n");
}

export function exportToCSV(filename, headers, rows) {
  const blob = new Blob([buildCSV(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(filename).replace(/[^\w.\- ]+/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Print / PDF -----------------------------------------------------

/** Build the print document. Every dynamic value is HTML-escaped. */
export function buildPrintHtml(title, headers, rows, generatedOn = new Date().toLocaleDateString()) {
  const t = escapeHtml(title);
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>${t}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; color: #1e293b; }
    h2 { color: #7a2535; margin-bottom: 4px; }
    p { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #7a2535; color: white; padding: 10px 12px; text-align: left; }
    td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; }
  </style></head><body>
  <h2>${t}</h2>
  <p>Zohra Majeed Islamic Institute — Generated ${escapeHtml(generatedOn)}</p>
  <table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  <div class="footer">ZMI School Management System</div>
  </body></html>`;
}

/**
 * Open a print window with the table. Returns false (and does not throw)
 * when the browser blocks the popup.
 */
export function exportToPDF(title, headers, rows) {
  const w = window.open("", "_blank");
  if (!w) return false;
  try { w.opener = null; } catch { /* ignore */ }
  w.document.write(buildPrintHtml(title, headers, rows));
  w.document.close();
  w.print();
  return true;
}
