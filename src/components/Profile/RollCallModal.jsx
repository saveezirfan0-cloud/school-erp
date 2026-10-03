import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { upsertDocs, serverTimestamp } from "../../firebase";
import { useRelated } from "../../hooks/useProfileData";
import { logActivity } from "../../utils/auditLog";
import { localISODate } from "../../utils/dates";
import { STATUSES } from "./AttendanceTab";

// Take attendance for a whole list in one go (a class roll-call).
// Everyone defaults to Present for the chosen day, or to whatever was already
// recorded; flip the exceptions and save. Only rows that changed are written.
//
// people: [{ id, name, sub?, branchId? }]   noun: "students" | "employees"
export default function RollCallModal({ subjectType, noun, people, scopeLabel, onClose }) {
  const today = localISODate();
  const [date, setDate] = useState(today);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);
  const { rows: existing, loading } = useRelated("attendance", { subjectType, date });
  const seeded = useRef(null);

  const existingBy = useMemo(() => Object.fromEntries(existing.map((r) => [r.subjectId, r])), [existing]);

  // Seed once per date (not on every realtime echo, which would wipe edits).
  useEffect(() => {
    if (loading || seeded.current === date) return;
    seeded.current = date;
    setMarks(Object.fromEntries(people.map((p) => [p.id, existingBy[p.id]?.status || "present"])));
  }, [loading, date, people, existingBy]);

  const changed = people.filter((p) => marks[p.id] && marks[p.id] !== existingBy[p.id]?.status);
  const count = (s) => people.filter((p) => marks[p.id] === s).length;
  const setAll = (status) => setMarks(Object.fromEntries(people.map((p) => [p.id, status])));

  const save = async () => {
    if (changed.length === 0) return onClose();
    setBusy(true);
    try {
      await upsertDocs("attendance", changed.map((p) => ({
        subjectType, subjectId: p.id, date, status: marks[p.id],
        branchId: p.branchId || "",
        // keep any note already on the day's record
        ...(existingBy[p.id]?.note ? { note: existingBy[p.id].note } : {}),
        updatedAt: serverTimestamp(),
      })), "subject_type,subject_id,date");
      logActivity("marked", noun === "students" ? "Students" : "Employees", `Attendance ${date} — ${changed.length} ${noun} (bulk)`);
      toast.success(`Attendance saved for ${changed.length} ${noun}`);
      onClose();
    } catch (err) {
      toast.error(err?.message || "Error saving attendance");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Take attendance</h3>
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none" }}><X size={20} /></button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 12px" }}>
            {people.length} {noun}{scopeLabel ? ` — ${scopeLabel}` : ""}. Everyone starts as Present; change the exceptions, then save.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date"
              style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
            <button onClick={() => setAll("present")} style={quick}>All present</button>
            <button onClick={() => setAll("absent")} style={quick}>All absent</button>
            <span style={{ marginLeft: "auto", fontSize: 12, display: "flex", gap: 10 }}>
              {Object.entries(STATUSES).map(([k, s]) => <span key={k} style={{ color: s.color, fontWeight: 600 }}>{s.label} {count(k)}</span>)}
            </span>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
            : people.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>Nobody to mark.</div>
            : people.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                  {p.sub && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.sub}</div>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {Object.entries(STATUSES).map(([k, s]) => {
                    const on = marks[p.id] === k;
                    return (
                      <button key={k} onClick={() => setMarks((m) => ({ ...m, [p.id]: k }))} aria-pressed={on} aria-label={`${p.name}: ${s.label}`}
                        style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1.5px solid ${on ? s.color : "var(--border)"}`, background: on ? s.bg : "white", color: on ? s.color : "var(--text-muted)" }}>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        <div style={{ display: "flex", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 11, border: "1px solid var(--border)", borderRadius: 8, background: "white", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={busy || loading} style={{ flex: 2, padding: 11, border: "none", borderRadius: 8, background: "var(--primary)", color: "white", fontWeight: 600, fontSize: 14, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Nothing to save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const quick = { padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", fontSize: 13 };
