// src/components/UI/Pagination.jsx
// Shared pagination bar: page size selector + prev/next + page
// numbers + a "showing X–Y of N" label. Matches the app's maroon
// theme and stays usable on mobile.

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({
  page, pageCount, total, pageSize, onPage, onPageSize,
  pageSizeOptions = [10, 25, 50, 100],
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Compact page-number window (max 5 around current).
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(pageCount, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = [];
  for (let p = start; p <= end; p++) pages.push(p);

  const btn = (active) => ({
    minWidth: 34, height: 34, padding: "0 8px", borderRadius: 8,
    border: "1px solid var(--border)",
    background: active ? "var(--primary)" : "white",
    color: active ? "white" : "#334155",
    fontWeight: active ? 700 : 500, fontSize: 13,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  });
  const arrow = (disabled) => ({
    ...btn(false), opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, flexWrap: "wrap", marginTop: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
        <span>Showing <strong style={{ color: "#334155" }}>{from}–{to}</strong> of <strong style={{ color: "#334155" }}>{total}</strong></span>
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button style={arrow(page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>

        {start > 1 && (
          <>
            <button style={btn(false)} onClick={() => onPage(1)}>1</button>
            {start > 2 && <span style={{ color: "var(--text-muted)", padding: "0 2px" }}>…</span>}
          </>
        )}

        {pages.map((p) => (
          <button key={p} style={btn(p === page)} onClick={() => onPage(p)}>{p}</button>
        ))}

        {end < pageCount && (
          <>
            {end < pageCount - 1 && <span style={{ color: "var(--text-muted)", padding: "0 2px" }}>…</span>}
            <button style={btn(false)} onClick={() => onPage(pageCount)}>{pageCount}</button>
          </>
        )}

        <button style={arrow(page >= pageCount)} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
