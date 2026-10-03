// Printable business documents: invoices, fee receipts, payslips, payment
// vouchers and student statements.
//
// Every document is described by one plain "spec" object, which is rendered
// two ways so the on-screen view, the print output and the PDF file always
// agree:
//
//   docsToHTML(specs)      -> HTML for the viewer modal and the print window
//   downloadDocsPDF(specs) -> a real .pdf file (jsPDF)
//
// spec = {
//   kind, title, number, date, branch, filename,
//   status:     { label, tone: "success" | "warning" | "info" | "danger" } | null,
//   details:    [[label, value], ...]                (two-column facts block)
//   table:      { head: [...], rows: [[...]], align: ["left","right",...] }
//   totals:     [[label, value, strong?], ...]
//   notes:      string,
//   signatures: [label, ...],
//   footer:     string,
// }
import toast from "react-hot-toast";
import { toDate } from "./dates";
import {
  ORG_NAME, ORG_FOOTER, BRAND, escapeHtml, safeFilename, toPdfText,
  needsUnicodeFallback, loadLogo, loadPdfLibs, printHTML,
} from "./exportUtils";

const BRAND_RGB = [122, 37, 53];
const TONES = {
  success: { fg: "#10b981", bg: "#ecfdf5", rgb: [16, 185, 129], bgRgb: [236, 253, 245] },
  warning: { fg: "#b45309", bg: "#fffbeb", rgb: [180, 83, 9], bgRgb: [255, 251, 235] },
  info:    { fg: "#2563eb", bg: "#eff6ff", rgb: [37, 99, 235], bgRgb: [239, 246, 255] },
  danger:  { fg: "#dc2626", bg: "#fef2f2", rgb: [220, 38, 38], bgRgb: [254, 242, 242] },
};

export const money = (n) => `Rs. ${Number(n || 0).toLocaleString("en-US")}`;

// "12 Mar 2026" from an ISO string / Firestore-style value; falls back to the raw text.
function fmtDate(v) {
  if (!v) return "";
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : String(v);
}

const shortId = (id) => String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
const today = () => fmtDate(new Date());

// ---------------------------------------------------------------------------
// Spec builders
// ---------------------------------------------------------------------------

export function buildInvoiceDoc(inv, { student, branchName } = {}) {
  const total = Number(inv.amount || 0);
  const paid = Number(inv.paidAmount || 0);
  const concession = Number(inv.concessionAmount || 0);
  const balance = Math.max(0, total - paid - concession);
  const items = (inv.lineItems && inv.lineItems.length ? inv.lineItems : [{ description: "Fee", amount: total }]);
  const status = inv.status === "paid"
    ? { label: "PAID", tone: "success" }
    : inv.status === "partial"
      ? { label: "PARTIALLY PAID", tone: "info" }
      : { label: "PENDING", tone: "warning" };

  const totals = [["Total", money(total)]];
  if (paid > 0) totals.push(["Paid", `- ${money(paid)}`]);
  if (concession > 0) totals.push(["Concession", `- ${money(concession)}`]);
  totals.push(["Balance Due", money(balance), true]);

  return {
    kind: "invoice",
    title: "INVOICE",
    number: `INV-${shortId(inv.id)}`,
    date: fmtDate(inv.date || inv.createdAt) || today(),
    branch: branchName || "",
    filename: safeFilename(`invoice-${inv.studentName}-${inv.month}-${inv.year}`),
    status,
    details: [
      ["Student", inv.studentName || student?.name || "—"],
      ["Student ID", student?.studentId || "—"],
      ["Class / Grade", student?.grade || "—"],
      ["Parent / Guardian", student?.parentName || "—"],
      ["Billing Period", `${inv.month || ""} ${inv.year || ""}`.trim() || "—"],
      ["Due Date", fmtDate(inv.dueDate) || "—"],
    ],
    table: {
      head: ["#", "Description", "Amount"],
      rows: items.map((li, i) => [String(i + 1), li.customDescription || li.description || "Fee", money(li.amount)]),
      align: ["left", "left", "right"],
    },
    totals,
    notes: inv.notes || "",
    signatures: [],
    footer: "This is a computer-generated invoice and does not require a signature.",
  };
}

