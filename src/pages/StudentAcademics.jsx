import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db, doc, getDoc } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import { useRelated } from "../hooks/useProfileData";
import { DEFAULT_THRESHOLD, STATUS_LABELS, formatPercent, isLowAttendance, studentAttendanceRows, todayISO } from "../utils/attendance";
import { gradeFor, trendFor } from "../utils/grading";
import { SUBMISSION_STATUS_LABELS } from "../utils/learning";
import {
  attendanceOverview,
  examHistory,
  examSubjectRows,
  formatDay,
  homeworkForStudent,
  homeworkSummary,
  monthlyAttendance,
  recentAbsences,
  rowsForStudent,
} from "../utils/studentAcademics";
import { ArrowLeft, CalendarCheck, ClipboardList, GraduationCap, Lock, Receipt } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

const STATUS_COLORS = { present: "#10b981", late: "#f59e0b", absent: "#ef4444", leave: "#64748b" };
const HW_COLORS = {
  pending: { bg: "#f1f5f9", fg: "#475569" },
  submitted: { bg: "#eff6ff", fg: "#2563eb" },
  late: { bg: "#fffbeb", fg: "#b45309" },
  graded: { bg: "#ecfdf5", fg: "#059669" },
  missing: { bg: "#fef2f2", fg: "#dc2626" },
};

const cardStyle = { background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 };
const thStyle = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" };
const tdStyle = { padding: "10px 14px", fontSize: 13 };
const emptyStyle = { padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 };

