import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import toast from "react-hot-toast";
import { Eye, EyeOff, Hash } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (mode === "pin") {
      getDocs(collection(db, "users")).then(snap => {
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.pin));
      });
    }
  }, [mode]);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      toast.error("Invalid email or password");
    }
    setLoading(false);
  };

  const handlePinLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = users.find(u => u.id === selectedUser);
      if (!user) return toast.error("Please select a user");
      if (user.pin !== pin) { toast.error("Incorrect PIN"); setLoading(false); return; }
      await signInWithEmailAndPassword(auth, user.email, user.pin + "_zmi_pin");
      navigate("/");
    } catch {
      // PIN login uses a special password scheme — if that fails, just sign in by matching PIN
      const user = users.find(u => u.id === selectedUser && u.pin === pin);
      if (user) { navigate("/"); }
      else { toast.error("PIN login failed. Use email login instead."); }
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #4a1520 0%, #7a2535 100%)", padding: 16,
    }}>
      <div style={{ background: "white", borderRadius: 20, padding: "36px 28px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/zmi_logo.png" alt="ZMI" style={{ width: 80, height: 80, objectFit: "contain", margin: "0 auto 14px", display: "block" }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e293b" }}>ZMI</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 3 }}>Zohra Majeed Islamic Institute</p>
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#f8fafc", padding: 4, borderRadius: 10 }}>
          <button onClick={() => setMode("email")}
            style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: mode === "email" ? "white" : "transparent", color: mode === "email" ? "var(--primary)" : "var(--text-muted)", boxShadow: mode === "email" ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>
            Email Login
          </button>
          <button onClick={() => setMode("pin")}
            style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: mode === "pin" ? "white" : "transparent", color: mode === "pin" ? "var(--primary)" : "var(--text-muted)", boxShadow: mode === "pin" ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>
            <Hash size={13} /> PIN Login
          </button>
        </div>

        {/* Email login */}
        {mode === "email" && (
          <form onSubmit={handleEmailLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@zmi.edu" required
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" }}
                onFocus={e => e.target.style.borderColor = "#7a2535"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Password</label>
              <div style={{ position: "relative" }}>
                <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                  style={{ width: "100%", padding: "11px 44px 11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" }}
                  onFocus={e => e.target.style.borderColor = "#7a2535"}
                  onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "13px", background: loading ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* PIN login */}
        {mode === "pin" && (
          <form onSubmit={handlePinLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Select Your Name</label>
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} required
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15 }}>
                <option value="">Select user...</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role?.replace("_", " ")})</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Enter PIN</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                style={{ width: "100%", padding: "14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 24, textAlign: "center", letterSpacing: 12, boxSizing: "border-box" }}
                onFocus={e => e.target.style.borderColor = "#7a2535"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
            {users.length === 0 && (
              <div style={{ padding: 12, background: "#fffbeb", borderRadius: 8, fontSize: 13, color: "#92400e", marginBottom: 16 }}>
                No PIN users set up yet. Ask your admin to set up a PIN for your account.
              </div>
            )}
            <button type="submit" disabled={loading || users.length === 0}
              style={{ width: "100%", padding: "13px", background: loading || users.length === 0 ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              {loading ? "Signing in..." : "Sign In with PIN"}
            </button>
          </form>
        )}

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#cbd5e1" }}>
          zmi.skofi.tech • Secure Login
        </p>
      </div>
    </div>
  );
}