// payments: live "cash_in" rows for the invoice, e.g. from getSourcePayments().
export function buildReceiptDoc(inv, payments, { student, branchName } = {}) {
  const live = (payments || [])
    .filter(p => p.type === "cash_in" && !p.reversed && !p.reversalOf)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const received = live.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(inv.amount || 0);
  const concession = Number(inv.concessionAmount || 0);
  const balance = Math.max(0, total - received - concession);
  const last = live[live.length - 1];

  const totals = [["Invoice Total", money(total)]];
  if (concession > 0) totals.push(["Concession", `- ${money(concession)}`]);
  totals.push(["Total Received", money(received), true]);
  if (balance > 0) totals.push(["Balance Due", money(balance)]);

  return {
    kind: "receipt",
    title: "FEE RECEIPT",
    number: `RCPT-${shortId(last?.id || inv.id)}`,
    date: fmtDate(last?.date || inv.paidDate) || today(),
    branch: branchName || "",
    filename: safeFilename(`receipt-${inv.studentName}-${inv.month}-${inv.year}`),
    status: balance > 0 ? { label: "PARTIAL PAYMENT", tone: "info" } : { label: "PAID IN FULL", tone: "success" },
    details: [
      ["Received From", student?.parentName || inv.studentName || "—"],
      ["Student", inv.studentName || student?.name || "—"],
      ["Student ID", student?.studentId || "—"],
      ["Class / Grade", student?.grade || "—"],
      ["Fee For", `${inv.month || ""} ${inv.year || ""}`.trim() || "—"],
      ["Invoice No.", `INV-${shortId(inv.id)}`],
    ],
    table: {
      head: ["Date", "Description", "Received Into", "Amount"],
      rows: live.length
        ? live.map(p => [fmtDate(p.date) || "—", p.description || "Fee payment", p.account || "—", money(p.amount)])
        : [[fmtDate(inv.paidDate) || "—", "Fee payment", inv.paidAccount || "—", money(inv.paidAmount || 0)]],
      align: ["left", "left", "left", "right"],
    },
    totals,
    notes: inv.concessionNote ? `Concession: ${inv.concessionNote}` : "",
    signatures: ["Received By"],
    footer: "Thank you. This is a computer-generated receipt.",
  };
}

export function buildPayslipDoc(p, { branchName } = {}) {
  const period = `${p.month || ""} ${p.year || ""}`.trim();
  return {
    kind: "payslip",
    title: "PAYSLIP",
    number: `PS-${shortId(p.id)}`,
    date: period,
    branch: branchName || "",
    filename: safeFilename(`payslip-${p.employeeName}-${p.month}-${p.year}`),
    status: p.status === "paid"
      ? { label: p.paidDate ? `PAID ${fmtDate(p.paidDate)}`.toUpperCase() : "PAID", tone: "success" }
      : { label: "PENDING", tone: "warning" },
    details: [
      ["Employee Name", p.employeeName || "—"],
      ["Role / Position", p.role || "—"],
      ["Pay Period", period || "—"],
      ["Payment Date", p.status === "paid" ? (fmtDate(p.paidDate) || "—") : "Not yet paid"],
    ],
    table: {
      head: ["Description", "Amount"],
      rows: [
        ["Basic Salary", money(p.basicSalary)],
        ["Allowances", `+ ${money(p.allowances)}`],
        ["Deductions", `- ${money(p.deductions)}`],
      ],
      align: ["left", "right"],
    },
    totals: [["NET PAY", money(p.netPay), true]],
    notes: p.notes || "",
    signatures: ["Employee Signature", "Authorized By"],
    footer: "This payslip is confidential and intended for the named employee only.",
  };
}