function Section({ title, icon: Icon, right, children }) {
  return (
    <section style={cardStyle}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
          <Icon size={16} color="var(--primary)" /> {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function NoAccess({ title, icon, what }) {
  return (
    <Section title={title} icon={icon}>
      <div style={{ ...emptyStyle, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Lock size={14} /> You don't have access to {what}.
      </div>
    </Section>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ flex: "1 1 120px", minWidth: 110, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "inherit" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Pill({ bg, fg, children }) {
  return <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

function AttendanceSection({ studentId }) {
  const isMobile = useIsMobile();
  const { loading, rows } = useRelated("attendance", { subjectType: "student", subjectId: studentId });
  const mine = useMemo(() => rowsForStudent(studentAttendanceRows(rows), studentId), [rows, studentId]);
  const overview = useMemo(() => attendanceOverview(mine), [mine]);
  const months = useMemo(() => monthlyAttendance(mine), [mine]);
  const absences = useMemo(() => recentAbsences(mine, 8), [mine]);
  const low = isLowAttendance(overview.percent, DEFAULT_THRESHOLD);

  return (
    <Section title="Attendance" icon={CalendarCheck}>
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : mine.length === 0 ? (
        <div style={emptyStyle}>No attendance has been marked for this student yet.</div>
      ) : (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label="Attendance" value={formatPercent(overview.percent)} color={low ? "#ef4444" : "#10b981"} sub={low ? `Below ${DEFAULT_THRESHOLD}%` : "Present + late"} />
            {["present", "late", "absent", "leave"].map((s) => (
              <Stat key={s} label={STATUS_LABELS[s]} value={overview[s]} color={STATUS_COLORS[s]} />
            ))}
          </div>

          {months.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-muted)" }}>Attendance % by month</div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={months} margin={{ left: -20, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : `${v}%`)} />
                    <Bar dataKey="percent" name="Attendance" fill="#7a2535" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 300 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Month", "P", "L", "A", "Lv", "%"].map((h) => <th key={h} style={{ ...thStyle, padding: "8px 10px" }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...months].reverse().map((m) => (
                      <tr key={m.key} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...tdStyle, padding: "8px 10px", whiteSpace: "nowrap" }}>{m.label}</td>
                        <td style={{ ...tdStyle, padding: "8px 10px" }}>{m.present}</td>
                        <td style={{ ...tdStyle, padding: "8px 10px" }}>{m.late}</td>
                        <td style={{ ...tdStyle, padding: "8px 10px", color: m.absent ? "#ef4444" : undefined }}>{m.absent}</td>
                        <td style={{ ...tdStyle, padding: "8px 10px" }}>{m.leave}</td>
                        <td style={{ ...tdStyle, padding: "8px 10px", fontWeight: 600, color: isLowAttendance(m.percent) ? "#ef4444" : undefined }}>{formatPercent(m.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>P present, L late, A absent, Lv leave (leave is not counted in the %).</div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-muted)" }}>Recent absences</div>
          {absences.length === 0 ? (
            <div style={{ fontSize: 13, color: "#10b981" }}>No absences recorded.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {absences.map((a) => (
                <span key={a.date} title={a.note || ""} style={{ padding: "4px 10px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 500 }}>
                  {formatDay(a.date)}{a.note ? ` • ${a.note}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Exam results
// ---------------------------------------------------------------------------

// Wrapper that subscribes to subjects (needs canViewLearning) so the body
// can show subject names; without that permission the body shows "Subject".
function ResultsWithSubjects(props) {
  const { rows } = useCollection("subjects");
  return <ResultsBody {...props} subjects={rows} />;
}

function ResultsSection(props) {
  const { can } = useUser();
  return can("canViewLearning") ? <ResultsWithSubjects {...props} /> : <ResultsBody {...props} subjects={[]} />;
}

function ResultsBody({ student, canEdit, subjects }) {
  const isMobile = useIsMobile();
  const examsQ = useCollection("exams");
  const resultsQ = useCollection("examResults");
  const studentsQ = useCollection("students");
  const [selectedId, setSelectedId] = useState("");

  const loading = examsQ.loading || resultsQ.loading || studentsQ.loading;
  const hasClass = String(student.grade ?? "").trim() !== "";

  const history = useMemo(
    () => examHistory({ student, exams: examsQ.rows, results: resultsQ.rows, students: studentsQ.rows, includeUnpublished: canEdit }),
    [student, examsQ.rows, resultsQ.rows, studentsQ.rows, canEdit]
  );
  const trend = useMemo(
    () => trendFor(history.filter((h) => h.hasMarks).map((h) => h.exam), resultsQ.rows, student.id)
      .map((t) => ({ name: t.exam.name || formatDay(t.exam.date), percentage: t.percentage, grade: gradeFor(t.percentage) })),
    [history, resultsQ.rows, student.id]
  );

  const selected = history.find((h) => h.exam.id === selectedId) || history.find((h) => h.hasMarks) || history[0] || null;
  const subjectRows = useMemo(
    () => (selected ? examSubjectRows({ exam: selected.exam, results: resultsQ.rows, subjects, studentId: student.id }) : []),
    [selected, resultsQ.rows, subjects, student.id]
  );

  const marksText = (h) => (h.hasMarks ? `${h.totals.obtained}/${h.totals.max}` : "—");
  const rankText = (h) => (h.rank ? `${h.rank} of ${h.classSize}` : "—");
  const pctText = (h) => (h.percentage === null ? "—" : `${h.percentage}%`);
  const passColor = (h) => (h.pass === false ? "#ef4444" : h.pass ? "#10b981" : "var(--text-muted)");

  return (
    <Section title="Exam results" icon={GraduationCap}>
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : !hasClass ? (
        <div style={emptyStyle}>This student has no class (grade) set, so no exams apply. Set a grade on the Students page.</div>
      ) : history.length === 0 ? (
        <div style={emptyStyle}>No {canEdit ? "" : "published "}exams for {student.grade} yet.</div>
      ) : (
        <div style={{ padding: 16 }}>
          {trend.length >= 2 ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-muted)" }}>Percentage trend</div>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={trend} margin={{ left: -20, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, _n, p) => [`${v}% (${p.payload.grade})`, "Result"]} />
                  <Line type="monotone" dataKey="percentage" stroke="#7a2535" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>A trend chart appears once there are results for two exams.</div>
          )}

          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((h) => (
                <button key={h.exam.id} onClick={() => setSelectedId(h.exam.id)}
                  style={{ textAlign: "left", cursor: "pointer", background: selected && selected.exam.id === h.exam.id ? "var(--primary-light)" : "white", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.exam.name || "Exam"} {!h.exam.published && <Pill bg="#f1f5f9" fg="#475569">Draft</Pill>}</div>
                    <div style={{ fontWeight: 700, color: passColor(h) }}>{pctText(h)} {h.grade && `• ${h.grade}`}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {[h.exam.term, formatDay(h.exam.date)].filter((x) => x && x !== "—").join(" • ")} • Marks {marksText(h)} • Rank {rankText(h)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Exam", "Date", "Marks", "%", "Grade", "Rank"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.exam.id} onClick={() => setSelectedId(h.exam.id)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: selected && selected.exam.id === h.exam.id ? "var(--primary-light)" : undefined }}>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        {h.exam.name || "Exam"} {!h.exam.published && <Pill bg="#f1f5f9" fg="#475569">Draft</Pill>}
                        {h.exam.term && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{h.exam.term}</div>}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDay(h.exam.date)}</td>
                      <td style={tdStyle}>{marksText(h)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: passColor(h) }}>{pctText(h)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{h.grade || "—"}</td>
                      <td style={tdStyle}>{rankText(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Subjects — {selected.exam.name || "Exam"}</div>
                <select value={selected.exam.id} onChange={(e) => setSelectedId(e.target.value)} aria-label="Select exam"
                  style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, maxWidth: "100%" }}>
                  {history.map((h) => <option key={h.exam.id} value={h.exam.id}>{h.exam.name || "Exam"}{h.exam.date ? ` (${formatDay(h.exam.date)})` : ""}</option>)}
                </select>
              </div>
              {subjectRows.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No marks entered for this exam yet.</div>
              ) : (
                <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Subject", "Marks", "%", "Grade", "Remarks"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {subjectRows.map((s) => (
                        <tr key={s.subjectId} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{s.name}</td>
                          {s.state === "marked" ? (
                            <>
                              <td style={tdStyle}>{s.obtained}/{s.max}</td>
                              <td style={tdStyle}>{s.percentage}%</td>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{s.grade}</td>
                            </>
                          ) : (
                            <td style={{ ...tdStyle, color: "var(--text-muted)" }} colSpan={3}>{s.state === "absent" ? "Absent" : "Not entered"}</td>
                          )}
                          <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{s.remarks || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {canEdit && history.some((h) => !h.exam.published) && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>Draft exams are visible to you because you can edit exams; they are hidden from others until published.</div>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

const HW_PREVIEW = 12;

function HomeworkSection({ student }) {
  const isMobile = useIsMobile();
  const assignmentsQ = useCollection("assignments");
  const submissionsQ = useCollection("submissions", { filters: { studentId: student.id } });
  const subjectsQ = useCollection("subjects");
  const [showAll, setShowAll] = useState(false);

  const today = todayISO();
  const items = useMemo(
    () => homeworkForStudent({ student, assignments: assignmentsQ.rows, submissions: submissionsQ.rows, today }),
    [student, assignmentsQ.rows, submissionsQ.rows, today]
  );
  const summary = useMemo(() => homeworkSummary(items), [items]);
  const subjectName = useMemo(() => new Map(subjectsQ.rows.map((s) => [String(s.id), s.name])), [subjectsQ.rows]);
  const loading = assignmentsQ.loading || submissionsQ.loading;
  const shown = showAll ? items : items.slice(0, HW_PREVIEW);

  return (
    <Section title="Homework" icon={ClipboardList}>
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={emptyStyle}>No homework has been set for this student's class yet.</div>
      ) : (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <Stat label="Completion" value={`${summary.percent}%`} color={summary.percent >= 75 ? "#10b981" : summary.percent >= 50 ? "#f59e0b" : "#ef4444"} sub={`${summary.handedIn} of ${summary.total} handed in`} />
            <Stat label="Pending" value={summary.pending} />
            <Stat label="Late" value={summary.late} color={summary.late ? "#b45309" : undefined} />
            <Stat label="Missing" value={summary.missing} color={summary.missing ? "#ef4444" : undefined} />
          </div>
          {String(student.grade ?? "").trim() === "" && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>No class is set for this student, so only homework for all classes is shown.</div>
          )}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {shown.map(({ assignment: a, submission, status, overdue }, i) => {
              const c = HW_COLORS[status] || HW_COLORS.pending;
              const flagged = status === "missing" || overdue;
              const marks = submission && status === "graded" && submission.marks !== null && submission.marks !== undefined && submission.marks !== ""
                ? `${submission.marks}${a.maxMarks ? `/${a.maxMarks}` : ""}` : "";
              return (
                <div key={a.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 6 : 12, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)", background: flagged ? "#fef2f2" : "white" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title || "Untitled"}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {[subjectName.get(String(a.subjectId)), a.dueDate ? `Due ${formatDay(a.dueDate)}` : "No due date"].filter(Boolean).join(" • ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {marks && <span style={{ fontSize: 12, fontWeight: 600 }}>{marks}</span>}
                    {overdue && status === "pending" && <Pill bg="#fef2f2" fg="#dc2626">Overdue</Pill>}
                    <Pill bg={c.bg} fg={c.fg}>{SUBMISSION_STATUS_LABELS[status] || status}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
          {items.length > HW_PREVIEW && (
            <button onClick={() => setShowAll((v) => !v)} style={{ marginTop: 10, border: "none", background: "none", color: "var(--primary)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              {showAll ? "Show fewer" : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StudentAcademics() {
  const { id } = useParams();
  const { can } = useUser();
  const { branches } = useBranch();
  const [student, setStudent] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | notfound | error

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setStudent(null);
    getDoc(doc(db, "students", id))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) return setState("notfound");
        const data = { id: snap.id, ...snap.data() };
        if (data.deletedAt) return setState("notfound");
        setStudent(data);
        setState("ready");
      })
      .catch((err) => {
        console.error("StudentAcademics load error:", err);
        if (!cancelled) setState("error");
      });
    return () => { cancelled = true; };
  }, [id]);

  const linkStyle = { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", textDecoration: "none", fontSize: 14 };
  const backLink = <Link to="/students" style={linkStyle}><ArrowLeft size={16} /> Students</Link>;

  if (state === "loading") return <div style={emptyStyle}>Loading…</div>;
  if (state !== "ready") {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>{backLink}</div>
        <div style={{ ...cardStyle, ...emptyStyle }}>
          {state === "notfound" ? "Student not found. They may have been deleted." : "Could not load this student. Please try again."}
        </div>
      </div>
    );
  }

  const canAttendance = can("canViewAttendance");
  const canExams = can("canViewExams");
  const canLearning = can("canViewLearning");
  const branchName = student.branchId && student.branchId !== "main"
    ? (branches.find((b) => b.id === student.branchId)?.name || "Branch")
    : "Main Office";

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {backLink}
        {can("canViewFees") && (
          <Link to={`/students/${student.id}/ledger`} style={{ ...linkStyle, color: "#2563eb" }}><Receipt size={15} /> Fee ledger</Link>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, wordBreak: "break-word" }}>
          {student.name || "Student"}{" "}
          {student.studentId && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)", fontFamily: "monospace" }}>{student.studentId}</span>}
        </h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
          {String(student.grade ?? "").trim() || "No class set"} • {branchName}
          {student.parentName ? ` • Parent: ${student.parentName}` : ""}
        </div>
      </div>

      {canAttendance ? <AttendanceSection studentId={student.id} /> : <NoAccess title="Attendance" icon={CalendarCheck} what="attendance records" />}
      {canExams ? <ResultsSection student={student} canEdit={can("canEditExams")} /> : <NoAccess title="Exam results" icon={GraduationCap} what="exam results" />}
      {canLearning ? <HomeworkSection student={student} /> : <NoAccess title="Homework" icon={ClipboardList} what="homework" />}
    </div>
  );
}
