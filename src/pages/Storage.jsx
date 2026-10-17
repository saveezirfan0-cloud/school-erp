import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, collection, doc, addDoc, addDocs, updateDoc, deleteDoc } from "../firebase";
import { useUser } from "../context/UserContext";
import { useInventory } from "../hooks/useInventory";
import {
  MOVEMENT_STATUS, PAYMENT_OPTIONS, nextItemCode, parseQuantity,
  parseInventoryWorkbook, planInventoryImport,
} from "../utils/inventory";
import { readWorkbookSheets } from "../utils/importParsing";
import { todayLocal, isIsoDate, formatMoney } from "../utils/money";
import { useSubmitLock } from "../utils/useSubmitLock";
import { logActivity } from "../utils/auditLog";
import ExportMenu from "../components/UI/ExportMenu";
import { Modal, Field, StatCard, Pill, inputStyle, btn, th, td, friendlyError } from "../components/Inventory/ui";
import toast from "react-hot-toast";
import { Plus, PackagePlus, PackageMinus, Upload, Pencil, Trash2, X, Clock, Search, Undo2 } from "lucide-react";

const emptyItem = { code: "", name: "", unitPrice: "", openingStock: "", receptionOpening: "", lowStockLevel: "10" };
const emptyStockIn = { itemId: "", quantity: "", date: "", destination: "", slipNo: "", reason: "" };

const numOrZero = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));

