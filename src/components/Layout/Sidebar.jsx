import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, UserCheck, Receipt, TrendingDown,
  Building2, Settings, BookOpen, CreditCard, FileText,
  BarChart2, ChevronDown, ChevronRight, Landmark, BookMarked, X
} from "lucide-react";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/students", icon: Users, label: "Students" },
  { to: "/employees", icon: UserCheck, label: "Employees" },
  {
    label: "Accounting", icon: BookOpen, children: [
      { to: "/chart-of-accounts", icon: BookOpen, label: "Chart of Accounts" },
      { to: "/bank-cash", icon: Landmark, label: "Bank & Cash" },
      { to: "/journals", icon: BookMarked, label: "Journals" },
      { to: "/fees", icon: Receipt, label: "Fees & Invoices" },
      { to: "/expenses", icon: TrendingDown, label: "Expenses" },
      { to: "/payments", icon: CreditCard, label: "Payments" },
      { to: "/payslips", icon: FileText, label: "Payslips" },
    ]
  },
  { to: "/reports", icon: BarChart2, label: "Reports" },
  { to: "/branches", icon: Building2, label: "Branches" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar({ onClose }) {
  const [openGroup, setOpenGroup] = useState("Accounting");

  return (
    <aside style={{
      width: 240, background: "var(--sidebar-bg)",
      display: "flex", flexDirection: "column",
      flexShrink: 0, overflowY: "auto", height: "100vh"
    }}>
      {/* Header */}
      <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/zmi_logo.png" alt="ZMI" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 8, background: "white", padding: 3 }} />
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>ZMI</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Zohra Majeed Institute</div>
          </div>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button onClick={onClose} style={{ border: "none", background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: 6, cursor: "pointer", color: "white", display: "flex" }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px" }}>
        {nav.map((item) => {
          if (item.children) {
            const isOpen = openGroup === item.label;
            return (
              <div key={item.label}>
                <button onClick={() => setOpenGroup(isOpen ? null : item.label)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 12px", borderRadius: 8, marginBottom: 2, color: "rgba(255,255,255,0.7)", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <item.icon size={16} />{item.label}
                  </div>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {isOpen && (
                  <div style={{ paddingLeft: 10, marginBottom: 4 }}>
                    {item.children.map(({ to, icon: Icon, label }) => (
                      <NavLink key={to} to={to} onClick={onClose}
                        style={({ isActive }) => ({
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 8, marginBottom: 2,
                          color: isActive ? "white" : "rgba(255,255,255,0.5)",
                          background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                          textDecoration: "none", fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          borderLeft: isActive ? "3px solid #2a8c7a" : "3px solid transparent",
                          transition: "all 0.15s"
                        })}>
                        <Icon size={14} />{label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} onClick={onClose}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                color: isActive ? "white" : "rgba(255,255,255,0.55)",
                background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                textDecoration: "none", fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? "3px solid #2a8c7a" : "3px solid transparent",
                transition: "all 0.15s"
              })}>
              <Icon size={16} />{item.label}
            </NavLink>
          );
        })}
      </nav>

      <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
        ZMI School Management © 2026
      </div>
    </aside>
  );
}