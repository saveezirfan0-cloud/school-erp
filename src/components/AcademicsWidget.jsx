import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { useCollection } from "../hooks/useCollection";
import { attendanceToday, formatDay, homeworkDueSoon } from "../utils/studentAcademics";
import { todayStr } from "../utils/learning";
import { CalendarCheck, ClipboardList, GraduationCap } from "lucide-react";

const cardStyle = { background: "white", borderRadius: 12, padding: "16px 20px", border: "1px solid var(--border)", marginBottom: 20 };
const tileStyle = { flex: "1 1 90px", minWidth: 80, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" };

function Tile({ label, value, color }) {
  return (
    <div style={tileStyle}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// Classes marked needs the student list (to know how many classes exist), so
// it lives in its own component and only subscribes when allowed.
function AttendancePart({ activeBranch, withClasses }) {
  const attendance = useCollection("attendance", { activeBranch });
  return withClasses
    ? <AttendanceWithClasses activeBranch={activeBranch} rows={attendance.filtered} loading={attendance.loading} />
    : <AttendanceTiles rows={attendance.filtered} students={undefined} loading={attendance.loading} />;
}

function AttendanceWithClasses({ activeBranch, rows, loading }) {
  const students = useCollection("students", { activeBranch });
  return <AttendanceTiles rows={rows} students={students.filtered} loading={loading || students.loading} />;
}

function AttendanceTiles({ rows, students, loading }) {
  const t = useMemo(() => attendanceToday(rows, students, todayStr()), [rows, students]);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
        <CalendarCheck size={14} /> Attendance
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tile label="Present" value={t.present} color="#10b981" />
            <Tile label="Absent" value={t.absent} color={t.absent ? "#ef4444" : undefined} />
            <Tile label="Late" value={t.late} color={t.late ? "#f59e0b" : undefined} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            {t.marked === 0
              ? "Attendance has not been marked today."
              : t.classesTotal === null
                ? `${t.marked} student${t.marked === 1 ? "" : "s"} marked today.`
                : `Marked for ${t.classesMarked} of ${t.classesTotal} class${t.classesTotal === 1 ? "" : "es"}.`}
            {t.leave > 0 ? ` ${t.leave} on leave.` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function HomeworkPart({ activeBranch }) {
  const assignments = useCollection("assignments", { activeBranch });
  const due = useMemo(() => homeworkDueSoon(assignments.filtered, todayStr(), 7), [assignments.filtered]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
        <ClipboardList size={14} /> Homework due in the next 7 days
      </div>
      {assignments.loading ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
      ) : due.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Nothing due this week.</div>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)", marginBottom: 6 }}>{due.length}</div>
          {due.slice(0, 3).map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.title || "Untitled"}{a.grade ? <span style={{ color: "var(--text-muted)" }}> • {a.grade}</span> : null}
              </span>
              <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDay(a.dueDate)}</span>
            </div>
          ))}
          {due.length > 3 && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>+{due.length - 3} more</div>}
        </>
      )}
    </div>
  );
}

// Dashboard "Academics today" card. Renders nothing unless the user may view
// attendance and/or learning data, and only subscribes to what they may view.
export default function AcademicsWidget() {
  const { activeBranch } = useBranch();
  const { can } = useUser();
  const showAttendance = can("canViewAttendance");
  const showHomework = can("canViewLearning");
  if (!showAttendance && !showHomework) return null;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <GraduationCap size={16} color="var(--primary)" /> Academics today
        </h3>
        <div style={{ display: "flex", gap: 12 }}>
          {showAttendance && <Link to="/attendance" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>Attendance →</Link>}
          {showHomework && <Link to="/homework" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>Homework →</Link>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: showAttendance && showHomework ? "repeat(auto-fit, minmax(260px, 1fr))" : "1fr", gap: 20 }}>
        {showAttendance && <AttendancePart activeBranch={activeBranch} withClasses={can("canViewStudents")} />}
        {showHomework && <HomeworkPart activeBranch={activeBranch} />}
      </div>
    </div>
  );
}
