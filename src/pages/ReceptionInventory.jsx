import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, collection, doc, addDoc, updateDoc, deleteDoc } from "../firebase";
import { useUser } from "../context/UserContext";
import { useInventory } from "../hooks/useInventory";
import { RECEPTION, MOVEMENT_STATUS, isReception, parseQuantity } from "../utils/inventory";
import { todayLocal, isIsoDate, formatMoney, round2, sumMoney } from "../utils/money";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";
import ExportMenu from "../components/UI/ExportMenu";
import SearchableSelect from "../components/UI/SearchableSelect";
import { Modal, Field, StatCard, Pill, inputStyle, btn, th, td, friendlyError } from "../components/Inventory/ui";
import toast from "react-hot-toast";
import { Plus, PackageMinus, Pencil, Trash2, Search } from "lucide-react";

const editBtn = { display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "#f1f5f9", color: "#334155", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 };

const emptySale = () => ({ itemId: "", buyerName: "", quantity: "1", unitPrice: "", date: todayLocal(), paid: false });

export default function ReceptionInventory() {
  const { can } = useUser();
  const canEdit = can("canEditInventory") || can("canApproveInventory");
  // Correcting the count at reception changes stock directly, so it is the approver's.
  const canAdjust = can("canApproveInventory");
  const { items, movements, sales, summary, itemById, loading, error } = useInventory();

  const [search, setSearch] = useState("");
  const [paidFilter, setPaidFilter] = useState("");
  const [showAllItems, setShowAllItems] = useState(false);
  const [saleModal, setSaleModal] = useState(null);
  const [stockModal, setStockModal] = useState(null); // { itemId, left }
  const { busy, run } = useSubmitLock();

  const itemName = useCallback((row) => itemById.get(row.itemId)?.name || row.itemName || "(deleted item)", [itemById]);

  // Transfers to reception still waiting for approval, per item.
  const incoming = useMemo(() => {
    const map = new Map();
    for (const m of movements) {
      if (m.status === MOVEMENT_STATUS.PENDING && m.direction === "out" && isReception(m.destination)) {
        map.set(m.itemId, (map.get(m.itemId) || 0) + (Number(m.quantity) || 0));
      }
    }
    return map;
  }, [movements]);

  const stockRows = items.filter((it) => {
    const s = summary.get(it.id);
    if (search.trim() && !it.name?.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return showAllItems || s.receptionOpening || s.receptionIn || s.sold || incoming.get(it.id);
  });

  const q = search.trim().toLowerCase();
  const shownSales = useMemo(() => sales
    .filter((s) => !paidFilter || (paidFilter === "paid" ? s.paid : !s.paid))
    .filter((s) => !q || String(s.buyerName || "").toLowerCase().includes(q) || itemName(s).toLowerCase().includes(q))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
  [sales, paidFilter, q, itemName]);

  const totals = useMemo(() => ({
    paid: sumMoney(sales.filter((s) => s.paid).map((s) => Number(s.amount) || 0)),
    unpaid: sumMoney(sales.filter((s) => !s.paid).map((s) => Number(s.amount) || 0)),
    unpaidCount: sales.filter((s) => !s.paid).length,
    left: items.reduce((n, it) => n + Math.max(0, summary.get(it.id)?.receptionLeft || 0), 0),
  }), [sales, items, summary]);

  // ---- paid / unpaid tick (same idea as the Fees "Paid" button) ----
  const togglePaid = (sale) => {
    if (sale.paid && !window.confirm(`Mark ${sale.buyerName}'s ${itemName(sale)} as UNPAID again?`)) return;
    run(async () => {
      try {
        await updateDoc(doc(db, "receptionSales", sale.id), sale.paid ? { paid: false, paidDate: null } : { paid: true, paidDate: todayLocal() });
        toast.success(sale.paid ? "Marked unpaid" : `Paid: Rs. ${formatMoney(sale.amount)} from ${sale.buyerName}`);
        logActivity(sale.paid ? "unpaid" : "paid", "Reception Inventory", `${sale.buyerName}: ${sale.quantity} × ${itemName(sale)} · Rs. ${formatMoney(sale.amount)}`);
      } catch (e) {
        toast.error(friendlyError(e, "Could not update"));
      }
    });
  };

  const saveSale = (e) => {
    e.preventDefault();
    run(async () => {
      const f = saleModal;
      const item = itemById.get(f.itemId);
      if (!item) return toast.error("Choose the item");
      if (!f.buyerName.trim()) return toast.error("Enter the buyer's name");
      const qty = parseQuantity(f.quantity);
      if (!qty.ok) return toast.error(qty.error);
      const price = f.unitPrice === "" ? 0 : Number(f.unitPrice);
      if (!Number.isFinite(price) || price < 0) return toast.error("Price cannot be negative");
      if (!isIsoDate(f.date)) return toast.error("Enter a valid date");
      // Stock left at reception, not counting this sale itself when editing.
      const before = sales.find((s) => s.id === f.id);
      const left = (summary.get(item.id)?.receptionLeft || 0) + (before && before.itemId === item.id ? Number(before.quantity) || 0 : 0);
      if (qty.value > left) {
        return toast.error(`Reception has only ${Math.max(0, left)} ${item.name} left. Take more out of storage first (it must be approved), or ask an admin to set the stock already at reception.`, { duration: 9000 });
      }
      const data = {
        itemId: item.id, itemName: item.name, buyerName: f.buyerName.trim(), quantity: qty.value,
        unitPrice: price, amount: round2(price * qty.value), date: f.date,
        paid: !!f.paid, paidDate: f.paid ? (before?.paid ? before.paidDate : todayLocal()) : null,
      };
      try {
        if (f.id) await updateDoc(doc(db, "receptionSales", f.id), data);
        else await addDoc(collection(db, "receptionSales"), data);
        toast.success(f.id ? "Sale updated" : "Sale recorded");
        logActivity(f.id ? "updated" : "sold", "Reception Inventory", `${data.buyerName}: ${data.quantity} × ${item.name} · Rs. ${formatMoney(data.amount)} · ${data.paid ? "paid" : "unpaid"}`);
        setSaleModal(null);
      } catch (err) {
        toast.error(friendlyError(err, "Could not save the sale"));
      }
    });
  };

  // The count at reception is opening + approved transfers - sold, so a
  // corrected count is stored as the item's reception opening stock.
  const saveStock = (e) => {
    e.preventDefault();
    run(async () => {
      const item = itemById.get(stockModal.itemId);
      const s = summary.get(stockModal.itemId);
      if (!item || !s) return toast.error("Item not found");
      const target = String(stockModal.left).trim() === "0" ? { ok: true, value: 0 } : parseQuantity(stockModal.left);
      if (!target.ok) return toast.error(target.error === "Quantity must be more than 0" ? "Enter 0 or more" : target.error);
      const opening = target.value - s.receptionIn + s.sold;
      if (opening < 0) {
        return toast.error(`Can't go below ${s.receptionIn - s.sold}: ${s.receptionIn} came from storage and ${s.sold} were sold. Record the missing ones as a sale (or fix a sale) instead.`, { duration: 10000 });
      }
      try {
        await updateDoc(doc(db, "inventoryItems", item.id), { receptionOpening: opening });
        toast.success(`${item.name}: stock left at reception is now ${target.value}`);
        logActivity("adjusted", "Reception Inventory", `${item.name}: stock left at reception ${s.receptionLeft} → ${target.value}`);
        setStockModal(null);
      } catch (err) {
        toast.error(friendlyError(err, "Could not save"));
      }
    });
  };

  const removeSale = (sale) => {
    if (!window.confirm(`Delete the sale to ${sale.buyerName} (${sale.quantity} × ${itemName(sale)})? The items go back to reception stock.`)) return;
    run(async () => {
      try {
        await deleteDoc(doc(db, "receptionSales", sale.id));
        toast.success("Sale deleted");
        logActivity("deleted", "Reception Inventory", `Sale to ${sale.buyerName}: ${sale.quantity} × ${itemName(sale)}`);
      } catch (e) {
        toast.error(friendlyError(e, "Could not delete"));
      }
    });
  };

  const getExportData = () => ({
    headers: ["Date of Buying", "Buyer Name", "Item", "Quantity", "Price / Unit", "Amount", "Paid / Unpaid", "Paid On"],
    rows: shownSales.map((s) => [s.date, s.buyerName, itemName(s), s.quantity, Number(s.unitPrice) || 0, Number(s.amount) || 0, s.paid ? "Paid" : "Unpaid", s.paidDate || ""]),
  });

  const saleItem = saleModal ? itemById.get(saleModal.itemId) : null;
  const saleTotal = saleModal ? round2((Number(saleModal.unitPrice) || 0) * (Number(saleModal.quantity) || 0)) : 0;

  if (error) {
    return (
      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 12, padding: 16, fontSize: 14 }}>
        {friendlyError(error, "Could not load the reception inventory.")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Reception Inventory</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>Stock at reception and what was sold to whom.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can("canExport") && <ExportMenu filename="reception-sales" title="Reception Sales" getData={getExportData} />}
          {canEdit && <Link to={`/stock-checkout?to=${encodeURIComponent(RECEPTION)}`} style={{ ...btn("#b45309"), textDecoration: "none" }}><PackageMinus size={14} /> Bring from Storage</Link>}
          {canEdit && <button onClick={() => setSaleModal(emptySale())} style={btn()}><Plus size={14} /> Record Sale</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        <StatCard label="Stock left at reception" value={loading ? "…" : totals.left} color="#4f46e5" />
        <StatCard label="Paid" value={loading ? "…" : `Rs. ${formatMoney(totals.paid)}`} color="#10b981" />
        <StatCard label={`Unpaid (${totals.unpaidCount})`} value={loading ? "…" : `Rs. ${formatMoney(totals.unpaid)}`} color={totals.unpaid ? "#b45309" : "var(--text)"} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyer or item…" style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <select value={paidFilter} onChange={(e) => setPaidFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">Paid and unpaid</option>
          <option value="unpaid">Unpaid only</option>
          <option value="paid">Paid only</option>
        </select>
      </div>

      {/* ---- stock left ---- */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Stock left</h3>
          <label style={{ fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showAllItems} onChange={(e) => setShowAllItems(e.target.checked)} /> Show all items
          </label>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {["Item", "Received", "Sold", "Stock Left", "Coming (waiting approval)", "In storage", ""].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {stockRows.map((it) => {
                const s = summary.get(it.id);
                return (
                  <tr key={it.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{it.name} {it.code && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>{it.code}</span>}</td>
                    <td style={td}>{s.receptionOpening + s.receptionIn}</td>
                    <td style={td}>{s.sold}</td>
                    <td style={{ ...td, fontWeight: 700, fontSize: 15, color: s.receptionLeft <= 0 ? "#b91c1c" : undefined }}>{s.receptionLeft}</td>
                    <td style={{ ...td, color: "#b45309" }}>{incoming.get(it.id) || "—"}</td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>{s.current}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {canAdjust && (
                        <button title="Correct the stock left at reception" onClick={() => setStockModal({ itemId: it.id, left: String(s.receptionLeft) })}
                          style={editBtn}><Pencil size={13} /> Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && stockRows.length === 0 && (
          <div style={{ padding: 28, textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
            Nothing has been sent to reception yet. Use <strong>Bring from Storage</strong> with destination Reception; it counts here once approved.
          </div>
        )}
      </div>

      {/* ---- sales ---- */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, padding: "12px 14px" }}>Sales</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {["Paid", "Date of Buying", "Buyer Name", "Item", "Qty", "Amount", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shownSales.map((s) => (
                <tr key={s.id}>
                  <td style={td}>
                    <input type="checkbox" checked={!!s.paid} disabled={!canEdit || busy} onChange={() => togglePaid(s)}
                      aria-label={s.paid ? "Paid (untick to mark unpaid)" : "Tick when paid"} title={s.paid ? `Paid${s.paidDate ? ` on ${s.paidDate}` : ""}` : "Tick when paid"}
                      style={{ width: 18, height: 18, cursor: canEdit ? "pointer" : "default", accentColor: "#047857" }} />
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{s.date}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{s.buyerName}</td>
                  <td style={td}>{itemName(s)}</td>
                  <td style={td}>{s.quantity}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>Rs. {formatMoney(s.amount || 0)}</td>
                  <td style={td}><Pill tone={s.paid ? "Paid" : "Unpaid"}>{s.paid ? "Paid" : "Unpaid"}</Pill></td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {canEdit && <>
                      <button title="Edit sale" onClick={() => setSaleModal({ id: s.id, itemId: s.itemId, buyerName: s.buyerName || "", quantity: String(s.quantity ?? ""), unitPrice: String(s.unitPrice ?? ""), date: s.date, paid: !!s.paid })}
                        style={{ ...editBtn, marginRight: 5 }}><Pencil size={13} /> Edit</button>
                      <button title="Delete sale" onClick={() => removeSale(s)}
                        style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "5px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && shownSales.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>No sales {sales.length ? "match" : "yet"}</div>}
        {loading && <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>}
      </div>

      {saleModal && (
        <Modal title={saleModal.id ? "Edit sale" : "Record sale"} onClose={() => setSaleModal(null)}>
          <form onSubmit={saveSale}>
            {/* not a <label>: a label would forward clicks into the dropdown's search box */}
            <div style={{ marginBottom: 14 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Item *</span>
              <SearchableSelect
                value={saleModal.itemId}
                onChange={(v) => { const it = itemById.get(v); setSaleModal((p) => ({ ...p, itemId: v, unitPrice: it && Number(it.unitPrice) ? String(it.unitPrice) : p.unitPrice })); }}
                options={items.map((i) => ({ value: i.id, label: i.code ? `${i.name} (${i.code})` : i.name, sublabel: `${summary.get(i.id)?.receptionLeft ?? 0} left at reception` }))}
                placeholder="Choose or search item…"
              />
              {saleItem && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Stock left at reception: {summary.get(saleItem.id)?.receptionLeft ?? 0}</span>}
            </div>
            <Field label="Buyer's name *"><input value={saleModal.buyerName} onChange={(e) => setSaleModal((p) => ({ ...p, buyerName: e.target.value }))} required placeholder="Student or parent name" style={inputStyle} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Quantity *"><input type="number" min="1" step="1" value={saleModal.quantity} onChange={(e) => setSaleModal((p) => ({ ...p, quantity: e.target.value }))} required style={inputStyle} /></Field>
              <Field label="Price per unit (Rs.)"><input type="number" min="0" step="0.01" value={saleModal.unitPrice} onChange={(e) => setSaleModal((p) => ({ ...p, unitPrice: e.target.value }))} style={inputStyle} /></Field>
            </div>
            <Field label="Date of buying *"><input type="date" value={saleModal.date} onChange={(e) => setSaleModal((p) => ({ ...p, date: e.target.value }))} required style={inputStyle} /></Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={saleModal.paid} onChange={(e) => setSaleModal((p) => ({ ...p, paid: e.target.checked }))} style={{ width: 18, height: 18, accentColor: "#047857" }} />
              Paid
            </label>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Total: Rs. {formatMoney(saleTotal)}</div>
            <button type="submit" disabled={busy} style={{ ...btn(), width: "100%", justifyContent: "center", padding: 12 }}>{busy ? "Saving…" : "Save sale"}</button>
          </form>
        </Modal>
      )}

      {stockModal && (() => {
        const it = itemById.get(stockModal.itemId);
        const s = summary.get(stockModal.itemId);
        if (!it || !s) return null;
        return (
          <Modal title={`Edit stock at reception: ${it.name}`} onClose={() => setStockModal(null)}>
            <form onSubmit={saveStock}>
              <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
                Received from storage: <strong>{s.receptionOpening + s.receptionIn}</strong> · Sold: <strong>{s.sold}</strong> · Stock left now: <strong>{s.receptionLeft}</strong>
              </p>
              <Field label="Stock left at reception *" hint="Enter what is actually on the reception shelf. Storage stock is not changed.">
                <input type="number" min="0" step="1" value={stockModal.left} autoFocus required
                  onChange={(e) => setStockModal((p) => ({ ...p, left: e.target.value }))} style={inputStyle} />
              </Field>
              <button type="submit" disabled={busy} style={{ ...btn(), width: "100%", justifyContent: "center", padding: 12 }}>{busy ? "Saving…" : "Save"}</button>
            </form>
          </Modal>
        );
      })()}
    </div>
  );
}