export default function Storage() {
  const { can, userProfile } = useUser();
  const approver = can("canApproveInventory");
  const canEdit = can("canEditInventory") || approver;
  const { items, movements, summary, itemById, loading, error } = useInventory({ sales: false });

  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [itemModal, setItemModal] = useState(null);     // { id?, ...fields }
  const [stockIn, setStockIn] = useState(null);
  const [importState, setImportState] = useState(null); // { plan, fileName }
  const { busy, run } = useSubmitLock();
  const [rowBusy, setRowBusy] = useState(null);

  const itemName = useCallback((row) => itemById.get(row.itemId)?.name || row.itemName || "(deleted item)", [itemById]);
  const reviewerName = userProfile?.name || userProfile?.email || "";

  const pending = useMemo(() => movements
    .filter((m) => m.status === MOVEMENT_STATUS.PENDING)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))),
  [movements]);

  const q = search.trim().toLowerCase();
  const shownItems = items.filter((i) => !q || i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));
  const log = useMemo(() => movements
    .filter((m) => !logStatus || m.status === logStatus)
    .filter((m) => !q || itemName(m).toLowerCase().includes(q) || String(m.destination || "").toLowerCase().includes(q)
      || String(m.person || "").toLowerCase().includes(q))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
  [movements, logStatus, q, itemName]);

  const totals = useMemo(() => {
    let value = 0, low = 0;
    for (const it of items) {
      const s = summary.get(it.id);
      value += s?.value || 0;
      if (s && s.status !== "Available") low++;
    }
    return { value, low };
  }, [items, summary]);

  // ---- approval (the "Paid" tick of the Fees page, for stock) ----
  const setStatus = (m, status) => run(async () => {
    setRowBusy(m.id);
    try {
      await updateDoc(doc(db, "inventoryMovements", m.id), { status, reviewedByName: status === MOVEMENT_STATUS.PENDING ? "" : reviewerName });
      const verb = status === MOVEMENT_STATUS.APPROVED ? "approved" : status === MOVEMENT_STATUS.REJECTED ? "rejected" : "unapproved";
      toast.success(status === MOVEMENT_STATUS.APPROVED
        ? `Approved: ${m.quantity} × ${itemName(m)} ${m.direction === "in" ? "added to" : "deducted from"} storage`
        : status === MOVEMENT_STATUS.REJECTED ? "Request rejected" : "Approval undone; stock restored");
      logActivity(verb, "Inventory", `${m.direction === "in" ? "Stock in" : "Stock out"} ${m.quantity} × ${itemName(m)} ${m.direction === "in" ? "from" : "to"} ${m.destination || "-"}`);
    } catch (e) {
      toast.error(friendlyError(e, "Could not update the entry"), { duration: 8000 });
    } finally {
      setRowBusy(null);
    }
  });

  const reject = (m) => {
    if (!window.confirm(`Reject ${m.quantity} × ${itemName(m)} for ${m.destination}? Nothing will be deducted.`)) return;
    setStatus(m, MOVEMENT_STATUS.REJECTED);
  };
  const undoApproval = (m) => {
    if (!window.confirm(`Undo the approval of ${m.quantity} × ${itemName(m)}? The stock goes back to how it was and the entry waits for approval again.`)) return;
    setStatus(m, MOVEMENT_STATUS.PENDING);
  };

  const approveAll = () => {
    if (!pending.length) return;
    if (!window.confirm(`Approve all ${pending.length} pending entries? Stock will be updated for each one.`)) return;
    run(async () => {
      // Oldest first, one at a time: the database checks each against the
      // stock left, so one that does not fit is reported and the rest go on.
      let ok = 0;
      const failed = [];
      for (const m of pending) {
        try {
          await updateDoc(doc(db, "inventoryMovements", m.id), { status: MOVEMENT_STATUS.APPROVED, reviewedByName: reviewerName });
          ok++;
        } catch (e) {
          failed.push(`${m.quantity} × ${itemName(m)}: ${friendlyError(e, "refused")}`);
        }
      }
      if (ok) {
        toast.success(`Approved ${ok} ${ok === 1 ? "entry" : "entries"}`);
        logActivity("approved", "Inventory", `${ok} pending stock entries approved together`);
      }
      if (failed.length) toast.error(`Not approved:\n${failed.join("\n")}`, { duration: 10000 });
    });
  };

  const removeMovement = (m) => {
    if (!window.confirm(`Delete this ${m.status} entry (${m.quantity} × ${itemName(m)})?`)) return;
    run(async () => {
      try {
        await deleteDoc(doc(db, "inventoryMovements", m.id));
        toast.success("Entry deleted");
        logActivity("deleted", "Inventory", `${m.status} entry ${m.quantity} × ${itemName(m)}`);
      } catch (e) {
        toast.error(friendlyError(e, "Could not delete"));
      }
    });
  };

  const setPayment = (m, paymentStatus) => run(async () => {
    try {
      await updateDoc(doc(db, "inventoryMovements", m.id), { paymentStatus });
    } catch (e) {
      toast.error(friendlyError(e, "Could not save the payment status"));
    }
  });

  // ---- items ----
  const saveItem = (e) => {
    e.preventDefault();
    run(async () => {
      const f = itemModal;
      const name = f.name.trim();
      if (!name) return toast.error("Enter the item name");
      const nums = { unitPrice: numOrZero(f.unitPrice), openingStock: numOrZero(f.openingStock), receptionOpening: numOrZero(f.receptionOpening), lowStockLevel: numOrZero(f.lowStockLevel) };
      if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) return toast.error("Numbers cannot be negative");
      const code = f.code.trim() || nextItemCode(items);
      if (items.some((i) => i.id !== f.id && i.code && i.code.toLowerCase() === code.toLowerCase())) return toast.error(`Code ${code} is already used`);
      try {
        if (f.id) await updateDoc(doc(db, "inventoryItems", f.id), { code, name, ...nums });
        else await addDoc(collection(db, "inventoryItems"), { code, name, ...nums });
        toast.success(f.id ? "Item updated" : "Item added");
        logActivity(f.id ? "updated" : "created", "Inventory", `Item ${code} ${name}`);
        setItemModal(null);
      } catch (err) {
        toast.error(friendlyError(err, "Could not save the item"));
      }
    });
  };

  const deleteItem = (it) => {
    if (movements.some((m) => m.itemId === it.id)) {
      return toast.error("This item has stock entries, so it cannot be deleted.");
    }
    if (!window.confirm(`Delete ${it.name}? This cannot be undone.`)) return;
    run(async () => {
      try {
        await deleteDoc(doc(db, "inventoryItems", it.id));
        toast.success("Item deleted");
        logActivity("deleted", "Inventory", `Item ${it.code || ""} ${it.name}`);
      } catch (e) {
        toast.error(friendlyError(e, "Could not delete the item"));
      }
    });
  };

  // ---- stock in ----
  const saveStockIn = (e) => {
    e.preventDefault();
    run(async () => {
      const f = stockIn;
      const item = itemById.get(f.itemId);
      if (!item) return toast.error("Choose the item");
      const qty = parseQuantity(f.quantity);
      if (!qty.ok) return toast.error(qty.error);
      if (!isIsoDate(f.date)) return toast.error("Enter a valid date");
      try {
        await addDoc(collection(db, "inventoryMovements"), {
          itemId: item.id, itemName: item.name, itemCode: item.code || "",
          direction: "in", quantity: qty.value, date: f.date,
          destination: f.destination.trim(), slipNo: f.slipNo.trim(), reason: f.reason.trim(),
          person: userProfile?.name || "",
          status: approver ? MOVEMENT_STATUS.APPROVED : MOVEMENT_STATUS.PENDING,
          requestedByName: reviewerName,
          ...(approver ? { reviewedByName: reviewerName } : {}),
        });
        toast.success(approver ? `Added ${qty.value} × ${item.name} to storage` : "Stock in sent for approval");
        logActivity(approver ? "stock in" : "requested", "Inventory", `Stock in ${qty.value} × ${item.name}${f.destination ? ` from ${f.destination}` : ""}`);
        setStockIn(null);
      } catch (err) {
        toast.error(friendlyError(err, "Could not save"));
      }
    });
  };

  // ---- workbook import ----
  const pickWorkbook = async (file) => {
    if (!file) return;
    try {
      const sheets = await readWorkbookSheets(file);
      const parsed = parseInventoryWorkbook(sheets);
      const plan = planInventoryImport(parsed, items, movements);
      setImportState({ fileName: file.name, plan });
    } catch (e) {
      toast.error(e?.message || "Could not read the workbook", { duration: 7000 });
    }
  };

  const runImport = () => run(async () => {
    const { plan } = importState;
    try {
      const created = await addDocs("inventoryItems", plan.newItems.map((it) => ({
        code: it.code, name: it.name, unitPrice: it.unitPrice, openingStock: it.openingStock,
        receptionOpening: 0, lowStockLevel: 10, imported: true,
      })));
      const idFor = (m) => (m.itemId ? m.itemId : created[Number(m.itemKey.slice(4))]?.id);
      const rows = plan.movements.map((m) => ({
        itemId: idFor(m), itemName: m.name, direction: m.direction, quantity: m.quantity, date: m.date,
        destination: m.destination, slipNo: m.slipNo, paymentStatus: m.paymentStatus || "",
        reason: "Imported from workbook", status: MOVEMENT_STATUS.APPROVED,
        requestedByName: reviewerName, reviewedByName: reviewerName, imported: true,
      }));
      if (rows.some((r) => !r.itemId)) throw new Error("Some log entries could not be matched to the new items");
      if (rows.length) await addDocs("inventoryMovements", rows);
      toast.success(`Imported ${created.length} items and ${rows.length} log entries`);
      logActivity("imported", "Inventory", `${importState.fileName}: ${created.length} items, ${rows.length} log entries`);
      setImportState(null);
    } catch (e) {
      toast.error(`${friendlyError(e, "Import failed")}. Items already created stay; re-run the import to add the rest.`, { duration: 10000 });
    }
  });

  const getExportData = () => tab === "stock" ? {
    headers: ["Item ID", "Item Description", "Opening Stock", "Amount Per Unit", "Total Stock In", "Total Stock Out", "Current Stock", "Total Amount", "Waiting Approval", "Status"],
    rows: shownItems.map((i) => { const s = summary.get(i.id); return [i.code, i.name, s.opening, Number(i.unitPrice) || 0, s.approvedIn, s.approvedOut, s.current, s.value, s.pendingOut, s.status]; }),
  } : {
    headers: ["Date", "Slip / Bill No.", "Item", "To / From", "Stock In", "Stock Out", "Taken By", "Reason", "Payment", "Status"],
    rows: log.map((m) => [m.date, m.slipNo || "", itemName(m), m.destination || "", m.direction === "in" ? m.quantity : "", m.direction === "out" ? m.quantity : "", m.person || "", m.reason || "", m.paymentStatus || "", m.status]),
  };

  if (error) {
    return (
      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 12, padding: 16, fontSize: 14 }}>
        {friendlyError(error, "Could not load the storage data.")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Storage</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>Stock is deducted only after an entry is approved.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can("canExport") && <ExportMenu filename={tab === "stock" ? "storage-stock" : "storage-log"} title={tab === "stock" ? "Current Stock Status" : "Daily In-Out Log"} getData={getExportData} />}
          {approver && <button onClick={() => setImportState({ plan: null })} style={btn("white", "var(--text)")}><Upload size={14} /> Import</button>}
          {canEdit && <button onClick={() => setStockIn({ ...emptyStockIn, date: todayLocal() })} style={btn("#2a8c7a")}><PackagePlus size={14} /> Stock In</button>}
          {canEdit && <Link to="/stock-checkout" style={{ ...btn("#b45309"), textDecoration: "none" }}><PackageMinus size={14} /> Take Out</Link>}
          {approver && <button onClick={() => setItemModal({ ...emptyItem, code: nextItemCode(items) })} style={btn()}><Plus size={14} /> Add Item</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        <StatCard label="Items" value={loading ? "…" : items.length} color="#4f46e5" />
        <StatCard label="Stock value" value={loading ? "…" : `Rs. ${formatMoney(totals.value)}`} color="#10b981" />
        <StatCard label="Low / out of stock" value={loading ? "…" : totals.low} color={totals.low ? "#b45309" : "var(--text)"} />
        <StatCard label="Waiting for approval" value={loading ? "…" : pending.length} color={pending.length ? "#b45309" : "var(--text)"} />
      </div>

      {/* ---- approvals ---- */}
      {pending.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, marginBottom: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#92400e" }}>
              <Clock size={16} /> Waiting for approval ({pending.length})
            </div>
            {approver && pending.length > 1 && <button disabled={busy} onClick={approveAll} style={btn("#047857")}>Approve all</button>}
          </div>
          <div style={{ overflowX: "auto", background: "white" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr style={{ background: "#fffdf5" }}>
                {[approver ? "Approve" : "", "Date", "Item", "Qty", "In / Out", "To / From", "Taken by", "Reason", "In storage", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pending.map((m) => {
                  const s = summary.get(m.itemId);
                  const short = m.direction === "out" && s && m.quantity > s.current;
                  return (
                    <tr key={m.id}>
                      <td style={td}>
                        {approver ? (
                          <input type="checkbox" checked={false} disabled={busy || rowBusy === m.id}
                            onChange={() => setStatus(m, MOVEMENT_STATUS.APPROVED)}
                            aria-label={`Approve ${m.quantity} ${itemName(m)}`} title="Tick to approve"
                            style={{ width: 20, height: 20, cursor: "pointer", accentColor: "#047857" }} />
                        ) : <Pill tone="pending">Waiting</Pill>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{m.date}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{itemName(m)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{m.quantity}</td>
                      <td style={td}>{m.direction === "in" ? <span style={{ color: "#047857" }}>In</span> : <span style={{ color: "#b45309" }}>Out</span>}</td>
                      <td style={td}>{m.destination || "—"}</td>
                      <td style={td}>{m.person || m.requestedByName || "—"}</td>
                      <td style={{ ...td, color: "var(--text-muted)", maxWidth: 220 }}>{m.reason || "—"}</td>
                      <td style={{ ...td, color: short ? "#b91c1c" : undefined, fontWeight: short ? 700 : undefined }} title={short ? "Not enough in storage to approve" : undefined}>{s ? s.current : "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                        {approver && <button disabled={busy} onClick={() => reject(m)} style={{ ...btn("#fef2f2", "#b91c1c"), padding: "5px 9px", fontSize: 12 }}><X size={12} /> Reject</button>}
                        {!approver && canEdit && <button disabled={busy} onClick={() => removeMovement(m)} style={{ ...btn("#f1f5f9", "#475569"), padding: "5px 9px", fontSize: 12 }}>Cancel</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- tabs ---- */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[["stock", "Current Stock"], ["log", "In-Out Log"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 600, fontSize: 13, background: tab === k ? "var(--primary)" : "white", color: tab === k ? "white" : "var(--text)" }}>{l}</button>
        ))}
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "stock" ? "Search items…" : "Search item, destination, person…"} style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        {tab === "log" && (
          <select value={logStatus} onChange={(e) => setLogStatus(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
            <option value="">All entries</option>
            <option value="approved">Approved</option>
            <option value="pending">Waiting for approval</option>
            <option value="rejected">Rejected</option>
          </select>
        )}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          {tab === "stock" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead><tr style={{ background: "#f8fafc" }}>
                {["Item ID", "Item", "Opening", "Price / Unit", "Stock In", "Stock Out", "Current Stock", "Total Amount", "Waiting", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {shownItems.map((it) => {
                  const s = summary.get(it.id);
                  return (
                    <tr key={it.id}>
                      <td style={{ ...td, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{it.code || "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{it.name}</td>
                      <td style={td}>{s.opening}</td>
                      <td style={td}>{Number(it.unitPrice) ? `Rs. ${formatMoney(it.unitPrice)}` : "—"}</td>
                      <td style={{ ...td, color: "#047857" }}>{s.approvedIn || "—"}</td>
                      <td style={{ ...td, color: "#b45309" }}>{s.approvedOut || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, fontSize: 15 }}>{s.current}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{s.value ? `Rs. ${formatMoney(s.value)}` : "—"}</td>
                      <td style={{ ...td, color: s.pendingOut ? "#b45309" : "var(--text-muted)" }}>{s.pendingOut || "—"}</td>
                      <td style={td}><Pill>{s.status}</Pill></td>
                      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                        {approver && <>
                          <button title="Edit item" onClick={() => setItemModal({ id: it.id, code: it.code || "", name: it.name || "", unitPrice: String(it.unitPrice ?? ""), openingStock: String(it.openingStock ?? ""), receptionOpening: String(it.receptionOpening ?? ""), lowStockLevel: String(it.lowStockLevel ?? "10") })}
                            style={{ border: "none", background: "#f1f5f9", color: "#475569", padding: "5px 8px", borderRadius: 6, cursor: "pointer", marginRight: 5 }}><Pencil size={13} /></button>
                          <button title="Delete item" onClick={() => deleteItem(it)}
                            style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "5px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead><tr style={{ background: "#f8fafc" }}>
                {["Approved", "Date", "Slip / Bill", "Item", "To / From", "In", "Out", "Taken by", "Reason", "Payment", ""].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {log.map((m) => {
                  const approved = m.status === MOVEMENT_STATUS.APPROVED;
                  return (
                    <tr key={m.id} style={{ background: m.status === MOVEMENT_STATUS.REJECTED ? "#fafafa" : undefined, color: m.status === MOVEMENT_STATUS.REJECTED ? "var(--text-muted)" : undefined }}>
                      <td style={td}>
                        {m.status === MOVEMENT_STATUS.REJECTED ? <Pill tone="rejected">Rejected</Pill> : (
                          <input type="checkbox" checked={approved} disabled={!approver || busy || rowBusy === m.id}
                            onChange={() => (approved ? undoApproval(m) : setStatus(m, MOVEMENT_STATUS.APPROVED))}
                            aria-label={approved ? "Approved (untick to undo)" : "Tick to approve"}
                            title={approved ? `Approved${m.reviewedByName ? ` by ${m.reviewedByName}` : ""}${approver ? " · untick to undo" : ""}` : approver ? "Tick to approve" : "Waiting for approval"}
                            style={{ width: 18, height: 18, cursor: approver ? "pointer" : "default", accentColor: "#047857" }} />
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{m.date}</td>
                      <td style={td}>{m.slipNo || "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{itemName(m)}</td>
                      <td style={td}>{m.destination || "—"}</td>
                      <td style={{ ...td, color: "#047857", fontWeight: 600 }}>{m.direction === "in" ? m.quantity : ""}</td>
                      <td style={{ ...td, color: "#b45309", fontWeight: 600 }}>{m.direction === "out" ? m.quantity : ""}</td>
                      <td style={td}>{m.person || "—"}</td>
                      <td style={{ ...td, color: "var(--text-muted)", maxWidth: 200 }}>{m.reason || "—"}</td>
                      <td style={td}>
                        {m.direction === "out" && approver ? (
                          <select value={m.paymentStatus || ""} onChange={(e) => setPayment(m, e.target.value)} disabled={busy}
                            style={{ ...inputStyle, padding: "4px 6px", fontSize: 12, width: "auto" }}>
                            <option value="">—</option>
                            {[...new Set([...PAYMENT_OPTIONS, m.paymentStatus].filter(Boolean))].map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (m.paymentStatus || "—")}
                      </td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {approved && approver && <button title="Undo approval" onClick={() => undoApproval(m)} disabled={busy}
                          style={{ border: "none", background: "#f1f5f9", color: "#475569", padding: "5px 8px", borderRadius: 6, cursor: "pointer" }}><Undo2 size={13} /></button>}
                        {!approved && canEdit && <button title="Delete entry" onClick={() => removeMovement(m)} disabled={busy}
                          style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "5px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && (tab === "stock" ? shownItems : log).length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            {tab === "stock"
              ? (items.length ? "No item matches your search" : approver ? "No items yet. Add one, or import your inventory workbook." : "No items yet.")
              : "No entries"}
          </div>
        )}
        {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>}
      </div>

      {/* ---- item modal ---- */}
      {itemModal && (
        <Modal title={itemModal.id ? "Edit item" : "Add item"} onClose={() => setItemModal(null)}>
          <form onSubmit={saveItem}>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
              <Field label="Item ID"><input value={itemModal.code} onChange={(e) => setItemModal((p) => ({ ...p, code: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Item name *"><input value={itemModal.name} onChange={(e) => setItemModal((p) => ({ ...p, name: e.target.value }))} required autoFocus style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Opening stock" hint="Count in storage before any entries"><input type="number" min="0" step="1" value={itemModal.openingStock} onChange={(e) => setItemModal((p) => ({ ...p, openingStock: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Price per unit (Rs.)"><input type="number" min="0" step="0.01" value={itemModal.unitPrice} onChange={(e) => setItemModal((p) => ({ ...p, unitPrice: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Already at reception" hint="Stock reception held before using this system"><input type="number" min="0" step="1" value={itemModal.receptionOpening} onChange={(e) => setItemModal((p) => ({ ...p, receptionOpening: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Low stock below"><input type="number" min="0" step="1" value={itemModal.lowStockLevel} onChange={(e) => setItemModal((p) => ({ ...p, lowStockLevel: e.target.value }))} style={inputStyle} /></Field>
            </div>
            <button type="submit" disabled={busy} style={{ ...btn(), width: "100%", justifyContent: "center", padding: 12 }}>{busy ? "Saving…" : "Save item"}</button>
          </form>
        </Modal>
      )}

      {/* ---- stock in modal ---- */}
      {stockIn && (
        <Modal title="Stock In" onClose={() => setStockIn(null)}>
          <form onSubmit={saveStockIn}>
            <Field label="Item *">
              <select value={stockIn.itemId} onChange={(e) => setStockIn((p) => ({ ...p, itemId: e.target.value }))} required style={inputStyle}>
                <option value="">Choose item</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} · ` : ""}{i.name} ({summary.get(i.id)?.current ?? 0} in stock)</option>)}
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Quantity *"><input type="number" min="1" step="1" value={stockIn.quantity} onChange={(e) => setStockIn((p) => ({ ...p, quantity: e.target.value }))} required style={inputStyle} /></Field>
              <Field label="Date *"><input type="date" value={stockIn.date} onChange={(e) => setStockIn((p) => ({ ...p, date: e.target.value }))} required style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="From (supplier / department)"><input value={stockIn.destination} onChange={(e) => setStockIn((p) => ({ ...p, destination: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Slip / Bill No."><input value={stockIn.slipNo} onChange={(e) => setStockIn((p) => ({ ...p, slipNo: e.target.value }))} style={inputStyle} /></Field>
            </div>
            <Field label="Note"><input value={stockIn.reason} onChange={(e) => setStockIn((p) => ({ ...p, reason: e.target.value }))} style={inputStyle} /></Field>
            {!approver && <p style={{ fontSize: 12.5, color: "#b45309", marginBottom: 12 }}>This will be added to storage after an admin approves it.</p>}
            <button type="submit" disabled={busy} style={{ ...btn("#2a8c7a"), width: "100%", justifyContent: "center", padding: 12 }}>{busy ? "Saving…" : approver ? "Add to storage" : "Send for approval"}</button>
          </form>
        </Modal>
      )}

      {/* ---- import modal ---- */}
      {importState && (
        <Modal title="Import inventory workbook" onClose={() => setImportState(null)} width={560}>
          {!importState.plan ? (
            <>
              <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 14 }}>
                Choose the .xlsx with a <strong>Current Stock Status</strong> sheet (Item ID, Item Description, Opening Stock,
                Amount Per Unit) and optionally a <strong>Daily In-Out Log</strong> sheet. Log entries are imported as approved.
                Items that already exist are skipped, so importing twice is safe.
              </p>
              <input type="file" accept=".xlsx" onChange={(e) => pickWorkbook(e.target.files?.[0])} style={inputStyle} />
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, marginBottom: 10 }}><strong>{importState.fileName}</strong></p>
              <ul style={{ fontSize: 14, marginBottom: 12, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>{importState.plan.newItems.length} new items</li>
                <li>{importState.plan.movements.length} log entries (stock in / out, approved)</li>
                {importState.plan.duplicates > 0 && <li>{importState.plan.duplicates} log entries already imported, skipped</li>}
              </ul>
              {importState.plan.problems.length > 0 && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "#92400e", marginBottom: 12, maxHeight: 160, overflow: "auto" }}>
                  {importState.plan.problems.map((p, i) => <div key={i}>• {p}</div>)}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setImportState({ plan: null })} style={{ ...btn("white", "var(--text)"), flex: 1, justifyContent: "center" }}>Choose another file</button>
                <button disabled={busy || (!importState.plan.newItems.length && !importState.plan.movements.length)} onClick={runImport}
                  style={{ ...btn(), flex: 1, justifyContent: "center" }}>{busy ? "Importing…" : "Import"}</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