export function buildPaymentDoc(p, { branchName } = {}) {
  const isIn = p.type === "cash_in";
  return {
    kind: "payment",
    title: isIn ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER",
    number: `${isIn ? "RV" : "PV"}-${shortId(p.id)}`,
    date: fmtDate(p.date || p.createdAt) || today(),
    branch: branchName || "",
    filename: safeFilename(`${isIn ? "receipt" : "voucher"}-${p.date || ""}-${shortId(p.id)}`),
    status: p.reversed ? { label: "REVERSED", tone: "danger" } : null,
    details: [
      ["Date", fmtDate(p.date || p.createdAt) || "—"],
      [isIn ? "Received Into" : "Paid From", p.account || "—"],
      ["Category", p.category || "—"],
      ["Reference", p.reference || "—"],
    ],
    table: {
      head: ["Description", "Amount"],
      rows: [[p.description || p.category || (isIn ? "Payment received" : "Payment made"), money(p.amount)]],
      align: ["left", "right"],
    },
    totals: [[isIn ? "Amount Received" : "Amount Paid", money(p.amount), true]],
    notes: "",
    signatures: isIn ? ["Paid By", "Received By"] : ["Recipient Signature", "Authorized By"],
    footer: "This is a computer-generated document.",
  };
}

// rows: [{ date, label, detail, billed, received, reversed }] in date order.
export function buildStatementDoc(student, rows, { branchName } = {}) {
  let billed = 0;
  let received = 0;
  const body = rows.map(r => {
    if (!r.reversed) { billed += r.billed || 0; received += r.received || 0; }
    return [
      fmtDate(r.date) || "—",
      `${r.label}${r.reversed ? " (reversed)" : ""}${r.detail ? ` - ${r.detail}` : ""}`,
      r.billed && !r.reversed ? money(r.billed) : "",
      r.received && !r.reversed ? (r.received < 0 ? `- ${money(-r.received)}` : money(r.received)) : "",
      money(billed - received),
    ];
  });
  const balance = billed - received;
  return {
    kind: "statement",
    title: "FEE STATEMENT",
    number: student?.studentId ? `ID ${student.studentId}` : "",
    date: `As of ${today()}`,
    branch: branchName || "",
    filename: safeFilename(`statement-${student?.name || "student"}`),
    status: balance > 0 ? { label: "BALANCE DUE", tone: "danger" } : { label: "NO BALANCE DUE", tone: "success" },
    details: [
      ["Student", student?.name || "—"],
      ["Student ID", student?.studentId || "—"],
      ["Class / Grade", student?.grade || "—"],
      ["Parent / Guardian", student?.parentName || "—"],
    ],
    table: {
      head: ["Date", "Description", "Billed", "Received", "Balance"],
      rows: body.length ? body : [["", "No invoices or payments yet", "", "", ""]],
      align: ["left", "left", "right", "right", "right"],
    },
    totals: [
      ["Total Billed", money(billed)],
      ["Total Received", money(received)],
      ["Balance Due", money(balance), true],
    ],
    notes: "",
    signatures: [],
    footer: "Reversed payments are shown for reference and are not counted in the totals.",
  };
}

// ---------------------------------------------------------------------------
// HTML renderer (viewer + print)
// ---------------------------------------------------------------------------

