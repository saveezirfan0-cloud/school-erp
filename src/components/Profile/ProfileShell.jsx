import React from "react";
import { ArrowLeft } from "lucide-react";

// Page frame shared by the student and employee profiles: back link,
// header card (avatar, name, badges, key stats) and a tab bar.
export default function ProfileShell({ onBack, backLabel, title, subtitle, badges = [], stats = [], banner, tabs, activeTab, onTab, children }) {
  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, marginBottom: 12, padding: 0 }}>
        <ArrowLeft size={16} /> {backLabel}
      </button>

      {banner}

      <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary-light)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 24, flexShrink: 0 }}>
            {title?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h2>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>{subtitle}</div>
            {badges.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {badges.map((b) => (
                  <span key={b.label} style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: b.bg || "#f8fafc", color: b.color || "var(--text-muted)" }}>{b.label}</span>
                ))}
              </div>
            )}
          </div>
          {stats.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {stats.map((s) => (
                <div key={s.label} style={{ minWidth: 110, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#f8fafc" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, color: s.color || "inherit" }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(({ key, label, icon: Icon }) => {
          const on = key === activeTab;
          return (
            <button key={key} role="tab" aria-selected={on} onClick={() => onTab(key)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 16px", border: "none", background: "none", cursor: "pointer", whiteSpace: "nowrap", fontSize: 14, fontWeight: on ? 600 : 500,
                color: on ? "var(--primary)" : "var(--text-muted)", borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent", marginBottom: -1 }}>
              {Icon && <Icon size={15} />} {label}
            </button>
          );
        })}
      </div>

      {children}
    </div>
  );
}

export const cardStyle = { background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" };
export const cardHeadStyle = { padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
