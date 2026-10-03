import React, { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { useUser } from "../../context/UserContext";
import { LogOut, Menu } from "lucide-react";

export default function Navbar({ onMenuClick }) {
  const { logout, user } = useAuth();
  const { branches, activeBranch, setActiveBranch } = useBranch();
  const { assignedBranchId } = useUser();

  // Staff limited to one branch can only work in that branch (the
  // database enforces the same scope; this keeps the UI consistent).
  useEffect(() => {
    if (assignedBranchId && activeBranch !== assignedBranchId) setActiveBranch(assignedBranchId);
  }, [assignedBranchId, activeBranch, setActiveBranch]);

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
        <select value={activeBranch} onChange={e => setActiveBranch(e.target.value)} disabled={!!assignedBranchId}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "white", fontSize: 13, cursor: "pointer", maxWidth: 180 }}>
          {!assignedBranchId && <option value="all">🏢 All Branches</option>}
          {!assignedBranchId && <option value="main">🏫 Main Office</option>}
          {branches.filter(b => !assignedBranchId || b.id === assignedBranchId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
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