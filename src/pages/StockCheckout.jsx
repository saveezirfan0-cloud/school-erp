import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { db, collection, addDoc } from "../firebase";
import { useUser } from "../context/UserContext";
import { useAuth } from "../context/AuthContext";
import { useBranch } from "../context/BranchContext";
import { useInventory } from "../hooks/useInventory";
import { destinationOptions, parseQuantity, MOVEMENT_STATUS } from "../utils/inventory";
import { todayLocal, isIsoDate } from "../utils/money";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";
import toast from "react-hot-toast";
import { Search, CheckCircle, Clock, ChevronLeft } from "lucide-react";

const OTHER = "__other__";

const label = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" };
const field = { width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box", background: "white" };

const STATUS_STYLE = {
  pending: { bg: "#fffbeb", color: "#b45309", text: "Waiting for approval" },
  approved: { bg: "#ecfdf5", color: "#047857", text: "Approved" },
  rejected: { bg: "#fef2f2", color: "#b91c1c", text: "Rejected" },
};

// Full-screen form (like Quick Fee Payment) for whoever takes items out of
// the storage unit. It only files a REQUEST: the stock is deducted when an
// approver ticks it on the Storage page.
export default function StockCheckout() {
  const { userProfile, can } = useUser();
  const { user } = useAuth();
  const { branches } = useBranch();
  const { items, movements, summary, itemById, loading, error } = useInventory({ sales: false });
  const approver = can("canApproveInventory");

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [otherDestination, setOtherDestination] = useState("");
  const [reason, setReason] = useState("");
  const [takenBy, setTakenBy] = useState(userProfile?.name || "");
  const [date, setDate] = useState(todayLocal());
  const [approveNow, setApproveNow] = useState(true);
  const [done, setDone] = useState(null); // { itemName, quantity, destination, approved }
  const { busy, run } = useSubmitLock();

  const destinations = useMemo(() => destinationOptions(branches), [branches]);
  // ?to=Reception (from Reception Inventory) preselects the destination.
  const [params] = useSearchParams();
  const presetTo = params.get("to") || "";
  const [destination, setDestination] = useState(presetTo);

  const matches = search.trim().length > 0 && !selected
    ? items.filter((i) => {
        const q = search.trim().toLowerCase();
        return i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const stock = selected ? summary.get(selected.id) : null;
  const uid = user?.uid;
  const myRecent = useMemo(() => movements
    .filter((m) => m.requestedBy === uid && m.direction === "out")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 5), [movements, uid]);

  const handleSubmit = (e) => {
    e.preventDefault();
    return run(async () => {
      if (!selected) return toast.error("Choose the item you took");
      const qty = parseQuantity(quantity);
      if (!qty.ok) return toast.error(qty.error);
      const dest = destination === OTHER ? otherDestination.trim() : destination;
      if (!dest) return toast.error("Choose where the item is going");
      if (!reason.trim()) return toast.error("Enter the reason");
      if (!takenBy.trim()) return toast.error("Enter who took the item");
      if (!isIsoDate(date)) return toast.error("Enter a valid date");
      const free = summary.get(selected.id)?.available ?? 0;
      if (qty.value > free) {
        return toast.error(`Only ${Math.max(0, free)} ${selected.name} can be requested (storage stock minus requests still waiting)`, { duration: 7000 });
      }
      const approved = approver && approveNow;
      try {
        await addDoc(collection(db, "inventoryMovements"), {
          itemId: selected.id,
          itemName: selected.name,
          itemCode: selected.code || "",
          direction: "out",
          quantity: qty.value,
          date,
          destination: dest,
          person: takenBy.trim(),
          reason: reason.trim(),
          status: approved ? MOVEMENT_STATUS.APPROVED : MOVEMENT_STATUS.PENDING,
          requestedByName: userProfile?.name || userProfile?.email || "",
        });
        logActivity(approved ? "stock out" : "requested", "Inventory",
          `${qty.value} × ${selected.name} to ${dest} (${reason.trim()}) by ${takenBy.trim()}${approved ? "" : " · pending approval"}`);
        setDone({ itemName: selected.name, quantity: qty.value, destination: dest, approved });
      } catch (err) {
        toast.error(err?.message || "Could not send the request", { duration: 7000 });
      }
    });
  };

  const reset = () => {
    setDone(null); setSelected(null); setSearch(""); setQuantity("");
    setReason(""); setDestination(presetTo); setOtherDestination(""); setDate(todayLocal());
  };

  const page = (children) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #4a1520 0%, #7a2535 100%)", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, padding: "32px 28px", width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        {children}
      </div>
    </div>
  );

  if (done) return page(
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: done.approved ? "#ecfdf5" : "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        {done.approved ? <CheckCircle size={32} color="#10b981" /> : <Clock size={32} color="#d97706" />}
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{done.approved ? "Stock taken out" : "Request sent"}</h2>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 6 }}>
        <strong>{done.quantity} × {done.itemName}</strong> to {done.destination}
      </p>
      <p style={{ color: done.approved ? "#64748b" : "#b45309", fontSize: 13, marginBottom: 28 }}>
        {done.approved
          ? "Approved and deducted from storage."
          : "Pending approval. It will be deducted from storage once it is approved."}
      </p>
      <button onClick={reset}
        style={{ width: "100%", padding: 13, background: "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
        Take Out Another Item
      </button>
    </div>
  );

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
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Record an item taken from the storage unit</p>
      </div>

      {error ? (
        <p style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          Could not load the item list. Check your connection, or ask an admin whether the inventory database update has been applied.
        </p>
      ) : (
      <form onSubmit={handleSubmit}>
        {/* Item search */}
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Item *</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              placeholder={loading ? "Loading items…" : "Type item name or code…"} disabled={loading}
              style={{ ...field, paddingLeft: 34 }} />
          </div>
          {matches.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 4, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
              {matches.map((i) => {
                const s = summary.get(i.id);
                return (
                  <button type="button" key={i.id} onClick={() => { setSelected(i); setSearch(i.name); }}
                    style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8, padding: "11px 14px", border: "none", borderBottom: "1px solid #f1f5f9", background: "white", cursor: "pointer", fontSize: 14, textAlign: "left" }}>
                    <span><strong>{i.name}</strong>{i.code && <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 6 }}>{i.code}</span>}</span>
                    <span style={{ fontSize: 12, color: s?.available > 0 ? "#64748b" : "#b91c1c", whiteSpace: "nowrap" }}>{s?.available ?? 0} free</span>
                  </button>
                );
              })}
            </div>
          )}
          {search.trim() && !selected && !loading && matches.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6 }}>No item matches. Ask an admin to add it on the Storage page.</div>
          )}
          {selected && stock && (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "#ecfdf5", borderRadius: 10, fontSize: 13, border: "1px solid #bbf7d0" }}>
              <div style={{ fontWeight: 600, color: "#065f46" }}>✓ {selected.name} {selected.code && <span style={{ fontWeight: 400 }}>({selected.code})</span>}</div>
              <div style={{ color: "#047857", marginTop: 2 }}>
                In storage: {stock.current}
                {stock.pendingOut > 0 && <> · waiting for approval: {stock.pendingOut} · free to take: {Math.max(0, stock.available)}</>}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label style={label}>Quantity *</label>
            <input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              required placeholder="0" style={field} />
          </div>
          <div>
            <label style={label}>Date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={field} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Destination / Department *</label>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} required style={field}>
            <option value="">Where is it going?</option>
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

        <div style={{ marginBottom: 20 }}>
          <label style={label}>Taken by *</label>
          <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} required placeholder="Name" style={field} />
        </div>

        {approver && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#374151", marginBottom: 18, cursor: "pointer" }}>
            <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} style={{ width: 17, height: 17, accentColor: "#7a2535" }} />
            Approve now (deduct from storage straight away)
          </label>
        )}

        <button type="submit" disabled={busy || !selected}
          style={{ width: "100%", padding: 13, background: busy || !selected ? "#c4a0a8" : "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: busy || !selected ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15 }}>
          {busy ? "Sending…" : approver && approveNow ? "Take Out Stock" : "Send for Approval"}
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