export const DOC_CSS = `
  .zdoc { background: white; color: #1e293b; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.4; padding: 8px 4px; }
  .zdoc + .zdoc { border-top: 2px dashed #cbd5e1; margin-top: 28px; padding-top: 28px; }
  .zdoc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid ${BRAND}; padding-bottom: 14px; }
  .zdoc-org { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .zdoc-org img { width: 36px; height: 43px; object-fit: contain; }
  .zdoc-org .name { font-size: 17px; font-weight: 700; color: ${BRAND}; }
  .zdoc-org .branch { font-size: 12px; color: #64748b; margin-top: 2px; }
  .zdoc-title { text-align: right; flex-shrink: 0; }
  .zdoc-title .t { font-size: 21px; font-weight: 700; color: ${BRAND}; letter-spacing: .5px; }
  .zdoc-title .n { font-size: 12px; color: #64748b; margin-top: 3px; }
  .zdoc-status { display: inline-block; margin-top: 14px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: .5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .zdoc-details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin: 18px 0; }
  .zdoc-details .l { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #64748b; }
  .zdoc-details .v { font-size: 14px; font-weight: 600; word-break: break-word; }
  .zdoc table { width: 100%; border-collapse: collapse; }
  .zdoc th { background: ${BRAND}; color: white; padding: 9px 12px; font-size: 12px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .zdoc td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
  .zdoc tr { page-break-inside: avoid; }
  .zdoc .r { text-align: right; white-space: nowrap; }
  .zdoc-totals { margin: 14px 0 0 auto; width: 280px; max-width: 100%; }
  .zdoc-totals .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 12px; font-size: 13px; }
  .zdoc-totals .row.strong { background: ${BRAND}; color: white; font-weight: 700; font-size: 15px; border-radius: 6px; margin-top: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .zdoc-notes { margin-top: 18px; padding: 10px 12px; background: #f8fafc; border-radius: 8px; font-size: 12px; color: #64748b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .zdoc-sign { display: flex; justify-content: space-between; gap: 24px; margin-top: 56px; }
  .zdoc-sign div { flex: 1; max-width: 220px; border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 12px; color: #64748b; text-align: center; }
  .zdoc-foot { margin-top: 28px; text-align: center; font-size: 11px; color: #94a3b8; }
  @media print { .zdoc + .zdoc { page-break-before: always; border-top: none; margin-top: 0; padding-top: 8px; } }
`;

export function docToHTML(spec) {
  const logoUrl = `${window.location.origin}/zmi_logo.png`;
  const tone = spec.status ? (TONES[spec.status.tone] || TONES.info) : null;
  const align = spec.table?.align || [];
  const cell = (c, i, tag) => `<${tag}${align[i] === "right" ? ' class="r"' : ""}${tag === "th" && align[i] === "right" ? ' style="text-align:right"' : ""}>${escapeHtml(c)}</${tag}>`;
  return `
  <section class="zdoc">
    <div class="zdoc-head">
      <div class="zdoc-org">
        <img src="${escapeHtml(logoUrl)}" alt="" onerror="this.style.display='none'">
        <div>
          <div class="name">${escapeHtml(ORG_NAME)}</div>
          ${spec.branch ? `<div class="branch">Branch: ${escapeHtml(spec.branch)}</div>` : ""}
        </div>
      </div>
      <div class="zdoc-title">
        <div class="t">${escapeHtml(spec.title)}</div>
        <div class="n">${escapeHtml([spec.number, spec.date].filter(Boolean).join("  ·  "))}</div>
      </div>
    </div>
    ${tone ? `<span class="zdoc-status" style="color:${tone.fg};background:${tone.bg}">${escapeHtml(spec.status.label)}</span>` : ""}
    <div class="zdoc-details">
      ${(spec.details || []).map(([l, v]) => `<div><div class="l">${escapeHtml(l)}</div><div class="v">${escapeHtml(v)}</div></div>`).join("")}
    </div>
    <table>
      <thead><tr>${spec.table.head.map((h, i) => cell(h, i, "th")).join("")}</tr></thead>
      <tbody>${spec.table.rows.map(r => `<tr>${r.map((c, i) => cell(c, i, "td")).join("")}</tr>`).join("")}</tbody>
    </table>
    <div class="zdoc-totals">
      ${(spec.totals || []).map(([l, v, strong]) => `<div class="row${strong ? " strong" : ""}"><span>${escapeHtml(l)}</span><span>${escapeHtml(v)}</span></div>`).join("")}
    </div>
    ${spec.notes ? `<div class="zdoc-notes"><strong>Notes:</strong> ${escapeHtml(spec.notes)}</div>` : ""}
    ${spec.signatures?.length ? `<div class="zdoc-sign">${spec.signatures.map(s => `<div>${escapeHtml(s)}</div>`).join("")}</div>` : ""}
    <div class="zdoc-foot">${escapeHtml(spec.footer || "")}${spec.footer ? "<br>" : ""}${escapeHtml(ORG_FOOTER)}</div>
  </section>`;
}

