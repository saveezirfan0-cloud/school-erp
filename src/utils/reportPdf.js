// src/utils/reportPdf.js
//
// Print views for the Haji Sahab report (month and year), in the app's theme.
// They open a print window; "Save as PDF" in the print dialog produces the PDF.
// Printing waits for the logo and (for Urdu) the font so neither is missing.

import { fmtNum, fmtMoney, monthName, rangeLabel, isSingleMonth } from "./monthlyStatement";
import { pick, tr, isRtl, periodLabel, MONTHS_UR } from "../config/reportI18n";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// <bdi> isolates each text run so mixed English / Urdu never reorders around digits.
const bdi = (t) => `<bdi>${esc(t)}</bdi>`;

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">';

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; font-size: 12px;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body.ur, body.both { font-family: "Noto Nastaliq Urdu", Inter, Arial, sans-serif; line-height: 1.9; }
  .band { background: #4a1520; color: #fff; border-radius: 10px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
  .band img { width: 46px; height: 46px; object-fit: contain; background: #fff; border-radius: 8px; padding: 3px; }
  .band .org { font-size: 16px; font-weight: 700; }
  .band .sub { font-size: 11px; opacity: .8; margin-top: 3px; }
  h3.sec { font-size: 13px; margin: 14px 0 6px; color: #7a2535; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 5px 9px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  html[dir=rtl] td.n, html[dir=rtl] th.n { text-align: left; }
  html[dir=rtl] td, html[dir=rtl] th { text-align: right; }
  html[dir=rtl] td.n, html[dir=rtl] th.n { text-align: left; }
  td.h { padding-inline-start: 22px; }
  .br { display: block; font-size: 10px; color: #64748b; margin-top: 1px; }
  tr.g td { background: #f5eaec; font-weight: 700; color: #4a1520; }
  tr.total td { font-weight: 700; font-size: 13px; border-bottom: none; color: #fff; background: #7a2535; }
  tr.total.in td { background: #047857; } tr.total.out td { background: #b91c1c; }
  .tag { font-size: 9px; font-weight: 600; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 1px 6px; margin-inline-start: 6px; font-family: Inter, Arial, sans-serif; }
  .tag.over { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
  .tag.ok { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
  .note { font-size: 10px; color: #64748b; margin-top: 4px; }
  td.empty { color: #64748b; text-align: center; padding: 12px; }
  tr { page-break-inside: avoid; }
  .foot { margin-top: 14px; font-size: 10px; color: #94a3b8; text-align: center; }
  .filtered { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 8px; padding: 6px 10px; font-size: 11px; margin-bottom: 8px; }
  .closed { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 8px; padding: 6px 10px; font-size: 11px; margin-bottom: 8px; }
`;

// A document is { head, body, lang, title }. renderDocument makes the full HTML;
// the preview shows it in an iframe, "print" opens it in a window that prints
// itself once the logo and (for Urdu) the font have loaded.
export function renderDocument(doc, { autoPrint = false } = {}) {
  const rtl = isRtl(doc.lang);
  return `<html dir="${rtl ? "rtl" : "ltr"}" lang="${doc.lang === "en" ? "en" : "ur"}"><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
  ${doc.lang === "en" ? "" : FONT_LINK}
  ${doc.head}
  </head><body class="${esc(doc.lang)}">${doc.body}
  ${autoPrint ? `<script>window.onload = function () {
    var go = function () { window.focus(); window.print(); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go);
  };</script>` : ""}</body></html>`;
}

export function printDocument(doc) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(renderDocument(doc, { autoPrint: true }));
  w.document.close();
  return true;
}

const band = (lang, orgName, subtitle) => `
  <div class="band">
    <img src="${esc(window.location.origin)}/zmi_logo.png" alt="" />
    <div><div class="org">${esc(orgName)}</div><div class="sub">${subtitle}</div></div>
  </div>`;

const label = (lang, o) => bdi(pick(lang, o.label, o.labelUr));

function budgetTag(g, lang, tone) {
  if (!g.budget) return "";
  const pct = Math.round((g.total / g.budget) * 100);
  // For expenses over budget is bad; for income, reaching the target is good.
  const cls = tone === "out" ? (pct > 100 ? "over" : "") : (pct >= 100 ? "ok" : "");
  return ` <span class="tag ${cls}">${bdi(tr(lang, "budget"))} ${fmtNum(g.budget)} · ${pct}%</span>`;
}

function sectionTable(titleKey, section, tone, emptyText, options, lang) {
  const rows = section.groups.length === 0
    ? `<tr><td colspan="2" class="empty">${esc(emptyText)}</td></tr>`
    : section.groups.map((g) => `
        <tr class="g"><td>${label(lang, g)}${g.excluded ? ` <span class="tag">${bdi(tr(lang, "notCounted"))}</span>` : ""}${g.excluded ? "" : budgetTag(g, lang, tone)}</td><td class="n">${fmtNum(g.total)}</td></tr>
        ${g.heads.map((h) => `
        <tr><td class="h">${label(lang, h)}${options.branchSplit !== false && h.branches.length > 1 ? `<span class="br">${h.branches.map((b) => `${esc(b.name)} ${fmtNum(b.amount)}`).join(" · ")}</span>` : ""}</td><td class="n">${fmtNum(h.amount)}</td></tr>`).join("")}`).join("");
  const notes = [
    section.hiddenAmount ? `Rs. ${fmtNum(section.hiddenAmount)} hidden by report layout` : "",
    section.excludedAmount ? `Rs. ${fmtNum(section.excludedAmount)} shown but not counted` : "",
  ].filter(Boolean);
  return `<h3 class="sec">${bdi(tr(lang, titleKey))}</h3>
  <table>${rows}<tr class="total ${tone}"><td>${bdi(tr(lang, titleKey === "income" ? "totalIncome" : "totalExpense"))}</td><td class="n">Rs. ${fmtNum(section.total)}</td></tr></table>
  ${notes.length ? `<div class="note">${esc(notes.join(" · "))}</div>` : ""}`;
}

// s: layout-applied statement. extra: { outstanding, closedInfo, filterNote }
export function monthlyDocument(s, { orgName = "Zohra Majeed Islamic Institute", scopeLabel = "", outstanding = null, closedInfo = null, filterNote = "" } = {}) {
  const options = s.options || {};
  const lang = options.language || "en";
  const kpi = (key, value, cls = "") => `<div class="kpi ${cls}"><div class="k">${bdi(tr(lang, key))}</div><div class="v">${esc(fmtMoney(value))}</div></div>`;

  const accounts = options.accounts === false || s.cashAccounts.length === 0 ? "" : `
  <h3 class="sec">${bdi(tr(lang, "accounts"))}</h3>
  <table>
    <tr class="g"><td>${bdi(tr(lang, "account"))}</td><td class="n">${bdi(tr(lang, "colOpening"))}</td><td class="n">${bdi(tr(lang, "colIn"))}</td><td class="n">${bdi(tr(lang, "colOut"))}</td><td class="n">${bdi(tr(lang, "colClosing"))}</td></tr>
    ${s.cashAccounts.map((a) => `<tr><td class="h">${esc(a.name)}</td><td class="n">${fmtNum(a.opening)}</td><td class="n">${fmtNum(a.moneyIn)}</td><td class="n">${fmtNum(a.moneyOut)}</td><td class="n">${fmtNum(a.closing)}</td></tr>`).join("")}
  </table>`;

  const owed = options.outstanding === false || !outstanding || (!outstanding.fees.total && !outstanding.salaries.total) ? "" : `
  <h3 class="sec">${bdi(tr(lang, "outstanding"))}</h3>
  <table>
    <tr><td class="h">${bdi(tr(lang, "pendingFees"))} <span class="br">${outstanding.fees.count} invoices${outstanding.fees.byBranch.length > 1 ? ` · ${outstanding.fees.byBranch.map((b) => `${esc(b.name)} ${fmtNum(b.amount)}`).join(" · ")}` : ""}</span></td><td class="n">Rs. ${fmtNum(outstanding.fees.total)}</td></tr>
    <tr><td class="h">${bdi(tr(lang, "unpaidSalaries"))} <span class="br">${outstanding.salaries.count} payslips</span></td><td class="n">Rs. ${fmtNum(outstanding.salaries.total)}</td></tr>
  </table>
  <div class="note">Based on invoice and payslip status today.</div>`;

  const single = isSingleMonth(s.from, s.to);
  const subtitle = [tr(lang, "title"), single ? periodLabel(lang, s.year, s.month, rangeLabel(s.from, s.to)) : rangeLabel(s.from, s.to), scopeLabel].filter(Boolean).map(bdi).join(" · ");
  const head = `<style>${BASE_CSS}
    @page { size: A4; margin: 12mm; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 4px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
    .kpi .k { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
    .kpi .v { font-size: 14px; font-weight: 700; margin-top: 3px; font-family: Inter, Arial, sans-serif; }
    .kpi.in .v { color: #047857; } .kpi.out .v { color: #b91c1c; } .kpi.close { background: #f5eaec; border-color: #e8cfd4; } .kpi.close .v { color: #7a2535; }
  </style>`;
  const body = `
  ${band(lang, orgName, subtitle)}
  ${closedInfo ? `<div class="closed">${bdi(tr(lang, "closed"))} — ${esc(closedInfo)}</div>` : ""}
  ${filterNote ? `<div class="filtered">Filtered view — ${esc(filterNote)}. Totals and the closing balance cover only the matching records.</div>` : ""}
  <div class="kpis">
    ${kpi("opening", s.openingBalance)}${kpi("totalIncome", s.totalIncome, "in")}${kpi("totalExpense", s.totalExpense, "out")}${kpi("closing", s.closingBalance, "close")}
  </div>
  ${sectionTable("income", s.income, "in", "—", options, lang)}
  ${sectionTable("expense", s.expense, "out", "—", options, lang)}
  ${owed}
  ${accounts}
  <div class="foot">${bdi(tr(lang, "generated"))} ${esc(new Date().toLocaleDateString("en-GB"))} — ZMI School Management System</div>`;
  const title = single ? `Haji Sahab Report — ${monthName(s.month)} ${s.year}` : `Haji Sahab Report — ${rangeLabel(s.from, s.to)}`;
  return { head, body, lang, title };
}

export const printMonthlyStatement = (s, opts) => printDocument(monthlyDocument(s, opts));

// table: from buildYearTable; options: layout options (language).
export function yearDocument(table, year, { orgName = "Zohra Majeed Islamic Institute", scopeLabel = "", options = {} } = {}) {
  const lang = options.language || "en";
  const months = Array.from({ length: 12 }, (_, i) => esc(pick(lang, monthName(i + 1).slice(0, 3), MONTHS_UR[i])));
  const numCells = (vals) => vals.map((v) => `<td class="n">${v ? fmtNum(v) : "–"}</td>`).join("");
  const sideRows = (side, tone, titleKey) => `
    <tr class="g"><td colspan="14">${bdi(tr(lang, titleKey))}</td></tr>
    ${side.rows.map((r) => `<tr><td class="h">${bdi(pick(lang, r.label, r.labelUr))}${r.excluded ? ` <span class="tag">${bdi(tr(lang, "notCounted"))}</span>` : ""}</td>${numCells(r.values)}<td class="n"><b>${fmtNum(r.total)}</b></td></tr>`).join("")}
    <tr class="total ${tone}"><td>${bdi(tr(lang, titleKey === "income" ? "totalIncome" : "totalExpense"))}</td>${numCells(side.totals).replace(/class="n"/g, 'class="n"')}<td class="n">${fmtNum(side.total)}</td></tr>`;
  const head = `<style>${BASE_CSS}
    @page { size: A4 landscape; margin: 10mm; }
    body { font-size: 9.5px; } td, th { padding: 4px 5px; } .band { padding: 10px 14px; }
    th { background: #f5eaec; color: #4a1520; font-size: 9px; text-transform: uppercase; }
  </style>`;
  const body = `
  ${band(lang, orgName, [tr(lang, "yearTitle"), String(year), scopeLabel].filter(Boolean).map(bdi).join(" · "))}
  <table>
    <tr><th></th>${months.map((m) => `<th class="n">${m}</th>`).join("")}<th class="n">${bdi(tr(lang, "total"))}</th></tr>
    <tr><td class="h">${bdi(tr(lang, "opening"))}</td>${numCells(table.opening)}<td></td></tr>
    ${sideRows(table.income, "in", "income")}
    ${sideRows(table.expense, "out", "expense")}
    <tr class="g"><td>${bdi(tr(lang, "net"))}</td>${numCells(table.net)}<td class="n">${fmtNum(table.netTotal)}</td></tr>
    <tr class="g"><td>${bdi(tr(lang, "closing"))}</td>${numCells(table.closing)}<td></td></tr>
  </table>
  <div class="foot">${bdi(tr(lang, "generated"))} ${esc(new Date().toLocaleDateString("en-GB"))} — ZMI School Management System</div>`;
  return { head, body, lang, title: `Haji Sahab Report — ${year}` };
}

export const printYearStatement = (table, year, opts) => printDocument(yearDocument(table, year, opts));
