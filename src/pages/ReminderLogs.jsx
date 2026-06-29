import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, orderBy, query, limit, getDocs } from "../firebase";
import { toMillis, formatDate, formatTime } from "../utils/dates";
import { CheckCircle, XCircle, Clock, MessageCircle, Play, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

export default function ReminderLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState({ totalOverdue: 0, totalPending: 0 });

  useEffect(() => {
    // Try with orderBy first, fall back to simple collection if no index
    let unsub;
    try {
      unsub = onSnapshot(
        query(collection(db, "reminderLogs"), orderBy("timestamp", "desc"), limit(30)),
        (snap) => {
          setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          console.warn("OrderBy failed, trying without:", err);
          // Fallback without orderBy
          unsub = onSnapshot(collection(db, "reminderLogs"), (snap) => {
            const sorted = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
            setLogs(sorted);
            setLoading(false);
          });
        }
      );
    } catch (e) {
      unsub = onSnapshot(collection(db, "reminderLogs"), (snap) => {
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      });
    }

    // Also fetch overdue stats
    fetchStats();

    return () => unsub && unsub();
  }, []);

  const fetchStats = async () => {
    try {
      const invoicesSnap = await getDocs(collection(db, "invoices"));
      const invoices = invoicesSnap.docs.map(d => d.data());
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pending = invoices.filter(i => i.status === "pending").length;
      const overdue = invoices.filter(i => {
        if (i.status !== "pending" || !i.dueDate) return false;
        return new Date(i.dueDate) < today;
      }).length;

      setStats({ totalOverdue: overdue, totalPending: pending });
    } catch (e) {
      console.error("Stats error:", e);
    }
  };

  const handleManualSend = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/send-reminders", {
        method: "POST",
        headers: {
          "x-cron-secret": process.env.REACT_APP_CRON_SECRET || "",
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Done! Sent ${data.sent} reminders, ${data.failed} failed`);
        fetchStats();
      } else {
        toast.error(data.error || "Failed to send reminders");
      }
    } catch (err) {
      toast.error("Could not reach reminder API. Make sure it is deployed.");
    }
    setSending(false);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>WhatsApp Reminder Logs</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
            Daily automatic fee reminders sent to parents
          </p>
        </div>
        <button
          onClick={handleManualSend}
          disabled={sending}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 18px", background: sending ? "#c4a0a8" : "#2a8c7a",
            color: "white", border: "none", borderRadius: 8,
            cursor: sending ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
          }}
        >
          {sending ? <RefreshCw size={15} /> : <Play size={15} />}
          {sending ? "Sending..." : "Send Reminders Now"}
        </button>
      </div>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Overdue Invoices", value: stats.totalOverdue, color: "#ef4444", bg: "#fef2f2" },
          { label: "Total Pending", value: stats.totalPending, color: "#f59e0b", bg: "#fffbeb" },
          { label: "Reminder Runs", value: logs.length, color: "#10b981", bg: "#ecfdf5" },
          { label: "Total Sent", value: logs.reduce((s, l) => s + (l.sent || 0), 0), color: "#4f46e5", bg: "#eef2ff" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Schedule info */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", marginBottom: 24, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Clock size={18} color="#10b981" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Automatic Schedule</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Reminders run automatically every day at <strong>8:00 AM Pakistan time</strong> via GitHub Actions.
            Only invoices with a due date in the past are included. Each invoice gets a maximum of one reminder per day.
            Parents without a phone number are skipped automatically.
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid var(--primary-light)", borderTop: "3px solid var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Empty state */}
      {!loading && logs.length === 0 && (
        <div style={{ background: "white", borderRadius: 12, padding: 48, textAlign: "center", border: "1px solid var(--border)" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <MessageCircle size={24} color="#10b981" />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No reminder logs yet</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>
            Logs appear here after reminders are sent. Click "Send Reminders Now" to do a manual test run, or wait for the automatic 8am run.
          </p>
          <button
            onClick={handleManualSend}
            disabled={sending || stats.totalOverdue === 0}
            style={{
              padding: "11px 24px", background: stats.totalOverdue === 0 ? "#e2e8f0" : "#2a8c7a",
              color: stats.totalOverdue === 0 ? "var(--text-muted)" : "white",
              border: "none", borderRadius: 8, cursor: stats.totalOverdue === 0 ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
            }}
          >
            {stats.totalOverdue === 0 ? "No overdue invoices right now" : `Send ${stats.totalOverdue} Reminder${stats.totalOverdue > 1 ? "s" : ""} Now`}
          </button>
        </div>
      )}

      {/* Logs list */}
      {!loading && logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {logs.map(log => (
            <div key={log.id} style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              {/* Log header */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MessageCircle size={18} color="#10b981" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {formatDate(log.timestamp, "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) || "Date unknown"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                      {formatTime(log.timestamp)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ textAlign: "center", padding: "8px 14px", background: "#ecfdf5", borderRadius: 8 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>{log.sent || 0}</div>
                    <div style={{ fontSize: 11, color: "#10b981", fontWeight: 500 }}>Sent</div>
                  </div>
                  {log.failed > 0 && (
                    <div style={{ textAlign: "center", padding: "8px 14px", background: "#fef2f2", borderRadius: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#ef4444" }}>{log.failed}</div>
                      <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 500 }}>Failed</div>
                    </div>
                  )}
                  <div style={{ textAlign: "center", padding: "8px 14px", background: "#fffbeb", borderRadius: 8 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>{log.overdueCount || 0}</div>
                    <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 500 }}>Overdue</div>
                  </div>
                </div>
              </div>

              {/* Results table */}
              {log.results && log.results.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Student", "Status", "Days Overdue"].map(h => (
                          <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {log.results.map((r, i) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 500 }}>{r.student}</td>
                          <td style={{ padding: "10px 16px" }}>
                            {r.status === "sent" ? (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#10b981", fontWeight: 500 }}>
                                <CheckCircle size={14} /> Sent
                              </span>
                            ) : r.status?.includes("skipped") ? (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#f59e0b", fontWeight: 500 }}>
                                <Clock size={14} /> {r.status}
                              </span>
                            ) : (
                              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#ef4444", fontWeight: 500 }}>
                                <XCircle size={14} /> {r.status}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-muted)" }}>
                            {r.daysOverdue ? `${r.daysOverdue} day${r.daysOverdue > 1 ? "s" : ""}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}