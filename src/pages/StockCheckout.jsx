import React, { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addDocs } from "../firebase";
import { useUser } from "../context/UserContext";
import { useAuth } from "../context/AuthContext";
import { useBranch } from "../context/BranchContext";
import { useInventory } from "../hooks/useInventory";
import SearchableSelect from "../components/UI/SearchableSelect";
import { friendlyError } from "../components/Inventory/ui";
import { destinationOptions, parseQuantity, MOVEMENT_STATUS } from "../utils/inventory";
import { todayLocal, isIsoDate } from "../utils/money";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";
import toast from "react-hot-toast";
import { CheckCircle, Clock, ChevronLeft, Plus, X } from "lucide-react";

const OTHER = "__other__";

const label = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" };
const field = { width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box", background: "white" };

const STATUS_STYLE = {
  pending: { bg: "#fffbeb", color: "#b45309", text: "Waiting for approval" },
  approved: { bg: "#ecfdf5", color: "#047857", text: "Approved" },
  rejected: { bg: "#fef2f2", color: "#b91c1c", text: "Rejected" },
};

// Full-screen form (like Quick Fee Payment) for whoever takes items out of
// the storage unit. Several items can be taken in one go: each line is one
// item and quantity; destination, reason, who and when are shared. It only
// files REQUESTS: stock is deducted when an approver ticks them on Storage.
export default function StockCheckout() {
  const { userProfile, can } = useUser();
  const { user } = useAuth();
  const { branches } = useBranch();
  const { items, movements, summary, itemById, loading, error } = useInventory({ sales: false });
  const approver = can("canApproveInventory");

  const nextKey = useRef(1);
  const newLine = () => ({ key: nextKey.current++, itemId: "", quantity: "" });
  const [lines, setLines] = useState(() => [newLine()]);
  const [otherDestination, setOtherDestination] = useState("");
  const [reason, setReason] = useState("");
  const [takenBy, setTakenBy] = useState(userProfile?.name || "");
  const [date, setDate] = useState(todayLocal());
  const [approveNow, setApproveNow] = useState(true);
  const [done, setDone] = useState(null); // { lines: [{ name, quantity }], destination, approved }
  const { busy, run } = useSubmitLock();

  const destinations = useMemo(() => destinationOptions(branches), [branches]);
  // ?to=Reception (from Reception Inventory) preselects the destination.
  const [params] = useSearchParams();
  const presetTo = params.get("to") || "";
  const [destination, setDestination] = useState(presetTo);

  const uid = user?.uid;
  const myRecent = useMemo(() => movements
    .filter((m) => m.requestedBy === uid && m.direction === "out")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 5), [movements, uid]);

  const updateLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const addLine = () => setLines((ls) => [...ls, newLine()]);

  // Dropdown options for one line: every item, minus those already picked on
  // another line (one line per item keeps the stock check simple).
  const optionsFor = (line) => {
    const taken = new Set(lines.filter((l) => l.key !== line.key && l.itemId).map((l) => l.itemId));
    return items.filter((i) => !taken.has(i.id)).map((i) => {
      const s = summary.get(i.id);
      const free = Math.max(0, s?.available ?? 0);
      return { value: i.id, label: i.code ? `${i.name} (${i.code})` : i.name, sublabel: free > 0 ? `${free} free to take` : "None free to take" };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    return run(async () => {
      const filled = lines.filter((l) => l.itemId || String(l.quantity).trim());
      if (!filled.length) return toast.error("Choose at least one item");
      const rows = [];
      for (const [i, l] of filled.entries()) {
        const item = itemById.get(l.itemId);
        const n = filled.length > 1 ? `Line ${i + 1}: ` : "";
        if (!item) return toast.error(`${n}choose the item`);
        const qty = parseQuantity(l.quantity);
        if (!qty.ok) return toast.error(`${n}${qty.error} for ${item.name}`);
        const free = summary.get(item.id)?.available ?? 0;
        if (qty.value > free) {
          return toast.error(`Only ${Math.max(0, free)} ${item.name} can be taken (storage stock minus requests still waiting)`, { duration: 7000 });
        }
        rows.push({ item, quantity: qty.value });
      }
      const dest = destination === OTHER ? otherDestination.trim() : destination;
      if (!dest) return toast.error("Choose where the items are going");
      if (!reason.trim()) return toast.error("Enter the reason");
      if (!takenBy.trim()) return toast.error("Enter who took the items");
      if (!isIsoDate(date)) return toast.error("Enter a valid date");
      const approved = approver && approveNow;
      try {
        // One request: either every line is saved or none is.
        await addDocs("inventoryMovements", rows.map(({ item, quantity }) => ({
          itemId: item.id,
          itemName: item.name,
          itemCode: item.code || "",
          direction: "out",
          quantity,
          date,
          destination: dest,
          person: takenBy.trim(),
          reason: reason.trim(),
          status: approved ? MOVEMENT_STATUS.APPROVED : MOVEMENT_STATUS.PENDING,
          requestedByName: userProfile?.name || userProfile?.email || "",
          ...(approved ? { reviewedByName: userProfile?.name || "" } : {}),
        })));
        logActivity(approved ? "stock out" : "requested", "Inventory",
          `${rows.map((r) => `${r.quantity} × ${r.item.name}`).join(", ")} to ${dest} (${reason.trim()}) by ${takenBy.trim()}${approved ? "" : " · pending approval"}`);
        setDone({ lines: rows.map((r) => ({ name: r.item.name, quantity: r.quantity })), destination: dest, approved });
      } catch (err) {
        toast.error(`${friendlyError(err, "Could not send the request")}. Nothing was saved.`, { duration: 8000 });
      }
    });
  };

  const reset = () => {
    setDone(null); setLines([newLine()]);
    setReason(""); setDestination(presetTo); setOtherDestination(""); setDate(todayLocal());
  };

  const page = (children) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #4a1520 0%, #7a2535 100%)", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, padding: "32px 28px", width: "100%", maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        {children}
      </div>
    </div>
  );

  if (done) return page(
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: done.approved ? "#ecfdf5" : "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        {done.approved ? <CheckCircle size={32} color="#10b981" /> : <Clock size={32} color="#d97706" />}
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{done.approved ? "Stock taken out" : done.lines.length > 1 ? `${done.lines.length} requests sent` : "Request sent"}</h2>
      <div style={{ color: "#334155", fontSize: 14, marginBottom: 6, lineHeight: 1.7 }}>
        {done.lines.map((l) => <div key={l.name}><strong>{l.quantity} × {l.name}</strong></div>)}
        <div style={{ color: "#64748b" }}>to {done.destination}</div>
      </div>
      <p style={{ color: done.approved ? "#64748b" : "#b45309", fontSize: 13, margin: "10px 0 28px" }}>
        {done.approved
          ? "Approved and deducted from storage."
          : "Pending approval. Stock will be deducted from storage once it is approved."}
      </p>
      <button onClick={reset}
        style={{ width: "100%", padding: 13, background: "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
        Take Out More Items
      </button>
    </div>
  );

  const pickedCount = lines.filter((l) => l.itemId).length;

  return page(
    <>
      <div style={{ textAlign: "center", marginBottom: 24, position: "relative" }}>
        {can("canViewInventory") && (
          <Link to="/storage" title="Back to Storage" style={{ position: "absolute", left: 0, top: 0, color: "#64748b", display: "flex", alignItems: "center", fontSize: 13, textDecoration: "none" }}>
            <ChevronLeft size={16} /> Storage
          </Link>
        )}
        <img src="/zmi_logo.png" alt="ZMI" style={{ width: 60, height: 60, objectFit: "contain", marginBottom: 12 }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>Take Out Stock</h1>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Record items taken from the storage unit</p>
      </div>

      {error ? (
        <p style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          Could not load the item list. Check your connection, or ask an admin whether the inventory database update has been applied.
        </p>
      ) : (
      <form onSubmit={handleSubmit}>
        {/* Item lines */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 84px 30px", gap: 8, marginBottom: 6 }}>
            <span style={{ ...label, marginBottom: 0 }}>Item *</span>
            <span style={{ ...label, marginBottom: 0 }}>Qty *</span>
            <span />
          </div>
          {lines.map((l, idx) => {
            const s = l.itemId ? summary.get(l.itemId) : null;
            return (
              <div key={l.key} data-testid="checkout-line" style={{ marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 84px 30px", gap: 8, alignItems: "center" }}>
                  <SearchableSelect
                    value={l.itemId}
                    onChange={(v) => updateLine(l.key, { itemId: v })}
                    options={optionsFor(l)}
                    placeholder={loading ? "Loading items…" : "Choose or search item…"}
                    emptyText="No item matches. Ask an admin to add it on the Storage page."
                    disabled={loading}
                  />
                  <input type="number" min="1" step="1" inputMode="numeric" value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                    placeholder="0" aria-label={`Quantity for line ${idx + 1}`}
                    style={{ ...field, padding: "10px 8px" }} />
                  <button type="button" onClick={() => removeLine(l.key)} disabled={lines.length === 1}
                    aria-label={`Remove line ${idx + 1}`} title="Remove this item"
                    style={{ border: "none", background: "none", cursor: lines.length === 1 ? "default" : "pointer", color: lines.length === 1 ? "#e2e8f0" : "#94a3b8", padding: 4, display: "flex" }}>
                    <X size={18} />
                  </button>
                </div>
                {s && (
                  <div style={{ fontSize: 12, color: s.available > 0 ? "#047857" : "#b91c1c", marginTop: 4, paddingLeft: 2 }}>
                    In storage: {s.current}
                    {s.pendingOut > 0 && <> · waiting for approval: {s.pendingOut}</>}
                    {" "}· free to take: {Math.max(0, s.available)}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" onClick={addLine} disabled={loading || lines.length >= items.length}
            style={{ display: "flex", alignItems: "center", gap: 5, border: "1.5px dashed #cbd5e1", background: "white", color: "#7a2535", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 600, fontSize: 13, width: "100%", justifyContent: "center" }}>
            <Plus size={14} /> Add another item
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Destination / Department *</label>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} required style={field}>
            <option value="">Where are the items going?</option>
            {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
            <option value={OTHER}>Other…</option>
          </select>
          {destination === OTHER && (
            <input value={otherDestination} onChange={(e) => setOtherDestination(e.target.value)} required
              placeholder="Type the destination" style={{ ...field, marginTop: 8 }} />
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Reason *</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} required
            placeholder="e.g. For sale at reception, office use" style={field} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <div>
            <label style={label}>Taken by *</label>
            <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} required placeholder="Name" style={field} />
          </div>
          <div>
            <label style={label}>Date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={field} />
          </div>
        </div>

        {approver && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#374151", marginBottom: 18, cursor: "pointer" }}>
            <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} style={{ width: 17, height: 17, accentColor: "#7a2535" }} />
            Approve now (deduct from storage straight away)
          </label>
        )}

        <button type="submit" disabled={busy || pickedCount === 0}
          style={{ width: "100%", padding: 13, background: busy || pickedCount === 0 ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: busy || pickedCount === 0 ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15 }}>
          {busy ? "Sending…" : `${approver && approveNow ? "Take Out" : "Send for Approval"}${pickedCount > 1 ? ` (${pickedCount} items)` : ""}`}
        </button>
        {!(approver && approveNow) && (
          <p style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: "#94a3b8" }}>
            Stock is deducted from storage only after an admin approves the request.
          </p>
        )}
      </form>
      )}

      {myRecent.length > 0 && (
        <div style={{ marginTop: 22, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase" }}>Your recent requests</div>
          {myRecent.map((m) => {
            const st = STATUS_STYLE[m.status] || STATUS_STYLE.pending;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0" }}>
                <span style={{ color: "#334155", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.quantity} × {itemById.get(m.itemId)?.name || m.itemName || "item"} → {m.destination} <span style={{ color: "#94a3b8" }}>· {m.date}</span>
                </span>
                <span style={{ background: st.bg, color: st.color, borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{st.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
