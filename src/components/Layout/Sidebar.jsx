import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, UserCheck, Receipt, TrendingDown, Building2, Settings, Zap } from "lucide-react";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/students", icon: Users, label: "Students" },
  { to: "/employees", icon: UserCheck, label: "Employees" },
  { to: "/fees", icon: Receipt, label: "Fees & Invoices" },
  { to: "/expenses", icon: TrendingDown, label: "Expenses" },
  { to: "/branches", icon: Building2, label: "Branches" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside style={{ width: 240, background: "var(--sidebar-bg)", display: "flex", flexDirection: "column", padding: "0", flexShrink: 0 }}>
      <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "var(--primary)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={18} color="white" />
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>ZMI</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>School Management</div>
          </div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: "12px 10px" }}>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "white" : "rgba(255,255,255,0.55)",
              background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
              textDecoration: "none", fontSize: 14, fontWeight: isActive ? 600 : 400,
              transition: "all 0.15s"
            })}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}