import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Printer, Download, FileText, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import { logActivity } from "../utils/auditLog";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import {
  DEFAULT_GRADING_SCALE, DEFAULT_PASS_MARK, classResults, classStats, subjectBreakdown,
  studentTotals, remarkFor, sameClass, studentsForExam, subjectsForExam,
} from "../utils/grading";

const SCHOOL_NAME = "Zohra Majeed Islamic Institute";
const SEP = "\u0001";

// ---------- helpers ----------
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// Escape every user-supplied string before it goes into generated HTML.
const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Stop spreadsheet formula injection from names that start with = + - @.
const csvSafe = (v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);

const blankBranch = (b) => (!b || b === "main" ? "" : b);
const pctText = (p) => (p === null || p === undefined ? "—" : `${p}%`);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "class";

const inputStyle = {
  width: "100%", padding: "9px 10px", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white",
};
const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 5, textTransform: "uppercase" };
const thStyle = {
  padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap",
};
const secondaryBtn = {
  display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", border: "1px solid var(--border)",
  borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13,
};

// ---------- printable report card ----------
const CARD_CSS = `
  .rc, .rc * { box-sizing: border-box; }
  .rc { font-family: Arial, sans-serif; color: #1e293b; width: 100%; max-width: 780px; margin: 0 auto 24px; padding: 28px 32px; border: 2px solid #7a2535; border-radius: 6px; background: #fff; }
  .rc-hdr { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #7a2535; padding-bottom: 12px; margin-bottom: 16px; }
  .rc-hdr img { width: 64px; height: 64px; object-fit: contain; }
  .rc-hdr h1 { color: #7a2535; font-size: 22px; margin: 0 0 3px; }
  .rc-hdr .sub { font-size: 13px; color: #64748b; }
  .rc-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; font-size: 13px; }
  .rc-info span { color: #64748b; display: inline-block; min-width: 82px; }
  table.rc-marks { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
  .rc-marks th { background: #7a2535; color: #fff; padding: 8px 10px; text-align: left; }
  .rc-marks td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  .rc-marks .n { text-align: center; }
  .rc-marks tr.tot td { background: #f5eaec; font-weight: 700; border-top: 2px solid #7a2535; }
  .rc-marks tr:nth-child(even) td { background: #f8fafc; }
  .rc-marks tr.tot:nth-child(even) td { background: #f5eaec; }
  h3.rc-h { font-size: 13px; color: #7a2535; margin: 14px 0 6px; text-transform: uppercase; }
  .rc-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .rc-summary div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; text-align: center; }
  .rc-summary small { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 3px; }
  .rc-summary b { font-size: 17px; }
  .rc .rc-pass { color: #059669; } .rc .rc-fail { color: #dc2626; }
  .rc-remarks { font-size: 13px; margin-bottom: 8px; }
  .rc-line { border-bottom: 1px solid #94a3b8; height: 22px; }
  .rc-sign { display: flex; justify-content: space-between; gap: 16px; margin-top: 34px; font-size: 12px; color: #64748b; }
  .rc-sign div { flex: 1; text-align: center; border-top: 1px solid #94a3b8; padding-top: 5px; }
  .rc-scale { margin-top: 14px; font-size: 11px; color: #64748b; }
  .rc-prov { margin: 0 0 12px; padding: 6px 10px; background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; font-size: 12px; border-radius: 4px; }
  .rc-foot { margin-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
  @media (max-width: 600px) { .rc { padding: 16px; } .rc-info { grid-template-columns: 1fr; } .rc-summary { grid-template-columns: 1fr 1fr; } }
  @media print {
    .rc { page-break-after: always; break-after: page; margin: 0 auto; border-width: 2px; }
    .rc:last-child { page-break-after: auto; break-after: auto; }
  }
`;

// Only for the print window (never injected into the app page).
const PRINT_BASE_CSS = `
  body { margin: 0; padding: 0; background: #fff; }
  @page { size: A4; margin: 12mm; }
`;

const gradeLegend = () => DEFAULT_GRADING_SCALE
  .map((s, i) => {
    const upper = i === 0 ? 100 : DEFAULT_GRADING_SCALE[i - 1].min - 0.01;
    return `${esc(s.grade)}: ${s.min}${i === 0 ? "+" : `–${Math.round(upper)}`}%`;
  })
  .join(" &nbsp;|&nbsp; ");

