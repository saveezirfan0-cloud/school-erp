import React, { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X, SlidersHorizontal, Search, Star } from "lucide-react";
import { useUser } from "../../context/UserContext";
import { MENU_ITEMS, normalizeLayout, resolveMenu, isItemAllowed } from "../../config/menu";
import MenuEditor from "./MenuEditor";

const COLLAPSED_KEY = "zmi.menu.collapsed";

const readCollapsed = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const isOnPage = (pathname, to) =>
  to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");

const PINNED_ID = "__pinned";

export default function Sidebar({ onClose, onSearch }) {
  const { can, isAdmin, menuLayout, menuPrefs, saveMenuPrefs } = useUser();
  const { pathname } = useLocation();
  const [editing, setEditing] = useState(false);
  // Synced with the profile; localStorage only seeds the first paint.
  const [localCollapsed] = useState(readCollapsed);
  const collapsed = menuPrefs.collapsed ?? localCollapsed;

  const access = { can, isAdmin };
  const sections = useMemo(
    () => resolveMenu(normalizeLayout(menuLayout), { can, isAdmin }),
    [menuLayout, can, isAdmin]
  );
  const pinned = menuPrefs.pinned.filter((k) => isItemAllowed(k, access));
  const allSections = pinned.length ? [{ id: PINNED_ID, label: "Pinned", items: pinned }, ...sections] : sections;
  const labelled = allSections.filter((s) => s.label.trim()).map((s) => s.id);
  const allCollapsed = labelled.length > 0 && labelled.every((id) => collapsed.includes(id));

  const setCollapsed = (next) => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    saveMenuPrefs({ ...menuPrefs, collapsed: next });
  };
  const toggleSection = (id) =>
    setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
  const toggleAll = () => setCollapsed(allCollapsed ? [] : labelled);

  const togglePin = (key) => {
    const next = menuPrefs.pinned.includes(key) ? menuPrefs.pinned.filter((k) => k !== key) : [...menuPrefs.pinned, key];
    saveMenuPrefs({ ...menuPrefs, pinned: next });
  };

  const renderLink = (key, nested) => {
    const { to, icon: Icon, label } = MENU_ITEMS[key];
    const isPinned = menuPrefs.pinned.includes(key);
    return (
      <div key={key} className="nav-row" style={{ position: "relative" }}>
      <NavLink
        to={to}
        end={to === "/"}
        onClick={onClose}
        style={({ isActive }) => ({
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          borderRadius: 8,
          marginBottom: 2,
          color: isActive ? "white" : "rgba(255,255,255,0.6)",
          background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
          textDecoration: "none",
          fontSize: nested ? 13.5 : 14,
          fontWeight: isActive ? 600 : 400,
          borderLeft: isActive ? "3px solid #2a8c7a" : "3px solid transparent",
          transition: "all 0.15s",
        })}
      >
        <Icon size={16} />
        {label}
      </NavLink>
      <button
        className="nav-star"
        onClick={() => togglePin(key)}
        aria-label={isPinned ? `Unpin ${label}` : `Pin ${label}`}
        title={isPinned ? "Unpin" : "Pin to top"}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", padding: 5, borderRadius: 6, display: "flex", color: isPinned ? "#f5c451" : "rgba(255,255,255,0.5)" }}
      >
        <Star size={13} fill={isPinned ? "#f5c451" : "none"} />
      </button>
      </div>
    );
  };

  return (
    <aside style={{
      width: 240,
      background: "var(--sidebar-bg)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
      height: "100vh",
    }}>

      {/* Header */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/zmi_logo.png"
            alt="ZMI"
            style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 8, background: "white", padding: 3 }}
          />
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>ZMI</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Zohra Majeed Institute</div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: 6,
              cursor: "pointer",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            onClick={onSearch}
            aria-label="Search pages"
            style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", fontSize: 13, textAlign: "left" }}
          >
            <Search size={14} />
            <span style={{ flex: 1 }}>Search…</span>
            <kbd className="hide-mobile" style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)", fontFamily: "inherit" }}>Ctrl K</kbd>
          </button>
          <button
            onClick={toggleAll}
            aria-label={allCollapsed ? "Expand all sections" : "Collapse all sections"}
            title={allCollapsed ? "Expand all" : "Collapse all"}
            style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", borderRadius: 8, padding: "0 9px", display: "flex", alignItems: "center" }}
          >
            {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </button>
        </div>
        {allSections.map((section) => {
          // Unlabelled section: plain top-level links.
          if (!section.label.trim()) {
            return <div key={section.id} style={{ marginBottom: 6 }}>{section.items.map((k) => renderLink(k, false))}</div>;
          }

          // Stay open while one of its pages is the current page.
          const hasActive = section.items.some((k) => isOnPage(pathname, MENU_ITEMS[k].to));
          const isOpen = hasActive || !collapsed.includes(section.id);
          return (
            <div key={section.id} style={{ marginBottom: 6 }}>
              <button
                onClick={() => toggleSection(section.id)}
                aria-expanded={isOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 12px 6px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {section.label}
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {isOpen && section.items.map((k) => renderLink(k, true))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "8px 8px 12px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => setEditing(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "rgba(255,255,255,0.55)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <SlidersHorizontal size={15} /> Customize menu
        </button>
        <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
          ZMI School Management © 2026
        </div>
      </div>

      {editing && <MenuEditor onClose={() => setEditing(false)} />}
    </aside>
  );
}
