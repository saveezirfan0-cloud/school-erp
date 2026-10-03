// src/utils/exportUtils.js
//
// Shared export helpers used by every list page and document viewer.
//
//   exportToCSV    - plain .csv download (formula-neutralised, SEC-15)
//   exportToExcel  - real .xlsx download (numbers stay numbers, text neutralised)
//   exportToPDF    - real .pdf file download of a table (jsPDF, loaded on demand)
//   printHTML      - open a print window (also the "Save as PDF" fallback for
//                    text jsPDF's built-in fonts can't draw, e.g. Urdu)
//   escapeHtml     - the one HTML escaper: every dynamic value that reaches a
//                    generated HTML string must go through it (SEC-02)
import toast from "react-hot-toast";

export const ORG_NAME = "Zohra Majeed Islamic Institute";
export const ORG_FOOTER = "ZMI School Management System";
export const BRAND = "#7a2535";
const BRAND_RGB = [122, 37, 53];

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

// Safe file name: letters, numbers, dash/underscore only.
export function safeFilename(name) {
  return String(name || "export")
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "export";
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- CSV ----------------------------------------------------------------

// A string that spreadsheets parse as a plain number: harmless, and it
// must stay numeric (e.g. "-500", "+923001234567", "12.5", "1e3").
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// First characters that make Excel / Sheets / LibreOffice evaluate a formula.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Make one cell safe for a CSV / Excel file and return the raw (unquoted) text.
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
  return "\uFEFF" + lines.join("\r\n");
}

export function exportToCSV(filename, headers, rows) {
  const blob = new Blob([buildCSV(headers, rows)], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${String(filename).replace(/[^\w.\- ]+/g, "_")}.csv`);
}

// ---- Excel (.xlsx) ------------------------------------------------------

// One cell for the sheet: real numbers stay numeric; text goes through the
// formula neutraliser (SEC-15); dates stay dates; null becomes empty.
function excelCell(c) {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return Number.isFinite(c) ? c : "";
  if (typeof c === "boolean") return c;
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c;
  return neutralizeCell(c);
}

/**
 * Download a table as a real .xlsx file. Written with exceljs (the `xlsx`
 * package has unpatched high advisories, SEC-13 / DEP-1). exceljs is loaded on
 * demand so it stays out of the main bundle.
 */
export async function exportToExcel(filename, headers, rows, sheetName = "Sheet1") {
  try {
    const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
    const wb = new ExcelJS.Workbook();
    // Excel sheet names: max 31 chars, none of  \ / ? * [ ] :
    const name = String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet1";
    const ws = wb.addWorksheet(name);
    ws.addRow(headers.map(excelCell));
    rows.forEach((r) => ws.addRow(r.map(excelCell)));
    ws.columns = headers.map((h, i) => {
      const longest = Math.max(String(h ?? "").length, ...rows.map((r) => String(r[i] ?? "").length));
      return { width: Math.min(Math.max(longest + 2, 8), 50) };
    });
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${String(filename).replace(/[^\w.\- ]+/g, "_")}.xlsx`
    );
  } catch (err) {
    console.error("Excel export failed", err);
    toast.error("Couldn't create the Excel file - " + (err?.message || "unknown error"));
  }
}

// ---- Print --------------------------------------------------------------

/** Wrap body HTML in a print document. The CSP forbids script execution. */
function printDocument(title, bodyHtml, css = "", origin = "") {
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: ${escapeHtml(origin)}">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 24px; }
    ${css}
  </style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Open a print window with ready-made HTML (callers must already have escaped
 * every dynamic value in bodyHtml). The browser's print dialog offers "Save
 * as PDF". Printing is triggered from here, not from a script inside the
 * document, so the document can run with scripts disabled. Returns false when
 * the browser blocks the popup.
 */
export function printHTML(title, bodyHtml, css = "") {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Pop-up blocked - allow pop-ups for this site to print or save as PDF");
    return false;
  }
  try { w.opener = null; } catch { /* ignore */ }
  w.document.write(printDocument(title, bodyHtml, css, window.location.origin));
  w.document.close();
  // Give images (the logo) a moment to load before the print dialog opens.
  setTimeout(() => { try { if (w.focus) w.focus(); w.print(); } catch { /* window closed */ } }, 300);
  return true;
}

