import React from "react";
import { useNavigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";

export default function Unauthorized() {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, padding: 48, textAlign: "center", maxWidth: 400, width: "100%", border: "1px solid #e2e8f0" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <ShieldOff size={28} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Access Denied</h2>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>You don't have permission to view this page. Contact your administrator.</p>
        <button onClick={() => navigate("/")}
          style={{ width: "100%", padding: "12px", background: "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}