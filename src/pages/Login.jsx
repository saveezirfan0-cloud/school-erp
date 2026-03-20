import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      toast.error("Invalid email or password");
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #4a1520 0%, #7a2535 100%)",
      padding: 16,
    }}>
      <div style={{
        background: "white",
        borderRadius: 20,
        padding: "36px 28px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img
            src="/zmi_logo.png"
            alt="ZMI Logo"
            style={{ width: 80, height: 80, objectFit: "contain", margin: "0 auto 14px", display: "block" }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e293b" }}>ZMI</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 3 }}>Zohra Majeed Islamic Institute</p>
          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>School Management System</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@zmi.edu"
              required
              style={{
                width: "100%",
                padding: "11px 14px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 10,
                fontSize: 15,
                outline: "none",
                transition: "border 0.15s",
                boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#7a2535"}
              onBlur={e => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: "100%",
                  padding: "11px 44px 11px 14px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 10,
                  fontSize: 15,
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={e => e.target.style.borderColor = "#7a2535"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"}
              />
              <button
                type="button"
                onClick={() => setShowPass(p => !p)}
                style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13, padding: 4
                }}>
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "13px",
              background: loading ? "#c4a0a8" : "var(--primary)",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              letterSpacing: 0.3,
            }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#cbd5e1" }}>
          zmi.skofi.tech • Secure Login
        </p>
      </div>
    </div>
  );
}