export const docsToHTML = (specs) => specs.map(docToHTML).join("");

export function printDocs(specs, title) {
  const list = Array.isArray(specs) ? specs : [specs];
  return printHTML(title || list[0]?.title || "Document", docsToHTML(list), DOC_CSS);
}

// ---------------------------------------------------------------------------
// PDF renderer
// ---------------------------------------------------------------------------

function specStrings(spec) {
  return [
    spec.title, spec.number, spec.date, spec.branch, spec.status?.label, spec.notes, spec.footer,
    ...(spec.details || []).flat(),
    ...(spec.table?.head || []),
    ...(spec.table?.rows || []).flat(),
    ...(spec.totals || []).map(t => t[0]).concat((spec.totals || []).map(t => t[1])),
    ...(spec.signatures || []),
  ].filter(s => s != null);
}

function drawDoc(pdf, autoTable, spec, logo) {
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  const T = toPdfText;

  // Header
  let textX = M;
  if (logo) {
    try { pdf.addImage(logo, "PNG", M, 34, 36, 43); textX = M + 48; } catch { /* logo is optional */ }
  }
  pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...BRAND_RGB);
  pdf.text(T(ORG_NAME), textX, 54);
  if (spec.branch) {
    pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(100, 116, 139);
    pdf.text(T(`Branch: ${spec.branch}`), textX, 68);
  }
  pdf.setFont("helvetica", "bold").setFontSize(20).setTextColor(...BRAND_RGB);
  pdf.text(T(spec.title), W - M, 54, { align: "right" });
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(100, 116, 139);
  pdf.text(T([spec.number, spec.date].filter(Boolean).join("   |   ")), W - M, 68, { align: "right" });
  pdf.setDrawColor(...BRAND_RGB).setLineWidth(1.5).line(M, 88, W - M, 88);

  let y = 104;

  // Status chip
  if (spec.status) {
    const tone = TONES[spec.status.tone] || TONES.info;
    pdf.setFont("helvetica", "bold").setFontSize(8);
    const label = T(spec.status.label);
    const w = pdf.getTextWidth(label) + 20;
    pdf.setFillColor(...tone.bgRgb).roundedRect(M, y, w, 18, 9, 9, "F");
    pdf.setTextColor(...tone.rgb).text(label, M + 10, y + 12);
    y += 32;
  }

  // Details grid (two columns)
  const colW = (W - M * 2) / 2;
  const details = spec.details || [];
  for (let i = 0; i < details.length; i += 2) {
    let rowH = 0;
    [details[i], details[i + 1]].forEach((d, c) => {
      if (!d) return;
      const x = M + c * colW;
      pdf.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(100, 116, 139);
      pdf.text(T(d[0]).toUpperCase(), x, y);
      pdf.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(30, 41, 59);
      const lines = pdf.splitTextToSize(T(d[1]), colW - 16).slice(0, 2);
      pdf.text(lines, x, y + 13);
      rowH = Math.max(rowH, 13 + lines.length * 12);
    });
    y += rowH + 12;
  }

  // Line-item table
  const align = spec.table.align || [];
  const columnStyles = {};
  align.forEach((a, i) => { if (a === "right") columnStyles[i] = { halign: "right" }; });
  if (spec.table.head.length === 3 && spec.table.head[0] === "#") columnStyles[0] = { ...columnStyles[0], cellWidth: 28 };
  autoTable(pdf, {
    head: [spec.table.head.map(T)],
    body: spec.table.rows.map(r => r.map(T)),
    startY: y + 2,
    margin: { left: M, right: M, bottom: 60 },
    styles: { fontSize: 9.5, cellPadding: 7, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: { bottom: 0.6 } },
    headStyles: { fillColor: BRAND_RGB, textColor: 255, fontStyle: "bold", lineWidth: 0 },
    columnStyles,
    // column halign only reaches body cells; align the heading to match
    didParseCell: (d) => { if (d.section === "head" && align[d.column.index] === "right") d.cell.styles.halign = "right"; },
  });
  y = (pdf.lastAutoTable?.finalY || y) + 16;

  // Totals
  const totals = spec.totals || [];
  const rowH = 22;
  if (y + totals.length * rowH > H - 90) { pdf.addPage(); y = 60; }
  const boxW = 230;
  const bx = W - M - boxW;
  totals.forEach(([label, value, strong]) => {
    if (strong) {
      pdf.setFillColor(...BRAND_RGB).roundedRect(bx, y - 14, boxW, 20, 4, 4, "F");
      pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(255, 255, 255);
    } else {
      pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(30, 41, 59);
    }
    pdf.text(T(label), bx + 10, y);
    pdf.text(T(value), bx + boxW - 10, y, { align: "right" });
    y += rowH;
  });

  // Notes
  if (spec.notes) {
    pdf.setFont("helvetica", "normal").setFontSize(9);
    const lines = pdf.splitTextToSize(T(`Notes: ${spec.notes}`), W - M * 2 - 20);
    const h = lines.length * 12 + 14;
    if (y + h > H - 90) { pdf.addPage(); y = 60; }
    pdf.setFillColor(248, 250, 252).roundedRect(M, y, W - M * 2, h, 6, 6, "F");
    pdf.setTextColor(100, 116, 139).text(lines, M + 10, y + 16);
    y += h + 10;
  }

  // Signatures
  if (spec.signatures?.length) {
    if (y + 80 > H - 60) { pdf.addPage(); y = 60; }
    y += 52;
    const n = spec.signatures.length;
    const sw = Math.min(180, (W - M * 2 - 30 * (n - 1)) / n);
    // first line flush left, last flush right, any others evenly between
    const step = n > 1 ? (W - M * 2 - sw) / (n - 1) : 0;
    spec.signatures.forEach((label, i) => {
      const x = M + step * i;
      pdf.setDrawColor(148, 163, 184).setLineWidth(0.8).line(x, y, x + sw, y);
      pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(100, 116, 139);
      pdf.text(T(label), x + sw / 2, y + 13, { align: "center" });
    });
  }

  // Footer lines go on the last page of this document
  pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(148, 163, 184);
  if (spec.footer) pdf.text(T(spec.footer), W / 2, H - 38, { align: "center" });
  pdf.text(T(ORG_FOOTER), W / 2, H - 26, { align: "center" });
}

// Download one or several documents as a single PDF (one document per page).
export async function downloadDocsPDF(specs, filename) {
  const list = Array.isArray(specs) ? specs : [specs];
  const name = filename || (list.length === 1 ? list[0].filename : `${list[0].kind}s-${list.length}`);
  try {
    if (needsUnicodeFallback(list.flatMap(specStrings))) {
      toast("This document has non-Latin text, so it opens in the print dialog — choose “Save as PDF”.", { duration: 5000 });
      printDocs(list, name);
      return;
    }
    const { jsPDF, autoTable } = await loadPdfLibs();
    const logo = await loadLogo();
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    list.forEach((spec, i) => {
      if (i > 0) pdf.addPage();
      drawDoc(pdf, autoTable, spec, logo);
    });
    pdf.save(`${name}.pdf`);
  } catch (err) {
    console.error("PDF generation failed", err);
    toast.error("Couldn't create the PDF — " + (err?.message || "unknown error"));
  }
}
