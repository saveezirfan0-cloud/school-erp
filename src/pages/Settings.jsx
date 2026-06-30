import React, { useState } from "react";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import toast from "react-hot-toast";
import { MessageCircle, CheckCircle, AlertCircle, Link2, Send } from "lucide-react";

export default function Settings() {
  const quickPayLink = window.location.origin + "/quick-payment";

  // WhatsApp config is provided via build-time env vars (set in Vercel).
  // We can read whether they're present, but not edit them from here.
  const waConfigured = !!(
    process.env.REACT_APP_WHATSAPP_API_URL &&
    process.env.REACT_APP_WHATSAPP_PHONE_ID &&
    process.env.REACT_APP_WHATSAPP_TOKEN
  );

  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    if (!testPhone.trim()) return toast.error("Enter a phone number with country code");
    setSending(true);
    try {
      const res = await sendWhatsAppMessage(testPhone, "✅ Test message from ZMI School ERP. WhatsApp is working!");
      if (res?.skipped) toast.error("WhatsApp isn't configured yet");
      else if (res?.error || res?.error_data) toast.error("Send failed — check your token/number");
      else toast.success("Test message sent");
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  };

  const card = { background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)", maxWidth: 640, marginBottom: 20 };
  const input = { padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 };

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Settings</h2>

      {/* WhatsApp */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <MessageCircle size={18} style={{ color: "#25D366" }} />
          <h3 style={{ fontWeight: 600 }}>WhatsApp Notifications</h3>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 12,
          background: waConfigured ? "#ecfdf5" : "#fef2f2", color: waConfigured ? "#10b981" : "#ef4444" }}>
          {waConfigured ? <><CheckCircle size={14} /> Connected</> : <><AlertCircle size={14} /> Not configured</>}
        </div>
        {waConfigured ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 12 }}>Send a test message to confirm it's working. Use full international format, e.g. <strong>923001234567</strong>.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="923001234567" style={{ ...input, flex: 1, minWidth: 180 }} />
              <button onClick={sendTest} disabled={sending}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: sending ? "not-allowed" : "pointer", fontWeight: 600 }}>
                <Send size={15} /> {sending ? "Sending..." : "Send Test"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            WhatsApp keys are set as environment variables in Vercel (<code>REACT_APP_WHATSAPP_API_URL</code>, <code>REACT_APP_WHATSAPP_PHONE_ID</code>, <code>REACT_APP_WHATSAPP_TOKEN</code>). See the WhatsApp setup guide, then redeploy. Keys can't be edited here for security.
          </p>
        )}
      </div>

      {/* Quick pay link */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Link2 size={18} style={{ color: "var(--primary)" }} />
          <h3 style={{ fontWeight: 600 }}>Quick Payment Link</h3>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 12 }}>Share this link with staff to log fee payments without logging in.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={quickPayLink} style={{ ...input, flex: 1, background: "#f8fafc" }} />
          <button onClick={() => { navigator.clipboard.writeText(quickPayLink); toast.success("Copied"); }}
            style={{ padding: "9px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Copy</button>
        </div>
      </div>
    </div>
  );
}