function cardHtml(card, meta) {
  const { student, totals, rank, pass, subjectRows, examRows, rankedCount } = card;
  const showRemarks = subjectRows.some((s) => s.remarks);
  const markCell = (s) => (s.state === "marked" ? s.obtained : s.state === "absent" ? "Absent" : "—");
  const maxCell = (s) => (s.state === "marked" ? s.max : "—");
  const subjectsHtml = subjectRows.map((s) => `
    <tr>
      <td>${esc(s.name)}</td>
      <td class="n">${esc(markCell(s))}</td>
      <td class="n">${esc(maxCell(s))}</td>
      <td class="n">${s.state === "marked" ? esc(pctText(s.percentage)) : "—"}</td>
      <td class="n"><b>${esc(s.grade || "—")}</b></td>
      ${showRemarks ? `<td>${esc(s.remarks)}</td>` : ""}
    </tr>`).join("");
  const hasMarks = totals.marked > 0;
  const examsHtml = examRows.length ? `
    <h3 class="rc-h">Exam-wise performance</h3>
    <table class="rc-marks">
      <thead><tr><th>Exam</th><th class="n">Marks</th><th class="n">Max</th><th class="n">%</th><th class="n">Grade</th></tr></thead>
      <tbody>${examRows.map((x) => `
        <tr><td>${esc(x.name)}</td><td class="n">${esc(x.obtained)}</td><td class="n">${esc(x.max)}</td>
        <td class="n">${esc(pctText(x.percentage))}</td><td class="n"><b>${esc(x.grade)}</b></td></tr>`).join("")}
      </tbody>
    </table>` : "";

  return `
  <div class="rc">
    <div class="rc-hdr">
      <img src="${esc(meta.logoUrl)}" alt="" onerror="this.style.display='none'" />
      <div>
        <h1>${esc(SCHOOL_NAME)}</h1>
        <div class="sub">Report Card &mdash; ${esc(meta.title)}</div>
      </div>
    </div>
    ${meta.provisional ? `<div class="rc-prov">Provisional: results for this exam have not been published yet.</div>` : ""}
    <div class="rc-info">
      <div><span>Student</span><b>${esc(student.name)}</b></div>
      <div><span>Student ID</span>${esc(student.studentId || "—")}</div>
      <div><span>Class</span>${esc(meta.className)}</div>
      <div><span>Branch</span>${esc(meta.branchName)}</div>
      <div><span>${meta.isTerm ? "Term" : "Exam"}</span>${esc(meta.title)}</div>
      <div><span>${meta.isTerm ? "Exams" : "Date"}</span>${esc(meta.subtitle || "—")}</div>
    </div>
    <table class="rc-marks">
      <thead><tr>
        <th>Subject</th><th class="n">Marks</th><th class="n">Max</th><th class="n">%</th><th class="n">Grade</th>${showRemarks ? "<th>Remarks</th>" : ""}
      </tr></thead>
      <tbody>
        ${subjectsHtml}
        <tr class="tot">
          <td>Total</td>
          <td class="n">${hasMarks ? esc(totals.obtained) : "—"}</td>
          <td class="n">${hasMarks ? esc(totals.max) : "—"}</td>
          <td class="n">${esc(pctText(totals.percentage))}</td>
          <td class="n">${esc(totals.grade || "—")}</td>
          ${showRemarks ? "<td></td>" : ""}
        </tr>
      </tbody>
    </table>
    ${examsHtml}
    <div class="rc-summary">
      <div><small>Percentage</small><b>${esc(pctText(totals.percentage))}</b></div>
      <div><small>Overall grade</small><b>${esc(totals.grade || "—")}</b></div>
      <div><small>Class rank</small><b>${rank ? `${esc(rank)} <span style="font-size:12px;font-weight:400">of ${esc(rankedCount)}</span>` : "—"}</b></div>
      <div><small>Result</small><b class="${pass === null ? "" : pass ? "rc-pass" : "rc-fail"}">${pass === null ? "—" : pass ? "PASS" : "FAIL"}</b></div>
    </div>
    <div class="rc-remarks"><b>Remarks:</b> ${esc(remarkFor(totals.percentage))}</div>
    <div class="rc-line"></div><div class="rc-line"></div>
    <div class="rc-sign"><div>Class Teacher</div><div>Principal</div><div>Parent / Guardian</div></div>
    <div class="rc-scale">Grading: ${gradeLegend()} &nbsp;|&nbsp; Pass mark: ${DEFAULT_PASS_MARK}%</div>
    <div class="rc-foot">Generated ${esc(meta.generatedOn)} &mdash; ZMI School Management System</div>
  </div>`;
}

