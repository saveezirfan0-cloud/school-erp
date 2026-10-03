import React, { useState } from "react";
import { supabase, updateDocs, serverTimestamp } from "../../firebase";
import { logActivity } from "../../utils/auditLog";
import toast from "react-hot-toast";
import { Plus, Trash2, X } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const input = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "white" };
const label = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 };

// Edit an existing invoice: branch, period, due date, notes and fee line items.
// Money already received is never changed here — use Mark Paid / Add Payment
// for that. The invoice total can't drop below what's been received + conceded.
export default function InvoiceEditModal({ invoice, branches, isMobile, onClose }) {
  const [form, setForm] = useState({
    branchId: invoice.branchId || "",
    month: invoice.month || "",
    year: invoice.year || new Date().getFullYear(),
    dueDate: invoice.dueDate || "",
    notes: invoice.notes || "",
  });
  const [items, setItems] = useState(
    (invoice.lineItems && invoice.lineItems.length
      ? invoice.lineItems
      : [{ description: "Tuition Fee", amount: invoice.amount || "" }]
    ).map(li => ({ description: li.customDescription || li.description || "", amount: li.amount ?? "" }))
  );
  const [saving, setSaving] = useState(false);

  const oldAmount = Number(invoice.amount || 0);
  const paidAmount = Number(invoice.paidAmount || 0);
  // Older "paid" invoices may have no paidAmount recorded.
  const received = paidAmount > 0 ? paidAmount : (invoice.status === "paid" ? oldAmount : 0);
  const conceded = Number(invoice.concessionAmount || 0);
  const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);

  const setItem = (idx, patch) => setItems(p => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (total <= 0) return toast.error("Invoice total must be greater than 0");
    if (total + 0.001 < received + conceded) {
      return toast.error(`Total can't be below what's already received${conceded ? " + conceded" : ""} (Rs. ${(received + conceded).toLocaleString()})`);
    }
    setSaving(true);
    try {
      const branchId = form.branchId === "main" ? "" : form.branchId;
      const changes = {
        branchId,
        month: form.month,
        year: Number(form.year),
        dueDate: form.dueDate,
        notes: form.notes,
        lineItems: items.map(i => ({ description: i.description, amount: Number(i.amount || 0) })),
        amount: total,
        updatedAt: serverTimestamp(),
      };
      if (Math.abs(total - oldAmount) > 0.001) {
        // Re-derive status from what's been received against the new total.
        changes.status = received + conceded + 0.001 >= total ? "paid" : received > 0 ? "partial" : "pending";
        if (received > 0 && !paidAmount) changes.paidAmount = received;
      }
      await updateDocs("invoices", [invoice.id], changes);

      // Keep the ledger entries for this invoice in the same branch.
      if ((invoice.branchId || "") !== branchId) {
        const { error } = await supabase.from("payments").update({ branch_id: branchId })
          .eq("source", "invoice").eq("source_id", invoice.id);
        if (error) console.error("Could not update payment branch:", error);
      }

      toast.success("Invoice updated");
      logActivity("updated", "Invoices", `Invoice ${invoice.studentName} — ${form.month} ${form.year} · Rs. ${total.toLocaleString()}`);
      onClose();
    } catch (err) {
      toast.error(err?.message || "Error updating invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 560, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>Edit Invoice</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          {invoice.studentName} · <strong>{invoice.status}</strong>
          {received > 0 && <> · Rs. {received.toLocaleString()} received</>}
        </p>

        <form onSubmit={save}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
              <label style={label}>Branch</label>
              <select style={input} value={form.branchId || "main"} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}>
                <option value="main">Main Office</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {received > 0 && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Payments already received for this invoice move to the new branch too.</div>}
            </div>
            <div>
              <label style={label}>Month</label>
              <select style={input} value={form.month} required onChange={e => setForm(p => ({ ...p, month: e.target.value }))}>
                <option value="">Select month</option>
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Year</label>
              <input type="number" style={input} value={form.year} required onChange={e => setForm(p => ({ ...p, year: e.target.value }))} />
            </div>
            <div>
              <label style={label}>Due Date</label>
              <input type="date" style={input} value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
            </div>
            <div>
              <label style={label}>Notes</label>
              <input style={input} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Fee Line Items</label>
              <button type="button" onClick={() => setItems(p => [...p, { description: "", amount: "" }])}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "var(--primary-light)", color: "var(--primary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                <Plus size={12} /> Add Item
              </button>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {items.map((it, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8, padding: "10px 12px", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                  <input style={{ ...input, padding: "8px 10px" }} value={it.description} onChange={e => setItem(idx, { description: e.target.value })} placeholder="Description" />
                  <input type="number" min="0" style={{ ...input, padding: "8px 10px" }} value={it.amount} onChange={e => setItem(idx, { amount: e.target.value })} placeholder="Amount" />
                  <button type="button" disabled={items.length === 1} onClick={() => setItems(p => p.filter((_, i) => i !== idx))} title="Remove item"
                    style={{ border: "none", background: "none", cursor: items.length === 1 ? "not-allowed" : "pointer", color: "var(--danger)", opacity: items.length === 1 ? 0.3 : 1 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#f8fafc", fontWeight: 700 }}>
                <span>Total</span>
                <span style={{ color: "var(--primary)" }}>Rs. {total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white" }}>Cancel</button>
            <button type="submit" disabled={saving}
              style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: saving ? "wait" : "pointer", fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
