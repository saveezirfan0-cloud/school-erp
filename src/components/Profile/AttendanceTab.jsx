import React, { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db, collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "../../firebase";
import { logActivity } from "../../utils/auditLog";
import { localISODate, formatDate } from "../../utils/dates";
import { cardStyle, cardHeadStyle } from "./ProfileShell";

export const STATUSES = {
  present: { label: "Present", color: "#10b981", bg: "#ecfdf5" },
  absent: { label: "Absent", color: "#ef4444", bg: "#fef2f2" },
  late: { label: "Late", color: "#d97706", bg: "#fffbeb" },
  leave: { label: "Leave", color: "#2563eb", bg: "#eff6ff" },
};

// present + late count as attended; leave is excused but still a marked day.
export function summarize(records) {
  const c = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const r of records) if (c[r.status] !== undefined) c[r.status]++;
  const marked = c.present + c.absent + c.late + c.leave;
  return { ...c, marked, rate: marked ? Math.round(((c.present + c.late) / marked) * 100) : null };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Month calendar of attendance marks for one person. `records` are that
// person's rows (see useRelated). Marks are one-per-day; the DB enforces it.
export default function AttendanceTab({ subjectType, subject, records, canEdit }) {
  const today = localISODate();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(null); // "YYYY-MM-DD"
  const [draft, setDraft] = useState({ status: "", note: "" });
  const [busy, setBusy] = useState(false);

  const byDate = useMemo(() => Object.fromEntries(records.map((r) => [r.date, r])), [records]);
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-`;
  const monthRecords = records.filter((r) => r.date?.startsWith(monthPrefix)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const month = summarize(monthRecords);
  const overall = summarize(records);

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7; // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${monthPrefix}${String(i + 1).padStart(2, "0")}`)];

  const shift = (d) => setCursor(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() }; });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const pick = (date) => {
    setSelected(date);
    setDraft({ status: byDate[date]?.status || "", note: byDate[date]?.note || "" });
  };

  const noun = subjectType === "student" ? "Students" : "Employees";
  const save = async () => {
    if (!draft.status) return toast.error("Choose a status");
    setBusy(true);
    try {
      const existing = byDate[selected];
      if (existing) {
        await updateDoc(doc(db, "attendance", existing.id), { status: draft.status, note: draft.note.trim(), updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "attendance"), {
          subjectType, subjectId: subject.id, date: selected, status: draft.status, note: draft.note.trim(),
          branchId: subject.branchId || "", createdAt: serverTimestamp(),
        });
      }
      logActivity("marked", noun, `Attendance ${subject.name} — ${selected} · ${STATUSES[draft.status].label}`);
      toast.success("Attendance saved");
      setSelected(null);
    } catch (err) {
      toast.error(err?.message || "Error saving attendance");
    } finally { setBusy(false); }
  };

  const clear = async () => {
    const existing = byDate[selected];
    if (!existing) return setSelected(null);
    setBusy(true);
    try {
      await deleteDoc(doc(db, "attendance", existing.id));
      logActivity("cleared", noun, `Attendance ${subject.name} — ${selected}`);
      toast.success("Mark cleared");
      setSelected(null);
    } catch (err) {
      toast.error(err?.message || "Error clearing attendance");
    } finally { setBusy(false); }
  };

  const stat = (label, value, color) => (
    <div style={{ flex: 1, minWidth: 110, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {stat("Present", month.present, STATUSES.present.color)}
        {stat("Absent", month.absent, STATUSES.absent.color)}
        {stat("Late", month.late, STATUSES.late.color)}
        {stat("Leave", month.leave, STATUSES.leave.color)}
        {stat("Overall rate", overall.rate == null ? "—" : `${overall.rate}%`, "var(--primary)")}
      </div>

      <div style={cardStyle}>
        <div style={cardHeadStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => shift(-1)} aria-label="Previous month" style={navBtn}><ChevronLeft size={16} /></button>
            <span style={{ minWidth: 130, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => shift(1)} aria-label="Next month" style={navBtn}><ChevronRight size={16} /></button>
          </div>
          <button onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }); }} style={{ ...navBtn, padding: "5px 10px", fontSize: 12 }}>Today</button>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {WEEKDAYS.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{w}</div>)}
            {cells.map((date, i) => {
              if (!date) return <div key={`pad${i}`} />;
              const rec = byDate[date];
              const st = rec && STATUSES[rec.status];
              const future = date > today;
              const isSel = selected === date;
              return (
                <button key={date} onClick={() => pick(date)} disabled={future || (!canEdit && !rec)} title={st ? `${date} — ${st.label}${rec.note ? ` (${rec.note})` : ""}` : date}
                  style={{ minHeight: 52, borderRadius: 8, padding: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: future ? "default" : "pointer",
                    border: isSel ? "2px solid var(--primary)" : date === today ? "2px solid #94a3b8" : "1px solid var(--border)",
                    background: st ? st.bg : (WEEKDAYS[(i) % 7] === "Sun" ? "#f8fafc" : "white"), opacity: future ? 0.4 : 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: st ? st.color : "inherit" }}>{Number(date.slice(8))}</span>
                  {st && <span style={{ fontSize: 10, fontWeight: 600, color: st.color }}>{st.label}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>
            {Object.values(STATUSES).map((s) => (
              <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} /> {s.label}
              </span>
            ))}
            <span style={{ marginLeft: "auto" }}>Attendance rate = (present + late) ÷ marked days</span>
          </div>

          {canEdit && selected && (
            <div style={{ marginTop: 16, padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{formatDate(selected)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {Object.entries(STATUSES).map(([key, s]) => {
                  const on = draft.status === key;
                  return (
                    <button key={key} onClick={() => setDraft((p) => ({ ...p, status: key }))}
                      style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1.5px solid ${on ? s.color : "var(--border)"}`, background: on ? s.bg : "white", color: on ? s.color : "inherit" }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <input value={draft.note} onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))} placeholder="Note (optional)"
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelected(null)} disabled={busy} style={{ padding: "9px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "white", fontSize: 13 }}>Cancel</button>
                {byDate[selected] && <button onClick={clear} disabled={busy} style={{ padding: "9px 14px", border: "none", borderRadius: 8, background: "#fef2f2", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>Clear mark</button>}
                <button onClick={save} disabled={busy} style={{ padding: "9px 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "white", fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={cardHeadStyle}>Records — {monthLabel}</div>
        {monthRecords.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>{canEdit ? "Nothing marked this month. Click a day above to record attendance." : "Nothing marked this month."}</div>
        ) : monthRecords.map((r) => {
          const s = STATUSES[r.status] || { label: r.status, color: "var(--text-muted)", bg: "#f8fafc" };
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
              <span style={{ width: 110, fontSize: 13 }}>{formatDate(r.date)}</span>
              <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>{s.label}</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const navBtn = { display: "flex", alignItems: "center", border: "1px solid var(--border)", background: "white", borderRadius: 6, padding: 5 };
