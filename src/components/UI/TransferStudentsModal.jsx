// src/components/UI/TransferStudentsModal.jsx
//
// Move one or more students to another class and/or branch. Each student is
// given the next free class number in the new class (editable when moving a
// single student). onApply receives the plan from planTransfer plus the
// transfer date and note; the page does the writes.

import React, { useMemo, useState } from "react";
import { X, Loader2, ArrowRightLeft } from "lucide-react";
import { planTransfer, classNoHolder } from "../../utils/classNo";
import { studentName } from "../../utils/studentLabel";

const KEEP = "__keep";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function TransferStudentsModal({ students, allStudents, branches, grades, busy, onApply, onClose }) {
  const isMobile = useIsMobile();
  const single = students.length === 1 ? students[0] : null;
  const [toGrade, setToGrade] = useState(single?.grade || "");
  const [toBranch, setToBranch] = useState(KEEP);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [classNoEdit, setClassNoEdit] = useState(null); // single student: typed override

  const branchName = (id) => (id ? branches.find((b) => b.id === id)?.name || "Unknown branch" : "Main Office");
  const grade = toGrade.trim();

  const plan = useMemo(
    () => (grade ? planTransfer(allStudents, students, grade, toBranch === KEEP ? undefined : toBranch) : []),
    [allStudents, students, grade, toBranch]
  );
  const finalPlan = single && classNoEdit != null && plan[0] && !plan[0].unchanged
    ? [{ ...plan[0], classNo: classNoEdit.trim() }]
    : plan;
  const moves = finalPlan.filter((p) => !p.unchanged);
  const clash = single && moves[0] ? classNoHolder(allStudents, moves[0].grade, moves[0].branchId, moves[0].classNo, single.id) : null;
  const canApply = !busy && grade && moves.length > 0 && !(single && !moves[0].classNo) && !clash;

  const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14, border: "1px solid var(--border)", boxSizing: "border-box" };
  const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
      <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 520, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowRightLeft size={16} /> {single ? `Transfer ${studentName(single)}` : `Transfer ${students.length} students`}
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          {single
            ? `Currently ${single.grade || "no class"}${single.classNo ? ` (Class No. ${single.classNo})` : ""}, ${branchName(single.branchId)}. Their Reg No. stays the same.`
            : "Each student gets the next free class number in the new class. Reg Nos. stay the same."}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="transferGrade">To class</label>
            <input id="transferGrade" list="transferGrades" value={toGrade} placeholder="e.g. Class 2"
              onChange={(e) => { setToGrade(e.target.value); setClassNoEdit(null); }} style={inputStyle} />
            <datalist id="transferGrades">{grades.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
          <div>
            <label style={labelStyle} htmlFor="transferBranch">To branch</label>
            <select id="transferBranch" value={toBranch} onChange={(e) => { setToBranch(e.target.value); setClassNoEdit(null); }} style={inputStyle}>
              <option value={KEEP}>{single ? `Keep (${branchName(single.branchId)})` : "Keep current branch"}</option>
              <option value="">Main Office</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {single && (
            <div>
              <label style={labelStyle} htmlFor="transferClassNo">New class no.</label>
              <input id="transferClassNo" type="number" min="1" disabled={!moves.length}
                value={moves[0]?.classNo ?? ""} onChange={(e) => setClassNoEdit(e.target.value)} style={inputStyle} />
              {clash && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>Class No. {moves[0].classNo} is already {studentName(clash)}'s</div>}
            </div>
          )}
          <div>
            <label style={labelStyle} htmlFor="transferDate">Transfer date</label>
            <input id="transferDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
            <label style={labelStyle} htmlFor="transferNote">Note (optional)</label>
            <input id="transferNote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Promoted, moved branch" style={inputStyle} />
          </div>
        </div>

        {grade && !single && (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8, maxHeight: 220, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Reg No.", "Name", "From", "New Class No."].map((h) => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {finalPlan.map((p) => (
                  <tr key={p.student.id} style={{ borderTop: "1px solid var(--border)", color: p.unchanged ? "var(--text-muted)" : undefined }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{p.student.studentId}</td>
                    <td style={{ padding: "7px 10px" }}>{studentName(p.student)}</td>
                    <td style={{ padding: "7px 10px" }}>{p.student.grade || "—"}{p.student.classNo ? ` #${p.student.classNo}` : ""}</td>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{p.unchanged ? "Already in this class" : p.classNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {grade && single && plan[0]?.unchanged && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>{studentName(single)} is already in this class and branch.</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14, background: "white" }}>Cancel</button>
          <button type="button" disabled={!canApply} onClick={() => onApply(moves, { date, note: note.trim() })}
            style={{ flex: 2, padding: 11, background: canApply ? "var(--primary)" : "#cbd5e1", color: "white", border: "none", borderRadius: 8, cursor: canApply ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {busy && <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
            {moves.length > 1 ? `Transfer ${moves.length} students` : "Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}
