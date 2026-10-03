import React, { useEffect, useMemo, useState } from "react";
import { upsertDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import { logActivity } from "../utils/auditLog";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import {
  STATUSES, STATUS_LABELS, DEFAULT_THRESHOLD,
  gradeLabel, gradeOptions, sortStudents,
  buildStudentReport, overallPercent, dailyClassSummary, formatPercent,
  todayISO, presetRange, normaliseRange, isInRange,
  effectiveEntry, rosterCounts, buildMarkRows,
  ATTENDANCE_CONFLICT, studentAttendanceRows,
} from "../utils/attendance";
import toast from "react-hot-toast";
import { CheckCheck, Download, FileText, Save, AlertTriangle } from "lucide-react";

const STATUS_COLORS = {
  present: "#10b981",
  absent: "#ef4444",
  late: "#f59e0b",
  leave: "#3b82f6",
};
const EMPTY = Object.freeze({});
const STATUS_SHORT = { present: "P", absent: "A", late: "L", leave: "Lv" };

const inputStyle = { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", boxSizing: "border-box" };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 };
const outlineBtn = { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 };
const thStyle = { padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function Empty({ children }) {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>{children}</div>;
}

function Loading({ children = "Loading..." }) {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{children}</div>;
}

function StatusBadge({ status }) {
  if (!status) return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not marked</span>;
  return (
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: STATUS_COLORS[status], background: `${STATUS_COLORS[status]}1a` }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatusToggle({ value, onChange, disabled, fullWidth }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: fullWidth ? "repeat(4, 1fr)" : "repeat(4, auto)", gap: 6 }}>
      {STATUSES.map((st) => {
        const on = value === st;
        return (
          <button
            key={st}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(st)}
            style={{
              padding: fullWidth ? "9px 4px" : "6px 11px",
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
              border: `1.5px solid ${STATUS_COLORS[st]}`,
              background: on ? STATUS_COLORS[st] : "white",
              color: on ? "white" : STATUS_COLORS[st],
            }}
          >
            {STATUS_LABELS[st]}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "inherit" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

// =====================================================================
// Mark attendance
// =====================================================================
function MarkTab({ students, attendanceRows, loading, canEdit, isMobile, markedBy }) {
  const [date, setDate] = useState(todayISO());
  const [grade, setGrade] = useState("");
  // The draft is keyed to date+grade, so switching either starts clean.
  const draftKey = `${date}|${grade}`;
  const [draftState, setDraftState] = useState({ key: draftKey, map: {} });
  const draft = draftState.key === draftKey ? draftState.map : EMPTY;
  const [saving, setSaving] = useState(false);

  const grades = useMemo(() => gradeOptions(students), [students]);
  const roster = useMemo(
    () => (grade ? sortStudents(students.filter((s) => gradeLabel(s.grade) === grade)) : []),
    [students, grade]
  );

  // Saved rows for this date, by student doc id (re-opening edits, not duplicates).
  const savedByStudent = useMemo(() => {
    const m = {};
    for (const r of attendanceRows) if (r.date === date) m[r.studentId] = r;
    return m;
  }, [attendanceRows, date]);

  const counts = rosterCounts(roster, draft, savedByStudent);
  const dirtyCount = Object.keys(draft).length;
  const hasSavedForRoster = roster.some((s) => savedByStudent[s.id]);

  const patch = (id, p) =>
    setDraftState((prev) => {
      const base = prev.key === draftKey ? prev.map : {};
      return { key: draftKey, map: { ...base, [id]: { ...base[id], ...p } } };
    });

  const confirmDiscard = () => dirtyCount === 0 || window.confirm("Discard unsaved attendance changes?");
  const changeDate = (v) => { if (v && confirmDiscard()) setDate(v); };
  const changeGrade = (v) => { if (confirmDiscard()) setGrade(v); };

  const markAllPresent = () => {
    const overriding = roster.some((s) => {
      const st = effectiveEntry(draft[s.id], savedByStudent[s.id]).status;
      return st && st !== "present";
    });
    if (overriding && !window.confirm("Some students are already marked absent/late/leave. Set everyone to Present?")) return;
    setDraftState((prev) => {
      const base = prev.key === draftKey ? prev.map : {};
      const next = { ...base };
      for (const s of roster) next[s.id] = { ...next[s.id], status: "present" };
      return { key: draftKey, map: next };
    });
  };

  const save = async () => {
    const rows = buildMarkRows({ students: roster, draft, savedByStudent, date, markedBy });
    if (rows.length === 0) { toast.error("Nothing to save — mark at least one student"); return; }
    setSaving(true);
    try {
      await upsertDocs("attendance", rows, ATTENDANCE_CONFLICT);
      const isUpdate = rows.some((r) => savedByStudent[r.subjectId]);
      const c = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
      toast.success(`Attendance saved for ${rows.length} student${rows.length === 1 ? "" : "s"}`);
      logActivity(isUpdate ? "updated" : "created", "Attendance",
        `${grade} · ${date} · ${rows.length} students (P ${c.present || 0}, A ${c.absent || 0}, L ${c.late || 0}, Lv ${c.leave || 0})`);
      setDraftState({ key: draftKey, map: {} });
    } catch (err) {
      toast.error(err?.message || "Error saving attendance");
    } finally { setSaving(false); }
  };

  const entryOf = (s) => effectiveEntry(draft[s.id], savedByStudent[s.id]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div style={{ flex: isMobile ? "1 1 140px" : "0 0 auto" }}>
          <label style={labelStyle} htmlFor="att-date">Date</label>
          <input id="att-date" type="date" value={date} max={todayISO()} onChange={(e) => changeDate(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </div>
        <div style={{ flex: isMobile ? "1 1 160px" : "0 0 220px" }}>
          <label style={labelStyle} htmlFor="att-grade">Class</label>
          <select id="att-grade" value={grade} onChange={(e) => changeGrade(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
            <option value="">Select a class...</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        {canEdit && grade && roster.length > 0 && (
          <button type="button" onClick={markAllPresent} style={{ ...outlineBtn, color: STATUS_COLORS.present, borderColor: STATUS_COLORS.present, fontWeight: 600 }}>
            <CheckCheck size={14} /> Mark all present
          </button>
        )}
      </div>

      {!canEdit && (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          You have view-only access to attendance.
        </div>
      )}

      {loading ? (
        <Loading>Loading students...</Loading>
      ) : students.length === 0 ? (
        <Empty>No students in this branch yet. Add students first.</Empty>
      ) : !grade ? (
        <Empty>Select a class to mark or review attendance.</Empty>
      ) : roster.length === 0 ? (
        <Empty>No students in {grade}.</Empty>
      ) : (
        <>
          {/* live summary */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(6, 1fr)", gap: 8, marginBottom: 14 }}>
            <StatCard label="Students" value={counts.total} />
            {STATUSES.map((st) => <StatCard key={st} label={STATUS_LABELS[st]} value={counts[st]} color={STATUS_COLORS[st]} />)}
            <StatCard label="Unmarked" value={counts.unmarked} color={counts.unmarked ? "var(--text-muted)" : undefined} />
          </div>
          {hasSavedForRoster && dirtyCount === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              Showing saved attendance for {date}. {canEdit ? "Change anything and save to update it." : ""}
            </div>
          )}

          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {roster.map((s) => {
                const e = entryOf(s);
                return (
                  <div key={s.id} style={{ background: "white", borderRadius: 12, padding: 14, border: `1px solid ${e.status ? STATUS_COLORS[e.status] : "var(--border)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{s.studentId}</div>
                      </div>
                      {!canEdit && <StatusBadge status={e.status} />}
                    </div>
                    {canEdit && <StatusToggle fullWidth value={e.status} onChange={(st) => patch(s.id, { status: st })} />}
                    {canEdit ? (
                      <input value={e.note} onChange={(ev) => patch(s.id, { note: ev.target.value })} disabled={!e.status}
                        placeholder={e.status ? "Note (optional)" : "Mark a status to add a note"} style={{ ...inputStyle, width: "100%", marginTop: 8 }} />
                    ) : e.note && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.note}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["#", "ID", "Name", "Status", "Note"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((s, i) => {
                      const e = entryOf(s);
                      return (
                        <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 14px", fontSize: 12, color: "var(--text-muted)" }}>{i + 1}</td>
                          <td style={{ padding: "9px 14px", fontSize: 12, fontFamily: "monospace" }}>{s.studentId}</td>
                          <td style={{ padding: "9px 14px", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>{s.name}</td>
                          <td style={{ padding: "9px 14px" }}>
                            {canEdit ? <StatusToggle value={e.status} onChange={(st) => patch(s.id, { status: st })} /> : <StatusBadge status={e.status} />}
                          </td>
                          <td style={{ padding: "9px 14px", width: "30%" }}>
                            {canEdit ? (
                              <input value={e.note} onChange={(ev) => patch(s.id, { note: ev.target.value })} disabled={!e.status}
                                placeholder={e.status ? "Optional note" : "—"} style={{ ...inputStyle, width: "100%" }} />
                            ) : <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{e.note || "—"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canEdit && (
            <div style={{ position: "sticky", bottom: 0, background: "var(--bg, #f8fafc)", padding: "12px 0", marginTop: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {dirtyCount ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}` : "No unsaved changes"}
              </span>
              <button type="button" onClick={save} disabled={saving || dirtyCount === 0}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving || dirtyCount === 0 ? "default" : "pointer", fontWeight: 600, fontSize: 13, opacity: saving || dirtyCount === 0 ? 0.55 : 1 }}>
                <Save size={14} /> {saving ? "Saving..." : hasSavedForRoster ? "Update attendance" : "Save attendance"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
// History / report
// =====================================================================
function HistoryTab({ students, attendanceRows, loading, isMobile, branchName }) {
  const initial = useMemo(() => presetRange("month"), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [grade, setGrade] = useState("");
  const [studentPick, setStudentPick] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [lowOnly, setLowOnly] = useState(false);
  const [sortBy, setSortBy] = useState("name");

  const range = normaliseRange(from, to);
  const thresholdNum = Number.isFinite(Number(threshold)) && threshold !== "" ? Number(threshold) : DEFAULT_THRESHOLD;

  const grades = useMemo(() => gradeOptions(students), [students]);
  const classStudents = useMemo(
    () => sortStudents(grade ? students.filter((s) => gradeLabel(s.grade) === grade) : students),
    [students, grade]
  );
  const studentId = classStudents.some((s) => s.id === studentPick) ? studentPick : "";
  const scopeStudents = useMemo(
    () => (studentId ? classStudents.filter((s) => s.id === studentId) : classStudents),
    [classStudents, studentId]
  );

  const scopedRows = useMemo(() => {
    const ids = new Set(scopeStudents.map((s) => s.id));
    return attendanceRows.filter((r) => ids.has(r.studentId) && isInRange(r.date, range.from, range.to));
  }, [attendanceRows, scopeStudents, range.from, range.to]);

  const report = useMemo(() => buildStudentReport(scopeStudents, scopedRows, thresholdNum), [scopeStudents, scopedRows, thresholdNum]);
  const shownReport = useMemo(() => {
    let list = lowOnly ? report.filter((r) => r.low) : report;
    if (sortBy === "percent") {
      // unmarked students (null) go last
      list = [...list].sort((a, b) => (a.percent === null) - (b.percent === null) || (a.percent ?? 0) - (b.percent ?? 0) || a.name.localeCompare(b.name));
    } else if (sortBy === "absent") {
      list = [...list].sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name));
    }
    return list;
  }, [report, lowOnly, sortBy]);

  const studentGrade = useMemo(() => {
    const m = {};
    for (const s of students) m[s.id] = s.grade;
    return m;
  }, [students]);
  const daily = useMemo(
    () => dailyClassSummary(scopedRows, (r) => r.grade || studentGrade[r.studentId]),
    [scopedRows, studentGrade]
  );

  const lowCount = report.filter((r) => r.low).length;
  const overall = overallPercent(report);
  const daysMarked = new Set(scopedRows.map((r) => r.date)).size;
  const rangeText = `${range.from || "start"} to ${range.to || "today"}`;
  const scopeText = [grade || "All classes", branchName].filter(Boolean).join(" · ");
  const fileTag = `${range.from || "all"}_${range.to || "all"}`;

  const reportHeaders = ["Student ID", "Name", "Class", "Present", "Absent", "Late", "Leave", "Days marked", "Attendance %", `Below ${thresholdNum}%`];
  const reportCells = (esc) => shownReport.map((r) => [esc(r.studentId), esc(r.name), esc(r.grade), r.present, r.absent, r.late, r.leave, r.total, formatPercent(r.percent), r.low ? "Low" : ""]);
  const dailyHeaders = ["Date", "Class", "Present", "Absent", "Late", "Leave", "Marked", "Attendance %"];
  const dailyCells = (esc) => daily.map((d) => [d.date, esc(d.grade), d.present, d.absent, d.late, d.leave, d.total, formatPercent(d.percent)]);
  const raw = (v) => v;

  const applyPreset = (name) => { const r = presetRange(name); setFrom(r.from); setTo(r.to); };

  return (
    <div>
      {/* filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <div style={{ flex: isMobile ? "1 1 130px" : "0 0 auto" }}>
          <label style={labelStyle} htmlFor="att-from">From</label>
          <input id="att-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </div>
        <div style={{ flex: isMobile ? "1 1 130px" : "0 0 auto" }}>
          <label style={labelStyle} htmlFor="att-to">To</label>
          <input id="att-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </div>
        <div style={{ flex: isMobile ? "1 1 130px" : "0 0 170px" }}>
          <label style={labelStyle} htmlFor="att-hgrade">Class</label>
          <select id="att-hgrade" value={grade} onChange={(e) => setGrade(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
            <option value="">All classes</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ flex: isMobile ? "1 1 130px" : "0 0 200px" }}>
          <label style={labelStyle} htmlFor="att-hstudent">Student</label>
          <select id="att-hstudent" value={studentId} onChange={(e) => setStudentPick(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
            <option value="">All students</option>
            {classStudents.map((s) => <option key={s.id} value={s.id}>{s.name}{s.studentId ? ` (${s.studentId})` : ""}</option>)}
          </select>
        </div>
        <div style={{ flex: isMobile ? "1 1 110px" : "0 0 110px" }}>
          <label style={labelStyle} htmlFor="att-threshold">Low below %</label>
          <input id="att-threshold" type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {[["today", "Today"], ["week", "Last 7 days"], ["month", "This month"], ["lastMonth", "Last month"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => applyPreset(k)} style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 20, background: "white", fontSize: 12, cursor: "pointer" }}>{l}</button>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Only below {thresholdNum}%
        </label>
        <select aria-label="Sort report" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}>
          <option value="name">Sort: Name</option>
          <option value="percent">Sort: Lowest % first</option>
          <option value="absent">Sort: Most absences</option>
        </select>
      </div>

      {loading ? (
        <Loading>Loading attendance...</Loading>
      ) : students.length === 0 ? (
        <Empty>No students in this branch yet.</Empty>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
            <StatCard label="Students" value={report.length} />
            <StatCard label="Overall attendance" value={formatPercent(overall)} sub={`${daysMarked} day${daysMarked === 1 ? "" : "s"} marked`} />
            <StatCard label={`Below ${thresholdNum}%`} value={lowCount} color={lowCount ? "var(--danger)" : undefined} />
            <StatCard label="Records" value={scopedRows.length} />
          </div>

          {/* per-student report */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Student attendance <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>({shownReport.length})</span></h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={shownReport.length === 0} style={outlineBtn}
                onClick={() => exportToCSV(`attendance-report_${fileTag}`, reportHeaders, reportCells(raw))}><Download size={14} /> CSV</button>
              <button type="button" disabled={shownReport.length === 0} style={outlineBtn}
                onClick={() => exportToPDF(`Attendance Report — ${scopeText} (${rangeText})`, reportHeaders, reportCells(raw))}><FileText size={14} /> PDF</button>
            </div>
          </div>
          {shownReport.length === 0 ? (
            <Empty>{lowOnly ? `No students below ${thresholdNum}% in this period.` : "No students match these filters."}</Empty>
          ) : isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {shownReport.map((r) => (
                <div key={r.id} style={{ background: r.low ? "#fef2f2" : "white", borderRadius: 12, padding: 14, border: `1px solid ${r.low ? "#fecaca" : "var(--border)"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.studentId} · {r.grade}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: r.low ? "var(--danger)" : "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                      {r.low && <AlertTriangle size={15} />}{formatPercent(r.percent)}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, fontSize: 12 }}>
                    {STATUSES.map((st) => (
                      <div key={st}><div style={{ color: "var(--text-muted)" }}>{STATUS_LABELS[st]}</div><div style={{ fontWeight: 600, color: STATUS_COLORS[st] }}>{r[st]}</div></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["ID", "Name", "Class", "Present", "Absent", "Late", "Leave", "Days", "Attendance"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shownReport.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--border)", background: r.low ? "#fef2f2" : undefined }}>
                        <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>{r.studentId}</td>
                        <td style={{ padding: "10px 14px", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>{r.name}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{r.grade}</td>
                        {STATUSES.map((st) => <td key={st} style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: r[st] ? STATUS_COLORS[st] : "var(--text-muted)" }}>{r[st]}</td>)}
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{r.total}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: r.low ? "var(--danger)" : "inherit", whiteSpace: "nowrap" }}>
                          {r.low && <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}{formatPercent(r.percent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            Attendance % = (present + late) / (present + late + absent). Leave is not counted either way.
          </div>

          {/* daily class-wise summary */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 8px", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Daily class summary <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>({daily.length})</span></h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={daily.length === 0} style={outlineBtn}
                onClick={() => exportToCSV(`attendance-daily_${fileTag}`, dailyHeaders, dailyCells(raw))}><Download size={14} /> CSV</button>
              <button type="button" disabled={daily.length === 0} style={outlineBtn}
                onClick={() => exportToPDF(`Daily Attendance Summary — ${scopeText} (${rangeText})`, dailyHeaders, dailyCells(raw))}><FileText size={14} /> PDF</button>
            </div>
          </div>
          {daily.length === 0 ? (
            <Empty>No attendance has been marked in this period.</Empty>
          ) : isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {daily.map((d) => (
                <div key={`${d.date}|${d.grade}`} style={{ background: "white", borderRadius: 12, padding: 12, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{d.date} · {d.grade}</div>
                    <div style={{ fontWeight: 700 }}>{formatPercent(d.percent)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    {STATUSES.map((st) => <span key={st} style={{ color: STATUS_COLORS[st], fontWeight: 600 }}>{STATUS_SHORT[st]} {d[st]}</span>)}
                    <span style={{ color: "var(--text-muted)" }}>of {d.total}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ overflow: "auto", maxHeight: 460 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                      {["Date", "Class", "Present", "Absent", "Late", "Leave", "Marked", "Attendance"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((d) => (
                      <tr key={`${d.date}|${d.grade}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{d.date}</td>
                        <td style={{ padding: "9px 14px", fontSize: 13 }}>{d.grade}</td>
                        {STATUSES.map((st) => <td key={st} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: d[st] ? STATUS_COLORS[st] : "var(--text-muted)" }}>{d[st]}</td>)}
                        <td style={{ padding: "9px 14px", fontSize: 13 }}>{d.total}</td>
                        <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700 }}>{formatPercent(d.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
// Page
// =====================================================================
export default function Attendance() {
  const { branches, activeBranch } = useBranch();
  const { can, userProfile } = useUser();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("mark");

  const canEdit = can("canEditAttendance");

  // Students of the active branch. Attendance rows are loaded unscoped: the
  // roster is already branch-scoped and every lookup goes through studentId,
  // so a student who later moves branch keeps their history.
  const { filtered: students, loading: studentsLoading } = useCollection("students", { activeBranch, sortBy: "name" });
  const { rows: allAttendance, loading: attLoading } = useCollection("attendance", { activeBranch, branchScoped: false });
  // The table also holds employee attendance; this page only deals with students.
  const attendanceRows = useMemo(() => studentAttendanceRows(allAttendance), [allAttendance]);

  const branchName = activeBranch === "all" ? "All branches"
    : activeBranch === "main" ? "Main Office"
    : branches.find((b) => b.id === activeBranch)?.name || "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>
          Attendance <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({branchName})</span>
        </h2>
        <div role="tablist" style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 4, borderRadius: 10 }}>
          {[["mark", "Mark attendance"], ["history", "History & reports"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
              style={{ padding: "7px 14px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === k ? "white" : "transparent", color: tab === k ? "var(--primary)" : "var(--text-muted)", boxShadow: tab === k ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {tab === "mark" ? (
        <MarkTab students={students} attendanceRows={attendanceRows} loading={studentsLoading || attLoading}
          canEdit={canEdit} isMobile={isMobile} markedBy={userProfile?.email || ""} />
      ) : (
        <HistoryTab students={students} attendanceRows={attendanceRows} loading={studentsLoading || attLoading}
          isMobile={isMobile} branchName={branchName === "All branches" ? "" : branchName} />
      )}
    </div>
  );
}
