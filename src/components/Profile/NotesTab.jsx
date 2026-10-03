import React, { useState } from "react";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { updateDocs, serverTimestamp } from "../../firebase";
import { useAuth } from "../../context/AuthContext";
import { logActivity } from "../../utils/auditLog";
import { formatDate, formatTime } from "../../utils/dates";
import { cardStyle, cardHeadStyle } from "./ProfileShell";

// Timestamped notes kept on the record itself (extra jsonb → `notesLog`).
// updateDocs merges into `extra`, so the record's other extra fields
// are untouched.
export default function NotesTab({ collectionName, moduleLabel, record, canEdit }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = [...(record.notesLog || [])].sort((a, b) => (a.at < b.at ? 1 : -1));

  const write = async (next, okMsg, logVerb) => {
    setBusy(true);
    try {
      await updateDocs(collectionName, [record.id], { notesLog: next, updatedAt: serverTimestamp() });
      logActivity(logVerb, moduleLabel, `Note on ${record.name}`);
      toast.success(okMsg);
      return true;
    } catch (err) {
      toast.error(err?.message || "Error saving note");
      return false;
    } finally { setBusy(false); }
  };

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: body, at: new Date().toISOString(), by: user?.email || "" };
    if (await write([...(record.notesLog || []), note], "Note added", "added")) setText("");
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this note?")) return;
    await write((record.notesLog || []).filter((n) => n.id !== id), "Note deleted", "deleted");
  };

  return (
    <div>
      {canEdit && (
        <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Add a note — a call, a conversation, anything worth remembering…"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button onClick={add} disabled={busy || !text.trim()} style={{ padding: "9px 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "white", fontSize: 13, fontWeight: 600, opacity: busy || !text.trim() ? 0.5 : 1 }}>Add note</button>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={cardHeadStyle}>Notes ({notes.length})</div>
        {notes.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>No notes yet.</div>
        ) : notes.map((n) => (
          <div key={n.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{formatDate(n.at)} {formatTime(n.at)}{n.by ? ` • ${n.by}` : ""}</div>
            </div>
            {canEdit && <button onClick={() => remove(n.id)} disabled={busy} title="Delete note" style={{ alignSelf: "flex-start", border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 8px", borderRadius: 6 }}><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
