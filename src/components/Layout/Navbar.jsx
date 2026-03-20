import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { LogOut, Menu } from "lucide-react";

export default function Navbar({ onMenuClick }) {
  const { logout, user } = useAuth();
  const { branches, activeBranch, setActiveBranch } = useBranch();

  return (
    <header style={{
      background: "white",
      borderBottom: "1px solid var(--border)",
      padding: "0 16px",
      height: "var(--header-height)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Hamburger — mobile only */}
        <button onClick={onMenuClick}
          style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
          className="show-mobile">
          <Menu size={22} color="#475569" />
        </button>

        <select value={activeBranch} onChange={e => setActiveBranch(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "white", fontSize: 13, cursor: "pointer", maxWidth: 160 }}>
          <option value="all">🏢 All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", display: "none" }} className="hide-mobile-text">
          {user?.email}
        </span>
        <button onClick={logout}
          style={{ border: "1px solid var(--border)", background: "white", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, fontSize: 13 }}>
          <LogOut size={14} /> <span className="hide-mobile">Logout</span>
        </button>
      </div>
    </header>
  );
}