import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, UserCheck, Receipt, TrendingDown, Building2, Settings } from "lucide-react";

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
      
      {/* Logo Section */}
      <div style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img 
            src="/zmi_logo.png" 
            alt="ZMI Logo" 
            style={{ width: 42, height: 42, objectFit: "contain", borderRadius: 8, background: "white", padding: 3 }} 
          />
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }}>ZMI</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, letterSpacing: 0.3 }}>Zohra Majeed Institute</div>
          </div>
        </div>
      </div>

      {/* Nav Links */}
      <nav style={{ flex: 1, padding: "12px 10px" }}>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "white" : "rgba(255,255,255,0.55)",
              background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
              textDecoration: "none", fontSize: 14, fontWeight: isActive ? 600 : 400,
              transition: "all 0.15s",
              borderLeft: isActive ? "3px solid #2a8c7a" : "3px solid transparent",
            })}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
        ZMI School Management © 2026
      </div>

    </aside>
  );
}