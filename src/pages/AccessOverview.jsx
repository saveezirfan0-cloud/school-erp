import React, { useState, useEffect } from "react";
import { db, collection, onSnapshot, doc, updateDoc } from "../firebase";
import { useUser } from "../context/UserContext";
import { PERMISSIONS } from "../context/UserContext";
import toast from "react-hot-toast";
import { Search, Check, X, ShieldCheck } from "lucide-react";

// The same catalog the Users page uses, grouped for display.
const ALL_PERMISSIONS = [
  { key: "canViewDashboard", label: "Dashboard", group: "Dashboard" },
  { key: "canViewStudents", label: "View Students", group: "Students" },
  { key: "canEditStudents", label: "Add / Edit Students", group: "Students" },
  { key: "canDeleteStudents", label: "Delete Students", group: "Students" },
  { key: "canViewEmployees", label: "View Employees", group: "Employees" },
  { key: "canEditEmployees", label: "Add / Edit Employees", group: "Employees" },
  { key: "canDeleteEmployees", label: "Delete Employees", group: "Employees" },
  { key: "canViewFees", label: "View Fees & Invoices", group: "Fees" },
  { key: "canEditFees", label: "Create / Edit Fees", group: "Fees" },
  { key: "canViewExpenses", label: "View Expenses", group: "Expenses" },
  { key: "canEditExpenses", label: "Add / Edit Expenses", group: "Expenses" },
  { key: "canDeleteExpenses", label: "Delete Expenses", group: "Expenses" },
  { key: "canViewPayments", label: "View Payments", group: "Payments" },
  { key: "canEditPayments", label: "Add Payments", group: "Payments" },
  { key: "canViewPayslips", label: "View Payslips", group: "Payslips" },
  { key: "canEditPayslips", label: "Generate Payslips", group: "Payslips" },
  { key: "canViewAccounting", label: "View Accounting", group: "Accounting" },
  { key: "canEditAccounting", label: "Edit Accounting", group: "Accounting" },
  { key: "canViewReports", label: "View Reports", group: "Reports" },
  { key: "canExport", label: "Export CSV / PDF", group: "Reports" },
  { key: "canManageBranches", label: "Manage Branches", group: "Admin" },
  { key: "canManageUsers", label: "Manage Users", group: "Admin" },
  { key: "canViewAllBranches", label: "View All Branches", group: "Admin" },
];

// What a role grants by default (so we can show the effective value
// and only store the DIFFERENCE as a per-user override).
function rolePermission(role, key) {
  if (role === "admin") return true;
  const base = PERMISSIONS?.[role] || {};
  return base[key] === true;
}

export default function AccessOverview() {
  const { isAdmin } = useUser();
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(list);
      setSelected((prev) => prev ? list.find((u) => u.id === prev.id) || prev : list[0]);
    });
    return unsub;
  }, []);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Admin only.</div>;
  }

  const filtered = users.filter((u) =>
    !search || (u.name || "").toLowerCase().includes(search.toLowerCase()) || (u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  // Effective permission = per-user override if set, else the role default.
  const effective = (user, key) => {
    const overrides = user?.pagePermissions || {};
    if (key in overrides) return overrides[key] === true;
    return rolePermission(user?.role, key);
  };

  const toggle = async (key) => {
    if (!selected) return;
    if (selected.role === "admin") { toast.error("Admins always have full access"); return; }
    const current = effective(selected, key);
    const overrides = { ...(selected.pagePermissions || {}), [key]: !current };
    // optimistic
    setSelected({ ...selected, pagePermissions: overrides });
    try {
      await updateDoc(doc(db, "users", selected.id), { pagePermissions: overrides });
    } catch (e) {
      toast.error(e?.message || "Couldn't save");
    }
  };

  const visibleCount = selected ? ALL_PERMISSIONS.filter((p) => effective(selected, p.key)).length : 0;
  const groups = [...new Set(ALL_PERMISSIONS.map((p) => p.group))];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={20} /> Access Overview
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Pick a user, then toggle exactly which permissions they have. Overrides apply on top of their role. Changes save instantly.</p>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* user list */}
        <div style={{ width: 280, background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 12, flexShrink: 0 }}>
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..."
              style={{ width: "100%", padding: "8px 8px 8px 30px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 480, overflow: "auto" }}>
            {filtered.map((u) => (
              <button key={u.id} onClick={() => setSelected(u)}
                style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "10px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
                  background: selected?.id === u.id ? "var(--primary-light)" : "transparent" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "var(--primary)" }}>
                  {(u.name || u.email || "?").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>{(u.role || "").replace(/_/g, " ")}</div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No users</div>}
          </div>
        </div>

        {/* permission toggles */}
        <div style={{ flex: 1, minWidth: 320, background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {!selected ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Select a user</div>
          ) : (
            <>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{selected.email}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, textTransform: "capitalize", fontWeight: 600, color: "var(--primary)" }}>{(selected.role || "").replace(/_/g, " ")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{visibleCount} of {ALL_PERMISSIONS.length} allowed</div>
                </div>
              </div>

              {selected.role === "admin" && (
                <div style={{ padding: "10px 20px", background: "#fffbeb", fontSize: 13, color: "#92400e", borderBottom: "1px solid var(--border)" }}>
                  Admins always have full access; toggles are disabled.
                </div>
              )}

              <div style={{ maxHeight: 540, overflow: "auto" }}>
                {groups.map((group) => (
                  <div key={group}>
                    <div style={{ padding: "8px 20px", background: "#f8fafc", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>{group}</div>
                    {ALL_PERMISSIONS.filter((p) => p.group === group).map((p) => {
                      const on = effective(selected, p.key);
                      const overridden = selected.pagePermissions && (p.key in selected.pagePermissions);
                      return (
                        <div key={p.key} onClick={() => toggle(p.key)}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--border)", cursor: selected.role === "admin" ? "default" : "pointer" }}>
                          <span style={{ fontSize: 14 }}>
                            {p.label}
                            {overridden && <span style={{ marginLeft: 8, fontSize: 10, color: "#2563eb", fontWeight: 600 }}>OVERRIDE</span>}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                            background: on ? "#ecfdf5" : "#fef2f2", color: on ? "#10b981" : "#ef4444" }}>
                            {on ? <><Check size={13} /> Can see</> : <><X size={13} /> Hidden</>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
