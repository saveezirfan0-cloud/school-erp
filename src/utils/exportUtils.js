// Shared export helpers used by every list page and document viewer.
//
//   exportToCSV    – plain .csv download
//   exportToExcel  – real .xlsx download (numbers stay numbers)
//   exportToPDF    – real .pdf file download of a table (jsPDF, loaded on demand)
//   printHTML      – open a print window (also the "Save as PDF" fallback for
//                    text jsPDF's built-in fonts can't draw, e.g. Urdu)
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

export const ORG_NAME = "Zohra Majeed Islamic Institute";
export const ORG_FOOTER = "ZMI School Management System";
export const BRAND = "#7a2535";
const BRAND_RGB = [122, 37, 53];

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  a.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportToCSV(filename, headers, rows) {
  const csvContent = [
    headers.map(h => `"${String(h ?? "").replace(/"/g, '""')}"`).join(","),
    ...rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\r\n");
  // BOM so Excel opens UTF-8 (e.g. Urdu names) correctly.
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToExcel(filename, headers, rows, sheetName = "Sheet1") {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map(r => r.map(c => c ?? ""))]);
  ws["!cols"] = headers.map((h, i) => {
    const longest = Math.max(String(h ?? "").length, ...rows.map(r => String(r[i] ?? "").length));
    return { wch: Math.min(Math.max(longest + 2, 8), 50) };
  });
  const wb = XLSX.utils.book_new();
  // Excel sheet names: max 31 chars, none of  \ / ? * [ ] :
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
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

// Open a print window with ready-made HTML. The browser's print dialog
// offers "Save as PDF". Printing is triggered from inside the new window
// once it has loaded (so images are ready).
export function printHTML(title, bodyHtml, css = "") {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Pop-up blocked — allow pop-ups for this site to print or save as PDF");
    return false;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 24px; }
    ${css}
  </style></head><body>${bodyHtml}
  <script>window.addEventListener("load", function () { setTimeout(function () { window.focus(); window.print(); }, 150); });</script>
  </body></html>`);
  w.document.close();
  return true;
}

function tableToHtml(title, headers, rows) {
  return `
    <h2>${escapeHtml(title)}</h2>
    <p class="sub">${escapeHtml(ORG_NAME)} — Generated ${escapeHtml(new Date().toLocaleDateString())}</p>
    <table>
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
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
