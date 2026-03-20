import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { LogOut } from "lucide-react";

export default function Navbar() {
  const { logout, user } = useAuth();
  const { branches, activeBranch, setActiveBranch } = useBranch();

  return (
    <header style={{ background: "white", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <select value={activeBranch} onChange={e => setActiveBranch(e.target.value)}
        style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "white", fontSize: 14, cursor: "pointer" }}>
        <option value="all">🏢 All Branches</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{user?.email}</span>
        <button onClick={logout} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <LogOut size={16} /> Logout
        </button>
      </div>
    </header>
  );
}