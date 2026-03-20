import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, serverTimestamp, setDoc
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useBranch } from "../context/BranchContext";
import { useUser } from "../context/UserContext";
import { PERMISSIONS } from "../context/UserContext";
import toast from "react-hot-toast";
import {
  Plus, Edit2, Trash2, X, Shield,
  Eye, EyeOff, Settings, ChevronDown, ChevronRight, Check
} from "lucide-react";

const DEFAULT_ROLE_LABELS = {
  admin: { label: "Admin", color: "#7a2535", bg: "#f5eaec" },
  branch_manager: { label: "Branch Manager", color: "#2a8c7a", bg: "#e6f4f1" },
  accountant: { label: "Accountant", color: "#4f46e5", bg: "#eef2ff" },
  fee_collector: { label: "Fee Collector", color: "#f59e0b", bg: "#fffbeb" },
};

const ALL_PERMISSIONS = [
  { key: "canViewDashboard", label: "View Dashboard", group: "Dashboard" },
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

const PERMISSION_GROUPS = [...new Set(ALL_PERMISSIONS.map(p => p.group))];

const ROLE_COLORS = [
  { color: "#7a2535", bg: "#f5eaec" },
  { color: "#2a8c7a", bg: "#e6f4f1" },
  { color: "#4f46e5", bg: "#eef2ff" },
  { color: "#f59e0b", bg: "#fffbeb" },
  { color: "#10b981", bg: "#ecfdf5" },
  { color: "#ef4444", bg: "#fef2f2" },
  { color: "#8b5cf6", bg: "#f5f3ff" },
  { color: "#0ea5e9", bg: "#f0f9ff" },
];

const emptyUser = { name: "", email: "", role: "fee_collector", branchId: "", pin: "" };
const emptyCustomRole = {
  label: "",
  color: "#4f46e5",
  bg: "#eef2ff",
  permissions: {}
};

export default function Users() {
  const { branches } = useBranch();
  const { userProfile } = useUser();
  const [users, setUsers] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [activeTab, setActiveTab] = useState("users");
  const [showModal, setShowModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [form, setForm] = useState(emptyUser);
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinUser, setPinUser] = useState(null);
  const [newPin, setNewPin] = useState("");
  const [customRole, setCustomRole] = useState(emptyCustomRole);
  const [editingRole, setEditingRole] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(PERMISSION_GROUPS.reduce((a, g) => ({ ...a, [g]: true }), {}));

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "users"), snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, "customRoles"), snap =>
      setCustomRoles(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); };
  }, []);

  // Merge default + custom roles
  const allRoleLabels = {
    ...DEFAULT_ROLE_LABELS,
    ...customRoles.reduce((acc, r) => ({ ...acc, [r.id]: { label: r.label, color: r.color, bg: r.bg } }), {})
  };

  const allRoleOptions = [
    ...Object.entries(DEFAULT_ROLE_LABELS).map(([id, r]) => ({ id, ...r, isDefault: true })),
    ...customRoles.map(r => ({ id: r.id, label: r.label, color: r.color, bg: r.bg, isDefault: false }))
  ];

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!editing && !password) return toast.error("Password is required");
    setLoading(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "users", editing), {
          name: form.name,
          role: form.role,
          branchId: form.branchId,
          updatedAt: serverTimestamp(),
        });
        toast.success("User updated");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          name: form.name,
          email: form.email,
          role: form.role,
          branchId: form.branchId,
          pin: form.pin || null,
          createdAt: serverTimestamp(),
        });
        toast.success("User created");
      }
      setShowModal(false);
      setForm(emptyUser);
      setPassword("");
      setEditing(null);
    } catch (err) {
      toast.error(err.message || "Error saving user");
    }
    setLoading(false);
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    if (newPin.length < 4) return toast.error("PIN must be at least 4 digits");
    await updateDoc(doc(db, "users", pinUser.id), { pin: newPin });
    toast.success("PIN updated");
    setShowPinModal(false);
    setPinUser(null);
    setNewPin("");
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm("Remove this user?")) return;
    await deleteDoc(doc(db, "users", id));
    toast.success("User removed");
  };

  const handleSaveCustomRole = async (e) => {
    e.preventDefault();
    if (!customRole.label.trim()) return toast.error("Role name is required");
    const roleId = customRole.label.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
    await addDoc(collection(db, "customRoles"), {
      ...customRole,
      createdAt: serverTimestamp(),
    });
    toast.success("Custom role created");
    setShowRoleModal(false);
    setCustomRole(emptyCustomRole);
  };

  const handleUpdateRole = async (e) => {
    e.preventDefault();
    await updateDoc(doc(db, "customRoles", editingRole.id), {
      label: editingRole.label,
      color: editingRole.color,
      bg: editingRole.bg,
      permissions: editingRole.permissions,
      updatedAt: serverTimestamp(),
    });
    toast.success("Role updated");
    setShowEditRoleModal(false);
    setEditingRole(null);
  };

  const handleDeleteRole = async (id) => {
    const usersWithRole = users.filter(u => u.role === id);
    if (usersWithRole.length > 0) return toast.error(`Cannot delete — ${usersWithRole.length} user(s) have this role`);
    if (!window.confirm("Delete this custom role?")) return;
    await deleteDoc(doc(db, "customRoles", id));
    toast.success("Role deleted");
  };

  const togglePermission = (key, target, setTarget) => {
    setTarget(prev => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] }
    }));
  };

  const toggleGroup = (group, target, setTarget) => {
    const groupPerms = ALL_PERMISSIONS.filter(p => p.group === group).map(p => p.key);
    const allOn = groupPerms.every(k => target.permissions[k]);
    const updated = { ...target.permissions };
    groupPerms.forEach(k => { updated[k] = !allOn; });
    setTarget(prev => ({ ...prev, permissions: updated }));
  };

  const PermissionsEditor = ({ value, onChange }) => (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      {PERMISSION_GROUPS.map(group => {
        const groupPerms = ALL_PERMISSIONS.filter(p => p.group === group);
        const allOn = groupPerms.every(p => value.permissions[p.key]);
        const someOn = groupPerms.some(p => value.permissions[p.key]);
        const isExpanded = expandedGroups[group];
        return (
          <div key={group} style={{ borderBottom: "1px solid var(--border)" }}>
            <div
              onClick={() => setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#f8fafc", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                  onChange={() => toggleGroup(group, value, onChange)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{group}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {groupPerms.filter(p => value.permissions[p.key]).length}/{groupPerms.length}
                </span>
              </div>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {isExpanded && (
              <div style={{ padding: "4px 0" }}>
                {groupPerms.map(perm => (
                  <label key={perm.key}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 38px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "white"}
                  >
                    <input
                      type="checkbox"
                      checked={!!value.permissions[perm.key]}
                      onChange={() => togglePermission(perm.key, value, onChange)}
                      style={{ width: 15, height: 15, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 13, color: "#374151" }}>{perm.label}</span>
                    {value.permissions[perm.key] && <Check size={12} color="#10b981" style={{ marginLeft: "auto" }} />}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Users & Permissions</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>Manage staff access and custom roles</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {activeTab === "roles" && (
            <button onClick={() => setShowRoleModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#4f46e5", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Plus size={15} /> New Role
            </button>
          )}
          {activeTab === "users" && (
            <button onClick={() => { setForm(emptyUser); setEditing(null); setPassword(""); setShowModal(true); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              <Plus size={15} /> Add User
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#f8fafc", padding: 4, borderRadius: 10, width: "fit-content" }}>
        {["users", "roles"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: activeTab === tab ? "white" : "transparent", color: activeTab === tab ? "var(--primary)" : "var(--text-muted)", textTransform: "capitalize" }}>
            {tab === "users" ? `Users (${users.length})` : `Roles (${allRoleOptions.length})`}
          </button>
        ))}
      </div>

      {/* USERS TAB */}
      {activeTab === "users" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Name", "Email", "Role", "Branch", "PIN", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const roleInfo = allRoleLabels[u.role] || { label: u.role, color: "#475569", bg: "#f1f5f9" };
                  return (
                    <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: "50%", background: roleInfo.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: roleInfo.color, fontSize: 14, flexShrink: 0 }}>
                            {u.name?.charAt(0)?.toUpperCase() || "?"}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>{u.name}</div>
                            {u.id === userProfile?.id && (
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>You</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{u.email}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: roleInfo.bg, color: roleInfo.color, whiteSpace: "nowrap" }}>
                          {roleInfo.label}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>
                        {branches.find(b => b.id === u.branchId)?.name || "All"}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {u.pin
                          ? <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Set</span>
                          : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not set</span>
                        }
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => { setPinUser(u); setShowPinModal(true); }}
                            style={{ border: "none", background: "#fffbeb", color: "#f59e0b", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                            PIN
                          </button>
                          <button onClick={() => { setForm({ name: u.name, email: u.email, role: u.role, branchId: u.branchId || "" }); setEditing(u.id); setShowModal(true); }}
                            style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}>
                            <Edit2 size={13} />
                          </button>
                          {u.id !== userProfile?.id && (
                            <button onClick={() => handleDeleteUser(u.id)}
                              style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {users.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No users yet</div>
          )}
        </div>
      )}

      {/* ROLES TAB */}
      {activeTab === "roles" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Default roles */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Built-in Roles</div>
          {Object.entries(DEFAULT_ROLE_LABELS).map(([id, role]) => {
            const perms = PERMISSIONS[id] || {};
            const enabledCount = Object.values(perms).filter(Boolean).length;
            return (
              <div key={id} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: role.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Shield size={18} color={role.color} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{role.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{enabledCount} permissions · {users.filter(u => u.role === id).length} users</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(perms).filter(([, v]) => v).slice(0, 4).map(([k]) => {
                    const perm = ALL_PERMISSIONS.find(p => p.key === k);
                    return perm ? (
                      <span key={k} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, background: role.bg, color: role.color, fontWeight: 500 }}>
                        {perm.label}
                      </span>
                    ) : null;
                  })}
                  {enabledCount > 4 && (
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, background: "#f1f5f9", color: "#475569" }}>
                      +{enabledCount - 4} more
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "#f1f5f9", color: "var(--text-muted)" }}>Built-in</span>
              </div>
            );
          })}

          {/* Custom roles */}
          {customRoles.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>Custom Roles</div>
              {customRoles.map(role => {
                const enabledCount = Object.values(role.permissions || {}).filter(Boolean).length;
                return (
                  <div key={role.id} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: role.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Settings size={18} color={role.color} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{role.label}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{enabledCount} permissions · {users.filter(u => u.role === role.id).length} users</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {Object.entries(role.permissions || {}).filter(([, v]) => v).slice(0, 4).map(([k]) => {
                        const perm = ALL_PERMISSIONS.find(p => p.key === k);
                        return perm ? (
                          <span key={k} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, background: role.bg, color: role.color, fontWeight: 500 }}>
                            {perm.label}
                          </span>
                        ) : null;
                      })}
                      {enabledCount > 4 && (
                        <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, background: "#f1f5f9", color: "#475569" }}>+{enabledCount - 4} more</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setEditingRole({ ...role }); setShowEditRoleModal(true); }}
                        style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <Edit2 size={13} /> Edit
                      </button>
                      <button onClick={() => handleDeleteRole(role.id)}
                        style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 10px", borderRadius: 6, cursor: "pointer" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {customRoles.length === 0 && (
            <div style={{ background: "white", borderRadius: 12, padding: 32, textAlign: "center", border: "1px dashed var(--border)" }}>
              <Settings size={32} color="var(--text-muted)" style={{ margin: "0 auto 12px", display: "block" }} />
              <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>No custom roles yet</p>
              <button onClick={() => setShowRoleModal(true)}
                style={{ padding: "9px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                Create your first custom role
              </button>
            </div>
          )}
        </div>
      )}

      {/* ADD/EDIT USER MODAL */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit User" : "Add User"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyUser); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Full Name</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                {!editing && (
                  <>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Email Address</label>
                      <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required
                        style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Password</label>
                      <div style={{ position: "relative" }}>
                        <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Minimum 6 characters"
                          style={{ width: "100%", padding: "9px 40px 9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                        <button type="button" onClick={() => setShowPass(p => !p)}
                          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                          {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Role</label>
                  <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <optgroup label="Built-in Roles">
                      {Object.entries(DEFAULT_ROLE_LABELS).map(([id, { label }]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </optgroup>
                    {customRoles.length > 0 && (
                      <optgroup label="Custom Roles">
                        {customRoles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch (for Branch Manager)</label>
                  <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">All Branches / Main</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Role summary */}
              {form.role && (
                <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>This role can access:</div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                    {(() => {
                      const perms = PERMISSIONS[form.role] || customRoles.find(r => r.id === form.role)?.permissions || {};
                      const enabled = ALL_PERMISSIONS.filter(p => perms[p.key]).map(p => p.label);
                      return enabled.length > 0 ? enabled.join(" · ") : "No permissions assigned";
                    })()}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(emptyUser); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={loading}
                  style={{ flex: 2, padding: "10px", background: loading ? "#c4a0a8" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  {loading ? "Saving..." : editing ? "Update User" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PIN MODAL */}
      {showPinModal && pinUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Set PIN — {pinUser.name}</h3>
              <button onClick={() => { setShowPinModal(false); setPinUser(null); setNewPin(""); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              Allows quick login without email and password. Minimum 4 digits.
            </p>
            <form onSubmit={handleSetPin}>
              <input
                type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8}
                value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                style={{ width: "100%", padding: "14px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 24, textAlign: "center", letterSpacing: 12, marginBottom: 20, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => { setShowPinModal(false); setPinUser(null); setNewPin(""); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 2, padding: "10px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Set PIN</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE CUSTOM ROLE MODAL */}
      {showRoleModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Create Custom Role</h3>
              <button onClick={() => { setShowRoleModal(false); setCustomRole(emptyCustomRole); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveCustomRole}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Role Name</label>
                <input value={customRole.label} onChange={e => setCustomRole(p => ({ ...p, label: e.target.value }))} required placeholder="e.g. Teacher, Receptionist"
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Role Color</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ROLE_COLORS.map(({ color, bg }) => (
                    <button key={color} type="button"
                      onClick={() => setCustomRole(p => ({ ...p, color, bg }))}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: color, border: customRole.color === color ? "3px solid #1e293b" : "3px solid transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {customRole.color === color && <Check size={14} color="white" />}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 20, background: customRole.bg }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: customRole.color }}>{customRole.label || "Preview"}</span>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Permissions</label>
                <PermissionsEditor value={customRole} onChange={setCustomRole} />
              </div>

              <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
                {Object.values(customRole.permissions).filter(Boolean).length} permissions enabled
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button type="button" onClick={() => { setShowRoleModal(false); setCustomRole(emptyCustomRole); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 2, padding: "10px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Create Role</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CUSTOM ROLE MODAL */}
      {showEditRoleModal && editingRole && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Edit Role — {editingRole.label}</h3>
              <button onClick={() => { setShowEditRoleModal(false); setEditingRole(null); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateRole}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Role Name</label>
                <input value={editingRole.label} onChange={e => setEditingRole(p => ({ ...p, label: e.target.value }))} required
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Role Color</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ROLE_COLORS.map(({ color, bg }) => (
                    <button key={color} type="button"
                      onClick={() => setEditingRole(p => ({ ...p, color, bg }))}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: color, border: editingRole.color === color ? "3px solid #1e293b" : "3px solid transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {editingRole.color === color && <Check size={14} color="white" />}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 20, background: editingRole.bg }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: editingRole.color }}>{editingRole.label}</span>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Permissions</label>
                <PermissionsEditor value={editingRole} onChange={setEditingRole} />
              </div>

              <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
                {Object.values(editingRole.permissions || {}).filter(Boolean).length} permissions enabled
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button type="button" onClick={() => { setShowEditRoleModal(false); setEditingRole(null); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 2, padding: "10px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}