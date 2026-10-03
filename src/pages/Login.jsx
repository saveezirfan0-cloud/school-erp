import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import toast from "react-hot-toast";
import { Eye, EyeOff } from "lucide-react";

const inputStyle = { width: "100%", padding: "11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" };
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // "login" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      // "/" sends each role to its first permitted page.
      navigate("/");
    } catch {
      toast.error("Invalid email or password");
    }
    setLoading(false);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // After the emailed link is opened the user is signed in and can
      // set a new password under Settings. (The /settings URL must be in
      // Supabase Auth > URL Configuration > Redirect URLs.)
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/settings`,
      });
    } catch {
      // Deliberately ignored: the reply must not reveal whether an
      // account exists for this address.
    }
    setResetSent(true);
    setLoading(false);
  };

  const backToLogin = () => { setMode("login"); setResetSent(false); };

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

        {mode === "login" && (
          <form onSubmit={handleEmailLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@zmi.edu" required autoComplete="username"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#7a2535"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: "relative" }}>
                <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password"
                  style={{ ...inputStyle, padding: "11px 44px 11px 14px" }}
                  onFocus={e => e.target.style.borderColor = "#7a2535"}
                  onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
                <button type="button" onClick={() => setShowPass(p => !p)} aria-label={showPass ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div style={{ textAlign: "right", marginBottom: 20 }}>
              <button type="button" onClick={() => setMode("reset")}
                style={{ border: "none", background: "none", cursor: "pointer", color: "#7a2535", fontSize: 13, fontWeight: 600, padding: 0 }}>
                Forgot password?
              </button>
            </div>
            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "13px", background: loading ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {mode === "reset" && (
          resetSent ? (
            <div>
              <p style={{ fontSize: 14, color: "#374151", marginBottom: 20, lineHeight: 1.5 }}>
                If an account exists for that email address, a password reset link is on its way. Check your inbox (and spam folder).
              </p>
              <button type="button" onClick={backToLogin}
                style={{ width: "100%", padding: "13px", background: "#7a2535", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset}>
              <p style={{ fontSize: 14, color: "#64748b", marginBottom: 16 }}>
                Enter your email address and we will send you a link to reset your password.
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "#7a2535"}
                  onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
              </div>
              <button type="submit" disabled={loading}
                style={{ width: "100%", padding: "13px", background: loading ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? "Sending..." : "Send reset link"}
              </button>
              <button type="button" onClick={backToLogin}
                style={{ width: "100%", marginTop: 10, padding: "10px", background: "none", color: "#64748b", border: "none", fontSize: 14, cursor: "pointer" }}>
                Back to sign in
              </button>
            </form>
          )
        )}

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#cbd5e1" }}>
          zmi.skofi.tech • Secure Login
        </p>
      </div>
    </div>
  );
}
