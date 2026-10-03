import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft } from "lucide-react";
import { useUser } from "../../context/UserContext";
import { normalizeLayout, listPages, searchPages } from "../../config/menu";

// Jump to any page the user can open — including ones hidden from the
// sidebar. Opened with Ctrl/Cmd+K or the sidebar's search button.
export default function CommandPalette({ onClose }) {
  const { can, isAdmin, menuLayout } = useUser();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const pages = useMemo(
    () => listPages(normalizeLayout(menuLayout), { can, isAdmin }),
    [menuLayout, can, isAdmin]
  );
  const results = useMemo(() => searchPages(pages, query), [pages, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (page) => {
    if (!page) return;
    navigate(page.to);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "12vh 12px 12px" }}
    >
      <div
        role="dialog"
        aria-label="Search pages"
        onKeyDown={onKeyDown}
        style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 520, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <Search size={18} color="#64748b" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…  (e.g. salary, invoices, journal)"
            aria-label="Search pages"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 16, background: "transparent" }}
          />
        </div>
        <div ref={listRef} role="listbox" style={{ maxHeight: "50vh", overflowY: "auto", padding: 6 }}>
          {results.length === 0 && (
            <p style={{ padding: "18px 12px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>No pages match “{query}”.</p>
          )}
          {results.map((p, i) => {
            const Icon = p.icon;
            const isActive = i === active;
            return (
              <div
                key={p.key}
                role="option"
                aria-selected={isActive}
                data-active={isActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, cursor: "pointer", background: isActive ? "var(--primary-light)" : "transparent" }}
              >
                <Icon size={17} color={isActive ? "var(--primary)" : "#475569"} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: isActive ? 600 : 400 }}>{p.label}</span>
                {p.section && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.section}</span>}
                {isActive && <CornerDownLeft size={14} color="#94a3b8" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
