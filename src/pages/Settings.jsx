import React from "react";

export default function Settings() {
  const quickPayLink = window.location.origin + "/quick-payment";
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Settings</h2>
      <div style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)", maxWidth: 600 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Quick Payment Link</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 12 }}>Share this link with staff to log fee payments without logging in.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={quickPayLink} style={{ flex: 1, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "#f8fafc" }} />
          <button onClick={() => { navigator.clipboard.writeText(quickPayLink); }}
            style={{ padding: "9px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Copy</button>
        </div>
      </div>
    </div>
  );
}