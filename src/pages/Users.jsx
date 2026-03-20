import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useBranch } from "../context/BranchContext";
import { useUser, ROLES } from "../context/UserContext";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, X, Shield, Eye, EyeOff } from "lucide-react";

const ROLE_LABELS = {
  admin: { label: "Admin", color: "#7a2535", bg: "#f5eaec" },
  branch_manager: { label: "Branch Manager", color: "#2a8c7a", bg: "#e6f4f1" },
  accountant: { label: "Accountant", color: "#4f46e5", bg: "#eef2ff" },
  fee_collector: { label: "Fee Collector", color: "#f59e0b", bg: "#fffbeb" },
};

const ROLE_ACCESS = {
  admin: ["Everything — full access"],
  branch_manager: ["Dashboard", "Students (own branch)", "Fees", "Expenses", "Payments"],
  accountant: ["Dashboard", "Fees", "Expenses", "Payments", "Payslips", "Accounting", "Reports"],
  fee_collector: ["Students (view only)", "Fees & Invoices only"],
};

const empty = { name: "", email: "", role: "fee_collector", branchId: "", pin: "" };

export default function Users() {
  const { branches } = useBranch();
  const { userProfile, isAdmin } = useUser();
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinUser, setPinUser] = useState(null);
  const [newPin, setNewPin] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const handleCreate = async (e) => {
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
        await addDoc(collection(db, "users"), {
          uid: cred.user.uid,
          name: form.name,
          email: form.email,
          role: form.role,
          branchId: form.branchId,
          pin: form.pin || null,
          createdAt: serverTimestamp(),
        });
        // Also set by UID for fast lookup
        await updateDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          name: form.name,
          email: form.email,
          role: form.role,
          branchId: form.branchId,
        }).catch(() => {});
        toast.success("User created successfully");
      }
      setShowModal(false);
      setForm(empty);
      setPassword("");
      setEditing(null);
    } catch (err) {
      toast.error(err.message || "Error creating user");
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

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user? They will no longer be able to log in.")) return;
    await deleteDoc(doc(db, "users", id));
    toast.success("User removed");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Users & Permissions</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>Manage staff access levels</p>
        </div>
        <button onClick={() => { setForm(empty); setEditing(null); setPassword(""); setShowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add User
        </button>
      </div>

      {/* Role legend */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
        {Object.entries(ROLE_LABELS).map(([role, { label, color, bg }]) => (
          <div key={role} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Shield size={16} color={color} />
              <span style={{ fontWeight: 700, fontSize: 13, color }}>{label}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {ROLE_ACCESS[role].map(a => (
                <li key={a} style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 3, paddingLeft: 8, borderLeft: `2px solid ${bg === "#f5eaec" ? color : bg}` }}>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Name", "Email", "Role", "Branch", "PIN", "Actions"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const roleInfo = ROLE_LABELS[u.role] || ROLE_LABELS.fee_collector;
              return (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: roleInfo.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: roleInfo.color, fontSize: 14 }}>
                        {u.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{u.name}</span>
                      {u.id === userProfile?.id && (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>You</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{u.email}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: roleInfo.bg, color: roleInfo.color }}>
                      {roleInfo.label}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13 }}>
                    {u.role === "branch_manager"
                      ? branches.find(b => b.id === u.branchId)?.name || "—"
                      : "All"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {u.pin ? (
                      <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Set</span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not set</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setPinUser(u); setShowPinModal(true); }}
                        style={{ border: "none", background: "#fffbeb", color: "#f59e0b", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        PIN
                      </button>
                      <button onClick={() => { setForm({ name: u.name, email: u.email, role: u.role, branchId: u.branchId || "" }); setEditing(u.id); setShowModal(true); }}
                        style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}>
                        <Edit2 size={13} />
                      </button>
                      {u.id !== userProfile?.id && (
                        <button onClick={() => handleDelete(u.id)}
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
        {users.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            No users yet. Add your first user above.
          </div>
        )}
      </div>

      {/* Add/Edit User Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit User" : "Add User"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Full Name</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </div>
                {!editing && (
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Email Address</label>
                    <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                )}
                {!editing && (
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Password</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showPass ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        placeholder="Minimum 6 characters"
                        style={{ width: "100%", padding: "9px 40px 9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                      />
                      <button type="button" onClick={() => setShowPass(p => !p)}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Role</label>
                  <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    {Object.entries(ROLE_LABELS).map(([role, { label }]) => (
                      <option key={role} value={role}>{label}</option>
                    ))}
                  </select>
                </div>
                {form.role === "branch_manager" && (
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Assigned Branch</label>
                    <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Select branch</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Role access summary */}
              <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>This role can access:</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{ROLE_ACCESS[form.role]?.join(" · ")}</div>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={loading}
                  style={{ flex: 2, padding: "10px", background: loading ? "#c4a0a8" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  {loading ? "Creating..." : editing ? "Update User" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set PIN Modal */}
      {showPinModal && pinUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Set PIN for {pinUser.name}</h3>
              <button onClick={() => { setShowPinModal(false); setPinUser(null); setNewPin(""); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              The PIN allows this user to log in quickly without their email and password. Minimum 4 digits.
            </p>
            <form onSubmit={handleSetPin}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>New PIN (numbers only)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 1234"
                  style={{ width: "100%", padding: "12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 20, textAlign: "center", letterSpacing: 8, boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => { setShowPinModal(false); setPinUser(null); setNewPin(""); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit"
                  style={{ flex: 2, padding: "10px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Set PIN</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}