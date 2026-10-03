import React, { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, X, SlidersHorizontal } from "lucide-react";
import { useUser } from "../../context/UserContext";
import { MENU_ITEMS, normalizeLayout, resolveMenu } from "../../config/menu";
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

export default function Sidebar({ onClose }) {
  const { can, isAdmin, menuLayout } = useUser();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [editing, setEditing] = useState(false);

  const sections = useMemo(
    () => resolveMenu(normalizeLayout(menuLayout), { can, isAdmin }),
    [menuLayout, can, isAdmin]
  );

  const toggleSection = (id) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const renderLink = (key, nested) => {
    const { to, icon: Icon, label } = MENU_ITEMS[key];
    return (
      <NavLink
        key={key}
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
        {sections.map((section) => {
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