function openPrintWindow(title, bodyHtml) {
  const w = window.open("", "_blank");
  if (!w) { toast.error("Pop-up blocked — allow pop-ups for this site to print"); return false; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${PRINT_BASE_CSS}${CARD_CSS}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  // give the logo a moment to load before the print dialog opens
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* window closed */ } }, 400);
  return true;
}

// ===========================================================================
export default function ReportCards() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const { rows: exams, loading: examsLoading } = useCollection("exams", { activeBranch });
  const { rows: allStudents, loading: studentsLoading } = useCollection("students", { branchScoped: false });
  const { rows: allSubjects, loading: subjectsLoading } = useCollection("subjects", { branchScoped: false });
  const { rows: allResults, loading: resultsLoading } = useCollection("examResults", { branchScoped: false });

  const [classSel, setClassSel] = useState("");
  const [mode, setMode] = useState("exam"); // "exam" | "term"
  const [examSel, setExamSel] = useState("");
  const [termSel, setTermSel] = useState("");
  const [studentSel, setStudentSel] = useState(""); // "" = whole class
  const [previewId, setPreviewId] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(false);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || "Main Office";
  const showBranchInLabel = activeBranch === "all" && branches.length > 0;

  // ---- cascading selections (each falls back to the first valid option) ----
  const eligibleExams = useMemo(
    () => exams.filter((e) => (e.grade || "").trim() && (!publishedOnly || e.published)),
    [exams, publishedOnly]
  );
  const classes = useMemo(
    () => [...new Set(eligibleExams.map((e) => (e.grade || "").trim()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [eligibleExams]
  );
  const classValue = classes.find((c) => sameClass(c, classSel)) || classes[0] || "";

  const examOptions = useMemo(
    () => eligibleExams
      .filter((e) => sameClass(e.grade, classValue))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.name || "").localeCompare(String(b.name || ""))),
    [eligibleExams, classValue]
  );
  const examValue = examOptions.find((e) => e.id === examSel)?.id || examOptions[0]?.id || "";

  const termOptions = useMemo(() => {
    const map = new Map();
    examOptions.forEach((e) => {
      const term = (e.term || "").trim();
      if (!term) return;
      const key = `${term}${SEP}${blankBranch(e.branchId)}`;
      if (!map.has(key)) map.set(key, { key, term, branchId: blankBranch(e.branchId), exams: [] });
      map.get(key).exams.push(e);
    });
    return [...map.values()].sort((a, b) => a.term.localeCompare(b.term, undefined, { numeric: true }));
  }, [examOptions]);
  const termValue = termOptions.find((t) => t.key === termSel)?.key || termOptions[0]?.key || "";

  const isTerm = mode === "term";
  const group = isTerm ? termOptions.find((t) => t.key === termValue) : null;
  const groupExams = useMemo(() => {
    if (isTerm) return group ? [...group.exams].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))) : [];
    const one = examOptions.find((e) => e.id === examValue);
    return one ? [one] : [];
  }, [isTerm, group, examOptions, examValue]);
  const repExam = groupExams[0] || null;

  const students = useMemo(() => studentsForExam(allStudents, repExam), [allStudents, repExam]);
  const subjects = useMemo(() => subjectsForExam(allSubjects, repExam), [allSubjects, repExam]);
  const subjectIds = useMemo(() => subjects.map((s) => s.id), [subjects]);
  const studentValue = students.find((s) => s.id === studentSel)?.id || "";

  const groupResults = useMemo(() => {
    const ids = new Set(groupExams.map((e) => String(e.id)));
    return allResults.filter((r) => ids.has(String(r.examId)));
  }, [allResults, groupExams]);

  // ---- computed report data ----
  const rows = useMemo(
    () => classResults(students, groupResults, { subjectIds, passMark: DEFAULT_PASS_MARK }),
    [students, groupResults, subjectIds]
  );
  const stats = useMemo(() => classStats(rows, DEFAULT_PASS_MARK), [rows]);
  const rankedCount = stats.count;

  const cards = useMemo(() => {
    const byStudent = new Map();
    groupResults.forEach((r) => {
      const k = String(r.studentId);
      if (!byStudent.has(k)) byStudent.set(k, []);
      byStudent.get(k).push(r);
    });
    return rows.map((row) => {
      const mine = byStudent.get(String(row.student.id)) || [];
      const subjectRows = subjectBreakdown(mine, subjectIds).map((b, i) => ({ ...b, name: subjects[i]?.name || "" }));
      const examRows = isTerm
        ? groupExams
          .map((ex) => ({
            name: ex.name,
            ...studentTotals(mine.filter((r) => String(r.examId) === String(ex.id)), { defaultMax: ex.totalMarks }),
          }))
          .filter((x) => x.marked > 0)
        : [];
      return { ...row, subjectRows, examRows, rankedCount };
    });
  }, [rows, groupResults, subjectIds, subjects, isTerm, groupExams, rankedCount]);

  const sheetRows = useMemo(
    () => [...cards].sort((a, b) => {
      if (a.rank === null && b.rank !== null) return 1;
      if (b.rank === null && a.rank !== null) return -1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.student.name || "").localeCompare(String(b.student.name || ""));
    }),
    [cards]
  );

  const title = isTerm ? (group ? group.term : "") : (repExam ? repExam.name : "");
  const repBranchName = repExam ? branchName(repExam.branchId) : "";
  const meta = useMemo(() => ({
    title,
    isTerm,
    subtitle: isTerm
      ? groupExams.map((e) => e.name).join(", ")
      : (repExam?.date || ""),
    className: repExam?.grade || "",
    branchName: repBranchName,
    provisional: groupExams.some((e) => !e.published),
    generatedOn: new Date().toLocaleDateString(),
    logoUrl: `${window.location.origin}/zmi_logo.png`,
  }), [title, isTerm, groupExams, repExam, repBranchName]);

  const selectedCard = studentValue ? cards.find((c) => c.student.id === studentValue) : null;
  const previewCard = selectedCard || cards.find((c) => c.student.id === previewId) || cards[0] || null;

  // ---- actions ----
  const printCards = (list, label) => {
    if (!list.length) return;
    const html = list.map((c) => cardHtml(c, meta)).join("");
    if (openPrintWindow(`Report Cards — ${meta.className} — ${meta.title}`, html)) {
      logActivity("exported", "Report Cards", `${label} · ${meta.className} · ${meta.title}`);
    }
  };
  const printSelection = () => {
    if (selectedCard) printCards([selectedCard], `Printed ${selectedCard.student.name}`);
    else printCards(cards, `Printed ${cards.length} report cards`);
  };

  const sheetHeaders = ["Rank", "Student ID", "Student", ...subjects.map((s) => s.name), "Total", "Out of", "%", "Grade", "Result"];
  const subjectCell = (c, i) => {
    const s = c.subjectRows[i];
    return s.state === "marked" ? s.obtained : s.state === "absent" ? "AB" : "";
  };
  const resultText = (c) => (c.pass === null ? "" : c.pass ? "Pass" : "Fail");
  const sheetData = () => sheetRows.map((c) => [
    c.rank ?? "", c.student.studentId || "", c.student.name || "",
    ...subjects.map((_, i) => subjectCell(c, i)),
    c.totals.marked > 0 ? c.totals.obtained : "", c.totals.marked > 0 ? c.totals.max : "",
    c.totals.percentage ?? "", c.totals.grade, resultText(c),
  ]);

  const handleCSV = () => {
    exportToCSV(
      `result-sheet-${slug(meta.className)}-${slug(meta.title)}`,
      sheetHeaders.map(csvSafe),
      sheetData().map((r) => r.map(csvSafe))
    );
    logActivity("exported", "Report Cards", `Result sheet CSV · ${meta.className} · ${meta.title}`);
  };
  const handlePDF = () => {
    // exportToPDF escapes its own input, so pass plain text.
    const summary = (label, value) => [
      "", "", label, ...subjects.map(() => ""), "", "", value, "", "",
    ];
    const body = [
      ...sheetData(),
      summary("Class average", pctText(stats.average)),
      summary("Highest", pctText(stats.highest)),
      summary("Lowest", pctText(stats.lowest)),
      summary("Pass rate", pctText(stats.passPercent)),
    ];
    exportToPDF(
      `Result Sheet — ${meta.className} — ${meta.title}`,
      sheetHeaders,
      body
    );
    logActivity("exported", "Report Cards", `Result sheet PDF · ${meta.className} · ${meta.title}`);
  };

  // ---- render ----
  const loading = examsLoading || studentsLoading || subjectsLoading || resultsLoading;
  const box = (children) => (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14 }}>{children}</div>
  );
  const statTile = (label, value) => (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", minWidth: 100, flex: 1 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700 }}>Report Cards</h2>
      <button onClick={() => navigate("/exams")} style={secondaryBtn}><ClipboardList size={14} /> Exams &amp; marks</button>
    </div>
  );

  if (loading) return <div>{header}{box("Loading…")}</div>;
  if (exams.length === 0 || classes.length === 0) {
    return (
      <div>
        {header}
        {box(<>
          <div style={{ fontWeight: 600, color: "#334155", marginBottom: 6 }}>{publishedOnly ? "No published exams" : "No exams yet"}</div>
          Create an exam and enter marks on the Exams page, then come back to print report cards.
          {publishedOnly && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setPublishedOnly(false)} style={secondaryBtn}>Include unpublished exams</button>
            </div>
          )}
        </>)}
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* selectors */}
      <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <label style={labelStyle}>Class</label>
            <select value={classValue} onChange={(e) => { setClassSel(e.target.value); setStudentSel(""); setPreviewId(""); }} style={inputStyle}>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Report for</label>
            <select value={mode} onChange={(e) => { setMode(e.target.value); setStudentSel(""); setPreviewId(""); }} style={inputStyle}>
              <option value="exam">A single exam</option>
              <option value="term">A whole term (all its exams)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{isTerm ? "Term" : "Exam"}</label>
            {isTerm ? (
              termOptions.length === 0 ? (
                <div style={{ ...inputStyle, color: "var(--text-muted)" }}>No terms set for this class</div>
              ) : (
                <select value={termValue} onChange={(e) => { setTermSel(e.target.value); setStudentSel(""); setPreviewId(""); }} style={inputStyle}>
                  {termOptions.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.term}{showBranchInLabel ? ` · ${branchName(t.branchId)}` : ""} ({t.exams.length} exam{t.exams.length === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              )
            ) : (
              <select value={examValue} onChange={(e) => { setExamSel(e.target.value); setStudentSel(""); setPreviewId(""); }} style={inputStyle}>
                {examOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.date ? ` · ${e.date}` : ""}{showBranchInLabel ? ` · ${branchName(e.branchId)}` : ""}{e.published ? "" : " (draft)"}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label style={labelStyle}>Student</label>
            <select value={studentValue} onChange={(e) => setStudentSel(e.target.value)} style={inputStyle}>
              <option value="">Whole class ({students.length})</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.studentId ? ` (${s.studentId})` : ""}</option>)}
            </select>
          </div>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={publishedOnly} onChange={(e) => setPublishedOnly(e.target.checked)} />
          Published exams only
        </label>
      </div>

      {!repExam ? box(isTerm ? "This class has no exams with a term. Set a term on the exams, or choose “A single exam”." : "Select an exam.")
        : subjects.length === 0 ? box(<>
          <div style={{ fontWeight: 600, color: "#334155", marginBottom: 6 }}>No subjects for {repExam.grade}</div>
          Add subjects for this class on the Subjects page first.
        </>)
          : students.length === 0 ? box(<>
            <div style={{ fontWeight: 600, color: "#334155", marginBottom: 6 }}>No students in {repExam.grade}</div>
            No students have class “{repExam.grade}” in {branchName(repExam.branchId)}.
          </>)
            : (
              <>
                {/* class summary */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {statTile("Students with marks", `${stats.count} / ${students.length}`)}
                  {statTile("Class average", pctText(stats.average))}
                  {statTile("Highest", pctText(stats.highest))}
                  {statTile("Lowest", pctText(stats.lowest))}
                  {statTile("Pass rate", pctText(stats.passPercent))}
                </div>

                {meta.provisional && (
                  <div style={{ marginBottom: 14, fontSize: 13, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", borderRadius: 8, padding: "8px 12px" }}>
                    {isTerm ? "Some exams in this term are" : "This exam is"} not published yet. Cards will be marked as provisional.
                  </div>
                )}

                {/* actions */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  <button onClick={printSelection} disabled={stats.count === 0}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, opacity: stats.count === 0 ? 0.5 : 1 }}>
                    <Printer size={15} /> {selectedCard ? "Print report card" : `Print all (${cards.length})`}
                  </button>
                  <button onClick={handleCSV} style={secondaryBtn}><Download size={14} /> Result sheet CSV</button>
                  <button onClick={handlePDF} style={secondaryBtn}><FileText size={14} /> Result sheet PDF</button>
                </div>
                {stats.count === 0 && (
                  <div style={{ marginBottom: 14, fontSize: 13, color: "var(--text-muted)" }}>No marks have been entered for this class yet, so there is nothing to print.</div>
                )}

                {/* result sheet */}
                <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 18 }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 + subjects.length * 80 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th style={thStyle}>Rank</th>
                          <th style={thStyle}>Student</th>
                          {subjects.map((s) => <th key={s.id} style={{ ...thStyle, textAlign: "center" }}>{s.name}</th>)}
                          <th style={{ ...thStyle, textAlign: "center" }}>Total</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>%</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>Grade</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>Result</th>
                          <th style={thStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheetRows.map((c) => {
                          const active = previewCard && previewCard.student.id === c.student.id;
                          return (
                            <tr key={c.student.id} onClick={() => setPreviewId(c.student.id)}
                              style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: active ? "var(--primary-light)" : undefined }}>
                              <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{c.rank ?? "—"}</td>
                              <td style={{ padding: "9px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                                <div style={{ fontWeight: 500 }}>{c.student.name}</div>
                                {c.student.studentId && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{c.student.studentId}</div>}
                              </td>
                              {subjects.map((s, i) => (
                                <td key={s.id} style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", color: c.subjectRows[i].state === "absent" ? "var(--text-muted)" : undefined }}>
                                  {c.subjectRows[i].state === "marked" ? c.subjectRows[i].obtained : c.subjectRows[i].state === "absent" ? "AB" : "—"}
                                </td>
                              ))}
                              <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", whiteSpace: "nowrap" }}>{c.totals.marked > 0 ? `${c.totals.obtained} / ${c.totals.max}` : "—"}</td>
                              <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", fontWeight: 600 }}>{pctText(c.totals.percentage)}</td>
                              <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", fontWeight: 700 }}>{c.totals.grade || "—"}</td>
                              <td style={{ padding: "9px 12px", fontSize: 12, textAlign: "center", fontWeight: 600, color: c.pass === null ? "var(--text-muted)" : c.pass ? "#059669" : "#dc2626" }}>
                                {c.pass === null ? "—" : c.pass ? "Pass" : "Fail"}
                              </td>
                              <td style={{ padding: "9px 12px" }}>
                                <button onClick={(e) => { e.stopPropagation(); printCards([c], `Printed ${c.student.name}`); }}
                                  disabled={c.totals.marked === 0} title="Print this report card"
                                  style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer", display: "flex", opacity: c.totals.marked === 0 ? 0.4 : 1 }}>
                                  <Printer size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* preview */}
                {previewCard && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                      Preview — {previewCard.student.name}
                    </div>
                    <div style={{ background: "#f1f5f9", borderRadius: 12, padding: isMobile ? 8 : 16, overflowX: "auto" }}
                      dangerouslySetInnerHTML={{ __html: `<style>${CARD_CSS}</style>${cardHtml(previewCard, meta)}` }} />
                  </div>
                )}
              </>
            )}
    </div>
  );
}
