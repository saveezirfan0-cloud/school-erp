import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { LogOut, Menu } from "lucide-react";

export default function Navbar({ onMenuClick }) {
  const { logout, user } = useAuth();
  const { branches, workspaceName, isHeadOffice, canFilterBranches, branchFilter, setBranchFilter } = useBranch();

  return (
    <header style={{
      background: "white", borderBottom: "1px solid var(--border)",
      padding: "0 16px", height: "56px", display: "flex",
      alignItems: "center", justifyContent: "space-between",
      gap: 12, flexShrink: 0, zIndex: 10, position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onMenuClick}
          style={{ border: "none", background: "none", cursor: "pointer", padding: "6px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, flexShrink: 0 }}>
          <Menu size={22} color="#475569" />
        </button>
        {canFilterBranches ? (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "white", fontSize: 13, cursor: "pointer", maxWidth: 200 }}>
            <option value="all">🏢 All Branches</option>
            <option value="main">🏫 Head Office only</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : (
          <span style={{ padding: "5px 10px", borderRadius: 6, background: isHeadOffice ? "#f5eaec" : "#e6f4f1", color: isHeadOffice ? "#7a2535" : "#2a8c7a", fontSize: 13, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {workspaceName}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{user?.email}</span>
        <button onClick={logout}
          style={{ border: "1px solid var(--border)", background: "white", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, fontSize: 13 }}>
          <LogOut size={14} /> Logout
        </button>
      </div>
    </header>
  );
}