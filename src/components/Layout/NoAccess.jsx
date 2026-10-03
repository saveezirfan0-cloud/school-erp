import React from "react";
import { ShieldOff, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useUser } from "../../context/UserContext";

const MESSAGES = {
  "no-profile": "Your account is signed in, but it has no staff profile in this system. It may have been removed or not set up yet.",
  "error": "We could not load your account details, so access has been withheld for safety. Check your connection and try again.",
  "unknown-role": "Your account has a role that is not recognised (it may have been deleted or renamed).",
  "no-permissions": "Your account does not have access to any pages yet.",
};

// Shown instead of the app whenever a signed-in user ends up with no
// usable permissions. Never grants anything and never redirects, so it
// cannot loop. Always offers sign-out.
export default function NoAccess() {
  const { user, logout } = useAuth();
  const { accessProblem } = useUser();

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 16 }}>
      <div role="alert" style={{ background: "white", borderRadius: 20, padding: "40px 28px", textAlign: "center", maxWidth: 420, width: "100%", border: "1px solid #e2e8f0" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <ShieldOff size={28} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No access</h2>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>
          {MESSAGES[accessProblem] || MESSAGES["no-permissions"]}
        </p>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
          Please contact your administrator.
        </p>
        {user?.email && (
          <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 20 }}>Signed in as {user.email}</p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {accessProblem === "error" && (
            <button onClick={() => window.location.reload()}
              style={{ flex: 1, padding: "12px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <RefreshCw size={14} /> Retry
            </button>
          )}
          <button onClick={() => logout()}
            style={{ flex: 1, padding: "12px", background: "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
