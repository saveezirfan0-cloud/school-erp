import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check, Building2, SlidersHorizontal } from "lucide-react";
import { useBranch, HEAD_OFFICE } from "../../context/BranchContext";
import { useUser } from "../../context/UserContext";

// Workspace picker shown at the top of the sidebar. Head Office is the
// consolidated workspace; each branch is its own workspace.
export default function WorkspaceSwitcher() {
  const { workspaces, workspace, setWorkspace, canSwitchWorkspace } = useBranch();
  const { can } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = workspaces.find(w => w.id === workspace) || workspaces[0];
  const tile = (w, size) => {
    if (w.id === HEAD_OFFICE) {
      return (
        <img
          src="/zmi_logo.png"
          alt="Head Office"
          style={{ width: size, height: size, borderRadius: size * 0.28, flexShrink: 0, objectFit: "contain", background: "white", padding: size * 0.08 }}
        />
      );
    }
    return (
      <div style={{
        width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
        background: "#2a8c7a",
        display: "flex", alignItems: "center", justifyContent: "center", color: "white",
      }}>
        <Building2 size={size * 0.5} />
      </div>
    );
  };

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0, flex: 1 }}>
      <button
        onClick={() => canSwitchWorkspace && setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "transparent", border: "none", padding: 0, textAlign: "left",
          cursor: canSwitchWorkspace ? "pointer" : "default", color: "white", minWidth: 0,
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          {tile(current, 38)}
          {canSwitchWorkspace && (
            <span style={{
              position: "absolute", right: -5, bottom: -5, width: 16, height: 16, borderRadius: "50%",
              background: "#1f1f2e", border: "1px solid rgba(255,255,255,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ChevronDown size={10} />
            </span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {current.name}
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>
            {current.id === HEAD_OFFICE ? "ZMI · " : "ZMI Branch · "}{current.subtitle}
          </div>
        </div>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 10px)", left: -8, width: 224, zIndex: 120,
            background: "white", borderRadius: 14, border: "1px solid var(--border)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)", padding: 8, color: "#1e293b",
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: "#64748b" }}>
            WORKSPACES
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {workspaces.map(w => {
              const selected = w.id === workspace;
              return (
                <button
                  key={w.id}
                  role="option"
                  aria-selected={selected}
                  onClick={() => { setWorkspace(w.id); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px",
                    borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left",
                    background: selected ? "#f5eaec" : "transparent",
                  }}
                >
                  {tile(w, 30)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{w.subtitle}</div>
                  </div>
                  {selected && <Check size={16} color="#7a2535" />}
                </button>
              );
            })}
          </div>
          {can("canManageBranches") && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
              <button
                onClick={() => { setOpen(false); navigate("/branches"); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px",
                  borderRadius: 10, border: "none", background: "transparent", cursor: "pointer",
                  color: "#64748b", fontSize: 14,
                }}
              >
                <SlidersHorizontal size={16} /> Manage workspaces
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
