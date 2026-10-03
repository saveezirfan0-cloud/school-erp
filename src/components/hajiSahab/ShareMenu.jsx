import React, { useState } from "react";
import toast from "react-hot-toast";
import { Share2, MessageCircle, Mail, Copy } from "lucide-react";
import { sendWhatsAppMessage } from "../../utils/whatsapp";
import { summaryText } from "../../utils/reportViews";
import { monthName } from "../../utils/monthlyStatement";
import { iconBtn } from "./reportUi";

const item = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", border: "none", background: "white", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#334155" };

// Sends the month's summary as text. Recipients come from the report layout
// (Customize → Share). WhatsApp free-text only reaches people who messaged the
// number in the last 24 hours (Meta's rule), so failures are shown as they are.
export default function ShareMenu({ statement, outstanding, scopeLabel, share }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lang = statement.options?.language || "en";
  const text = () => summaryText(statement, { scopeLabel, outstanding, lang });
  const phones = share?.phones || [];
  const emails = share?.emails || [];

  const whatsapp = async () => {
    setOpen(false);
    let targets = phones;
    if (targets.length === 0) {
      const typed = window.prompt("WhatsApp number with country code (e.g. 923001234567).\nTip: save recipients under Customize → Share.");
      if (!typed) return;
      targets = [typed];
    }
    setBusy(true);
    const t = toast.loading(`Sending to ${targets.length} number${targets.length === 1 ? "" : "s"}…`);
    const body = text();
    let ok = 0;
    const errors = [];
    for (const phone of targets) {
      const res = await sendWhatsAppMessage(phone, body);
      if (res.ok) ok += 1; else errors.push(`${phone}: ${res.error || "failed"}`);
    }
    setBusy(false);
    if (errors.length === 0) toast.success(`Sent to ${ok} number${ok === 1 ? "" : "s"}`, { id: t });
    else toast.error(`${ok} sent, ${errors.length} failed — ${errors[0]}`, { id: t, duration: 7000 });
  };

  const email = () => {
    setOpen(false);
    const subject = `Monthly Statement — ${monthName(statement.month)} ${statement.year}`;
    window.location.href = `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text())}`;
  };

  const copy = async () => {
    setOpen(false);
    try { await navigator.clipboard.writeText(text()); toast.success("Summary copied"); }
    catch { toast.error("Couldn't copy — your browser blocked clipboard access"); }
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} disabled={busy} style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "#475569" }}>
        <Share2 size={14} /> Share
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, background: "white", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 250, overflow: "hidden" }}>
            <button style={item} onClick={whatsapp}><MessageCircle size={15} color="#25D366" /> WhatsApp {phones.length ? `(${phones.length} saved)` : "(enter a number)"}</button>
            <button style={item} onClick={email}><Mail size={15} color="#4f46e5" /> Email {emails.length ? `(${emails.length} saved)` : "(opens your mail app)"}</button>
            <button style={item} onClick={copy}><Copy size={15} color="#64748b" /> Copy summary text</button>
            <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-muted)", background: "#f8fafc", borderTop: "1px solid var(--border)" }}>
              Sends a text summary. For the full statement use Export PDF and attach it.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