function tableToHtml(title, headers, rows, generatedOn = new Date().toLocaleDateString()) {
  return `
    <h2>${escapeHtml(title)}</h2>
    <p class="sub">${escapeHtml(ORG_NAME)} \u2014 Generated ${escapeHtml(generatedOn)}</p>
    <table>
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
    <div class="footer">${escapeHtml(ORG_FOOTER)}</div>`;
}

const TABLE_CSS = `
  h2 { color: ${BRAND}; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 13px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: ${BRAND}; color: white; padding: 10px 12px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .footer { margin-top: 28px; font-size: 12px; color: #94a3b8; text-align: center; }`;

/** Build the table print document. Every dynamic value is HTML-escaped. */
export function buildPrintHtml(title, headers, rows, generatedOn = new Date().toLocaleDateString()) {
  return printDocument(title, tableToHtml(title, headers, rows, generatedOn), TABLE_CSS);
}

// ---------------------------------------------------------------------------
// PDF support
// ---------------------------------------------------------------------------

// jsPDF's built-in fonts only cover Latin text. Map the common typographic
// characters our screens use to ASCII, then report whether anything it
// still can't draw (Urdu/Arabic etc.) remains.
export function toPdfText(value) {
  return String(value ?? "")
    .replace(/[\u2014\u2013\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/[\u00A0\u202F]/g, " ");
}

export function needsUnicodeFallback(strings) {
  // eslint-disable-next-line no-control-regex
  return strings.some(s => /[^\u0000-\u00ff]/.test(toPdfText(s)));
}

let logoPromise = null;
// The institute logo as a data URL (cached); null if it can't be loaded.
export function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch("/zmi_logo.png")
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error("no logo"))))
      .then(blob => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }))
      .catch(() => null);
  }
  return logoPromise;
}

export async function loadPdfLibs() {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable: autoTableModule.default || autoTableModule.autoTable };
}

// Download a table as a real PDF file.
//   title   – heading shown at the top (also used for the file name)
//   headers – column headings
//   rows    – array of arrays (strings/numbers)
//   opts    – { filename, subtitle, orientation }
export async function exportToPDF(title, headers, rows, opts = {}) {
  const filename = opts.filename || safeFilename(title);
  try {
    if (needsUnicodeFallback([title, ...headers, ...rows.flat()])) {
      toast("This report has non-Latin text, so it opens in the print dialog — choose “Save as PDF”.", { duration: 5000 });
      printHTML(title, tableToHtml(title, headers, rows), TABLE_CSS);
      return;
    }
    const { jsPDF, autoTable } = await loadPdfLibs();
    const logo = await loadLogo();
    const orientation = opts.orientation || (headers.length > 6 ? "landscape" : "portrait");
    const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;

    let y = 40;
    let textX = margin;
    if (logo) {
      try { doc.addImage(logo, "PNG", margin, 28, 30, 36); textX = margin + 42; } catch { /* logo is optional */ }
    }
    doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...BRAND_RGB);
    doc.text(toPdfText(title), textX, y);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(100, 116, 139);
    doc.text(toPdfText(`${ORG_NAME}${opts.subtitle ? " - " + opts.subtitle : ""}  |  Generated ${new Date().toLocaleDateString()}`), textX, y + 14);

    const isNumeric = (i) => {
      const vals = rows.map(r => r[i]).filter(v => v !== "" && v != null);
      return vals.length > 0 && vals.every(v => typeof v === "number" || /^[-+\u2212]?\s*(Rs\.?\s*)?[\d,]+(\.\d+)?%?$/.test(String(v).trim()));
    };
    const columnStyles = {};
    headers.forEach((_, i) => { if (isNumeric(i)) columnStyles[i] = { halign: "right" }; });

    autoTable(doc, {
      head: [headers.map(toPdfText)],
      body: rows.map(r => r.map(c => toPdfText(c))),
      startY: 76,
      margin: { left: margin, right: margin, bottom: 40 },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59], overflow: "linebreak" },
      headStyles: { fillColor: BRAND_RGB, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles,
      didParseCell: (d) => { if (d.section === "head" && columnStyles[d.column.index]) d.cell.styles.halign = "right"; },
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8).setTextColor(148, 163, 184);
      doc.text(toPdfText(ORG_FOOTER), margin, pageH - 20);
      doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 20, { align: "right" });
    }
    doc.save(`${filename}.pdf`);
  } catch (err) {
    console.error("PDF export failed", err);
    toast.error("Couldn't create the PDF — " + (err?.message || "unknown error"));
  }
}