// src/pages/ActivityLog.jsx
//
// Admin-only view of the audit_log table: who did what, where, when.
// Defense in depth: the sidebar link and this page both check
// isAdmin, and the database itself only allows admins to SELECT from
// audit_log (see supabase/security.sql), so a non-admin reaching this
// URL sees nothing either way. The log is append-only — no UPDATE or
// DELETE is permitted for anyone, so entries can't be tampered with.

import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, query, orderBy, limit } from "../firebase";
import { useUser } from "../context/UserContext";
import Pagination from "../components/UI/Pagination";
import ListToolbar from "../components/UI/ListToolbar";
import { exportToCSV } from "../utils/exportUtils";
import { History, ShieldAlert, Download } from "lucide-react";

const MAX_ROWS = 500; // most recent entries kept live in the view

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// Colour an action badge by its verb so the list scans quickly.
function actionStyle(action = "") {
  const a = action.toLowerCase();
  if (a.includes("delete") || a.includes("purge") || a.includes("empt"))
    return { background: "#fef2f2", color: "#ef4444" };
  if (a.includes("restore"))
    return { background: "#f0fdfa", color: "#0d9488" };
  if (a.includes("create") || a.includes("add") || a.includes("generate") || a.includes("record"))
    return { background: "#ecfdf5", color: "#10b981" };
  if (a.includes("paid") || a.includes("collect") || a.includes("pay"))
    return { background: "#ecfdf5", color: "#059669" };
  if (a.includes("update") || a.includes("edit"))
    return { background: "#eff6ff", color: "#2563eb" };
  if (a.includes("revers"))
    return { background: "#fffbeb", color: "#f59e0b" };
  return { background: "#f1f5f9", color: "#475569" };
}

function formatTime(row) {
  const raw = row.timestamp || row.createdAt;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ActivityLog() {
  const { isAdmin } = useUser();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const unsub = onSnapshot(
      query(collection(db, "auditLog"), orderBy("createdAt", "desc"), limit(MAX_ROWS)),
      (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("Activity log load error:", err); setLoading(false); }
    );
    return unsub;
  }, [isAdmin]);

  useEffect(() => { setPage(1); }, [search, filterModule, filterAction, pageSize]);

  // Everything below only matters for admins, but hooks must run
  // unconditionally, so the guard renders at the end.
  const modules = [...new Set(rows.map((r) => r.module).filter(Boolean))].sort();
  const actions = [...new Set(rows.map((r) => r.action).filter(Boolean))].sort();

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const matchModule = !filterModule || r.module === filterModule;
    const matchAction = !filterAction || r.action === filterAction;
    const matchSearch = !q
      || (r.user || "").toLowerCase().includes(q)
      || (r.details || "").toLowerCase().includes(q);
    return matchModule && matchAction && matchSearch;
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleCSV = () => exportToCSV("activity-log",
    ["Time", "User", "Action", "Module", "Details"],
    filtered.map((r) => [formatTime(r), r.user, r.action, r.module, r.details])
  );

  const hasFilters = !!(search || filterModule || filterAction);

  if (!isAdmin) {
    return (
      <div style={{ padding: 48, textAlign: "center", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
        <ShieldAlert size={36} style={{ color: "var(--danger)", marginBottom: 10 }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Administrators only</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>The activity log is restricted to admin accounts.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <History size={20} /> Activity Log
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            Who did what, across every module. Showing the latest {Math.min(rows.length, MAX_ROWS)} entries · admin-only · entries can't be edited or deleted.
          </p>
        </div>
        {!isMobile && (
          <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
            <Download size={14} /> CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search user or details..."
        filters={[
          { key: "module", value: filterModule, onChange: setFilterModule, placeholder: "All Modules", options: modules.map((m) => ({ value: m, label: m })) },
          { key: "action", value: filterAction, onChange: setFilterAction, placeholder: "All Actions", options: actions.map((a) => ({ value: a, label: a })) },
        ]}
        active={hasFilters}
        onClear={() => { setSearch(""); setFilterModule(""); setFilterAction(""); }}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>Loading…</div>
      ) : isMobile ? (
        /* Mobile cards */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map((r) => (
            <div key={r.id} style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ ...actionStyle(r.action), padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{r.action}</span>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, background: "#f1f5f9", color: "#475569", fontWeight: 600 }}>{r.module}</span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatTime(r)}</span>
              </div>
              <div style={{ fontSize: 14, marginBottom: 4 }}>{r.details || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.user}</div>
            </div>
          ))}
          {total === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
              No activity recorded yet
            </div>
          )}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Time", "User", "Action", "Module", "Details"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 14px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatTime(r)}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{r.user}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ ...actionStyle(r.action), padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{r.action}</span>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{r.module}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{r.details || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No activity recorded yet</div>}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />
    </div>
  );
}
